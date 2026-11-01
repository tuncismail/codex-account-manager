# Changelog

## 0.5.0 — 2026-11-01

- Add account row actions and import of existing account folders.
- Add diagnostics that omit personal paths and account identity.
- Add disconnect to restore the previous Codex CLI setting.
- Keep new installations inactive until an account is selected.
- Make session sharing optional; preserve older linked setups.
- Preserve nested session histories and backups when sharing is enabled.
- Ignore workspace overrides for account paths and handle malformed settings.
- Protect active accounts from accidental removal.
- Detect stale selections in other windows and unsupported environments.
- Remove misleading file-count quotas and automatic failover.
- Replace account-specific test paths with disposable fixtures and opt-in tests.
- Add locked build tooling, Windows packaging, CI, and contributor documentation.

## 0.4.0

- Switch accounts with Reload Window and a native Windows launcher.
- Persist selection despite an inherited CODEX_HOME environment.
- Forward Codex CLI protocol and clean up child processes on reload.
- Remove application quit and external restart helper behavior.
