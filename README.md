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

> **Note:** Temporary add-ons are removed when Firefox closes. For permanent installation, the extension needs to be signed by Mozilla.

## Usage

1. Go to your eBay Seller Hub orders: `https://www.ebay.com/sh/ord/?filter=status:AWAITING_SHIPMENT`
2. Click on an order to create a shipping label
3. Watch the magic happen - the extension takes over from here
4. After printing, you'll be returned to your orders page automatically

### Reprint Flow

If you need to reprint a label, simply navigate to the print page for that order. The extension will detect you're on a print page and handle the print + navigation automatically.

## Requirements

- Firefox browser
- An eBay seller account
- Items that qualify for eBay Standard Envelope (under 2 oz)

---

## Technical Details

### Architecture

This is a Manifest v2 browser extension with two main components:

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration, permissions, and script registration |
| `background.js` | Service worker that manages tab lifecycle, PDF handling, and navigation |
| `content.js` | Content script injected into eBay pages that detects page state and automates interactions |

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

6. **PDF Tab Management**: The background script detects blob URLs from eBay (the print preview), switches focus back to the main tab, and closes the PDF tab after a delay

### File Structure

```
ese_printer/
├── manifest.json      # Extension manifest
├── background.js      # Background service worker
├── content.js         # Content script for eBay pages
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
