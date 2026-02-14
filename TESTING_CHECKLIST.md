# FlowCommand — Interactive Testing Checklist

> **How to use**: Tell the AI "start FlowCommand tests" or "run tests from TESTING_CHECKLIST.md". The AI will execute each test group, run prompts where needed, and ask you to verify PASS or FAIL for each item.

---

## AI Testing Instructions

When the user asks to "start tests" or "run the testing checklist":

1. Read this file and present each test section one at a time.
2. For tests with **AI Action**, execute the action (e.g., call `ask_user`, `plan_review`, or print instructions).
3. After each test group, ask the user: **"PASS or FAIL? (Add notes if FAIL)"**
4. Track results using `manage_todo_list`.
5. At the end, present a summary report of all PASS/FAIL results.
6. Skip tests marked `[MANUAL]` — just tell the user what to verify and wait for their response.

---

## Test Group 1: Extension Basics

### T1.1 — Extension Activation `[MANUAL]`

**Verify**: FlowCommand icon (FC logo) is visible in the Activity Bar. Click it — panel opens with queue area and input field.

### T1.2 — Title Bar Icons `[MANUAL]`

**Verify**: Panel title bar has 5 icons: 📡 Remote, 📜 History, 🏷️ Prompts, 🗑️ Clear, ⚙️ Settings. Hover each — tooltips appear.

---

## Test Group 2: Queue Mode

### T2.1 — Queue Toggle `[MANUAL]`

**Verify**: Click mode dropdown → toggle between "Queue Mode" and "Normal Mode". UI label and icon update correctly.

### T2.2 — Add Prompts to Queue `[MANUAL]`

**Verify**: In Queue Mode, type "Test prompt 1" and press Enter → appears in queue. Add 2 more → count shows "3 items".

### T2.3 — Queue Management `[MANUAL]`

**Verify**: Hover queue item → edit/delete buttons appear. Delete one → count decreases. Edit one → text updates. Drag to reorder → order persists.

### T2.4 — Pause Button in Actions Bar

**Verify**: With Queue Mode ON, the pause button (⏸️) is visible in the actions bar next to the mode selector — NOT inside the queue section. It shows/hides based on queue mode. _(Fix #4)_

### T2.5 — Pause Behavior `[MANUAL]`

**Verify**: Click ⏸️ → icon changes to ▶️, "(Paused)" label appears, yellow border shown, items dimmed.

### T2.6 — Paused Queue Does Not Auto-Consume

**AI Action**: Run this prompt in Copilot Chat:

```
Ask me a simple question using ask_user. Do not proceed until I respond.
```

**Verify**: With queue paused and items in queue, the question appears but queue items are NOT consumed. Type a manual response → it sends correctly.

### T2.7 — Resume Behavior `[MANUAL]`

**Verify**: Click ▶️ → unpauses. Trigger another `ask_user` → first queue item auto-consumed.

### T2.8 — Queue Section Visibility

**Verify**: In Queue Mode with NO items, the queue section is HIDDEN (only the actions bar shows). Add a prompt → queue section appears. Clear all → queue section hides again. In Normal Mode, queue section is always hidden regardless of items.

---

### T3.1 — Basic ask_user

**AI Action**: Run in Copilot Chat:

```
Ask me: "What color do you prefer?" using ask_user. Wait for my response.
```

**Verify**: Question appears in FlowCommand panel. Type a response → AI receives it and continues.

### T3.2 — ask_user with Choices

**AI Action**: Run in Copilot Chat:

```
Ask me to choose a database using ask_user with these choices: PostgreSQL, MongoDB, SQLite. Wait for my selection.
```

**Verify**: Choice buttons appear. Text input remains visible below the choices. Buttons include "Other" (italic) and "Cancel" (red). _(Fix #2, #9)_

- Click a choice → response sent with that value
- Click "Other" → choices hidden, input still visible, focused for typing
- Click "Cancel" → sends "User cancelled this question."

### T3.3 — ask_user with Yes/No Approval

**AI Action**: Run in Copilot Chat:

```
Ask me: "Should I proceed with the deployment?" using ask_user. Wait for my answer.
```

**Verify**: If Interactive Approval is ON in settings, "Yes" and "No" buttons appear (plus "Cancel" button). Text input remains visible below. _(Fix #2, #9)_

### T3.4 — Notifications on ask_user

**AI Action**: Run in Copilot Chat:

```
Ask me: "Are you still there?" using ask_user. Wait for my response.
```

**Verify** (with all notifications enabled in settings):

- Sound plays (880Hz beep)
- IDE notification popup appears labeled "IDE Notification" _(Fix #3)_
- Panel auto-focuses (steals focus when Auto-Focus is ON, panel stays hidden when OFF) _(Fix #5)_

### T3.5 — Auto-Focus Panel Inversion Check

**AI Action**: Run in Copilot Chat:

```
Ask me: "Test auto-focus" using ask_user. Wait for response.
```

**Verify**: _(Fix #5)_

- Auto-Focus ON → panel steals focus (you're forced to look at it)
- Auto-Focus OFF → panel is NOT revealed at all (stays completely hidden — no sidebar switch)

### T3.6 — Queue Auto-Response

**AI Action**: Add "Yes, go ahead" to the queue (unpaused). Then run in Copilot Chat:

```
Ask me if I want to proceed using ask_user. Wait for my response.
```

**Verify**: Queue item "Yes, go ahead" is auto-consumed. AI receives the response without manual input.

### T3.7 — Waiting Indicator

**AI Action**: Run in Copilot Chat:

```
Ask me: "Do you see the waiting indicator?" using ask_user. Wait for my response.
```

**Verify**: _(Feature #8)_

- Pulsing orange dot + "AI is waiting for your input" text appears at top of input wrapper
- Orange glow/border on input area
- Clicking the indicator scrolls to the pending question
- After responding, the indicator disappears

---

## Test Group 4: Multi-Question (ask_user with questions array)

### T4.1 — Multi-Question Display

**AI Action**: Run in Copilot Chat:

```
Ask me 3 questions at once using ask_user with the questions parameter:
1. "What language?" with options: Python, JavaScript, Go
2. "What framework?" (free text)
3. "Testing approach?" with options: Unit, Integration, E2E (allow multiple selection)
Wait for my answers.
```

**Verify**: All 3 questions appear in a form layout. Dropdowns, text inputs, and multi-select work correctly.

---

## Test Group 5: Plan Review

### T5.1 — Plan Review Panel

**AI Action**: Run in Copilot Chat:

```
Create a 3-step plan for building a REST API and present it using plan_review. Wait for my approval.
```

**Verify**:

- New editor tab opens with plan content (markdown rendered)
- 70/30 split layout (plan left, comments right)
- Comment icons appear on hover over sections
- Approve/Request Changes/Cancel buttons at bottom

### T5.2 — Plan Review Actions `[MANUAL]`

**Verify**:

- Click "Approve" → panel closes, AI proceeds
- (Trigger again) Add comment + "Request Changes" → AI revises the plan
- (Trigger again) Click "Cancel" → AI stops

### T5.3 — Waiting Indicator During Plan Review

**AI Action**: Trigger plan*review (as in T5.1).
**Verify**: The "AI is waiting for your input" pulsing indicator appears in the input area while plan review is open. *(Feature #8)\_

---

## Test Group 6: Interactive Approval Parsing

### T6.1 — Numbered Options

**AI Action**: Run in Copilot Chat:

```
Ask: "Which framework? 1. React 2. Vue 3. Angular" using ask_user with these as choices. Wait for selection.
```

**Verify**: Buttons labeled with the options appear.

### T6.2 — Lettered Options

**AI Action**: Run in Copilot Chat:

```
Ask: "Testing approach? A. Unit tests B. Integration tests C. Both" using ask_user with these as choices. Wait for answer.
```

**Verify**: Buttons labeled with the options appear.

---

## Test Group 7: File & Image References

### T7.1 — File Autocomplete `[MANUAL]`

**Verify**: Type `#` in input → dropdown appears. Type "pack" → `package.json` shown. Select → chip appears.

### T7.2 — Image Paste `[MANUAL]`

**Verify**: Take screenshot (Win+Shift+S), Ctrl+V in input → image thumbnail appears. Send → included in response.

---

## Test Group 8: History

### T8.1 — Session History `[MANUAL]`

**Verify**: After running some ask_user tests, scroll up in panel → "Current Session" entries visible with prompt/response details.

### T8.2 — History Modal `[MANUAL]`

**Verify**: Click 📜 History icon → modal opens with past sessions. "Clear History" removes entries.

---

## Test Group 9: Remote Server

### T9.1 — Start Server `[MANUAL]`

**Verify**: Click 📡 Remote icon → status bar shows "FlowCommand" with broadcast icon. Dialog shows URL + QR code + PIN.

### T9.2 — Connect from Browser `[MANUAL]`

**Verify**: Open URL in browser → PIN page loads. Enter 4-digit PIN → Remote UI loads with queue, input, Chat/Files/Output tabs.

### T9.3 — Remote ask_user Sync

**AI Action** (with remote connected): Run in Copilot Chat:

```
Ask me: "Can you see this from both IDE and remote?" using ask_user. Wait for my response.
```

**Verify**:

- Question appears in BOTH VS Code sidebar AND remote browser
- Waiting indicator shows in BOTH _(Feature #8)_
- Respond from VS Code → remote question clears, indicator disappears _(Sync verified)_
- (Repeat and respond from remote) → VS Code question clears, indicator disappears

### T9.4 — Remote Plan Review Sync

**AI Action** (with remote connected): Run in Copilot Chat:

```
Create a simple 2-step plan and call plan_review. Wait for approval.
```

**Verify**: _(Fix #6)_

- Plan review modal appears on remote browser
- Close/Approve in VS Code → remote modal disappears
- (Repeat and respond from remote) → VS Code panel closes

### T9.5 — Remote Reconnect State Restore

**AI Action**: Trigger an `ask_user`. While the question is pending:
**Verify**: _(Fix #6, #7)_

1. Click the refresh button in remote browser header → question re-appears, waiting indicator shows
2. If queue was paused → still shows paused after refresh _(Fix #7)_
3. If plan*review was active → plan review modal re-appears after refresh *(Fix #6)\_

### T9.6 — Remote Auto-Reconnect `[MANUAL]`

**Verify**: Briefly lose connection (toggle airplane mode or disconnect WiFi) → remote shows "Disconnected. Reconnecting..." → auto-reconnects → state restored (pending question, queue pause state, plan review if active).

### T9.7 — Remote Theme Sync `[MANUAL]`

**Verify**: Change VS Code theme (Ctrl+K Ctrl+T) → remote browser theme updates to match.

### T9.8 — Remote Queue Pause Sync `[MANUAL]`

**Verify**: Pause queue in VS Code → remote shows paused. Resume from remote → VS Code shows resumed.

### T9.9 — Stop Server `[MANUAL]`

**Verify**: Click 📡 icon again → server stops. Remote shows "Disconnected".

### T9.10 — Remote Bell Button Removed `[MANUAL]`

**Verify**: Remote browser header does NOT have a bell/notification permission button. Visual toast notifications still appear when AI asks a question (if mobile notification is enabled).

---

## Test Group 10: Settings

### T10.1 — Settings Modal `[MANUAL]`

**Verify**: Click ⚙️ → modal opens with all settings.

### T10.2 — Notification Sound Toggle `[MANUAL]`

**Verify**: Toggle sound ON → trigger ask_user → beep plays. Toggle OFF → no beep.

### T10.3 — IDE Notification Label

**Verify**: Settings modal shows "IDE Notification" (not "Desktop Notification"). _(Fix #3)_

### T10.4 — Auto-Focus Panel Toggle

**AI Action**: Toggle Auto-Focus Panel OFF. Run in Copilot Chat:

```
Ask me: "Did focus stay?" using ask_user.
```

**Verify**: Panel does NOT steal focus — panel is NOT revealed at all, sidebar stays on whatever was active. _(Fix #5)_

Toggle Auto-Focus Panel ON. Repeat → panel DOES steal focus.

### T10.5 — Interactive Approval Toggle `[MANUAL]`

**Verify**: Toggle OFF → ask*user shows text input only (no Yes/No buttons). Toggle ON → buttons appear alongside the text input (input stays visible in both cases). *(Fix #9)\_

---

## Test Group 11: Instruction Injection

### T11.1 — Default Instruction Text `[MANUAL]`

**Verify**: In Settings, expand "Instruction Text" → default text contains: _(Fix #1)_

- `## SUBAGENT RULES` section
- `## AGENT RULES` with 4 rules
- Rule 1: "ALWAYS call `ask_user` after every task or response — NO EXCEPTIONS." with sub-bullets: "MUST be invoked before ending ANY conversation turn", "NEVER complete a response without calling", "NEVER use questions array for a single question"
- Rule 3: Stop signals ("end", "stop", "terminate", "quit")
- Rule 4: `runSubagent` VERBATIM instructions

### T11.2 — Injection Modes `[MANUAL]`

**Verify**:

- "copilotInstructionsMd" → creates/updates `.github/copilot-instructions.md`
- "off" → removes FlowCommand section from file
- Re-inject → section re-added

---

## Test Group 12: Reusable Prompts & Slash Commands

### T12.1 — Create Prompt `[MANUAL]`

**Verify**: Click 🏷️ Prompts → Add: Name "test", Prompt "Run all tests" → appears in list.

### T12.2 — Slash Command `[MANUAL]`

**Verify**: Type `/` in input → dropdown shows. Type `/test` → "Run all tests" inserted.

### T12.3 — Prompt Template `[MANUAL]`

**Verify**: Set a prompt as template → blue badge appears. Send message → template text appended. Remove template → cleared.

---

## Test Group 13: MCP Server

### T13.1 — MCP Settings `[MANUAL]`

**Verify**: Settings modal shows MCP Server section with Start/Stop toggle, status text, URL, Copy button.

### T13.2 — MCP Start/Stop `[MANUAL]`

**Verify**: Click Start → status "Running", URL shows. Click Stop → status "Stopped".

---

## Test Group 14: Edge Cases & Regression

### T14.1 — Waiting Indicator Sync (Cross-Environment)

**AI Action**: With remote connected, run in Copilot Chat:

```
Ask me: "Sync test" using ask_user. Wait for response.
```

**Verify**: _(Feature #8)_

- Waiting indicator shows in BOTH VS Code and remote
- Respond from ONE side → indicator disappears on BOTH sides

### T14.2 — Plan Review + Pending Request Coexistence

**AI Action**: Trigger a plan_review. While it's open, note whether the waiting indicator is present and UI is functional.
**Verify**: Plan review modal and waiting indicator both work independently.

### T14.3 — Queue Pause State After Full Page Reload `[MANUAL]`

**Verify**: Pause queue → fully reload remote browser page (F5) → queue should still be paused after re-authentication. _(Fix #7)_

### T14.4 — Stale State Cleanup `[MANUAL]`

**Verify**: If no pending request exists, refreshing remote browser should NOT show any stale question or plan review modal.

### T14.5 — Multiple Rapid ask_user Calls

**AI Action**: Run in Copilot Chat:

```
Ask me 3 questions in sequence using ask_user, one at a time. First: "Question 1?", then "Question 2?", then "Question 3?". Wait for each response before asking the next.
```

**Verify**: Each question appears correctly. Responding to one shows the next. No UI glitches.

---

## Test Group 15: Error Handling

### T15.1 — Network Disconnect `[MANUAL]`

**Verify**: Disconnect network while remote connected → "Disconnected. Reconnecting..." appears. Reconnect → auto-reconnects with state restored.

### T15.2 — Invalid File Reference `[MANUAL]`

**Verify**: Type `#nonexistentfile.xyz` → no results or "no matches" (no crash).

---

## Results Summary Template

After all tests, the AI should present:

```
| Group | Tests | Passed | Failed | Notes |
|-------|-------|--------|--------|-------|
| 1. Extension Basics | 2 | | | |
| 2. Queue Mode | 8 | | | |
| 3. AI Tools (ask_user) | 7 | | | |
| 4. Multi-Question | 1 | | | |
| 5. Plan Review | 3 | | | |
| 6. Approval Parsing | 2 | | | |
| 7. Files & Images | 2 | | | |
| 8. History | 2 | | | |
| 9. Remote Server | 10 | | | |
| 10. Settings | 5 | | | |
| 11. Instruction Injection | 2 | | | |
| 12. Prompts & Slash | 3 | | | |
| 13. MCP Server | 2 | | | |
| 14. Edge Cases | 5 | | | |
| 15. Error Handling | 2 | | | |
| **TOTAL** | **56** | | | |
```

---

## Fixes Covered by This Checklist

| Fix # | Description                       | Test IDs                |
| ----- | --------------------------------- | ----------------------- |
| 1     | Default instruction text          | T11.1                   |
| 2     | Choice button UX + re-send bugs   | T3.2, T3.3              |
| 3     | IDE Notification rename           | T3.4, T10.3             |
| 4     | Queue pause button in actions bar | T2.4                    |
| 5     | Auto-focus panel fix              | T3.5, T10.4             |
| 6     | Plan review sync                  | T9.4, T9.5              |
| 7     | Queue pause state on refresh      | T9.5, T14.3             |
| 8     | AI waiting indicator              | T3.7, T5.3, T9.3, T14.1 |
| 9     | Input stays visible with choices  | T3.2, T3.3, T10.5       |
| 10    | Bell button removed from remote   | T9.10                   |
| 11    | Queue section visibility          | T2.8                    |

---

## Known Limitations

1. **VS Code Webview Drag-Drop** — Cannot drag files from Explorer into webview. Use paste instead.
2. **iOS Notifications** — Requires iOS 16.4+, Add to Home Screen, explicit permission.
3. **Remote Attachment Button** — Hidden (requires VS Code file picker API).

---

## Bug Report Template

```
**Bug Title:** [Short description]

**Steps to Reproduce:**
1. [Step]
2. [Step]

**Expected:** [What should happen]
**Actual:** [What happened]

**Environment:**
- VS Code: [version]
- Extension: [version]
- OS: [e.g., Windows 11]
```

Report issues at: https://github.com/rajeevreddyms5/vscode-flowcommand/issues
