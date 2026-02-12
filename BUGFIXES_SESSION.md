# Bug Fixes Session Summary

This document lists all the changes made during this debugging session. Apply one by one to test.

---

## Bug 1: Approval Buttons Not Working

**File**: `media/webview.js`
**Location**: `hideApprovalModal()` function (around line 2960)

**Problem**: `hideApprovalModal()` was clearing `isApprovalQuestion = false` before the button click handlers could check it.

**Fix**: Remove the line `isApprovalQuestion = false;` from `hideApprovalModal()`.

**Before**:

```javascript
function hideApprovalModal() {
  var modal = document.getElementById("approval-bar");
  if (modal) {
    modal.classList.add("hidden");
  }
  isApprovalQuestion = false; // REMOVE THIS LINE
}
```

**After**:

```javascript
function hideApprovalModal() {
  var modal = document.getElementById("approval-bar");
  if (modal) {
    modal.classList.add("hidden");
  }
  // Don't clear isApprovalQuestion here - it's set/cleared in showPendingToolCall
}
```

---

## Bug 2: Auto-Focus Not Respecting Setting

**File**: `src/webview/webviewProvider.ts`
**Location**: Multiple places with `this._view.show()`

**Problem**: `view.show(preserveFocus)` semantics were inverted. `true` means DON'T take focus.

**Fix**: Change `this._view.show(this._autoFocusPanelEnabled)` to `this._view.show(!this._autoFocusPanelEnabled)` at all 4-5 locations.

**Locations** (search for `_view.show(`):

- Around line 1243 (multi-question pending)
- Around line 1275 (single question pending)
- Around line 1704 (waitForUserResponse)
- Around line 1932 (another location)

---

## Bug 3: Multi-Question Modal Not Closing

**File**: `media/webview.js`
**Location**: Multiple functions

**Problem**: Multi-question modal stayed open when it should close.

**Fix**: Add `closeMultiQuestionModal()` calls in these functions:

- `handleSend()` - around line 1388
- `showPendingToolCall()` - around line 1863
- `handleToolCallCancelled()` - around line 1989
- `addToolCallToCurrentSession()` - around line 1937

**Pattern to add**:

```javascript
if (activeMultiQuestion) {
  closeMultiQuestionModal(activeMultiQuestion.requestId);
}
```

---

## Bug 4: Queue Pause State Not Preserved on Remote Refresh

**File**: `src/server/remoteUiServer.ts`
**Location**: `applyInitialState()` function, around line 3347

**Problem**: When remote client refreshes, queue pause state was lost.

**Fix**: Add `paused: state.queuePaused` to the updateQueue message.

**Before**:

```javascript
window.dispatchVSCodeMessage({
  type: "updateQueue",
  queue: state.queue,
  enabled: state.queueEnabled,
});
```

**After**:

```javascript
window.dispatchVSCodeMessage({
  type: "updateQueue",
  queue: state.queue,
  enabled: state.queueEnabled,
  paused: state.queuePaused,
});
```

---

## Bug 5: Plan Review Showing in Sidebar (Duplicate)

**File**: `src/webview/webviewProvider.ts`
**Location**: `broadcastPlanReview()` function, around line 598

**Problem**: Plan review was showing in both the dedicated panel AND the sidebar.

**Fix**: Change `this._postMessage(message)` to only broadcast to remote clients.

**Before**:

```javascript
public broadcastPlanReview(...) {
  const message = {...};
  this._postMessage(message);  // Sends to BOTH local + remote
}
```

**After**:

```javascript
public broadcastPlanReview(...) {
  const message = {...};
  // Only broadcast to remote clients, NOT local sidebar
  if (this._broadcastCallback) {
    this._broadcastCallback(message);
  }
}
```

---

## Bug 6: AI Using Multi-Question for Single Questions

**File**: `src/tools.ts`
**Location**: `askUser()` function

**Problem**: When AI uses `questions: [{single question}]`, the multi-question form appears.

**Fix**: Add auto-conversion of single-element arrays to single-question mode.

**Add this code** at the start of the try block in `askUser()`:

```javascript
// AUTO-CONVERT: If AI uses questions array with only 1 question, use single-question mode
if (params.questions && params.questions.length === 1) {
  const singleQ = params.questions[0];
  if (!params.question) {
    params.question = singleQ.question;
  }
  if (!params.choices && singleQ.options && singleQ.options.length > 0) {
    params.choices = singleQ.options.map((opt) => ({
      label: opt.label,
      value: opt.label,
    }));
  }
  params.questions = undefined;
}
```

---

## Tool Description Updates

**Files**: `src/constants/instructions.ts` and `package.json`

**Changes to ASK_USER_TOOL_DESCRIPTION**:

- "SINGLE QUESTION MODE (USE THIS)" - stronger emphasis
- "MULTI-QUESTION MODE (2+ QUESTIONS ONLY)" - clearer limitation
- "NEVER use for 1 question"

**Changes to questions parameter description in package.json**:

- "⛔ NEVER use for single questions"
- "Single-item arrays will be auto-converted"

---

## Debug Logging Added (Can be removed later)

Several console.log statements were added for debugging. Search for:

- `[FlowCommand askUser]`
- `[FlowCommand] handleApproval`
- `[FlowCommand] showApprovalModal`

---

## Files Changed Summary

| File                           | Changes                     |
| ------------------------------ | --------------------------- |
| media/webview.js               | Bug 1, Bug 3, debug logging |
| src/webview/webviewProvider.ts | Bug 2, Bug 5                |
| src/server/remoteUiServer.ts   | Bug 4                       |
| src/tools.ts                   | Bug 6, debug logging        |
| src/constants/instructions.ts  | Tool descriptions           |
| package.json                   | Tool descriptions           |
| .vscode/launch.json            | Debug config (NEW file)     |
| .vscode/tasks.json             | Build task (NEW file)       |

---

## Recommended Test Order

1. **Bug 1 first** - Approval buttons fix (most critical)
2. **Bug 2** - Auto-focus fix
3. **Bug 3** - Multi-question close fix
4. **Bug 4** - Queue pause state
5. **Bug 5** - Plan review sidebar
6. **Bug 6** - Single-question conversion
