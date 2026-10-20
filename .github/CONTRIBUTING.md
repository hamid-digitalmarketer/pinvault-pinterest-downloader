# Contributing to PinVault

Thanks for your interest. PinVault values reliability, privacy, and maintainability over feature volume.

## Principles

- **Local-first.** No cloud sync, analytics, telemetry, or uploads of user content.
- **Dependency-free runtime.** New features should not add external runtime dependencies or remote code.
- **Least privilege.** New features should not require broader permissions when a scoped approach exists.
- **No bypasses.** We do not bypass DRM, logins, CAPTCHAs, rate limits, or access controls.
- **Honest limitations.** Unsupported behavior is documented as a limitation, never faked.

## Workflow

1. Open an issue for significant changes before writing code (use the issue templates).
2. Fork the repository and create a feature branch.
3. Keep changes focused; update `CHANGELOG.md` for user-visible changes.
4. For `lib/` changes, add unit tests in `tests/` and fixtures in `tests/fixtures/`.
5. Run `node tests/run-tests.js` — all tests must pass.
6. Run the build validation: `powershell -ExecutionPolicy Bypass -File scripts\build.ps1` (Windows) or `node scripts/validate-build.js` (any OS).
7. Open a pull request referencing the issue.

## Code style

- Vanilla JavaScript (ES2020+), no transpilation step.
- UMD-style shared modules in `lib/` (usable in service worker ESM, extension pages, and Node tests).
- No sensitive data in logs (never URLs, pin ids, filenames, or content).
- Comment intent, not mechanics.

## Security

Report security issues privately (see `SUPPORT.md`) rather than opening a public issue. Never commit credentials, user data, downloaded private content, or secrets.
