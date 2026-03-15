// LinkedIn content script for Job Auto Apply

const API_URL = 'https://iapply-telegram-bot.onrender.com';

// State
let isRunning = false;
let currentCommandId = null;

// Human simulation delays
const DELAYS = {
  minAction: 1000,
  maxAction: 3000,
  minTyping: 50,
  maxTyping: 150,
  scrollPause: 500,
  pageLoad: 2000
};

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = DELAYS.minAction, max = DELAYS.maxAction) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay() {
  await sleep(randomDelay());
}

async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['auth_token'], (result) => {
      resolve({ token: result.auth_token });
    });
  });
}

// Human-like typing
async function typeText(element, text) {
  element.focus();
  for (const char of text) {
    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(randomDelay(DELAYS.minTyping, DELAYS.maxTyping));
  }
}

// Natural scroll
async function smoothScroll(distance) {
  const steps = 10;
  const stepSize = distance / steps;
  for (let i = 0; i < steps; i++) {
    window.scrollBy(0, stepSize);
    await sleep(50);
  }
  await sleep(DELAYS.scrollPause);
}

// Click with human-like behavior
async function humanClick(element) {
  // Scroll element into view
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(500);
  
  // Simulate hover
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await sleep(randomDelay(200, 500));
  
  // Click
  element.click();
  await humanDelay();
}

// Scrape job listings from LinkedIn
async function scrapeJobs() {
  const jobs = [];
  
  // Find job cards
  const jobCards = document.querySelectorAll('.jobs-search-results__list-item, .job-card-container');
  
  for (const card of jobCards) {
    try {
      const titleElement = card.querySelector('.job-card-list__title, .job-card-container__link');
      const companyElement = card.querySelector('.job-card-container__primary-description, .job-card-container__company-name');
      const locationElement = card.querySelector('.job-card-container__metadata-item, .job-card-container__metadata-wrapper');
      const linkElement = card.querySelector('a[href*="/jobs/view/"]');
      
      if (titleElement && linkElement) {
        const url = linkElement.href;
        const jobId = url.match(/\/jobs\/view\/(\d+)/)?.[1];
        
        // Check for Easy Apply badge
        const isEasyApply = card.querySelector('.job-card-container__apply-method, .jobs-apply-button--top-card') !== null;
        
        jobs.push({
          platform: 'linkedin',
          externalId: jobId || `linkedin-${Date.now()}-${Math.random()}`,
          title: titleElement.textContent.trim(),
          company: companyElement?.textContent.trim() || 'Unknown Company',
          location: locationElement?.textContent.trim() || 'Unknown Location',
          description: '', // Will be filled when clicking into job
          url: url.split('?')[0],
          isEasyApply
        });
      }
    } catch (e) {
      console.error('Error parsing job card:', e);
    }
  }
  
  return jobs;
}

// Submit scraped jobs to backend
async function submitJobs(jobs) {
  try {
    const auth = await getAuth();
    if (!auth.token) return;
    
    const response = await fetch(`${API_URL}/extension/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jobs })
    });
    
    const data = await response.json();
    console.log('Submitted jobs:', data);
    return data;
  } catch (error) {
    console.error('Failed to submit jobs:', error);
  }
}

// Apply to a job using Easy Apply
async function applyToJob(job) {
  try {
    // Navigate to job page
    window.location.href = job.url;
    await sleep(DELAYS.pageLoad);
    
    // Wait for page to load
    await waitForElement('.jobs-apply-button');
    
    // Click Easy Apply button
    const applyButton = document.querySelector('.jobs-apply-button, .jobs-apply-button--top-card');
    if (!applyButton) {
      return { success: false, error: 'Apply button not found' };
    }
    
    await humanClick(applyButton);
    
    // Wait for modal
    await waitForElement('.jobs-easy-apply-modal');
    await humanDelay();
    
    // Handle multi-step form
    let stepCount = 0;
    const maxSteps = 10;
    
    while (stepCount < maxSteps) {
      stepCount++;
      
      // Check if we're done
      const successMessage = document.querySelector('.artdeco-inline-feedback--success');
      if (successMessage) {
        return { success: true };
      }
      
      // Fill current step
      await fillFormStep();
      
      // Find next/submit button
      const submitButton = document.querySelector('button[aria-label="Submit application"]');
      const nextButton = document.querySelector('button[aria-label="Continue to next step"]');
      const reviewButton = document.querySelector('button[aria-label="Review your application"]');
      
      if (submitButton) {
        await humanClick(submitButton);
        await sleep(2000);
        return { success: true };
      } else if (reviewButton) {
        await humanClick(reviewButton);
      } else if (nextButton) {
        await humanClick(nextButton);
      } else {
        // Try generic button with "Submit" or "Next" text
        const buttons = document.querySelectorAll('.jobs-easy-apply-modal button');
        for (const btn of buttons) {
          if (btn.textContent.includes('Submit') || btn.textContent.includes('Next')) {
            await humanClick(btn);
            break;
          }
        }
      }
      
      await humanDelay();
    }
    
    return { success: false, error: 'Max steps exceeded' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fill a form step
async function fillFormStep() {
  // Handle text inputs
  const textInputs = document.querySelectorAll('.jobs-easy-apply-modal input[type="text"]:not([readonly])');
  for (const input of textInputs) {
    if (!input.value) {
      const label = input.closest('.fb-dash-form-element')?.querySelector('label')?.textContent || '';
      const value = getFieldValue(label);
      if (value) {
        await typeText(input, value);
      }
    }
  }
  
  // Handle radio buttons - select first option if none selected
  const radioGroups = document.querySelectorAll('.jobs-easy-apply-modal fieldset');
  for (const group of radioGroups) {
    const checkedRadio = group.querySelector('input[type="radio"]:checked');
    if (!checkedRadio) {
      const firstRadio = group.querySelector('input[type="radio"]');
      if (firstRadio) {
        await humanClick(firstRadio);
      }
    }
  }
  
  // Handle dropdowns - select first option if none selected
  const selects = document.querySelectorAll('.jobs-easy-apply-modal select');
  for (const select of selects) {
    if (!select.value) {
      const options = select.querySelectorAll('option');
      if (options.length > 1) {
        select.value = options[1].value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await humanDelay();
      }
    }
  }
  
  // Handle checkboxes - check required ones
  const uncheckedBoxes = document.querySelectorAll('.jobs-easy-apply-modal input[type="checkbox"]:not(:checked)');
  for (const checkbox of uncheckedBoxes) {
    const isRequired = checkbox.closest('.fb-dash-form-element')?.querySelector('[data-test-form-element-required]');
    if (isRequired) {
      await humanClick(checkbox);
    }
  }
}

// ==========================================
// ROBUST DOM SNAPSHOT ENGINE
// ==========================================

function isElementVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 && 
    rect.height > 0 && 
    style.visibility !== 'hidden' && 
    style.display !== 'none' &&
    style.opacity !== '0'
  );
}

function getElementText(el) {
  // Get text content, prioritizing aria-labels or values for inputs
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return el.placeholder || el.value || el.name || '';
  }
  return el.getAttribute('aria-label') || el.innerText || el.textContent || '';
}

function getFieldLabel(el) {
  if (!el) return '';

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const fieldContainer = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, .artdeco-text-input--container');
  if (fieldContainer) {
    const label = fieldContainer.querySelector('label, legend, .fb-dash-form-element__label, .t-14');
    if (label && label.textContent) return label.textContent.trim();
  }

  const forLabel = document.querySelector(`label[for="${el.id}"]`);
  if (forLabel && forLabel.textContent) return forLabel.textContent.trim();

  return el.placeholder || el.name || '';
}

function getInlineErrorText(el) {
  const fieldContainer = el.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping, .artdeco-text-input--container');
  if (!fieldContainer) return '';

  const errorEl = fieldContainer.querySelector('.artdeco-inline-feedback__message, .artdeco-inline-feedback--error, .fb-dash-form-element__error-message, [role="alert"]');
  return errorEl?.textContent?.trim() || '';
}

function isNumericInput(el) {
  if (!el) return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
  const pattern = (el.getAttribute('pattern') || '').toLowerCase();
  return type === 'number' || inputMode === 'numeric' || /\\d|[0-9]/.test(pattern);
}

function pickFallbackValue(labelText, el) {
  const label = (labelText || '').toLowerCase();

  if (label.includes('expected ctc') || label.includes('expected salary')) {
    return isNumericInput(el) ? '300000' : '300000';
  }
  if (label.includes('current ctc') || label.includes('current salary')) {
    return isNumericInput(el) ? '200000' : '200000';
  }
  if (label.includes('notice period')) {
    return isNumericInput(el) ? '1' : '1 month';
  }
  if (label.includes('year') || label.includes('experience')) {
    return isNumericInput(el) ? '3' : '3 years';
  }
  if (label.includes('phone') || label.includes('mobile')) {
    return '9876543210';
  }

  return isNumericInput(el) ? '1' : 'Yes';
}

async function setInputValue(element, value) {
  element.focus();
  element.value = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(120);
  await typeText(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function getEasyApplyModal() {
  return document.querySelector('.jobs-easy-apply-modal, [role="dialog"].jobs-easy-apply-modal, .artdeco-modal');
}

function listModalValidationIssues() {
  const modal = getEasyApplyModal();
  if (!modal) return [];

  const issues = [];
  const fields = modal.querySelectorAll('input, textarea, select');

  for (const field of fields) {
    if (!isElementVisible(field) || field.disabled || field.readOnly) continue;

    const label = getFieldLabel(field);
    const errorText = getInlineErrorText(field);
    const value = (field.value || '').trim();
    const required = field.required || field.getAttribute('aria-required') === 'true';
    const invalid = field.getAttribute('aria-invalid') === 'true' || Boolean(errorText);
    const type = (field.getAttribute('type') || '').toLowerCase();

    // Ignore hidden helper fields and search fields in dropdown widgets.
    if (type === 'hidden' || field.getAttribute('aria-hidden') === 'true') continue;

    if ((required && !value) || invalid) {
      issues.push({
        field,
        label,
        errorText,
        required,
        invalid,
        value,
        tag: field.tagName.toLowerCase(),
        type
      });
    }
  }

  return issues;
}

async function autoFixModalValidationIssues() {
  const issues = listModalValidationIssues();
  if (!issues.length) return { fixed: 0, remaining: 0, details: [] };

  let fixed = 0;
  const details = [];

  for (const issue of issues) {
    const { field, tag, type, label } = issue;

    try {
      if (tag === 'select') {
        const options = Array.from(field.querySelectorAll('option'));
        const firstReal = options.find(opt => (opt.value || '').trim() !== '');
        if (firstReal) {
          field.value = firstReal.value;
          field.dispatchEvent(new Event('change', { bubbles: true }));
          field.dispatchEvent(new Event('input', { bubbles: true }));
          fixed++;
          details.push(`Selected "${firstReal.textContent.trim()}" for ${label || 'dropdown'}`);
          await sleep(120);
          continue;
        }
      }

      if (type === 'checkbox') {
        if (!field.checked) {
          await humanClick(field);
          fixed++;
          details.push(`Checked ${label || 'required checkbox'}`);
          await sleep(120);
        }
        continue;
      }

      if (type === 'radio') {
        const name = field.name;
        const group = name ? Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`)) : [field];
        const selected = group.some(r => r.checked);
        if (!selected && group.length) {
          await humanClick(group[0]);
          fixed++;
          details.push(`Selected radio option for ${label || name || 'required question'}`);
          await sleep(120);
        }
        continue;
      }

      const fallback = pickFallbackValue(label, field);
      if (fallback) {
        await setInputValue(field, fallback);
        fixed++;
        details.push(`Filled ${label || 'required field'} with "${fallback}"`);
      }
    } catch (error) {
      console.warn('Failed to auto-fix field:', label, error);
    }
  }

  const remaining = listModalValidationIssues().length;
  return { fixed, remaining, details };
}

function isPrimaryApplyActionButton(el) {
  if (!el || el.tagName !== 'BUTTON') return false;
  const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
  return text.includes('review') || text.includes('next') || text.includes('continue') || text.includes('submit application') || text.includes('submit');
}

function buildDOMSnapshot() {
  const interactiveSelectors = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="menuitem"]', '[role="tab"]'
  ].join(', ');

  const elements = Array.from(document.querySelectorAll(interactiveSelectors));
  const snapshot = [];
  let idCounter = 1;

  for (const el of elements) {
    if (!isElementVisible(el)) continue;

    const text = getElementText(el).trim().replace(/\s+/g, ' ');
    if (!text && el.tagName !== 'INPUT') continue; // Skip empty elements unless they're inputs

    // Add dataset ID to element for mapping actions later
    const elementId = `iapply-${idCounter}`;
    el.setAttribute('data-iapply-id', elementId);

    const rect = el.getBoundingClientRect();

    snapshot.push({
      id: elementId,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      role: el.getAttribute('role') || null,
      text: text.substring(0, 100), // truncate very long text
      value: el.value || undefined,
      label: getFieldLabel(el) || undefined,
      required: el.required || el.getAttribute('aria-required') === 'true' || undefined,
      invalid: el.getAttribute('aria-invalid') === 'true' || undefined,
      errorText: getInlineErrorText(el) || undefined,
      checked: el.checked !== undefined ? el.checked : undefined,
      center: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      }
    });

    idCounter++;
  }

  // Also grab raw text of the body to detect CAPTCHAs or page context broadly
  const validationIssues = listModalValidationIssues();
  const validationSummary = validationIssues
    .slice(0, 10)
    .map(issue => {
      const label = issue.label || issue.field?.name || 'Unknown field';
      const reason = issue.errorText || (issue.required && !issue.value ? 'Required field is empty' : 'Invalid value');
      return `- ${label}: ${reason}`;
    })
    .join('\n');

  const modalText = getEasyApplyModal()?.innerText || '';
  const rawText = `${validationSummary ? `FORM_VALIDATION_ERRORS:\n${validationSummary}\n\n` : ''}${modalText}\n\n${document.body.innerText}`.substring(0, 3500);

  return { 
    elements: snapshot, 
    rawText,
    url: window.location.href,
    title: document.title
  };
}


// ==========================================
// AGENT ACTION EXECUTION
// ==========================================

async function executeAgentAction(decision) {
  const { action, elementId, value } = decision;

  if (action === 'scroll') {
    await smoothScroll(500);
    return;
  }

  if (!elementId) return;

  const el = document.querySelector(`[data-iapply-id="${elementId}"]`);
  if (!el) {
    console.warn(`Agent asked to interact with missing element: ${elementId}`);
    return;
  }

  try {
    if (action === 'click') {
      if (isPrimaryApplyActionButton(el)) {
        const fixResult = await autoFixModalValidationIssues();
        if (fixResult.fixed > 0) {
          console.log(`Auto-fixed ${fixResult.fixed} field(s) before proceeding.`);
        }
      }
      await humanClick(el);
    } else if (action === 'type') {
      await typeText(el, value || '');
    } else if (action === 'clear_and_type') {
      // Clear existing value first, then type new text
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);
      await typeText(el, value || '');
    } else if (action === 'pressEnter') {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      // Also try submitting the closest form
      const form = el.closest('form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
    } else if (action === 'select_option') {
      // Handle <select> dropdowns
      el.focus();
      const options = Array.from(el.querySelectorAll('option'));
      const match = options.find(opt => 
        opt.textContent.trim().toLowerCase().includes((value || '').toLowerCase())
      );
      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`Selected option: "${match.textContent.trim()}" in dropdown`);
      } else {
        // If no matching option, try selecting the first non-empty option
        const firstReal = options.find(opt => opt.value && opt.value !== '');
        if (firstReal) {
          el.value = firstReal.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          console.log(`Fallback selected: "${firstReal.textContent.trim()}"`);
        }
      }
    }
  } catch (error) {
    console.error('Action failed:', error);
  }
}

// Wait for element to appear
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found`));
    }, timeout);
  });
}

// Submit application result
async function submitApplicationResult(jobId, success, errorMessage = null) {
  try {
    const auth = await getAuth();
    if (!auth.token) return;
    
    // Take screenshot (simplified - would need proper implementation)
    let screenshotBase64 = null;
    
    await fetch(`${API_URL}/extension/application`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jobId,
        success,
        screenshotBase64,
        errorMessage
      })
    });
  } catch (error) {
    console.error('Failed to submit result:', error);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Agent core communication
  if (message.action === 'build_snapshot') {
    sendResponse({ snapshot: buildDOMSnapshot() });
    return true;
  }
  
  if (message.action === 'execute_decision') {
    executeAgentAction(message.decision).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'start_scraping') {
    (async () => {
      console.log('Starting job scraping...');
      await smoothScroll(500);
      const jobs = await scrapeJobs();
      console.log(`Found ${jobs.length} jobs`);
      await submitJobs(jobs);
      chrome.runtime.sendMessage({ type: 'status_update' });
    })();
    sendResponse({ success: true });
  }
  
  if (message.action === 'scrape_jobs') {
    currentCommandId = message.commandId;
    (async () => {
      const jobs = await scrapeJobs();
      await submitJobs(jobs);
      // Continue to apply if jobs found
      if (message.payload?.count && jobs.length > 0) {
        chrome.runtime.sendMessage({ type: 'status_update' });
      }
    })();
    sendResponse({ success: true });
  }
  
  if (message.action === 'apply_jobs') {
    currentCommandId = message.commandId;
    isRunning = true;
    (async () => {
      const jobs = message.payload?.jobs || [];
      for (const job of jobs) {
        if (!isRunning) break;
        const result = await applyToJob(job);
        await submitApplicationResult(job.id, result.success, result.error);
        chrome.runtime.sendMessage({ type: 'status_update' });
        await humanDelay();
      }
      isRunning = false;
    })();
    sendResponse({ success: true });
  }
  
  if (message.action === 'stop') {
    isRunning = false;
    sendResponse({ success: true });
  }
  
  return true;
});

// Notify that content script is loaded
console.log('Job Auto Apply: LinkedIn content script loaded');
