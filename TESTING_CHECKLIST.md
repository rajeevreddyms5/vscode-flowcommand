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

- [x] Activity bar icon: Open VS Code with a workspace → FlowCommand icon (FC logo) visible in Activity Bar
- [x] Panel opens: Click FlowCommand icon → Panel opens showing queue area and input field

### 1.2 Title Bar Buttons

- [x] Icons present: Look at FlowCommand panel title bar → 5 icons visible: 📡 Remote, 📜 History, 🏷️ Prompts, 🗑️ Clear, ⚙️ Settings
- [x] Tooltips work: Hover over each icon → Tooltip shows function name

---

## 2. Queue Mode

### 2.1 Queue Mode Toggle

- [x] Default state: Open FlowCommand panel (already done) → "Queue Mode" toggle is ON
- [x] Toggle OFF: Click the toggle → Changes to "Normal Mode"
- [x] Toggle ON: Click toggle again → Returns to "Queue Mode"

### 2.2 Add Prompts to Queue

- [x] Add single prompt: Type "Test prompt 1" and press Enter → Prompt appears in queue list, input clears
- [x] Queue count: Add 2 more prompts → Queue shows "3 items"

### 2.3 Queue Management

- [x] Edit/Delete buttons: Hover over queue item → ✏️ and 🗑️ buttons appear
- [x] Delete prompt: Click 🗑️ on an item → Item removed, count decreases
- [x] Edit prompt: Click ✏️, change text, save → Item text updates
- [x] Reorder: Drag item to new position → Order changes persist (FIXME: flickering occurs during drag, needs stabilization)

---

## 3. Normal Mode

### 3.1 Normal Mode Behavior

- [x] Switch mode: Turn OFF Queue Mode → UI shows "Normal Mode"
- [x] No pending request: Type text and press Enter → Nothing happens (no error)
- [x] With pending request: Trigger ask_user from Copilot, then type response → Response sent to Copilot

---

## 4. AI Tool Integration (ask_user)

### 4.1 Queue Auto-Response

- [x] Setup: Add "Yes, proceed" to queue → Queue shows 1 item
- [x] Trigger: In Copilot: "Ask me if I want to proceed" → Queue item consumed, response sent, history entry created

**Copilot Test Prompt:**
```
Ask me if I want to proceed with a test task using ask_user. Wait for my response.
```

### 4.2 Notifications (Normal Mode)

- [x] Enable settings: Turn ON: Sound, Desktop Notification, Auto-Focus → All toggles checked
- [x] Trigger notification: In Copilot: "Ask me a question" → Sound plays, notification appears, panel auto-focuses

### 4.3 Yes/No Buttons

- [x] Button display: Copilot asks yes/no question → Yes/No buttons appear
- [x] Button click: Click "Yes" → Response "Yes" sent to Copilot

**Copilot Test Prompt:**
```
Ask me a simple yes or no confirmation: "Should I proceed?"
```

---

## 5. Plan Review

### 5.1 Plan Review Panel

- [x] Panel opens: Copilot creates and presents a plan → New editor tab opens with 70/30 split layout
- [x] Markdown renders: View plan content → Headers, lists, code blocks display correctly
- [x] Comment icon: Hover over plan section → 💬 icon appears
- [x] Add comment: Click 💬, type comment, save → Comment appears in right sidebar

**Copilot Test Prompt:**
```
Create a 3-step plan for setting up a Node.js project and present it using plan_review.
```

### 5.2 Plan Review Actions

- [x] Approve: Click "Approve" → Panel closes, Copilot proceeds
- [x] Request changes: Add comment, click "Request Changes" → Panel closes, Copilot revises plan
- [x] Cancel: Click X button or "Cancel" → Plan cancelled, Copilot stops

### 5.3 Enter Key for Comments

- [x] Enter saves: Type comment, press Enter → Comment added, input clears
- [x] Shift+Enter: Type, press Shift+Enter → New line added (no save)

---

## 6. File & Folder References

### 6.1 File Attachment

- [x] Trigger autocomplete: Type `#` in input → Dropdown appears
- [x] Search files: Type "pack" → Files matching shown (e.g., package.json)
- [x] Select file: Click a file → File chip appears in input (FIXME: In remote browser, file selector text overlays background text, confusing if it's from picker or history; FIXME: Remote file picker triggers IDE file picker too, should close automatically when remote picker closes)

### 6.2 Folder Attachment

- [x] Folder search: Type `#src` → "src" folder shown
- [x] Select folder: Click folder → Folder chip appears in input

---

## 7. Image Support

### 7.1 Paste Image

- [x] Screenshot paste: Take screenshot (Win+Shift+S), Ctrl+V in input → Image thumbnail appears
- [x] Send with image: Press Enter to send → Image included in response

### 7.2 Drag and Drop

- [x] Drag image: Drag image file into input area → Drop zone highlights (Note: Does not work in VS Code due to webview limitations, but works in remote browser)
- [x] Drop image: Release mouse → Image attached, thumbnail shown (Note: Does not work in VS Code due to webview limitations, but works in remote browser)

---

## 8. History

### 8.1 Session History

- [x] View history: Scroll up in FlowCommand panel → "Current Session" entries visible
- [x] Entry details: Expand an entry → Shows prompt and response

### 8.2 Full History Modal

- [x] Open modal: Click 📜 History button → History modal opens
- [x] Clear history: Click "Clear History" → All entries removed

---

## 9. Remote Server

### 9.1 Start Server

- [x] Start: Click 📡 Remote icon → Status bar shows "Remote: Active", QR code appears
- [x] URL display: Check dialog → Local network URL displayed (e.g., http://192.168.x.x:3000)

### 9.2 Connect from Device

- [x] Access URL: Scan QR or type URL on phone → PIN entry page loads (FIXME: QR Code is not showing where we should show it, may be in the flowcammand icon that shows in the bottom bar of the IDE?)
- [x] Authenticate: Enter 4-digit PIN → Remote UI loads with queue and input

### 9.3 Remote Features

- [x] Add prompt: Add prompt from phone → Appears in VS Code queue
- [x] Send response: Submit response from phone → VS Code receives it
- [x] Terminal tab: View terminal output tab → Shows VS Code terminal history
- [x] Files tab: Browse files tab → Workspace files visible
- [x] Theme sync: Change VS Code theme → Remote UI theme updates

### 9.4 Stop Server

- [x] Stop: Click 📡 icon again → Status bar no longer shows "Remote: Active"
- [x] Client disconnect: Check phone → Shows "Disconnected"

---

## 10. Settings

### 10.1 Settings Modal

- [x] Open: Click ⚙️ Settings → Modal opens

### 10.2 Individual Settings

- [x] Notification Sound: Toggle ON, trigger ask_user → Sound plays
- [x] Desktop Notification: Toggle ON, trigger ask_user → VS Code notification popup appears
- [x] Auto-Focus Panel: Toggle ON, trigger ask_user → FlowCommand panel auto-focuses
- [x] Mobile Notification: Toggle ON, trigger from remote → Browser notification on phone
- [x] Interactive Approval: Toggle OFF, trigger ask_user → Yes/No buttons do NOT appear

### 10.3 Instruction Injection

- [x] Set injection: Set to "copilotInstructionsMd", approve → .github/copilot-instructions.md created/updated
- [x] Verify content: Open .github/copilot-instructions.md → FlowCommand rules present in file (FIXME: When .github/copilot-instructions.md is changed manually and trying to inject, it asks permission to reinject (good), but settings should detect change and change button to 'reinject' or display 'default instructions changed')

---

## 11. Reusable Prompts

### 11.1 Create Prompt

- [x] Open modal: Click 🏷️ Prompts → Modal opens
- [x] Add prompt: Name: "test", Prompt: "Run all tests", Save → Prompt appears in list

### 11.2 Use Slash Command

- [x] Trigger dropdown: Type `/` in input → Available prompts shown
- [x] Select prompt: Type `/test` and select → "Run all tests" inserted in input

### 11.3 Prompt Template

- [x] Set template: Click "Set as Template" on a prompt → Blue "Template" badge appears
- [x] Template indicator: Look near input field → Template name shown
- [x] Auto-append: Send a message → Template text automatically appended
- [x] Remove template: Click ✕ on indicator → Template cleared (FIXME: Remove prompts section in settings, as we have the Reusable prompts icon on top - no need for duplicate)

---

## 12. Theme Support

### 12.1 VS Code Theme

- [x] Change theme: Ctrl+K Ctrl+T, select light theme → VS Code switches theme
- [x] FlowCommand adapts: Check FlowCommand panel → Panel uses new theme colors
- [x] Plan Review adapts: Open Plan Review → Panel uses new theme
- [x] Remote adapts: Check connected remote → Remote UI theme matches

### 12.2 Remote Theme

- [x] Dark mode: Set system to Dark Mode → Remote landing page uses dark theme
- [x] Light mode: Set system to Light Mode → Remote landing page uses light theme

---

## 13. MCP Server (External IDEs)

### 13.1 MCP Status (Settings)

- [ ] Open Settings: MCP Server section is visible under Settings (Advanced)
- [ ] Status: Click Start/Stop toggle → Status text updates (Running/Stopped)
- [ ] URL: When running, URL shows http://localhost:<port>/sse
- [ ] Copy URL: Click "Copy URL" → Clipboard contains MCP URL

### 13.2 MCP Commands

- [ ] Start: Run "FlowCommand: Start MCP Server" → Status shows Running
- [ ] Stop: Run "FlowCommand: Stop MCP Server" → Status shows Stopped
- [ ] Toggle: Run "FlowCommand: Toggle MCP Server" → Status toggles
- [ ] Show config: Run "FlowCommand: Show MCP Configuration" → URL displayed (default: http://localhost:3579/sse)

### 13.3 External Client (Optional)

- [ ] Connect: Configure Kiro/Cursor with MCP URL → MCP client connects
- [ ] ask_user: Use ask_user from external IDE → FlowCommand receives request

---

## 14. Error Handling

### 14.1 Network Issues

- [x] Disconnect: Disconnect network while remote connected → Remote shows "Disconnected" message
- [x] Reconnect: Reconnect network → Remote auto-reconnects

### 14.2 Invalid References

- [x] Bad file: Type `#nonexistentfile.xyz` → No results or "no matches" message (no crash)

---

## 15. Queue Pause/Play

### 15.1 Pause Button

- [x] Button visible: Look at queue header → ⏸️ pause button visible
- [x] Tooltip: Hover over button → "Pause queue processing" tooltip

### 15.2 Pause Behavior

- [x] Pause queue: Click ⏸️ button → Icon changes to ▶️, "(Paused)" label, yellow border, dimmed list
- [x] No auto-respond: Trigger ask_user with items in paused queue → Question shown but queue NOT consumed
- [x] Manual response: Type and send response → Response sent, queue unchanged

**Copilot Test Prompt:**
```
Ask me a simple question using ask_user. Do not proceed until I respond.
```

### 15.3 Resume Behavior

- [x] Resume: Click ▶️ button → Icon changes to ⏸️, "(Paused)" removed, list normal
- [x] Auto-respond works: Trigger ask_user → First queue item consumed

### 15.4 Remote Sync

- [x] Pause from VS Code: Pause queue in VS Code → Remote UI shows paused state
- [x] Resume from Remote: Resume from Remote UI → VS Code shows resumed state

---

## 16. Interactive Approval Parsing

### 16.1 Numbered Options (1. 2. 3.)

- [x] Trigger: Use AI prompt below → Buttons labeled `1`, `2`, `3` appear

**Copilot Test Prompt:**
```
Ask: Which framework? 1. React 2. Vue 3. Angular. Wait for selection.
```

### 16.2 Lettered Options (A. B. C.)

- [x] Trigger: Use AI prompt below → Buttons labeled `A`, `B`, `C` appear

**Copilot Test Prompt:**
```
Ask: Testing approach? A. Unit tests B. Integration tests C. Both. Wait for answer.
```

### 16.3 Bullet Options (- item)

- [ ] Trigger: Use AI prompt below → Buttons show full text: `PostgreSQL`, `MongoDB`, `SQLite` (FIXME: Buttons not appearing for bullet options)

**Copilot Test Prompt:**
```
Ask: Database? - PostgreSQL - MongoDB - SQLite. Wait for response.
```

### 16.4 Emoji Numbers (1️⃣ 2️⃣)

- [ ] Trigger: Use AI prompt below → Buttons labeled `1`, `2`, `3` appear (FIXME: Buttons not appearing for emoji numbers)

**Copilot Test Prompt:**
```
Ask: Color scheme? 1️⃣ Dark 2️⃣ Light 3️⃣ System. Wait for choice.
```

### 16.5 Long Lists (10+ items)

- [ ] Trigger: Use AI prompt with 10+ options → NO buttons appear (only text input) (FIXME: Buttons appeared for some items instead of none)

**Copilot Test Prompt:**
```
Ask: Language? 1. JS 2. TS 3. Python 4. Go 5. Rust 6. Java 7. C# 8. Ruby 9. PHP 10. Swift. Wait.
```

---

## 17. Remote Plan Review

### 17.1 Remote Display

- [x] Open: With remote connected, trigger plan_review → VS Code panel AND remote modal open
- [x] Content: Check remote modal → Plan visible, markdown formatted, buttons work

**Copilot Test Prompt:**
```
Create a simple 3-step plan and call plan_review for approval.
```

### 17.2 Dismiss Sync

- [x] Close from VS Code: Close plan panel in VS Code → Remote modal closes automatically
- [x] Close from Remote: Close plan in Remote UI → VS Code panel closes automatically

### 17.3 Remote Notifications

- [x] Setup: Enable browser notifications, switch tabs → Remote tab hidden
- [x] Trigger: Trigger plan_review → Browser notification appears, sound plays (FIXME: On iOS Safari, notifications are blocked, shows error "Notifications are blocked. please enable them in your browser settings")

---

## 18. Notifications

### 18.1 Sound (Web Audio)

- [x] Enable: Turn ON sound in settings → Toggle checked
- [x] Trigger: Trigger ask_user → Beep sound plays (880Hz tone)
- [x] Remote: Verify on remote client → Same beep plays

### 18.2 Browser Push (Remote)

- [ ] Permission: Open remote, click "Allow" on notification prompt → Permission granted (FIXME: Related to 17.3, notifications blocked on iOS Safari)
- [ ] Trigger: Switch tabs, trigger ask_user → Browser notification appears with question text (FIXME: Related to 17.3)
- [ ] Click: Click notification → Focuses FlowCommand tab (FIXME: Related to 17.3)

### 18.3 Sound Toggle

- [x] Disable: Turn OFF notification sound → No sound on ask_user
- [x] Enable: Turn ON notification sound → Sound plays on ask_user

---

## 19. Mobile Notifications

### 19.1 Permission Button

- [ ] Button display: Open remote on mobile → Bell icon 🔔 visible in header (FIXME: Notifications blocked on iOS Safari)
- [ ] Request permission: Tap bell → Permission prompt appears (iOS 16.4+) (FIXME: Notifications blocked)
- [ ] Granted state: Grant permission → Bell icon solid (no dot) (FIXME: Notifications blocked)

### 19.2 Native vs Toast

- [ ] Native (permission granted): Trigger ask_user → Native push notification appears (FIXME: Notifications blocked)
- [ ] Toast (permission denied): Trigger ask_user → Blue visual toast at top of screen, auto-hides after 5s (FIXME: Notifications blocked)

---

## Summary Checklist

After all tests, verify these categories pass:

- [x] **Basic**: Extension loads, queue/normal modes work
- [x] **AI Integration**: ask_user and plan_review tools work with Copilot
- [x] **Files/Images**: File references (#) and image paste/drag work
- [x] **Remote Server**: Mobile/browser access works
- [x] **Settings**: All toggles function correctly
- [x] **Prompts**: Slash commands and templates work
- [x] **Themes**: Light/dark themes sync across VS Code and remote
- [x] **Pause/Play**: Queue pausing prevents auto-response
- [x] **Interactive Approval**: Number/letter/bullet options parsed correctly
- [ ] **Notifications**: Sound and push notifications work (FIXME: Browser notifications blocked on iOS Safari)
- [x] **Plan Review Sync**: VS Code and remote dismiss in sync

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
