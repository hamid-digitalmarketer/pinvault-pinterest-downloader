# PinVault — Pinterest Image & Video Downloader

PinVault is a local-first Chrome extension (Manifest V3) for saving Pinterest images and **directly accessible** videos with the best available resolution, smart filenames, bulk download queues, duplicate detection, collections, and CSV/JSON inventory export.

**No build step, no runtime dependencies, vanilla JavaScript.** Request only the permissions it needs and never transmits your data.

> **Legal reminder:** Save only content you are authorized to save. Respect creator rights and applicable copyright law. PinVault does not bypass DRM, logins, CAPTCHAs, or rate limits.

## Features

- **Hover quick download** — a download button appears over Pinterest pins (home feed, boards, search, pin pages).
- **Popup quick download** — paste a pin URL (including `pin.it` short links) and download it directly.
- **Page scan** — collect media from the current board/search/pin page into the dashboard.
- **Bulk downloads** — bounded-concurrency queue (default 3), progress, pause, resume, cancel, and retry with backoff.
- **Filters & selection** — orientation, minimum dimensions, format, duplicate status; select all / deselect / individual selection with preview.
- **Highest accessible resolution** — picks the widest accessible CDN variant and excludes login-walled variants.
- **Smart naming** — configurable templates: `pinterest-title-001.jpg`, `board-name_pin-id.jpg`, `yyyy-mm-dd_pin-id.webp`; sanitized, path-traversal-safe filenames.
- **Duplicate prevention** — normalized media URLs and pin ids keep repeats out of your Downloads.
- **Collections** — save collected media records into named local collections.
- **History** — review past downloads, retry failures, clear independently of Chrome's download history.
- **CSV/JSON export** — media inventory with pin URL, dimensions, format, and status.
- **Light/dark/system theme**, keyboard-navigable, accessible UI.
- **Video support** — direct MP4/WebM downloads; segmented HLS and DRM-protected videos are explicitly marked unsupported (never bypassed).
- **Privacy** — local-first; one-click "Erase all PinVault data".

## Install (developer mode, load unpacked)

1. Download the release ZIP (`dist/pinvault-pinterest-downloader-1.0.0.zip`) and extract it, **or** clone the repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder that contains `manifest.json` (the project root, e.g. `D:\pin extension\PinVault`).
5. Pin the PinVault toolbar icon. Visit a Pinterest board and hover a pin to test.

To repackage from source: `powershell -ExecutionPolicy Bypass -File scripts\build.ps1`.

## Usage

### Quick download
- **Hover:** hover any pin → click the download button.
- **Popup:** click the PinVault toolbar icon → paste a pin URL → **Download**. The popup also shows the current page's media count, a mini queue, and recent history.

### Bulk download
1. Open the dashboard (`chrome://extensions` → PinVault → Details → Extension options, or right-click the toolbar icon → Options).
2. Go to **Collect** → **Scan current page** (or scroll and re-scan to capture lazy-loaded pins).
3. Filter and select media, then **Download selected**.
4. Watch progress in **Bulk downloads**; pause, cancel, retry as needed.

### Collections, history, exports
- **Collections:** create a named collection and add selected media records.
- **History:** review downloads, retry failed items, clear history.
- **Export:** export the current inventory as CSV or JSON.

## Permissions explained

| Permission | Why |
| --- | --- |
| `storage` | Store settings/history/queue/collections/duplicate index locally |
| `downloads` | Save media through Chrome's Downloads API |
| `activeTab` | Read the active Pinterest tab when you click the popup |
| Host: `*://*.pinterest.com/*`, `*://*.pinimg.com/*`, `https://pin.it/*` | Operate only on Pinterest and its media CDN |

## Privacy & copyright notice

PinVault is local-first: no accounts, no tracking, no analytics, no uploads. All data stays in `chrome.storage.local` and can be erased at any time. See [docs/privacy-policy.md](docs/privacy-policy.md). You are responsible for having a lawful basis to save, reproduce, or redistribute content.

## Developer setup

Requirements: Node.js ≥ 16 (for tests/build validation), PowerShell 5.1+ (Windows) or any shell for `node`.

```bash
# Run the automated test suite
node tests/run-tests.js

# Validate + package (Windows)
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

Project layout:

```
background/   service worker (queue, downloads, persistence, recovery)
content/      Pinterest page integration (overlay, scan, MutationObserver)
popup/        toolbar popup UI
dashboard/    full-page manager UI
lib/          shared, dependency-free, unit-testable modules
icons/        original icon assets (PNG + SVG)
tests/        Node unit tests + fixtures
scripts/      build + validation scripts
docs/         architecture, privacy, troubleshooting, limitations, listing
```

## Tests

`tests/run-tests.js` is a zero-dependency runner. It covers filename sanitization, URL validation, pin-extractor parsing, duplicate detection, queue logic, and CSV/JSON export correctness.

```bash
node tests/run-tests.js
# => TOTAL: 65 passed, 0 failed
```

## Known limitations

- Videos: only directly accessible MP4/WebM are downloadable; segmented HLS (`m3u8`) and DRM-protected videos are reported as unsupported.
- Private/login-gated content requires your own authorized, signed-in session; PinVault never bypasses authentication.
- Pinterest may change its DOM; automatic detection is defensive but not immune. Manual URL paste always works as a fallback.
- PinVault saves the highest **accessible** variant; it cannot recover originals Pinterest does not expose.
- No format conversion in 1.0.0.

Full details: [docs/limitations.md](docs/limitations.md) and [docs/troubleshooting.md](docs/troubleshooting.md).

## Roadmap

- Perceptual near-duplicate detection (visual similarity) as an optional, fully-local mode
- Optional import/export of settings
- Internationalization (i18n) framework and first additional languages
- Format conversion behind a safe, policy-reviewed implementation
- Verified screenshots and Chrome Web Store submission (after final branding and support contact)

## Contributing

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) if present, otherwise: open an issue first for significant changes, keep changes dependency-free, add tests for lib changes, run `node tests/run-tests.js` and the build script before submitting a PR. Never commit credentials, user data, downloaded private content, or secrets.

## License

MIT — see [LICENSE](LICENSE).
