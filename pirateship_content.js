// browser.runtime.sendMessage returns a Promise (Firefox); chrome.runtime.sendMessage uses a callback.
function sendMessage(message) {
    if (typeof browser !== 'undefined') {
        return browser.runtime.sendMessage(message);
    }
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

console.log('[PirateShip Content] ESE Printer Pirate Ship script loaded');

// This script only acts when the background script has a pending address job
// for this tab (created by the Sportlots Pirate Ship button). Opening the page
// by hand does nothing.
//
// Unlike the Neon Binder flow, this one stops after the address is pasted in.
// Pirate Ship is used for bigger orders where the user has to pick the
// packaging and service themselves, so the tab is left open for them.

// Pirate Ship is a single-page app: if the user is not signed in it bounces to
// the login page and then routes back to the shipping form client-side, so
// allow plenty of time for the form to show up.
const FORM_TIMEOUT_MS = 180000;
const STEP_TIMEOUT_MS = 20000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll + observe until `predicate()` returns a truthy value.
function waitFor(predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let observer = null;
        let interval = null;
        let timer = null;

        const cleanup = () => {
            if (observer) observer.disconnect();
            if (interval) clearInterval(interval);
            if (timer) clearTimeout(timer);
        };

        const check = () => {
            let result = null;
            try { result = predicate(); } catch (e) { result = null; }
            if (result) {
                cleanup();
                resolve(result);
                return true;
            }
            return false;
        };

        if (check()) return;

        observer = new MutationObserver(check);
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        interval = setInterval(check, 250);
        timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for ${description}`));
        }, timeoutMs);
    });
}

function isVisible(element) {
    return Boolean(element && element.offsetParent !== null);
}

// The "Paste Address" link next to the "Ship To" heading is a
// <button aria-label="Show paste textfield">Paste Address</button>; the
// aria-label flips to "Hide paste textfield" once the box is open, so it is a
// toggle. Match on the visible text since the class names are generated.
function findPasteAddressLink() {
    return Array.from(document.querySelectorAll('button'))
        .find((el) => /^paste address$/i.test((el.textContent || '').trim()) && isVisible(el)) || null;
}

// The paste box is <textarea name="pasteAddress.address"> with a placeholder
// starting "Paste the full or partial address here". Fall back to the
// placeholder in case the field name changes.
function findPasteBox() {
    const textareas = Array.from(document.querySelectorAll('textarea')).filter(isVisible);
    return textareas.find((t) => t.name === 'pasteAddress.address')
        || textareas.find((t) => /paste the full or partial address/i.test(t.placeholder || ''))
        || null;
}

// React ignores direct `.value =` assignment; go through the native setter and
// fire an input event so the controlled component picks it up.
function setReactValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function getPendingJob() {
    // The background registers the job right after creating this tab, so retry
    // briefly in case this script runs before that registration lands.
    for (let attempt = 0; attempt < 10; attempt++) {
        const response = await sendMessage({ type: 'PIRATESHIP_GET_JOB' });
        if (response && response.job) return response.job;
        await sleep(300);
    }
    return null;
}

async function runJob(job) {
    console.log('[PirateShip Content] Running address job:', job);

    // 1. Wait for the shipping form (the "Paste Address" link or an already
    //    open paste box), which may come after a login redirect.
    await waitFor(() => findPasteBox() || findPasteAddressLink(), 'Pirate Ship shipping form', FORM_TIMEOUT_MS);

    // 2. Open the paste box if it is not showing yet. Clicking the link when
    //    the box is already open would just toggle it closed.
    let pasteBox = findPasteBox();
    if (!pasteBox) {
        const link = findPasteAddressLink();
        console.log('[PirateShip Content] Clicking "Paste Address"');
        link.click();
        pasteBox = await waitFor(findPasteBox, 'address paste box');
    }

    // 3. Paste the address; Pirate Ship parses it into the shipToAddress.*
    //    fields (fullName, address1, city, regionCode, postcode) on input.
    pasteBox.focus();
    setReactValue(pasteBox, job.address);
    pasteBox.scrollIntoView({ block: 'center' });

    // Confirm the parse landed so a silent failure shows up in the console.
    await waitFor(() => {
        const name = document.querySelector('input[name="shipToAddress.fullName"]');
        const zip = document.querySelector('input[name="shipToAddress.postcode"]');
        return name && zip && name.value.trim() && zip.value.trim();
    }, 'parsed Ship To fields');
    console.log('[PirateShip Content] Address pasted and parsed; leaving the rest to the user');

    sendMessage({ type: 'PIRATESHIP_ADDRESS_PASTED' });
}

async function init() {
    const job = await getPendingJob();
    if (!job) {
        console.log('[PirateShip Content] No pending address job for this tab; doing nothing');
        return;
    }

    try {
        await runJob(job);
    } catch (err) {
        // Leave the tab open so the user can paste the address by hand.
        console.error('[PirateShip Content] Address job failed:', err);
        sendMessage({ type: 'PIRATESHIP_JOB_FAILED', error: err.message });
    }
}

init();
