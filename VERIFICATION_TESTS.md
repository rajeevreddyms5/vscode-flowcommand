# Verification Tests for FIXME Fixes

These tests verify the specific fixes made for the FIXME items in TESTING_CHECKLIST.md.
Run these after building the extension (`npm run compile`).

---

## Phase 1 Fixes (Commit 8d7545e)

## VT-1: Queue Pause — No Auto-Consume (Fix for T2.6)

**Root Cause Fixed:** `_handleAddQueuePrompt` was missing `!this._queuePaused` check in the `shouldAutoRespond` condition.

### Steps:

1. Enable queue mode in FlowCommand panel
2. Add 2-3 items to the queue
3. **Pause** the queue (click ⏸️)
4. Trigger an `ask_user` call:
   ```
   Ask me a simple question using ask_user. Do not proceed until I respond.
   ```
5. While the question is pending, add another queue item via the queue input

### Expected:

- The pending question should appear in the panel
- Queue items should NOT be auto-consumed (they stay in the queue)
- The new queue item added in step 5 should also NOT be auto-consumed
- Manual response should work normally

### Edge Cases:

- Rapidly toggle pause/resume while a question is pending → no double-consume
- Resume queue → first queue item should auto-consume for the pending request

---

## VT-2: Plan Review Cancel Button (Fix for T5.1)

**Root Cause Fixed:** Footer in `planReviewPanel.ts` only had "Approve" and "Request Changes" buttons.

### Steps:

1. Trigger plan_review:
   ```
   Create a detailed plan for building a REST API. Use plan_review to present it for my approval.
   ```
2. Observe the plan review panel footer

### Expected:

- Three buttons visible: **Cancel** (left, subtle style), **Request Changes** (middle), **Approve** (right, primary)
- Click "Cancel" → panel closes, AI receives `cancelled` status and stops
- Cancel button has subtle/muted styling (transparent background, border)
- Cancel button hover shows reddish highlight

### Edge Cases:

- Cancel with unsaved comments → comments are discarded (not sent)
- Read-only mode → Cancel button is hidden (along with other action buttons)

---

## VT-3: Waiting Indicator During Plan Review (Fix for T5.3)

**Root Cause Fixed:** Plan review didn't send `toolCallPending` state to sidebar webview, so the pulsing indicator never showed.

### Steps:

1. Trigger plan_review (same prompt as VT-2)
2. Look at the FlowCommand sidebar input area

### Expected:

- The orange pulsing "AI is waiting for your input" indicator appears in the sidebar
- The indicator persists while plan review is open
- Approving/cancelling plan review → indicator disappears

### Edge Cases:

- If both `ask_user` AND `plan_review` are somehow pending, indicator persists until both resolve
- If `ask_user` completes while plan review is still open, indicator stays (plan review keeps it alive)
- `toolCallCancelled` with `__stale__` does NOT remove indicator while plan review is pending

---

## VT-4: Remote Plan Review Reconnect (Fix for T5.3 — Remote)

**Root Cause Verified:** Existing state restore code is correct. `_activePlanReview` persists and `getRemoteState()` returns it for remote reconnection.

### Steps:

1. Start remote server and connect from a phone/browser
2. Trigger plan_review in the IDE
3. Verify plan review appears on both IDE and remote
4. Disconnect the remote session (close tab or toggle airplane mode)
5. Reconnect the remote session (reopen the URL or click refresh)

### Expected:

- Plan review modal should restore on the remote client after reconnect
- Approve/Reject/Cancel actions should still work after restore
- Approving on one side (IDE or remote) should close on both

### Edge Cases:

- Plan review completes in IDE while remote is disconnected → on reconnect, no stale modal appears
- Multiple rapid reconnects → no duplicate modals

---

## VT-5: History Info Icon (Fix for T8.2)

**Root Cause Fixed:** Long info text "History is stored in VS Code globalStorage/tool-history.json" was always visible, causing button overflow on small screens.

### Steps:

1. Open FlowCommand panel
2. Click the History icon (📜 or clock icon)
3. Observe the history modal header

### Expected:

- An info icon (ℹ) appears in the header instead of the full text
- Hovering over the icon shows the tooltip: "History is stored in VS Code globalStorage/tool-history.json"
- Clear All (🗑) and Close (✕) buttons are fully visible, not overflowing
- Works on small panel widths

### Edge Cases:

- Very narrow panel → buttons still accessible, icon doesn't overlap title

---

## VT-6: Template UX Rename (Fix for T12.3)

**Root Cause Fixed:** Template terminology was confusing. "Set as Template" / "Unset Template" renamed to "Pin" / "Unpin" with clear explanation.

### Steps:

1. Open Reusable Prompts modal (📝 icon or gear → Reusable Prompts)
2. Observe the help text at the top
3. Hover over the pin icon (📌) on a prompt card
4. Click the pin icon to pin a prompt
5. Observe the indicator near the input area
6. Send a message

### Expected:

- Help text includes: "📌 Pinned prompts are automatically appended to every message you send."
- Pin button tooltip: "Pin — auto-append to all messages"
- After pinning: indicator shows "Pinned: /commandname" near input
- Sending a message appends the pinned prompt content with `[Auto-appended instructions]` prefix
- Unpinning shows tooltip: "Unpin — stop auto-appending"

### Edge Cases:

- Pin one prompt, then pin another → first is unpinned, second becomes active
- Clear pin via the small ✕ button on the indicator → template cleared

---

## Phase 2 Fixes (Commits 62a0c19, 1847c28)

## VT-7: Other Button Removed from Choices Bar (Fix for T3.2)

**Root Cause Fixed:** "Other" button was redundant — text input is always visible below for custom responses.

### Steps:

1. Trigger ask_user with choices:
   ```
   Ask me "Which database?" with choices: PostgreSQL, MySQL, SQLite using ask_user with the choices parameter. Wait for my answer.
   ```
2. Observe the choices bar

### Expected:

- Choice buttons appear: PostgreSQL, MySQL, SQLite
- NO "Other" button appears
- Text input remains visible below for typing custom responses
- Clicking a choice button sends that value

### Edge Cases:

- All choices have long labels → buttons wrap correctly, no overflow

---

## VT-8: End/Cancel Button Removed from Choices Bar (Fix for T3.2)

**Root Cause Fixed:** End/Cancel button removed — FlowCommand's own End button handles session termination.

### Steps:

1. Same as VT-7 — trigger ask_user with choices
2. Observe the choices bar buttons

### Expected:

- Only the actual choice buttons appear (e.g., PostgreSQL, MySQL, SQLite)
- No "End", "Cancel", or "Other" buttons
- User can still end via FlowCommand's built-in End button or by typing in text input

---

## VT-9: End/Cancel Button Removed from Approval Modal (Fix for T3.3)

**Root Cause Fixed:** Approval modal had Cancel/End button which was redundant with FlowCommand's own End button.

### Steps:

1. Enable "Interactive Approval" in FlowCommand settings
2. Trigger an approval question:
   ```
   Ask me "Should I proceed with the deployment?" using ask_user. Wait for my answer.
   ```
3. Observe the approval bar

### Expected:

- Only **Yes** and **No** buttons appear
- No "Cancel" or "End" button in the approval bar
- Clicking "Yes" sends approval, clicking "No" focuses text input for custom response
- Text input remains visible below

### Edge Cases:

- Rapid Yes/No clicks → only first click is processed
- "No" click → text input focused, user can type rejection reason

---

## VT-10: Other Option Removed from Multi-Question Modal (Fix for T4.1)

**Root Cause Fixed:** "Other" radio/checkbox option in multi-question forms was redundant — freeform text input serves the same purpose.

### Steps:

1. Trigger multi-question with options:
   ```
   Ask me 2 questions at once using ask_user with the questions parameter:
   1. "What language?" with options: Python, JavaScript, Go
   2. "What framework?" (free text)
   Wait for my answers.
   ```
2. Observe the multi-question form

### Expected:

- Question 1 shows radio buttons: Python, JavaScript, Go — NO "Other" option
- Question 2 shows free text input
- Submit and Cancel buttons appear at the bottom of the form
- Selecting a radio button and submitting works correctly

### Edge Cases:

- Multi-select question → checkboxes work, no "Other" checkbox
- allowFreeformInput=true → freeform textarea appears below options

---

## VT-11: Comma-Separated Fallback Choice Parsing (Fix for T6.1, T6.2)

**Root Cause Fixed:** `_parseChoices` only detected numbered/lettered lists. Added Pattern 4 for comma-separated options with "or" conjunction.

### Steps:

1. Trigger ask_user WITHOUT explicit choices parameter (to test fallback parsing):
   ```
   Ask me a simple question: "Would you like PostgreSQL, MySQL, or SQLite?" using ask_user without any choices parameter. Wait for my answer.
   ```
2. Observe the UI

### Expected:

- The fallback parser detects "PostgreSQL, MySQL, or SQLite" as 3 options
- Choice buttons appear: PostgreSQL, MySQL, SQLite
- Clicking a button sends the option text as the response

### Trigger Words That Activate Pattern 4:

- "choose", "pick", "select", "prefer", "like", "want", "use", "between", "recommend"
- Example: "Choose between React, Vue, or Angular" → 3 buttons

### Edge Cases:

- Only 1 option after split → no buttons shown (needs ≥2)
- More than 9 options → no buttons shown (MAX_CHOICES limit)
- Options with special characters → properly escaped in button HTML
- Question without trigger words → pattern doesn't match, no false positives

---

## VT-12: Updated AI Guidance — Choices Parameter Usage

**Root Cause Fixed:** modelDescription and instructionText updated with explicit examples for `choices` parameter usage.

### Steps:

1. Reload VS Code to pick up the updated extension
2. Check that copilot-instructions.md was re-injected (if instructionInjection is enabled)
3. Trigger a choice question:
   ```
   What programming language should I use for this project? Give me 3 options.
   ```
4. Observe how the AI invokes ask_user

### Expected:

- The AI should use `question` + `choices` parameters (not `questions` array)
- Choice buttons should appear in the UI
- If the AI still uses `questions` array, the updated guidance may need further tuning

### Note:

This test depends on AI model behavior which can vary. The guidance improvements increase the likelihood of correct parameter usage but cannot guarantee it 100%.
