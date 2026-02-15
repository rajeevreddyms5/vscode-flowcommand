# FlowCommand Tool Mode Tests v2.0.4

> **AI Instructions**: When user says "start tool mode tests" or "run tool mode tests":
>
> 1. Execute each test by calling the tool directly (DO NOT ask user to run prompts)
> 2. After each test, ask user "PASS or FAIL?" using ask_user with choices
> 3. Track results and present summary at end

---

## Test Execution Protocol

When running these tests:

- **YOU (the AI) must call ask_user yourself** — do not tell the user to run prompts
- After each execution, use `ask_user` with `choices: [{label:"PASS",value:"pass"},{label:"FAIL",value:"fail"}]`
- If FAIL, ask for details using `ask_user` with just `question` (free text)
- Continue to next test automatically

---

## Test T1: Single Question with Choices (Mode A)

**Purpose**: Verify AI correctly uses `question` + `choices` for single question with options.

**Execute this call**:

```json
{
  "question": "Which database would you like to use?",
  "choices": [
    { "label": "PostgreSQL", "value": "postgresql" },
    { "label": "MySQL", "value": "mysql" },
    { "label": "SQLite", "value": "sqlite" }
  ]
}
```

**Expected UI**: Choice buttons appear above text input. NO modal, NO Submit/Cancel buttons.

**After execution, ask**: "Did you see PostgreSQL, MySQL, SQLite as clickable buttons (not in a modal)? PASS or FAIL?"

---

## Test T2: Single Open-Ended Question (Mode B)

**Purpose**: Verify AI correctly uses `question` only for open-ended questions.

**Execute this call**:

```json
{
  "question": "What would you like me to help you with next?"
}
```

**Expected UI**: Question appears, text input ready. NO modal, NO buttons except the default input area.

**After execution, ask**: "Did the question appear with just the text input (no choice buttons, no modal)? PASS or FAIL?"

---

## Test T3: X or Y Question Detection

**Purpose**: Verify "X or Y?" questions show actual choices, not Yes/No approval buttons.

**Execute this call**:

```json
{
  "question": "PASS or FAIL?"
}
```

**Expected UI**: Should show "PASS" and "FAIL" as choice buttons (auto-detected from question text), NOT "Yes" and "No".

**After execution, ask**: "Did you see PASS and FAIL buttons (not Yes/No)? PASS or FAIL?"

---

## Test T4: Comma-Separated Options Detection

**Purpose**: Verify comma-separated options are auto-detected from question text.

**Execute this call**:

```json
{
  "question": "Would you prefer React, Vue, or Angular?"
}
```

**Expected UI**: Should show "React", "Vue", "Angular" as choice buttons (auto-detected).

**After execution, ask**: "Did you see React, Vue, Angular as clickable buttons? PASS or FAIL?"

---

## Test T5: Multi-Question Form (Mode C) — Valid Usage

**Purpose**: Verify multi-question mode works correctly with 2+ questions.

**Execute this call**:

```json
{
  "questions": [
    {
      "header": "Language",
      "question": "What programming language do you prefer?",
      "options": [
        { "label": "Python" },
        { "label": "JavaScript" },
        { "label": "Go" }
      ]
    },
    {
      "header": "Framework",
      "question": "What framework do you use?"
    }
  ]
}
```

**Expected UI**: Modal form appears with both questions. Question 1 has radio buttons. Question 2 has free text input. Submit/Cancel buttons at bottom.

**After execution, ask**: "Did a modal form appear with both questions (radio buttons for Q1, text input for Q2, Submit/Cancel buttons)? PASS or FAIL?"

---

## Test T6: Auto-Conversion of Single-Item Questions Array

**Purpose**: Verify that if AI mistakenly uses `questions` array with 1 item, it auto-converts to Mode A.

**Execute this call** (intentionally wrong — should auto-convert):

```json
{
  "questions": [
    {
      "header": "Database",
      "question": "Which database?",
      "options": [{ "label": "PostgreSQL" }, { "label": "MySQL" }]
    }
  ]
}
```

**Expected UI**: Should auto-convert to choice buttons (PostgreSQL, MySQL), NOT a modal form.

**After execution, ask**: "Did you see PostgreSQL and MySQL as choice buttons (NOT in a modal form)? PASS or FAIL?"

---

## Test T7: Context with Brief Response

**Purpose**: Verify context appears in remote UI without overwhelming detail.

**Execute this call**:

```json
{
  "context": "I analyzed the code and found 3 issues. Here's a quick summary.",
  "question": "Should I fix these issues now?"
}
```

**Expected UI**: Context text visible above the question. Approval buttons (Yes/No) appear since it's a should/can question.

**After execution, ask**: "Did you see the brief context text followed by the question with Yes/No buttons? PASS or FAIL?"

---

## Test T8: Cancel Handling

**Purpose**: Verify cancel works correctly and AI doesn't re-prompt.

**Execute this call**:

```json
{
  "question": "Select a color:",
  "choices": [
    { "label": "Red", "value": "red" },
    { "label": "Blue", "value": "blue" }
  ]
}
```

**User action**: Click the input area's "End" button or type "cancel".

**After cancel, AI should**: Acknowledge the cancellation and NOT re-ask the same question.

**Ask after user cancels**: "Did the AI acknowledge your cancellation without re-asking? PASS or FAIL?"

---

## Test T9: Numbered Options Detection (1. 2. 3.)

**Purpose**: Verify numbered list options are auto-detected from question text.

**Execute this call**:

```json
{
  "question": "Which option would you like?\n1. Create new file\n2. Edit existing file\n3. Delete file"
}
```

**Expected UI**: Should show "1", "2", "3" as choice buttons (or the full text as buttons).

**After execution, ask**: "Did you see numbered options as clickable buttons? PASS or FAIL?"

---

## Test T10: Lettered Options Detection (A. B. C.)

**Purpose**: Verify lettered list options are auto-detected from question text.

**Execute this call**:

```json
{
  "question": "Select your preference:\nA. Fast performance\nB. Low memory usage\nC. Easy to maintain"
}
```

**Expected UI**: Should show "A", "B", "C" as choice buttons.

**After execution, ask**: "Did you see lettered options (A, B, C) as clickable buttons? PASS or FAIL?"

---

## Test T11: Bullet Point Options Detection

**Purpose**: Verify bullet point options are auto-detected from question text.

**Execute this call**:

```json
{
  "question": "Choose a deployment target:\n- AWS\n- Azure\n- Google Cloud"
}
```

**Expected UI**: Should show "AWS", "Azure", "Google Cloud" as choice buttons.

**After execution, ask**: "Did you see bullet point options as clickable buttons? PASS or FAIL?"

---

## Test T12: Inline Numbered Options (1 - option 2 - option)

**Purpose**: Verify inline numbered options are detected.

**Execute this call**:

```json
{
  "question": "Which approach? 1 - Quick fix 2 - Proper refactor 3 - Leave as-is"
}
```

**Expected UI**: Should show "1", "2", "3" or the full options as buttons.

**After execution, ask**: "Did you see inline numbered options as clickable buttons? PASS or FAIL?"

---

## Test T13: Option X: Format Detection

**Purpose**: Verify "Option A:" format options are detected.

**Execute this call**:

```json
{
  "question": "Please select:\nOption A: Use TypeScript\nOption B: Use JavaScript\nOption C: Use both"
}
```

**Expected UI**: Should show "Option A", "Option B", "Option C" as choice buttons.

**After execution, ask**: "Did you see Option A/B/C as clickable buttons? PASS or FAIL?"

---

## Test T14: Multi-Question with Checkboxes (multiSelect)

**Purpose**: Verify multi-select works correctly in multi-question mode.

**Execute this call**:

```json
{
  "questions": [
    {
      "header": "Features",
      "question": "Which features do you need? (select all that apply)",
      "options": [
        { "label": "Authentication" },
        { "label": "Database" },
        { "label": "API" }
      ],
      "multiSelect": true
    },
    {
      "header": "Priority",
      "question": "What is the priority?",
      "options": [
        { "label": "High" },
        { "label": "Medium" },
        { "label": "Low" }
      ]
    }
  ]
}
```

**Expected UI**: Modal form. Q1 has checkboxes (can select multiple). Q2 has radio buttons (single select).

**After execution, ask**: "Did Q1 show checkboxes (multi-select) and Q2 show radio buttons (single-select)? PASS or FAIL?"

---

## Test T15: Short Approval Question

**Purpose**: Verify short approval questions show Yes/No buttons.

**Execute this call**:

```json
{
  "question": "Should I proceed?"
}
```

**Expected UI**: Should show Yes/No approval buttons (interactive approval enabled).

**After execution, ask**: "Did you see Yes and No buttons (approval mode)? PASS or FAIL?"

---

## Test T16: Emoji Numbered Options (1️⃣ 2️⃣ 3️⃣)

**Purpose**: Verify emoji number options are detected.

**Execute this call**:

```json
{
  "question": "Choose:\n1️⃣ Dark theme\n2️⃣ Light theme\n3️⃣ System default"
}
```

**Expected UI**: Should show emoji numbers as choice buttons.

**After execution, ask**: "Did you see emoji numbered options as clickable buttons? PASS or FAIL?"

---

## Test T17: Options with Descriptions

**Purpose**: Verify option descriptions render correctly.

**Execute this call**:

```json
{
  "question": "Select database:",
  "choices": [
    { "label": "PostgreSQL", "value": "pg" },
    { "label": "MongoDB", "value": "mongo" },
    { "label": "Redis", "value": "redis" }
  ]
}
```

**Expected UI**: Choice buttons with labels. Hover should work.

**After execution, ask**: "Did choice buttons appear with correct labels? PASS or FAIL?"

---

## Test T18: Recommended Option Badge

**Purpose**: Verify recommended option is marked in multi-question mode.

**Execute this call**:

```json
{
  "questions": [
    {
      "header": "Version",
      "question": "Which Node.js version?",
      "options": [
        { "label": "Node 18" },
        { "label": "Node 20", "recommended": true },
        { "label": "Node 22" }
      ]
    },
    {
      "header": "Manager",
      "question": "Package manager?"
    }
  ]
}
```

**Expected UI**: Node 20 should have a "recommended" badge/highlight.

**After execution, ask**: "Did Node 20 show a 'recommended' indicator/badge? PASS or FAIL?"

---

## Test T19: Freeform + Options Combo (allowFreeformInput)

**Purpose**: Verify freeform input appears alongside options.

**Execute this call**:

```json
{
  "questions": [
    {
      "header": "Color",
      "question": "Pick a color or enter custom:",
      "options": [
        { "label": "Red" },
        { "label": "Blue" },
        { "label": "Green" }
      ],
      "allowFreeformInput": true
    },
    {
      "header": "Notes",
      "question": "Any additional notes?"
    }
  ]
}
```

**Expected UI**: Q1 has options AND a text input for custom value.

**After execution, ask**: "Did Q1 show both option buttons AND a text input field? PASS or FAIL?"

---

## Test T20: Empty Submit Handling

**Purpose**: Verify empty response is handled gracefully.

**Execute this call**:

```json
{
  "question": "Type something or leave empty:"
}
```

**User action**: Press Enter without typing anything.

**Expected behavior**: Either submits empty response or shows validation hint.

**After execution, ask**: "Did the tool accept an empty response or prompt for input? PASS or FAIL?"

---

## Results Summary (Run on February 15, 2026)

| Test | Description                              | Result  | Notes                                                            |
| ---- | ---------------------------------------- | ------- | ---------------------------------------------------------------- |
| T1   | Single question + choices (Mode A)       | ✅ PASS | Choice buttons displayed correctly                               |
| T2   | Single open-ended question (Mode B)      | ✅ PASS | Text input field displayed correctly                             |
| T3   | X or Y? detection (PASS/FAIL not Yes/No) | ✅ PASS | Auto-detected PASS/FAIL buttons instead of Yes/No                |
| T4   | Comma-separated options detection        | ✅ PASS | React, Vue, Angular detected and displayed as buttons            |
| T5   | Multi-question form (Mode C valid)       | ✅ PASS | Modal form with radio buttons and text input rendered correctly  |
| T6   | Auto-conversion single-item questions    | ✅ PASS | **FIXED!** Single-item array now converts to Mode A buttons      |
| T7   | Context with brief response              | ✅ PASS | Context displayed above question with Yes/No buttons             |
| T8   | Cancel handling                          | ✅ PASS | No re-prompting after user response                              |
| T9   | Numbered options (1. 2. 3.)              | ✅ PASS | **FIXED!** Shows full text as clickable buttons                  |
| T10  | Lettered options (A. B. C.)              | ✅ PASS | Shows full text instead of just letters                          |
| T11  | Bullet point options                     | ✅ PASS | - Bullet format detected and displayed as buttons                |
| T12  | Inline numbered options                  | ✅ PASS | Shows full options as clickable buttons (1 - 2 - 3)              |
| T13  | Option X: format                         | ✅ PASS | **FIXED!** All options (A, B, C) now detected correctly          |
| T14  | Multi-question checkboxes                | ✅ PASS | Checkboxes for multiSelect:true, radio buttons for single-select |
| T15  | Short approval question                  | ✅ PASS | Yes/No approval buttons displayed                                |
| T16  | Emoji numbered options                   | ✅ PASS | Shows full text options instead of emoji numbers (acceptable)    |
| T17  | Options with descriptions                | ✅ PASS | Choice button labels rendered correctly                          |
| T18  | Recommended option badge                 | ✅ PASS | "Node 20" showed recommended indicator                           |
| T19  | Freeform + options combo                 | ✅ PASS | Both option buttons and text input field displayed               |
| T20  | Empty submit handling                    | ✅ PASS | Tool accepts responses gracefully                                |

### **Overall Score: 20/20 (100%)** 🎉

### Issues Fixed in Latest Update:

1. **T6 FIXED** ✅ - Auto-conversion logic now working. Single-item `questions` array correctly converts to Mode A (choice buttons).
2. **T13 FIXED** ✅ - "Option C: Use both" is now correctly detected. All options in "Option X:" format work properly.

### Additional Improvements Needed:

**FIXME: Input Field Auto-Focus**: When FlowCommand panel is in view (when the Auto-Focus is ON), the input field should be ready to accept typing immediately without requiring the user to click on it first. Currently, users must click the input field before they can start typing. This should be fixed to allow immediate typing when the panel is visible and a question is pending.
**FIXME: End Button Color**: The End button in FlowCommand currently shows yellow color on hover. Since "End" is a significant/destructive action (terminates the session), it should be marked in red to better signify the terminal nature of the action and prevent accidental clicks.

---

## Automated Test Runner Instructions

When AI runs these tests:

1. **Start message**: "Starting FlowCommand Tool Mode Tests v2.0.4. I'll run 20 tests and ask you to verify each one."

2. **For each test**:
   - Execute the `ask_user` call as specified
   - Wait for user response
   - Ask "PASS or FAIL?" with choices
   - If FAIL, ask for failure details
   - Record result

3. **End message**: Present the filled results table and any failure notes.

**Key principle**: The AI does all the work — user just observes UI and clicks PASS/FAIL.
