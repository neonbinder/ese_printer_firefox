
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
            width: 32px;
            height: 32px;
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

async function handlePrintClick(row, container, weightOz) {
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

        console.log('[Sportlots Content] Sending label job to Neon Binder:', { orderId, weightOz, cardCount, address });

        const response = await sendMessage({
            type: 'SPORTLOTS_PRINT_LABEL',
            job: { orderId, address, weightOz, cardCount }
        });

        if (!response || !response.success) {
            throw new Error((response && response.error) || 'Background did not accept the job');
        }

        setStatus(container, `Sent ${weightOz} oz ✓`, false);
    } catch (err) {
        console.error('[Sportlots Content] Error preparing label:', err);
        setStatus(container, 'Error: ' + err.message, true);
    } finally {
        setButtonsDisabled(container, false);
    }
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

    NEONBINDER_WEIGHTS_OZ.forEach((weightOz) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = `Buy and print a ${weightOz} oz label with Neon Binder`;
        btn.setAttribute('aria-label', btn.title);

        const icon = document.createElement('img');
        icon.src = browserAPI.runtime.getURL(`icons/neonbinder-${weightOz}oz.png`);
        icon.alt = `${weightOz} oz`;
        btn.appendChild(icon);
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handlePrintClick(row, container, weightOz);
        });
        container.appendChild(btn);
    });

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
