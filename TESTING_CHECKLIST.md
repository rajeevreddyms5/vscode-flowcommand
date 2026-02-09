# FlowCommand - Manual Testing Checklist

A structured testing guide with clear actions and pass criteria for each feature.

---

## Prerequisites

Before testing, ensure:
- [ ] Extension installed (VSIX or Marketplace)
- [ ] Workspace folder open in VS Code
- [ ] GitHub Copilot Chat installed and enabled

---

## 1. Extension Setup

### 1.1 Extension Activation

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Activity bar icon | Open VS Code with a workspace | FlowCommand icon (FC logo) visible in Activity Bar |
| Panel opens | Click FlowCommand icon | Panel opens showing queue area and input field |

### 1.2 Title Bar Buttons

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Icons present | Look at FlowCommand panel title bar | 5 icons visible: 📡 Remote, 📜 History, 🏷️ Prompts, 🗑️ Clear, ⚙️ Settings |
| Tooltips work | Hover over each icon | Tooltip shows function name |

---

## 2. Queue Mode

### 2.1 Queue Mode Toggle

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Default state | Open FlowCommand panel | "Queue Mode" toggle is ON |
| Toggle OFF | Click the toggle | Changes to "Normal Mode" |
| Toggle ON | Click toggle again | Returns to "Queue Mode" |

### 2.2 Add Prompts to Queue

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Add single prompt | Type "Test prompt 1" and press Enter | Prompt appears in queue list, input clears |
| Queue count | Add 2 more prompts | Queue shows "3 items" |

### 2.3 Queue Management

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Edit/Delete buttons | Hover over queue item | ✏️ and 🗑️ buttons appear |
| Delete prompt | Click 🗑️ on an item | Item removed, count decreases |
| Edit prompt | Click ✏️, change text, save | Item text updates |
| Reorder | Drag item to new position | Order changes persist |

---

## 3. Normal Mode

### 3.1 Normal Mode Behavior

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Switch mode | Turn OFF Queue Mode | UI shows "Normal Mode" |
| No pending request | Type text and press Enter | Nothing happens (no error) |
| With pending request | Trigger ask_user from Copilot, then type response | Response sent to Copilot |

---

## 4. AI Tool Integration (ask_user)

### 4.1 Queue Auto-Response

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Setup | Add "Yes, proceed" to queue | Queue shows 1 item |
| Trigger | In Copilot: "Ask me if I want to proceed" | Queue item consumed, response sent, history entry created |

**Copilot Test Prompt:**
```
Ask me if I want to proceed with a test task using ask_user. Wait for my response.
```

### 4.2 Notifications (Normal Mode)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Enable settings | Turn ON: Sound, Desktop Notification, Auto-Focus | All toggles checked |
| Trigger notification | In Copilot: "Ask me a question" | Sound plays, notification appears, panel auto-focuses |

### 4.3 Yes/No Buttons

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Button display | Copilot asks yes/no question | Yes/No buttons appear |
| Button click | Click "Yes" | Response "Yes" sent to Copilot |

**Copilot Test Prompt:**
```
Ask me a simple yes or no confirmation: "Should I proceed?"
```

---

## 5. Plan Review

### 5.1 Plan Review Panel

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Panel opens | Copilot creates and presents a plan | New editor tab opens with 70/30 split layout |
| Markdown renders | View plan content | Headers, lists, code blocks display correctly |
| Comment icon | Hover over plan section | 💬 icon appears |
| Add comment | Click 💬, type comment, save | Comment appears in right sidebar |

**Copilot Test Prompt:**
```
Create a 3-step plan for setting up a Node.js project and present it using plan_review.
```

### 5.2 Plan Review Actions

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Approve | Click "Approve" | Panel closes, Copilot proceeds |
| Request changes | Add comment, click "Request Changes" | Panel closes, Copilot revises plan |
| Cancel | Click X button or "Cancel" | Plan cancelled, Copilot stops |

### 5.3 Enter Key for Comments

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Enter saves | Type comment, press Enter | Comment added, input clears |
| Shift+Enter | Type, press Shift+Enter | New line added (no save) |

---

## 6. File & Folder References

### 6.1 File Attachment

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger autocomplete | Type `#` in input | Dropdown appears |
| Search files | Type "pack" | Files matching shown (e.g., package.json) |
| Select file | Click a file | File chip appears in input |

### 6.2 Folder Attachment

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Folder search | Type `#src` | "src" folder shown |
| Select folder | Click folder | Folder chip appears in input |

---

## 7. Image Support

### 7.1 Paste Image

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Screenshot paste | Take screenshot (Win+Shift+S), Ctrl+V in input | Image thumbnail appears |
| Send with image | Press Enter to send | Image included in response |

### 7.2 Drag and Drop

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Drag image | Drag image file into input area | Drop zone highlights |
| Drop image | Release mouse | Image attached, thumbnail shown |

---

## 8. History

### 8.1 Session History

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| View history | Scroll up in FlowCommand panel | "Current Session" entries visible |
| Entry details | Expand an entry | Shows prompt and response |

### 8.2 Full History Modal

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Open modal | Click 📜 History button | History modal opens |
| Clear history | Click "Clear History" | All entries removed |

---

## 9. Remote Server

### 9.1 Start Server

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Start | Click 📡 Remote icon | Status bar shows "Remote: Active", QR code appears |
| URL display | Check dialog | Local network URL displayed (e.g., http://192.168.x.x:3000) |

### 9.2 Connect from Device

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Access URL | Scan QR or type URL on phone | PIN entry page loads |
| Authenticate | Enter 4-digit PIN | Remote UI loads with queue and input |

### 9.3 Remote Features

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Add prompt | Add prompt from phone | Appears in VS Code queue |
| Send response | Submit response from phone | VS Code receives it |
| Terminal tab | View terminal output tab | Shows VS Code terminal history |
| Files tab | Browse files tab | Workspace files visible |
| Theme sync | Change VS Code theme | Remote UI theme updates |

### 9.4 Stop Server

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Stop | Click 📡 icon again | Status bar no longer shows "Remote: Active" |
| Client disconnect | Check phone | Shows "Disconnected" |

---

## 10. Settings

### 10.1 Settings Modal

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Open | Click ⚙️ Settings | Modal opens |

### 10.2 Individual Settings

| Setting | Test Action | ✅ Pass Criteria |
|---------|-------------|------------------|
| Notification Sound | Toggle ON, trigger ask_user | Sound plays |
| Desktop Notification | Toggle ON, trigger ask_user | VS Code notification popup appears |
| Auto-Focus Panel | Toggle ON, trigger ask_user | FlowCommand panel auto-focuses |
| Mobile Notification | Toggle ON, trigger from remote | Browser notification on phone |
| Interactive Approval | Toggle OFF, trigger ask_user | Yes/No buttons do NOT appear |

### 10.3 Instruction Injection

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Set injection | Set to "copilotInstructionsMd", approve | .github/copilot-instructions.md created/updated |
| Verify content | Open .github/copilot-instructions.md | FlowCommand rules present in file |

---

## 11. Reusable Prompts

### 11.1 Create Prompt

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Open modal | Click 🏷️ Prompts | Modal opens |
| Add prompt | Name: "test", Prompt: "Run all tests", Save | Prompt appears in list |

### 11.2 Use Slash Command

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger dropdown | Type `/` in input | Available prompts shown |
| Select prompt | Type `/test` and select | "Run all tests" inserted in input |

### 11.3 Prompt Template

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Set template | Click "Set as Template" on a prompt | Blue "Template" badge appears |
| Template indicator | Look near input field | Template name shown |
| Auto-append | Send a message | Template text automatically appended |
| Remove template | Click ✕ on indicator | Template cleared |

---

## 12. Theme Support

### 12.1 VS Code Theme

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Change theme | Ctrl+K Ctrl+T, select light theme | VS Code switches theme |
| FlowCommand adapts | Check FlowCommand panel | Panel uses new theme colors |
| Plan Review adapts | Open Plan Review | Panel uses new theme |
| Remote adapts | Check connected remote | Remote UI theme matches |

### 12.2 Remote Theme

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Dark mode | Set system to Dark Mode | Remote landing page uses dark theme |
| Light mode | Set system to Light Mode | Remote landing page uses light theme |

---

## 13. MCP Server (External IDEs)

### 13.1 MCP Configuration

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Show config | Run command "FlowCommand: Show MCP Configuration" | URL displayed (default: http://localhost:3579/sse) |

### 13.2 External Client (Optional)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Connect | Configure Kiro/Cursor with MCP URL | MCP client connects |
| ask_user | Use ask_user from external IDE | FlowCommand receives request |

---

## 14. Error Handling

### 14.1 Network Issues

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Disconnect | Disconnect network while remote connected | Remote shows "Disconnected" message |
| Reconnect | Reconnect network | Remote auto-reconnects |

### 14.2 Invalid References

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Bad file | Type `#nonexistentfile.xyz` | No results or "no matches" message (no crash) |

---

## 15. Queue Pause/Play

### 15.1 Pause Button

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Button visible | Look at queue header | ⏸️ pause button visible |
| Tooltip | Hover over button | "Pause queue processing" tooltip |

### 15.2 Pause Behavior

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Pause queue | Click ⏸️ button | Icon changes to ▶️, "(Paused)" label, yellow border, dimmed list |
| No auto-respond | Trigger ask_user with items in paused queue | Question shown but queue NOT consumed |
| Manual response | Type and send response | Response sent, queue unchanged |

**Copilot Test Prompt:**
```
Ask me a simple question using ask_user. Do not proceed until I respond.
```

### 15.3 Resume Behavior

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Resume | Click ▶️ button | Icon changes to ⏸️, "(Paused)" removed, list normal |
| Auto-respond works | Trigger ask_user | First queue item consumed |

### 15.4 Remote Sync

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Pause from VS Code | Pause queue in VS Code | Remote UI shows paused state |
| Resume from Remote | Resume from Remote UI | VS Code shows resumed state |

---

## 16. Interactive Approval Parsing

### 16.1 Numbered Options (1. 2. 3.)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger | Use AI prompt below | Buttons labeled `1`, `2`, `3` appear |

**Copilot Test Prompt:**
```
Ask: Which framework? 1. React 2. Vue 3. Angular. Wait for selection.
```

### 16.2 Lettered Options (A. B. C.)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger | Use AI prompt below | Buttons labeled `A`, `B`, `C` appear |

**Copilot Test Prompt:**
```
Ask: Testing approach? A. Unit tests B. Integration tests C. Both. Wait for answer.
```

### 16.3 Bullet Options (- item)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger | Use AI prompt below | Buttons show full text: `PostgreSQL`, `MongoDB`, `SQLite` |

**Copilot Test Prompt:**
```
Ask: Database? - PostgreSQL - MongoDB - SQLite. Wait for response.
```

### 16.4 Emoji Numbers (1️⃣ 2️⃣)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger | Use AI prompt below | Buttons labeled `1`, `2`, `3` appear |

**Copilot Test Prompt:**
```
Ask: Color scheme? 1️⃣ Dark 2️⃣ Light 3️⃣ System. Wait for choice.
```

### 16.5 Long Lists (10+ items)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Trigger | Use AI prompt with 10+ options | NO buttons appear (only text input) |

**Copilot Test Prompt:**
```
Ask: Language? 1. JS 2. TS 3. Python 4. Go 5. Rust 6. Java 7. C# 8. Ruby 9. PHP 10. Swift. Wait.
```

---

## 17. Remote Plan Review

### 17.1 Remote Display

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Open | With remote connected, trigger plan_review | VS Code panel AND remote modal open |
| Content | Check remote modal | Plan visible, markdown formatted, buttons work |

**Copilot Test Prompt:**
```
Create a simple 3-step plan and call plan_review for approval.
```

### 17.2 Dismiss Sync

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Close from VS Code | Close plan panel in VS Code | Remote modal closes automatically |
| Close from Remote | Close plan in Remote UI | VS Code panel closes automatically |

### 17.3 Remote Notifications

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Setup | Enable browser notifications, switch tabs | Remote tab hidden |
| Trigger | Trigger plan_review | Browser notification appears, sound plays |

---

## 18. Notifications

### 18.1 Sound (Web Audio)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Enable | Turn ON sound in settings | Toggle checked |
| Trigger | Trigger ask_user | Beep sound plays (880Hz tone) |
| Remote | Verify on remote client | Same beep plays |

### 18.2 Browser Push (Remote)

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Permission | Open remote, click "Allow" on notification prompt | Permission granted |
| Trigger | Switch tabs, trigger ask_user | Browser notification appears with question text |
| Click | Click notification | Focuses FlowCommand tab |

### 18.3 Sound Toggle

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Disable | Turn OFF notification sound | No sound on ask_user |
| Enable | Turn ON notification sound | Sound plays on ask_user |

---

## 19. Mobile Notifications

### 19.1 Permission Button

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Button display | Open remote on mobile | Bell icon 🔔 visible in header |
| Request permission | Tap bell | Permission prompt appears (iOS 16.4+) |
| Granted state | Grant permission | Bell icon solid (no dot) |

### 19.2 Native vs Toast

| Test | Action | ✅ Pass Criteria |
|------|--------|------------------|
| Native (permission granted) | Trigger ask_user | Native push notification appears |
| Toast (permission denied) | Trigger ask_user | Blue visual toast at top of screen, auto-hides after 5s |

---

## Summary Checklist

After all tests, verify these categories pass:

- [ ] **Basic**: Extension loads, queue/normal modes work
- [ ] **AI Integration**: ask_user and plan_review tools work with Copilot
- [ ] **Files/Images**: File references (#) and image paste/drag work
- [ ] **Remote Server**: Mobile/browser access works
- [ ] **Settings**: All toggles function correctly
- [ ] **Prompts**: Slash commands and templates work
- [ ] **Themes**: Light/dark themes sync across VS Code and remote
- [ ] **Pause/Play**: Queue pausing prevents auto-response
- [ ] **Interactive Approval**: Number/letter/bullet options parsed correctly
- [ ] **Notifications**: Sound and push notifications work
- [ ] **Plan Review Sync**: VS Code and remote dismiss in sync

---

## Known Limitations

1. **VS Code Webview Drag-Drop** - Cannot drag files from Explorer into webview. Use paste instead.
2. **iOS Notifications** - Requires iOS 16.4+, Add to Home Screen, explicit permission via bell button.
3. **Remote Attachment Button** - Hidden (requires VS Code file picker API).

---

## Bug Report Template

```
**Bug Title:** [Short description]

**Steps to Reproduce:**
1. [Step]
2. [Step]
3. [Step]

**Expected:** [What should happen]
**Actual:** [What happened]

**Environment:**
- VS Code: [version]
- Extension: [version]
- OS: [e.g., Windows 11]

**Screenshots:** [If applicable]
```

---

Report issues at: https://github.com/rajeevreddyms5/vscode-flowcommand/issues
