# FlowCommand

[![Version](https://img.shields.io/visual-studio-marketplace/v/RAJEEVREDDY.flowcommand)](https://marketplace.visualstudio.com/items?itemName=RAJEEVREDDY.flowcommand)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/RAJEEVREDDY.flowcommand)](https://marketplace.visualstudio.com/items?itemName=RAJEEVREDDY.flowcommand)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Command your AI workflow. Queue prompts, review plans, control from phone/browser.**

FlowCommand lets you take control of your AI agents in VS Code. Queue prompts, review multi-step plans, pause processing, and access everything from your phone or browser. Perfect for long-running tasks, hands-free automation, and staying in command of your AI workflow.

---

## 🚀 Key Features

| Feature | Description |
|---------|-------------|
| **Auto-Inject Instructions** | ⭐ One-click setup - AI always asks before quitting |
| **Prompt Template** | ⭐ Set a persistent prompt that auto-appends to every message |
| **Queue Pause/Play** | Temporarily pause and resume auto-responses |
| **Smart Queue Mode** | Batch prompts for automatic responses |
| **Plan Review Panel** | Dedicated 70/30 editor panel with inline comments |
| **Remote Access** | Control from phone/tablet/browser via QR code |
| **Remote Notifications** | Visual toast alerts when AI needs input |
| **Interactive Approval** | Yes/No/Option buttons parsed from AI questions |
| **Reusable Prompts** | /slash commands for frequent prompts |
| **File References** | `#` mentions to attach workspace files and folders |
| **Theme Support** | Light/dark themes synced across VS Code and remote |
| **MCP Server** | Integration with Kiro, Cursor, and other IDEs |

---

## Features

### Auto-Inject Instructions ⭐
FlowCommand can automatically inject instructions into your project so the AI always calls `ask_user` and `plan_review` correctly. One-click setup — no manual configuration needed. See [AI Instructions Setup](#-ai-instructions-setup-recommended) for details.

### Prompt Template ⭐
Set a persistent prompt template that **automatically appends to every message** sent through FlowCommand — in both Queue Mode and Normal Mode. This is useful when you want the AI to always follow certain guidelines without repeating yourself:

- **"Don't touch unrelated code"** — prevent the AI from making unnecessary changes
- **"Always use TypeScript strict mode"** — enforce coding standards across all prompts
- **"Keep responses concise"** — control output verbosity
- **"Never delete existing tests"** — protect important parts of your codebase

**How to set it up:**
1. Click the ⚙️ (Settings) icon in the FlowCommand title bar
2. Find the **Prompt Template** field
3. Enter your persistent instructions
4. Every prompt sent via FlowCommand will now include your template automatically

Think of it as a system prompt for your AI — set it once and it applies to everything.

### Queue Pause/Play
Temporarily pause auto-responses without losing your queued prompts. Useful when you need to:
- Review AI output before continuing
- Manually intervene mid-workflow
- Take a break and resume later

Toggle pause/play from the FlowCommand panel or the remote UI.

### Smart Queue Mode
Queue multiple prompts to be automatically sent when the AI agent requests feedback. Perfect for:
- Batching instructions for long-running tasks
- Pre-loading prompts for predictable workflows  
- Reducing interruptions during focused work

### Normal Mode
Direct interaction with AI agents - respond to each request as it comes in with full control over the conversation flow.

### Plan Review
When the AI presents a multi-step plan, it opens in a dedicated review panel:
- **Layout**: 70% plan content (left), 30% comments (right)
- **Inline Comments**: Click the 💬 icon next to any section to add feedback
- **Actions**: Approve, Approve with Comments, or Request Changes
- **Export**: Save the plan as a Markdown file

### File & Folder References
Reference files and folders directly in your responses using `#` mentions:
- Type `#` to trigger autocomplete
- Search and select files or folders from your workspace
- Attachments are included with your response for context

### Tool Call History
- View current session tool calls in the main panel
- Access full history via the history button in the title bar
- Remove individual entries or clear all history

### Reusable Prompts (/slash commands)
Save frequently used prompts:
1. Click the 🏷️ (Prompts) icon in the title bar
2. Create prompts with short names (e.g., "fix", "test", "refactor")
3. Type `/` in the input to see and use your saved prompts

---

## Installation

1. Install from VS Code Marketplace
2. Open VS Code and access FlowCommand from the Activity Bar
3. Enable the tool

## Building from Source

### Prerequisites
- Node.js 18+ and npm
- VS Code 1.90.0 or higher

### Development Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/rajeevreddyms5/vscode-flowcommand.git
   cd flowcommand
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
- `npm run package` - Create VSIX package for distribution

### Publishing
To create a publishable VSIX package:
```bash
npm run package
```

> ⚠️ **Important**: Never use `--no-dependencies` when packaging. The extension requires runtime dependencies (express, socket.io, etc.) to be bundled. Using `--no-dependencies` will create a broken extension that fails at runtime.

---

## 🤖 AI Instructions Setup (Recommended)

For FlowCommand to work effectively, the AI needs to know when to call `ask_user` and `plan_review` tools.

### Option 1: Auto-Inject (Recommended) ⭐

FlowCommand can automatically inject instructions into your project's `.github/copilot-instructions.md` file.

1. Open FlowCommand Settings (⚙️ icon in title bar)
2. Set **Instruction Injection** to `"Inject into .github/copilot-instructions.md"`
3. FlowCommand will prompt to create/modify the file
4. Approve the change - instructions are now active for all Copilot modes

**Settings path**: `flowcommand.instructionInjection: "copilotInstructionsMd"`

### Option 2: Manual Setup

Create `.github/copilot-instructions.md` in your workspace and add:

```markdown
## ⛔ SUBAGENT RULES (if spawned via `runSubagent`)

**STOP. Read this FIRST before any other rule.**

- Do NOT call `ask_user` or `plan_review`.
- Do NOT wait for user input or loop.
- **ALL rules below do NOT apply to you. Ignore them entirely.**

---

## AGENT RULES (follow in order)

### 1. ALWAYS call `ask_user` after every task
- Never end your turn without calling `ask_user`.
- Never use `ask_questions`. Use `ask_user` with `questions` param instead.
- Pass your FULL response in `context`.

### 2. Use `plan_review` for structured output
- When presenting plans, guides, reviews, analyses, or lists of suggestions → call `plan_review`.
- User requests changes → update and call `plan_review` again.
- User approves → apply feedback, proceed with execution.
- User cancels → stop, call `ask_user`.
- After completion → return to Rule 1.

### 3. Stop ONLY when user says "end", "stop", "terminate", "quit".

### 4. When using `runSubagent`, ALWAYS include this line in the prompt:
- "Do NOT call `ask_user` or `plan_review`."
```

### Option 3: VS Code Setting

Add to your workspace settings (`.vscode/settings.json`):

```json
{
  "github.copilot.chat.codeGeneration.instructions": [
    {
      "text": "Always call ask_user tool after completing tasks. Only stop if user says 'end' or 'stop'."
    }
  ]
}
```

### Customize Instructions

Edit the instruction text in Settings → **Instruction Text** to modify the AI behavior rules. The default rules ensure:
- AI always calls `ask_user` after completing work
- AI uses `plan_review` for multi-step plans
- AI only stops when you explicitly say "stop", "end", "quit", or "terminate"
- **Subagents** (spawned via `runSubagent`) are prevented from calling `ask_user` or `plan_review`
- A numbered **badge** appears on the FlowCommand sidebar icon when the AI is waiting for your input

---

## Usage

### Queue Mode (Default)
1. Toggle "Queue Mode" ON in the FlowCommand panel
2. Type messages and press Enter to add them to the queue
3. When an AI agent calls `ask_user`, FlowCommand automatically responds with the next queued message
4. Queue items can be reordered, edited, or removed

### Normal Mode
1. Toggle "Queue Mode" OFF
2. When an AI agent calls `ask_user`, you'll see the prompt in FlowCommand
3. Type your response and press Enter to send

### File References
1. Type `#` in the input field
2. Search for files or folders
3. Select to attach - the reference appears as a tag
4. Multiple attachments supported per message

### Remote Access (Mobile/Web)
Access FlowCommand from your phone, tablet, or any browser on your local network:

1. Click the broadcast icon (📡) in the FlowCommand title bar to start the remote server
2. Scan the QR code or open the displayed URL on your device
3. Full FlowCommand functionality available remotely:
   - View and respond to AI prompts
   - Manage the queue
   - Browse and select workspace files
   - View terminal output and problems
   - Send terminal commands
   - Light/dark theme support (syncs with VS Code theme)

#### Remote Notifications
When AI requests input, remote clients receive a visual toast notification:

- **Blue banner** appears at top of screen
- Auto-hides after 5 seconds, tap to dismiss
- Includes sound alert if enabled
- Works on HTTP (no special setup required)

---

## ⚙️ Settings Reference

Open Settings via the ⚙️ icon in the FlowCommand title bar, or search `flowcommand` in VS Code settings.

### Notification Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `flowcommand.notificationSound` | `true` | Play sound when AI calls `ask_user` |
| `flowcommand.desktopNotification` | `true` | Show VS Code notification popup |
| `flowcommand.autoFocusPanel` | `true` | Auto-focus FlowCommand panel when AI requests input |
| `flowcommand.mobileNotification` | `false` | Send visual toast notifications to connected remote clients |

### Instruction Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `flowcommand.instructionInjection` | `"off"` | How to inject AI instructions. Options: `off`, `copilotInstructionsMd` (recommended), `codeGenerationSetting` |
| `flowcommand.instructionText` | [See below] | The instruction rules injected into Copilot |

### Remote Server Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `flowcommand.remoteEnabled` | `false` | Auto-start remote server on extension activation |
| `flowcommand.remotePort` | `3000` | Port for remote server |

### MCP Server Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `flowcommand.mcpEnabled` | `false` | Always start MCP server on activation |
| `flowcommand.mcpPort` | `3579` | Port for MCP server |
| `flowcommand.autoRegisterMcp` | `true` | Auto-register with Kiro/Cursor |

---

### MCP Server Integration
FlowCommand runs an MCP (Model Context Protocol) server that integrates with:
- **Kiro** (auto-configured)
- **Cursor** (auto-configured)
- **Claude Desktop**
- **Any MCP-compatible client**


## MCP Configuration for other IDE (Not needed with Copilot)

FlowCommand automatically registers with Kiro and Cursor. For other clients, add this to your MCP configuration:

```json
{
  "mcpServers": {
    "flowcommand": {
      "transport": "sse",
      "url": "http://localhost:3579/sse"
    }
  }
}
```

## Requirements

- **VS Code 1.90.0** or higher
- **GitHub Copilot** extension (for AI tool integration)
- **Same local network** for remote access feature (phone/browser access)

---

## Known Limitations

| Limitation | Details |
|------------|---------|
| **VS Code Webview Drag-Drop** | Cannot drag files from Explorer into webview. Use paste (Ctrl+V) or # mentions instead. |
| **iOS Safari Notifications** | Native push notifications blocked on HTTP. Visual toast notifications work as fallback. |
| **iOS Auto-Focus** | Mobile Safari doesn't support programmatic focus - manual tap required. |
| **Remote Attachment Button** | Hidden on remote UI (requires VS Code file picker API). Use # mentions on desktop. |

---

## Troubleshooting

### Remote Server Connection Issues
- Ensure both devices are on the same network
- Check if port 3000 is available or configure a different port
- Firewall may need to allow connection on the configured port

### MCP Server Issues
- Verify port 3579 is free or configure `flowcommand.mcpPort`
- For Kiro/Cursor, restart the IDE after enabling FlowCommand

## License

MIT - See [LICENSE](LICENSE) for details.

---

> ⚠️ **GitHub Security Notice:**  
> GitHub prohibits use of their servers for excessive automated bulk activity. Please review [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) and use FlowCommand responsibly.
