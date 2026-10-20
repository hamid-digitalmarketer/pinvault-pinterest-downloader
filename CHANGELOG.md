# Changelog

All notable changes to PinVault are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning: [SemVer](https://semver.org/).

## [1.0.0] - 2026-10-20

### Added
- Manifest V3 extension, `minimum_chrome_version: 116`, module service worker.
- Least-privilege permissions: `storage`, `downloads`, `activeTab`; host permissions scoped to Pinterest domains only (`*://*.pinterest.com/*`, `*://*.pinimg.com/*`, `https://pin.it/*`).
- Content script with hover overlay download button, defensive multi-selector pin detection, and MutationObserver-driven lazy-load capture.
- Pin media extraction (`lib/pin-extractor.js`) from DOM and embedded JSON; highest-accessible-resolution selection; login-walled variant exclusion.
- Video pin detection for directly accessible MP4/WebM; explicit `hls_segmented`/DRM unsupported reasons (no bypass).
- Popup: quick download (paste URL incl. `pin.it` short links), scan current page, mini queue/progress, recent history, settings shortcuts, dark/light theme.
- Dashboard: collect/filter/select grid, bulk queue with progress/pause/cancel/retry, named local collections, history screen, CSV/JSON export, settings, help/troubleshooting.
- Shared dependency-free library: `url-utils`, `pin-extractor`, `filename-utils`, `duplicate-utils`, `queue`, `storage`, `messaging`, `export-utils`.
- Download queue: bounded concurrency (default 3), retry with exponential backoff, cancellation, duplicate detection (URL normalization + pin id), service-worker restart recovery, `chrome.storage.local` persistence.
- Filename templates: `pinterest-title-001.jpg`, `board-name_pin-id.jpg`, `yyyy-mm-dd_pin-id.webp`; sanitization + path-traversal protection.
- Automated tests: 65 unit tests across filename/URL/duplicate/pin-extractor/queue/export; zero-dependency runner (`node tests/run-tests.js`).
- Build pipeline: `scripts/validate-build.js` (manifest contract + JS syntax + tests) and `scripts/build.ps1` (produces `dist/pinvault-pinterest-downloader-1.0.0.zip`).
- Original icons: 16/32/48/128 PNG + SVG source.
- Documentation: README, architecture, privacy policy, troubleshooting, limitations, competitor analysis, store listing kit, issue templates, CI workflow.
- MIT LICENSE.

### Known limitations (1.0.0)
- No segmented HLS/DRM video download; unsupported videos are explained, not broken.
- No format conversion; no perceptual near-duplicate hashing (roadmap).
- No screenshots or live store verification yet; publication requires final branding and a verified support contact.
