// Use browser API if available (Firefox), otherwise chrome API (Chrome)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

console.log('[Content] ESE Printer content script loaded');

// Utility function to monitor URL changes
function onUrlChange(callback) {
    let currentUrl = window.location.href;

    // Intercept history.pushState
    const originalPushState = history.pushState;
    history.pushState = function() {
        originalPushState.apply(history, arguments);
        window.dispatchEvent(new Event('urlchange'));
    };

    // Intercept history.replaceState
    const originalReplaceState = history.replaceState;
    history.replaceState = function() {
        originalReplaceState.apply(history, arguments);
        window.dispatchEvent(new Event('urlchange'));
    };

    // Monitor the popstate event
    window.addEventListener('popstate', () => {
        window.dispatchEvent(new Event('urlchange'));
    });

    // Trigger callback on URL change
    window.addEventListener('urlchange', () => {
        const newUrl = window.location.href;
        if (newUrl !== currentUrl) {
            currentUrl = newUrl;
            callback(newUrl);
        }
    });
}

// Function to handle the print label page (works for both new labels and reprints)
function handlePrintLabelPage() {
    console.log('[Content] handlePrintLabelPage called at:', new Date().toISOString());
    console.log('[Content] Current URL:', window.location.href);

    if (window.alreadyHandlingPrint) {
        console.log('[Content] Already handling print, skipping');
        return;
    }
    window.alreadyHandlingPrint = true;

    // Notify background script that we're on a print page (so it tracks this tab)
    browserAPI.runtime.sendMessage({
        type: 'PRINT_PAGE_LOADED'
    });

    let observer = null;
    let checkInterval = null;

    // Function to check for and click the print button
    function checkAndClickPrintButton() {
        // Try multiple selectors in case the button structure changed
        let printButton = document.querySelector('button[aria-label="Print label"]');
        
        // If not found by aria-label, try finding by text content
        if (!printButton) {
            printButton = Array.from(document.querySelectorAll('button')).find(btn => 
                btn.textContent.trim() === 'Print label' || 
                btn.getAttribute('aria-label') === 'Print label'
            );
        }
        
        // Also try looking for buttons containing "Print" text
        if (!printButton) {
            printButton = Array.from(document.querySelectorAll('button')).find(btn => 
                btn.textContent.trim().toLowerCase().includes('print label') ||
                btn.textContent.trim() === 'Print label'
            );
        }
        
        // Debug: log all buttons if we haven't found the print button
        if (!printButton) {
            const allButtons = Array.from(document.querySelectorAll('button'));
            console.log('[Content] Print button not found. Available buttons:', 
                allButtons.map(btn => ({
                    text: btn.textContent.trim(),
                    ariaLabel: btn.getAttribute('aria-label'),
                    classes: btn.className
                }))
            );
        }
        
        if (printButton) {
            console.log('[Content] Found Print Button');
            
            // Clean up observers and intervals
            if (observer) {
                observer.disconnect();
            }
            if (checkInterval) {
                clearInterval(checkInterval);
            }

            console.log('[Content] Clicking print button');

            // Notify background script that we're about to print
            browserAPI.runtime.sendMessage({
                type: 'PRINT_BUTTON_CLICKED'
            });

            printButton.click();

            // After printing (and tab closes), navigate back to orders
            setTimeout(() => {
                console.log('[Content] Print completed, navigating back to orders');
                browserAPI.runtime.sendMessage({
                    type: 'NAVIGATE_TO_ORDERS'
                });
            }, 4000);
            return true;
        }
        return false;
    }

    // Check immediately in case button is already present
    if (checkAndClickPrintButton()) {
        return;
    }

    // Also set up observer for when button appears later
    observer = new MutationObserver(() => {
        checkAndClickPrintButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
    // Also check periodically as a fallback (in case observer misses it)
    checkInterval = setInterval(() => {
        if (checkAndClickPrintButton()) {
            clearInterval(checkInterval);
        }
    }, 500);
    
    // Stop checking after 10 seconds to avoid infinite loops
    setTimeout(() => {
        if (checkInterval) {
            clearInterval(checkInterval);
        }
        if (observer) {
            observer.disconnect();
        }
    }, 10000);
}

// Function to handle the get label type page
function handleGetLabelTypePage() {
    console.log('[Content] Searching for the purchase button...');
    const observer = new MutationObserver(() => {
        const purchaseButton = document.querySelector('button[data-testid="purchase-button"]');
        if (purchaseButton) {
            observer.disconnect();
            console.log('[Content] Found the purchase button');
            
            const ouncesInput = document.querySelector('input[aria-label="Package weight in ounces"]');
            if (ouncesInput) {
                const ouncesValue = ouncesInput.value;
                console.log(`[Content] Package weight in ounces: ${ouncesValue}`);
                
                if (ouncesValue < 2) {
                    const serviceLabel = document.querySelector('label[data-testid="service-title"][for="EBAYSEND_US-STD_ENV-PACKAGE-DROP_OFF"]');

                    if (serviceLabel) {
                        console.log('[Content] Service label for "eBay Standard Envelope" found.');

                        const buyerSelectedButton = serviceLabel.closest('tr')?.querySelector('button[data-testid="buyer-selected"]');

                        if (buyerSelectedButton) {
                            console.log('[Content] Buyer selected button exists alongside the service label.');
                            setTimeout(() => {
                                purchaseButton.focus();
                                purchaseButton.click();
                                console.log('[Content] Clicked the purchase button');
                            }, 500);
                        } else {
                            console.log('[Content] Buyer selected button does NOT exist.');
                        }
                    } else {
                        console.log('[Content] Service label for "eBay Standard Envelope" NOT found.');
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// Function to handle the PDF download page
function handlePdfDownloadPage() {
    console.log('[Content] On PDF download page. Waiting for the PDF to load...');
    setTimeout(() => {
        console.log('[Content] Triggering print dialog...');
        window.print();
    }, 2000);
}

// Initialize the script
function init() {
    const currentUrl = window.location.href;
    console.log('[Content] Current URL:', currentUrl);

    // Reset flags when navigating to a new page type
    if (currentUrl.startsWith('https://www.ebay.com/ship/single/print/')) {
        // Reset the flag when we navigate to a print page
        window.alreadyHandlingPrint = false;
        handlePrintLabelPage();
    } else if (currentUrl.startsWith('https://www.ebay.com/ship/single/')) {
        // Reset flag when navigating away from print page
        window.alreadyHandlingPrint = false;
        handleGetLabelTypePage();
    } else if (currentUrl.includes('/download')) {
        handlePdfDownloadPage();
    } else {
        // Reset flag for any other page
        window.alreadyHandlingPrint = false;
    }
}

// Run the script on initial page load
init();

// Monitor for URL changes
onUrlChange((newUrl) => {
    console.log(`[Content] URL changed to: ${newUrl}`);
    // Small delay to ensure DOM is ready after navigation
    setTimeout(() => {
        init();
    }, 100);
});

// Also periodically check if we're on a print page but haven't handled it yet
// This catches cases where URL change detection might miss the transition
let lastCheckedUrl = window.location.href;
setInterval(() => {
    const currentUrl = window.location.href;
    // Only check if URL actually changed and we're on a print page
    if (currentUrl !== lastCheckedUrl) {
        lastCheckedUrl = currentUrl;
        if (currentUrl.startsWith('https://www.ebay.com/ship/single/print/') && !window.alreadyHandlingPrint) {
            console.log('[Content] Detected print page but handler not running, initializing...');
            init();
        }
    }
}, 500);
