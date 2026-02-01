// Use browser API if available (Firefox), otherwise chrome API (Chrome)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Track the main eBay tab we're working from
let mainEbayTabId = null;
let pdfTabsToClose = new Set();

// Listen for tab creation
browserAPI.tabs.onCreated.addListener((tab) => {
  console.log('[Background] New tab created:', tab.id, tab.url);
});

// Listen for tab updates (when URL changes or loads)
browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Detect blob PDF tabs from eBay
  if (changeInfo.url && changeInfo.url.startsWith('blob:https://www.ebay.com/')) {
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
  
  // Track which tab is the main eBay workflow tab
  if (changeInfo.url && 
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
  }
});

// Listen for messages from content script
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message);

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
