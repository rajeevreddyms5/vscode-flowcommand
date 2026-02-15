import * as vscode from "vscode";
import {
  PlanReviewOptions,
  PlanReviewPanelResult,
  PlanReviewFromWebviewMessage,
  RequiredPlanRevision,
} from "./types";

/**
 * Webview Panel for reviewing and approving AI plans.
 * Opens as a document-like panel in the center of VS Code.
 * Users can approve, approve with comments, or request changes.
 */
export class PlanReviewPanel {
  public static readonly viewType = "flowcommandPlanReview";

  /** Track open panels by interaction ID */
  private static panels: Map<string, PlanReviewPanel> = new Map();

  private _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _resolveResult: ((result: PlanReviewPanelResult) => void) | null =
    null;
  private _comments: RequiredPlanRevision[] = [];
  private _planContent: string;
  private _planTitle: string;
  private _interactionId: string;
  private _extensionUri: vscode.Uri;

  private constructor(extensionUri: vscode.Uri, options: PlanReviewOptions) {
    this._extensionUri = extensionUri;
    this._planContent = options.plan;
    this._planTitle = options.title;
    this._interactionId = options.interactionId;
    this._comments = options.existingComments || [];

    const panelTitle = `Review: ${options.title}`;

    this._panel = vscode.window.createWebviewPanel(
      PlanReviewPanel.viewType,
      panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    // Set HTML content
    this._panel.webview.html = this._getHtmlContent();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message: PlanReviewFromWebviewMessage) => this._handleMessage(message),
      null,
      this._disposables,
    );

    // Handle panel disposal
    this._panel.onDidDispose(() => this._onDispose(), null, this._disposables);

    // Track this panel
    PlanReviewPanel.panels.set(options.interactionId, this);

    // Explicitly reveal and focus the panel (ensures autofocus)
    this._panel.reveal(vscode.ViewColumn.One, false);
  }

  /**
   * Show a plan review panel and wait for user action.
   * Returns a promise that resolves when the user approves, rejects, or closes.
   */
  public static async showWithOptions(
    extensionUri: vscode.Uri,
    options: PlanReviewOptions,
  ): Promise<PlanReviewPanelResult> {
    // Close existing panel for same interaction if any
    const existing = PlanReviewPanel.panels.get(options.interactionId);
    if (existing) {
      existing.dispose();
    }

    const panel = new PlanReviewPanel(extensionUri, options);

    return new Promise<PlanReviewPanelResult>((resolve) => {
      panel._resolveResult = resolve;
    });
  }

  /**
   * Close panel if it's open for a given interaction ID
   */
  public static closeIfOpen(interactionId: string): void {
    const panel = PlanReviewPanel.panels.get(interactionId);
    if (panel) {
      panel.dispose();
    }
  }

  /**
   * Resolve a plan review from an external source (e.g., remote server).
   * Closes the local panel and resolves the promise with the given result.
   */
  public static resolveExternally(
    interactionId: string,
    result: PlanReviewPanelResult,
  ): boolean {
    const panel = PlanReviewPanel.panels.get(interactionId);
    if (panel && panel._resolveResult) {
      panel._resolveAndClose(result);
      return true;
    }
    return false;
  }

  /**
   * Handle messages from the webview
   */
  private _handleMessage(message: PlanReviewFromWebviewMessage): void {
    switch (message.type) {
      case "ready":
        // Send the plan content to the webview
        this._panel.webview.postMessage({
          type: "showPlan",
          content: this._planContent,
          title: this._planTitle,
          readOnly: false,
          comments: this._comments,
        });
        break;

      case "approve":
        this._comments = message.comments || [];
        this._resolveAndClose({
          action: "approved",
          requiredRevisions: [],
        });
        break;

      case "approveWithComments":
        this._comments = message.comments || [];
        this._resolveAndClose({
          action: "approvedWithComments",
          requiredRevisions: this._comments,
        });
        break;

      case "reject":
        this._comments = message.comments || [];
        this._resolveAndClose({
          action: "recreateWithChanges",
          requiredRevisions: this._comments,
        });
        break;

      case "close":
        this._comments = message.comments || [];
        this._resolveAndClose({
          action: "closed",
          requiredRevisions: this._comments,
        });
        break;

      case "exportPlan":
        this._exportPlan();
        break;
    }
  }

  /**
   * Export plan to a markdown file
   */
  private async _exportPlan(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    let content = `# ${this._planTitle}\n\n`;
    content += `**Date:** ${new Date().toLocaleString()}\n\n`;
    content += `---\n\n`;
    content += this._planContent;

    if (this._comments.length > 0) {
      content += `\n\n---\n\n## Comments\n\n`;
      for (const comment of this._comments) {
        content += `### On: "${comment.revisedPart}"\n`;
        content += `${comment.revisorInstructions}\n\n`;
      }
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        `${this._planTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`,
      ),
      filters: { Markdown: ["md"] },
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      vscode.window.showInformationMessage("Plan exported successfully");
    }
  }

  /**
   * Resolve the result promise and close the panel
   */
  private _resolveAndClose(result: PlanReviewPanelResult): void {
    if (this._resolveResult) {
      this._resolveResult(result);
      this._resolveResult = null;
    }
    this.dispose();
  }

  /**
   * Handle panel disposal
   */
  private _onDispose(): void {
    // If no result was provided (user closed the panel), resolve with 'closed'
    if (this._resolveResult) {
      this._resolveResult({
        action: "closed",
        requiredRevisions: this._comments,
      });
      this._resolveResult = null;
    }

    // Remove from tracked panels
    PlanReviewPanel.panels.delete(this._interactionId);

    // Dispose all disposables
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  /**
   * Dispose the panel
   */
  public dispose(): void {
    this._panel.dispose();
  }

  /**
   * Generate the HTML content for the webview
   */
  private _getHtmlContent(): string {
    const webview = this._panel.webview;
    const mediaUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media"),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "codicon.css"),
    );
    const nonce = getNonce();

    const primaryLabel = "Approve";
    const primaryAction = "approve";
    const secondaryLabel = "Request Changes";
    const secondaryAction = "reject";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <link href="${codiconUri}" rel="stylesheet">
    <title>${escapeHtml(this._planTitle)}</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.3)));
            --accent: var(--vscode-textLink-foreground, #3794ff);
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --btn-hover: var(--vscode-button-hoverBackground);
            --btn-secondary-bg: var(--vscode-button-secondaryBackground);
            --btn-secondary-fg: var(--vscode-button-secondaryForeground);
            --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border, var(--border));
            --comment-bg: var(--vscode-editorGutter-commentRangeForeground, rgba(255, 200, 0, 0.1));
            --hover-bg: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1));
            --code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size, 13px);
            color: var(--fg);
            background: var(--bg);
            padding: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* Header */
        .plan-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
            gap: 12px;
        }

        .plan-title {
            font-size: 16px;
            font-weight: 600;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .plan-mode-badge {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            background: var(--accent);
            color: var(--btn-fg);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            flex-shrink: 0;
        }

        .header-actions {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        }

        .icon-btn {
            background: none;
            border: none;
            color: var(--fg);
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 4px;
            opacity: 0.7;
        }

        .icon-btn:hover { opacity: 1; background: var(--hover-bg); }

        /* Main content area - horizontal split 70/30 */
        .main-area {
            flex: 1;
            display: flex;
            flex-direction: row;
            overflow: hidden;
        }

        .plan-content {
            flex: 7;
            overflow-y: auto;
            padding: 20px 24px;
            line-height: 1.6;
            border-right: 1px solid var(--border);
        }

        /* Markdown styles */
        .plan-content h1 { font-size: 1.6em; margin: 16px 0 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
        .plan-content h2 { font-size: 1.4em; margin: 14px 0 6px; }
        .plan-content h3 { font-size: 1.2em; margin: 12px 0 6px; }
        .plan-content h4 { font-size: 1.1em; margin: 10px 0 4px; }
        .plan-content p { margin: 6px 0; }
        .plan-content ul, .plan-content ol { padding-left: 24px; margin: 6px 0; }
        .plan-content li { margin: 3px 0; }
        .plan-content hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
        .plan-content blockquote { border-left: 3px solid var(--accent); padding: 6px 12px; margin: 8px 0; opacity: 0.85; }
        .plan-content table { border-collapse: collapse; margin: 8px 0; width: 100%; }
        .plan-content th, .plan-content td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
        .plan-content th { background: var(--code-bg); font-weight: 600; }

        .plan-content code {
            background: var(--code-bg);
            padding: 1px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: 0.9em;
        }

        .plan-content pre {
            background: var(--code-bg);
            padding: 12px 16px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
        }

        .plan-content pre code {
            background: none;
            padding: 0;
        }

        /* Commentable sections - hoverable with comment icon */
        .line-wrapper {
            position: relative;
            padding: 2px 0 2px 28px;
            border-radius: 4px;
            transition: background 0.15s;
        }

        .line-wrapper:hover {
            background: var(--hover-bg);
        }

        .line-wrapper .comment-icon {
            position: absolute;
            left: 2px;
            top: 50%;
            transform: translateY(-50%);
            opacity: 0;
            cursor: pointer;
            background: none;
            border: none;
            color: var(--accent);
            padding: 2px;
            border-radius: 3px;
            transition: opacity 0.15s;
            font-size: 14px;
        }

        .line-wrapper:hover .comment-icon {
            opacity: 0.7;
        }

        .line-wrapper .comment-icon:hover {
            opacity: 1;
            background: var(--hover-bg);
        }

        .line-wrapper.has-comment {
            background: var(--comment-bg);
            border-left: 3px solid var(--accent);
            padding-left: 25px;
        }

        .line-wrapper.has-comment .comment-icon {
            opacity: 1;
            color: var(--accent);
        }

        /* Comments sidebar - 30% width */
        .comments-section {
            flex: 3;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 200px;
            max-width: 400px;
        }

        .comments-header {
            font-weight: 600;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
        }

        .comments-count {
            font-size: 11px;
            background: var(--accent);
            color: var(--btn-fg);
            padding: 1px 6px;
            border-radius: 8px;
        }

        .clear-all-btn {
            margin-left: auto;
            font-size: 11px;
            background: none;
            border: none;
            color: var(--accent);
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 3px;
        }

        .clear-all-btn:hover {
            background: var(--hover-bg);
        }

        .comments-list-container {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
        }

        .comment-item {
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 6px;
        }

        .comment-citation {
            font-size: 11px;
            opacity: 0.7;
            margin-bottom: 4px;
            font-style: italic;
            border-left: 2px solid var(--accent);
            padding-left: 8px;
        }

        .comment-text {
            font-size: 12px;
        }

        .comment-actions {
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }

        .comment-action-btn {
            font-size: 11px;
            background: none;
            border: none;
            color: var(--accent);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 3px;
        }

        .comment-action-btn:hover {
            background: var(--hover-bg);
        }

        /* Comment dialog */
        .comment-dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px;
            width: min(500px, 90vw);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            z-index: 1000;
            display: none;
        }

        .comment-dialog.visible { display: block; }

        .comment-dialog-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.3);
            z-index: 999;
            display: none;
        }

        .comment-dialog-overlay.visible { display: block; }

        .comment-dialog h3 {
            font-size: 14px;
            margin-bottom: 8px;
        }

        .comment-dialog .citation-preview {
            font-size: 11px;
            opacity: 0.7;
            font-style: italic;
            border-left: 2px solid var(--accent);
            padding-left: 8px;
            margin-bottom: 10px;
            max-height: 60px;
            overflow: hidden;
        }

        .comment-dialog textarea {
            width: 100%;
            min-height: 80px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            padding: 8px;
            font-family: inherit;
            font-size: 13px;
            resize: vertical;
        }

        .comment-dialog textarea:focus {
            outline: 1px solid var(--accent);
        }

        .comment-dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 10px;
        }

        /* Footer with action buttons */
        .plan-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-top: 1px solid var(--border);
            flex-shrink: 0;
            gap: 12px;
        }

        .footer-info {
            font-size: 12px;
            opacity: 0.7;
        }

        .footer-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 6px 16px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-family: inherit;
            transition: background 0.15s;
        }

        .btn-primary {
            background: var(--btn-bg);
            color: var(--btn-fg);
        }

        .btn-primary:hover { background: var(--btn-hover); }

        .btn-secondary {
            background: var(--btn-secondary-bg);
            color: var(--btn-secondary-fg);
        }

        .btn-secondary:hover { background: var(--btn-secondary-hover); }

        .btn-secondary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary.requires-comments:disabled::after {
            content: ' (add comments first)';
            font-size: 11px;
        }

        .btn-cancel {
            background: transparent;
            color: var(--vscode-descriptionForeground, #888);
            border: 1px solid var(--vscode-input-border, #444);
        }

        .btn-cancel:hover {
            background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
            color: var(--vscode-errorForeground, #f44);
            border-color: var(--vscode-inputValidation-errorBorder, #f44);
        }

        /* No comments message */
        .no-comments {
            font-size: 12px;
            opacity: 0.5;
            font-style: italic;
        }

        /* Read-only banner */
        .readonly-banner {
            background: var(--comment-bg);
            padding: 8px 20px;
            font-size: 12px;
            text-align: center;
            border-bottom: 1px solid var(--border);
            display: none;
        }

        .readonly-banner.visible { display: block; }
    </style>
</head>
<body>
    <div class="plan-header">
        <span class="plan-title" id="plan-title">${escapeHtml(this._planTitle)}</span>
        <span class="plan-mode-badge">Review</span>
        <div class="header-actions">
            <button class="icon-btn" id="export-btn" title="Export plan as markdown">
                <span class="codicon codicon-export"></span>
            </button>
        </div>
    </div>

    <div class="readonly-banner" id="readonly-banner">
        This plan is in read-only mode.
    </div>

    <div class="main-area">
        <div class="plan-content" id="plan-content">
            <p style="opacity: 0.5;">Loading plan...</p>
        </div>

        <div class="comments-section" id="comments-section">
            <div class="comments-header">
                <span>Comments</span>
                <span class="comments-count" id="comments-count">0</span>
                <button class="clear-all-btn" id="clear-all-btn" title="Clear all comments" style="display: none;">Clear All</button>
            </div>
            <div class="comments-list-container" id="comments-list">
                <div class="no-comments" id="no-comments">No comments yet. Hover over a section and click the comment icon to add feedback.</div>
            </div>
        </div>
    </div>

    <div class="comment-dialog-overlay" id="comment-dialog-overlay"></div>
    <div class="comment-dialog" id="comment-dialog">
        <h3 id="dialog-title">Add Comment</h3>
        <div class="citation-preview" id="citation-preview"></div>
        <textarea id="comment-input" placeholder="Enter your feedback or revision instructions..."></textarea>
        <div class="comment-dialog-actions">
            <button class="btn btn-secondary" id="dialog-cancel">Cancel</button>
            <button class="btn btn-primary" id="dialog-save">Save</button>
        </div>
    </div>

    <div class="plan-footer">
        <div class="footer-info" id="footer-info">
            Review the plan above, then approve or request changes.
        </div>
        <div class="footer-actions">
            <button class="btn btn-cancel" id="cancel-btn">Cancel</button>
            <button class="btn btn-secondary requires-comments" id="secondary-btn" data-action="${secondaryAction}" disabled>
                ${secondaryLabel}
            </button>
            <button class="btn btn-primary" id="primary-btn" data-action="${primaryAction}">
                ${primaryLabel}
            </button>
        </div>
    </div>

    <script nonce="${nonce}">
    (function() {
        const vscode = acquireVsCodeApi();

        // State
        let comments = [];
        let currentCitation = '';
        let editingIndex = -1;
        let isReadOnly = false;

        // DOM elements
        const planContent = document.getElementById('plan-content');
        const commentsList = document.getElementById('comments-list');
        const commentsCount = document.getElementById('comments-count');
        const clearAllBtn = document.getElementById('clear-all-btn');
        const noComments = document.getElementById('no-comments');
        const commentDialog = document.getElementById('comment-dialog');
        const commentDialogOverlay = document.getElementById('comment-dialog-overlay');
        const dialogTitle = document.getElementById('dialog-title');
        const citationPreview = document.getElementById('citation-preview');
        const commentInput = document.getElementById('comment-input');
        const dialogCancel = document.getElementById('dialog-cancel');
        const dialogSave = document.getElementById('dialog-save');
        const primaryBtn = document.getElementById('primary-btn');
        const secondaryBtn = document.getElementById('secondary-btn');
        const cancelBtn = document.getElementById('cancel-btn');
        const exportBtn = document.getElementById('export-btn');
        const readonlyBanner = document.getElementById('readonly-banner');

        // Basic escaping
        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        // Simple markdown to HTML conversion
        function renderMarkdown(text) {
            if (!text) return '';

            var processedText = text.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');

            // Extract code blocks first
            var codeBlocks = [];
            processedText = processedText.replace(/\`\`\`(\\w*)\\s*\\n?([\\s\\S]*?)\`\`\`/g, function(match, lang, code) {
                var index = codeBlocks.length;
                codeBlocks.push({ lang: lang || '', code: code.trim() });
                return '%%CODEBLOCK' + index + '%%';
            });

            // Escape HTML on remaining text
            var html = escapeHtml(processedText);

            // Headers
            html = html.replace(/^######\\s+(.+)$/gm, '<h6>$1</h6>');
            html = html.replace(/^#####\\s+(.+)$/gm, '<h5>$1</h5>');
            html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
            html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
            html = html.replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>');
            html = html.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');

            // Horizontal rules
            html = html.replace(/^---+$/gm, '<hr>');

            // Blockquotes
            html = html.replace(/^&gt;\\s*(.*)$/gm, '<blockquote>$1</blockquote>');
            html = html.replace(/<\\/blockquote>\\n<blockquote>/g, '\\n');

            // Bold and italic
            html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
            html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

            // Inline code (single backticks, must be after code block extraction)
            html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Lists
            html = html.replace(/^[-*]\\s+(.+)$/gm, '<li>$1</li>');
            html = html.replace(/(<li>.*<\\/li>\\n?)+/g, function(match) {
                return '<ul>' + match.replace(/\\n/g, '') + '</ul>';
            });

            // Ordered lists
            html = html.replace(/^\\d+\\.\\s+(.+)$/gm, '<oli>$1</oli>');
            html = html.replace(/(<oli>.*<\\/oli>\\n?)+/g, function(match) {
                return '<ol>' + match.replace(/<oli>/g, '<li>').replace(/<\\/oli>/g, '</li>').replace(/\\n/g, '') + '</ol>';
            });

            // Tables
            var lines = html.split('\\n');
            var result = [];
            var tableBuffer = [];
            var inTable = false;

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var isTableRow = /^\\|.+\\|$/.test(line.trim());
                if (isTableRow) {
                    tableBuffer.push(line);
                    inTable = true;
                } else {
                    if (inTable && tableBuffer.length >= 2) {
                        result.push(processTable(tableBuffer));
                    }
                    tableBuffer = [];
                    inTable = false;
                    result.push(line);
                }
            }
            if (inTable && tableBuffer.length >= 2) {
                result.push(processTable(tableBuffer));
            }
            html = result.join('\\n');

            // Restore code blocks
            for (var j = 0; j < codeBlocks.length; j++) {
                var block = codeBlocks[j];
                var langLabel = block.lang ? '<span style="opacity:0.5;font-size:11px;">' + escapeHtml(block.lang) + '</span>' : '';
                html = html.replace('%%CODEBLOCK' + j + '%%',
                    '<pre>' + langLabel + '<code>' + escapeHtml(block.code) + '</code></pre>');
            }

            // Paragraphs - wrap remaining loose text in <p> tags
            html = html.replace(/^(?!<[a-z]|%%)(.*\\S.*)$/gm, '<p>$1</p>');

            return html;
        }

        function processTable(rows) {
            if (rows.length < 2) return rows.join('\\n');
            var headerCells = rows[0].split('|').filter(function(c) { return c.trim(); });
            var html = '<table><thead><tr>';
            headerCells.forEach(function(cell) {
                html += '<th>' + cell.trim() + '</th>';
            });
            html += '</tr></thead><tbody>';
            for (var i = 2; i < rows.length; i++) {
                var cells = rows[i].split('|').filter(function(c) { return c.trim(); });
                html += '<tr>';
                cells.forEach(function(cell) {
                    html += '<td>' + cell.trim() + '</td>';
                });
                html += '</tr>';
            }
            html += '</tbody></table>';
            return html;
        }

        function openCommentDialog(citation, existingIndex) {
            currentCitation = citation;
            editingIndex = typeof existingIndex === 'number' ? existingIndex : -1;
            dialogTitle.textContent = editingIndex >= 0 ? 'Edit Comment' : 'Add Comment';
            citationPreview.textContent = citation;
            commentInput.value = editingIndex >= 0 ? comments[editingIndex].revisorInstructions : '';
            commentDialogOverlay.classList.add('visible');
            commentDialog.classList.add('visible');
            commentInput.focus();
        }

        function closeCommentDialog() {
            commentDialogOverlay.classList.remove('visible');
            commentDialog.classList.remove('visible');
            currentCitation = '';
            editingIndex = -1;
            commentInput.value = '';
        }

        function saveComment() {
            var instructions = commentInput.value.trim();
            if (!instructions) return;

            if (editingIndex >= 0) {
                comments[editingIndex].revisorInstructions = instructions;
            } else {
                comments.push({
                    revisedPart: currentCitation,
                    revisorInstructions: instructions
                });
            }

            closeCommentDialog();
            renderComments();
            updateLineHighlights();
            updateRejectButtonState();
        }

        function removeComment(index) {
            comments.splice(index, 1);
            renderComments();
            updateLineHighlights();
            updateRejectButtonState();
        }

        function clearAllComments() {
            comments = [];
            renderComments();
            updateLineHighlights();
            updateRejectButtonState();
        }

        function renderComments() {
            commentsCount.textContent = comments.length;
            // Show/hide Clear All button based on comment count
            clearAllBtn.style.display = comments.length > 0 ? 'block' : 'none';
            
            if (comments.length === 0) {
                noComments.style.display = 'block';
                commentsList.innerHTML = '';
                commentsList.appendChild(noComments);
                return;
            }

            noComments.style.display = 'none';
            var html = '';
            comments.forEach(function(comment, index) {
                html += '<div class="comment-item">' +
                    '<div class="comment-citation">' + escapeHtml(comment.revisedPart) + '</div>' +
                    '<div class="comment-text">' + escapeHtml(comment.revisorInstructions) + '</div>' +
                    '<div class="comment-actions">' +
                    '<button class="comment-action-btn edit-comment" data-index="' + index + '">Edit</button>' +
                    '<button class="comment-action-btn remove-comment" data-index="' + index + '">Remove</button>' +
                    '</div></div>';
            });
            commentsList.innerHTML = html;

            // Bind edit/remove events
            commentsList.querySelectorAll('.edit-comment').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var idx = parseInt(btn.getAttribute('data-index'));
                    openCommentDialog(comments[idx].revisedPart, idx);
                });
            });
            commentsList.querySelectorAll('.remove-comment').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var idx = parseInt(btn.getAttribute('data-index'));
                    removeComment(idx);
                });
            });
        }

        function updateLineHighlights() {
            // Clear all highlights
            document.querySelectorAll('.line-wrapper.has-comment').forEach(function(el) {
                el.classList.remove('has-comment');
            });

            // Highlight lines that have comments
            comments.forEach(function(comment) {
                document.querySelectorAll('.line-wrapper').forEach(function(wrapper) {
                    var wrapperText = wrapper.getAttribute('data-text');
                    if (wrapperText && comment.revisedPart.includes(wrapperText.substring(0, 50))) {
                        wrapper.classList.add('has-comment');
                    }
                });
            });
        }

        function updateRejectButtonState() {
            secondaryBtn.disabled = comments.length === 0;
            // Update primary button label to indicate comments will be included
            if (comments.length > 0) {
                primaryBtn.textContent = 'Approve with Comments';
            } else {
                primaryBtn.textContent = 'Approve';
            }
        }

        // Event listeners
        dialogCancel.addEventListener('click', closeCommentDialog);
        commentDialogOverlay.addEventListener('click', closeCommentDialog);
        dialogSave.addEventListener('click', saveComment);
        clearAllBtn.addEventListener('click', clearAllComments);

        commentInput.addEventListener('keydown', function(e) {
            // Enter (without Shift) saves the comment
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveComment();
            }
            // Shift+Enter allows new line (default behavior)
            if (e.key === 'Escape') {
                closeCommentDialog();
            }
        });

        primaryBtn.addEventListener('click', function() {
            var action = primaryBtn.getAttribute('data-action');
            // If approving with comments, send 'approveWithComments' so AI incorporates feedback
            if (action === 'approve' && comments.length > 0) {
                vscode.postMessage({ type: 'approveWithComments', comments: comments });
            } else {
                vscode.postMessage({ type: action, comments: comments });
            }
        });

        secondaryBtn.addEventListener('click', function() {
            if (secondaryBtn.disabled) return;
            var action = secondaryBtn.getAttribute('data-action');
            vscode.postMessage({ type: action, comments: comments });
        });

        cancelBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'close', comments: [] });
        });

        exportBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'exportPlan' });
        });

        // Handle messages from extension
        window.addEventListener('message', function(event) {
            var message = event.data;
            if (message.type === 'showPlan') {
                isReadOnly = message.readOnly;

                if (isReadOnly) {
                    readonlyBanner.classList.add('visible');
                    primaryBtn.style.display = 'none';
                    secondaryBtn.style.display = 'none';
                    cancelBtn.style.display = 'none';
                }

                // Render the plan content with comment icons
                var rendered = renderMarkdown(message.content);
                planContent.innerHTML = rendered;

                // Now wrap elements with comment icons (must do after innerHTML is set)
                var elements = planContent.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote');
                elements.forEach(function(el) {
                    if (el.closest('pre') || el.closest('code')) return;
                    if (el.parentElement && el.parentElement.classList.contains('line-wrapper')) return;

                    var wrapper = document.createElement('div');
                    wrapper.className = 'line-wrapper';
                    var textContent = el.textContent || '';
                    wrapper.setAttribute('data-text', textContent.substring(0, 200));

                    var commentBtn = document.createElement('button');
                    commentBtn.className = 'comment-icon';
                    commentBtn.innerHTML = '<span class="codicon codicon-comment"></span>';
                    commentBtn.title = 'Add comment';
                    commentBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        openCommentDialog(textContent.substring(0, 200));
                    });

                    el.parentNode.insertBefore(wrapper, el);
                    wrapper.appendChild(commentBtn);
                    wrapper.appendChild(el);
                });

                // Load existing comments
                if (message.comments && message.comments.length > 0) {
                    comments = message.comments;
                    renderComments();
                    updateLineHighlights();
                    updateRejectButtonState();
                }
            }
        });

        // Signal ready
        vscode.postMessage({ type: 'ready' });
    })();
    </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
