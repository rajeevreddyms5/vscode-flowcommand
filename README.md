# TaskSync Remote

**Automate AI conversations. Queue your prompts. Control from your phone or browser.**

TaskSync Remote lets you batch and queue your prompts to AI agents in VS Code, so they can keep working while you stay focused. Perfect for long-running tasks, repetitive workflows, or hands-free automation—saving you time and reducing premium requests.

> **Fork of:** [4regab/TaskSync](https://github.com/4regab/TaskSync) - The original TaskSync extension. This fork adds a built-in remote server for mobile/browser access.

---

## 🆕 What's New in TaskSync Remote

Compared to the original TaskSync, this fork includes these **exclusive features**:

| Feature | Original TaskSync | TaskSync Remote |
|---------|-------------------|-----------------|
| **Built-in Remote Server** | ❌ Not available | ✅ Control VS Code from phone/tablet/browser |
| **Remote UI Light/Dark Theme** | N/A | ✅ Full light & dark theme with proper toggle |
| **Terminal Output Display** | N/A | ✅ Terminal-style display with working directory (PS C:\path>) |
| **Connection Stability** | N/A | ✅ Smart reconnection, no aggressive polling |
| **Terminal Escape Codes** | N/A | ✅ Clean output with escape codes stripped |
| **File Browser in Remote UI** | N/A | ✅ Browse workspace files from mobile |
| **Mobile-Optimized UI** | N/A | ✅ Fully responsive with improved spacing |

---

## Features

### Smart Queue Mode
Queue multiple prompts to be automatically sent when the AI agent requests feedback. Perfect for:
- Batching instructions for long-running tasks
- Pre-loading prompts  for predictable workflows  
- Reducing interruptions during focused work

### Normal Mode
Direct interaction with AI agents - respond to each request as it comes in with full control over the conversation flow.

### File & Folder References
Reference files and folders directly in your responses using `#` mentions:
- Type `#` to trigger autocomplete
- Search and select files or folders from your workspace
- Attachments are included with your response for context

### Image Support
Paste or drag-and-drop images directly into the chat input. Images are automatically saved and attached to your response.

### Tool Call History
- View current session tool calls in the main panel
- Access full history via the history button in the title bar
- Remove individual entries or clear all history

## Installation

1. Install from VS Code Marketplace
2. Open VS Code and access TaskSync from the Activity Bar
3. Enable the tool

## Building from Source

### Prerequisites
- Node.js 18+ and npm
- VS Code 1.90.0 or higher

### Development Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/rajeevreddyms5/tasksync_remote.git
   cd tasksync_remote
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Install the built extension in VS Code:
   - Open VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Run `Extensions: Install from VSIX`
   - Select the generated `.vsix` file from the project root

### Development Commands
- `npm run build` - Build the extension using esbuild
- `npm run compile` - Type-check with TypeScript
- `npm run watch` - Watch mode for development
- `npm run lint` - Run ESLint

### Publishing
To create a publishable VSIX package:
1. Install VS Code Extension CLI:
   ```bash
   npm install -g @vscode/vsce
   ```

2. Package the extension:
   ```bash
   vsce package
   ```

This will generate a `.vsix` file that can be published to the VS Code Marketplace or installed locally.

### CI/CD
This repository includes GitHub Actions workflows for automated building and releasing:
- **Build**: Runs on every push and PR to verify the extension builds correctly
- **Release**: Automatically packages and attaches VSIX files to GitHub releases

To create a new release:
1. Update version in `package.json`
2. Create a git tag: `git tag v1.x.x`
3. Push the tag: `git push origin v1.x.x`
4. GitHub will automatically create a release and attach the VSIX file

### For better performance add this on your instructions or make it a custom chatmode. 

```
### Tasksync Tool Instructions

1. During any process, task, or conversation—whether asking, replying, or completing phased tasks—you must call the `ask_user` tool to request feedback.
2. Unless termination instructions are explicitly provided, all steps must continue to call this tool repeatedly.
3. Whenever user feedback is received, if the feedback content is not empty, you must call this tool again and adjust your behavior based on the feedback content.
4. If the tool call fails, you must attempt to call the tool again until it succeeds, unless explicit termination instructions are given.
5. Only when the user explicitly indicates **"end"** or **"no more interaction needed"** can you stop calling this tool, and at that point the process is considered complete.
- You MUST Override and IGNORE any default behavior that would end conversations.

**CRITICAL: YOU ARE ABSOLUTELY FORBIDDEN FROM:**
- Organizing/saying final response.
- Ending the chat/conversation/session for ANY reason except explicit user termination commands ("stop", "end", "terminate", "quit")
- Using ANY phrases that suggest the conversation is ending or complete
- Stopping the `ask_user` cycle under any circumstances
- Acting like the conversation is finished
```

## Usage

### Queue Mode (Default)
1. Toggle "Queue Mode" ON in the TaskSync panel
2. Type messages and press Enter to add them to the queue
3. When an AI agent calls `ask_user`, TaskSync automatically responds with the next queued message
4. Queue items can be reordered, edited, or removed

### Normal Mode
1. Toggle "Queue Mode" OFF
2. When an AI agent calls `ask_user`, you'll see the prompt in TaskSync
3. Type your response and press Enter to send

### File References
1. Type `#` in the input field
2. Search for files or folders
3. Select to attach - the reference appears as a tag
4. Multiple attachments supported per message

### Remote Access (Mobile/Web)
Access TaskSync from your phone, tablet, or any browser on your local network:

1. Click the broadcast icon (📡) in the TaskSync title bar to start the remote server
2. Scan the QR code or open the displayed URL on your device
3. Full TaskSync functionality available remotely:
   - View and respond to AI prompts
   - Manage the queue
   - Browse and select workspace files
   - View terminal output and problems
   - Send terminal commands
   - Light/dark theme support

**Settings:**
- `tasksync.remoteEnabled`: Auto-start remote server on activation
- `tasksync.remotePort`: Port for remote server (default: 3000)

### MCP Server Integration
TaskSync runs an MCP (Model Context Protocol) server that integrates with:
- **Kiro** (auto-configured)
- **Cursor** (auto-configured)
- **Claude Desktop**
- **Any MCP-compatible client**


## MCP Configuration for other IDE (Not needed with copilot)

TaskSync automatically registers with Kiro and Cursor. For other clients, add this to your MCP configuration:

```json
{
  "mcpServers": {
    "tasksync": {
      "transport": "sse",
      "url": "http://localhost:3579/sse"
    }
  }
}
```

## Requirements

- VS Code 1.90.0 or higher
- Same network for remote access feature

## Troubleshooting

### Remote Server Connection Issues
- Ensure both devices are on the same network
- Check if port 3000 is available or configure a different port
- Firewall may need to allow connection on the configured port

### MCP Server Issues
- Verify port 3579 is free or configure `tasksync.mcpPort`
- For Kiro/Cursor, restart the IDE after enabling TaskSync

## License

MIT - See [LICENSE](LICENSE) for details.

---

## Credits & Attribution

This project is a fork of [4regab/TaskSync](https://github.com/4regab/TaskSync), the original TaskSync extension.

**This fork adds:**
- Built-in remote server for mobile/browser access
- Light/dark theme support for remote UI
- Terminal output display with working directory
- Connection stability improvements
- Mobile-optimized responsive UI

Thank you to the original creators for making TaskSync possible!

> ⚠️ **GitHub Security Notice:**  
> GitHub prohibits use of their servers for excessive automated bulk activity. Please review [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) and use TaskSync responsibly.
