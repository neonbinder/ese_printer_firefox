
// browser.runtime.sendMessage returns a Promise (Firefox); chrome.runtime.sendMessage uses a callback.
function sendMessage(message) {
    if (typeof browser !== 'undefined') {
        return browser.runtime.sendMessage(message);
    }
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

console.log('[NeonBinder Content] ESE Printer Neon Binder script loaded');

// This script only acts when the background script has a pending label job
// for this tab (created by the Sportlots "Neonbinder: 1 oz / 2 oz / 3 oz"
// buttons). Opening the page by hand does nothing.

const STEP_TIMEOUT_MS = 20000;      // waiting for page elements
const PRINT_TIMEOUT_MS = 180000;    // waiting for the user to finish the print dialog
const CLOSE_DELAY_MS = 2000;        // give the print job time to spool before closing

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

function findButtonByText(pattern) {
    return Array.from(document.querySelectorAll('button')).find((btn) => pattern.test(btn.textContent.trim()));
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
        const response = await sendMessage({ type: 'NEONBINDER_GET_JOB' });
        if (response && response.job) return response.job;
        await sleep(300);
    }
    return null;
}

// Neon Binder prints by appending a hidden iframe, calling print() on it, and
// removing it when the dialog closes. It then resets the form. Resolve once
// either of those happens.
function waitForPrintCompletion() {
    return new Promise((resolve, reject) => {
        let sawPrintFrame = false;
        let observer = null;
        let timer = null;

        const isPrintFrame = (node) =>
            node instanceof HTMLIFrameElement && node.getAttribute('aria-hidden') === 'true';

        const finish = (reason) => {
            observer.disconnect();
            clearTimeout(timer);
            resolve(reason);
        };

        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (isPrintFrame(node)) {
                        sawPrintFrame = true;
                        console.log('[NeonBinder Content] Print frame appeared');
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (sawPrintFrame && isPrintFrame(node)) {
                        finish('print frame removed');
                        return;
                    }
                }
            }

            // Fallback: the form is cleared after a successful purchase + print.
            const nameInput = document.getElementById('to-name');
            if (sawPrintFrame && nameInput && nameInput.value.trim() === '') {
                finish('form reset');
                return;
            }

            // Purchase failure: the page shows an error and leaves the form intact.
            const errorText = Array.from(document.querySelectorAll('[role="alert"], p, div'))
                .map((el) => el.textContent || '')
                .find((text) => /Could not buy the label|print dialog didn't open/i.test(text));
            if (errorText) {
                observer.disconnect();
                clearTimeout(timer);
                reject(new Error(errorText.trim()));
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });

        timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timed out waiting for the label to print'));
        }, PRINT_TIMEOUT_MS);
    });
}

async function runJob(job) {
    console.log('[NeonBinder Content] Running label job:', job);

    // 1. Paste the address
    const pasteBox = await waitFor(() => document.getElementById('to-paste'), 'address paste box');
    setReactValue(pasteBox, job.address);

    // 2. Fill fields from the pasted text
    const fillButton = await waitFor(() => {
        const btn = findButtonByText(/^Fill fields$/i);
        return btn && !btn.disabled ? btn : null;
    }, 'Fill fields button');
    fillButton.click();

    await waitFor(() => {
        const name = document.getElementById('to-name');
        const zip = document.getElementById('to-postal-code');
        return name && zip && name.value.trim() && zip.value.trim();
    }, 'parsed address fields');
    console.log('[NeonBinder Content] Address fields filled');

    // 3. Choose the envelope weight
    const weightRadio = await waitFor(
        () => document.querySelector(`input[name="weight-oz"][value="${job.weightOz}"]`),
        `${job.weightOz} oz weight option`
    );
    if (!weightRadio.checked) {
        weightRadio.click();
    }
    weightRadio.scrollIntoView({ block: 'center' });

    // 4. Wait for the rate for that weight, then buy
    const buyButton = await waitFor(() => {
        const btn = findButtonByText(/^Buy postage/i);
        const selected = document.querySelector(`input[name="weight-oz"][value="${job.weightOz}"]`);
        return btn && !btn.disabled && selected && selected.checked && /—/.test(btn.textContent) ? btn : null;
    }, 'Buy postage button with a rate');

    window.scrollTo({ top: document.body.scrollHeight });
    buyButton.scrollIntoView({ block: 'center' });
    console.log('[NeonBinder Content] Clicking:', buyButton.textContent.trim());

    const completion = waitForPrintCompletion();
    buyButton.click();

    const reason = await completion;
    console.log('[NeonBinder Content] Label printed (' + reason + '), closing tab shortly');

    await sleep(CLOSE_DELAY_MS);
    sendMessage({ type: 'NEONBINDER_LABEL_PRINTED' });
}

async function init() {
    const job = await getPendingJob();
    if (!job) {
        console.log('[NeonBinder Content] No pending label job for this tab; doing nothing');
        return;
    }

    try {
        await runJob(job);
    } catch (err) {
        // Leave the tab open so the user can see what happened and finish by hand.
        console.error('[NeonBinder Content] Label job failed:', err);
        sendMessage({ type: 'NEONBINDER_JOB_FAILED', error: err.message });
    }
}

init();
