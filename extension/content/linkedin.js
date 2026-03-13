// LinkedIn content script for Job Auto Apply

const API_URL = 'http://localhost:3001';

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
      checked: el.checked !== undefined ? el.checked : undefined,
      center: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      }
    });

    idCounter++;
  }

  // Also grab raw text of the body to detect CAPTCHAs or page context broadly
  const rawText = document.body.innerText.substring(0, 2000);

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
