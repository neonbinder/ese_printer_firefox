// Use browser API if available (Firefox), otherwise chrome API (Chrome)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

console.log('[BSC Content] ESE Printer BuySportsCards script loaded');

// BuySportsCards' Seller's Locker is a React SPA. On the order-detail page,
// "Print Packing Slip" opens a "Sort Order" dialog whose "Generate" button
// calls window.open() on a freshly generated PDF at bsc-media-images S3.
// There is no packing slip URL in the DOM and the API needs the page's MSAL
// bearer token, so rather than re-implementing that, the Finicky button
// drives the site's own buttons and catches the URL the page hands to
// window.open(), then sends it to Finicky instead of a new Firefox tab.

const ORDER_DETAIL_PATH = '/sellers/orders/order-detail';
const PACKING_SLIP_URL_PREFIX = 'https://bsc-media-images.s3.amazonaws.com/';
const PRINT_BUTTON_LABEL = 'Print Packing Slip';
const GENERATE_BUTTON_LABEL = 'Generate';
const FINICKY_ICON = 'icons/finicky.png';
// Finicky (https://github.com/johnste/finicky) registers this URL scheme and
// base64-decodes the rest, then routes the URL by the user's ~/.finicky.js.
const FINICKY_OPEN_PREFIX = 'finicky://open/';
const FINICKY_CONTAINER_CLASS = 'ese-bsc-finicky';
// Set on <html> while the site's dialog is being driven, to keep it off screen.
const BUSY_CLASS = 'ese-bsc-busy';
const GENERATE_TIMEOUT_MS = 20000;
const GENERATE_POLL_MS = 250;
// Feature toggles from the options page (see settings.js); loaded in init().
let settings = { ...ESE_SETTINGS_DEFAULTS };
// Resolver for the packing slip URL we are currently waiting on, if any.
let pendingOpen = null;

function injectStyles() {
    // Firefox re-injects content scripts into open tabs when the extension
    // updates, so an older version's <style> may already be here. Always
    // (re)write the rules rather than keeping stale ones.
    let style = document.getElementById('ese-bsc-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'ese-bsc-style';
        document.head.appendChild(style);
    }
    style.textContent = `
        .${FINICKY_CONTAINER_CLASS} {
            display: inline-flex;
            align-items: center;
            position: relative;
        }
        .${FINICKY_CONTAINER_CLASS} button {
            padding: 0;
            border: 0;
            background: transparent;
            line-height: 0;
            cursor: pointer;
            border-radius: 6px;
        }
        .${FINICKY_CONTAINER_CLASS} button img {
            height: 34px;
            width: auto;
            display: block;
            border-radius: 6px;
            transition: transform 0.1s ease, box-shadow 0.1s ease;
        }
        .${FINICKY_CONTAINER_CLASS} button:hover:not(:disabled) img {
            transform: scale(1.1);
            box-shadow: 0 0 6px #00ff88;
        }
        .${FINICKY_CONTAINER_CLASS} button:disabled {
            opacity: 0.5;
            cursor: default;
        }
        /* Sits under the icon rather than in the button row, so a message
           never wraps the row. The site's header styles (uppercase,
           letter-spacing, its font) are reset so the text reads normally. */
        .${FINICKY_CONTAINER_CLASS} .ese-bsc-status {
            position: absolute;
            top: 100%;
            right: 8px;
            white-space: nowrap;
            font: 11px/1.2 system-ui, -apple-system, sans-serif;
            text-transform: none;
            letter-spacing: normal;
            color: #005f80;
        }
        .${FINICKY_CONTAINER_CLASS} .ese-bsc-status.error {
            color: #b00020;
        }
        /* The Sort Order dialog (a MUI modal) flashes up while we click
           through it; keep it invisible until we're done. */
        html.${BUSY_CLASS} body > div[role="presentation"] {
            visibility: hidden;
        }
    `;
}

function isOrderDetailPage() {
    return window.location.pathname.startsWith(ORDER_DETAIL_PATH);
}

// The site's own buttons carry no ids, so find them by their visible label.
// The mobile layout keeps a hidden menu with the same labels mounted, so
// only visible buttons count.
function findSiteButton(label, root = document) {
    return Array.from(root.querySelectorAll('button')).find(
        (btn) => btn.textContent.trim() === label && btn.offsetParent !== null
    ) || null;
}

function setStatus(container, text, isError) {
    let status = container.querySelector('.ese-bsc-status');
    if (!status) {
        status = document.createElement('span');
        status.className = 'ese-bsc-status';
        container.appendChild(status);
    }
    status.textContent = text;
    status.classList.toggle('error', Boolean(isError));
}

function setButtonsDisabled(container, disabled) {
    container.querySelectorAll('button').forEach((btn) => { btn.disabled = disabled; });
}

// Replace the page's window.open with one that, while a Finicky click is in
// flight, swallows the packing slip URL and hands it to us instead of opening
// a tab. Everything else passes through untouched. Content scripts live in
// their own world, so this has to go through wrappedJSObject (Firefox only).
function installOpenHook() {
    const pageWindow = window.wrappedJSObject;
    if (!pageWindow || typeof exportFunction !== 'function') {
        throw new Error('Cannot reach the page window (Firefox required)');
    }
    if (pageWindow.__eseOpenHooked) return;

    const originalOpen = pageWindow.open;
    const hooked = function (url, target, features) {
        const href = String(url || '');
        if (pendingOpen && href.startsWith(PACKING_SLIP_URL_PREFIX)) {
            const resolve = pendingOpen;
            pendingOpen = null;
            resolve(href);
            // The site calls .focus() on whatever window.open returns.
            return cloneInto({ focus() {} }, pageWindow, { cloneFunctions: true });
        }
        return originalOpen.call(pageWindow, url, target, features);
    };
    pageWindow.open = exportFunction(hooked, pageWindow);
    pageWindow.__eseOpenHooked = true;
}

// Resolves with the packing slip URL once the page calls window.open() with
// it, or rejects after the timeout.
function waitForPackingSlipOpen() {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingOpen = null;
            reject(new Error('Timed out waiting for the packing slip'));
        }, GENERATE_TIMEOUT_MS);
        pendingOpen = (href) => {
            clearTimeout(timer);
            resolve(href);
        };
    });
}

// "Generate" does nothing until the packing slip API has responded (its
// onClick checks for a null href), so keep clicking it until window.open fires
// or the wait gives up.
async function clickGenerateUntilOpened(opened) {
    let done = false;
    opened.then(() => { done = true; }, () => { done = true; });
    while (!done) {
        const generate = findSiteButton(GENERATE_BUTTON_LABEL);
        if (generate) generate.click();
        await new Promise((r) => setTimeout(r, GENERATE_POLL_MS));
    }
}

// MUI modals close on Escape (listened for on the modal itself, so the
// event has to start inside it); used if the dialog is still up after a failure.
function closeSiteDialog() {
    const generate = findSiteButton(GENERATE_BUTTON_LABEL);
    if (!generate) return;
    generate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

// The packing slip has to print on a regular printer, but Firefox is set to
// silently print everything to the label printer. So hand the packing slip URL
// to Finicky, which opens it in whatever browser the user's Finicky rules pick,
// where the normal print dialog appears.
// Firefox asks once whether to open finicky:// links; the page itself stays put.
async function handleFinickyClick(container) {
    const printButton = findSiteButton(PRINT_BUTTON_LABEL);
    if (!printButton) {
        setStatus(container, 'No Print Packing Slip button', true);
        return;
    }

    setButtonsDisabled(container, true);
    setStatus(container, 'Generating…', false);
    document.documentElement.classList.add(BUSY_CLASS);

    try {
        installOpenHook();
        const opened = waitForPackingSlipOpen();
        printButton.click();
        await clickGenerateUntilOpened(opened);
        const href = await opened;
        console.log('[BSC Content] Opening packing slip via Finicky:', href);
        window.location.href = FINICKY_OPEN_PREFIX + btoa(href);
        setStatus(container, 'Sent to Finicky ✓', false);
    } catch (err) {
        console.error('[BSC Content] Error opening packing slip:', err);
        closeSiteDialog();
        setStatus(container, 'Error: ' + err.message, true);
    } finally {
        document.documentElement.classList.remove(BUSY_CLASS);
        setButtonsDisabled(container, false);
    }
}

function makeIconButton(iconPath, alt, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);

    const icon = document.createElement('img');
    icon.src = browserAPI.runtime.getURL(iconPath);
    icon.alt = alt;
    btn.appendChild(icon);
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return btn;
}

// The Finicky icon goes in the header button row, right after "Print Packing
// Slip". Each of those buttons sits in its own MUI grid item, so give ours the
// same wrapper classes to pick up the row's spacing.
function injectFinickyButton() {
    if (!settings.bscFinicky || !isOrderDetailPage()) return;
    if (document.querySelector(`.${FINICKY_CONTAINER_CLASS}`)) return;

    const printButton = findSiteButton(PRINT_BUTTON_LABEL);
    if (!printButton) return;
    const gridItem = printButton.parentElement;
    if (!gridItem) return;

    const container = document.createElement('div');
    container.className = `${gridItem.className} ${FINICKY_CONTAINER_CLASS}`;
    container.appendChild(makeIconButton(
        FINICKY_ICON,
        'Finicky',
        'Open the packing slip with Finicky to print it',
        () => handleFinickyClick(container)
    ));
    gridItem.insertAdjacentElement('afterend', container);
}

function removeInjectedButtons() {
    document.querySelectorAll(`.${FINICKY_CONTAINER_CLASS}`).forEach((el) => el.remove());
}

async function init() {
    settings = await loadSettings();
    injectStyles();
    // Drop anything an earlier version of this script left in the page (see
    // injectStyles) so the buttons match this version's layout.
    removeInjectedButtons();
    injectFinickyButton();

    // The header is rendered (and re-rendered on client-side navigation) by
    // React, so keep watching for the button row to appear.
    const observer = new MutationObserver(() => injectFinickyButton());
    observer.observe(document.body, { childList: true, subtree: true });

    // Toggling the feature in the options page takes effect without a reload.
    onSettingsChanged((updated) => {
        settings = updated;
        removeInjectedButtons();
        injectFinickyButton();
    });
}

init();
