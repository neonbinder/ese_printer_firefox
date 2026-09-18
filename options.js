// Options page: one checkbox per flag in ESE_SETTINGS_DEFAULTS, saved on change.

const savedNote = document.getElementById('saved');

loadSettings().then((settings) => {
    Object.keys(ESE_SETTINGS_DEFAULTS).forEach((key) => {
        const box = document.getElementById(key);
        if (!box) return;
        box.checked = Boolean(settings[key]);
        box.addEventListener('change', () => {
            saveSettings({ [key]: box.checked }).then(() => {
                savedNote.textContent = 'Saved. Reload any open eBay or Sportlots tab to apply.';
            });
        });
    });
});
