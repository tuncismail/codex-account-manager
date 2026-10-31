# Codex Account Manager

Independent VS Code extension for switching isolated Codex profiles through
`CODEX_HOME`. It never reads, copies, exports, or transmits credentials.

## Features

- Named profiles and one-click switching from the status bar.
- Profile directories are isolated; switching updates the configured Codex
  extension environment setting and asks for a VS Code reload.
- Local activity summary (file count and storage size), without pretending to
  know OpenAI's server-side quota.
- Optional local activity thresholds and automatic failover to the next eligible
  profile.
- Profile removal only removes it from the list; its directory is preserved.

## Install

Download the `.vsix` from the repository Releases page, then use **Extensions:
Install from VSIX...** in VS Code. For development, run `npm test` and press
`F5` in VS Code.

The default environment setting is `chatgpt.environmentVariables`, matching the
Codex extension's environment-variable configuration pattern. If your installed
Codex extension exposes a different setting, change
`codexAccountManager.environmentSetting` to `section.setting`.

The extension uses the official `CODEX_HOME` mechanism. It does not merge
histories or credential files between profiles.
