# Changelog

All notable changes to TaskSync Remote will be documented in this file.

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
- Updated README with feature comparison table highlighting differences from original TaskSync
- Simplified attribution - now correctly credits original 4regab/TaskSync only
- Remote server is our own implementation, not derived from intuitiv fork

## [1.0.0] - 2025-01-27

### Initial Release

First release of TaskSync Remote with the following features:

- **Smart Queue Mode** - Batch and queue prompts for AI agents
- **Normal Mode** - Direct interaction with AI agents
- **File & Folder References** - `#` mentions to attach workspace files
- **Image Support** - Paste/drag-drop images into chat
- **Tool Call History** - Track current session and full history
- **Remote Mobile/Web Access** - Control TaskSync from phone, tablet, or browser
  - Light/dark theme support
  - Terminal output display with working directory
  - File browser for workspace files
  - QR code for easy mobile connection
- **MCP Server Integration** - Works with Kiro, Cursor, Claude Desktop

### Attribution

Based on [intuitiv/TaskSync](https://github.com/intuitiv/TaskSync), which is a fork of [4regab/TaskSync](https://github.com/4regab/TaskSync).
