# Changelog

All notable changes to FlowCommand will be documented in this file.

## [2.0.6] - 2025-02-15

### Fixed

- Plan review now reliably shows on remote session reconnect/refresh
- Plan review stale modal now properly closes after IDE approval during disconnect
- Error isolation in `applyInitialState`: each state section wrapped in try-catch to prevent cascading failures
- Stale `planReviewResponse` messages filtered from queue on reconnect
- Added try-catch in `handleExtensionMessage` to prevent uncaught errors from breaking state sync

## [2.0.5] - 2025-02-15

### Fixed

- Numbered options detection now works when AI sends literal `\n` escape sequences instead of actual newlines
- Safety guard ensures normalization only runs when no real newlines exist, preserving all existing parsing behavior
- Updated `qs` dependency to fix low-severity DoS vulnerability (GHSA-w7fw-mjwx-w883)

## [2.0.4] - 2025-02-15

### Fixed

- AI models no longer misuse multi-question mode for single questions (schema enforces minItems: 2)
- Auto-conversion of single-item `questions` arrays to correct Mode A/B format
- "X or Y?" questions (e.g., "PASS or FAIL?") now show actual choices instead of Yes/No approval buttons
- Simplified `context` field description to avoid conflicting with `plan_review` usage

### Changed

- Tool descriptions updated with explicit mode rules, anti-patterns, and examples
- Zod validation added for MCP server (min: 2, max: 4 questions)
- Test files organized into `tests/` folder

## [2.0.0] - 2025-02-09

### 🎉 Rebrand to FlowCommand

Major rebrand and feature overhaul.

### Added

- New branding and identity as FlowCommand
- Improved testing checklist with clear pass/fail criteria

### Changed

- All configuration keys use `flowcommand.*` namespace
- All command IDs use `flowcommand.*` namespace
- View container and view IDs renamed to `flowCommandContainer` and `flowCommandView`
- Updated README with comprehensive feature documentation

---

## [1.0.4] - 2025-02-07

### Added

- Full light/dark theme support for plan_review tool and remote UI
- Theme syncs automatically with VS Code's active theme
- Landing page respects system theme preference

### Fixed

- Plan review panel now opens as dedicated VS Code editor tab (70% plan, 30% comments)
- Remote modal responsive layout for mobile devices
- Theme-color meta tag updates dynamically for mobile browsers

## [1.0.3] - 2025-02-06

### Fixed

- Mobile browser connection stability - use polling transport first for better compatibility
- File browser now shows dotfiles like `.github`, `.gsd`, `.env.example` etc.
- Added connection timeout feedback for mobile users

### Changed

- Improved socket.io connection options for cross-device compatibility

## [1.0.2] - 2025-02-06

### Fixed

- Include socket.io and express runtime dependencies in VSIX package
- Extension now loads correctly on startup

## [1.0.1] - 2025-02-06

### Fixed

- Report Issue button now links to correct repository
- Connection stability improvements in remote UI

### Changed

- Updated README with feature comparison table
- Simplified attribution

## [1.0.0] - 2025-01-27

### Initial Release

First release with the following features:

- **Smart Queue Mode** - Batch and queue prompts for AI agents
- **Normal Mode** - Direct interaction with AI agents
- **File & Folder References** - `#` mentions to attach workspace files
- **Image Support** - Paste/drag-drop images into chat
- **Tool Call History** - Track current session and full history
- **Remote Mobile/Web Access** - Control from phone, tablet, or browser
- **MCP Server Integration** - Works with Kiro, Cursor, Claude Desktop
