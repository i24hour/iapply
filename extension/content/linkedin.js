// LinkedIn content script for Job Auto Apply

const API_URL = 'http://localhost:3001';

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

// Get value for a field based on label
function getFieldValue(label) {
  const labelLower = label.toLowerCase();
  
  // These would come from stored profile data
  const profile = {
    phone: '1234567890',
    city: 'San Francisco',
    yearsExperience: '5'
  };
  
  if (labelLower.includes('phone')) return profile.phone;
  if (labelLower.includes('city') || labelLower.includes('location')) return profile.city;
  if (labelLower.includes('years') && labelLower.includes('experience')) return profile.yearsExperience;
  
  return null;
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
