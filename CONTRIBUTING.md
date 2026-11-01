# Contributing

Use Node.js 22+ and npm. Build Windows components with the .NET Framework 4.x
compiler; no private SDK, global npm package, or signed-in account is required.

Run npm ci, npm run build, npm run check, npm test, npm run test:launcher,
npm run audit:source, npm audit, and npm run package before submitting a Windows
change. Linux unit tests run without building the launcher; Windows integration
tests are skipped.

## Integration checks

npm run test:vscode opens a separate desktop VS Code instance with its own
extensions and user data. It uses the installed official Codex extension and
disposable signed-out account directories. Set CAM_VSCODE_EXE or
CAM_CODEX_EXTENSION for nonstandard installations.

npm run test:accounts is an optional authentication check. It requires:

- CAM_TEST_HOME_A: absolute directory of a signed-in test account.
- CAM_TEST_HOME_B: absolute directory of a different signed-in test account.
- Optional CAM_CODEX_EXE: executable path; otherwise the installed official
  extension supplies the CLI.

These values belong in your local shell, never in source.
The check reads account identity through Codex app-server, compares direct and
launcher results, and does not print or copy credentials. Codex itself may update
files within the supplied account directories.

## Changes

Keep runtime code free of third-party npm dependencies unless a change needs them
and the tradeoff is documented. Keep platform assumptions explicit.
Add regression coverage for account selection, reload, filesystem changes, or
process lifetime changes. Do not upload account files, transcripts, global storage,
raw launch logs, or personal machine paths.

The source audit is an offline heuristic, not a complete security scanner.
Review the staged diff as well.

The scoped minimatch override fixes GHSA-g3hv-75wg-m249 in vsce's dependency tree.
Test package contents before changing or removing it.

## Packaging

npm run package compiles the launcher and creates a Windows x64 VSIX.
The package uses an explicit allowlist in .vscodeignore. Inspect the archive
before release. Generated executables and VSIX files are excluded from Git.

GitHub Actions uploads build artifacts for review. Publishing to GitHub Releases
or the Marketplace is a separate maintainer action; no publishing credentials or
automatic publication workflow are included.

## Repository artwork

The README cover is an interface illustration with fictional account labels.
Edit assets/banner.svg, then run scripts/render-banner.ps1 on Windows to regenerate
assets/banner.png with Chrome or Edge. The rendered image is committed so building
or installing the extension does not require a browser. The script uses a separate
temporary browser profile.
