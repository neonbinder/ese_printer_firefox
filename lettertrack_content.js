// Use browser API if available (Firefox), otherwise chrome API (Chrome)
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Only act on PDF URLs
if (window.location.href.match(/\.pdf($|\?)/i)) {
  console.log('[LetterTrack Content] PDF page detected:', window.location.href);

  // Wait for PDF.js to fully render the PDF, then trigger print
  setTimeout(() => {
    console.log('[LetterTrack Content] Triggering print...');
    window.print();

    // Notify background script so it can switch focus back and close this tab
    browserAPI.runtime.sendMessage({ type: 'LETTERTRACK_PRINTED' });
  }, 2500);
}
