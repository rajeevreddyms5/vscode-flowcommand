import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  FILE_EXCLUSION_PATTERNS,
  FILE_SEARCH_EXCLUSION_PATTERNS,
  formatExcludePattern,
} from "../constants/fileExclusions";
import {
  ContextManager,
  ContextReferenceType,
  ContextReference,
} from "../context";
import { resolvePlanReview } from "../planReview/index";
import { PlanReviewPanelResult } from "../planReview/types";
import { Question } from "../tools";

// Queued prompt interface
export interface QueuedPrompt {
  id: string;
  prompt: string;
  attachments?: AttachmentInfo[]; // Optional attachments (images, files) included with the prompt
}

// Attachment info
export interface AttachmentInfo {
  id: string;
  name: string;
  uri: string;
  isTemporary?: boolean;
  isFolder?: boolean;
  isTextReference?: boolean;
}

// File search result (also used for context items like #terminal, #problems)
export interface FileSearchResult {
  name: string;
  path: string;
  uri: string;
  icon: string;
  isFolder?: boolean;
  isContext?: boolean; // true for #terminal, #problems context items
}

// User response result
export interface UserResponseResult {
  value: string;
  queue: boolean;
  attachments: AttachmentInfo[];
  cancelled?: boolean; // Indicates if the request was superseded by a new one
}

// Tool call history entry
export interface ToolCallEntry {
  id: string;
  prompt: string;
  context?: string; // AI's full response content (answer, explanation, work done)
  response: string;
  timestamp: number;
  isFromQueue: boolean;
  status: "pending" | "completed" | "cancelled";
  attachments?: AttachmentInfo[];
}

// Queued agent request (when multiple agents call ask_user concurrently)
interface QueuedAgentRequest {
  type: "single" | "multi";
  // For single question mode
  question?: string;
  context?: string;
  explicitChoices?: ParsedChoice[];
  // For multi-question mode
  questions?: Question[];
  // Promise resolve function
  resolve: (result: UserResponseResult) => void;
  toolCallId: string;
  entry: ToolCallEntry;
}

// Parsed choice from question
export interface ParsedChoice {
  label: string; // Display text (e.g., "1" or "Test functionality")
  value: string; // Response value to send (e.g., "1" or full text)
  shortLabel?: string; // Short version for button (e.g., "1" for numbered)
}

// Reusable prompt interface
export interface ReusablePrompt {
  id: string;
  name: string; // Short name for /slash command (e.g., "fix", "test", "refactor")
  prompt: string; // Full prompt text
  isTemplate?: boolean; // If true, this prompt's content auto-appends to all user messages
}

// Message types
type ToWebviewMessage =
  | {
      type: "updateQueue";
      queue: QueuedPrompt[];
      enabled: boolean;
      paused: boolean;
    }
  | {
      type: "toolCallPending";
      id: string;
      prompt: string;
      context?: string;
      isApprovalQuestion: boolean;
      choices?: ParsedChoice[];
    }
  | { type: "toolCallCompleted"; entry: ToolCallEntry }
  | { type: "updateCurrentSession"; history: ToolCallEntry[] }
  | { type: "updatePersistedHistory"; history: ToolCallEntry[] }
  | { type: "fileSearchResults"; files: FileSearchResult[] }
  | { type: "updateAttachments"; attachments: AttachmentInfo[] }
  | { type: "imageSaved"; attachment: AttachmentInfo }
  | { type: "openSettingsModal" }
  | { type: "openPromptsModal" }
  | {
      type: "updateSettings";
      soundEnabled: boolean;
      desktopNotificationEnabled: boolean;
      autoFocusPanelEnabled: boolean;
      mobileNotificationEnabled: boolean;
      interactiveApprovalEnabled: boolean;
      reusablePrompts: ReusablePrompt[];
      instructionInjection: string;
      instructionText: string;
      instructionStatus: InstructionStatus;
      mcpRunning: boolean;
      mcpUrl: string | null;
    }
  | { type: "slashCommandResults"; prompts: ReusablePrompt[] }
  | { type: "playNotificationSound" }
  | { type: "toolCallCancelled"; id: string } // AI/user cancelled the pending tool call (e.g. Copilot Stop button)
  | { type: "clearProcessing" } // Clear "Processing your response" state
  | {
      type: "contextSearchResults";
      suggestions: Array<{
        type: string;
        label: string;
        description: string;
        detail: string;
      }>;
    }
  | {
      type: "contextReferenceAdded";
      reference: { id: string; type: string; label: string; content: string };
    }
  | { type: "planReviewPending"; reviewId: string; title: string; plan: string }
  | { type: "planReviewCompleted"; reviewId: string; status: string }
  | { type: "multiQuestionPending"; requestId: string; questions: Question[] }
  | { type: "multiQuestionCompleted"; requestId: string }
  | { type: "queuedAgentRequestCount"; count: number };

type FromWebviewMessage =
  | { type: "submit"; value: string; attachments: AttachmentInfo[] }
  | {
      type: "addQueuePrompt";
      prompt: string;
      id: string;
      attachments?: AttachmentInfo[];
    }
  | { type: "removeQueuePrompt"; promptId: string }
  | { type: "editQueuePrompt"; promptId: string; newPrompt: string }
  | { type: "reorderQueue"; fromIndex: number; toIndex: number }
  | { type: "toggleQueue"; enabled: boolean }
  | { type: "clearQueue" }
  | { type: "addAttachment" }
  | { type: "removeAttachment"; attachmentId: string }
  | { type: "removeHistoryItem"; callId: string }
  | { type: "clearPersistedHistory" }
  | { type: "openHistoryModal" }
  | { type: "searchFiles"; query: string }
  | { type: "saveImage"; data: string; mimeType: string }
  | { type: "saveImageFromUri"; uri: string }
  | { type: "addFileReference"; file: FileSearchResult }
  | { type: "webviewReady" }
  | { type: "openSettingsModal" }
  | { type: "updateSoundSetting"; enabled: boolean }
  | { type: "updateInteractiveApprovalSetting"; enabled: boolean }
  | { type: "updateDesktopNotificationSetting"; enabled: boolean }
  | { type: "updateAutoFocusPanelSetting"; enabled: boolean }
  | { type: "updateMobileNotificationSetting"; enabled: boolean }
  | { type: "addReusablePrompt"; name: string; prompt: string }
  | {
      type: "editReusablePrompt";
      id: string;
      name: string;
      prompt: string;
      isTemplate?: boolean;
    }
  | { type: "removeReusablePrompt"; id: string }
  | { type: "setPromptTemplate"; id: string } // Set a prompt as the active template
  | { type: "clearPromptTemplate" } // Clear the active template
  | { type: "searchSlashCommands"; query: string }
  | { type: "openExternal"; url: string }
  | { type: "searchContext"; query: string }
  | {
      type: "selectContextReference";
      contextType: string;
      options?: Record<string, unknown>;
    }
  | { type: "updateInstructionInjection"; method: string }
  | { type: "updateInstructionText"; text: string }
  | { type: "resetInstructionText" }
  | { type: "reinjectInstruction" }
  | { type: "mcpToggle" }
  | { type: "mcpStart" }
  | { type: "mcpStop" }
  | { type: "mcpCopyUrl" }
  | { type: "pauseQueue" }
  | { type: "resumeQueue" }
  | {
      type: "planReviewResponse";
      reviewId: string;
      action: string;
      revisions: Array<{ revisedPart: string; revisorInstructions: string }>;
    }
  | {
      type: "multiQuestionResponse";
      requestId: string;
      answers: Array<{
        header: string;
        selected: string[];
        freeformText?: string;
      }>;
      cancelled?: boolean;
    };

type InstructionStatus =
  | "off"
  | "correct"
  | "missing"
  | "modified"
  | "corrupted"
  | "no-file"
  | "unknown";

export class FlowCommandWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "flowCommandView";

  private _view?: vscode.WebviewView;
  private _pendingRequests: Map<string, (result: UserResponseResult) => void> =
    new Map();

  // Prompt queue state
  private _promptQueue: QueuedPrompt[] = [];
  private _queueEnabled: boolean = true; // Default to queue mode
  private _queuePaused: boolean = false; // Pause queue processing

  // Attachments state
  private _attachments: AttachmentInfo[] = [];

  // Current session tool calls (memory only - not persisted during session)
  private _currentSessionCalls: ToolCallEntry[] = [];
  // Persisted history from past sessions (loaded from disk)
  private _persistedHistory: ToolCallEntry[] = [];
  private _currentToolCallId: string | null = null;
  private _currentExplicitChoices: ParsedChoice[] | undefined;
  // Current multi-question state for remote sync
  private _currentMultiQuestions: Question[] | null = null;

  // Queue for concurrent agent requests (when multiple agents call ask_user simultaneously)
  private _queuedAgentRequests: QueuedAgentRequest[] = [];

  // Webview ready state - prevents race condition on first message
  private _webviewReady: boolean = false;
  private _pendingToolCallMessage: {
    id: string;
    prompt: string;
    context?: string;
    explicitChoices?: ParsedChoice[];
  } | null = null;

  // Debounce timer for queue persistence
  private _queueSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _QUEUE_SAVE_DEBOUNCE_MS = 300;

  // Debounce timer for history persistence (async background saves)
  private _historySaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _HISTORY_SAVE_DEBOUNCE_MS = 2000; // 2 seconds debounce
  private _historyDirty: boolean = false; // Track if history needs saving

  // Debounce timer for current session persistence (prevents loss on reload)
  private _currentSessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _CURRENT_SESSION_SAVE_DEBOUNCE_MS = 1000;

  // Performance limits
  private readonly _MAX_HISTORY_ENTRIES = 100;
  private readonly _MAX_CURRENT_SESSION_ENTRIES = 200;
  private readonly _MAX_FILE_SEARCH_RESULTS = 500;
  private readonly _MAX_QUEUE_PROMPT_LENGTH = 100000; // 100KB for queue prompts
  private readonly _MAX_FOLDER_SEARCH_RESULTS = 1000;
  private readonly _VIEW_OPEN_TIMEOUT_MS = 5000;
  private readonly _VIEW_OPEN_POLL_INTERVAL_MS = 100;
  private readonly _SHORT_QUESTION_THRESHOLD = 100; // chars for approval heuristic

  // File search cache with TTL
  private _fileSearchCache: Map<
    string,
    { results: FileSearchResult[]; timestamp: number }
  > = new Map();
  private readonly _FILE_CACHE_TTL_MS = 5000;

  // Map for O(1) lookup of tool calls by ID (synced with _currentSessionCalls array)
  private _currentSessionCallsMap: Map<string, ToolCallEntry> = new Map();

  // Reusable prompts (loaded from VS Code settings)
  private _reusablePrompts: ReusablePrompt[] = [];

  // Notification sound enabled (loaded from VS Code settings)
  private _soundEnabled: boolean = true;

  // Desktop notification enabled (VS Code info message popup)
  private _desktopNotificationEnabled: boolean = true;

  // Auto-focus panel when AI calls ask_user
  private _autoFocusPanelEnabled: boolean = true;

  // Mobile browser notification for remote clients
  private _mobileNotificationEnabled: boolean = false;

  // Interactive approval buttons enabled (loaded from VS Code settings)
  private _interactiveApprovalEnabled: boolean = true;

  // Current theme (light or dark) for remote clients
  private _currentTheme: "light" | "dark" = "dark";

  // Instruction injection settings
  private _instructionInjection: string = "off";
  private _instructionText: string = "";
  private _instructionStatus: InstructionStatus = "unknown";

  // MCP server status (for settings UI)
  private _mcpRunning: boolean = false;
  private _mcpUrl: string | null = null;

  // Flag to prevent config reload during our own updates (avoids race condition)
  private _isUpdatingConfig: boolean = false;

  // Disposables to clean up
  private _disposables: vscode.Disposable[] = [];

  // Context manager for #terminal, #problems references
  private readonly _contextManager: ContextManager;

  // Remote server broadcast callback - called whenever state changes
  private _broadcastCallback: ((message: ToWebviewMessage) => void) | null =
    null;

  // Processing state tracking for status bar indicator
  private _isProcessing: boolean = false;
  private _processingStateCallback: ((isProcessing: boolean) => void) | null =
    null;
  private _processingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly _PROCESSING_TIMEOUT_MS = 30000; // 30 seconds

  // Flag to track if current message is from remote client (to avoid cross-triggering UI)
  private _isRemoteMessageContext: boolean = false;

  // Active plan review state — tracked for remote client reconnection/refresh
  private _activePlanReview: {
    reviewId: string;
    title: string;
    plan: string;
  } | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    contextManager: ContextManager,
  ) {
    this._contextManager = contextManager;
    // Load both queue and history async to not block activation
    this._loadQueueFromDiskAsync().catch((err) => {
      console.error("Failed to load queue:", err);
    });
    this._loadPersistedHistoryFromDiskAsync().catch((err) => {
      console.error("Failed to load history:", err);
    });
    this._loadCurrentSessionFromDiskAsync().catch((err) => {
      console.error("Failed to load current session:", err);
    });
    // Load settings (sync - fast operation)
    this._loadSettings();

    // Listen for settings changes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        // Skip reload if we're the ones updating config (prevents race condition)
        if (this._isUpdatingConfig) {
          return;
        }
        if (
          e.affectsConfiguration("flowcommand.notificationSound") ||
          e.affectsConfiguration("flowcommand.interactiveApproval") ||
          e.affectsConfiguration("flowcommand.reusablePrompts")
        ) {
          this._loadSettings();
          this._updateSettingsUI();
        }
      }),
    );

    // Track current theme and listen for changes
    this._updateCurrentTheme();
    this._disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this._updateCurrentTheme();
        // Broadcast theme change to remote clients
        this._broadcastCallback?.({
          type: "updateTheme",
          theme: this._currentTheme,
        } as unknown as ToWebviewMessage);
      }),
    );
  }

  /**
   * Save current tool call history to persisted history (called on deactivate)
   * Uses synchronous save because deactivate cannot await async operations
   */
  public saveCurrentSessionToHistory(): void {
    // Cancel any pending debounced saves
    if (this._historySaveTimer) {
      clearTimeout(this._historySaveTimer);
      this._historySaveTimer = null;
    }

    // Only save completed calls from current session
    const completedCalls = this._currentSessionCalls.filter(
      (tc) => tc.status === "completed",
    );
    if (completedCalls.length > 0) {
      // Prepend current session calls to persisted history, enforce max limit
      this._persistedHistory = [
        ...completedCalls,
        ...this._persistedHistory,
      ].slice(0, this._MAX_HISTORY_ENTRIES);
      this._historyDirty = true;
    }

    // Force sync save on deactivation (async operations can't complete in deactivate)
    this._savePersistedHistoryToDiskSync();
  }

  /**
   * Open history modal (called from view title bar button)
   */
  public openHistoryModal(): void {
    this._view?.webview.postMessage({ type: "openHistoryModal" });
    this._updatePersistedHistoryUI();
  }

  /**
   * Open settings modal (called from view title bar button)
   */
  public async openSettingsModal(): Promise<void> {
    await this._refreshInstructionStatus();
    await this._refreshMcpStatus();
    this._view?.webview.postMessage({
      type: "openSettingsModal",
    } as ToWebviewMessage);
    // Don't reload settings here - they should already be in sync
    // Just send current state without reloading from config
    this._updateSettingsUI();
  }

  /**
   * Open prompts modal (called from view title bar button)
   */
  public openPromptsModal(): void {
    this._view?.webview.postMessage({
      type: "openPromptsModal",
    } as ToWebviewMessage);
    this._updateSettingsUI(); // Ensure prompts list is fresh
  }

  /**
   * Clear current session tool calls (called from view title bar button)
   * Preserves any pending tool call entry so responses don't lose their prompt
   * Cleans up temporary images associated with cleared entries
   */
  public clearCurrentSession(): void {
    // Preserve pending entry if there is one
    let pendingEntry: ToolCallEntry | undefined;
    if (this._currentToolCallId) {
      pendingEntry = this._currentSessionCallsMap.get(this._currentToolCallId);
    }

    // Clean up temp images from entries being cleared (except pending)
    const entriesToClear = pendingEntry
      ? this._currentSessionCalls.filter((e) => e.id !== pendingEntry!.id)
      : this._currentSessionCalls;
    this._cleanupTempImagesFromEntries(entriesToClear);

    // Clear all entries
    this._currentSessionCalls = [];
    this._currentSessionCallsMap.clear();

    // Restore pending entry if we had one
    if (pendingEntry) {
      this._currentSessionCalls.push(pendingEntry);
      this._currentSessionCallsMap.set(pendingEntry.id, pendingEntry);
    }

    this._updateCurrentSessionUI();
  }

  /**
   * Trim current session history to prevent unbounded growth in the home view.
   * Removes oldest entries and cleans up any temp attachments.
   */
  private _trimCurrentSessionCalls(): void {
    if (this._currentSessionCalls.length <= this._MAX_CURRENT_SESSION_ENTRIES) {
      return;
    }

    const removed = this._currentSessionCalls.splice(
      this._MAX_CURRENT_SESSION_ENTRIES,
    );
    for (const entry of removed) {
      this._currentSessionCallsMap.delete(entry.id);
    }
    this._cleanupTempImagesFromEntries(removed);
  }

  /**
   * Record a plan review interaction in the session history.
   * Called from the plan_review tool after the user takes action.
   */
  public recordPlanReview(
    reviewId: string,
    title: string,
    status: string,
    plan: string,
    revisions: Array<{ revisedPart: string; revisorInstructions: string }>,
  ): void {
    // Format response summary
    let responseSummary = `Status: ${status}`;
    if (revisions.length > 0) {
      responseSummary += `\nComments (${revisions.length}):`;
      for (const rev of revisions) {
        const revisedPart =
          typeof rev.revisedPart === "string" ? rev.revisedPart : "";
        const instructions =
          typeof rev.revisorInstructions === "string"
            ? rev.revisorInstructions
            : "";
        responseSummary += `\n• "${revisedPart.substring(0, 80)}..." → ${instructions}`;
      }
    }

    const entry: ToolCallEntry = {
      id: reviewId,
      prompt: `[Plan Review] ${title}`,
      context: plan,
      response: responseSummary,
      timestamp: Date.now(),
      isFromQueue: false,
      status: "completed",
    };

    this._currentSessionCalls.push(entry);
    this._currentSessionCallsMap.set(entry.id, entry);
    this._trimCurrentSessionCalls();
    this._updateCurrentSessionUI();

    // Notify the webview
    const message: ToWebviewMessage = {
      type: "toolCallCompleted",
      entry,
    };
    this._view?.webview.postMessage(message);
    this._broadcastCallback?.(message);
  }

  /**
   * Broadcast a plan review pending state to remote clients.
   * Called when plan_review tool is invoked — allows remote users to review the plan.
   */
  public broadcastPlanReview(
    reviewId: string,
    title: string,
    plan: string,
  ): void {
    // Track active plan review for remote client reconnection/refresh
    this._activePlanReview = { reviewId, title, plan };
    const message = {
      type: "planReviewPending" as const,
      reviewId,
      title,
      plan,
    };
    // Broadcast to remote clients - dedicated VS Code panel handles IDE
    this._broadcastCallback?.(message);
    // Notify sidebar webview to show waiting indicator
    this._view?.webview.postMessage({
      type: "planReviewPending" as const,
      reviewId,
      title,
    });
  }

  /**
   * Broadcast plan review completion to remote clients.
   * Dismisses any remote plan review modal.
   */
  public broadcastPlanReviewCompleted(reviewId: string, status: string): void {
    // Clear active plan review state
    this._activePlanReview = null;
    const message = {
      type: "planReviewCompleted" as const,
      reviewId,
      status,
    };
    this._view?.webview.postMessage(message);
    this._broadcastCallback?.(message);
  }

  /**
   * Trigger notifications for plan_review tool.
   * Plays sound, shows desktop notification, auto-focuses panel, sends mobile notification.
   */
  public triggerPlanReviewNotifications(title: string): void {
    // Play notification sound
    this.playNotificationSound();

    // Show desktop notification
    if (this._desktopNotificationEnabled) {
      vscode.window
        .showInformationMessage(
          `FlowCommand: Plan Review - ${title}`,
          "Open FlowCommand",
        )
        .then((action) => {
          if (action === "Open FlowCommand" && this._view) {
            this._view.show(true);
          }
        });
    }

    // Auto-focus panel (if enabled, focus the FlowCommand sidebar)
    if (this._autoFocusPanelEnabled && this._view) {
      this._view.show(false);
    }

    // Mobile notification is handled via the broadcast to remote clients
    // The remote client will show a browser notification if enabled
  }

  /**
   * Play notification sound (called when ask_user tool is triggered)
   * Works even when webview is not visible by using system sound
   */
  public playNotificationSound(): void {
    if (this._soundEnabled) {
      // Play system sound from extension host (works even when webview is hidden)
      this._playSystemSound();

      // Also try webview audio if visible (better quality)
      this._view?.webview.postMessage({
        type: "playNotificationSound",
      } as ToWebviewMessage);

      // Broadcast to remote clients (mobile/browser)
      this._broadcastCallback?.({
        type: "playNotificationSound",
      } as ToWebviewMessage);
    }
  }

  /**
   * Play system sound using OS-native methods
   * Works even when webview is minimized or hidden
   */
  private _playSystemSound(): void {
    const { exec } = require("child_process");
    const platform = process.platform;

    // Error callback to prevent process leaks and unhandled rejections
    const onError = (err: Error | null) => {
      if (err) {
        // Sound playing failed - not critical, ignore silently
      }
    };

    try {
      if (platform === "win32") {
        // Windows: Use PowerShell to play system exclamation sound
        exec(
          "[System.Media.SystemSounds]::Exclamation.Play()",
          { shell: "powershell.exe" },
          onError,
        );
      } else if (platform === "darwin") {
        // macOS: Use afplay with system sound
        exec(
          'afplay /System/Library/Sounds/Tink.aiff 2>/dev/null || printf "\\a"',
          onError,
        );
      } else {
        // Linux: Try multiple methods
        exec(
          'paplay /usr/share/sounds/freedesktop/stereo/message.oga 2>/dev/null || printf "\\a"',
          onError,
        );
      }
    } catch (e) {
      // Sound playing failed - not critical
    }
  }

  /**
   * Load settings from VS Code configuration
   */
  private _loadSettings(): void {
    const config = vscode.workspace.getConfiguration("flowcommand");
    this._soundEnabled = config.get<boolean>("notificationSound", true);
    this._desktopNotificationEnabled = config.get<boolean>(
      "desktopNotification",
      true,
    );
    this._autoFocusPanelEnabled = config.get<boolean>("autoFocusPanel", true);
    this._mobileNotificationEnabled = config.get<boolean>(
      "mobileNotification",
      false,
    );
    this._interactiveApprovalEnabled = config.get<boolean>(
      "interactiveApproval",
      true,
    );
    this._instructionInjection = config.get<string>(
      "instructionInjection",
      "off",
    );
    this._instructionText = config.get<string>("instructionText", "");

    // Load reusable prompts from settings
    const savedPrompts = config.get<
      Array<{ name: string; prompt: string; isTemplate?: boolean }>
    >("reusablePrompts", []);
    this._reusablePrompts = savedPrompts.map((p, index) => ({
      id: `rp_${index}_${Date.now()}`,
      name: p.name,
      prompt: p.prompt,
      isTemplate: p.isTemplate || false,
    }));
  }

  /**
   * Save reusable prompts to VS Code configuration
   */
  private async _saveReusablePrompts(): Promise<void> {
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      const promptsToSave = this._reusablePrompts.map((p) => ({
        name: p.name,
        prompt: p.prompt,
        isTemplate: p.isTemplate || false,
      }));
      await config.update(
        "reusablePrompts",
        promptsToSave,
        vscode.ConfigurationTarget.Global,
      );
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Update current theme based on VS Code's active color theme
   */
  private _updateCurrentTheme(): void {
    const kind = vscode.window.activeColorTheme.kind;
    // ColorThemeKind: 1 = Light, 2 = Dark, 3 = HighContrast, 4 = HighContrastLight
    this._currentTheme =
      kind === vscode.ColorThemeKind.Light ||
      kind === vscode.ColorThemeKind.HighContrastLight
        ? "light"
        : "dark";
  }

  /**
   * Update settings UI in webview
   */
  private _updateSettingsUI(): void {
    this._postMessage({
      type: "updateSettings",
      soundEnabled: this._soundEnabled,
      desktopNotificationEnabled: this._desktopNotificationEnabled,
      autoFocusPanelEnabled: this._autoFocusPanelEnabled,
      mobileNotificationEnabled: this._mobileNotificationEnabled,
      interactiveApprovalEnabled: this._interactiveApprovalEnabled,
      reusablePrompts: this._reusablePrompts,
      instructionInjection: this._instructionInjection,
      instructionText: this._instructionText,
      instructionStatus: this._instructionStatus,
      mcpRunning: this._mcpRunning,
      mcpUrl: this._mcpUrl,
    } as ToWebviewMessage);
  }

  /**
   * Update instruction status from extension command
   */
  public setInstructionStatus(status: InstructionStatus): void {
    this._instructionStatus = status;
    this._updateSettingsUI();
  }

  /**
   * Update MCP status for settings UI
   */
  public setMcpStatus(running: boolean, url: string | null): void {
    this._mcpRunning = running;
    this._mcpUrl = url;
    this._updateSettingsUI();
  }

  /**
   * Refresh instruction status from extension
   */
  private async _refreshInstructionStatus(): Promise<void> {
    try {
      const status = await vscode.commands.executeCommand<InstructionStatus>(
        "flowcommand.getInstructionStatus",
      );
      if (status) {
        this._instructionStatus = status;
      }
    } catch (err) {
      console.error("[FlowCommand] Failed to refresh instruction status:", err);
    }
  }

  /**
   * Refresh MCP status from extension
   */
  private async _refreshMcpStatus(): Promise<void> {
    try {
      const status = await vscode.commands.executeCommand<{
        running: boolean;
        url: string | null;
      }>("flowcommand.getMcpStatus");
      if (status) {
        this._mcpRunning = status.running === true;
        this._mcpUrl = status.url || null;
      }
    } catch (err) {
      console.error("[FlowCommand] Failed to refresh MCP status:", err);
    }
  }

  /**
   * Copy MCP server URL to clipboard
   */
  private async _copyMcpUrl(): Promise<void> {
    if (!this._mcpUrl) {
      await this._refreshMcpStatus();
    }
    if (this._mcpUrl) {
      await vscode.env.clipboard.writeText(this._mcpUrl);
      vscode.window.showInformationMessage(
        "FlowCommand MCP URL copied to clipboard",
      );
    } else {
      vscode.window.showWarningMessage("FlowCommand MCP URL is not available");
    }
  }

  /**
   * Clean up resources when the provider is disposed
   */
  public dispose(): void {
    // Save session history BEFORE clearing arrays
    // This ensures tool calls are persisted when VS Code reloads
    this.saveCurrentSessionToHistory();

    // Clear debounce timer
    if (this._queueSaveTimer) {
      clearTimeout(this._queueSaveTimer);
      this._queueSaveTimer = null;
    }

    if (this._currentSessionSaveTimer) {
      clearTimeout(this._currentSessionSaveTimer);
      this._currentSessionSaveTimer = null;
    }

    // Clear processing timeout
    this._clearProcessingTimeout();

    // Clear file search cache
    this._fileSearchCache.clear();

    // Clear session calls map (O(1) lookup cache)
    this._currentSessionCallsMap.clear();

    // Clear pending requests (reject any waiting promises)
    this._pendingRequests.clear();

    // Clear queued agent requests
    for (const queued of this._queuedAgentRequests) {
      queued.resolve({
        value: "[CANCELLED: Extension disposed]",
        queue: false,
        attachments: [],
        cancelled: true,
      });
    }
    this._queuedAgentRequests = [];

    // Clean up temp images from current session before clearing
    this._cleanupTempImagesFromEntries(this._currentSessionCalls);

    // Clear session data
    this._currentSessionCalls = [];
    this._attachments = [];

    // Dispose all registered disposables
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];

    this._view = undefined;
  }

  /**
   * Set callback for broadcasting state changes to remote clients
   * This is called by the remote server to receive updates
   */
  public setBroadcastCallback(
    callback: ((message: ToWebviewMessage) => void) | null,
  ): void {
    this._broadcastCallback = callback;
  }

  /**
   * Alias for setBroadcastCallback
   */
  public setRemoteBroadcastCallback(
    callback: ((message: ToWebviewMessage) => void) | null,
  ): void {
    this.setBroadcastCallback(callback);
  }

  /**
   * Set callback for processing state changes (for status bar indicator)
   */
  public onProcessingStateChange(
    callback: (isProcessing: boolean) => void,
  ): void {
    this._processingStateCallback = callback;
  }

  /**
   * Check if there's an active pending request waiting for user input
   */
  public hasPendingRequest(): boolean {
    return (
      this._currentToolCallId !== null &&
      this._pendingRequests.has(this._currentToolCallId)
    );
  }

  /**
   * Cancel the current pending request (e.g. when Copilot Stop button is clicked).
   * Cleans up pending state, updates session history, and notifies webview + remote clients.
   */
  public cancelPendingRequest(): void {
    if (!this._currentToolCallId) {
      return;
    }
    const toolCallId = this._currentToolCallId;
    const resolve = this._pendingRequests.get(toolCallId);

    // Update session entry to cancelled
    const pendingEntry = this._currentSessionCallsMap.get(toolCallId);
    if (pendingEntry && pendingEntry.status === "pending") {
      pendingEntry.status = "cancelled";
      pendingEntry.response = "[Cancelled by user (Stop button)]";
      pendingEntry.timestamp = Date.now();
    }

    // Resolve the orphaned promise so it doesn't leak
    if (resolve) {
      resolve({
        value: "[CANCELLED: User clicked Stop]",
        queue: false,
        attachments: [],
        cancelled: true,
      });
      this._pendingRequests.delete(toolCallId);
    }

    // Clear current tool call ID
    this._currentToolCallId = null;

    // Notify webview + remote clients to dismiss the pending UI
    // (_postMessage handles both local webview and remote broadcast)
    this._postMessage({ type: "toolCallCancelled" as const, id: toolCallId });

    // Also cancel all queued agent requests
    for (const queued of this._queuedAgentRequests) {
      queued.resolve({
        value: "[CANCELLED: User clicked Stop]",
        queue: false,
        attachments: [],
        cancelled: true,
      });
      if (queued.entry.status === "pending") {
        queued.entry.status = "cancelled";
        queued.entry.response = "[Cancelled by user (Stop button)]";
      }
    }
    this._queuedAgentRequests = [];
    this._broadcastQueuedAgentCount();

    // Clear any processing state
    this._setProcessingState(false);

    // Update session UI to reflect the cancelled entry
    this._updateCurrentSessionUI();

    console.log(
      `[FlowCommand] Pending request ${toolCallId} cancelled (Stop button)`,
    );
  }

  /**
   * Process the next queued agent request after the current one is resolved.
   * Shows the next request in the webview/remote UI.
   */
  private async _processNextQueuedToolCall(): Promise<void> {
    if (this._queuedAgentRequests.length === 0) {
      this._broadcastQueuedAgentCount();
      return;
    }

    const next = this._queuedAgentRequests.shift()!;
    this._broadcastQueuedAgentCount();

    if (next.type === "multi" && next.questions) {
      // Multi-question request
      this._currentToolCallId = next.toolCallId;
      this._currentMultiQuestions = next.questions;
      this._pendingRequests.set(next.toolCallId, next.resolve);

      const multiQuestionMessage = {
        type: "multiQuestionPending" as const,
        requestId: next.toolCallId,
        questions: next.questions,
      };

      if (this._webviewReady && this._view) {
        if (this._autoFocusPanelEnabled) {
          this._view.show(false);
        }
        this._view.webview.postMessage(multiQuestionMessage);
        this.playNotificationSound();
        this._showDesktopNotification("AI has multiple questions for you");
      }
      if (this._broadcastCallback) {
        this._broadcastCallback(multiQuestionMessage);
      }
    } else {
      // Single question request
      this._currentToolCallId = next.toolCallId;
      this._currentMultiQuestions = null;
      this._pendingRequests.set(next.toolCallId, next.resolve);

      const question = next.question || "";
      const choices = next.explicitChoices || this._parseChoices(question);
      const isApproval =
        choices.length === 0 && this._isApprovalQuestion(question);
      this._currentExplicitChoices = next.explicitChoices;

      const toolCallMessage = {
        type: "toolCallPending" as const,
        id: next.toolCallId,
        prompt: question,
        context: next.context,
        isApprovalQuestion: isApproval,
        choices: choices.length > 0 ? choices : undefined,
      };

      if (this._webviewReady && this._view) {
        if (this._autoFocusPanelEnabled) {
          this._view.show(false);
        }
        this._view.webview.postMessage(toolCallMessage);
        this.playNotificationSound();
        this._showDesktopNotification(question);
      }
      if (this._broadcastCallback) {
        this._broadcastCallback(toolCallMessage);
      }
    }

    this._setProcessingState(false);
    this._updateCurrentSessionUI();
    console.log(
      `[FlowCommand] Showing queued agent request ${next.toolCallId} (${this._queuedAgentRequests.length} remaining)`,
    );
  }

  /**
   * Broadcast the current queued agent request count to webview and remote clients
   */
  private _broadcastQueuedAgentCount(): void {
    this._postMessage({
      type: "queuedAgentRequestCount",
      count: this._queuedAgentRequests.length,
    });
  }

  /**
   * Update processing state and notify listeners
   */
  private _setProcessingState(isProcessing: boolean): void {
    if (this._isProcessing !== isProcessing) {
      this._isProcessing = isProcessing;
      if (this._processingStateCallback) {
        this._processingStateCallback(isProcessing);
      }
    }

    // Manage processing timeout
    if (isProcessing) {
      this._startProcessingTimeout();
    } else {
      this._clearProcessingTimeout();
    }
  }

  /**
   * Start a timeout to auto-clear processing state if AI doesn't respond
   */
  private _startProcessingTimeout(): void {
    this._clearProcessingTimeout();
    this._processingTimeoutId = setTimeout(() => {
      if (this._isProcessing) {
        console.log(
          "[FlowCommand] Processing timeout - auto-clearing stuck state",
        );
        this._setProcessingState(false);
        // Send clear processing message to webview
        this._postMessage({ type: "clearProcessing" });
      }
    }, this._PROCESSING_TIMEOUT_MS);
  }

  /**
   * Clear the processing timeout
   */
  private _clearProcessingTimeout(): void {
    if (this._processingTimeoutId) {
      clearTimeout(this._processingTimeoutId);
      this._processingTimeoutId = null;
    }
  }

  /**
   * Handle message from remote clients (delegated from RemoteUiServer)
   * Same interface as webview messages
   */
  public handleRemoteMessage(message: FromWebviewMessage): void {
    // Set flag so handlers know this message came from remote client
    // This prevents cross-triggering UI (e.g., file search results going to both local and remote)
    this._isRemoteMessageContext = true;
    try {
      this._handleWebviewMessage(message);
    } finally {
      this._isRemoteMessageContext = false;
    }
  }

  /**
   * Get current state for remote clients (initial sync)
   */
  public getRemoteState(): {
    queue: QueuedPrompt[];
    queueEnabled: boolean;
    queuePaused: boolean;
    currentSession: ToolCallEntry[];
    persistedHistory: ToolCallEntry[];
    pendingRequest: {
      id: string;
      prompt: string;
      context?: string;
      isApprovalQuestion: boolean;
      choices?: ParsedChoice[];
    } | null;
    pendingMultiQuestion: { requestId: string; questions: Question[] } | null;
    pendingPlanReview: { reviewId: string; title: string; plan: string } | null;
    queuedAgentRequestCount: number;
    settings: {
      soundEnabled: boolean;
      desktopNotificationEnabled: boolean;
      autoFocusPanelEnabled: boolean;
      mobileNotificationEnabled: boolean;
      interactiveApprovalEnabled: boolean;
      reusablePrompts: ReusablePrompt[];
      mcpRunning: boolean;
      mcpUrl: string | null;
    };
    theme: "light" | "dark";
  } {
    // Find pending entry if there's an active request
    let pendingRequest = null;
    let pendingMultiQuestion = null;

    if (
      this._currentToolCallId &&
      this._pendingRequests.has(this._currentToolCallId)
    ) {
      const pendingEntry = this._currentSessionCallsMap.get(
        this._currentToolCallId,
      );
      if (pendingEntry && pendingEntry.status === "pending") {
        // Check if this is a multi-question request
        if (
          this._currentMultiQuestions &&
          this._currentToolCallId.startsWith("mq_")
        ) {
          pendingMultiQuestion = {
            requestId: this._currentToolCallId,
            questions: this._currentMultiQuestions,
          };
        } else {
          const choices =
            this._currentExplicitChoices ||
            this._parseChoices(pendingEntry.prompt);
          const isApproval =
            choices.length === 0 &&
            this._isApprovalQuestion(pendingEntry.prompt);
          pendingRequest = {
            id: this._currentToolCallId,
            prompt: pendingEntry.prompt,
            context: pendingEntry.context,
            isApprovalQuestion: isApproval,
            choices: choices.length > 0 ? choices : undefined,
          };
        }
      }
    }

    return {
      queue: this._promptQueue,
      queueEnabled: this._queueEnabled,
      queuePaused: this._queuePaused,
      currentSession: this._currentSessionCalls,
      persistedHistory: this._persistedHistory,
      pendingRequest,
      pendingMultiQuestion,
      pendingPlanReview: this._activePlanReview,
      queuedAgentRequestCount: this._queuedAgentRequests.length,
      settings: {
        soundEnabled: this._soundEnabled,
        desktopNotificationEnabled: this._desktopNotificationEnabled,
        autoFocusPanelEnabled: this._autoFocusPanelEnabled,
        mobileNotificationEnabled: this._mobileNotificationEnabled,
        interactiveApprovalEnabled: this._interactiveApprovalEnabled,
        reusablePrompts: this._reusablePrompts,
        mcpRunning: this._mcpRunning,
        mcpUrl: this._mcpUrl,
      },
      theme: this._currentTheme,
    };
  }

  /**
   * Alias for getRemoteState
   */
  public getStateForRemote(): ReturnType<typeof this.getRemoteState> {
    return this.getRemoteState();
  }

  /**
   * Helper to post message to both webview AND remote clients
   */
  private _postMessage(message: ToWebviewMessage): void {
    // Send to local webview
    this._view?.webview.postMessage(message);
    // Send to remote clients
    if (this._broadcastCallback) {
      this._broadcastCallback(message);
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this._webviewReady = false; // Reset ready state when view is resolved

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    // Register message handler (disposable is tracked via this._disposables)
    webviewView.webview.onDidReceiveMessage(
      (message: FromWebviewMessage) => this._handleWebviewMessage(message),
      undefined,
      this._disposables,
    );

    // Clean up when webview is disposed
    webviewView.onDidDispose(
      () => {
        this._webviewReady = false;
        this._view = undefined;
        // Clear file search cache when view is hidden
        this._fileSearchCache.clear();
        // Save current session to persisted history when view is disposed
        this.saveCurrentSessionToHistory();
      },
      null,
      this._disposables,
    );

    // Save history when webview visibility changes (backup for reload)
    webviewView.onDidChangeVisibility(
      () => {
        if (!webviewView.visible) {
          // Save current session when switching away
          this.saveCurrentSessionToHistory();
        }
      },
      null,
      this._disposables,
    );

    // Don't send initial state here - wait for webviewReady message
    // This prevents race condition where messages are sent before JS is initialized
  }

  /**
   * Wait for user response
   */
  public async waitForUserResponse(
    question: string,
    explicitChoices?: Array<{ label: string; value: string }>,
    context?: string,
  ): Promise<UserResponseResult> {
    // If view is not available, open the sidebar first
    if (!this._view) {
      // Open the FlowCommand sidebar view
      await vscode.commands.executeCommand("flowCommandView.focus");

      // Wait for view to be resolved (up to configured timeout)
      let waited = 0;
      while (!this._view && waited < this._VIEW_OPEN_TIMEOUT_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, this._VIEW_OPEN_POLL_INTERVAL_MS),
        );
        waited += this._VIEW_OPEN_POLL_INTERVAL_MS;
      }

      if (!this._view) {
        console.error(
          `[FlowCommand] Failed to open sidebar view after waiting ${this._VIEW_OPEN_TIMEOUT_MS}ms`,
        );
        throw new Error(
          `Failed to open FlowCommand sidebar after ${this._VIEW_OPEN_TIMEOUT_MS}ms. The webview may not be properly initialized.`,
        );
      }
    }

    const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // If there's already an active pending request from another agent, queue this one
    if (
      this._currentToolCallId &&
      this._pendingRequests.has(this._currentToolCallId)
    ) {
      // Create pending entry for history tracking
      const pendingEntry: ToolCallEntry = {
        id: toolCallId,
        prompt: question,
        context: context,
        response: "",
        timestamp: Date.now(),
        isFromQueue: false,
        status: "pending",
      };
      this._currentSessionCalls.unshift(pendingEntry);
      this._currentSessionCallsMap.set(toolCallId, pendingEntry);
      this._trimCurrentSessionCalls();
      this._updateCurrentSessionUI();

      return new Promise<UserResponseResult>((resolve) => {
        this._queuedAgentRequests.push({
          type: "single",
          question,
          context,
          explicitChoices,
          resolve,
          toolCallId,
          entry: pendingEntry,
        });
        this._broadcastQueuedAgentCount();
        console.log(
          `[FlowCommand] Queued agent request ${toolCallId} (${this._queuedAgentRequests.length} in queue)`,
        );
      });
    }

    this._currentToolCallId = toolCallId;

    // Check if queue is enabled, not paused, and has prompts - auto-respond
    // Re-read _queuePaused to guard against race conditions
    if (
      this._queueEnabled &&
      !this._queuePaused &&
      this._promptQueue.length > 0
    ) {
      console.log(
        "[FlowCommand] Auto-consuming queue item for tool call",
        toolCallId,
      );
      const queuedPrompt = this._promptQueue.shift();
      if (queuedPrompt) {
        this._saveQueueToDisk();
        this._updateQueueUI();

        // Create completed tool call entry for queue response
        const entry: ToolCallEntry = {
          id: toolCallId,
          prompt: question,
          context: context,
          response: queuedPrompt.prompt,
          timestamp: Date.now(),
          isFromQueue: true,
          status: "completed",
        };
        this._currentSessionCalls.unshift(entry);
        this._currentSessionCallsMap.set(entry.id, entry); // Maintain O(1) lookup map
        this._trimCurrentSessionCalls();
        this._updateCurrentSessionUI();
        this._currentToolCallId = null;

        return {
          value: queuedPrompt.prompt,
          queue: true,
          attachments: queuedPrompt.attachments || [], // Return stored attachments
        };
      }
    }

    if (this._autoFocusPanelEnabled) {
      this._view.show(false);
    }

    // Add pending entry to current session (so we have the prompt when completing)
    const pendingEntry: ToolCallEntry = {
      id: toolCallId,
      prompt: question,
      context: context,
      response: "",
      timestamp: Date.now(),
      isFromQueue: false,
      status: "pending",
    };
    this._currentSessionCalls.unshift(pendingEntry);
    this._currentSessionCallsMap.set(toolCallId, pendingEntry); // O(1) lookup
    this._trimCurrentSessionCalls();

    // Use explicit choices from the tool call if provided, otherwise parse from question text
    let choices: ParsedChoice[];
    if (explicitChoices && explicitChoices.length > 0) {
      // Parse the question text to extract short labels (1, 2, 3 or A, B, C)
      // This ensures buttons show "1", "2", "3" even when AI provides full text values
      const parsedChoices = this._parseChoices(question);

      choices = explicitChoices.map((c, index) => {
        // Try to use parsed shortLabel by matching index
        const parsed = parsedChoices[index];

        // Extract clean keyword before separators like " — ", " - ", " – ", " : "
        // e.g., "Yes — items remain in queue" → "Yes"
        // e.g., "No — items were auto-consumed" → "No"
        const separatorMatch = c.label.match(/^(.+?)\s*(?:—|–|[-:])\s+/);
        const keywordLabel = separatorMatch
          ? separatorMatch[1].trim()
          : undefined;

        // Priority: parsed shortLabel > keyword before separator > truncated label > short value > numeric index
        const truncatedLabel =
          c.label.length > 20 ? c.label.substring(0, 17) + "..." : c.label;
        const shortLabel =
          parsed?.shortLabel ||
          keywordLabel ||
          truncatedLabel ||
          (c.value.length <= 3 ? c.value : String(index + 1));

        return {
          label:
            c.label.length > 40 ? c.label.substring(0, 37) + "..." : c.label,
          value: c.value,
          shortLabel: shortLabel,
        };
      });
    } else {
      choices = this._parseChoices(question);
    }
    const isApproval =
      choices.length === 0 && this._isApprovalQuestion(question);

    // Store explicit choices for webview restore
    this._currentExplicitChoices =
      explicitChoices && explicitChoices.length > 0 ? choices : undefined;

    // Wait for webview to be ready (JS initialized) before sending message
    if (!this._webviewReady) {
      // Wait for webview JS to initialize (up to 3 seconds)
      const maxWaitMs = 3000;
      const pollIntervalMs = 50;
      let waited = 0;
      while (!this._webviewReady && waited < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
      }
    }

    // Prepare the message
    const toolCallMessage = {
      type: "toolCallPending" as const,
      id: toolCallId,
      prompt: question,
      context: context,
      isApprovalQuestion: isApproval,
      choices: choices.length > 0 ? choices : undefined,
    };

    // Send pending tool call to webview
    if (this._webviewReady && this._view) {
      this._view.webview.postMessage(toolCallMessage);
      // Play notification sound when AI triggers ask_user
      this.playNotificationSound();
      // Show VS Code desktop notification if enabled
      this._showDesktopNotification(question);
    } else {
      // Fallback: queue the message for when webview becomes ready
      this._pendingToolCallMessage = {
        id: toolCallId,
        prompt: question,
        context: context,
        explicitChoices: choices.length > 0 ? choices : undefined,
      };
    }

    // Always broadcast to remote clients (regardless of local webview state)
    if (this._broadcastCallback) {
      this._broadcastCallback(toolCallMessage);
    }

    // Update processing state - we're now waiting for user input, not processing
    this._setProcessingState(false);

    this._updateCurrentSessionUI();

    return new Promise<UserResponseResult>((resolve) => {
      this._pendingRequests.set(toolCallId, resolve);
    });
  }

  /**
   * Wait for user response to multiple questions
   * Used when AI calls ask_user with questions array (multi-question mode)
   */
  public async waitForMultiQuestionResponse(
    questions: Question[],
  ): Promise<UserResponseResult> {
    // Input validation - prevent hangs from malformed input
    if (!questions || !Array.isArray(questions)) {
      console.error(
        "[FlowCommand] waitForMultiQuestionResponse: invalid questions array",
      );
      return {
        value: '{"error": "Invalid questions input"}',
        queue: false,
        attachments: [],
      };
    }

    // Limit questions to prevent UI overload (max 10, recommended 4)
    const safeQuestions = questions.slice(0, 10).map((q) => ({
      header: String(q.header || "Question").substring(0, 50),
      question: String(q.question || "").substring(0, 2000),
      options: Array.isArray(q.options)
        ? q.options.slice(0, 20).map((o) => ({
            label: String(o.label || "").substring(0, 200),
            description: o.description
              ? String(o.description).substring(0, 500)
              : undefined,
            recommended: Boolean(o.recommended),
          }))
        : undefined,
      multiSelect: Boolean(q.multiSelect),
      allowFreeformInput: Boolean(q.allowFreeformInput),
    }));

    if (safeQuestions.length === 0) {
      return {
        value: '{"error": "No valid questions provided"}',
        queue: false,
        attachments: [],
      };
    }

    // If view is not available, open the sidebar first
    if (!this._view) {
      await vscode.commands.executeCommand("flowCommandView.focus");

      let waited = 0;
      while (!this._view && waited < this._VIEW_OPEN_TIMEOUT_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, this._VIEW_OPEN_POLL_INTERVAL_MS),
        );
        waited += this._VIEW_OPEN_POLL_INTERVAL_MS;
      }

      if (!this._view) {
        throw new Error(
          `Failed to open FlowCommand sidebar after ${this._VIEW_OPEN_TIMEOUT_MS}ms.`,
        );
      }
    }

    const requestId = `mq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const combinedPrompt = safeQuestions
      .map((q, i) => `${i + 1}. [${q.header}] ${q.question}`)
      .join("\n");

    // If there's already an active pending request, queue this one
    if (
      this._currentToolCallId &&
      this._pendingRequests.has(this._currentToolCallId)
    ) {
      const pendingEntry: ToolCallEntry = {
        id: requestId,
        prompt: combinedPrompt,
        response: "",
        timestamp: Date.now(),
        isFromQueue: false,
        status: "pending",
      };
      this._currentSessionCalls.unshift(pendingEntry);
      this._currentSessionCallsMap.set(requestId, pendingEntry);
      this._trimCurrentSessionCalls();
      this._updateCurrentSessionUI();

      return new Promise<UserResponseResult>((resolve) => {
        this._queuedAgentRequests.push({
          type: "multi",
          questions: safeQuestions,
          resolve,
          toolCallId: requestId,
          entry: pendingEntry,
        });
        this._broadcastQueuedAgentCount();
        console.log(
          `[FlowCommand] Queued multi-question agent request ${requestId} (${this._queuedAgentRequests.length} in queue)`,
        );
      });
    }

    this._currentToolCallId = requestId;
    // Store questions for remote state sync
    this._currentMultiQuestions = safeQuestions;

    if (this._autoFocusPanelEnabled) {
      this._view.show(false);
    }

    // Add pending entry to current session
    const pendingEntry: ToolCallEntry = {
      id: requestId,
      prompt: combinedPrompt,
      response: "",
      timestamp: Date.now(),
      isFromQueue: false,
      status: "pending",
    };
    this._currentSessionCalls.unshift(pendingEntry);
    this._currentSessionCallsMap.set(requestId, pendingEntry);
    this._trimCurrentSessionCalls();

    // Wait for webview to be ready
    if (!this._webviewReady) {
      const maxWaitMs = 3000;
      const pollIntervalMs = 50;
      let waited = 0;
      while (!this._webviewReady && waited < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
      }
    }

    // Prepare message for webview
    const multiQuestionMessage = {
      type: "multiQuestionPending" as const,
      requestId,
      questions: safeQuestions,
    };

    // Send to webview
    if (this._webviewReady && this._view) {
      this._view.webview.postMessage(multiQuestionMessage);
      this.playNotificationSound();
      this._showDesktopNotification("AI has multiple questions for you");
    }

    // Broadcast to remote clients
    if (this._broadcastCallback) {
      this._broadcastCallback(multiQuestionMessage);
    }

    this._setProcessingState(false);
    this._updateCurrentSessionUI();

    return new Promise<UserResponseResult>((resolve) => {
      this._pendingRequests.set(requestId, resolve);
    });
  }

  /**
   * Check if queue is enabled
   */
  public isQueueEnabled(): boolean {
    return this._queueEnabled;
  }

  /**
   * Handle messages from webview
   */
  private _handleWebviewMessage(message: FromWebviewMessage): void {
    switch (message.type) {
      case "submit":
        this._handleSubmit(message.value, message.attachments || []);
        break;
      case "addQueuePrompt":
        this._handleAddQueuePrompt(
          message.prompt,
          message.id,
          message.attachments || [],
        );
        break;
      case "removeQueuePrompt":
        this._handleRemoveQueuePrompt(message.promptId);
        break;
      case "editQueuePrompt":
        this._handleEditQueuePrompt(message.promptId, message.newPrompt);
        break;
      case "reorderQueue":
        this._handleReorderQueue(message.fromIndex, message.toIndex);
        break;
      case "toggleQueue":
        this._handleToggleQueue(message.enabled);
        break;
      case "clearQueue":
        this._handleClearQueue();
        break;
      case "pauseQueue":
        this._handlePauseQueue();
        break;
      case "resumeQueue":
        this._handleResumeQueue();
        break;
      case "addAttachment":
        this._handleAddAttachment();
        break;
      case "removeAttachment":
        this._handleRemoveAttachment(message.attachmentId);
        break;
      case "removeHistoryItem":
        this._handleRemoveHistoryItem(message.callId);
        break;
      case "clearPersistedHistory":
        this._handleClearPersistedHistory();
        break;
      case "openHistoryModal":
        this._handleOpenHistoryModal();
        break;
      case "searchFiles":
        this._handleSearchFiles(message.query, this._isRemoteMessageContext);
        break;
      case "saveImage":
        this._handleSaveImage(message.data, message.mimeType);
        break;
      case "saveImageFromUri":
        this._handleSaveImageFromUri(message.uri);
        break;
      case "addFileReference":
        this._handleAddFileReference(message.file);
        break;
      case "webviewReady":
        this._handleWebviewReady();
        break;
      case "openSettingsModal":
        this._handleOpenSettingsModal();
        break;
      case "updateSoundSetting":
        this._handleUpdateSoundSetting(message.enabled);
        break;
      case "updateInteractiveApprovalSetting":
        this._handleUpdateInteractiveApprovalSetting(message.enabled);
        break;
      case "updateDesktopNotificationSetting":
        this._handleUpdateDesktopNotificationSetting(message.enabled);
        break;
      case "updateAutoFocusPanelSetting":
        this._handleUpdateAutoFocusPanelSetting(message.enabled);
        break;
      case "updateMobileNotificationSetting":
        this._handleUpdateMobileNotificationSetting(message.enabled);
        break;
      case "addReusablePrompt":
        this._handleAddReusablePrompt(message.name, message.prompt);
        break;
      case "editReusablePrompt":
        this._handleEditReusablePrompt(
          message.id,
          message.name,
          message.prompt,
          message.isTemplate,
        );
        break;
      case "removeReusablePrompt":
        this._handleRemoveReusablePrompt(message.id);
        break;
      case "setPromptTemplate":
        this._handleSetPromptTemplate(message.id);
        break;
      case "clearPromptTemplate":
        this._handleClearPromptTemplate();
        break;
      case "updateInstructionInjection":
        this._handleUpdateInstructionInjection(message.method);
        break;
      case "updateInstructionText":
        this._handleUpdateInstructionText(message.text);
        break;
      case "resetInstructionText":
        this._handleResetInstructionText();
        break;
      case "reinjectInstruction":
        void vscode.commands.executeCommand("flowcommand.reinjectInstructions");
        break;
      case "mcpToggle":
        void vscode.commands.executeCommand("flowcommand.toggleMcp");
        break;
      case "mcpStart":
        void vscode.commands.executeCommand("flowcommand.startMcp");
        break;
      case "mcpStop":
        void vscode.commands.executeCommand("flowcommand.stopMcp");
        break;
      case "mcpCopyUrl":
        void this._copyMcpUrl();
        break;
      case "planReviewResponse":
        this._handlePlanReviewResponse(
          message.reviewId,
          message.action,
          message.revisions || [],
        );
        break;
      case "multiQuestionResponse":
        this._handleMultiQuestionResponse(
          message.requestId,
          message.answers,
          message.cancelled,
        );
        break;
      case "searchSlashCommands":
        this._handleSearchSlashCommands(message.query);
        break;
      case "openExternal":
        if (message.url) {
          vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case "searchContext":
        this._handleSearchContext(message.query);
        break;
      case "selectContextReference":
        this._handleSelectContextReference(
          message.contextType,
          message.options,
        );
        break;
    }
  }

  /**
   * Handle webview ready signal - send initial state and any pending messages
   */
  private _handleWebviewReady(): void {
    this._webviewReady = true;

    // Send settings
    this._updateSettingsUI();
    // Send initial queue state and current session history
    this._updateQueueUI();
    this._updateCurrentSessionUI();

    // If there's a pending tool call message that was never sent, send it now
    if (this._pendingToolCallMessage) {
      const prompt = this._pendingToolCallMessage.prompt;
      const pendingContext = this._pendingToolCallMessage.context;
      const choices =
        this._pendingToolCallMessage.explicitChoices ||
        this._parseChoices(prompt);
      const isApproval =
        choices.length === 0 && this._isApprovalQuestion(prompt);
      this._postMessage({
        type: "toolCallPending",
        id: this._pendingToolCallMessage.id,
        prompt: prompt,
        context: pendingContext,
        isApprovalQuestion: isApproval,
        choices: choices.length > 0 ? choices : undefined,
      });
      this._pendingToolCallMessage = null;
    }
    // If there's an active pending request (webview was hidden/recreated while waiting),
    // re-send the pending tool call message so the user sees the question again
    else if (
      this._currentToolCallId &&
      this._pendingRequests.has(this._currentToolCallId)
    ) {
      // Find the pending entry to get the prompt
      const pendingEntry = this._currentSessionCallsMap.get(
        this._currentToolCallId,
      );
      if (pendingEntry && pendingEntry.status === "pending") {
        const prompt = pendingEntry.prompt;
        const choices =
          this._currentExplicitChoices || this._parseChoices(prompt);
        const isApproval =
          choices.length === 0 && this._isApprovalQuestion(prompt);
        this._postMessage({
          type: "toolCallPending",
          id: this._currentToolCallId,
          prompt: prompt,
          context: pendingEntry.context,
          isApprovalQuestion: isApproval,
          choices: choices.length > 0 ? choices : undefined,
        });
      }
    }
  }

  /**
   * Handle submit from webview
   */
  private _handleSubmit(value: string, attachments: AttachmentInfo[]): void {
    if (this._pendingRequests.size > 0 && this._currentToolCallId) {
      const resolve = this._pendingRequests.get(this._currentToolCallId);
      if (resolve) {
        // O(1) lookup using Map instead of O(n) findIndex
        const pendingEntry = this._currentSessionCallsMap.get(
          this._currentToolCallId,
        );

        let completedEntry: ToolCallEntry;
        if (pendingEntry && pendingEntry.status === "pending") {
          // Update existing pending entry
          pendingEntry.response = value;
          pendingEntry.attachments = attachments;
          pendingEntry.status = "completed";
          pendingEntry.timestamp = Date.now();
          completedEntry = pendingEntry;
        } else {
          // Create new completed entry (shouldn't happen normally)
          completedEntry = {
            id: this._currentToolCallId,
            prompt: "Tool call",
            response: value,
            attachments: attachments,
            timestamp: Date.now(),
            isFromQueue: false,
            status: "completed",
          };
          this._currentSessionCalls.unshift(completedEntry);
          this._currentSessionCallsMap.set(completedEntry.id, completedEntry);
          this._trimCurrentSessionCalls();
        }

        // Send toolCallCompleted to trigger "Working...." state in webview
        this._postMessage({
          type: "toolCallCompleted",
          entry: completedEntry,
        } as ToWebviewMessage);

        // Update processing state - AI is now processing the user's response
        this._setProcessingState(true);

        this._updateCurrentSessionUI();

        // Append template to the prompt if active
        const finalValue = this._appendTemplateToPrompt(value);
        resolve({ value: finalValue, queue: this._queueEnabled, attachments });
        this._pendingRequests.delete(this._currentToolCallId);
        this._currentToolCallId = null;

        // Process next queued agent request if any
        this._processNextQueuedToolCall();
      } else {
        // No pending tool call - add message to queue for later use
        if (value && value.trim()) {
          const queuedPrompt: QueuedPrompt = {
            id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            prompt: value.trim(),
          };
          this._promptQueue.push(queuedPrompt);
          // Auto-switch to queue mode so user sees their message went to queue
          this._queueEnabled = true;
          this._saveQueueToDisk();
          this._updateQueueUI();
        }
      }
      // NOTE: Temp images are NOT cleaned up here anymore.
      // They are stored in the ToolCallEntry.attachments and will be cleaned up when:
      // 1. clearCurrentSession() is called
      // 2. dispose() is called (extension deactivation)
      // This ensures images are available for the entire session duration.

      // Clear attachments after submit and sync with webview
      this._attachments = [];
      this._updateAttachmentsUI();
    }
  }

  /**
   * Clean up temporary image files from disk by URI list
   */
  private _cleanupTempImagesByUri(uris: string[]): void {
    for (const uri of uris) {
      try {
        const filePath = vscode.Uri.parse(uri).fsPath;
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error("[FlowCommand] Failed to cleanup temp image:", error);
      }
    }
  }

  /**
   * Clean up temporary images from tool call entries
   * Called when entries are removed from current session or on dispose
   */
  private _cleanupTempImagesFromEntries(entries: ToolCallEntry[]): void {
    const tempUris: string[] = [];
    for (const entry of entries) {
      if (entry.attachments) {
        for (const att of entry.attachments) {
          // Only clean up temporary attachments (pasted/dropped images)
          if (att.isTemporary && att.uri) {
            tempUris.push(att.uri);
          }
        }
      }
    }
    if (tempUris.length > 0) {
      this._cleanupTempImagesByUri(tempUris);
    }
  }

  /**
   * Handle adding attachment via file picker
   */
  private async _handleAddAttachment(): Promise<void> {
    // Use shared exclude pattern
    const excludePattern = formatExcludePattern(FILE_EXCLUSION_PATTERNS);
    const files = await vscode.workspace.findFiles(
      "**/*",
      excludePattern,
      this._MAX_FOLDER_SEARCH_RESULTS,
    );

    if (files.length === 0) {
      vscode.window.showInformationMessage("No files found in workspace");
      return;
    }

    const items: (vscode.QuickPickItem & { uri: vscode.Uri })[] = files
      .map((uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const fileName = path.basename(uri.fsPath);
        return {
          label: `$(file) ${fileName}`,
          description: relativePath,
          uri: uri,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select files to attach",
      matchOnDescription: true,
    });

    if (selected && selected.length > 0) {
      for (const item of selected) {
        const labelMatch = item.label.match(/\$\([^)]+\)\s*(.+)/);
        const cleanName = labelMatch ? labelMatch[1] : item.label;
        const attachment: AttachmentInfo = {
          id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          name: cleanName,
          uri: item.uri.toString(),
        };
        this._attachments.push(attachment);
      }
      this._updateAttachmentsUI();
    }
  }

  /**
   * Handle removing attachment
   */
  private _handleRemoveAttachment(attachmentId: string): void {
    this._attachments = this._attachments.filter((a) => a.id !== attachmentId);
    this._updateAttachmentsUI();
  }

  /**
   * Handle file search for autocomplete (also includes #terminal, #problems context)
   * @param isRemote - Whether this request came from a remote client (captured at call time to avoid async race)
   */
  private async _handleSearchFiles(
    query: string,
    isRemote: boolean = false,
  ): Promise<void> {
    try {
      const queryLower = query.toLowerCase();
      const cacheKey = queryLower || "__all__";

      // Check cache first (TTL-based)
      const cached = this._fileSearchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this._FILE_CACHE_TTL_MS) {
        const cachedResultMessage = {
          type: "fileSearchResults" as const,
          files: cached.results,
        };
        // Send only to the client that initiated the search
        if (isRemote) {
          this._broadcastCallback?.(cachedResultMessage as ToWebviewMessage);
        } else {
          this._view?.webview.postMessage(
            cachedResultMessage as ToWebviewMessage,
          );
        }
        return;
      }

      // First, get context suggestions (#terminal, #problems)
      const contextResults: FileSearchResult[] = [];

      // Check if query matches "terminal"
      if (!queryLower || "terminal".includes(queryLower)) {
        const commands =
          this._contextManager.terminal.formatCommandListForAutocomplete();
        const description =
          commands.length > 0
            ? `${commands.length} recent commands`
            : "No commands yet";
        contextResults.push({
          name: "terminal",
          path: description,
          uri: "context://terminal",
          icon: "terminal",
          isFolder: false,
          isContext: true,
        });
      }

      // Check if query matches "problems"
      if (!queryLower || "problems".includes(queryLower)) {
        const problemsInfo =
          this._contextManager.problems.formatForAutocomplete();
        contextResults.push({
          name: "problems",
          path: problemsInfo.description,
          uri: "context://problems",
          icon: "error",
          isFolder: false,
          isContext: true,
        });
      }

      // Exclude common unwanted files/folders for cleaner search results
      // Includes: package managers, virtual envs, build outputs, hidden/config files
      const excludePattern = formatExcludePattern(
        FILE_SEARCH_EXCLUSION_PATTERNS,
      );
      // Reduced from 2000 to _MAX_FILE_SEARCH_RESULTS for better performance
      const allFiles = await vscode.workspace.findFiles(
        "**/*",
        excludePattern,
        this._MAX_FILE_SEARCH_RESULTS,
      );

      const seenFolders = new Set<string>();
      const folderResults: FileSearchResult[] = [];

      for (const uri of allFiles) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const dirPath = path.dirname(relativePath);

        if (dirPath && dirPath !== "." && !seenFolders.has(dirPath)) {
          seenFolders.add(dirPath);
          const folderName = path.basename(dirPath);

          if (
            !queryLower ||
            folderName.toLowerCase().includes(queryLower) ||
            dirPath.toLowerCase().includes(queryLower)
          ) {
            const workspaceFolder =
              vscode.workspace.getWorkspaceFolder(uri)?.uri ??
              vscode.workspace.workspaceFolders![0].uri;
            folderResults.push({
              name: folderName,
              path: dirPath,
              uri: vscode.Uri.joinPath(workspaceFolder, dirPath).toString(),
              icon: "folder",
              isFolder: true,
            });
          }
        }
      }

      const fileResults: FileSearchResult[] = allFiles
        .map((uri) => {
          const relativePath = vscode.workspace.asRelativePath(uri);
          const fileName = path.basename(uri.fsPath);
          return {
            name: fileName,
            path: relativePath,
            uri: uri.toString(),
            icon: this._getFileIcon(fileName),
            isFolder: false,
          };
        })
        .filter(
          (file) =>
            !queryLower ||
            file.name.toLowerCase().includes(queryLower) ||
            file.path.toLowerCase().includes(queryLower),
        );

      // Combine: context results first, then folders, then files
      const fileAndFolderResults = [...folderResults, ...fileResults]
        .sort((a, b) => {
          if (a.isFolder && !b.isFolder) return -1;
          if (!a.isFolder && b.isFolder) return 1;
          const aExact = a.name.toLowerCase().startsWith(queryLower);
          const bExact = b.name.toLowerCase().startsWith(queryLower);
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 48); // Leave room for context items

      // Context results go first, then files/folders
      const allResults = [...contextResults, ...fileAndFolderResults];

      // Cache results (don't cache context results as they're dynamic)
      this._fileSearchCache.set(cacheKey, {
        results: fileAndFolderResults,
        timestamp: Date.now(),
      });
      // Limit cache size to prevent memory bloat
      if (this._fileSearchCache.size > 20) {
        const firstKey = this._fileSearchCache.keys().next().value;
        if (firstKey) this._fileSearchCache.delete(firstKey);
      }

      const searchResultMessage = {
        type: "fileSearchResults" as const,
        files: allResults,
      };

      // Send results only to the client that initiated the search
      // This prevents cross-triggering UI (e.g., remote search showing autocomplete in local webview)
      if (isRemote) {
        // Search was from remote client - send only to remote
        this._broadcastCallback?.(searchResultMessage as ToWebviewMessage);
      } else {
        // Search was from local webview - send only to local
        this._view?.webview.postMessage(
          searchResultMessage as ToWebviewMessage,
        );
      }
    } catch (error) {
      console.error("File search error:", error);
      const emptyResultMessage = {
        type: "fileSearchResults" as const,
        files: [],
      };
      // Send error response only to the client that initiated the search
      if (isRemote) {
        this._broadcastCallback?.(emptyResultMessage as ToWebviewMessage);
      } else {
        this._view?.webview.postMessage(emptyResultMessage as ToWebviewMessage);
      }
    }
  }

  /**
   * Handle saving pasted/dropped image
   */
  private async _handleSaveImage(
    dataUrl: string,
    mimeType: string,
  ): Promise<void> {
    const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

    try {
      const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!base64Match) {
        vscode.window.showWarningMessage("Invalid image format");
        return;
      }

      const base64Data = base64Match[1];

      // SECURITY FIX: Validate base64 size BEFORE decoding to prevent memory spike
      // Base64 encoding increases size by ~33%, so decoded size ≈ base64Length * 0.75
      const estimatedSize = Math.ceil(base64Data.length * 0.75);
      if (estimatedSize > MAX_IMAGE_SIZE_BYTES) {
        const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
        vscode.window.showWarningMessage(
          `Image too large (~${sizeMB}MB). Max 10MB.`,
        );
        return;
      }

      const buffer = Buffer.from(base64Data, "base64");

      if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
        vscode.window.showWarningMessage(
          `Image too large (${sizeMB}MB). Max 10MB.`,
        );
        return;
      }

      const validMimeTypes = [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
      ];
      if (!validMimeTypes.includes(mimeType)) {
        vscode.window.showWarningMessage(`Unsupported image type: ${mimeType}`);
        return;
      }

      const extMap: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
      };
      const ext = extMap[mimeType] || ".png";

      // Use storageUri if available (workspace-specific), otherwise fallback to globalStorageUri
      const storageUri =
        this._context.storageUri || this._context.globalStorageUri;
      if (!storageUri) {
        throw new Error(
          "VS Code extension storage URI not available. Cannot save temporary images without storage access.",
        );
      }

      const tempDir = path.join(storageUri.fsPath, "temp-images");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const existingImages = this._attachments.filter(
        (a) => a.isTemporary,
      ).length;
      let fileName =
        existingImages === 0
          ? `image-pasted${ext}`
          : `image-pasted-${existingImages}${ext}`;
      let filePath = path.join(tempDir, fileName);

      let counter = existingImages;
      while (fs.existsSync(filePath)) {
        counter++;
        fileName = `image-pasted-${counter}${ext}`;
        filePath = path.join(tempDir, fileName);
      }

      fs.writeFileSync(filePath, buffer);

      const attachment: AttachmentInfo = {
        id: `img_${Date.now()}`,
        name: fileName,
        uri: vscode.Uri.file(filePath).toString(),
        isTemporary: true,
      };

      this._attachments.push(attachment);

      const imageSavedMessage = {
        type: "imageSaved",
        attachment,
      } as ToWebviewMessage;

      this._view?.webview.postMessage(imageSavedMessage);

      // Broadcast to remote clients
      if (this._broadcastCallback) {
        this._broadcastCallback(imageSavedMessage);
      }

      this._updateAttachmentsUI();
    } catch (error) {
      console.error("Failed to save image:", error);
      vscode.window.showErrorMessage("Failed to save pasted image");
    }
  }

  /**
   * Handle saving image from a file URI (drag-and-drop from VS Code Explorer or URI-based drops)
   */
  private async _handleSaveImageFromUri(uri: string): Promise<void> {
    try {
      // Parse the URI to get the file path
      let filePath: string;
      if (uri.startsWith("file://")) {
        filePath = vscode.Uri.parse(uri).fsPath;
      } else {
        // Might be a plain path
        filePath = uri;
      }

      // Validate the file exists
      if (!fs.existsSync(filePath)) {
        console.error(
          "[FlowCommand] Dropped image file does not exist:",
          filePath,
        );
        return;
      }

      // Validate it's an image by checking extension
      const ext = path.extname(filePath).toLowerCase().replace(".", "");
      const validExtensions = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "bmp",
        "svg",
      ];
      if (!validExtensions.includes(ext)) {
        console.error("[FlowCommand] Dropped file is not an image:", filePath);
        return;
      }

      // Read the file and convert to data URL for processing through existing pipeline
      const fileBuffer = await fs.promises.readFile(filePath);
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
        svg: "image/svg+xml",
      };
      const mimeType = mimeMap[ext] || "image/png";
      const base64 = fileBuffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Process through existing _handleSaveImage pipeline
      await this._handleSaveImage(dataUrl, mimeType);
    } catch (error) {
      console.error(
        "[FlowCommand] Failed to save dropped image from URI:",
        error,
      );
    }
  }

  /**
   * Handle adding file reference from autocomplete
   */
  private _handleAddFileReference(file: FileSearchResult): void {
    const attachment: AttachmentInfo = {
      id: `${file.isFolder ? "folder" : "file"}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: file.name,
      uri: file.uri,
      isFolder: file.isFolder,
      isTextReference: true,
    };
    this._attachments.push(attachment);
    this._updateAttachmentsUI();
  }

  /**
   * Update attachments UI
   */
  private _updateAttachmentsUI(): void {
    const updateMessage = {
      type: "updateAttachments",
      attachments: this._attachments,
    } as ToWebviewMessage;

    this._view?.webview.postMessage(updateMessage);

    // Broadcast to remote clients
    if (this._broadcastCallback) {
      this._broadcastCallback(updateMessage);
    }
  }

  /**
   * Get file icon based on extension
   */
  private _getFileIcon(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const iconMap: Record<string, string> = {
      ts: "file-code",
      tsx: "file-code",
      js: "file-code",
      jsx: "file-code",
      py: "file-code",
      java: "file-code",
      c: "file-code",
      cpp: "file-code",
      html: "file-code",
      css: "file-code",
      scss: "file-code",
      json: "json",
      yaml: "file-code",
      yml: "file-code",
      md: "markdown",
      txt: "file-text",
      png: "file-media",
      jpg: "file-media",
      jpeg: "file-media",
      gif: "file-media",
      svg: "file-media",
      sh: "terminal",
      bash: "terminal",
      ps1: "terminal",
      zip: "file-zip",
      tar: "file-zip",
      gz: "file-zip",
    };
    return iconMap[ext] || "file";
  }

  /**
   * Handle adding a prompt to queue
   */
  private _handleAddQueuePrompt(
    prompt: string,
    id: string,
    attachments: AttachmentInfo[],
  ): void {
    const trimmed = prompt.trim();
    if (!trimmed || trimmed.length > this._MAX_QUEUE_PROMPT_LENGTH) return;

    const queuedPrompt: QueuedPrompt = {
      id: id || `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prompt: trimmed,
      attachments: attachments.length > 0 ? [...attachments] : undefined, // Store attachments if any
    };

    // Check if we should auto-respond BEFORE adding to queue (race condition fix)
    // This prevents the window between push and findIndex where queue could be modified
    const shouldAutoRespond =
      this._queueEnabled &&
      !this._queuePaused &&
      this._currentToolCallId &&
      this._pendingRequests.has(this._currentToolCallId);

    if (shouldAutoRespond) {
      // Don't add to queue - consume directly for the pending request
      const resolve = this._pendingRequests.get(this._currentToolCallId!);
      if (!resolve) return;

      // Update the pending entry to completed
      const pendingEntry = this._currentSessionCallsMap.get(
        this._currentToolCallId!,
      );

      let completedEntry: ToolCallEntry;
      if (pendingEntry && pendingEntry.status === "pending") {
        pendingEntry.response = queuedPrompt.prompt;
        pendingEntry.attachments = queuedPrompt.attachments;
        pendingEntry.status = "completed";
        pendingEntry.isFromQueue = true;
        pendingEntry.timestamp = Date.now();
        completedEntry = pendingEntry;
      } else {
        completedEntry = {
          id: this._currentToolCallId!,
          prompt: "Tool call",
          response: queuedPrompt.prompt,
          attachments: queuedPrompt.attachments,
          timestamp: Date.now(),
          isFromQueue: true,
          status: "completed",
        };
        this._currentSessionCalls.unshift(completedEntry);
        this._currentSessionCallsMap.set(completedEntry.id, completedEntry);
        this._trimCurrentSessionCalls();
      }

      // Send toolCallCompleted to webview
      this._view?.webview.postMessage({
        type: "toolCallCompleted",
        entry: completedEntry,
      } as ToWebviewMessage);

      // Update processing state - AI is now processing the queued response
      this._setProcessingState(true);

      this._updateCurrentSessionUI();
      this._saveQueueToDisk();
      this._updateQueueUI();

      // Append template to the prompt if active
      const finalValue = this._appendTemplateToPrompt(queuedPrompt.prompt);
      resolve({
        value: finalValue,
        queue: true,
        attachments: queuedPrompt.attachments || [],
      });
      this._pendingRequests.delete(this._currentToolCallId!);
      this._currentToolCallId = null;

      // Process next queued agent request if any
      this._processNextQueuedToolCall();
    } else {
      // No pending request - add to queue normally
      this._promptQueue.push(queuedPrompt);
      this._saveQueueToDisk();
      this._updateQueueUI();
    }

    // Clear attachments after adding to queue (they're now stored with the queue item)
    // This prevents old images from reappearing when pasting new images
    this._attachments = [];
    this._updateAttachmentsUI();
  }

  /**
   * Validate queue prompt ID format (defense in depth)
   */
  private _isValidQueueId(id: unknown): id is string {
    return typeof id === "string" && /^q_\d+_[a-z0-9]+$/.test(id);
  }

  /**
   * Handle removing a prompt from queue
   */
  private _handleRemoveQueuePrompt(promptId: string): void {
    if (!this._isValidQueueId(promptId)) return;
    this._promptQueue = this._promptQueue.filter((p) => p.id !== promptId);
    this._saveQueueToDisk();
    this._updateQueueUI();
  }

  /**
   * Handle editing a prompt in queue
   */
  private _handleEditQueuePrompt(promptId: string, newPrompt: string): void {
    if (!this._isValidQueueId(promptId)) return;
    const trimmed = newPrompt.trim();
    if (!trimmed || trimmed.length > this._MAX_QUEUE_PROMPT_LENGTH) return;

    const prompt = this._promptQueue.find((p) => p.id === promptId);
    if (prompt) {
      prompt.prompt = trimmed;
      this._saveQueueToDisk();
      this._updateQueueUI();
    }
  }

  /**
   * Handle reordering queue
   */
  private _handleReorderQueue(fromIndex: number, toIndex: number): void {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (
      fromIndex >= this._promptQueue.length ||
      toIndex >= this._promptQueue.length
    )
      return;

    const [removed] = this._promptQueue.splice(fromIndex, 1);
    this._promptQueue.splice(toIndex, 0, removed);
    this._saveQueueToDisk();
    this._updateQueueUI();
  }

  /**
   * Handle toggling queue enabled state
   */
  private _handleToggleQueue(enabled: boolean): void {
    this._queueEnabled = enabled;
    this._saveQueueToDisk();
    this._updateQueueUI();
  }

  /**
   * Handle clearing the queue
   */
  private _handleClearQueue(): void {
    this._promptQueue = [];
    this._saveQueueToDisk();
    this._updateQueueUI();
  }

  /**
   * Handle pausing the queue
   */
  private _handlePauseQueue(): void {
    this._queuePaused = true;
    this._saveQueueToDisk();
    this._updateQueueUI();
    console.log("[FlowCommand] Queue paused");
  }

  /**
   * Handle resuming the queue
   */
  private _handleResumeQueue(): void {
    this._queuePaused = false;
    this._saveQueueToDisk();
    this._updateQueueUI();
    console.log("[FlowCommand] Queue resumed");

    // If there's a pending request and queue has items, auto-process immediately
    if (
      this._currentToolCallId &&
      this._pendingRequests.has(this._currentToolCallId) &&
      this._promptQueue.length > 0
    ) {
      this._processQueueForPendingRequest();
    }
  }

  /**
   * Process the next queue item for a pending request
   */
  private _processQueueForPendingRequest(): void {
    if (
      !this._currentToolCallId ||
      this._queuePaused ||
      this._promptQueue.length === 0
    ) {
      return;
    }

    const resolve = this._pendingRequests.get(this._currentToolCallId);
    if (!resolve) {
      return;
    }

    const queuedPrompt = this._promptQueue.shift();
    if (!queuedPrompt) {
      return;
    }

    this._saveQueueToDisk();
    this._updateQueueUI();

    // Get the pending entry to update
    const pendingEntry = this._currentSessionCallsMap.get(
      this._currentToolCallId,
    );

    if (pendingEntry && pendingEntry.status === "pending") {
      // Update existing pending entry
      pendingEntry.response = queuedPrompt.prompt;
      pendingEntry.attachments = queuedPrompt.attachments || [];
      pendingEntry.status = "completed";
      pendingEntry.timestamp = Date.now();
      pendingEntry.isFromQueue = true;

      // Send toolCallCompleted to trigger "Working...." state in webview
      this._postMessage({
        type: "toolCallCompleted",
        entry: pendingEntry,
      } as ToWebviewMessage);

      // Update processing state - AI is now processing the user's response
      this._setProcessingState(true);
    }

    this._updateCurrentSessionUI();

    // Append template to the prompt if active
    const finalValue = this._appendTemplateToPrompt(queuedPrompt.prompt);
    resolve({
      value: finalValue,
      queue: true,
      attachments: queuedPrompt.attachments || [],
    });
    this._pendingRequests.delete(this._currentToolCallId);
    this._currentToolCallId = null;

    // Process next queued agent request if any
    this._processNextQueuedToolCall();
  }

  /**
   * Handle removing a history item from persisted history (modal only)
   */
  private _handleRemoveHistoryItem(callId: string): void {
    this._persistedHistory = this._persistedHistory.filter(
      (tc) => tc.id !== callId,
    );
    this._updatePersistedHistoryUI();
    this._savePersistedHistoryToDisk();
  }

  /**
   * Handle clearing all persisted history
   */
  private _handleClearPersistedHistory(): void {
    this._persistedHistory = [];
    this._updatePersistedHistoryUI();
    this._savePersistedHistoryToDisk();
  }

  /**
   * Handle opening history modal - send persisted history to webview
   */
  private _handleOpenHistoryModal(): void {
    this._updatePersistedHistoryUI();
  }

  /**
   * Handle opening settings modal - send settings to webview
   */
  private _handleOpenSettingsModal(): void {
    // Refresh instruction status when settings open (manual file changes)
    void Promise.all([
      this._refreshInstructionStatus(),
      this._refreshMcpStatus(),
    ]).then(() => {
      // Don't reload settings here - just send current state
      // Settings are already kept in sync via onDidChangeConfiguration
      this._updateSettingsUI();
    });
  }

  /**
   * Handle updating sound setting
   */
  private async _handleUpdateSoundSetting(enabled: boolean): Promise<void> {
    this._soundEnabled = enabled;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "notificationSound",
        enabled,
        vscode.ConfigurationTarget.Global,
      );
      // Reload settings after update to ensure consistency
      this._loadSettings();
      // Update UI to reflect the saved state
      this._updateSettingsUI();
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle updating interactive approval setting
   */
  private async _handleUpdateInteractiveApprovalSetting(
    enabled: boolean,
  ): Promise<void> {
    this._interactiveApprovalEnabled = enabled;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "interactiveApproval",
        enabled,
        vscode.ConfigurationTarget.Global,
      );
      // Reload settings after update to ensure consistency
      this._loadSettings();
      // Update UI to reflect the saved state
      this._updateSettingsUI();
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle updating desktop notification setting
   */
  private async _handleUpdateDesktopNotificationSetting(
    enabled: boolean,
  ): Promise<void> {
    this._desktopNotificationEnabled = enabled;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "desktopNotification",
        enabled,
        vscode.ConfigurationTarget.Global,
      );
      this._loadSettings();
      this._updateSettingsUI();
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle updating auto-focus panel setting
   */
  private async _handleUpdateAutoFocusPanelSetting(
    enabled: boolean,
  ): Promise<void> {
    this._autoFocusPanelEnabled = enabled;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "autoFocusPanel",
        enabled,
        vscode.ConfigurationTarget.Global,
      );
      this._loadSettings();
      this._updateSettingsUI();
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle updating mobile notification setting
   */
  private async _handleUpdateMobileNotificationSetting(
    enabled: boolean,
  ): Promise<void> {
    this._mobileNotificationEnabled = enabled;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "mobileNotification",
        enabled,
        vscode.ConfigurationTarget.Global,
      );
      this._loadSettings();
      this._updateSettingsUI();
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Show VS Code desktop notification when AI calls ask_user
   */
  private _showDesktopNotification(question: string): void {
    if (!this._desktopNotificationEnabled) return;

    const preview =
      question.length > 100 ? question.substring(0, 97) + "..." : question;
    vscode.window
      .showInformationMessage(`FlowCommand: ${preview}`, "Open FlowCommand")
      .then((action) => {
        if (action === "Open FlowCommand" && this._view) {
          this._view.show(true);
        }
      });
  }

  /**
   * Handle updating instruction injection method
   */
  private async _handleUpdateInstructionInjection(
    method: string,
  ): Promise<void> {
    this._instructionInjection = method;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "instructionInjection",
        method,
        vscode.ConfigurationTarget.Workspace,
      );
      this._loadSettings();
      this._updateSettingsUI();

      if (method !== "off") {
        const methodLabel =
          method === "copilotInstructionsMd"
            ? ".github/copilot-instructions.md"
            : "Code Generation settings";
        const action = await vscode.window.showInformationMessage(
          `FlowCommand instructions injected into ${methodLabel}. Restart the workspace window for changes to take full effect.`,
          "Restart Window",
        );
        if (action === "Restart Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } else {
        vscode.window.showInformationMessage(
          "FlowCommand instructions removed.",
        );
      }
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle updating instruction text
   */
  private async _handleUpdateInstructionText(text: string): Promise<void> {
    this._instructionText = text;
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      await config.update(
        "instructionText",
        text,
        vscode.ConfigurationTarget.Workspace,
      );
      this._loadSettings();
      this._updateSettingsUI();
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle resetting instruction text to default
   */
  private async _handleResetInstructionText(): Promise<void> {
    this._isUpdatingConfig = true;
    try {
      const config = vscode.workspace.getConfiguration("flowcommand");
      // Remove the workspace-level override to fall back to package.json default
      await config.update(
        "instructionText",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      this._loadSettings();
      this._updateSettingsUI();
      vscode.window.showInformationMessage(
        "Instruction text reset to default.",
      );
    } finally {
      this._isUpdatingConfig = false;
    }
  }

  /**
   * Handle a plan review response from remote client or sidebar.
   * Resolves the PlanReviewPanel externally so the tool call can complete.
   */
  private _handlePlanReviewResponse(
    reviewId: string,
    action: string,
    revisions: Array<{ revisedPart: string; revisorInstructions: string }>,
  ): void {
    const mappedAction = (
      ["approved", "approvedWithComments", "recreateWithChanges"].includes(
        action,
      )
        ? action
        : "closed"
    ) as PlanReviewPanelResult["action"];

    const result: PlanReviewPanelResult = {
      action: mappedAction,
      requiredRevisions: revisions,
    };

    const resolved = resolvePlanReview(reviewId, result);
    if (resolved) {
      // Map 'closed' to 'cancelled' for the broadcast status (matches tool result)
      const broadcastStatus =
        mappedAction === "closed" ? "cancelled" : mappedAction;
      console.log(
        "[FlowCommand] Plan review resolved:",
        reviewId,
        broadcastStatus,
      );
      // Immediately broadcast to all clients to close their modals
      // This ensures synchronization even if the main planReview() flow takes time
      this.broadcastPlanReviewCompleted(reviewId, broadcastStatus);
    }
  }

  /**
   * Handle multi-question response from webview
   */
  private _handleMultiQuestionResponse(
    requestId: string,
    answers: Array<{
      header: string;
      selected: string[];
      freeformText?: string;
    }>,
    cancelled?: boolean,
  ): void {
    const resolve = this._pendingRequests.get(requestId);
    if (!resolve) {
      console.warn(
        "[FlowCommand] No pending request for multi-question response:",
        requestId,
      );
      return;
    }

    // Handle cancellation
    if (cancelled) {
      // Update the pending entry to show cancelled status
      const pendingEntry = this._currentSessionCallsMap.get(requestId);
      if (pendingEntry && pendingEntry.status === "pending") {
        pendingEntry.response = "[Cancelled by user]";
        pendingEntry.status = "cancelled";
        pendingEntry.timestamp = Date.now();
      }

      // Send completion signal to webview
      this._postMessage({
        type: "multiQuestionCompleted",
        requestId,
      } as ToWebviewMessage);

      // Broadcast to remote clients
      if (this._broadcastCallback) {
        this._broadcastCallback({ type: "multiQuestionCompleted", requestId });
      }

      this._setProcessingState(false);
      this._updateCurrentSessionUI();

      resolve({
        value: "[CANCELLED: User cancelled multi-question input]",
        queue: false,
        attachments: [],
        cancelled: true,
      });

      this._pendingRequests.delete(requestId);
      this._currentToolCallId = null;
      this._currentMultiQuestions = null;

      // Process next queued agent request if any
      this._processNextQueuedToolCall();
      return;
    }

    // Validate and sanitize answers to prevent issues
    const safeAnswers = (Array.isArray(answers) ? answers : []).map((a) => {
      const answer: Record<string, unknown> = {
        question: String(a?.header || "Unknown").substring(0, 100),
        selectedOptions: Array.isArray(a?.selected)
          ? a.selected.map((s) => String(s).substring(0, 500)).slice(0, 20)
          : [],
      };
      if (a?.freeformText && typeof a.freeformText === "string") {
        answer.freeformText = a.freeformText.substring(0, 5000);
      }
      return answer;
    });

    const responseJson = JSON.stringify({ answers: safeAnswers }, null, 2);

    // Update the pending entry
    const pendingEntry = this._currentSessionCallsMap.get(requestId);
    if (pendingEntry && pendingEntry.status === "pending") {
      pendingEntry.response = responseJson;
      pendingEntry.status = "completed";
      pendingEntry.timestamp = Date.now();
    }

    // Send completion signal to webview
    this._postMessage({
      type: "multiQuestionCompleted",
      requestId,
    } as ToWebviewMessage);

    // Broadcast to remote clients
    if (this._broadcastCallback) {
      this._broadcastCallback({ type: "multiQuestionCompleted", requestId });
    }

    this._setProcessingState(true);
    this._updateCurrentSessionUI();

    // Append template to the response if active
    const finalValue = this._appendTemplateToPrompt(responseJson);

    resolve({
      value: finalValue,
      queue: this._queueEnabled,
      attachments: [],
    });

    this._pendingRequests.delete(requestId);
    this._currentToolCallId = null;
    this._currentMultiQuestions = null;

    // Process next queued agent request if any
    this._processNextQueuedToolCall();
  }

  /**
   * Handle adding a reusable prompt
   */
  private async _handleAddReusablePrompt(
    name: string,
    prompt: string,
  ): Promise<void> {
    const trimmedName = name.trim().toLowerCase().replace(/\s+/g, "-");
    const trimmedPrompt = prompt.trim();

    if (!trimmedName || !trimmedPrompt) return;

    // Check for duplicate names
    if (
      this._reusablePrompts.some((p) => p.name.toLowerCase() === trimmedName)
    ) {
      vscode.window.showWarningMessage(
        `A prompt with name "/${trimmedName}" already exists.`,
      );
      return;
    }

    const newPrompt: ReusablePrompt = {
      id: `rp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      name: trimmedName,
      prompt: trimmedPrompt,
    };

    this._reusablePrompts.push(newPrompt);
    await this._saveReusablePrompts();
    this._updateSettingsUI();
  }

  /**
   * Handle editing a reusable prompt
   */
  private async _handleEditReusablePrompt(
    id: string,
    name: string,
    prompt: string,
    isTemplate?: boolean,
  ): Promise<void> {
    const trimmedName = name.trim().toLowerCase().replace(/\s+/g, "-");
    const trimmedPrompt = prompt.trim();

    if (!trimmedName || !trimmedPrompt) return;

    const existingPrompt = this._reusablePrompts.find((p) => p.id === id);
    if (!existingPrompt) return;

    // Check for duplicate names (excluding current prompt)
    if (
      this._reusablePrompts.some(
        (p) => p.id !== id && p.name.toLowerCase() === trimmedName,
      )
    ) {
      vscode.window.showWarningMessage(
        `A prompt with name "/${trimmedName}" already exists.`,
      );
      return;
    }

    existingPrompt.name = trimmedName;
    existingPrompt.prompt = trimmedPrompt;

    // If setting this as template, clear other templates first
    if (isTemplate) {
      this._reusablePrompts.forEach((p) => (p.isTemplate = false));
      existingPrompt.isTemplate = true;
    } else if (isTemplate === false) {
      existingPrompt.isTemplate = false;
    }

    await this._saveReusablePrompts();
    this._updateSettingsUI();
  }

  /**
   * Handle removing a reusable prompt
   */
  private async _handleRemoveReusablePrompt(id: string): Promise<void> {
    this._reusablePrompts = this._reusablePrompts.filter((p) => p.id !== id);
    await this._saveReusablePrompts();
    this._updateSettingsUI();
  }

  /**
   * Handle setting a prompt as the active template
   */
  private async _handleSetPromptTemplate(id: string): Promise<void> {
    // Clear all templates first
    this._reusablePrompts.forEach((p) => (p.isTemplate = false));

    // Set the specified prompt as template
    const prompt = this._reusablePrompts.find((p) => p.id === id);
    if (prompt) {
      prompt.isTemplate = true;
    }

    await this._saveReusablePrompts();
    this._updateSettingsUI();
  }

  /**
   * Handle clearing the active template
   */
  private async _handleClearPromptTemplate(): Promise<void> {
    this._reusablePrompts.forEach((p) => (p.isTemplate = false));
    await this._saveReusablePrompts();
    this._updateSettingsUI();
  }

  /**
   * Get the active template prompt content (if any)
   */
  private _getActiveTemplate(): string | undefined {
    const template = this._reusablePrompts.find((p) => p.isTemplate === true);
    return template?.prompt;
  }

  /**
   * Append active template to a prompt (if template is active)
   */
  private _appendTemplateToPrompt(prompt: string): string {
    const template = this._getActiveTemplate();
    if (!template) {
      return prompt;
    }
    // Append template with clear separator
    return `${prompt}\n\n[Auto-appended instructions]\n${template}`;
  }

  /**
   * Handle searching slash commands for autocomplete
   */
  private _handleSearchSlashCommands(query: string): void {
    const queryLower = query.toLowerCase();
    const matchingPrompts = this._reusablePrompts.filter(
      (p) =>
        p.name.toLowerCase().includes(queryLower) ||
        p.prompt.toLowerCase().includes(queryLower),
    );

    const message = {
      type: "slashCommandResults" as const,
      prompts: matchingPrompts,
    };

    // Send results only to the client that initiated the search
    if (this._isRemoteMessageContext) {
      this._broadcastCallback?.(message as ToWebviewMessage);
    } else {
      this._view?.webview.postMessage(message as ToWebviewMessage);
    }
  }

  /**
   * Handle searching context references (#terminal, #problems) - deprecated, now handled via file search
   */
  private async _handleSearchContext(query: string): Promise<void> {
    try {
      const suggestions =
        await this._contextManager.getContextSuggestions(query);
      this._view?.webview.postMessage({
        type: "contextSearchResults",
        suggestions: suggestions.map((s) => ({
          type: s.type,
          label: s.label,
          description: s.description,
          detail: s.detail,
        })),
      } as ToWebviewMessage);
    } catch (error) {
      console.error("[FlowCommand] Error searching context:", error);
      this._view?.webview.postMessage({
        type: "contextSearchResults",
        suggestions: [],
      } as ToWebviewMessage);
    }
  }

  /**
   * Handle selecting a context reference to add as attachment
   */
  private async _handleSelectContextReference(
    contextType: string,
    options?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const reference = await this._contextManager.getContextContent(
        contextType as ContextReferenceType,
        options,
      );

      if (reference) {
        // Add context reference as a special attachment
        const contextAttachment: AttachmentInfo = {
          id: reference.id,
          name: reference.label,
          uri: `context://${reference.type}/${reference.id}`,
          isTextReference: true,
        };
        this._attachments.push(contextAttachment);
        this._updateAttachmentsUI();

        // Also send the reference content so it can be displayed
        this._view?.webview.postMessage({
          type: "contextReferenceAdded",
          reference: {
            id: reference.id,
            type: reference.type,
            label: reference.label,
            content: reference.content,
          },
        } as ToWebviewMessage);
      } else {
        // Still add a placeholder attachment showing it was selected but empty
        const emptyId = `ctx_empty_${Date.now()}`;
        const friendlyType = contextType.replace(":", " ");
        const contextAttachment: AttachmentInfo = {
          id: emptyId,
          name: `#${friendlyType} (no content)`,
          uri: `context://${contextType}/${emptyId}`,
          isTextReference: true,
        };
        this._attachments.push(contextAttachment);
        this._updateAttachmentsUI();

        // Show info message
        vscode.window.showInformationMessage(
          `No ${contextType} content available yet`,
        );
      }
    } catch (error) {
      console.error("[FlowCommand] Error selecting context reference:", error);
      vscode.window.showErrorMessage(`Failed to get ${contextType} content`);
    }
  }

  /**
   * Resolve context content from a context URI
   * URI format: context://type/id
   */
  public async resolveContextContent(uri: string): Promise<string | undefined> {
    try {
      const parsed = vscode.Uri.parse(uri);
      if (parsed.scheme !== "context") return undefined;

      const type = parsed.authority as ContextReferenceType;
      // id is likely in path, e.g. /id
      const id = parsed.path.startsWith("/")
        ? parsed.path.substring(1)
        : parsed.path;

      const contextRef = await this._contextManager.getContextContent(type);
      return contextRef?.content;
    } catch (error) {
      console.error("[FlowCommand] Error resolving context content:", error);
      return undefined;
    }
  }

  /**
   * Update queue UI in webview
   */
  private _updateQueueUI(): void {
    this._postMessage({
      type: "updateQueue",
      queue: this._promptQueue,
      enabled: this._queueEnabled,
      paused: this._queuePaused,
    } as ToWebviewMessage);
  }

  /**
   * Update current session UI in webview (cards in chat)
   */
  private _updateCurrentSessionUI(): void {
    this._postMessage({
      type: "updateCurrentSession",
      history: this._currentSessionCalls,
    } as ToWebviewMessage);
    this._saveCurrentSessionToDisk();
  }

  /**
   * Update persisted history UI in webview (for modal)
   */
  private _updatePersistedHistoryUI(): void {
    this._postMessage({
      type: "updatePersistedHistory",
      history: this._persistedHistory,
    } as ToWebviewMessage);
  }

  /**
   * Load queue from disk
   */
  private async _loadQueueFromDiskAsync(): Promise<void> {
    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const queuePath = path.join(storagePath, "queue.json");

      // Check if file exists using async
      try {
        await fs.promises.access(queuePath, fs.constants.F_OK);
      } catch {
        // File doesn't exist, use defaults
        this._promptQueue = [];
        this._queueEnabled = true;
        return;
      }

      const data = await fs.promises.readFile(queuePath, "utf8");
      const parsed = JSON.parse(data);
      this._promptQueue = Array.isArray(parsed.queue) ? parsed.queue : [];
      this._queueEnabled = parsed.enabled === true;
      this._queuePaused = parsed.paused === true;
    } catch (error) {
      console.error("Failed to load queue:", error);
      this._promptQueue = [];
      this._queueEnabled = true; // Default to queue mode
    }
  }

  /**
   * Save queue to disk (debounced)
   */
  private _saveQueueToDisk(): void {
    if (this._queueSaveTimer) {
      clearTimeout(this._queueSaveTimer);
    }
    this._queueSaveTimer = setTimeout(() => {
      this._saveQueueToDiskAsync();
    }, this._QUEUE_SAVE_DEBOUNCE_MS);
  }

  /**
   * Actually persist queue to disk
   */
  private async _saveQueueToDiskAsync(): Promise<void> {
    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const queuePath = path.join(storagePath, "queue.json");

      if (!fs.existsSync(storagePath)) {
        await fs.promises.mkdir(storagePath, { recursive: true });
      }

      const data = JSON.stringify(
        {
          queue: this._promptQueue,
          enabled: this._queueEnabled,
          paused: this._queuePaused,
        },
        null,
        2,
      );

      await fs.promises.writeFile(queuePath, data, "utf8");
    } catch (error) {
      console.error("Failed to save queue:", error);
    }
  }

  /**
   * Load persisted history from disk (past sessions only) - ASYNC to not block activation
   */
  private async _loadPersistedHistoryFromDiskAsync(): Promise<void> {
    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const historyPath = path.join(storagePath, "tool-history.json");

      // Check if file exists using async stat
      try {
        await fs.promises.access(historyPath, fs.constants.F_OK);
      } catch {
        // File doesn't exist, use empty history
        this._persistedHistory = [];
        return;
      }

      const data = await fs.promises.readFile(historyPath, "utf8");
      const parsed = JSON.parse(data);
      // Only load completed entries from past sessions, enforce max limit
      this._persistedHistory = Array.isArray(parsed.history)
        ? parsed.history
            .filter((entry: ToolCallEntry) => entry.status === "completed")
            .slice(0, this._MAX_HISTORY_ENTRIES)
        : [];
    } catch (error) {
      console.error("[FlowCommand] Failed to load persisted history:", error);
      this._persistedHistory = [];
    }
  }

  /**
   * Load current session from disk (for recovery after reload/crash)
   */
  private async _loadCurrentSessionFromDiskAsync(): Promise<void> {
    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const sessionPath = path.join(storagePath, "current-session.json");

      try {
        await fs.promises.access(sessionPath, fs.constants.F_OK);
      } catch {
        this._currentSessionCalls = [];
        this._currentSessionCallsMap.clear();
        return;
      }

      const data = await fs.promises.readFile(sessionPath, "utf8");
      const parsed = JSON.parse(data);
      const rawEntries = Array.isArray(parsed.history) ? parsed.history : [];

      const recovered = rawEntries.map((entry: ToolCallEntry) => {
        const safeAttachments = Array.isArray(entry.attachments)
          ? entry.attachments.filter((att) => !att.isTemporary)
          : undefined;

        if (entry.status === "pending") {
          return {
            ...entry,
            status: "cancelled",
            response: entry.response || "[Cancelled due to reload]",
            attachments: safeAttachments,
          } as ToolCallEntry;
        }

        return {
          ...entry,
          attachments: safeAttachments,
        } as ToolCallEntry;
      });

      this._currentSessionCalls = recovered.slice(
        0,
        this._MAX_CURRENT_SESSION_ENTRIES,
      );
      this._currentSessionCallsMap.clear();
      for (const entry of this._currentSessionCalls) {
        this._currentSessionCallsMap.set(entry.id, entry);
      }
    } catch (error) {
      console.error("[FlowCommand] Failed to load current session:", error);
      this._currentSessionCalls = [];
      this._currentSessionCallsMap.clear();
    }
  }

  /**
   * Save current session to disk (debounced)
   */
  private _saveCurrentSessionToDisk(): void {
    if (this._currentSessionSaveTimer) {
      clearTimeout(this._currentSessionSaveTimer);
    }
    this._currentSessionSaveTimer = setTimeout(() => {
      this._saveCurrentSessionToDiskAsync();
    }, this._CURRENT_SESSION_SAVE_DEBOUNCE_MS);
  }

  /**
   * Async save current session (non-blocking)
   */
  private async _saveCurrentSessionToDiskAsync(): Promise<void> {
    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const sessionPath = path.join(storagePath, "current-session.json");

      const fsPromises = await import("fs/promises");
      try {
        await fsPromises.access(storagePath);
      } catch {
        await fsPromises.mkdir(storagePath, { recursive: true });
      }

      const sanitizedHistory = this._currentSessionCalls.map((entry) => ({
        ...entry,
        attachments: Array.isArray(entry.attachments)
          ? entry.attachments.filter((att) => !att.isTemporary)
          : undefined,
      }));

      const data = JSON.stringify({ history: sanitizedHistory }, null, 2);
      await fsPromises.writeFile(sessionPath, data, "utf8");
    } catch (error) {
      console.error("[FlowCommand] Failed to save current session:", error);
    }
  }

  /**
   * Save persisted history to disk with debounced async write
   * Uses background async saves to avoid blocking the main thread
   */
  private _savePersistedHistoryToDisk(): void {
    this._historyDirty = true;

    // Cancel any pending save
    if (this._historySaveTimer) {
      clearTimeout(this._historySaveTimer);
    }

    // Schedule debounced async save
    this._historySaveTimer = setTimeout(() => {
      this._savePersistedHistoryToDiskAsync();
    }, this._HISTORY_SAVE_DEBOUNCE_MS);
  }

  /**
   * Async save persisted history (non-blocking background save)
   */
  private async _savePersistedHistoryToDiskAsync(): Promise<void> {
    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const historyPath = path.join(storagePath, "tool-history.json");

      // Use async fs operations from fs/promises
      const fsPromises = await import("fs/promises");

      try {
        await fsPromises.access(storagePath);
      } catch {
        await fsPromises.mkdir(storagePath, { recursive: true });
      }

      // Only save completed entries
      const completedHistory = this._persistedHistory.filter(
        (entry) => entry.status === "completed",
      );

      const data = JSON.stringify(
        {
          history: completedHistory,
        },
        null,
        2,
      );

      await fsPromises.writeFile(historyPath, data, "utf8");
      this._historyDirty = false;
    } catch (error) {
      console.error(
        "[FlowCommand] Failed to save persisted history (async):",
        error,
      );
    }
  }

  /**
   * Actually persist history to disk (synchronous - only for deactivate)
   * Called during extension deactivation when async operations cannot complete
   */
  private _savePersistedHistoryToDiskSync(): void {
    // Only save if there are pending changes
    if (!this._historyDirty) return;

    try {
      const storagePath = this._context.globalStorageUri.fsPath;
      const historyPath = path.join(storagePath, "tool-history.json");

      if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
      }

      // Only save completed entries
      const completedHistory = this._persistedHistory.filter(
        (entry) => entry.status === "completed",
      );

      const data = JSON.stringify(
        {
          history: completedHistory,
        },
        null,
        2,
      );

      fs.writeFileSync(historyPath, data, "utf8");
      this._historyDirty = false;
    } catch (error) {
      console.error("[FlowCommand] Failed to save persisted history:", error);
    }
  }

  /**
   * Generate HTML content for webview
   */
  private _getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "webview.js"),
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "codicon.css"),
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "FC-logo.svg"),
    );
    const notificationSoundUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "notification.wav"),
    );
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; media-src ${webview.cspSource} data:;">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>FlowCommand Chat</title>
    <audio id="notification-sound" preload="auto" src="${notificationSoundUri}"></audio>
</head>
<body>
    <div class="main-container">
        <!-- Chat Container -->
        <div class="chat-container" id="chat-container">
            <!-- Welcome Section - Let's build -->
            <div class="welcome-section" id="welcome-section">
                <div class="welcome-icon">
                    <img src="${logoUri}" alt="FlowCommand Logo" width="48" height="48" class="welcome-logo">
                </div>
                <h1 class="welcome-title">Let's build</h1>
                <p class="welcome-subtitle">Sync your tasks, automate your workflow</p>
                
                <div class="welcome-cards">
                    <div class="welcome-card welcome-card-vibe" id="card-vibe">
                        <div class="welcome-card-header">
                            <span class="codicon codicon-comment-discussion"></span>
                            <span class="welcome-card-title">Normal</span>
                        </div>
                        <p class="welcome-card-desc">Respond to each AI request directly. Full control over every interaction.</p>
                    </div>
                    <div class="welcome-card welcome-card-spec" id="card-spec">
                        <div class="welcome-card-header">
                            <span class="codicon codicon-layers"></span>
                            <span class="welcome-card-title">Queue</span>
                        </div>
                        <p class="welcome-card-desc">Batch your responses. AI consumes from queue automatically, one by one.</p>
                    </div>
                </div>
            </div>

            <!-- Tool Call History Area -->
            <div class="tool-history-area" id="tool-history-area"></div>

            <!-- Pending Tool Call Message -->
            <div class="pending-message hidden" id="pending-message"></div>
        </div>

        <!-- Combined Input Wrapper (Queue + Input) -->
        <div class="input-area-container" id="input-area-container">
            <!-- File Autocomplete Dropdown - positioned outside input-wrapper to avoid clipping -->
            <div class="autocomplete-dropdown hidden" id="autocomplete-dropdown">
                <div class="autocomplete-list" id="autocomplete-list"></div>
                <div class="autocomplete-empty hidden" id="autocomplete-empty">No files found</div>
            </div>
            <!-- Slash Command Autocomplete Dropdown -->
            <div class="slash-dropdown hidden" id="slash-dropdown">
                <div class="slash-list" id="slash-list"></div>
                <div class="slash-empty hidden" id="slash-empty">No prompts found. Add prompts in Settings.</div>
            </div>
            <div class="input-wrapper" id="input-wrapper">
            <!-- Prompt Queue Section - Integrated above input -->
            <div class="queue-section" id="queue-section" role="region" aria-label="Prompt queue">
                <div class="queue-header" id="queue-header" role="button" tabindex="0" aria-expanded="true" aria-controls="queue-list">
                    <div class="accordion-icon" aria-hidden="true">
                        <span class="codicon codicon-chevron-down"></span>
                    </div>
                    <span class="queue-header-title">Prompt Queue</span>
                    <span class="queue-count" id="queue-count" aria-live="polite">0</span>
                    <button class="queue-clear-btn" id="queue-clear-btn" title="Clear all queue items" aria-label="Clear queue">
                        <span class="codicon codicon-trash" aria-hidden="true"></span>
                    </button>
                </div>
                <div class="queue-list" id="queue-list" role="list" aria-label="Queued prompts">
                    <div class="queue-empty" role="status">No prompts in queue</div>
                </div>
            </div>

            <!-- Input Area -->
            <div class="input-container" id="input-container">
            <!-- Attachment Chips INSIDE input container -->
            <div class="chips-container hidden" id="chips-container"></div>
            <div class="input-row">
                <div class="input-highlighter-wrapper">
                    <div class="input-highlighter" id="input-highlighter" aria-hidden="true"></div>
                    <textarea id="chat-input" placeholder="Reply to tool call. (use # for files, / for prompts)" rows="1" aria-label="Message input. Use # for file references, / for saved prompts"></textarea>
                </div>
            </div>
            <div class="actions-bar">
                <div class="actions-left">
                    <button id="attach-btn" class="icon-btn" title="Add attachment (+)" aria-label="Add attachment">
                        <span class="codicon codicon-add"></span>
                    </button>
                    <div class="mode-selector" id="mode-selector">
                        <button id="mode-btn" class="mode-btn" title="Select mode" aria-label="Select mode">
                            <span id="mode-label">Queue</span>
                            <span class="codicon codicon-chevron-down"></span>
                        </button>
                    </div>
                    <button class="queue-pause-btn hidden" id="queue-pause-btn" title="Pause/Resume queue processing" aria-label="Pause queue">
                        <span class="codicon codicon-debug-pause" aria-hidden="true"></span>
                    </button>
                </div>
                <div class="actions-right">
                    <button id="end-session-btn" class="icon-btn end-session-btn" title="End session" aria-label="End session">
                        <span class="codicon codicon-debug-stop"></span>
                    </button>
                    <button id="send-btn" title="Send message" aria-label="Send message">
                        <span class="codicon codicon-arrow-up"></span>
                    </button>
                </div>
            </div>
        </div>
        <!-- Mode Dropdown - positioned outside input-container to avoid clipping -->
        <div class="mode-dropdown hidden" id="mode-dropdown">
            <div class="mode-option" data-mode="normal">
                <span>Normal</span>
            </div>
            <div class="mode-option" data-mode="queue">
                <span>Queue</span>
            </div>
        </div>
        </div><!-- End input-wrapper -->
        </div><!-- End input-area-container -->
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate a nonce for CSP
   */
  private _getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Parse choices from a question text.
   * Detects numbered lists (1. 2. 3.), lettered options (A. B. C.), and Option X: patterns.
   * Only detects choices near the LAST question mark "?" to avoid false positives from
   * earlier numbered/lettered content in the text.
   *
   * @param text - The question text to parse
   * @returns Array of parsed choices, empty if no choices detected
   */
  private _parseChoices(text: string): ParsedChoice[] {
    const choices: ParsedChoice[] = [];
    let match;

    // Maximum number of choices to show as buttons
    // If more options detected, return empty array (show only text input)
    const MAX_CHOICES = 9;

    // EARLY EXIT: Detect long lists before expensive parsing
    // Count potential numbered markers (1. 2. 3. etc.) - if 10+, skip buttons entirely
    const numberedMarkerCount = (text.match(/\b\d+[.)]/g) || []).length;
    if (numberedMarkerCount >= 10) {
      return []; // Too many options for button display
    }

    // Also check for lettered markers (A. B. C. etc.)
    const letteredMarkerCount = (text.match(/\b[A-Za-z][.)]\s/g) || []).length;
    if (letteredMarkerCount >= 10) {
      return []; // Too many options for button display
    }

    // Check for multiple question blocks (don't show buttons for compound questions)
    const questionBlockCount = (
      text.match(/\b(?:Question|Q)\s*\d+[.:]/gi) || []
    ).length;
    if (questionBlockCount >= 2) {
      return []; // Multiple questions - user should type combined answer
    }

    // Search the ENTIRE text for numbered/lettered lists, not just after the last "?"
    // The previous approach failed when examples within the text contained "?" characters
    // (e.g., "Example: What's your favorite language?")

    // Strategy: Find the FIRST major numbered/lettered list that starts early in the text
    // These are the actual choices, not examples or descriptions within the text

    // Split entire text into lines for multi-line patterns
    const lines = text.split("\n");

    // Pattern 1: Numbered options - lines starting with "1." or "1)" through 9
    // Also match bold numbered options like "**1. Option**"
    const numberedLinePattern = /^\s*\*{0,2}(\d+)[.)]\s*\*{0,2}\s*(.+)$/;
    const numberedLines: {
      index: number;
      num: string;
      numValue: number;
      text: string;
    }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(numberedLinePattern);
      if (m && m[2].trim().length >= 3) {
        // Clean up markdown bold markers from text
        const cleanText = m[2].replace(/\*\*/g, "").trim();
        numberedLines.push({
          index: i,
          num: m[1],
          numValue: parseInt(m[1], 10),
          text: cleanText,
        });
      }
    }

    // Find the FIRST contiguous list (which contains the main choices)
    // Previously used LAST list which missed choices when examples appeared later in text
    if (numberedLines.length >= 2) {
      // Find all list boundaries by detecting number restarts
      const listBoundaries: number[] = [0]; // First list starts at index 0

      for (let i = 1; i < numberedLines.length; i++) {
        const prevNum = numberedLines[i - 1].numValue;
        const currNum = numberedLines[i].numValue;
        const lineGap = numberedLines[i].index - numberedLines[i - 1].index;

        // Detect a new list if:
        // 1. Number resets (e.g., 2 -> 1, or any case where current < previous)
        // 2. Large gap between lines (> 5 lines typically means different section)
        if (currNum <= prevNum || lineGap > 5) {
          listBoundaries.push(i);
        }
      }

      // Get the FIRST list (the main choices list)
      // The first numbered list is typically the actual choices
      // Later lists are often examples or descriptions within each choice
      const firstListEnd =
        listBoundaries.length > 1 ? listBoundaries[1] : numberedLines.length;
      const firstGroup = numberedLines.slice(0, firstListEnd);

      if (firstGroup.length >= 2) {
        for (const m of firstGroup) {
          let cleanText = m.text.replace(/[?!]+$/, "").trim();
          const displayText =
            cleanText.length > 40
              ? cleanText.substring(0, 37) + "..."
              : cleanText;
          // Extract clean keyword before separators (e.g., "Yes — description" → "Yes")
          const sepMatch = cleanText.match(/^(.+?)\s*(?:—|–|[-:])\s+/);
          const keywordDisplay =
            sepMatch && sepMatch[1].trim().length <= 20
              ? sepMatch[1].trim()
              : undefined;
          const shortDisplay =
            keywordDisplay ||
            (cleanText.length > 20
              ? cleanText.substring(0, 17) + "..."
              : cleanText);
          choices.push({
            label: displayText,
            value: m.num,
            shortLabel: shortDisplay,
          });
        }
        return choices.length > MAX_CHOICES ? [] : choices;
      }
    }

    // Pattern 1b: Inline numbered lists "1. option 2. option 3. option" or "1 - option 2 - option"
    // Use a lookahead that also stops at sentence-ending patterns (e.g., ". Wait") for the last option
    const inlineNumberedPattern =
      /(\d+)(?:[.):]|\s+-)\s+([^0-9]+?)(?=\s+\d+(?:[.):]|\s+-)|[.!]\s+(?:Wait|wait|Please|please|Then|then|Select|select)|[.?!]\s*$|$)/g;
    const inlineNumberedMatches: { num: string; text: string }[] = [];

    // Only try inline if no multi-line matches found
    // Use full text converted to single line
    const singleLine = text.replace(/\n/g, " ");
    while ((match = inlineNumberedPattern.exec(singleLine)) !== null) {
      const optionText = match[2].trim();
      if (optionText.length >= 3) {
        inlineNumberedMatches.push({ num: match[1], text: optionText });
      }
    }

    if (inlineNumberedMatches.length >= 2) {
      for (const m of inlineNumberedMatches) {
        let cleanText = m.text.replace(/[?!]+$/, "").trim();
        const displayText =
          cleanText.length > 40
            ? cleanText.substring(0, 37) + "..."
            : cleanText;
        const shortDisplay =
          cleanText.length > 20
            ? cleanText.substring(0, 17) + "..."
            : cleanText;
        choices.push({
          label: displayText,
          value: m.num,
          shortLabel: shortDisplay,
        });
      }
      return choices.length > MAX_CHOICES ? [] : choices;
    }

    // Pattern 1c: Emoji numbered options (1️⃣, 2️⃣, etc.)
    // Emoji keycaps: digit + variation selector (FE0F) + combining enclosing keycap (20E3)
    const emojiNumberPattern = /^\s*([0-9])\uFE0F?\u20E3\s+(.+)$/;
    const emojiLines: { index: number; num: string; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(emojiNumberPattern);
      if (m && m[2].trim().length >= 3) {
        const cleanText = m[2].replace(/\*\*/g, "").trim();
        emojiLines.push({ index: i, num: m[1], text: cleanText });
      }
    }
    if (emojiLines.length >= 2) {
      // Find contiguous emoji list (first group)
      const listBoundaries: number[] = [0];
      for (let i = 1; i < emojiLines.length; i++) {
        const gap = emojiLines[i].index - emojiLines[i - 1].index;
        if (gap > 3) {
          listBoundaries.push(i);
        }
      }

      const firstListEnd =
        listBoundaries.length > 1 ? listBoundaries[1] : emojiLines.length;
      const firstGroup = emojiLines.slice(0, firstListEnd);

      if (firstGroup.length >= 2) {
        for (const m of firstGroup) {
          let cleanText = m.text.replace(/[?!]+$/, "").trim();
          const displayText =
            cleanText.length > 40
              ? cleanText.substring(0, 37) + "..."
              : cleanText;
          const shortDisplay =
            cleanText.length > 20
              ? cleanText.substring(0, 17) + "..."
              : cleanText;
          choices.push({
            label: displayText,
            value: m.num,
            shortLabel: shortDisplay,
          });
        }
        return choices.length > MAX_CHOICES ? [] : choices;
      }
    }

    // Pattern 1d: Inline emoji numbered options "1️⃣ Dark 2️⃣ Light 3️⃣ System"
    // Emoji keycaps: digit + optional variation selector (FE0F) + combining enclosing keycap (20E3)
    // Lookahead stops at: another emoji number, OR sentence-ending patterns like ". Wait", ". Please", etc.
    const inlineEmojiPattern =
      /([0-9])\uFE0F?\u20E3\s+([^0-9\uFE0F\u20E3]+?)(?=\s*[0-9]\uFE0F?\u20E3|[.!]\s+(?:Wait|wait|Please|please|Then|then|Select|select)|[.?!]\s*$)/g;
    const inlineEmojiMatches: { num: string; text: string }[] = [];

    while ((match = inlineEmojiPattern.exec(singleLine)) !== null) {
      const optionText = match[2].trim();
      if (optionText.length >= 2) {
        inlineEmojiMatches.push({ num: match[1], text: optionText });
      }
    }

    if (inlineEmojiMatches.length >= 2) {
      for (const m of inlineEmojiMatches) {
        let cleanText = m.text.replace(/[?!]+$/, "").trim();
        const displayText =
          cleanText.length > 40
            ? cleanText.substring(0, 37) + "..."
            : cleanText;
        const shortDisplay =
          cleanText.length > 20
            ? cleanText.substring(0, 17) + "..."
            : cleanText;
        choices.push({
          label: displayText,
          value: m.num,
          shortLabel: shortDisplay,
        });
      }
      return choices.length > MAX_CHOICES ? [] : choices;
    }

    // Pattern 2: Lettered options - lines starting with "A." or "A)" or "**A)" through Z
    // Also match bold lettered options like "**A) Option**"
    // FIX: Search entire text, not just after question mark
    const letteredLinePattern = /^\s*\*{0,2}([A-Za-z])[.)]\s*\*{0,2}\s*(.+)$/;
    const letteredLines: { index: number; letter: string; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(letteredLinePattern);
      if (m && m[2].trim().length >= 3) {
        // Clean up markdown bold markers from text
        const cleanText = m[2].replace(/\*\*/g, "").trim();
        letteredLines.push({
          index: i,
          letter: m[1].toUpperCase(),
          text: cleanText,
        });
      }
    }

    if (letteredLines.length >= 2) {
      // Find all list boundaries by detecting letter restarts or gaps
      const listBoundaries: number[] = [0];

      for (let i = 1; i < letteredLines.length; i++) {
        const gap = letteredLines[i].index - letteredLines[i - 1].index;
        // Detect new list if gap > 3 lines
        if (gap > 3) {
          listBoundaries.push(i);
        }
      }

      // Get the FIRST list (the main choices list)
      const firstListEnd =
        listBoundaries.length > 1 ? listBoundaries[1] : letteredLines.length;
      const firstGroup = letteredLines.slice(0, firstListEnd);

      if (firstGroup.length >= 2) {
        for (const m of firstGroup) {
          let cleanText = m.text.replace(/[?!]+$/, "").trim();
          const displayText =
            cleanText.length > 40
              ? cleanText.substring(0, 37) + "..."
              : cleanText;
          const shortDisplay =
            cleanText.length > 20
              ? cleanText.substring(0, 17) + "..."
              : cleanText;
          choices.push({
            label: displayText,
            value: m.letter,
            shortLabel: shortDisplay,
          });
        }
        return choices.length > MAX_CHOICES ? [] : choices;
      }
    }

    // Pattern 2b: Inline lettered "A. option B. option C. option"
    // Only match single uppercase letters to avoid false positives
    // Use .+? (not [^A-Z]+?) so option text starting with uppercase letters (e.g., "Apple") is matched
    const inlineLetteredPattern = /\b([A-Z])[.)]\s+(.+?)(?=\s+[A-Z][.)]|$)/g;
    const inlineLetteredMatches: { letter: string; text: string }[] = [];

    while ((match = inlineLetteredPattern.exec(singleLine)) !== null) {
      const optionText = match[2].trim();
      if (optionText.length >= 3) {
        inlineLetteredMatches.push({ letter: match[1], text: optionText });
      }
    }

    if (inlineLetteredMatches.length >= 2) {
      for (const m of inlineLetteredMatches) {
        let cleanText = m.text.replace(/[?!]+$/, "").trim();
        const displayText =
          cleanText.length > 40
            ? cleanText.substring(0, 37) + "..."
            : cleanText;
        const shortDisplay =
          cleanText.length > 20
            ? cleanText.substring(0, 17) + "..."
            : cleanText;
        choices.push({
          label: displayText,
          value: m.letter,
          shortLabel: shortDisplay,
        });
      }
      return choices.length > MAX_CHOICES ? [] : choices;
    }

    // Pattern 2c: Bullet-point options - lines starting with "- ", "* ", or "• "
    // Common in markdown and rich text copy-paste
    const bulletLinePattern = /^\s*[-*•]\s+(.+)$/;
    const bulletLines: { index: number; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(bulletLinePattern);
      if (m && m[1].trim().length >= 3) {
        // Skip lines that look like list item descriptions rather than choices
        // (e.g., nested explanatory bullets in a larger context)
        const cleanText = m[1].replace(/\*\*/g, "").trim();
        bulletLines.push({ index: i, text: cleanText });
      }
    }

    if (bulletLines.length >= 2) {
      // Find contiguous bullet list (first group)
      const listBoundaries: number[] = [0];
      for (let i = 1; i < bulletLines.length; i++) {
        const gap = bulletLines[i].index - bulletLines[i - 1].index;
        if (gap > 3) {
          listBoundaries.push(i);
        }
      }

      const firstListEnd =
        listBoundaries.length > 1 ? listBoundaries[1] : bulletLines.length;
      const firstGroup = bulletLines.slice(0, firstListEnd);

      if (firstGroup.length >= 2) {
        for (let idx = 0; idx < firstGroup.length; idx++) {
          const m = firstGroup[idx];
          let cleanText = m.text.replace(/[?!]+$/, "").trim();
          const displayText =
            cleanText.length > 40
              ? cleanText.substring(0, 37) + "..."
              : cleanText;
          // For bullet points, extract clean keyword before separators (e.g., "Yes — description" → "Yes")
          const sepMatch = cleanText.match(/^(.+?)\s*(?:—|–|[-:])\s+/);
          const keywordDisplay =
            sepMatch && sepMatch[1].trim().length <= 20
              ? sepMatch[1].trim()
              : undefined;
          const shortDisplay =
            keywordDisplay ||
            (cleanText.length > 20
              ? cleanText.substring(0, 17) + "..."
              : cleanText);
          choices.push({
            label: displayText,
            value: cleanText, // Use actual text as value for bullet points
            shortLabel: shortDisplay, // Show actual option text on button
          });
        }
        return choices.length > MAX_CHOICES ? [] : choices;
      }
    }

    // Pattern 2d: Inline bullet options "- item1 - item2 - item3"
    // Common in conversational prompts like "Database? - PostgreSQL - MongoDB - SQLite"
    // Use a split-based approach instead of complex regex for reliability

    // Check if there's a question/colon followed by bullet items
    const bulletSectionMatch = singleLine.match(
      /[?:]\s*(-\s+.+?)(?:\.\s*(?:Wait|wait|Please|please)|[.?!]?\s*$)/,
    );
    if (bulletSectionMatch) {
      const bulletSection = bulletSectionMatch[1];
      // Split by " - " to get individual items, then strip any leading "- " from first part
      const bulletParts = bulletSection
        .split(/\s+-\s+/)
        .map((p) => p.replace(/^-\s*/, ""));
      const inlineBulletMatches: { text: string }[] = [];

      for (const part of bulletParts) {
        const trimmed = part.trim();
        // Skip empty parts and common filler words
        if (
          trimmed.length >= 2 &&
          !/^(wait|please|response|for|choice|select)/i.test(trimmed)
        ) {
          inlineBulletMatches.push({ text: trimmed });
        }
      }

      if (inlineBulletMatches.length >= 2) {
        for (const m of inlineBulletMatches) {
          let cleanText = m.text.replace(/[?!]+$/, "").trim();
          const displayText =
            cleanText.length > 40
              ? cleanText.substring(0, 37) + "..."
              : cleanText;
          const shortDisplay =
            cleanText.length > 20
              ? cleanText.substring(0, 17) + "..."
              : cleanText;
          choices.push({
            label: displayText,
            value: cleanText, // Use actual text as value for bullet points
            shortLabel: shortDisplay, // Show actual option text on button
          });
        }
        return choices.length > MAX_CHOICES ? [] : choices;
      }
    }

    // Pattern 3: "Option A:" or "Option 1:" style (supports multi-digit numbers like Option 10)
    // Search entire text for this pattern
    const optionPattern =
      /option\s+([A-Za-z]|\d+)\s*:\s*([^O\n]+?)(?=\s*Option\s+(?:[A-Za-z]|\d+)|\s*$|\n)/gi;
    const optionMatches: { id: string; text: string }[] = [];

    while ((match = optionPattern.exec(text)) !== null) {
      const optionText = match[2].trim();
      if (optionText.length >= 3) {
        optionMatches.push({ id: match[1].toUpperCase(), text: optionText });
      }
    }

    if (optionMatches.length >= 2) {
      for (const m of optionMatches) {
        let cleanText = m.text.replace(/[?!]+$/, "").trim();
        const displayText =
          cleanText.length > 40
            ? cleanText.substring(0, 37) + "..."
            : cleanText;
        choices.push({
          label: displayText,
          value: `Option ${m.id}`,
          shortLabel: m.id,
        });
      }
      return choices.length > MAX_CHOICES ? [] : choices;
    }

    // Pattern 4: Comma-separated options with "or" conjunction
    // Matches patterns like "PostgreSQL, MySQL, or SQLite" after trigger verbs
    // e.g., "Would you like PostgreSQL, MySQL, or SQLite?"
    // e.g., "Choose between React, Vue, or Angular"
    // e.g., "Which do you prefer: Python, JavaScript, or Go?"
    const commaOrPattern =
      /(?:choose|pick|select|prefer|like|want|use|between|recommend)\s+(?:between\s+)?(.+?)(?:\?|$)/i;
    const commaOrMatch = singleLine.match(commaOrPattern);
    if (commaOrMatch) {
      // Strip common preposition/verb prefixes that get captured before the actual options
      // e.g., "to use PostgreSQL, MySQL" → "PostgreSQL, MySQL"
      // e.g., "go with React, Vue" → "React, Vue"
      const optionsText = commaOrMatch[1].replace(
        /^(?:to\s+)?(?:use|go\s+with|try|pick|select|choose|have|work\s+with)\s+/i,
        "",
      );
      // Split by ", " with optional "or" before last item, or " or "
      const parts = optionsText
        .split(/,\s*(?:or\s+)?|\s+or\s+/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 60);
      if (parts.length >= 2 && parts.length <= MAX_CHOICES) {
        for (const part of parts) {
          const cleanText = part.replace(/[?!]+$/, "").trim();
          if (cleanText.length === 0) continue;
          const shortDisplay =
            cleanText.length > 20
              ? cleanText.substring(0, 17) + "..."
              : cleanText;
          choices.push({
            label: cleanText,
            value: cleanText,
            shortLabel: shortDisplay,
          });
        }
        if (choices.length >= 2) {
          return choices.length > MAX_CHOICES ? [] : choices;
        }
        // Reset if we didn't get enough valid choices
        choices.length = 0;
      }
    }

    return choices;
  }

  /**
   * Detect if a question is an approval/confirmation type that warrants quick action buttons.
   * Uses NLP patterns to identify yes/no questions, permission requests, and confirmations.
   *
   * @param text - The question text to analyze
   * @returns true if the question is an approval-type question
   */
  private _isApprovalQuestion(text: string): boolean {
    const lowerText = text.toLowerCase();

    // NEGATIVE patterns - questions that require specific input (NOT approval questions)
    const requiresSpecificInput = [
      // Generic "select/choose an option" prompts - these need specific choice, not yes/no
      /please (?:select|choose|pick) (?:an? )?option/i,
      /select (?:an? )?option/i,
      // Open-ended requests for feedback/information
      /let me know/i,
      /tell me (?:what|how|when|if|about)/i,
      /waiting (?:for|on) (?:your|the)/i,
      /ready to (?:hear|see|get|receive)/i,
      // Questions asking for specific information
      /what (?:is|are|should|would)/i,
      /which (?:one|file|option|method|approach)/i,
      /where (?:should|would|is|are)/i,
      /how (?:should|would|do|can)/i,
      /when (?:should|would)/i,
      /who (?:should|would)/i,
      // Questions asking for names, values, content
      /(?:enter|provide|specify|give|type|input|write)\s+(?:a|the|your)/i,
      /what.*(?:name|value|path|url|content|text|message)/i,
      /please (?:enter|provide|specify|give|type)/i,
      // Open-ended questions
      /describe|explain|elaborate|clarify/i,
      /tell me (?:about|more|how)/i,
      /what do you (?:think|want|need|prefer)/i,
      /any (?:suggestions|recommendations|preferences|thoughts)/i,
      // Questions with multiple choice indicators (not binary)
      /choose (?:from|between|one of)/i,
      /select (?:from|one of|which)/i,
      /pick (?:one|from|between)/i,
      // Numbered options (1. 2. 3. or 1) 2) 3))
      /\n\s*[1-9][.)]\s+\S/i,
      // Lettered options (A. B. C. or a) b) c) or Option A/B/C)
      /\n\s*[a-d][.)]\s+\S/i,
      /option\s+[a-d]\s*:/i,
      // Bullet-point options (- item, * item, • item)
      /\n\s*[-*•]\s+\S/i,
      // Emoji numbered options (1️⃣, 2️⃣, etc.)
      /\n\s*[0-9]\uFE0F?\u20E3\s+\S/i,
      // "Would you like me to:" followed by list
      /would you like (?:me to|to):\s*\n/i,
      // ASCII art boxes/mockups (common patterns)
      /[┌├└│┐┤┘─╔╠╚║╗╣╝═]/,
      /\[.+\]\s+\[.+\]/i, // Multiple bracketed options like [Approve] [Reject]
      // "Something else?" at the end of a list typically means multi-choice
      /\d+[.)]\s+something else\??/i,
    ];

    // Check if question requires specific input - if so, NOT an approval question
    for (const pattern of requiresSpecificInput) {
      if (pattern.test(lowerText)) {
        return false;
      }
    }

    // Also check for numbered lists anywhere in text (strong indicator of multi-choice)
    const numberedListCount = (text.match(/\n\s*\d+[.)]\s+/g) || []).length;
    if (numberedListCount >= 2) {
      return false; // Multiple numbered items = multi-choice question
    }

    // POSITIVE patterns - approval/confirmation questions
    const approvalPatterns = [
      // Direct yes/no question patterns
      /^(?:shall|should|can|could|may|would|will|do|does|did|is|are|was|were|have|has|had)\s+(?:i|we|you|it|this|that)\b/i,
      // Permission/confirmation phrases (require ? at end to avoid matching plain text)
      /(?:proceed|continue|go ahead|start|begin|execute|run|apply|commit|save|delete|remove|create|add|update|modify|change|overwrite|replace).*\?$/i,
      /(?:ok|okay|alright|ready|confirm|approve|accept|allow|enable|disable|skip|ignore|dismiss|close|cancel|abort|stop|exit|quit).*\?$/i,
      // Question endings that suggest yes/no (more specific than generic \?$)
      /(?:right|correct|yes|no)\s*\?$/i,
      /(?:is that|does that|would that|should that)\s+(?:ok|okay|work|help|be\s+(?:ok|fine|good|acceptable))/i,
      // Explicit approval requests
      /(?:do you want|would you like|shall i|should i|can i|may i|could i)/i,
      /(?:want me to|like me to|need me to)/i,
      /(?:approve|confirm|authorize|permit|allow)\s+(?:this|the|these)/i,
      // Binary choice indicators
      /(?:yes or no|y\/n|yes\/no|\[y\/n\]|\(y\/n\))/i,
      // Action confirmation patterns
      /(?:are you sure|do you confirm|please confirm|confirm that)/i,
      /(?:this will|this would|this is going to)/i,
    ];

    // Check if any approval pattern matches
    for (const pattern of approvalPatterns) {
      if (pattern.test(lowerText)) {
        return true;
      }
    }

    // Additional heuristic: short questions ending with ? are likely yes/no
    if (
      lowerText.length < this._SHORT_QUESTION_THRESHOLD &&
      lowerText.trim().endsWith("?")
    ) {
      // But exclude questions with interrogative words that typically need specific answers
      const interrogatives =
        /^(?:what|which|where|when|why|how|who|whom|whose)\b/i;
      if (!interrogatives.test(lowerText.trim())) {
        return true;
      }
    }

    return false;
  }
}
