// LinkedIn content script for Job Auto Apply

const API_URL = 'https://iapply-telegram-bot.onrender.com';

// State
let isRunning = false;
let currentCommandId = null;
let postAgentRunning = false;
let postAgentJobTitle = '';
let postAgentKeywords = [];
const processedPostKeys = new Set();

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

function postAgentLog(message, isError = false) {
  chrome.runtime.sendMessage({ action: 'agent_log', message, isError }, () => {
    // Popup may be closed; ignore.
  });
}

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractEmails(text) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return Array.from(new Set(matches || []));
}

async function getStoredUserEmail() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['user_email', 'user_portfolio_link'], (result) => {
      resolve({
        email: (result.user_email || '').trim(),
        portfolioLink: (result.user_portfolio_link || '').trim(),
      });
    });
  });
}

function getFeedPosts() {
  const selectors = [
    'div.feed-shared-update-v2',
    'div.occludable-update',
    'article[data-urn*="activity"]',
    'div[data-urn*="activity"]'
  ].join(', ');

  const candidates = Array.from(document.querySelectorAll(selectors));
  const unique = [];
  const seen = new Set();

  for (const el of candidates) {
    const key = el.getAttribute('data-urn') || `${el.tagName}:${normalizeText((el.innerText || '').slice(0, 120))}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(el);
  }

  return unique.filter((el) => {
    const text = normalizeText(el.innerText);
    return text.length > 40;
  });
}

function getPostKey(post, text) {
  const urn = post.getAttribute('data-urn');
  if (urn) return urn;
  return normalizeText(text).slice(0, 220);
}

async function expandPostText(post) {
  const buttons = Array.from(post.querySelectorAll('button, a'));
  const seeMore = buttons.find((btn) => {
    const txt = normalizeText(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '');
    return txt.includes('see more') || txt.includes('...more') || txt.includes('more');
  });

  if (seeMore && seeMore instanceof HTMLElement) {
    try {
      await humanClick(seeMore);
      await sleep(400);
    } catch (_error) {
      // Non-blocking
    }
  }
}

function parseKeywords(rawKeywords) {
  if (!rawKeywords) return [];
  return String(rawKeywords)
    .split(',')
    .map((k) => normalizeText(k))
    .filter((k) => k.length > 1);
}

function isPostRelevant(postText, title, keywords) {
  const text = normalizeText(postText);
  const titleTokens = normalizeText(title).split(' ').filter((w) => w.length > 2);
  const keywordTokens = Array.isArray(keywords) ? keywords : [];

  if (titleTokens.length === 0 && keywordTokens.length === 0) return true;

  let score = 0;
  let total = 0;

  for (const token of titleTokens) {
    total += 1;
    if (text.includes(token)) score += 1;
  }

  for (const token of keywordTokens) {
    total += 1;
    if (text.includes(token)) score += 1;
  }

  if (total === 0) return true;

  const threshold = Math.max(1, Math.ceil(total * 0.35));
  return score >= threshold;
}

function getRelevanceDebug(postText, title, keywords) {
  const text = normalizeText(postText);
  const titleTokens = normalizeText(title).split(' ').filter((w) => w.length > 2);
  const keywordTokens = Array.isArray(keywords) ? keywords : [];

  if (titleTokens.length === 0 && keywordTokens.length === 0) {
    return {
      isRelevant: true,
      matchedTitleTokens: [],
      matchedKeywordTokens: [],
      score: 0,
      threshold: 0,
      total: 0,
    };
  }

  const matchedTitleTokens = titleTokens.filter((token) => text.includes(token));
  const matchedKeywordTokens = keywordTokens.filter((token) => text.includes(token));
  const score = matchedTitleTokens.length + matchedKeywordTokens.length;
  const total = titleTokens.length + keywordTokens.length;
  const threshold = Math.max(1, Math.ceil(total * 0.35));

  return {
    isRelevant: score >= threshold,
    matchedTitleTokens,
    matchedKeywordTokens,
    score,
    threshold,
    total,
  };
}

function isPostRelevantToTitle(postText, title) {
  if (!title && postAgentKeywords.length === 0) return true;
  return getRelevanceDebug(postText, title, postAgentKeywords).isRelevant;
}

function detectPostCTA(postText) {
  const text = normalizeText(postText);
  const commentInterested = /(comment\s+interested|interested\s+comment|comment\s+"?interested"?|type\s+interested|drop\s+interested|if\s+you(?:'|’)?re\s+interested[^.\n]*(comment|dm)|interested[^.\n]*(comment\s+below|comment|dm)|dm\s+me\s+or\s+comment\s+below|comment\s+below|drop\s+a\s+comment|like\s*&?\s*comment)/i.test(text);
  const askEmailInComment = /(comment\s+(your\s+)?(email|gmail|email\s*id)|drop\s+(your\s+)?(email|gmail|email\s*id)|share\s+(your\s+)?(email|gmail|email\s*id)\s+in\s+comments?|type\s+(your\s+)?(email|gmail|email\s*id)\s+in\s+comments?|comment\s+your\s+email\s*id)/i.test(text);
  const askPortfolioInComment = /(comment\s+(your\s+)?(portfolio|website|portfolio\s+link|website\s+link)|drop\s+(your\s+)?(portfolio|website|link)|share\s+(your\s+)?(portfolio|website)\s+link|comment\s+your\s+portfolio|comment\s+your\s+website)/i.test(text);
  const sendEmail = /(send\s+(your\s+)?(resume|cv)|email\s+(your\s+)?(resume|cv)|mail\s+(your\s+)?(resume|cv)|send\s+email|dm\s+your\s+resume)/i.test(text);
  return { commentInterested, askEmailInComment, askPortfolioInComment, sendEmail };
}

function getCommentTextForPost(postText, cta, profile) {
  if (cta.askEmailInComment && profile.email) {
    return profile.email;
  }

  if (cta.askPortfolioInComment && profile.portfolioLink) {
    return profile.portfolioLink;
  }

  if (cta.askPortfolioInComment && !profile.portfolioLink) {
    return 'Interested';
  }

  if (cta.commentInterested || cta.sendEmail) {
    return 'Interested';
  }

  return '';
}

function findCommentButton(post) {
  const candidates = Array.from(post.querySelectorAll('button, [role="button"], span'));
  return candidates.find((el) => {
    const text = normalizeText(el.innerText || el.textContent || el.getAttribute?.('aria-label') || '');
    return text.includes('comment');
  }) || null;
}

async function commentOnPost(post, commentText = 'Interested') {
  const commentButton = post.querySelector('button[aria-label*="Comment"], button[aria-label*="comment"], [data-control-name*="comment"]') || findCommentButton(post);
  if (!commentButton) {
    return false;
  }

  await humanClick(commentButton);
  await sleep(1200);

  const editor = post.querySelector('div.comments-comment-box__editor[contenteditable="true"], div.ql-editor[contenteditable="true"]')
    || document.querySelector('div.comments-comment-box__editor[contenteditable="true"], div.ql-editor[contenteditable="true"]');
  if (!editor) {
    return false;
  }

  editor.focus();

  // LinkedIn comment editor often requires rich-text style input events to enable Post button.
  editor.innerHTML = `<p>${commentText}</p>`;
  editor.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    inputType: 'insertText',
    data: commentText,
  }));
  editor.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: commentText,
  }));
  editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  await sleep(700);

  const composerRoot = editor.closest('form, .comments-comment-box, .comments-comment-item, .editor-content') || document;
  const buttonCandidates = [
    ...Array.from(composerRoot.querySelectorAll('button.comments-comment-box__submit-button--cr, button.comments-comment-box__submit-button, button[aria-label*="Post"], button[data-control-name*="submit_comment"], button')),
    ...Array.from(document.querySelectorAll('button.comments-comment-box__submit-button--cr, button.comments-comment-box__submit-button, button[aria-label*="Post"], button[data-control-name*="submit_comment"]')),
  ];

  const submitBtn = buttonCandidates.find((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return false;
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
    const text = normalizeText(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '');
    return text.includes('post') || text.includes('send') || text.includes('comment');
  });

  if (submitBtn) {
    await humanClick(submitBtn);
    await sleep(600);
    return true;
  }

  // Fallback for editors that submit with Ctrl+Enter.
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true }));
  await sleep(500);
  return true;
}

async function runPostAgentLoop() {
  postAgentLog(`Post outreach scanning started for title: ${postAgentJobTitle || 'all'}`);

  while (postAgentRunning) {
    const posts = getFeedPosts();
    let scanned = 0;
    let relevantCount = 0;
    let ctaCount = 0;
    let actedCount = 0;

    postAgentLog(`Feed scan: found ${posts.length} post candidates`);

    for (const post of posts) {
      if (!postAgentRunning) break;

      await expandPostText(post);

      const postText = post.innerText || '';
      const postKey = getPostKey(post, postText);
      if (!postKey || processedPostKeys.has(postKey)) {
        continue;
      }
      processedPostKeys.add(postKey);
      if (processedPostKeys.size > 300) {
        const firstKey = processedPostKeys.values().next().value;
        if (firstKey) processedPostKeys.delete(firstKey);
      }

      scanned += 1;

      const relevance = getRelevanceDebug(postText, postAgentJobTitle, postAgentKeywords);
      if (!relevance.isRelevant) {
        continue;
      }
      relevantCount += 1;
      const matchedTitle = relevance.matchedTitleTokens.join(', ') || 'none';
      const matchedKeywords = relevance.matchedKeywordTokens.join(', ') || 'none';
      postAgentLog(`Relevance match: score ${relevance.score}/${relevance.total} (need ${relevance.threshold}) | title=[${matchedTitle}] | keywords=[${matchedKeywords}]`);

      const cta = detectPostCTA(postText);
      if (!cta.commentInterested && !cta.askEmailInComment && !cta.askPortfolioInComment && !cta.sendEmail) {
        continue;
      }
      ctaCount += 1;
      postAgentLog(`Relevant CTA post found. Taking action...`);

      const profile = await getStoredUserEmail();
      const commentText = getCommentTextForPost(postText, cta, profile);

      if (!commentText) {
        postAgentLog('Relevant post found but no valid comment text could be generated.', true);
      } else {
        const commented = await commentOnPost(post, commentText);
        postAgentLog(commented ? `Commented: ${commentText}` : 'Could not post comment on this post', !commented);
        if (commented) actedCount += 1;
      }

      await sleep(1200);
    }

    if (!postAgentRunning) break;

    postAgentLog(`Scan summary: new=${scanned}, relevant=${relevantCount}, cta=${ctaCount}, actions=${actedCount}`);

    await smoothScroll(1000);
    await sleep(2000);
  }

  postAgentLog('Post outreach loop stopped.');
}

async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabase_token'], (result) => {
      resolve({ token: result.supabase_token });
    });
  });
}

// Human-like typing
async function typeText(element, text) {
  element.focus();
  if (document.hidden) {
    element.value += text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    return;
  }
  for (const char of text) {
    element.value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(randomDelay(DELAYS.minTyping, DELAYS.maxTyping));
  }
}

// Natural scroll
async function smoothScroll(distance) {
  if (document.hidden) {
    window.scrollBy(0, distance);
    await sleep(100);
    return;
  }
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
  if (document.hidden) {
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(100);
  } else {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
  }
  
  // Simulate hover
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await sleep(document.hidden ? 50 : randomDelay(200, 500));
  
  // Click
  element.click();
  if (!document.hidden) {
    await humanDelay();
  }
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

  // Special handling for LinkedIn resume cards where the filename is in an h3
  const resumeCard = el.closest('.jobs-document-upload-redesign-card, .ui-attachment');
  if (resumeCard) {
    const fileNameElement = resumeCard.querySelector('h3, .ui-attachment__title, .jobs-document-upload-redesign-card__file-name, [data-test-text-selectable-option__text]');
    if (fileNameElement && fileNameElement.textContent) {
       return fileNameElement.textContent.trim();
    }
  }

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

function getFieldCurrentValue(el) {
  if (!el) return '';
  if (typeof el.value === 'string' && el.value.trim()) return el.value.trim();
  return (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderSelection(value) {
  const normalized = normalizeText(value);
  return (
    !normalized ||
    normalized === 'select' ||
    normalized.includes('select an option') ||
    normalized.includes('choose an option') ||
    normalized.includes('please select')
  );
}

function isDropdownLikeElement(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const hasListbox = (el.getAttribute('aria-haspopup') || '').toLowerCase() === 'listbox';
  return tag === 'select' || role === 'combobox' || hasListbox;
}

function getVisibleDropdownOptions() {
  const selectors = [
    '[role="option"]',
    'li[role="option"]',
    '.artdeco-dropdown__item',
    '.fb-form-element__dropdown-option',
    '.artdeco-typeahead__result',
    '[data-test-text-selectable-option__text]',
  ].join(', ');

  const candidates = Array.from(document.querySelectorAll(selectors));
  const unique = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const clickable = candidate.closest('[role="option"], li, button, div');
    const target = clickable || candidate;
    if (!target || !isElementVisible(target)) continue;

    const text = (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || isPlaceholderSelection(text)) continue;

    const key = `${target.tagName}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ element: target, text });
  }

  return unique;
}

function isElementChecked(el) {
  if (el.checked !== undefined) return el.checked;
  if (el.getAttribute('aria-checked') === 'true') return true;
  if (el.getAttribute('aria-selected') === 'true') return true;
  
  if (el.tagName === 'LABEL') {
    const inputInside = el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (inputInside && inputInside.checked !== undefined) return inputInside.checked;
    
    if (el.htmlFor) {
      const inputFor = document.getElementById(el.htmlFor);
      if (inputFor && inputFor.checked !== undefined) return inputFor.checked;
    }
  }
  
  const resumeCard = el.closest('.jobs-document-upload-redesign-card, .ui-attachment');
  if (resumeCard) {
     const inputInside = resumeCard.querySelector('input[type="radio"], input[type="checkbox"]');
     if (inputInside) return inputInside.checked; // returns true OR false, not undefined
  }

  return undefined;
}

function isNumericInput(el) {
  if (!el) return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
  const pattern = (el.getAttribute('pattern') || '').toLowerCase();
  return type === 'number' || inputMode === 'numeric' || /\\d|[0-9]/.test(pattern);
}

function expectsNumericValue(labelText, el, errorText = '') {
  const combined = `${labelText || ''} ${errorText || ''}`.toLowerCase();
  return (
    isNumericInput(el) ||
    combined.includes('decimal') ||
    combined.includes('numeric') ||
    combined.includes('number') ||
    combined.includes('integer') ||
    combined.includes('ctc') ||
    combined.includes('salary') ||
    combined.includes('notice period') ||
    combined.includes('experience')
  );
}

function extractNumericValue(rawValue) {
  const text = String(rawValue || '').replace(/,/g, ' ').trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return '';

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '1';
  }

  return match[0];
}

function normalizeValueForField(labelText, rawValue, el, errorText = '') {
  const nextValue = String(rawValue || '').trim();
  if (!nextValue) {
    return pickFallbackValue(labelText, el, errorText);
  }

  if (expectsNumericValue(labelText, el, errorText)) {
    return extractNumericValue(nextValue) || pickFallbackValue(labelText, el, errorText);
  }

  return nextValue;
}

function pickFallbackValue(labelText, el, errorText = '') {
  const label = (labelText || '').toLowerCase();
  const numeric = expectsNumericValue(labelText, el, errorText);

  if (label.includes('expected ctc') || label.includes('expected salary')) {
    return '300000';
  }
  if (label.includes('current ctc') || label.includes('current salary')) {
    return '200000';
  }
  if (label.includes('notice period')) {
    return numeric ? '1' : '1 month';
  }
  if (label.includes('year') || label.includes('experience')) {
    return numeric ? '3' : '3 years';
  }
  if (label.includes('phone') || label.includes('mobile')) {
    return '9876543210';
  }

  return numeric ? '1' : 'Yes';
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

function fieldHasValidationError(field) {
  const errorText = getInlineErrorText(field);
  const required =
    field.required ||
    field.getAttribute('aria-required') === 'true' ||
    Boolean(field.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping')?.querySelector('[data-test-form-element-required]'));
  const currentValue = getFieldCurrentValue(field);
  const invalid =
    field.getAttribute('aria-invalid') === 'true' ||
    field.getAttribute('data-test-form-element-error') === 'true' ||
    Boolean(errorText) ||
    (typeof field.checkValidity === 'function' && !field.checkValidity()) ||
    (required && isDropdownLikeElement(field) && isPlaceholderSelection(currentValue));

  return {
    invalid,
    errorText,
  };
}

async function selectDropdownValue(field, desiredText = '', errorText = '') {
  const label = getFieldLabel(field);
  const normalizedDesired = normalizeText(
    normalizeValueForField(label, desiredText || pickFallbackValue(label, field, errorText), field, errorText)
  );

  if (field.tagName === 'SELECT') {
    const options = Array.from(field.querySelectorAll('option'));
    const match = options.find((opt) => normalizeText(opt.textContent || '').includes(normalizedDesired));
    const fallback = options.find((opt) => (opt.value || '').trim() !== '' && !isPlaceholderSelection(opt.textContent || ''));
    const next = match || fallback;

    if (!next) return false;

    field.value = next.value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(150);
    return !fieldHasValidationError(field).invalid;
  }

  await humanClick(field);
  await sleep(350);

  const options = getVisibleDropdownOptions();
  const match = options.find((opt) => normalizeText(opt.text).includes(normalizedDesired));
  const fallback = options[0];
  const next = match || fallback;

  if (!next) return false;

  await humanClick(next.element);
  await sleep(250);
  return !fieldHasValidationError(field).invalid;
}

async function setValidatedFieldValue(field, rawValue) {
  const label = getFieldLabel(field);
  const initialState = fieldHasValidationError(field);
  const normalizedValue = normalizeValueForField(label, rawValue, field, initialState.errorText);

  await setInputValue(field, normalizedValue);
  await sleep(150);

  let finalState = fieldHasValidationError(field);
  if (finalState.invalid) {
    const repairedValue = normalizeValueForField(label, field.value || normalizedValue, field, finalState.errorText);
    if (repairedValue && repairedValue !== String(field.value || '').trim()) {
      await setInputValue(field, repairedValue);
      await sleep(150);
      finalState = fieldHasValidationError(field);
    }
  }

  if (finalState.invalid) {
    const fallbackValue = pickFallbackValue(label, field, finalState.errorText);
    if (fallbackValue && fallbackValue !== String(field.value || '').trim()) {
      await setInputValue(field, fallbackValue);
      await sleep(150);
      finalState = fieldHasValidationError(field);
    }
  }

  const finalValue = String(field.value || '').trim();
  if (finalValue && finalValue !== String(rawValue || '').trim()) {
    postAgentLog(`Auto-corrected ${label || 'field'} to "${finalValue}" after validation check.`);
  }

  return {
    value: finalValue,
    invalid: finalState.invalid,
    errorText: finalState.errorText,
  };
}

function getEasyApplyModal() {
  return document.querySelector('.jobs-easy-apply-modal, [role="dialog"].jobs-easy-apply-modal, .artdeco-modal');
}

function listModalValidationIssues() {
  const modal = getEasyApplyModal();
  if (!modal) return [];

  const issues = [];
  const fields = modal.querySelectorAll(
    'input, textarea, select, [role="combobox"], button[aria-haspopup="listbox"], [role="button"][aria-haspopup="listbox"]'
  );

  for (const field of fields) {
    if (!isElementVisible(field) || field.disabled || field.readOnly) continue;

    const label = getFieldLabel(field);
    const errorText = getInlineErrorText(field);
    const value = getFieldCurrentValue(field);
    const required =
      field.required ||
      field.getAttribute('aria-required') === 'true' ||
      Boolean(field.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping')?.querySelector('[data-test-form-element-required]'));
    const invalid =
      field.getAttribute('aria-invalid') === 'true' ||
      Boolean(errorText) ||
      (isDropdownLikeElement(field) && required && isPlaceholderSelection(value));
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
      if (tag === 'select' || isDropdownLikeElement(field)) {
        const selected = await selectDropdownValue(field, pickFallbackValue(label, field, issue.errorText), issue.errorText);
        if (selected) {
          fixed++;
          details.push(`Selected an option for ${label || 'dropdown'}`);
          postAgentLog(`Resolved dropdown issue for ${label || 'dropdown'}.`);
          await sleep(120);
          continue;
        }
        postAgentLog(`Could not resolve dropdown issue for ${label || 'dropdown'} yet.`, true);
      }

      if (type === 'checkbox') {
        if (!field.checked) {
          await humanClick(field);
          fixed++;
          details.push(`Checked ${label || 'required checkbox'}`);
          postAgentLog(`Checked required box for ${label || 'required checkbox'}.`);
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
          postAgentLog(`Selected radio option for ${label || name || 'required question'}.`);
          await sleep(120);
        }
        continue;
      }

      const fallback = pickFallbackValue(label, field, issue.errorText);
      if (fallback) {
        await setValidatedFieldValue(field, fallback);
        fixed++;
        details.push(`Filled ${label || 'required field'} with "${fallback}"`);
        postAgentLog(`Filled ${label || 'required field'} with "${fallback}" while resolving validation.`);
      }
    } catch (error) {
      console.warn('Failed to auto-fix field:', label, error);
      postAgentLog(`Failed to auto-fix ${label || 'field'}: ${error.message}`, true);
    }
  }

  const remaining = listModalValidationIssues().length;
  if (remaining > 0) {
    postAgentLog(`Validation issues still remaining after auto-fix: ${remaining}`, true);
  } else if (fixed > 0) {
    postAgentLog(`All visible validation issues resolved automatically (${fixed} fixes).`);
  }
  return { fixed, remaining, details };
}

function isPrimaryApplyActionButton(el) {
  if (!el || el.tagName !== 'BUTTON') return false;
  const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
  return text.includes('review') || text.includes('next') || text.includes('continue') || text.includes('submit application') || text.includes('submit');
}

// ==========================================
// HARDCODED RESUME SELECTION (deterministic)
// ==========================================

async function autoSelectBestResume(resumeKeyword, titleTokens) {
  const modal = getEasyApplyModal();
  if (!modal) return { changed: false, reason: 'no modal' };

  // Step 1: Click "Show more resumes" repeatedly until all are visible
  for (let attempt = 0; attempt < 3; attempt++) {
    const showMoreBtn = Array.from(modal.querySelectorAll('button')).find(btn => {
      const t = (btn.innerText || '').toLowerCase();
      return isElementVisible(btn) && t.includes('show') && (t.includes('more') || t.includes('resume'));
    });
    if (!showMoreBtn) break;
    postAgentLog(`Clicking "${showMoreBtn.innerText.trim()}" to reveal hidden resumes...`);
    await humanClick(showMoreBtn);
    await sleep(1000);
  }

  // Step 2: Gather all visible resume cards
  const resumeCards = Array.from(
    modal.querySelectorAll('.jobs-document-upload-redesign-card, .ui-attachment')
  ).filter(c => isElementVisible(c));

  if (!resumeCards.length) return { changed: false, reason: 'no resume cards found' };

  // Step 3: Build keyword list
  const keywords = [];
  if (resumeKeyword) keywords.push(resumeKeyword.toLowerCase());
  if (Array.isArray(titleTokens)) {
    for (const t of titleTokens) {
      const lower = t.toLowerCase();
      if (lower.length > 2 && !keywords.includes(lower)) keywords.push(lower);
    }
  }

  // Step 4: Score each resume card by keyword overlap
  let bestCard = null;
  let bestScore = -1;
  let currentlySelectedCard = null;

  for (const card of resumeCards) {
    const nameEl = card.querySelector(
      'h3, .ui-attachment__title, .jobs-document-upload-redesign-card__file-name, [data-test-text-selectable-option__text]'
    );
    const name = (nameEl?.textContent || '').trim();
    const nameLower = name.toLowerCase();
    const radio = card.querySelector('input[type="radio"], input[type="checkbox"]');

    if (radio && radio.checked) {
      currentlySelectedCard = { card, name, radio };
    }

    let score = 0;
    for (const kw of keywords) {
      if (nameLower.includes(kw)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = { card, name, radio, score };
    }
  }

  if (!bestCard || bestScore <= 0) {
    postAgentLog(`No resume matched keywords [${keywords.join(', ')}]. Keeping current selection.`);
    return { changed: false, reason: 'no keyword match' };
  }

  if (currentlySelectedCard && currentlySelectedCard.card === bestCard.card) {
    postAgentLog(`Best resume "${bestCard.name}" is already selected.`);
    return { changed: false, reason: 'already correct' };
  }

  const clickTarget = bestCard.radio || bestCard.card;
  postAgentLog(`Selecting resume "${bestCard.name}" (score: ${bestScore}) for keywords [${keywords.join(', ')}]`);
  await humanClick(clickTarget);
  await sleep(500);

  return { changed: true, selectedName: bestCard.name };
}

function buildDOMSnapshot() {
  const interactiveSelectors = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="menuitem"]', '[role="tab"]', '[role="combobox"]', '[aria-haspopup="listbox"]',
    'label', '.ui-attachment', '.jobs-document-upload-redesign-card'
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
      value: getFieldCurrentValue(el) || undefined,
      label: getFieldLabel(el) || undefined,
      required: el.required || el.getAttribute('aria-required') === 'true' || undefined,
      invalid: el.getAttribute('aria-invalid') === 'true' || undefined,
      errorText: getInlineErrorText(el) || undefined,
      checked: isElementChecked(el),
      center: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      }
    });

    idCounter++;
  }

  // Detect resume selection step in the modal
  const modal = getEasyApplyModal();
  const resumeCards = modal
    ? Array.from(modal.querySelectorAll('.jobs-document-upload-redesign-card, .ui-attachment')).filter(c => isElementVisible(c))
    : [];
  let resumeStepSummary = '';
  if (resumeCards.length > 0) {
    const resumeDetails = resumeCards.map(card => {
      const nameEl = card.querySelector('h3, .ui-attachment__title, .jobs-document-upload-redesign-card__file-name, [data-test-text-selectable-option__text]');
      const name = nameEl?.textContent?.trim() || 'Unknown';
      const radio = card.querySelector('input[type="radio"], input[type="checkbox"]');
      const selected = radio ? radio.checked : false;
      return `- ${name} ${selected ? '[SELECTED]' : '[NOT SELECTED]'}`;
    }).join('\n');

    const showMoreBtn = modal ? Array.from(modal.querySelectorAll('button')).find(btn => {
      const t = (btn.innerText || '').toLowerCase();
      return t.includes('show') && (t.includes('more') || t.includes('resume'));
    }) : null;
    const hiddenNote = showMoreBtn
      ? `\nWARNING: MORE RESUMES ARE HIDDEN! You MUST click "${showMoreBtn.innerText.trim()}" BEFORE selecting a resume.`
      : '';

    resumeStepSummary = `RESUME_STEP_DETECTED:\nThis is a RESUME SELECTION step. Visible resumes:\n${resumeDetails}${hiddenNote}\nFollow Rule 20 NOW.\n\n`;
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
  const rawText = `${resumeStepSummary}${validationSummary ? `FORM_VALIDATION_ERRORS:\n${validationSummary}\n\n` : ''}${modalText}\n\n${document.body.innerText}`.substring(0, 3500);

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
          postAgentLog(`Auto-fixed ${fixResult.fixed} field(s) before trying the progress button.`);
        }
        if (fixResult.remaining > 0) {
          postAgentLog(`Skipping progress button because ${fixResult.remaining} validation issue(s) still remain visible.`, true);
          return;
        }
      }
      await humanClick(el);
    } else if (action === 'type') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const state = fieldHasValidationError(el);
        const normalized = normalizeValueForField(getFieldLabel(el), value || '', el, state.errorText);
        if (state.invalid || normalized !== String(value || '').trim()) {
          await setValidatedFieldValue(el, value || '');
        } else {
          await typeText(el, value || '');
        }
      } else {
        await typeText(el, value || '');
      }
    } else if (action === 'clear_and_type') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        await setValidatedFieldValue(el, value || '');
      } else {
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
        await typeText(el, value || '');
      }
    } else if (action === 'pressEnter') {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      // Also try submitting the closest form
      const form = el.closest('form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
    } else if (action === 'select_option') {
      const selected = await selectDropdownValue(el, value || '', getInlineErrorText(el));
      if (selected) {
        postAgentLog(`Selected dropdown value for ${getFieldLabel(el) || elementId}.`);
      } else {
        postAgentLog(`Could not select dropdown value for ${getFieldLabel(el) || elementId}.`, true);
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

  if (message.action === 'auto_select_resume') {
    autoSelectBestResume(message.resumeKeyword, message.titleTokens).then((result) => {
      sendResponse(result);
    });
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
    postAgentRunning = false;
    postAgentLog('Stop received. All automations halted.');
    sendResponse({ success: true });
  }

  if (message.action === 'start_post_agent') {
    postAgentJobTitle = (message.jobTitle || '').trim();
    postAgentKeywords = parseKeywords(message.keywords || '');
    postAgentRunning = true;
    processedPostKeys.clear();
    runPostAgentLoop();
    sendResponse({ success: true });
  }

  if (message.action === 'stop_post_agent') {
    postAgentRunning = false;
    postAgentLog('Post outreach stopped by user.');
    sendResponse({ success: true });
  }
  
  return true;
});

// Notify that content script is loaded
console.log('Job Auto Apply: LinkedIn content script loaded');
