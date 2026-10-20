# PinVault — Pre-Submission Compliance Checklist

Use before publishing to the Chrome Web Store or creating a release. All items must be verifiable, not assumed.

## Extension integrity

- [ ] `scripts/build.ps1` runs cleanly and produces `dist/pinvault-pinterest-downloader-1.0.0.zip`.
- [ ] `node scripts/validate-build.js` passes (manifest contract, required files, JS syntax, tests).
- [ ] `node tests/run-tests.js` reports `TOTAL: 65 passed, 0 failed`.
- [ ] Extension loads unpacked in a clean Chrome profile ≥ 116 with no console errors.
- [ ] No remote code, no external runtime dependencies, no build step.

## Permissions

- [ ] Permissions are exactly `storage`, `downloads`, `activeTab`.
- [ ] Host permissions are scoped only to `*://*.pinterest.com/*`, `*://*.pinimg.com/*`, `https://pin.it/*`.
- [ ] No optional permissions requested at runtime.

## Privacy & security

- [ ] No analytics, telemetry, or advertising SDKs.
- [ ] No uploads of user content; downloads initiated only by the user.
- [ ] Filenames sanitized; path traversal rejected (`lib/filename-utils.js` tests).
- [ ] All cross-component messages validated (`lib/messaging.js`).
- [ ] Logs contain no sensitive data.
- [ ] "Erase all PinVault data" action works from dashboard Settings → Privacy.
- [ ] Privacy policy (`docs/privacy-policy.md`) matches actual behavior.

## Listing assets

- [ ] Icon 128×128 PNG (original design, no Pinterest logo).
- [ ] Promotional tile 440×280 created from original assets.
- [ ] Screenshots captured from a verified Chrome profile (see `docs/store-listing.md` guide) — no fabricated captures.
- [ ] Support contact replaced with a verified address (`.github/SUPPORT.md`, docs).
- [ ] Privacy policy URL hosted and linked in the listing.

## Legal

- [ ] No copied competitor code, branding, or copyrighted assets.
- [ ] No claims of publication/approval before actual confirmation.
- [ ] Copyright reminder present in README and privacy policy.

## Release

- [ ] Version bumped in `manifest.json` and `CHANGELOG.md` per SemVer.
- [ ] Release ZIP uploaded and re-verified after upload (hash check).
- [ ] Known limitations documented in `docs/limitations.md` and README.
