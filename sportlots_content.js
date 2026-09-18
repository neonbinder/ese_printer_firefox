
// browser.runtime.sendMessage returns a Promise (Firefox); chrome.runtime.sendMessage uses a callback.
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

function sendMessage(message) {
    if (typeof browser !== 'undefined') {
        return browser.runtime.sendMessage(message);
    }
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

console.log('[Sportlots Content] ESE Printer Sportlots script loaded');

// Sportlots renders the paid-order list client-side into #paidBody. Each order
// row is a `.paid-grid.paid-order` element whose `a.js-pack` link carries the
// packing slip URL in `data-url`. That page is itself just a shell that fetches
// JSON from /s/node/orders/packing-slip, so we call that endpoint directly and
// never need to open the packing slip.

const PACKING_SLIP_API = '/s/node/orders/packing-slip';
const NEONBINDER_WEIGHTS_OZ = [1, 2, 3];
const PIRATESHIP_ICON = 'icons/pirateship.png';
const FINICKY_ICON = 'icons/finicky.png';
// Finicky (https://github.com/johnste/finicky) registers this URL scheme and
// base64-decodes the rest, then routes the URL by the user's ~/.finicky.js.
const FINICKY_OPEN_PREFIX = 'finicky://open/';
const BUTTON_CONTAINER_CLASS = 'ese-nb-print';

function injectStyles() {
    if (document.getElementById('ese-nb-style')) return;
    const style = document.createElement('style');
    style.id = 'ese-nb-style';
    style.textContent = `
        .${BUTTON_CONTAINER_CLASS} {
            display: inline-flex;
            align-items: center;
            vertical-align: middle;
            gap: 6px;
            margin-left: 12px;
            font-size: 11px;
            white-space: nowrap;
        }
        .${BUTTON_CONTAINER_CLASS} button {
            padding: 0;
            border: 0;
            background: transparent;
            line-height: 0;
            cursor: pointer;
            border-radius: 6px;
        }
        .${BUTTON_CONTAINER_CLASS} button img {
            height: 36px;
            width: auto;
            display: block;
            border-radius: 6px;
            transition: transform 0.1s ease, box-shadow 0.1s ease;
        }
        .${BUTTON_CONTAINER_CLASS} button:hover:not(:disabled) img {
            transform: scale(1.1);
            box-shadow: 0 0 6px #00ff88;
        }
        .${BUTTON_CONTAINER_CLASS} button:disabled {
            opacity: 0.5;
            cursor: default;
        }
        .${BUTTON_CONTAINER_CLASS} .ese-nb-status {
            color: #005f80;
        }
        .${BUTTON_CONTAINER_CLASS} .ese-nb-status.error {
            color: #b00020;
        }
    `;
    document.head.appendChild(style);
}

// Turn the packing slip page URL from the order link into the JSON API URL.
function buildPackingSlipApiUrl(packUrl) {
    const pageUrl = new URL(packUrl, window.location.origin);
    const apiUrl = new URL(PACKING_SLIP_API, window.location.origin);
    apiUrl.searchParams.set('cust_cd', pageUrl.searchParams.get('cust_cd') || '');
    apiUrl.searchParams.set('order_dt', pageUrl.searchParams.get('Order_dt') || '');
    apiUrl.searchParams.set('order_tm', pageUrl.searchParams.get('Order_tm') || '');
    apiUrl.searchParams.set('e', pageUrl.searchParams.get('e') || 'y');
    return apiUrl.toString();
}

async function fetchPackingSlip(packUrl) {
    const apiUrl = buildPackingSlipApiUrl(packUrl);
    console.log('[Sportlots Content] Fetching packing slip data:', apiUrl);
    const response = await fetch(apiUrl, { credentials: 'include' });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || !json.ok || !json.data) {
        const msg = (json && json.error) || `HTTP ${response.status}`;
        throw new Error(`Packing slip request failed: ${msg}`);
    }
    return json.data;
}

// Build the multi-line "Ship To" address that Neon Binder's paste box expects.
function buildShipToAddress(data) {
    const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const lines = [collapse(data.ship_to_name)];
    // ship_to_addr1, ship_to_addr2, ... in numeric order
    Object.keys(data)
        .filter((key) => /^ship_to_addr\d+$/.test(key))
        .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))
        .forEach((key) => lines.push(collapse(data[key])));
    return lines.filter(Boolean).join('\n');
}

function setStatus(container, text, isError) {
    let status = container.querySelector('.ese-nb-status');
    if (!status) {
        status = document.createElement('span');
        status.className = 'ese-nb-status';
        container.appendChild(status);
    }
    status.textContent = text;
    status.classList.toggle('error', Boolean(isError));
}

function setButtonsDisabled(container, disabled) {
    container.querySelectorAll('button').forEach((btn) => { btn.disabled = disabled; });
}

// Look up the order's Ship To address and card count from the packing slip
// data, then hand the resulting job to `send` (which talks to the background).
async function withOrderAddress(row, container, send) {
    const packLink = row.querySelector('a.js-pack');
    const orderId = (row.dataset.orderKey || packLink.textContent || '').trim();
    const packUrl = packLink.dataset.url;

    if (!packUrl) {
        setStatus(container, 'No packing slip URL', true);
        return;
    }

    setButtonsDisabled(container, true);
    setStatus(container, 'Loading…', false);

    try {
        const data = await fetchPackingSlip(packUrl);
        const address = buildShipToAddress(data);
        const cardCount = Number(data.total_qty) || 0;

        if (!address) {
            throw new Error('Ship To address was empty');
        }

        const doneText = await send({ orderId, address, cardCount });
        setStatus(container, doneText, false);
    } catch (err) {
        console.error('[Sportlots Content] Error preparing label:', err);
        setStatus(container, 'Error: ' + err.message, true);
    } finally {
        setButtonsDisabled(container, false);
    }
}

function assertAccepted(response) {
    if (!response || !response.success) {
        throw new Error((response && response.error) || 'Background did not accept the job');
    }
}

function handlePrintClick(row, container, weightOz) {
    return withOrderAddress(row, container, async ({ orderId, address, cardCount }) => {
        console.log('[Sportlots Content] Sending label job to Neon Binder:', { orderId, weightOz, cardCount, address });
        assertAccepted(await sendMessage({
            type: 'SPORTLOTS_PRINT_LABEL',
            job: { orderId, address, weightOz, cardCount }
        }));
        return `Sent ${weightOz} oz ✓`;
    });
}

// Pirate Ship is for the bigger orders: the extension only pastes the address
// into the form and the user picks packaging and service themselves.
function handlePirateShipClick(row, container) {
    return withOrderAddress(row, container, async ({ orderId, address, cardCount }) => {
        console.log('[Sportlots Content] Sending address to Pirate Ship:', { orderId, cardCount, address });
        assertAccepted(await sendMessage({
            type: 'SPORTLOTS_PIRATESHIP',
            job: { orderId, address, cardCount }
        }));
        return 'Sent to Pirate Ship ✓';
    });
}

// The packing slip has to print on a regular printer, but Firefox is set to
// silently print everything to the label printer. So hand the packing slip URL
// to Finicky, which opens it in Chrome where the normal print dialog appears.
// Firefox asks once whether to open finicky:// links; the page itself stays put.
function handlePackingSlipClick(row, container) {
    const packLink = row.querySelector('a.js-pack');
    const packUrl = packLink && packLink.dataset.url;
    if (!packUrl) {
        setStatus(container, 'No packing slip URL', true);
        return;
    }
    const absoluteUrl = new URL(packUrl, window.location.origin).toString();
    console.log('[Sportlots Content] Opening packing slip via Finicky:', absoluteUrl);
    window.location.href = FINICKY_OPEN_PREFIX + btoa(absoluteUrl);
    setStatus(container, 'Opened packing slip in Chrome ✓', false);
}

// Sportlots renders a hidden `.paid-lines` fill panel after each `.paid-order`
// row (shown when the user clicks "Fill Order"). Both carry the same
// data-order-key. We place the icons next to that panel's "Submit Fill" button.
function findOrderRowForPanel(panel) {
    const key = panel.dataset.orderKey;
    if (key) {
        const match = Array.from(document.querySelectorAll('.paid-order')).find((row) => row.dataset.orderKey === key);
        if (match) return match;
    }
    const prev = panel.previousElementSibling;
    return prev && prev.classList.contains('paid-order') ? prev : null;
}

function injectButtonsIntoPanel(panel) {
    if (panel.querySelector(`.${BUTTON_CONTAINER_CLASS}`)) return;

    const submitButton = panel.querySelector('button.js-submit-fill');
    if (!submitButton) return;

    const row = findOrderRowForPanel(panel);
    if (!row || !row.querySelector('a.js-pack')) return;

    const container = document.createElement('span');
    container.className = BUTTON_CONTAINER_CLASS;

    const makeButton = (iconPath, alt, title, onClick) => {
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
    };

    NEONBINDER_WEIGHTS_OZ.forEach((weightOz) => {
        const btn = makeButton(
            `icons/neonbinder-${weightOz}oz.png`,
            `${weightOz} oz`,
            `Buy and print a ${weightOz} oz label with Neon Binder`,
            () => handlePrintClick(row, container, weightOz)
        );
        btn.dataset.weight = String(weightOz);
        container.appendChild(btn);
    });

    // Pirate Ship goes last: it opens the label form with the address pasted
    // in and leaves the packaging and service choice to the user.
    container.appendChild(makeButton(
        PIRATESHIP_ICON,
        'Pirate Ship',
        'Open Pirate Ship with this address pasted in',
        () => handlePirateShipClick(row, container)
    ));

    // Finicky icon: open the packing slip in another browser (via Finicky) to
    // print it on a regular printer instead of the label printer Firefox
    // auto-prints to.
    container.appendChild(makeButton(
        FINICKY_ICON,
        'Finicky',
        'Open the packing slip in Chrome via Finicky to print it',
        () => handlePackingSlipClick(row, container)
    ));

    // Right after "Submit Fill", ahead of Sportlots' own status message span.
    submitButton.insertAdjacentElement('afterend', container);
}

function injectButtons() {
    document.querySelectorAll('.paid-lines').forEach(injectButtonsIntoPanel);
}

function init() {
    injectStyles();
    injectButtons();

    // The order list is rendered (and re-rendered on sort/filter) by Sportlots'
    // own JS, so keep watching for new rows.
    const observer = new MutationObserver(() => injectButtons());
    observer.observe(document.body, { childList: true, subtree: true });
}

init();
