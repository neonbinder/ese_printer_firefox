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

    const observer = new MutationObserver(() => {
        const printButton = document.querySelector('button[aria-label="Print label"]');
        if (printButton) {
            console.log('[Content] Found Print Button');
            observer.disconnect();

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
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
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

    if (currentUrl.startsWith('https://www.ebay.com/ship/single/print/')) {
        handlePrintLabelPage();
    } else if (currentUrl.startsWith('https://www.ebay.com/ship/single/')) {
        handleGetLabelTypePage();
    } else if (currentUrl.includes('/download')) {
        handlePdfDownloadPage();
    }
}

// Run the script on initial page load
init();

// Monitor for URL changes
onUrlChange((newUrl) => {
    console.log(`[Content] URL changed to: ${newUrl}`);
    init();
});
