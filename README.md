# FlowCommand

**Command your AI workflow. Queue prompts, review plans, control from phone/browser.**

FlowCommand lets you take control of your AI agents in VS Code. Queue prompts, review multi-step plans, pause processing, and access everything from your phone or browser. Perfect for long-running tasks, hands-free automation, and staying in command of your AI workflow.

> **Built on:** [4regab/TaskSync](https://github.com/4regab/TaskSync) - FlowCommand extends TaskSync with remote access, plan review panels, mobile notifications, and enhanced interaction features.

---

## 🚀 Key Features

| Feature | Description |
|---------|-------------|
| **Smart Queue Mode** | Batch prompts for automatic responses |
| **Plan Review Panel** | Dedicated 70/30 editor panel with inline comments |
| **Remote Access** | Control from phone/tablet/browser via QR code |
| **Mobile Notifications** | Push notifications when AI needs input |
| **Interactive Approval** | Yes/No/Option buttons parsed from AI questions |
| **Queue Pause/Play** | Temporarily pause auto-responses |
| **Reusable Prompts** | /slash commands and prompt templates for frequent prompts |
| **Auto-Inject Instructions** | One-click AI instruction setup via copilot-instructions.md |
| **File References** | `#` mentions to attach workspace files and folders |
| **Theme Support** | Light/dark themes synced across VS Code and remote |
| **MCP Server** | Integration with Kiro, Cursor, and other IDEs |

---

## Features

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
## RULES (Follow in order of priority)

### 1. MANDATORY CONTINUATION LOOP (Base Rule)
- **Constraint**: You are FORBIDDEN from ending your turn without calling `ask_user`.
- **Action**: After completing ANY task, call `ask_user` with:
  - `context`: Your FULL response, explanation, or code output.

### 2. PLANNING WORKFLOW (Special Case)
- **Trigger**: When presenting structured content with multiple items such as: plans, guides, reviews, analyses, recommendations, or lists of findings/suggestions.
- **Usage**: Call `plan_review` tool.
- **Loop**:
  - If user requests changes → Update plan and call `plan_review` again.
  - If user approves → Apply any feedback given, then proceed with execution.
  - If user cancels → Stop execution immediately, call `ask_user`.
- **After completion**: Return to Rule 1 (call `ask_user`).

### 3. STOP CONDITIONS (Only Exception)
- **Stop ONLY if** user explicitly says: "end", "stop", "terminate", "quit", or "stop now".
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

---

## ⚙️ Settings Reference

Open Settings via the ⚙️ icon in the FlowCommand title bar, or search `flowcommand` in VS Code settings.

### Notification Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `flowcommand.notificationSound` | `true` | Play sound when AI calls `ask_user` |
| `flowcommand.desktopNotification` | `true` | Show VS Code notification popup |
| `flowcommand.autoFocusPanel` | `true` | Auto-focus FlowCommand panel when AI requests input |
| `flowcommand.mobileNotification` | `false` | Send browser push notification to connected remote clients |

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

- VS Code 1.90.0 or higher
- Same network for remote access feature

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

## Credits & Attribution

FlowCommand is built on [4regab/TaskSync](https://github.com/4regab/TaskSync), the original TaskSync extension.

**FlowCommand adds:**
- Built-in remote server for mobile/browser access
- Plan review panel with 70/30 split layout and inline comments
- Mobile push notifications
- Interactive approval buttons (Yes/No, numbered options)
- Queue pause/play
- Prompt templates
- Enhanced theme synchronization

Thank you to the original TaskSync creators for making this possible!

> ⚠️ **GitHub Security Notice:**  
> GitHub prohibits use of their servers for excessive automated bulk activity. Please review [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) and use FlowCommand responsibly.
