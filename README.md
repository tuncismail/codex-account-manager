# Codex Account Manager

Independent VS Code extension for switching isolated Codex profiles through
`CODEX_HOME`. It never reads, copies, exports, or transmits credentials.

## Features

- Named profiles and one-click switching from the status bar.
- Profile directories are isolated; switching updates the configured Codex
  extension environment setting and asks for a VS Code reload.
- Session transcripts and the session index are shared across profiles, so a
  conversation can be resumed after switching accounts. Credentials, config,
  caches, and other account state remain isolated.
- Local activity summary (file count and storage size), without pretending to
  know OpenAI's server-side quota.
- Optional local activity thresholds and automatic failover to the next eligible
  profile.
- Profile removal only removes it from the list; its directory is preserved.

## Install

Download the `.vsix` from the repository Releases page, then use **Extensions:
Install from VSIX...** in VS Code. For development, run `npm test` and press
`F5` in VS Code.

The installed Codex extension does not expose a writable
`chatgpt.environmentVariables` setting. By default the manager sets
`CODEX_HOME` as a Windows user environment variable and in the current
extension host. Reload the VS Code window after switching so the Codex extension inherits
the selected profile. An optional registered setting can be configured with
`codexAccountManager.environmentSetting` as `section.setting`.

The extension uses the official `CODEX_HOME` mechanism. It does not merge
credentials between profiles. On first activation it links each profile's
`sessions` directory and `session_index.jsonl` to the default Codex home,
preserving a backup if migration is needed. Do not run two active Codex
sessions that write the same conversation at the same time.
