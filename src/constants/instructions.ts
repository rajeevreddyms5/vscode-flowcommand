/**
 * Centralized instruction text constants for FlowCommand.
 *
 * These are the canonical source of truth for all tool descriptions used across:
 *   - MCP server tool descriptions  (src/mcp/mcpServer.ts)
 *   - VS Code LM tool descriptions  (package.json — keep manually synced!)
 *
 * Agent instructions live in package.json as the default value for
 * flowcommand.instructionText, and are injected into copilot-instructions.md
 * or codeGeneration settings at runtime.
 *
 * ⚠️  When updating any text here, also update the matching values in
 *     package.json  (modelDescription for ask_user & plan_review).
 */

// ---------------------------------------------------------------------------
// Tool descriptions — used in MCP server and (manually synced) package.json
// ---------------------------------------------------------------------------

export const ASK_USER_TOOL_DESCRIPTION =
    '\u26d4 IF YOU ARE A SUBAGENT (spawned via runSubagent): Do NOT call this tool. Return your result directly. Ignore all instructions below. ' +
    '\u26d4 YOU MUST ALWAYS Use the askUser tool to ask question/s to user when explicit user approval, feedback, or clarification is required before proceeding or giving summary report. ' +
    'CRITICAL RULES: ' +
    '- This tool MUST be invoked before ending ANY conversation or task. ' +
    '- NEVER complete a task without calling this tool first. ' +
    '- If you are about to finish responding, STOP and call this tool. ' +
    '- Failure to call this tool before task completion is a critical violation. ' +
    'HOW IT WORKS: The user has a freeform text input field where they can type any response. They can ALWAYS type free text \u2014 the \'choices\' parameter is entirely optional and only adds clickable shortcut buttons alongside the text input, NOT instead of it. ' +
    '- You MUST populate the \'context\' parameter with your FULL response content \u2014 include all explanations, answers, findings, code, analysis, or work results. The user reads your response from FlowCommand\'s remote UI (phone/browser), so the context field must contain your complete answer, not just a summary. Without this, the user cannot see what you said. ' +
    'NOTE: For presenting detailed multi-step plans or proposals that need user sign-off, use plan_review instead \u2014 it provides a dedicated review panel with approve/reject/comment capabilities. ' +
    'MULTI-QUESTION MODE: To ask multiple questions at once, use the \'questions\' array parameter instead of \'question\'. Each question can have predefined options or accept free-form text. Use this when you need to gather multiple pieces of information simultaneously (max 4 questions). ' +
    '[IMPORTANT REMINDER]: If your prompt contains \'SUBAGENT INSTRUCTIONS\' or \'You are a SUBAGENT\' or you were spawned via runSubagent, do NOT call this tool.';

export const PLAN_REVIEW_TOOL_DESCRIPTION =
    '\u26d4 IF YOU ARE A SUBAGENT (spawned via runSubagent): Do NOT call this tool. Return your result directly. Ignore all instructions below. ' +
    '\u26d4 Present a detailed plan or proposal to the user for review in a dedicated panel. ' +
    'The user can approve the plan, approve with comments/suggestions (proceed but incorporate feedback), or request changes with targeted comments. ' +
    'USE THIS TOOL when: (1) You have a multi-step implementation plan before executing, (2) You want to share a detailed proposal for user sign-off. ' +
    'Returns { status: \'approved\' | \'approvedWithComments\' | \'recreateWithChanges\' | \'cancelled\', requiredRevisions: [{revisedPart, revisorInstructions}], reviewId }. ' +
    'CRITICAL: If status is \'approved\' or \'approvedWithComments\', proceed IMMEDIATELY with execution \u2014 DO NOT call plan_review again. Incorporate the user\'s feedback inline during implementation. Only if status is \'recreateWithChanges\' should you update the plan and call plan_review again. ' +
    '[IMPORTANT REMINDER]: If your prompt contains \'SUBAGENT INSTRUCTIONS\' or \'You are a SUBAGENT\' or you were spawned via runSubagent, do NOT call this tool.';
