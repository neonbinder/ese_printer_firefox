// Use browser API if available (Firefox), otherwise chrome API (Chrome)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Track the main eBay tab we're working from
let mainEbayTabId = null;
let pdfTabsToClose = new Set();
// Track the last active tab so we can switch back when lettertrackpro PDFs open
let lastActiveTabId = null;
// Track lettertrackpro PDF tabs
let lettertrackPdfTabs = new Set();
// Sportlots -> Neon Binder label jobs, keyed by the Neon Binder tab id
const NEONBINDER_SHIPPING_URL = 'https://www.neonbinder.io/print/shipping';
let neonbinderJobs = new Map();
// Sportlots -> Pirate Ship address jobs, keyed by the Pirate Ship tab id
const PIRATESHIP_SINGLE_URL = 'https://ship.pirateship.com/ship/single';
let pirateshipJobs = new Map();
// Feature toggles from the options page (see settings.js); kept current below.
let settings = { ...ESE_SETTINGS_DEFAULTS };
loadSettings().then((loaded) => { settings = loaded; });
onSettingsChanged((loaded) => {
  settings = loaded;
  console.log('[Background] Settings changed:', settings);
});

// Listen for tab creation
browserAPI.tabs.onCreated.addListener((tab) => {
  console.log('[Background] New tab created:', tab.id, tab.url);
});

// Listen for tab updates (when URL changes or loads)
browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Detect blob PDF tabs from eBay (only when the eBay flow is switched on)
  if (settings.ebay && changeInfo.url && changeInfo.url.startsWith('blob:https://www.ebay.com/')) {
    console.log('[Background] Detected eBay PDF blob tab:', tabId, changeInfo.url);
    pdfTabsToClose.add(tabId);
    
    // Switch focus back to main tab if we have one
    if (mainEbayTabId) {
      browserAPI.tabs.update(mainEbayTabId, { active: true }).then(() => {
        console.log('[Background] Switched focus back to main tab:', mainEbayTabId);
      }).catch(err => {
        console.error('[Background] Error switching tabs:', err);
      });
    }
    
    // Close the PDF tab after 3 seconds (gives time for printing)
    setTimeout(() => {
      browserAPI.tabs.remove(tabId).then(() => {
        console.log('[Background] Closed PDF tab:', tabId);
        pdfTabsToClose.delete(tabId);
      }).catch(err => {
        console.error('[Background] Error closing tab:', err);
      });
    }, 3000);
  }
  
  // Detect LetterTrack Pro PDF tabs by URL
  if (changeInfo.url && changeInfo.url.match(/^https?:\/\/www\.lettertrackpro\.com\/.*\.pdf/)) {
    console.log('[Background] Detected LetterTrack Pro PDF tab:', tabId, changeInfo.url);
    pdfTabsToClose.add(tabId);
    lettertrackPdfTabs.add(tabId);
  }

  // Track which tab is the main eBay workflow tab
  if (settings.ebay && changeInfo.url && 
      (changeInfo.url.includes('ebay.com/sh/ord') || 
       changeInfo.url.includes('ebay.com/ship/single'))) {
    console.log('[Background] Tracking main eBay tab:', tabId);
    mainEbayTabId = tabId;
  }
});

// Listen for tab activation (user or script switching tabs)
browserAPI.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  
  // If a PDF tab gets focused, switch back to main tab
  if (pdfTabsToClose.has(tabId) && mainEbayTabId) {
    browserAPI.tabs.update(mainEbayTabId, { active: true }).then(() => {
      console.log('[Background] Redirected focus from PDF tab to main tab');
    }).catch(err => {
      console.error('[Background] Error redirecting focus:', err);
    });
  } else if (!pdfTabsToClose.has(tabId)) {
    // Track the last non-PDF tab the user was on (for lettertrackpro focus-back)
    lastActiveTabId = tabId;
  }
});

// Clean up job bookkeeping if a Neon Binder / Pirate Ship tab is closed by hand
browserAPI.tabs.onRemoved.addListener((tabId) => {
  if (neonbinderJobs.has(tabId)) {
    console.log('[Background] Neon Binder tab closed, dropping job for tab:', tabId);
    neonbinderJobs.delete(tabId);
  }
  if (pirateshipJobs.has(tabId)) {
    console.log('[Background] Pirate Ship tab closed, dropping job for tab:', tabId);
    pirateshipJobs.delete(tabId);
  }
});

// Listen for messages from content script
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message);

  // --- Sportlots -> Neon Binder flow -----------------------------------------

  if (message.type === 'SPORTLOTS_PRINT_LABEL') {
    // Open Neon Binder in a new tab and remember the job for that tab
    const sourceTabId = sender.tab.id;
    browserAPI.tabs.create({ url: NEONBINDER_SHIPPING_URL, active: true }).then((tab) => {
      neonbinderJobs.set(tab.id, { ...message.job, sourceTabId });
      console.log('[Background] Opened Neon Binder tab', tab.id, 'for order', message.job.orderId);
      sendResponse({ success: true, tabId: tab.id });
    }).catch((err) => {
      console.error('[Background] Error opening Neon Binder tab:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // async sendResponse
  }

  if (message.type === 'NEONBINDER_GET_JOB') {
    const job = neonbinderJobs.get(sender.tab.id) || null;
    sendResponse({ success: true, job });
    return true;
  }

  if (message.type === 'NEONBINDER_LABEL_PRINTED') {
    const printedTabId = sender.tab.id;
    const job = neonbinderJobs.get(printedTabId);
    neonbinderJobs.delete(printedTabId);
    console.log('[Background] Neon Binder label printed for order:', job && job.orderId);

    // Switch back to the Sportlots tab that started the job, then close Neon Binder
    const focusBack = job && job.sourceTabId
      ? browserAPI.tabs.update(job.sourceTabId, { active: true }).catch((err) => {
          console.error('[Background] Error switching back to Sportlots tab:', err);
        })
      : Promise.resolve();

    focusBack.then(() => browserAPI.tabs.remove(printedTabId)).then(() => {
      console.log('[Background] Closed Neon Binder tab:', printedTabId);
    }).catch((err) => {
      console.error('[Background] Error closing Neon Binder tab:', err);
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'NEONBINDER_JOB_FAILED') {
    // Leave the tab open for the user; just forget the job so a reload starts clean
    console.error('[Background] Neon Binder job failed in tab', sender.tab.id, ':', message.error);
    neonbinderJobs.delete(sender.tab.id);
    sendResponse({ success: true });
    return true;
  }

  // --- Sportlots -> Pirate Ship flow ------------------------------------------
  // Only the address is filled in; the tab stays open for the user to finish.

  if (message.type === 'SPORTLOTS_PIRATESHIP') {
    const sourceTabId = sender.tab.id;
    browserAPI.tabs.create({ url: PIRATESHIP_SINGLE_URL, active: true }).then((tab) => {
      pirateshipJobs.set(tab.id, { ...message.job, sourceTabId });
      console.log('[Background] Opened Pirate Ship tab', tab.id, 'for order', message.job.orderId);
      sendResponse({ success: true, tabId: tab.id });
    }).catch((err) => {
      console.error('[Background] Error opening Pirate Ship tab:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // async sendResponse
  }

  if (message.type === 'PIRATESHIP_GET_JOB') {
    const job = pirateshipJobs.get(sender.tab.id) || null;
    sendResponse({ success: true, job });
    return true;
  }

  if (message.type === 'PIRATESHIP_ADDRESS_PASTED' || message.type === 'PIRATESHIP_JOB_FAILED') {
    // Either way the job is over; the tab stays open for the user.
    const job = pirateshipJobs.get(sender.tab.id);
    pirateshipJobs.delete(sender.tab.id);
    if (message.type === 'PIRATESHIP_JOB_FAILED') {
      console.error('[Background] Pirate Ship job failed in tab', sender.tab.id, ':', message.error);
    } else {
      console.log('[Background] Pirate Ship address pasted for order:', job && job.orderId);
    }
    sendResponse({ success: true });
    return true;
  }

  // --- eBay / LetterTrack Pro flow (unchanged) --------------------------------

  if (message.type === 'PRINT_PAGE_LOADED') {
    // Track this tab when print page loads (handles reprint flow where user navigates directly)
    mainEbayTabId = sender.tab.id;
    console.log('[Background] Print page loaded, tracking tab:', mainEbayTabId);
  }

  if (message.type === 'PRINT_BUTTON_CLICKED') {
    // Store the tab that initiated printing
    mainEbayTabId = sender.tab.id;
    console.log('[Background] Print initiated from tab:', mainEbayTabId);
  }

  if (message.type === 'LETTERTRACK_PRINTED') {
    const printedTabId = sender.tab.id;
    console.log('[Background] LetterTrack Pro PDF printed from tab:', printedTabId);

    // Switch focus back to the previous tab
    if (lastActiveTabId) {
      browserAPI.tabs.update(lastActiveTabId, { active: true }).then(() => {
        console.log('[Background] Switched focus back to previous tab:', lastActiveTabId);
      }).catch(err => {
        console.error('[Background] Error switching tabs:', err);
      });
    }

    // Close the PDF tab after giving time for the print job to queue
    setTimeout(() => {
      browserAPI.tabs.remove(printedTabId).then(() => {
        console.log('[Background] Closed LetterTrack Pro PDF tab:', printedTabId);
        pdfTabsToClose.delete(printedTabId);
        lettertrackPdfTabs.delete(printedTabId);
      }).catch(err => {
        console.error('[Background] Error closing tab:', err);
      });
    }, 3000);
  }

  if (message.type === 'NAVIGATE_TO_ORDERS') {
    // Navigate back to orders page
    if (mainEbayTabId) {
      browserAPI.tabs.update(mainEbayTabId, {
        url: 'https://www.ebay.com/sh/ord/?filter=status:AWAITING_SHIPMENT'
      }).then(() => {
        console.log('[Background] Navigated back to orders page');
      }).catch(err => {
        console.error('[Background] Error navigating:', err);
      });
    }
  }
  
  sendResponse({ success: true });
  return true; // Keep the message channel open for async response
});

console.log('[Background] ESE Printer extension loaded');
