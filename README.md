# NotebookLM Web Clipper Lite

This is a lightweight Chrome extension that clips the current page into a specific NotebookLM notebook.

## What it does

- Saves the current page with explicit `URL first` and `Text first` actions
- Saves the current browser selection with `Selection first` from the right-click menu
- Remembers your default notebook selection or fallback notebook URL
- Keeps a small recent-history list in the side panel

## Architecture

The extension now follows a modular flow:

- `adapters/` extract site content into a normalized `ClipDocument`
- `writers/` send that document to a destination
- `storage/` persists settings and clip history
- `background/jobRunner` coordinates dedupe checks, writer execution, and history updates

The current shipping path is:

`web page -> web adapter -> ClipDocument -> NotebookLM RPC writer -> NotebookLM batchexecute`

The extension also includes a lightweight NotebookLM data layer for:

- listing notebooks so the popup and side panel can offer a picker
- listing existing sources in the selected notebook for duplicate checks before writing
- writing URL and copied-text sources through NotebookLM's internal RPC endpoints

That data layer now handles both read and write operations.

## Why it works this way

NotebookLM does not expose a documented public clipping API for this flow, so this MVP uses NotebookLM's undocumented web RPC endpoints directly.

## Load it in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:

   `/Users/sakai.toyo/repos/karpathy`

## Use it

1. Open the NotebookLM notebook you want to clip into.
2. Copy its URL.
3. Open the extension popup and paste that URL into `Notebook URL`, or pick a notebook from the list.
4. Browse to any normal web page and use one of these entry points:
   - `URL first` sends the page URL as a website source
   - `Text first` extracts the page body and sends it as copied text
   - `Selection first` is available from the page right-click menu and sends the highlighted text as copied text

The side panel offers the same `URL first` and `Text first` buttons after you choose a notebook.

## Test commands

- `npm run test:unit`
- `npm run test:e2e`

`npm run test:e2e` runs a browser automation flow against local mock pages and verifies extraction logic in Chrome.

## Current limitations

- NotebookLM listing, duplicate checks, and writes depend on NotebookLM web RPCs that are not publicly documented.
- Real authenticated NotebookLM flows were not end-to-end validated here because they require a signed-in user session.
- The included browser automation tests do not hit the real NotebookLM RPC service.
