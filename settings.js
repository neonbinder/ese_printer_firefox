// Feature toggles, shared by the background, content scripts, and options page.
// Stored in browser.storage.local; every flag defaults to on.
//
// Loaded before the script that uses it (see manifest.json), so it must not
// declare anything the other scripts also declare at top level.

const ESE_SETTINGS_DEFAULTS = {
    ebay: true,                 // eBay label auto-print flow (content.js + background)
    lettertrack: true,          // LetterTrack Pro PDF auto-print (BuySportsCards)
    bscFinicky: true,           // Finicky packing slip button on BuySportsCards order detail
    sportlotsNeonBinder: true,  // 1/2/3 oz Neon Binder buttons on Sportlots
    sportlotsPirateShip: true,  // Pirate Ship button on Sportlots
    sportlotsFinicky: true      // Finicky packing slip button on Sportlots
};

function eseStorage() {
    return (typeof browser !== 'undefined' ? browser : chrome).storage.local;
}

// Resolves to the full settings object with defaults filled in.
function loadSettings() {
    return eseStorage().get(ESE_SETTINGS_DEFAULTS);
}

function saveSettings(partial) {
    return eseStorage().set(partial);
}

// Calls `callback(settings)` with the full settings object whenever any flag changes.
function onSettingsChanged(callback) {
    (typeof browser !== 'undefined' ? browser : chrome).storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!Object.keys(changes).some((key) => key in ESE_SETTINGS_DEFAULTS)) return;
        loadSettings().then(callback);
    });
}
