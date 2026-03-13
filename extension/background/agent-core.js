// Core Agent Logic - Runs in Background Service Worker
// Handles state machine, LLM routing, and error recovery

// State
let agentState = 'IDLE'; // IDLE, NAVIGATING, SEARCHING, SCRAPING, APPLYING, DONE
let currentGoal = '';
let settings = {};
let stepCount = 0;
let lastActions = []; // Track last N actions for stuck detection
const MAX_STEPS = 50;
const MAX_REPEATS = 3; // If same action repeats this many times, skip it

// Constants
const ANTHROPIC_DEFAULT_URL = 'https://api.anthropic.com';
const OPENAI_DEFAULT_URL = 'https://api.openai.com';

function broadcastLog(message, isError = false) {
  console[isError ? 'error' : 'log']('[Agent]', message);
  chrome.runtime.sendMessage({ action: 'agent_log', message, isError }).catch(() => {});
}

export async function startAgent(config) {
  settings = config;
  agentState = 'NAVIGATING';
  stepCount = 0;
  currentGoal = `Find and apply to "${settings.searchQuery}" jobs on LinkedIn using Easy Apply.`;
  
  broadcastLog(`Starting with config: ${settings.provider} / ${settings.model}`);
  
  // Step 1: Navigate to LinkedIn Jobs search
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(settings.searchQuery)}&f_AL=true`;
  broadcastLog(`Navigating to LinkedIn Jobs search...`);
  
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: searchUrl });
  } else {
    await chrome.tabs.create({ url: searchUrl });
  }
  
  // Wait for page to load before starting loop
  setTimeout(runAgentLoop, 5000);
}

export function stopAgent() {
  agentState = 'IDLE';
  lastActions = [];
  broadcastLog('Stopped by user.');
  chrome.runtime.sendMessage({ action: 'agent_stopped' }).catch(() => {});
}

export function getAgentStatus() {
  return {
    state: agentState,
    goal: currentGoal,
    step: stepCount
  };
}

async function runAgentLoop() {
  if (agentState === 'IDLE') return;
  
  stepCount++;
  if (stepCount > MAX_STEPS) {
    broadcastLog('Max steps reached. Stopping.', true);
    agentState = 'IDLE';
    chrome.runtime.sendMessage({ action: 'agent_error', error: 'Max steps reached' }).catch(() => {});
    return;
  }

  try {
    broadcastLog(`Step ${stepCount} | State: ${agentState}`);
    
    // 1. Get snapshot from Content Script (includes URL and title)
    broadcastLog('Building DOM Snapshot...');
    const snapshot = await getDOMSnapshotFromActiveTab();
    
    if (!snapshot) {
      broadcastLog('No snapshot received. Retrying in 3s...', true);
      setTimeout(runAgentLoop, 3000);
      return;
    }
    
    // Safety check - CAPTCHA
    if (snapshot.rawText && snapshot.rawText.toLowerCase().includes('security verification')) {
      broadcastLog('CAPTCHA detected! Please solve it manually, then the agent will continue.', true);
      setTimeout(runAgentLoop, 10000);
      return;
    }

    broadcastLog(`Page: ${snapshot.url} | ${snapshot.elements.length} elements`);

    // 2. Stuck detection — check if LLM is repeating itself
    let stuckHint = '';
    if (lastActions.length >= MAX_REPEATS) {
      const recent = lastActions.slice(-MAX_REPEATS);
      const allSame = recent.every(a => a === recent[0]);
      if (allSame) {
        stuckHint = `\n\nWARNING: You have repeated the EXACT SAME action "${recent[0]}" ${MAX_REPEATS} times in a row. The element is NOT responding to clicks. Try a DIFFERENT approach: use a different action type, interact with a different element, or scroll to find other elements. For <select> dropdowns, use "select_option" instead of "click".`;
        broadcastLog(`Stuck detected! Same action repeated ${MAX_REPEATS}x. Sending hint to LLM.`, true);
      }
    }

    // 3. Ask LLM
    const decision = await callLLM(snapshot, stuckHint);
    broadcastLog(`LLM: ${decision.reasoning}`);
    broadcastLog(`Action: ${decision.action} → ${decision.elementId || 'N/A'} ${decision.value ? '(val: ' + decision.value + ')' : ''}`);
    
    // Track action for stuck detection
    const actionKey = `${decision.action}:${decision.elementId}:${decision.value}`;
    lastActions.push(actionKey);
    if (lastActions.length > 10) lastActions.shift();

    // 4. Execute Action
    if (decision.action === 'navigate') {
      broadcastLog(`Navigating to: ${decision.value}`);
      const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url: decision.value });
      }
      setTimeout(runAgentLoop, 5000);
      return;
    }
    
    if (decision.action === 'finish') {
      agentState = 'DONE';
      broadcastLog('Agent finished!');
      chrome.runtime.sendMessage({ action: 'agent_finished' }).catch(() => {});
      return;
    }

    if (decision.action !== 'wait') {
      await executeActionInActiveTab(decision);
    }
    
    // 4. Loop with human delay
    const delay = 3000 + Math.random() * 3000;
    broadcastLog(`Waiting ${Math.round(delay/1000)}s...`);
    setTimeout(runAgentLoop, delay);

  } catch (error) {
    broadcastLog(`Error: ${error.message}`, true);
    // Don't die on recoverable errors, retry
    if (stepCount < MAX_STEPS) {
      broadcastLog('Retrying in 5s...');
      setTimeout(runAgentLoop, 5000);
    } else {
      agentState = 'IDLE';
      chrome.runtime.sendMessage({ action: 'agent_error', error: error.message }).catch(() => {});
    }
  }
}

// ---- LLM Provider Abstraction ----

async function callLLM(snapshot, stuckHint = '') {
  const prompt = `You are an autonomous browser agent. You control a Chrome browser on LinkedIn.

YOUR GOAL: ${currentGoal}

CURRENT PAGE:
- URL: ${snapshot.url}
- Title: ${snapshot.title}
- Page text (first 1500 chars): ${snapshot.rawText.substring(0, 1500)}

INTERACTIVE ELEMENTS ON PAGE (id, tag, text):
${snapshot.elements.map(e => `[${e.id}] <${e.tag}${e.type ? ' type=' + e.type : ''}${e.role ? ' role=' + e.role : ''}> "${e.text}"${e.value ? ' value="' + e.value + '"' : ''}`).join('\n')}

RULES:
1. If the page shows "No results found", click "Clear all filters" or change the search query.
2. If you see job listings, click on one that has "Easy Apply" in its text.
3. If you see an "Easy Apply" button on a job detail page, click it to start applying.
4. Inside an Easy Apply modal, fill form fields and click "Next", "Review", or "Submit application".
5. IMPORTANT: In the Easy Apply modal, only interact with elements that exist in the CURRENT SNAPSHOT. Do not try to answer questions from previous steps that are no longer visible.
6. IMPORTANT: If a modal section (like Education or Experience) is already filled in or requires no further input, simply click the "Review", "Next", or "Continue" button at the bottom.
7. CRITICAL: NEVER repeat the exact same "type" or "clear_and_type" action on the same field twice in a row. If the field's "value" in the CURRENT PAGE snapshot already shows your answer (e.g., value="10"), DO NOT type it again. You MUST move on and click "Review" or "Next".
8. SUCCESS STATE: If you see "Your application was sent" or "Applied", you MUST click the "Done" button or the "Dismiss" / "Close" (X) button to close the modal. DO NOT try to answer anymore questions on this success screen.
9. After closing the success modal, look for the next job listing with "Easy Apply" and click it to start a new application.
10. You can use "navigate" action with a URL as value to go to a different page.
11. Do NOT declare "finish" unless you have exhaustively checked all pages and all jobs.
11. If an input field already has text but the prompt requires something else, use "clear_and_type" instead of "type".
12. To submit a search, after typing in the search box, use "pressEnter" on the same element.
13. For <select> dropdown elements (showing "Select an option" or similar), use "select_option" with the value to select.
14. For radio buttons, click the specific radio option (e.g., click the element with text "Yes").
15. After filling ALL new fields in a modal step, always click the primary action button ("Next", "Continue", "Review", or "Submit").
${stuckHint}

AVAILABLE ACTIONS:
- click: Click an element. Requires elementId.
- type: Type text into an input. Requires elementId and value.
- clear_and_type: Clear existing text then type new text. Requires elementId and value.
- pressEnter: Press Enter key on an element. Requires elementId.
- select_option: Select an option from a <select> dropdown. Requires elementId and value (the option text to select).
- scroll: Scroll down to see more content.
- navigate: Go to a URL. Requires value (the URL).
- wait: Do nothing this turn.
- finish: Stop the agent (only when truly done).

Respond with ONLY a JSON object:
{"action": "...", "elementId": "...", "value": "...", "reasoning": "..."}`;

  if (settings.provider === 'anthropic') {
    return callAnthropic(prompt);
  } else if (settings.provider === 'gemini') {
    return callGemini(prompt);
  } else {
    return callOpenAICompat(prompt);
  }
}

async function callGemini(prompt) {
  const model = settings.model || 'gemini-3.1-flash-lite-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API Error: ${err}`);
  }

  const data = await res.json();
  const content = data.candidates[0].content.parts[0].text;
  
  try {
    return JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    throw new Error(`Failed to parse LLM response: ${content.substring(0, 200)}`);
  }
}

async function callAnthropic(prompt) {
  const baseUrl = settings.baseUrl || ANTHROPIC_DEFAULT_URL;
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API Error: ${err}`);
  }

  const data = await res.json();
  const content = data.content[0].text;
  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || [null, content];
  return JSON.parse(jsonMatch[1]);
}

async function callOpenAICompat(prompt) {
  const baseUrl = settings.baseUrl || OPENAI_DEFAULT_URL;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API Error: ${err}`);
  }

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ---- Tab Helpers ----

async function getDOMSnapshotFromActiveTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs.length) throw new Error('No LinkedIn tab found');
  
  const tab = tabs[0];
  const response = await chrome.tabs.sendMessage(tab.id, { action: 'build_snapshot' });
  return response.snapshot;
}

async function executeActionInActiveTab(decision) {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs.length) return;
  
  await chrome.tabs.sendMessage(tabs[0].id, { 
    action: 'execute_decision', 
    decision 
  });
}
