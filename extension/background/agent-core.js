// Core Agent Logic - Runs in Background Service Worker
// Handles state machine, LLM routing, and error recovery

// State
let agentState = 'IDLE'; // IDLE, NAVIGATING, SEARCHING, SCRAPING, APPLYING, DONE
let currentGoal = '';
let settings = {};
let stepCount = 0;
let lastActions = []; // Track last N actions for stuck detection
let recentPageSignatures = [];
let agentTabId = null;
let currentTaskId = null;
let currentTaskSource = 'extension';
let currentTaskChannel = 'extension_popup';
let currentAgentSessionId = null;
let targetApplyCount = 10;
let appliedCount = 0;
let lastSuccessSignature = '';
let lastAutoDebugCaptureSignature = '';
let lastAutoDebugCaptureAt = 0;
let progressClickStreak = 0;
let validationSummaryStreak = 0;
let lastValidationSummaryKey = '';
let pendingProgressSnapshotSignature = '';
let progressNoAdvanceCount = 0;
let progressTransitionLock = null;
const MAX_STEPS = 50;
const MAX_REPEATS = 3; // If same action repeats this many times, skip it
const STAGNATION_WINDOW = 4;
const AUTO_DEBUG_CAPTURE_COOLDOWN_MS = 60000;
const PROGRESS_TRANSITION_LOCK_TIMEOUT_MS = 12000;

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
  agentTabId = null;
  currentTaskId = config.taskId || null;
  currentTaskSource = config.source || 'extension';
  currentTaskChannel = config.channel || 'extension_popup';
  currentAgentSessionId = config.agentSessionId || null;
  targetApplyCount = Math.min(Math.max(Number(config.count) || 10, 1), 100);
  appliedCount = 0;
  lastSuccessSignature = '';
  lastAutoDebugCaptureSignature = '';
  lastAutoDebugCaptureAt = 0;
  progressClickStreak = 0;
  validationSummaryStreak = 0;
  lastValidationSummaryKey = '';
  pendingProgressSnapshotSignature = '';
  progressNoAdvanceCount = 0;
  progressTransitionLock = null;

  broadcastLog(`Starting with config: ${settings.provider} / ${settings.model}`);
  if (settings.selectedResume) {
    broadcastLog(`Selected resume for "${settings.searchQuery}": ${settings.selectedResume.file_name}`);
  } else {
    broadcastLog(`No matching resume found — LinkedIn will use your profile default.`);
  }
  updateTaskStatus('running');

  const isOutreach = settings.mode === 'post_outreach';

  if (isOutreach) {
    const primaryTerm = settings.postTitle || settings.relatedKeywords || 'software';
    currentGoal = `Scroll through the LinkedIn feed continuously. For every post, read its description text. Only engage with posts whose description contains the title "${primaryTerm}" OR any of these keywords: "${[settings.postTitle, settings.relatedKeywords].filter(Boolean).join(', ')}". If a matching post asks users to comment "interested", comment "interested", or asks for gmail/email, post the configured outreach email "${settings.outreachEmail || ''}" when available. If no outreach email is configured, comment "Interested. Please check DM." Then continue to more posts. Do NOT apply for jobs.`;

    const feedUrl = `https://www.linkedin.com/feed/`;
    broadcastLog(`[Post Outreach] Navigating to LinkedIn feed to scroll and match posts...`);
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    let tab;
    if (tabs.length > 0) {
      const preferred = tabs.find((t) => t.active) || tabs[0];
      tab = await chrome.tabs.update(preferred.id, { url: feedUrl });
    } else {
      tab = await chrome.tabs.create({ url: feedUrl });
    }
    agentTabId = tab?.id || null;
  } else {
    const timeLabel = { r86400: 'past 24 hours', r604800: 'past week', r2592000: 'past month' }[settings.jobPostedTime] || 'any time';
    currentGoal = `Find and apply to "${settings.searchQuery}" jobs on LinkedIn using Easy Apply (posted: ${timeLabel}).`;
    broadcastLog(`Target applications for this run: ${targetApplyCount}`);

    // Build job search URL — add f_TPR time filter if selected
    let searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(settings.searchQuery)}&f_AL=true`;
    if (settings.jobPostedTime) searchUrl += `&f_TPR=${settings.jobPostedTime}`;
    broadcastLog(`Navigating to LinkedIn Jobs search (posted: ${timeLabel})...`);
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    let tab;
    if (tabs.length > 0) {
      const preferred = tabs.find((t) => t.active) || tabs[0];
      tab = await chrome.tabs.update(preferred.id, { url: searchUrl });
    } else {
      tab = await chrome.tabs.create({ url: searchUrl });
    }
    agentTabId = tab?.id || null;
  }

  await setAgentTabAutoDiscardable(false);
  broadcastLog(`Starting with config: ${settings.provider} / ${settings.model} | Mode: ${settings.mode || 'job_apply'}`);
  // Wait for page to load before starting loop
  setTimeout(runAgentLoop, 5000);
}

export function stopAgent() {
  agentState = 'IDLE';
  lastActions = [];
  recentPageSignatures = [];
  setAgentTabAutoDiscardable(true).catch(() => {});
  agentTabId = null;
  appliedCount = 0;
  lastSuccessSignature = '';
  lastAutoDebugCaptureSignature = '';
  lastAutoDebugCaptureAt = 0;
  progressClickStreak = 0;
  validationSummaryStreak = 0;
  lastValidationSummaryKey = '';
  pendingProgressSnapshotSignature = '';
  progressNoAdvanceCount = 0;
  progressTransitionLock = null;
  broadcastLog('Stopped by user.');
  updateTaskStatus('stopped');
  completeAutomationSession();
  chrome.runtime.sendMessage({ action: 'agent_stopped' }).catch(() => {});
}

export function getAgentStatus() {
  return {
    state: agentState,
    goal: currentGoal,
    step: stepCount,
    tabId: agentTabId,
    targetApplyCount,
    appliedCount
  };
}

async function runAgentLoop() {
  if (agentState === 'IDLE') return;
  
  stepCount++;
  const isOutreach = settings.mode === 'post_outreach';
  if (!isOutreach && stepCount > MAX_STEPS) {
    broadcastLog('Max steps reached. Stopping.', true);
    agentState = 'IDLE';
    await setAgentTabAutoDiscardable(true);
    agentTabId = null;
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

    if (!isOutreach) {
      const successSignal = hasApplicationSuccessSignal(snapshot.rawText);
      if (successSignal) {
        const signature = buildApplicationSuccessSignature(snapshot);
        if (signature && signature !== lastSuccessSignature) {
          lastSuccessSignature = signature;
          appliedCount += 1;
          const company = extractAppliedCompany(snapshot.rawText);
          broadcastLog(`✅ Applied${company ? ` to ${company}` : ''}. Progress ${appliedCount}/${targetApplyCount}.`);

          if (appliedCount >= targetApplyCount) {
            agentState = 'DONE';
            await setAgentTabAutoDiscardable(true);
            agentTabId = null;
            broadcastLog(`Target reached (${appliedCount}/${targetApplyCount}). Finishing run.`);
            updateTaskStatus('completed');
            completeAutomationSession();
            chrome.runtime.sendMessage({ action: 'agent_finished' }).catch(() => {});
            return;
          }
        }
      } else {
        lastSuccessSignature = '';
      }
    }

    broadcastLog(`Page: ${snapshot.url} | ${snapshot.elements.length} elements`);

    // Auto-select resume if we detect a resume step (hardcoded, no LLM needed)
    let resumeAutoSelectedHint = '';
    let resumeSelectionCommitted = true;
    if (snapshot.rawText?.includes('RESUME_STEP_DETECTED')) {
      broadcastLog('Resume selection step detected — running auto-select...');
      const goalText = (settings.userGoal || settings.searchQuery || '').toLowerCase();
      const hintMatch = goalText.match(/\b(\w+)\s+resume\b/i);
      const resumeKeyword = hintMatch?.[1]?.toLowerCase() || null;
      const titleTokens = (settings.searchQuery || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
      const preferredResumeName = settings?.selectedResume?.file_name || '';

      try {
        const result = await sendMessageToAgentTab({
          action: 'auto_select_resume',
          preferredResumeName,
          resumeKeyword,
          titleTokens,
        });
        resumeSelectionCommitted = Boolean(result?.selectionCommitted);
        if (result?.changed) {
          broadcastLog(`Auto-selected resume: ${result.selectedName}`);
          // Rebuild snapshot to reflect the change
          const refreshed = await getDOMSnapshotFromActiveTab();
          if (refreshed) {
            snapshot = refreshed;
          }
          resumeAutoSelectedHint = `\n\nSYSTEM: Resume "${result.selectedName}" was auto-selected and committed. DO NOT click any other resume card. Click "Next" or "Review".`;
        } else if (resumeSelectionCommitted) {
          const selectedName = result?.selectedName || preferredResumeName || 'current resume';
          resumeAutoSelectedHint = `\n\nSYSTEM: Resume selection is already committed ("${selectedName}"). DO NOT click any resume card. Click "Next" or "Review".`;
        } else {
          const reason = result?.reason || 'selection not confirmed';
          broadcastLog(`Resume selection not confirmed: ${reason}. Blocking progress until resume is committed.`, true);
          resumeAutoSelectedHint = `\n\nSYSTEM: Resume selection is NOT confirmed (${reason}). DO NOT click Next/Review yet. First select and commit the correct resume card.`;
        }
      } catch (err) {
        resumeSelectionCommitted = false;
        broadcastLog(`Resume auto-select error: ${err.message}`, true);
        resumeAutoSelectedHint = '\n\nSYSTEM: Resume auto-selection failed. Do NOT click Next/Review until resume selection is confirmed.';
      }
    }

    if (snapshot.rawText?.includes('FORM_VALIDATION_ERRORS:')) {
      const validationBlock = snapshot.rawText
        .split('FORM_VALIDATION_ERRORS:\n')[1]
        ?.split('\n\n')[0]
        ?.trim();
      if (validationBlock) {
        broadcastLog(`Visible validation issues:\n${validationBlock}`, true);
        broadcastLog('Attempting deterministic validation recovery before asking the LLM...', true);
        const fixResult = await triggerValidationRecovery();
        if (fixResult) {
          const details = Array.isArray(fixResult.details) && fixResult.details.length
            ? ` ${fixResult.details.join(' | ')}`
            : '';
          broadcastLog(
            `Validation recovery applied ${fixResult.fixed || 0} fix(es); ${fixResult.remaining || 0} issue(s) remain.${details}`,
            (fixResult.remaining || 0) > 0,
          );
          const refreshed = await getDOMSnapshotFromActiveTab();
          if (refreshed) {
            snapshot = refreshed;
            broadcastLog(`Snapshot refreshed after validation recovery: ${snapshot.url} | ${snapshot.elements.length} elements`);
          }
        } else {
          broadcastLog('Validation recovery could not run on the LinkedIn tab.', true);
        }
      }
    }

    const validationSummary = !isOutreach ? getValidationSummaryFromRawText(snapshot.rawText) : '';
    const currentProgressStepSignature = !isOutreach ? buildProgressStepSignature(snapshot, validationSummary) : '';
    if (!isOutreach) {
      updateValidationSummaryStreak(validationSummary);
      if (pendingProgressSnapshotSignature) {
        if (currentProgressStepSignature === pendingProgressSnapshotSignature) {
          progressNoAdvanceCount += 1;
        } else {
          progressNoAdvanceCount = 0;
        }
        pendingProgressSnapshotSignature = '';
      }

      if (progressTransitionLock?.active) {
        const changed = progressTransitionLock.signature !== currentProgressStepSignature;
        const expired = Date.now() - progressTransitionLock.startedAt > PROGRESS_TRANSITION_LOCK_TIMEOUT_MS;
        if (changed) {
          broadcastLog('Progress transition acknowledged. Allowing next progress click.');
          progressTransitionLock = null;
        } else if (expired) {
          broadcastLog('Progress transition lock timed out. Allowing retry on progress button.', true);
          progressTransitionLock = null;
        }
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

    let debugImageDataUrl = '';
    if (!isOutreach) {
      const shouldCaptureForRepeatedProgress = repeatedActionDetected && isRepeatedProgressAction(snapshot, repeatedActionKey);
      const shouldCaptureForStagnantValidation = pageIsStagnant && Boolean(validationSummary);
      const shouldCaptureForProgressStreak = progressClickStreak >= 2;
      const shouldCaptureForValidationStreak = validationSummaryStreak >= 2 && Boolean(validationSummary);
      const shouldCaptureForResumeRequiredError = /resume is required/i.test(String(snapshot.rawText || ''));
      const shouldCaptureForNoAdvanceProgress = progressNoAdvanceCount >= 3;
      if (
        shouldCaptureForRepeatedProgress ||
        shouldCaptureForStagnantValidation ||
        shouldCaptureForProgressStreak ||
        shouldCaptureForValidationStreak ||
        shouldCaptureForResumeRequiredError ||
        shouldCaptureForNoAdvanceProgress
      ) {
        if (shouldCaptureForNoAdvanceProgress) {
          broadcastLog(`Progress stuck detected: Next/Review attempted ${progressNoAdvanceCount}x without moving forward.`, true);
        }
        const captureReason = shouldCaptureForResumeRequiredError
          ? 'resume required validation stuck'
          : shouldCaptureForNoAdvanceProgress
            ? `next/review clicked ${progressNoAdvanceCount}x without forward movement`
          : shouldCaptureForValidationStreak
            ? 'repeated validation errors'
            : shouldCaptureForProgressStreak
              ? 'repeated progress attempts'
              : 'stuck on Review/Next';
        const captureResult = await maybeCaptureAutoDebugSnapshot(snapshot, repeatedActionKey, validationSummary, captureReason);
        if (captureResult?.imageDataUrl) {
          debugImageDataUrl = captureResult.imageDataUrl;
          broadcastLog(`Auto debug screenshot captured (${captureResult.source || 'live'}).`);
          broadcastLog(`DEBUG_IMAGE_READY: sending screenshot to ${settings.provider || 'llm'} (${settings.model || 'default model'}).`);
          stuckHint += '\n\nDEBUG: A fresh screenshot of the current stuck modal is attached. Inspect the red validation error and choose the action that fixes that exact field before clicking Review/Next.';
        } else {
          broadcastLog('Auto debug capture attempted but no frame was available.', true);
        }
        if (validationSummary) {
          stuckHint += `\n\nDEBUG_VALIDATION_SUMMARY: ${validationSummary}`;
        }
      }
    }

    // 3. Ask LLM or auto-recover when stuck
    let decision = null;
    const shouldAskLLMWithDebug = Boolean(debugImageDataUrl);
    if ((repeatedActionDetected || pageIsStagnant) && !shouldAskLLMWithDebug) {
      decision = chooseRecoveryDecision(snapshot, repeatedActionKey);
      if (decision) {
        broadcastLog(`Recovery Action: ${decision.action} → ${decision.elementId || 'N/A'} ${decision.value ? '(val: ' + decision.value + ')' : ''}`, true);
      }
    }

    if (!decision) {
      decision = await callLLM(snapshot, stuckHint + resumeAutoSelectedHint, debugImageDataUrl);
    }

    if (debugImageDataUrl) {
      broadcastLog(`DEBUG_IMAGE_USED: LLM decision was requested with screenshot context.`);
    }

    broadcastLog(`LLM: ${decision.reasoning}`);
    broadcastLog(`Action: ${decision.action} → ${decision.elementId || 'N/A'} ${decision.value ? '(val: ' + decision.value + ')' : ''}`);

    if (isProgressClickDecision(decision, snapshot)) {
      progressClickStreak += 1;
      pendingProgressSnapshotSignature = buildProgressStepSignature(snapshot, validationSummary);
    } else if (decision.action !== 'wait') {
      progressClickStreak = 0;
      pendingProgressSnapshotSignature = '';
      progressNoAdvanceCount = 0;
    }
    
    // Track action for stuck detection
    const actionKey = `${decision.action}:${decision.elementId}:${decision.value}`;
    lastActions.push(actionKey);
    if (lastActions.length > 10) lastActions.shift();

    // 4. Execute Action
    if (decision.action === 'navigate') {
      const targetUrl = decision.value || '';
      // Guard: in post outreach mode, never navigate to the jobs section
      if (settings.mode === 'post_outreach' && /linkedin\.com\/jobs[\/?]/i.test(targetUrl)) {
        broadcastLog(`[Post Outreach] Blocked navigation to jobs section: ${targetUrl}`, true);
        setTimeout(runAgentLoop, 2000);
        return;
      }
      broadcastLog(`Navigating to: ${targetUrl}`);
      let tab = null;
      if (agentTabId) {
        try {
          tab = await chrome.tabs.get(agentTabId);
        } catch (_error) {
          tab = null;
        }
      }

      if (!tab) {
        tab = await resolveAgentTab();
      }

      if (tab) {
        const updatedTab = await chrome.tabs.update(tab.id, { url: targetUrl });
        agentTabId = updatedTab?.id || tab.id;
      } else {
        const createdTab = await chrome.tabs.create({ url: targetUrl });
        agentTabId = createdTab?.id || null;
      }
      await setAgentTabAutoDiscardable(false);
      setTimeout(runAgentLoop, 5000);
      return;
    }
    
    if (decision.action === 'finish') {
      agentState = 'DONE';
      await setAgentTabAutoDiscardable(true);
      agentTabId = null;
      broadcastLog('Agent finished!');
      updateTaskStatus('completed');
      completeAutomationSession();
      chrome.runtime.sendMessage({ action: 'agent_finished' }).catch(() => {});
      return;
    }

    if (decision.action !== 'wait') {
      const isProgressDecision = !isOutreach && isProgressClickDecision(decision, snapshot);

      if (
        isProgressDecision &&
        progressTransitionLock?.active &&
        progressTransitionLock.signature === currentProgressStepSignature
      ) {
        progressClickStreak = Math.max(0, progressClickStreak - 1);
        pendingProgressSnapshotSignature = '';
        if (lastActions.length > 0) {
          lastActions.pop();
        }
        progressNoAdvanceCount += 1;
        broadcastLog(
          `Progress lock active: waiting for step transition before another "${decision.action}" on Next/Review. Blocked attempt ${progressNoAdvanceCount}.`,
          true,
        );
        setTimeout(runAgentLoop, 1200);
        return;
      }

      if (!isOutreach && !resumeSelectionCommitted && isProgressClickDecision(decision, snapshot)) {
        broadcastLog('Blocked progress button click because resume selection is not committed yet. Retrying resume step.', true);
        setTimeout(runAgentLoop, 1500);
        return;
      }

      // Guard: in post outreach mode, skip any click on Easy Apply or job-apply elements
      if (settings.mode === 'post_outreach') {
        const blockedText = /easy apply|apply now|submit application/i;
        if (decision.action === 'click' && blockedText.test(decision.reasoning || '')) {
          broadcastLog(`[Post Outreach] Blocked click on job-apply element. Skipping.`, true);
          setTimeout(runAgentLoop, 2000);
          return;
        }
        // Also check element value/text from snapshot
        const clickedEl = snapshot.elements.find(e => e.id === decision.elementId);
        if (decision.action === 'click' && clickedEl && blockedText.test(clickedEl.text || '')) {
          broadcastLog(`[Post Outreach] Blocked click on "${clickedEl.text}". Skipping.`, true);
          setTimeout(runAgentLoop, 2000);
          return;
        }
      }
      await executeActionInActiveTab(decision);

      if (isProgressDecision) {
        progressTransitionLock = {
          active: true,
          signature: currentProgressStepSignature,
          startedAt: Date.now(),
        };
      } else {
        progressTransitionLock = null;
      }
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
      await setAgentTabAutoDiscardable(true);
      agentTabId = null;
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

function hasApplicationSuccessSignal(rawText = '') {
  const text = String(rawText || '').toLowerCase();
  return (
    text.includes('your application was sent') ||
    text.includes('application was sent') ||
    text.includes('application submitted') ||
    text.includes('your application has been submitted') ||
    text.includes('you have successfully applied') ||
    text.includes('successfully applied to')
  );
}

function extractAppliedCompany(rawText = '') {
  const text = String(rawText || '');
  const patterns = [
    /your application was sent(?:\s+to)?\s+([^\n.]+)/i,
    /your application has been submitted(?:\s+to)?\s+([^\n.]+)/i,
    /application submitted(?:\s+to)?\s+([^\n.]+)/i,
    /successfully applied(?:\s+to)?\s+([^\n.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, ' ').trim();
    }
  }

  const applyToMatch = text.match(/apply to\s+([^\n]+)/i);
  if (applyToMatch?.[1]) {
    return applyToMatch[1].replace(/\s+/g, ' ').trim();
  }

  return '';
}

function buildApplicationSuccessSignature(snapshot) {
  const company = extractAppliedCompany(snapshot?.rawText || '');
  const markerMatch = String(snapshot?.rawText || '').match(
    /(your application was sent[^\n]*|your application has been submitted[^\n]*|application submitted[^\n]*|successfully applied[^\n]*)/i
  );
  const marker = markerMatch?.[0]?.trim() || '';
  return `${snapshot?.url || ''}|${company}|${marker}`.trim();
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

function isRepeatedProgressAction(snapshot, actionKey) {
  const parsed = parseActionKey(actionKey);
  if (!parsed || parsed.action !== 'click') return false;
  const target = (snapshot?.elements || []).find((el) => el.id === parsed.elementId);
  return isPrimaryProgressButton(target);
}

function isProgressClickDecision(decision, snapshot) {
  if (decision?.action !== 'click') return false;
  const target = (snapshot?.elements || []).find((el) => el.id === decision.elementId);
  return isPrimaryProgressButton(target);
}

function getValidationSummaryFromRawText(rawText = '') {
  const block = String(rawText || '')
    .split('FORM_VALIDATION_ERRORS:\n')[1]
    ?.split('\n\n')[0]
    ?.trim();
  if (!block) return '';
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ');
}

function buildProgressStepSignature(snapshot, validationSummary = '') {
  const raw = String(snapshot?.rawText || '').replace(/\s+/g, ' ').toLowerCase();
  const progressMatch = raw.match(/(\d{1,3})\s*%/);
  const progressMarker = progressMatch?.[1] || '';
  const resumeBlock = raw.split('resume_step_detected:')[1]?.split('form_validation_errors:')[0] || '';
  const modalPreview = raw.slice(0, 420);
  const dominantSection =
    /contact info|additional questions|resume|work experience|education|privacy policy|review your application|application questions/.exec(raw)?.[0] || '';
  const validation = String(validationSummary || '').toLowerCase();
  const resumePreview = resumeBlock.slice(0, 450);
  return `${snapshot?.url || ''}|${progressMarker}|${dominantSection}|${validation}|${resumePreview || modalPreview}`;
}

function updateValidationSummaryStreak(validationSummary = '') {
  const key = String(validationSummary || '').trim();
  if (!key) {
    lastValidationSummaryKey = '';
    validationSummaryStreak = 0;
    return 0;
  }

  if (key === lastValidationSummaryKey) {
    validationSummaryStreak += 1;
  } else {
    lastValidationSummaryKey = key;
    validationSummaryStreak = 1;
  }

  return validationSummaryStreak;
}

function buildAutoDebugCaptureSignature(snapshot, repeatedActionKey, validationSummary) {
  const raw = `${snapshot?.url || ''}|${repeatedActionKey || ''}|${validationSummary || ''}`;
  return raw.slice(0, 500);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function maybeCaptureAutoDebugSnapshot(snapshot, repeatedActionKey, validationSummary = '', reason = 'stuck loop') {
  const signature = buildAutoDebugCaptureSignature(snapshot, repeatedActionKey, validationSummary);
  const now = Date.now();
  if (
    signature &&
    signature === lastAutoDebugCaptureSignature &&
    now - lastAutoDebugCaptureAt < AUTO_DEBUG_CAPTURE_COOLDOWN_MS
  ) {
    return null;
  }

  try {
    const response = await sendRuntimeMessage({
      action: 'agent_debug_capture',
      reason,
      validationSummary,
      url: snapshot?.url || '',
    });

    if (response?.success) {
      lastAutoDebugCaptureSignature = signature;
      lastAutoDebugCaptureAt = now;
      return response;
    }

    return null;
  } catch (error) {
    broadcastLog(`Auto debug capture failed: ${error.message}`, true);
    return null;
  }
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
    combined.includes('compensation') ||
    combined.includes('pay') ||
    combined.includes('package') ||
    combined.includes('remuneration') ||
    combined.includes('ctc') ||
    combined.includes('salary') ||
    combined.includes('notice period') ||
    combined.includes('experience')
  );
}

function hasNumericToken(value) {
  return /-?\d+(?:\.\d+)?/.test(String(value || ''));
}

function shouldOverwriteInvalidFilledField(element) {
  if (!element?.invalid) return false;
  const combinedValue = `${element?.value || ''} ${element?.text || ''}`.trim();
  if (!combinedValue) return true;

  // If field expects a number but has non-numeric value (e.g. "Yes"), force overwrite.
  if (expectsNumericSnapshotValue(element)) {
    return !hasNumericToken(combinedValue);
  }

  return false;
}

function pickRecoveryValue(element) {
  const combined = `${element?.label || ''} ${element?.text || ''}`.toLowerCase();
  const numeric = expectsNumericSnapshotValue(element);

  if (combined.includes('expected compensation') || combined.includes('expected package')) {
    return '300000';
  }
  if (combined.includes('current compensation') || combined.includes('current package')) {
    return '200000';
  }
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

  return numeric ? '1' : 'No';
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
    // Keep prefilled valid-looking values, but overwrite clearly invalid values
    // when they don't match expected numeric format.
    if (element.invalid && hasMeaningfulFieldValue(element) && !shouldOverwriteInvalidFilledField(element)) return false;
    return (element.required && !hasMeaningfulFieldValue(element)) ||
           element.invalid;
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

async function callLLM(snapshot, stuckHint = '', debugImageDataUrl = '') {
  // Extract an explicit resume preference from the user's goal (e.g. "with my product resume" → "product").
  const goalText = (settings.userGoal || settings.searchQuery || '').toLowerCase();
  const resumeHintMatch = goalText.match(/\b(\w+)\s+resume\b/i);
  const resumeKeyword = resumeHintMatch?.[1]?.toLowerCase() || null;
  const preferredResumeName = settings?.selectedResume?.file_name || '';

  // Job-title tokens for fallback resume matching.
  const titleTokens = (settings.searchQuery || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const resumeContextLine = preferredResumeName
    ? `\nRESUME PREFERENCE: Use this exact resume file when available: "${preferredResumeName}".`
    : resumeKeyword
      ? `\nRESUME PREFERENCE: The user wants to use their "${resumeKeyword}" resume — when LinkedIn shows a resume list, pick the file whose name contains "${resumeKeyword}".`
      : '';

  const pageTextLimit = settings.mode === 'post_outreach' ? 3000 : 1500;
  const pageTextPreview = snapshot.rawText.substring(0, pageTextLimit);
  const interactiveElementsText = snapshot.elements
    .map((e) => `[${e.id}] <${e.tag}${e.type ? ' type=' + e.type : ''}${e.role ? ' role=' + e.role : ''}> "${e.text}"${e.label ? ' label="' + e.label + '"' : ''}${e.value ? ' value="' + e.value + '"' : ''}${e.checked === true ? ' checked=true' : e.checked === false ? ' checked=false' : ''}${e.required ? ' required=true' : ''}${e.invalid ? ' invalid=true' : ''}${e.errorText ? ' error="' + e.errorText + '"' : ''}`)
    .join('\n');

  const outreachRules = [
    '⚠️  MODE: POST OUTREACH — Scroll the LinkedIn feed, read post descriptions, and engage only with posts that match the target keywords.',
    '',
    `TARGET TITLE (primary): "${settings.postTitle || ''}"`,
    `TARGET KEYWORDS (secondary): "${settings.relatedKeywords || ''}"`,
    '',
    'POST OUTREACH RULES (STRICTLY FOLLOW):',
    'PO-1. NEVER navigate to any URL containing "/jobs/" — the LinkedIn Jobs section is completely OFF-LIMITS.',
    'PO-2. NEVER click any button labelled "Easy Apply", "Apply", "Apply now", or "Submit application".',
    'PO-3. NEVER open or fill any job application form or modal.',
    'PO-4. If you land on the jobs section by mistake, immediately navigate back to: https://www.linkedin.com/feed/',
    'PO-5. If you see a post with an embedded job link, IGNORE that link entirely. Do not click it.',
    'PO-6. READING POSTS: Look at each post\'s visible text in the page content above. Read the description of every post carefully.',
    `PO-7. KEYWORD MATCHING: A post is RELEVANT if its description contains the target title "${settings.postTitle || ''}" OR any of these keywords: "${settings.relatedKeywords || ''}". Match is case-insensitive.`,
    'PO-8. RELEVANT POST → ENGAGE: If a post is relevant, do ONE of these actions:',
    '   a) Click the "Like" button on that post, OR',
    '   b) Click the "Comment" button and type a short, genuine comment using one of the keywords naturally, OR',
    '   c) Click "Connect" or "Follow" on the post author.',
    'PO-9. SPECIAL COMMENT INSTRUCTIONS: If a relevant post explicitly says "comment interested", then comment exactly "Interested".',
    'PO-10. SPECIAL EMAIL INSTRUCTIONS: If a relevant post asks users to comment "gmail" or "email", then:',
    `  a) If outreach email is configured (${settings.outreachEmail || 'not configured'}), comment with that email.`,
    '  b) If outreach email is NOT configured, comment: "Interested. Please check DM."',
    'PO-11. NON-RELEVANT POST → SKIP: If a post does NOT match the keywords, do NOT engage. Use "scroll" to move to the next post.',
    'PO-12. After engaging with a post (or skipping it), always use "scroll" to move further down the feed and find the next post.',
    'PO-13. Keep scrolling and repeating this read -> match -> engage/skip loop continuously until user stops the agent.',
  ].join('\n');

  const resumeRule = preferredResumeName
    ? [
        '20. RESUME SELECTION (HARD RULE — NEVER SKIP):',
        '    When page text contains "RESUME_STEP_DETECTED", follow these steps IN ORDER:',
        '    a) If you see a "Show N more resumes" or "Show more" button, click it NOW and STOP. Do nothing else this turn.',
        `    b) After ALL resumes are visible: Find the resume whose filename best matches "${preferredResumeName}".`,
        `    c) If the currently checked=true resume is not "${preferredResumeName}", switch to the matching one.`,
        '    d) Only AFTER the correct resume shows checked=true, click "Next" / "Review".',
        '    e) NEVER click Next while the wrong resume is selected.',
      ].join('\n')
    : resumeKeyword
    ? [
        '20. RESUME SELECTION (HARD RULE — NEVER SKIP):',
        '    When page text contains "RESUME_STEP_DETECTED", follow these steps IN ORDER:',
        '    a) If you see a "Show N more resumes" or "Show more" button, click it NOW and STOP. Do nothing else this turn.',
        `    b) After ALL resumes are visible: Look at every element with checked=true or checked=false. Find the one whose text/label contains "${resumeKeyword}".`,
        `    c) If the currently checked=true resume does NOT contain "${resumeKeyword}" in its name, click the one that DOES to switch selection.`,
        '    d) Only AFTER the correct resume shows checked=true, click "Next" / "Review".',
        '    e) NEVER click Next while the wrong resume is selected.',
      ].join('\n')
    : [
        '20. RESUME SELECTION (HARD RULE — NEVER SKIP):',
        '    When page text contains "RESUME_STEP_DETECTED", follow these steps IN ORDER:',
        '    a) If you see a "Show N more resumes" or "Show more" button, click it NOW and STOP. Do nothing else this turn.',
        `    b) After ALL resumes are visible: Look at every element with checked=true or checked=false. Find the one whose text/label best matches job title keywords [${titleTokens.join(', ')}].`,
        '    c) If the currently checked=true resume does NOT match the job title, click the better-matching one to switch selection.',
        '    d) Only AFTER the correct resume shows checked=true, click "Next" / "Review".',
        '    e) NEVER click Next while the wrong resume is selected.',
      ].join('\n');

  const jobApplyRules = [
    '1. If the page shows "No results found", click "Clear all filters" or change the search query.',
    '2. If you see job listings, click on one that has "Easy Apply" in its text.',
    '3. If you see an "Easy Apply" button on a job detail page, click it to start applying.',
    '4. Inside an Easy Apply modal, fill form fields and click "Next", "Review", or "Submit application".',
    '5. IMPORTANT: In the Easy Apply modal, only interact with elements that exist in the CURRENT SNAPSHOT. Do not try to answer questions from previous steps that are no longer visible.',
    '6. IMPORTANT: If a modal section (like Education or Experience) is already filled in or requires no further input, simply click the "Review", "Next", or "Continue" button. EXCEPTION: If the page text contains "RESUME_STEP_DETECTED", you are on a resume step — do NOT click Next. Follow Rule 20 FIRST.',
    '7. CRITICAL: NEVER repeat the exact same "type" or "clear_and_type" action on the same field twice in a row UNLESS the CURRENT SNAPSHOT still marks that field invalid or shows an error message for it. If the field\'s "value" in the CURRENT PAGE snapshot already shows your answer (e.g., value="10") and the field is not invalid, DO NOT type it again.',
    '8. SUCCESS STATE: If you see "Your application was sent" or "Applied", you MUST click the "Done" button or the "Dismiss" / "Close" (X) button to close the modal. DO NOT try to answer anymore questions on this success screen.',
    '9. After closing the success modal, look for the next job listing with "Easy Apply" and click it to start a new application.',
    '10. You can use "navigate" action with a URL as value to go to a different page.',
    '11. Do NOT declare "finish" unless you have exhaustively checked all pages and all jobs.',
    '11. If an input field already has text but the prompt requires something else, use "clear_and_type" instead of "type".',
    '12. To submit a search, after typing in the search box, use "pressEnter" on the same element.',
    '13. For <select> dropdown elements (showing "Select an option" or similar), use "select_option" with the value to select.',
    '14. For radio buttons, click the specific radio option (e.g., click the element with text "Yes").',
    '15. After filling ALL new fields in a modal step, always click the primary action button ("Next", "Continue", "Review", or "Submit").',
    '16. If CURRENT PAGE text contains "FORM_VALIDATION_ERRORS", do NOT click Review/Next/Submit until those specific fields are fixed. If it contains "RESUME_STEP_DETECTED", do NOT click Next until you have followed Rule 20.',
    '17. If a field label or error mentions decimal, numeric, number, salary, CTC, notice period, or experience, enter digits only. Example: use "1" instead of "1 month".',
    '18. HARD RULE: If you selected the same dropdown value 2+ times and the field now has a non-empty value without invalid=true, STOP selecting it again and click the step button (Next/Review/Continue/Submit).',
    '19. HARD RULE: If the page appears unchanged after your previous action, you MUST switch strategy (different element, click progress button, or scroll). Never repeat the same action 3 times.',
    resumeRule,
    `21. STOP CONDITION: This run target is ${targetApplyCount} successful applications. Once reached, return action "finish".`,
  ].join('\n');

  const rulesBlock = settings.mode === 'post_outreach' ? outreachRules : jobApplyRules;

  const prompt = [
    'You are an autonomous browser agent. You control a Chrome browser on LinkedIn.',
    '',
    `YOUR GOAL: ${currentGoal}${resumeContextLine}`,
    '',
    'CURRENT PAGE:',
    `- URL: ${snapshot.url}`,
    `- Title: ${snapshot.title}`,
    `- Page text (first ${pageTextLimit} chars):`,
    pageTextPreview,
    '',
    'INTERACTIVE ELEMENTS ON PAGE (id, tag, text):',
    interactiveElementsText,
    '',
    'RULES:',
    rulesBlock,
    stuckHint,
    '',
    'AVAILABLE ACTIONS:',
    '- click: Click an element. Requires elementId.',
    '- type: Type text into an input. Requires elementId and value.',
    '- clear_and_type: Clear existing text then type new text. Requires elementId and value.',
    '- pressEnter: Press Enter key on an element. Requires elementId.',
    '- select_option: Select an option from a <select> dropdown. Requires elementId and value (the option text to select).',
    '- scroll: Scroll down to see more content.',
    '- navigate: Go to a URL. Requires value (the URL).',
    '- wait: Do nothing this turn.',
    '- finish: Stop the agent (only when truly done).',
    '',
    'Respond with ONLY a JSON object:',
    '{"action": "...", "elementId": "...", "value": "...", "reasoning": "..."}',
    debugImageDataUrl
      ? '\nDEBUG IMAGE: A screenshot of the current stuck modal is attached. Use it to identify the exact invalid field and fix it.'
      : '',
  ].join('\n');

  if (settings.provider === 'anthropic') {
    return callAnthropic(prompt, debugImageDataUrl);
  } else if (settings.provider === 'gemini') {
    return callGemini(prompt, debugImageDataUrl);
  } else {
    return callOpenAICompat(prompt, debugImageDataUrl);
  }
}

async function callGemini(prompt, debugImageDataUrl = '') {
  const model = settings.model || 'gemini-3.1-flash-lite-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
  const parts = [{ text: prompt }];
  let debugImageAttached = false;
  let debugImageBytes = 0;

  if (debugImageDataUrl) {
    const mimeMatch = String(debugImageDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const base64Data = String(debugImageDataUrl).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (base64Data) {
      debugImageAttached = true;
      debugImageBytes = Math.round((base64Data.length * 3) / 4);
      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }
  }
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (debugImageAttached) {
    broadcastLog(`Gemini multimodal request sent with debug image (~${Math.max(1, Math.round(debugImageBytes / 1024))} KB).`);
  }

  if (!res.ok) {
    const err = await res.text();
    const normalized = (err || '').toLowerCase();
    if (
      normalized.includes('api key expired') ||
      normalized.includes('api_key_invalid') ||
      normalized.includes('invalid api key')
    ) {
      throw new Error('Gemini API key is invalid or expired. Update the key in Extension popup -> LLM Configuration -> API Key, then click Save Settings and restart the agent.');
    }
    throw new Error(`Gemini API Error: ${err}`);
  }

  const data = await res.json();
  const responseParts = data?.candidates?.[0]?.content?.parts || [];
  const content = responseParts.find((part) => typeof part?.text === 'string')?.text || '';
  const usage = data.usageMetadata;

  if (!content) {
    throw new Error('Gemini API Error: empty response content');
  }

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

async function callAnthropic(prompt, debugImageDataUrl = '') {
  const baseUrl = settings.baseUrl || ANTHROPIC_DEFAULT_URL;
  const model = settings.model || 'claude-3-5-sonnet-20241022';
  const messageContent = [{ type: 'text', text: prompt }];

  if (debugImageDataUrl) {
    const mimeMatch = String(debugImageDataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const mediaType = mimeMatch?.[1] || 'image/jpeg';
    const base64Data = String(debugImageDataUrl).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (base64Data) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data,
        },
      });
    }
  }

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
      messages: [{ role: 'user', content: messageContent }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API Error: ${err}`);
  }

  const data = await res.json();
  const content = Array.isArray(data.content)
    ? (data.content.find((part) => part?.type === 'text')?.text || '')
    : '';
  const usage = data.usage;

  if (!content) {
    throw new Error('Anthropic API Error: empty response content');
  }

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

async function callOpenAICompat(prompt, debugImageDataUrl = '') {
  const baseUrl = settings.baseUrl || OPENAI_DEFAULT_URL;
  const model = settings.model || 'gpt-4o';
  const headers = {
    'Authorization': `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json'
  };

  const buildPayload = (includeImage) => {
    const content = includeImage && debugImageDataUrl
      ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: debugImageDataUrl } },
        ]
      : prompt;
    return {
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' }
    };
  };

  let includeImage = Boolean(debugImageDataUrl);
  let res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildPayload(includeImage))
  });

  if (!res.ok && includeImage) {
    const firstErr = await res.text();
    const normalized = firstErr.toLowerCase();
    if (
      normalized.includes('image') ||
      normalized.includes('vision') ||
      normalized.includes('unsupported') ||
      normalized.includes('invalid content')
    ) {
      includeImage = false;
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildPayload(false))
      });
    } else {
      throw new Error(`OpenAI API Error: ${firstErr}`);
    }
  }

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

async function setAgentTabAutoDiscardable(enabled) {
  if (!agentTabId) return;
  try {
    await chrome.tabs.update(agentTabId, { autoDiscardable: enabled });
  } catch (_error) {
    // Ignore failures when tab is already closed.
  }
}

async function resolveAgentTab() {
  if (agentTabId) {
    try {
      const existing = await chrome.tabs.get(agentTabId);
      if (existing?.url?.includes('linkedin.com')) {
        return existing;
      }
    } catch (_error) {
      // Tab was likely closed; fallback to discovery.
    }
  }

  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs.length) return null;

  const preferred = tabs.find((t) => t.active) || tabs[0];
  agentTabId = preferred.id;
  await setAgentTabAutoDiscardable(false);
  return preferred;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureLinkedInContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/linkedin.js'],
  });
}

async function sendMessageToAgentTab(message, { injectOnFailure = true } = {}) {
  const tab = await resolveAgentTab();
  if (!tab) throw new Error('No LinkedIn tab found');

  try {
    return await sendTabMessage(tab.id, message);
  } catch (error) {
    const msg = String(error?.message || '').toLowerCase();
    const shouldInject =
      injectOnFailure &&
      (msg.includes('receiving end does not exist') ||
       msg.includes('could not establish connection') ||
       msg.includes('message port closed'));

    if (!shouldInject) throw error;

    await ensureLinkedInContentScript(tab.id);
    await setAgentTabAutoDiscardable(false);
    return sendTabMessage(tab.id, message);
  }
}

async function getDOMSnapshotFromActiveTab() {
  const response = await sendMessageToAgentTab({ action: 'build_snapshot' });
  return response?.snapshot || null;
}

async function triggerValidationRecovery() {
  return sendMessageToAgentTab({ action: 'auto_fix_validation' }).catch(() => null);
}

async function executeActionInActiveTab(decision) {
  await sendMessageToAgentTab({
    action: 'execute_decision',
    decision,
  });
}
