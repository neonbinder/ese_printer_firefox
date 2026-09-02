# ESE Printer - eBay Standard Envelope Automation

A Firefox browser extension that automates the eBay Standard Envelope (ESE) shipping label workflow, saving you time when processing lightweight shipments.

## What Does This Extension Do?

If you sell small, lightweight items on eBay (under 2 ounces), you're probably familiar with the repetitive process of:
1. Going to your orders
2. Clicking to create a shipping label
3. Selecting "eBay Standard Envelope"
4. Clicking purchase
5. Clicking print
6. Closing the PDF
7. Going back to your orders to do it all again

**This extension automates steps 3-7 for you.**

When you navigate to create a label for an item under 2 ounces, the extension will:
- Automatically select eBay Standard Envelope (if the buyer selected it)
- Click the purchase button
- Click the print button
- Close the PDF tab
- Return you to your orders page, ready for the next one

It also works if you need to **reprint a label** - just navigate to the reprint page and it will handle the print flow automatically.

## Installation

### Firefox

1. Download this extension from [GitHub Releases](https://github.com/neonbinder/ese_printer_firefox/releases) (or clone the repository)
2. Open Firefox and go to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on"
5. Navigate to the extension folder and select the `manifest.json` file
6. The extension is now active!

> **Note:** Temporary add-ons are removed when Firefox closes. For a permanent install, use a Mozilla-signed build (see [Building and Signing](#building-and-signing)).

## Usage

1. Go to your eBay Seller Hub orders: `https://www.ebay.com/sh/ord/?filter=status:AWAITING_SHIPMENT`
2. Click on an order to create a shipping label
3. Watch the magic happen - the extension takes over from here
4. After printing, you'll be returned to your orders page automatically

### Reprint Flow

If you need to reprint a label, simply navigate to the print page for that order. The extension will detect you're on a print page and handle the print + navigation automatically.

### Sportlots → Neon Binder Flow

On the Sportlots **Orders - Paid** page (`https://sportlots.com/s/ui/paid.html`), click **Fill Order** on an order and three Neon Binder icons (1 oz, 2 oz, 3 oz) appear next to the **Submit Fill** button. Clicking one:

1. Pulls the order's **Ship To** address and card count from Sportlots' packing slip data (no packing slip window is opened)
2. Opens `https://www.neonbinder.io/print/shipping` in a new tab
3. Pastes the address, fills the fields, selects the chosen envelope weight
4. Clicks **Buy postage** once USPS has verified the address and a rate is shown
5. Waits for the label's print dialog to finish, then closes the Neon Binder tab and returns you to Sportlots

You pick the weight yourself; the extension never guesses. If anything goes wrong (address not parsed, purchase failed, print dialog never closed), the Neon Binder tab is left open so you can finish by hand, and the reason is logged to the console with a `[NeonBinder Content]` prefix.

You must already be signed in to both Sportlots and Neon Binder.

## Building and Signing

Firefox only keeps an extension installed across restarts if Mozilla has signed it. This repo uses Mozilla's [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) tool for that.

```bash
npm install          # installs web-ext locally
npm run lint         # same checks Mozilla's reviewers run
npm start            # launches Firefox with the extension loaded (auto-reloads on save)
npm run build        # unsigned zip in web-ext-artifacts/ (for Developer Edition / Nightly)
```

### Signed build for personal use (unlisted)

1. Create a free account at [addons.mozilla.org](https://addons.mozilla.org) and generate API credentials on the [API key page](https://addons.mozilla.org/developers/addon/api/key/).
2. Export them in your shell (never commit them):
   ```bash
   export WEB_EXT_API_KEY=user:xxxx:xxx
   export WEB_EXT_API_SECRET=xxxxxxxx
   ```
3. Bump `version` in `manifest.json` and `package.json` (Mozilla rejects a version it has already signed), then:
   ```bash
   npm run sign
   ```
4. Open the `.xpi` written to `web-ext-artifacts/` in Firefox. It installs permanently, and re-opening a newer `.xpi` upgrades it in place because the extension ID (`ese-printer@neonbinder.io`) stays the same.

### Public listing

To publish on addons.mozilla.org, run `npm run build` and upload the zip through the developer hub, or run `web-ext sign --channel=listed`. Listed submissions get a human review. Keep `npm run lint` clean before submitting.

## Requirements

- Firefox browser
- An eBay seller account
- Items that qualify for eBay Standard Envelope (under 2 oz)
- For the Sportlots flow: a Sportlots seller account and a Neon Binder account with EasyPost postage set up

---

## Technical Details

### Architecture

This is a Manifest v2 browser extension with two main components:

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration, permissions, and script registration |
| `background.js` | Service worker that manages tab lifecycle, PDF handling, and navigation |
| `content.js` | Content script injected into eBay pages that detects page state and automates interactions |
| `lettertrack_content.js` | Content script that auto-prints LetterTrack Pro PDF tabs |
| `sportlots_content.js` | Injects the Neon Binder weight buttons on the Sportlots paid-orders page and fetches the Ship To address |
| `neonbinder_content.js` | Drives the Neon Binder shipping page: paste address, pick weight, buy postage, report when printed |

### How It Works

1. **Content Script Injection**: The content script runs on all `*.ebay.com` pages and monitors the URL

2. **URL Detection**: The `init()` function checks the current URL and routes to the appropriate handler:
   - `/ship/single/print/` → `handlePrintLabelPage()` (print flow)
   - `/ship/single/` → `handleGetLabelTypePage()` (label purchase flow)
   - `/download` → `handlePdfDownloadPage()` (PDF handling)

3. **SPA Navigation Monitoring**: Since eBay uses client-side routing, the extension intercepts `history.pushState`, `history.replaceState`, and `popstate` events to detect navigation without full page reloads

4. **DOM Observation**: MutationObserver watches for specific elements (buttons) to appear before interacting with them

5. **Background Communication**: The content script sends messages to the background script for cross-tab operations:
   - `PRINT_PAGE_LOADED` - Registers the current tab for tracking
   - `PRINT_BUTTON_CLICKED` - Signals that printing is about to start
   - `NAVIGATE_TO_ORDERS` - Requests navigation back to the orders page
   - `SPORTLOTS_PRINT_LABEL` - Sportlots asks the background to open Neon Binder with an address + weight job
   - `NEONBINDER_GET_JOB` - The Neon Binder tab asks for the job assigned to it
   - `NEONBINDER_LABEL_PRINTED` / `NEONBINDER_JOB_FAILED` - Neon Binder reports the outcome; on success the background refocuses Sportlots and closes the Neon Binder tab

6. **PDF Tab Management**: The background script detects blob URLs from eBay (the print preview), switches focus back to the main tab, and closes the PDF tab after a delay

### File Structure

```
ese_printer/
├── manifest.json      # Extension manifest
├── background.js      # Background service worker
├── content.js         # Content script for eBay pages
├── lettertrack_content.js  # Content script for LetterTrack Pro PDFs
├── sportlots_content.js    # Content script for Sportlots paid orders
├── neonbinder_content.js   # Content script for Neon Binder shipping page
├── icons/             # Extension icons
│   ├── favicon-16x16.png
│   ├── favicon-32x32.png
│   └── ...
└── README.md          # This file
```

### Permissions

The extension requires these permissions:
- `tabs` - To manage tab focus and navigation
- `activeTab` - To interact with the current tab
- `*://*.ebay.com/*` - To run content scripts on eBay
- `*://www.lettertrackpro.com/*` - To auto-print LetterTrack Pro PDFs
- `*://sportlots.com/*`, `*://www.sportlots.com/*` - To add the Neon Binder buttons on the paid orders page
- `*://www.neonbinder.io/*` - To drive the Neon Binder shipping page

---

## Contributing

We welcome contributions! Here's how to submit a pull request:

### Setting Up for Development

1. **Fork the repository** on GitHub

2. **Clone your fork** locally:
   ```bash
   git clone git@github.com:YOUR_USERNAME/ese_printer_firefox.git
   cd ese_printer_firefox
   ```

3. **Create a new branch** for your feature or fix:
   ```bash
   git checkout -b my-feature-name
   ```

4. **Load the extension in Firefox** for testing:
   - Go to `about:debugging` → "This Firefox" → "Load Temporary Add-on"
   - Select the `manifest.json` file

### Making Changes

1. Make your code changes

2. Test thoroughly on eBay:
   - Test the full flow (new label creation)
   - Test the reprint flow
   - Check the browser console for errors (`F12` → Console tab)

3. **Commit your changes** with a descriptive message:
   ```bash
   git add .
   git commit -m "Add feature: description of what you added"
   ```

4. **Push to your fork**:
   ```bash
   git push origin my-feature-name
   ```

### Submitting a Pull Request

1. Go to the [original repository](https://github.com/neonbinder/ese_printer_firefox) on GitHub

2. Click "Pull Requests" → "New Pull Request"

3. Click "compare across forks" and select your fork and branch

4. Fill out the PR template:
   - **Title**: Brief description of the change
   - **Description**: Explain what you changed and why
   - **Testing**: Describe how you tested the changes

5. Submit the PR and wait for review

### Code Style Guidelines

- Use meaningful variable and function names
- Add console logs with `[Content]` or `[Background]` prefixes for debugging
- Comment complex logic
- Test on Firefox before submitting

---

## Troubleshooting

**The extension isn't doing anything**
- Check that the extension is loaded in `about:debugging`
- Open the browser console (`F12`) and look for `[Content]` or `[Background]` log messages
- Make sure you're on an eBay shipping page

**The print dialog doesn't appear**
- Some popup blockers may interfere - try disabling them for eBay
- Check that the PDF tab is opening (even briefly)

**It's not returning to the orders page**
- The navigation happens 4 seconds after clicking print
- Check the console for error messages

## License

MIT License - feel free to use and modify as needed.
