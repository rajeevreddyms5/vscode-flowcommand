# Verification Tests for FIXME Fixes

## Instructions for AI

You are running interactive verification tests for the FlowCommand extension.
**Run each test one by one.** For each test:

1. Read the test description and what was fixed
2. Execute the prompt yourself (call the tool directly — do NOT tell the user to run it)
3. Ask the user to verify what they see in the UI
4. Record PASS or FAIL based on their response
5. **If FAIL:** Add a `FIXME:` line directly below the test's **Verify** section with the user's failure description
6. Move to the next test

**Important:** YOU must execute the prompts. Do not ask the user to copy-paste prompts into chat. Use `ask_user` or `plan_review` directly as described in each test.

Build the extension first: `npm run compile`

---

## Phase 1 Fixes

### VT-1: Queue Pause — No Auto-Consume (Fix for T2.6)

**What was fixed:** Queue items were auto-consumed even when the queue was paused.

**Setup (ask user to do this):**
Ask the user to: Enable queue mode, add 2-3 items, then **pause** the queue.

**Execute:**
Call `ask_user` with: `question: "Do you see the queue items still in the queue (not auto-consumed)?"`

**Verify with user:** Queue items should NOT be auto-consumed while paused. Ask the user to confirm.

FIXME: even though we pause the prompt queue, it was autoconsumed when using IDE

---

### VT-2: Plan Review Cancel Button (Fix for T5.1)

**What was fixed:** Plan review panel was missing a Cancel button.

**Execute:**
Call `plan_review` with a short 3-step plan for building a REST API.

**Verify with user:** Ask: "Do you see three buttons in the plan review footer: Cancel (left, subtle), Request Changes (middle), and Approve (right, primary)? Click Cancel to test it closes the panel."

---

### VT-3: Waiting Indicator During Plan Review (Fix for T5.3)

**What was fixed:** No pulsing "waiting for input" indicator appeared in the sidebar during plan review.

**Execute:**
Call `plan_review` with a short plan (e.g., 2-step plan for setting up a database).

**Verify with user:** Ask: "Do you see an orange pulsing 'AI is waiting for your input' indicator in the FlowCommand sidebar input area? Does it disappear after you approve/cancel?"

FIXME: that planreview that was canceled using cancel button in the IDE is not closing the planreview in the remote session.

---

### VT-4: Remote Plan Review Reconnect (Fix for T5.3 — Remote) `[MANUAL]`

**What was fixed:** Verified that plan review state restores correctly on remote reconnect.

**This test requires manual steps:**
Ask the user to:

1. Start the remote server and connect from phone/browser
2. Tell you when ready, then you'll trigger `plan_review`
3. Disconnect and reconnect the remote session
4. Verify the plan review modal restores

FIXME: Plan review modal does not restore after remote reconnect.

---

### VT-5: History Info Icon (Fix for T8.2)

**What was fixed:** Long info text in history modal caused button overflow. Replaced with ℹ icon + tooltip.

**Execute:**
Call `ask_user` with: `question: "Open the History modal (clock icon) in the FlowCommand panel. Do you see an ℹ info icon instead of long text? Does hovering show 'History is stored in VS Code globalStorage/tool-history.json'?"`

---

### VT-6: Template UX Rename (Fix for T12.3)

**What was fixed:** "Set as Template" / "Unset Template" renamed to "Pin" / "Unpin" with help text.

**Execute:**
Call `ask_user` with: `question: "Open Reusable Prompts modal. Do you see: (1) help text mentioning '📌 Pinned prompts are automatically appended...', (2) pin icon 📌 on prompt cards, (3) tooltip says 'Pin — auto-append to all messages'?"`

---

## Phase 2 Fixes

### VT-7: Other Button Removed from Choices Bar (Fix for T3.2)

**What was fixed:** Redundant "Other" button removed from choices bar — text input is always visible.

**Execute:**
Call `ask_user` with:

- `question: "Which database would you like to use?"`
- `choices: [{label: "PostgreSQL", value: "postgresql"}, {label: "MySQL", value: "mysql"}, {label: "SQLite", value: "sqlite"}]`

**Verify with user:** After they respond, ask: "Did choice buttons appear? Was there NO 'Other' button? Was the text input still visible below for custom responses?"

FIXME: the AI used question with text field and submit and cancel buttons for this single question. so no choice buttons appeared.

---

### VT-8: End/Cancel Button Removed from Choices Bar (Fix for T3.2)

**What was fixed:** End/Cancel button removed — FlowCommand's own End button handles session termination.

**Execute:**
Call `ask_user` with:

- `question: "Which color theme do you prefer?"`
- `choices: [{label: "Dark", value: "dark"}, {label: "Light", value: "light"}, {label: "System", value: "system"}]`

**Verify with user:** After they respond, ask: "Did you see ONLY the choice buttons (Dark, Light, System) with no 'End', 'Cancel', or 'Other' buttons?"

FIXME: the AI used question with text field and submit and cancel buttons for this single question. so no choice buttons appeared.

---

### VT-9: End/Cancel Button Removed from Approval Modal (Fix for T3.3)

**What was fixed:** Approval modal no longer shows Cancel/End — only Yes and No.

**Setup:** Ask the user to ensure "Interactive Approval" is enabled in FlowCommand settings.

**Execute:**
Call `ask_user` with: `question: "Should I proceed with the deployment?"`

**Verify with user:** Ask: "Did you see ONLY 'Yes' and 'No' buttons in the approval bar? No 'Cancel' or 'End' button?"

---

### VT-10: Other Option Removed from Multi-Question Modal (Fix for T4.1)

**What was fixed:** "Other" radio/checkbox removed from multi-question forms.

**Execute:**
Call `ask_user` with the `questions` parameter:

- Question 1: `header: "Language"`, `question: "What programming language?"`, `options: [{label: "Python"}, {label: "JavaScript"}, {label: "Go"}]`
- Question 2: `header: "Framework"`, `question: "What framework do you prefer?"` (no options — free text)

**Verify with user:** Ask: "In the multi-question form: (1) Did Question 1 show radio buttons for Python/JavaScript/Go with NO 'Other' option? (2) Did Question 2 show a free text input? (3) Were Submit and Cancel buttons at the bottom?"

FIXME: no options at all showed. no multiquesions used. only single question is appearing.

---

### VT-11: Comma-Separated Fallback Choice Parsing (Fix for T6.1, T6.2)

**What was fixed:** Added fallback parsing for comma-separated options like "X, Y, or Z".

**Execute:**
Call `ask_user` with ONLY: `question: "Would you like to use PostgreSQL, MySQL, or SQLite?"` — do NOT pass `choices` parameter. This tests the fallback parser.

**Verify with user:** Ask: "Did choice buttons appear for PostgreSQL, MySQL, and SQLite even though no explicit choices were passed? The fallback parser should have detected them from the question text."

FIXME: the following buttons appeared "to use PostgreSQL", "MySQL", "SQLite" instead of "PostgreSQL", "MySQL", "SQLite"

---

### VT-12: Updated AI Guidance — Choices Parameter Usage

**What was fixed:** modelDescription and instructionText updated with explicit examples.

**This is a meta-test:** If you (the AI running these tests) correctly used `choices` parameter in VT-7 and VT-8 above, this test passes. The updated guidance in modelDescription should have led you to use `question` + `choices` parameters instead of `questions` array.

**Verify:** Did VT-7 and VT-8 produce choice buttons? If yes → PASS.

FIXME: VT-7 and VT-8 did not produce choice buttons; AI used questions array instead of choices parameter.

---

## Results Summary

After running all tests:

1. Present the results table to the user
2. For any FAIL results, ensure a `FIXME: <failure description>` line exists under that test
3. Commit the updated file with FIXME annotations if any tests failed

| Test  | Description                          | Result |
| ----- | ------------------------------------ | ------ |
| VT-1  | Queue pause no auto-consume          | FAIL   |
| VT-2  | Plan review cancel button            | PASS   |
| VT-3  | Waiting indicator during plan review | PASS   |
| VT-4  | Remote plan review reconnect         | FAIL   |
| VT-5  | History info icon                    | PASS   |
| VT-6  | Template UX rename (Pin/Unpin)       | PASS   |
| VT-7  | Other button removed from choices    | FAIL   |
| VT-8  | End/Cancel removed from choices      | FAIL   |
| VT-9  | End/Cancel removed from approval     | PASS   |
| VT-10 | Other removed from multi-question    | FAIL   |
| VT-11 | Comma-separated fallback parsing     | FAIL   |
| VT-12 | Updated AI guidance choices usage    | FAIL   |
| VT-12 | AI guidance for choices param        |        |
