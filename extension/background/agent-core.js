// Core Agent Logic - Runs in Background Service Worker
// Handles state machine, LLM routing, and error recovery

// State
let agentState = 'IDLE'; // IDLE, NAVIGATING, SEARCHING, SCRAPING, APPLYING, DONE
let currentGoal = '';
let settings = {};
let stepCount = 0;
let lastActions = []; // Track last N actions for stuck detection
let recentPageSignatures = [];
let currentTaskId = null;
let currentTaskSource = 'extension';
let currentTaskChannel = 'extension_popup';
let currentAgentSessionId = null;
const MAX_STEPS = 50;
const MAX_REPEATS = 3; // If same action repeats this many times, skip it
const STAGNATION_WINDOW = 4;

// Constants
const API_URL = 'https://iapply-telegram-bot.onrender.com';
const ANTHROPIC_DEFAULT_URL = 'https://api.anthropic.com';
const OPENAI_DEFAULT_URL = 'https://api.openai.com';

function broadcastLog(message, isError = false) {
  console[isError ? 'error' : 'log']('[Agent]', message);
  chrome.runtime.sendMessage({ action: 'agent_log', message, isError }).catch(() => {});
}

async function getAuthHeaders() {
  const result = await chrome.storage.local.get(['supabase_token']);
  const token = result.supabase_token;
  if (!token) return null;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function updateTaskStatus(status) {
  if (!currentTaskId) return;
  const headers = await getAuthHeaders();
  if (!headers) return;

  fetch(`${API_URL}/usage/tasks/${currentTaskId}/status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status }),
  }).catch(() => {});
}

async function completeAutomationSession() {
  if (!currentAgentSessionId) return;
  const headers = await getAuthHeaders();
  if (!headers) return;

  fetch(`${API_URL}/extension/commands/${currentAgentSessionId}/complete`, {
    method: 'POST',
    headers,
  }).catch(() => {});
}

async function recordUsageToBackend({ provider, model, inputTokens, outputTokens, totalTokens, metadata = {} }) {
  const headers = await getAuthHeaders();
  if (!headers) return;

  fetch(`${API_URL}/usage/llm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      taskId: currentTaskId,
      source: currentTaskSource,
      channel: currentTaskChannel,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      metadata,
    }),
  }).catch(() => {});
}

export async function startAgent(config) {
  settings = config;
  agentState = 'NAVIGATING';
  stepCount = 0;
  recentPageSignatures = [];
  currentTaskId = config.taskId || null;
  currentTaskSource = config.source || 'extension';
  currentTaskChannel = config.channel || 'extension_popup';
  currentAgentSessionId = config.agentSessionId || null;
  currentGoal = config.userGoal?.trim()
    ? `User request: "${config.userGoal}". Execute this on LinkedIn Jobs using Easy Apply where possible. Primary search query: "${settings.searchQuery}".`
    : `Find and apply to "${settings.searchQuery}" jobs on LinkedIn using Easy Apply.`;
  
  broadcastLog(`Starting with config: ${settings.provider} / ${settings.model}`);
  if (settings.selectedResume) {
    broadcastLog(`Selected resume for "${settings.searchQuery}": ${settings.selectedResume.file_name}`);
  } else {
    broadcastLog(`No matching resume found — LinkedIn will use your profile default.`);
  }
  updateTaskStatus('running');
  
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
  recentPageSignatures = [];
  broadcastLog('Stopped by user.');
  updateTaskStatus('stopped');
  completeAutomationSession();
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
    updateTaskStatus('error');
    completeAutomationSession();
    chrome.runtime.sendMessage({ action: 'agent_error', error: 'Max steps reached' }).catch(() => {});
    return;
  }

  try {
    broadcastLog(`Step ${stepCount} | State: ${agentState}`);
    
    // 1. Get snapshot from Content Script (includes URL and title)
    broadcastLog('Building DOM Snapshot...');
    let snapshot = await getDOMSnapshotFromActiveTab();
    
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

    // Auto-select resume if we detect a resume step (hardcoded, no LLM needed)
    let resumeAutoSelectedHint = '';
    if (snapshot.rawText?.includes('RESUME_STEP_DETECTED')) {
      broadcastLog('Resume selection step detected — running auto-select...');
      const goalText = (settings.userGoal || settings.searchQuery || '').toLowerCase();
      const hintMatch = goalText.match(/\b(\w+)\s+resume\b/i);
      const resumeKeyword = hintMatch?.[1]?.toLowerCase() || null;
      const titleTokens = (settings.searchQuery || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);

      try {
        const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
        if (tabs.length) {
          const result = await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'auto_select_resume',
            resumeKeyword,
            titleTokens,
          });
          if (result?.changed) {
            broadcastLog(`Auto-selected resume: ${result.selectedName}`);
            // Rebuild snapshot to reflect the change
            const refreshed = await getDOMSnapshotFromActiveTab();
            if (refreshed) {
              snapshot = refreshed;
            }
            resumeAutoSelectedHint = `\n\nSYSTEM: Resume "${result.selectedName}" was just auto-selected. DO NOT click any other resume card. Simply click the "Next" or "Review" button now.`;
          } else {
            // Already correct or no match — tell LLM not to change it
            resumeAutoSelectedHint = `\n\nSYSTEM: Resume auto-selection has already run. The best matching resume is already checked. DO NOT click any resume card. Simply click the "Next" or "Review" button now.`;
          }
        }
      } catch (err) {
        broadcastLog(`Resume auto-select error: ${err.message}`, true);
      }
    }

    if (snapshot.rawText?.includes('FORM_VALIDATION_ERRORS:')) {
      const validationBlock = snapshot.rawText
        .split('FORM_VALIDATION_ERRORS:\n')[1]
        ?.split('\n\n')[0]
        ?.trim();
      if (validationBlock) {
        broadcastLog(`Visible validation issues:\n${validationBlock}`, true);
      }
    }

    updatePageSignature(snapshot);
    const pageIsStagnant = isPageStagnant();

    // 2. Stuck detection — check if LLM is repeating itself
    let stuckHint = '';
    let repeatedActionKey = '';
    let repeatedActionDetected = false;
    if (lastActions.length >= MAX_REPEATS) {
      const recent = lastActions.slice(-MAX_REPEATS);
      const allSame = recent.every(a => a === recent[0]);
      if (allSame) {
        repeatedActionDetected = true;
        repeatedActionKey = recent[0];
        stuckHint = `\n\nWARNING: You have repeated the EXACT SAME action "${recent[0]}" ${MAX_REPEATS} times in a row. The element is NOT responding to clicks. Try a DIFFERENT approach: use a different action type, interact with a different element, or scroll to find other elements. For <select> dropdowns, use "select_option" instead of "click".`;
        broadcastLog(`Stuck detected! Same action repeated ${MAX_REPEATS}x. Sending hint to LLM.`, true);
      }
    }

    if (pageIsStagnant) {
      stuckHint += '\n\nWARNING: The page appears unchanged for multiple steps. You MUST choose a different strategy now.';
      broadcastLog(`Stuck detected! Page unchanged for ${STAGNATION_WINDOW} steps. Triggering recovery strategy.`, true);
    }

    // 3. Ask LLM or auto-recover when stuck
    let decision = null;
    if (repeatedActionDetected || pageIsStagnant) {
      decision = chooseRecoveryDecision(snapshot, repeatedActionKey);
      if (decision) {
        broadcastLog(`Recovery Action: ${decision.action} → ${decision.elementId || 'N/A'} ${decision.value ? '(val: ' + decision.value + ')' : ''}`, true);
      }
    }

    if (!decision) {
      decision = await callLLM(snapshot, stuckHint + resumeAutoSelectedHint);
    }

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
      updateTaskStatus('completed');
      completeAutomationSession();
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
      updateTaskStatus('error');
      completeAutomationSession();
      chrome.runtime.sendMessage({ action: 'agent_error', error: error.message }).catch(() => {});
    }
  }
}

function updatePageSignature(snapshot) {
  const signature = JSON.stringify({
    url: snapshot.url,
    modalHint: (snapshot.rawText || '').substring(0, 280),
    elements: (snapshot.elements || []).slice(0, 25).map((e) => ({
      tag: e.tag,
      text: e.text,
      label: e.label,
      value: e.value,
      required: !!e.required,
      invalid: !!e.invalid
    }))
  });

  recentPageSignatures.push(signature);
  if (recentPageSignatures.length > 8) recentPageSignatures.shift();
}

function isPageStagnant() {
  if (recentPageSignatures.length < STAGNATION_WINDOW) return false;
  const recent = recentPageSignatures.slice(-STAGNATION_WINDOW);
  return recent.every((sig) => sig === recent[0]);
}

function isPrimaryProgressButton(el) {
  const text = (el?.text || '').toLowerCase();
  if (!text) return false;
  if (text.includes('back') || text.includes('dismiss') || text.includes('save draft')) return false;
  return text.includes('next') || text.includes('review') || text.includes('continue') || text.includes('submit');
}

function parseActionKey(actionKey) {
  if (!actionKey) return null;
  const firstColon = actionKey.indexOf(':');
  const lastColon = actionKey.lastIndexOf(':');
  if (firstColon === -1 || lastColon === -1 || firstColon === lastColon) return null;
  const action = actionKey.slice(0, firstColon);
  const elementId = actionKey.slice(firstColon + 1, lastColon);
  const value = actionKey.slice(lastColon + 1);
  return { action, elementId, value };
}

function isPlaceholderFieldValue(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return (
    !normalized ||
    normalized === 'select' ||
    normalized.includes('select an option') ||
    normalized.includes('choose an option') ||
    normalized.includes('please select')
  );
}

function hasMeaningfulFieldValue(element) {
  const combined = `${element?.value || ''} ${element?.text || ''}`.trim();
  return !isPlaceholderFieldValue(combined);
}

function isDropdownSnapshotElement(element) {
  return element?.tag === 'select' || element?.role === 'combobox';
}

function expectsNumericSnapshotValue(element) {
  const combined = `${element?.label || ''} ${element?.errorText || ''} ${element?.text || ''}`.toLowerCase();
  return (
    element?.type === 'number' ||
    combined.includes('decimal') ||
    combined.includes('numeric') ||
    combined.includes('number') ||
    combined.includes('ctc') ||
    combined.includes('salary') ||
    combined.includes('notice period') ||
    combined.includes('experience')
  );
}

function pickRecoveryValue(element) {
  const combined = `${element?.label || ''} ${element?.text || ''}`.toLowerCase();
  const numeric = expectsNumericSnapshotValue(element);

  if (combined.includes('expected ctc') || combined.includes('expected salary')) {
    return '300000';
  }
  if (combined.includes('current ctc') || combined.includes('current salary')) {
    return '200000';
  }
  if (combined.includes('notice period')) {
    return '1';
  }
  if (combined.includes('experience') || combined.includes('year')) {
    return numeric ? '3' : '3 years';
  }

  return numeric ? '1' : 'Yes';
}

function chooseRecoveryDecision(snapshot, repeatedActionKey = '') {
  const repeated = parseActionKey(repeatedActionKey);
  const elements = snapshot.elements || [];
  const progressButton = elements.find(isPrimaryProgressButton);

  // Priority 1: Click the progress button to force LinkedIn validation.
  // Pre-filled contact info fields (email, phone, country code) are often
  // marked invalid in the DOM before first submit. Clicking Next lets
  // LinkedIn re-validate and accept them, which is more reliable than
  // guessing what value to fill.
  if (progressButton) {
    const repeatedIsProgress = repeated && isPrimaryProgressButton(
      elements.find((e) => e.id === repeated.elementId)
    );
    if (!repeatedIsProgress) {
      return {
        action: 'click',
        elementId: progressButton.id,
        reasoning: 'Recovery mode: clicking progress button to trigger LinkedIn validation and move forward.'
      };
    }
  }

  // Priority 2: Clicking the progress button IS the stuck action, so
  // there is a real validation blocker. Fix the first truly empty field.
  const emptyRequiredField = elements.find((element) => {
    if (isPrimaryProgressButton(element)) return false;
    // Only fix fields that are genuinely empty — never overwrite existing values.
    if (element.invalid && hasMeaningfulFieldValue(element)) return false;
    return (element.required && !hasMeaningfulFieldValue(element)) ||
           (element.invalid && !hasMeaningfulFieldValue(element));
  });

  if (emptyRequiredField) {
    const label = emptyRequiredField.label || emptyRequiredField.text || emptyRequiredField.id;
    const reason = emptyRequiredField.errorText || 'required value missing';

    if (isDropdownSnapshotElement(emptyRequiredField)) {
      return {
        action: 'select_option',
        elementId: emptyRequiredField.id,
        value: pickRecoveryValue(emptyRequiredField),
        reasoning: `Recovery mode: empty required dropdown "${label}" (${reason}). Selecting a value.`
      };
    }

    if (emptyRequiredField.tag === 'input' || emptyRequiredField.tag === 'textarea') {
      return {
        action: emptyRequiredField.value ? 'clear_and_type' : 'type',
        elementId: emptyRequiredField.id,
        value: pickRecoveryValue(emptyRequiredField),
        reasoning: `Recovery mode: empty required field "${label}" (${reason}). Filling it.`
      };
    }

    return {
      action: 'click',
      elementId: emptyRequiredField.id,
      reasoning: `Recovery mode: interacting with unresolved control "${label}" (${reason}).`
    };
  }

  // Priority 3: No empty fields found but still stuck — force the progress button.
  if (progressButton) {
    return {
      action: 'click',
      elementId: progressButton.id,
      reasoning: 'Recovery mode: all fields appear filled. Forcing progress button.'
    };
  }

  // Priority 4: No progress button at all — scroll.
  return {
    action: 'scroll',
    reasoning: 'Recovery mode: scrolling to reveal new elements and break repetitive behavior.'
  };
}

// ---- LLM Provider Abstraction ----

async function callLLM(snapshot, stuckHint = '') {
  // Extract an explicit resume preference from the user's goal (e.g. "with my product resume" → "product").
  const goalText = (settings.userGoal || settings.searchQuery || '').toLowerCase();
  const resumeHintMatch = goalText.match(/\b(\w+)\s+resume\b/i);
  const resumeKeyword = resumeHintMatch?.[1]?.toLowerCase() || null;

  // Job-title tokens for fallback resume matching.
  const titleTokens = (settings.searchQuery || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const resumeContextLine = resumeKeyword
    ? `\nRESUME PREFERENCE: The user wants to use their "${resumeKeyword}" resume — when LinkedIn shows a resume list, pick the file whose name contains "${resumeKeyword}".`
    : '';

  const prompt = `You are an autonomous browser agent. You control a Chrome browser on LinkedIn.

YOUR GOAL: ${currentGoal}${resumeContextLine}

CURRENT PAGE:
- URL: ${snapshot.url}
- Title: ${snapshot.title}
- Page text (first 1500 chars): ${snapshot.rawText.substring(0, 1500)}

INTERACTIVE ELEMENTS ON PAGE (id, tag, text):
${snapshot.elements.map(e => `[${e.id}] <${e.tag}${e.type ? ' type=' + e.type : ''}${e.role ? ' role=' + e.role : ''}> "${e.text}"${e.label ? ' label="' + e.label + '"' : ''}${e.value ? ' value="' + e.value + '"' : ''}${e.checked === true ? ' checked=true' : e.checked === false ? ' checked=false' : ''}${e.required ? ' required=true' : ''}${e.invalid ? ' invalid=true' : ''}${e.errorText ? ' error="' + e.errorText + '"' : ''}`).join('\n')}

RULES:
1. If the page shows "No results found", click "Clear all filters" or change the search query.
2. If you see job listings, click on one that has "Easy Apply" in its text.
3. If you see an "Easy Apply" button on a job detail page, click it to start applying.
4. Inside an Easy Apply modal, fill form fields and click "Next", "Review", or "Submit application".
5. IMPORTANT: In the Easy Apply modal, only interact with elements that exist in the CURRENT SNAPSHOT. Do not try to answer questions from previous steps that are no longer visible.
6. IMPORTANT: If a modal section (like Education or Experience) is already filled in or requires no further input, simply click the "Review", "Next", or "Continue" button. EXCEPTION: If the page text contains "RESUME_STEP_DETECTED", you are on a resume step — do NOT click Next. Follow Rule 20 FIRST.
7. CRITICAL: NEVER repeat the exact same "type" or "clear_and_type" action on the same field twice in a row UNLESS the CURRENT SNAPSHOT still marks that field invalid or shows an error message for it. If the field's "value" in the CURRENT PAGE snapshot already shows your answer (e.g., value="10") and the field is not invalid, DO NOT type it again.
8. SUCCESS STATE: If you see "Your application was sent" or "Applied", you MUST click the "Done" button or the "Dismiss" / "Close" (X) button to close the modal. DO NOT try to answer anymore questions on this success screen.
9. After closing the success modal, look for the next job listing with "Easy Apply" and click it to start a new application.
10. You can use "navigate" action with a URL as value to go to a different page.
11. Do NOT declare "finish" unless you have exhaustively checked all pages and all jobs.
11. If an input field already has text but the prompt requires something else, use "clear_and_type" instead of "type".
12. To submit a search, after typing in the search box, use "pressEnter" on the same element.
13. For <select> dropdown elements (showing "Select an option" or similar), use "select_option" with the value to select.
14. For radio buttons, click the specific radio option (e.g., click the element with text "Yes").
15. After filling ALL new fields in a modal step, always click the primary action button ("Next", "Continue", "Review", or "Submit").
16. If CURRENT PAGE text contains "FORM_VALIDATION_ERRORS", do NOT click Review/Next/Submit until those specific fields are fixed. If it contains "RESUME_STEP_DETECTED", do NOT click Next until you have followed Rule 20.
17. If a field label or error mentions decimal, numeric, number, salary, CTC, notice period, or experience, enter digits only. Example: use "1" instead of "1 month".
18. HARD RULE: If you selected the same dropdown value 2+ times and the field now has a non-empty value without invalid=true, STOP selecting it again and click the step button (Next/Review/Continue/Submit).
19. HARD RULE: If the page appears unchanged after your previous action, you MUST switch strategy (different element, click progress button, or scroll). Never repeat the same action 3 times.
${resumeKeyword
  ? `20. RESUME SELECTION (HARD RULE — NEVER SKIP):
    When page text contains "RESUME_STEP_DETECTED", follow these steps IN ORDER:
    a) If you see a "Show N more resumes" or "Show more" button, click it NOW and STOP. Do nothing else this turn.
    b) After ALL resumes are visible: Look at every element with checked=true or checked=false. Find the one whose text/label contains "${resumeKeyword}".
    c) If the currently checked=true resume does NOT contain "${resumeKeyword}" in its name, click the one that DOES to switch selection.
    d) Only AFTER the correct resume shows checked=true, click "Next" / "Review".
    e) NEVER click Next while the wrong resume is selected.`
  : `20. RESUME SELECTION (HARD RULE — NEVER SKIP):
    When page text contains "RESUME_STEP_DETECTED", follow these steps IN ORDER:
    a) If you see a "Show N more resumes" or "Show more" button, click it NOW and STOP. Do nothing else this turn.
    b) After ALL resumes are visible: Look at every element with checked=true or checked=false. Find the one whose text/label best matches job title keywords [${titleTokens.join(', ')}].
    c) If the currently checked=true resume does NOT match the job title, click the better-matching one to switch selection.
    d) Only AFTER the correct resume shows checked=true, click "Next" / "Review".
    e) NEVER click Next while the wrong resume is selected.`
}
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
  const usage = data.usageMetadata;

  if (usage) {
    await recordUsageToBackend({
      provider: 'gemini',
      model,
      inputTokens: Number(usage.promptTokenCount || 0),
      outputTokens: Number(usage.candidatesTokenCount || 0),
      totalTokens: Number(usage.totalTokenCount || 0),
      metadata: {
        step: stepCount,
        goal: currentGoal,
      },
    });
  }
  
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
  const model = settings.model || 'claude-3-5-sonnet-20241022';
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
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
  const usage = data.usage;

  if (usage) {
    await recordUsageToBackend({
      provider: 'anthropic',
      model,
      inputTokens: Number(usage.input_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      totalTokens: Number((usage.input_tokens || 0) + (usage.output_tokens || 0)),
      metadata: {
        step: stepCount,
        goal: currentGoal,
      },
    });
  }

  const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || [null, content];
  return JSON.parse(jsonMatch[1]);
}

async function callOpenAICompat(prompt) {
  const baseUrl = settings.baseUrl || OPENAI_DEFAULT_URL;
  const model = settings.model || 'gpt-4o';
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API Error: ${err}`);
  }

  const data = await res.json();
  const usage = data.usage;

  if (usage) {
    await recordUsageToBackend({
      provider: 'openai',
      model,
      inputTokens: Number(usage.prompt_tokens || 0),
      outputTokens: Number(usage.completion_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0),
      metadata: {
        step: stepCount,
        goal: currentGoal,
      },
    });
  }

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
