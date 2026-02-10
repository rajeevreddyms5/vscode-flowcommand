/**
 * FlowCommand Extension - Webview Script
 * Handles tool call history, prompt queue, attachments, and file autocomplete
 */
(function () {
    const vscode = acquireVsCodeApi();

    // Restore persisted state (survives sidebar switch)
    const previousState = vscode.getState() || {};

    // State
    let promptQueue = [];
    let queueEnabled = true; // Default to true (Queue mode ON by default)
    let queuePaused = false; // Queue pause state
    let dropdownOpen = false;
    let currentAttachments = previousState.attachments || []; // Restore attachments
    let selectedCard = 'queue';
    let currentSessionCalls = []; // Current session tool calls (shown in chat)
    let persistedHistory = []; // Past sessions history (shown in modal)
    let pendingToolCall = null;
    let isProcessingResponse = false; // True when AI is processing user's response
    let processingTimeoutId = null; // Timer to auto-clear stuck processing state
    const PROCESSING_TIMEOUT_MS = 30000; // 30 seconds before auto-clearing processing state
    let isApprovalQuestion = false; // True when current pending question is an approval-type question
    let currentChoices = []; // Parsed choices from multi-choice questions

    // Settings state
    let soundEnabled = true;
    let interactiveApprovalEnabled = true;
    let desktopNotificationEnabled = true;
    let autoFocusPanelEnabled = true;
    let mobileNotificationEnabled = false;
    let reusablePrompts = [];
    let audioUnlocked = false; // Track if audio playback has been unlocked by user gesture

    // Slash command autocomplete state
    let slashDropdownVisible = false;
    let slashResults = [];
    let selectedSlashIndex = -1;
    let slashStartPos = -1;
    let slashDebounceTimer = null;

    // Persisted input value (restored from state)
    let persistedInputValue = previousState.inputValue || '';

    // Edit mode state
    let editingPromptId = null;
    let editingOriginalPrompt = null;
    let savedInputValue = ''; // Save input value when entering edit mode

    // Autocomplete state
    let autocompleteVisible = false;
    let autocompleteResults = [];
    let selectedAutocompleteIndex = -1;
    let autocompleteStartPos = -1;
    let searchDebounceTimer = null;

    // DOM Elements
    let chatInput, sendBtn, attachBtn, modeBtn, modeDropdown, modeLabel;
    let inputHighlighter; // Overlay for syntax highlighting in input
    let queueSection, queueHeader, queueList, queueCount, queuePauseBtn, queueClearBtn;
    let chatContainer, chipsContainer, autocompleteDropdown, autocompleteList, autocompleteEmpty;
    let inputContainer, inputAreaContainer, welcomeSection;
    let cardVibe, cardSpec, toolHistoryArea, pendingMessage;
    let historyModal, historyModalOverlay, historyModalList, historyModalClose, historyModalClearAll;
    // Edit mode elements
    let actionsLeft, actionsBar, editActionsContainer, editCancelBtn, editConfirmBtn;
    // Approval modal elements
    let approvalModal, approvalContinueBtn, approvalNoBtn;
    // End session button (always visible in actions bar)
    let endSessionBtn;
    // Slash command elements
    let slashDropdown, slashList, slashEmpty;
    // Settings modal elements
    let settingsModal, settingsModalOverlay, settingsModalClose;
    let soundToggle, desktopNotificationToggle, autoFocusPanelToggle, mobileNotificationToggle, interactiveApprovalToggle;
    let instructionInjectionSelect, instructionTextArea, instructionTextSaveBtn, instructionInjectBtn, instructionRemoveBtn, instructionResetBtn, instructionReinjectBtn, instructionStatus;
    let instructionInjection = 'off';
    let instructionText = '';
    let instructionState = 'unknown';
    let mcpRunning = false;
    let mcpUrl = '';
    // Prompts modal elements
    let promptsModal, promptsModalOverlay, promptsModalClose;
    let promptsModalList, promptsModalAddBtn, promptsModalAddForm;
    // MCP settings elements
    let mcpStatusText, mcpUrlText, mcpToggleBtn, mcpCopyBtn;

    function init() {
        try {
            console.log('[FlowCommand Webview] init() starting...');
            cacheDOMElements();
            createHistoryModal();
            createEditModeUI();
            createApprovalModal();
            createSettingsModal();
            createPromptsModal();
            bindEventListeners();
            unlockAudioOnInteraction(); // Enable audio after first user interaction
            console.log('[FlowCommand Webview] Event listeners bound, pendingMessage element:', !!pendingMessage);
            renderQueue();
            updateModeUI();
            updateQueueVisibility();
            initCardSelection();

            // Restore persisted input value (when user switches sidebar tabs and comes back)
            if (chatInput && persistedInputValue) {
                chatInput.value = persistedInputValue;
                autoResizeTextarea();
                updateInputHighlighter();
                updateSendButtonState();
            }

            // Restore attachments display
            if (currentAttachments.length > 0) {
                updateChipsDisplay();
            }

            // Signal to extension that webview is ready to receive messages
            console.log('[FlowCommand Webview] Sending webviewReady message');
            vscode.postMessage({ type: 'webviewReady' });
        } catch (err) {
            console.error('[FlowCommand] Init error:', err);
        }
    }

    /**
     * Save webview state to persist across sidebar visibility changes
     */
    function saveWebviewState() {
        vscode.setState({
            inputValue: chatInput ? chatInput.value : '',
            attachments: currentAttachments.filter(function (a) { return !a.isTemporary; }) // Don't persist temp images
        });
    }

    function cacheDOMElements() {
        chatInput = document.getElementById('chat-input');
        inputHighlighter = document.getElementById('input-highlighter');
        sendBtn = document.getElementById('send-btn');
        attachBtn = document.getElementById('attach-btn');
        modeBtn = document.getElementById('mode-btn');
        modeDropdown = document.getElementById('mode-dropdown');
        modeLabel = document.getElementById('mode-label');
        queueSection = document.getElementById('queue-section');
        queueHeader = document.getElementById('queue-header');
        queueList = document.getElementById('queue-list');
        queueCount = document.getElementById('queue-count');
        queuePauseBtn = document.getElementById('queue-pause-btn');
        queueClearBtn = document.getElementById('queue-clear-btn');
        chatContainer = document.getElementById('chat-container');
        chipsContainer = document.getElementById('chips-container');
        autocompleteDropdown = document.getElementById('autocomplete-dropdown');
        autocompleteList = document.getElementById('autocomplete-list');
        autocompleteEmpty = document.getElementById('autocomplete-empty');
        inputContainer = document.getElementById('input-container');
        inputAreaContainer = document.getElementById('input-area-container');
        welcomeSection = document.getElementById('welcome-section');
        cardVibe = document.getElementById('card-vibe');
        cardSpec = document.getElementById('card-spec');
        toolHistoryArea = document.getElementById('tool-history-area');
        pendingMessage = document.getElementById('pending-message');
        // Slash command dropdown
        slashDropdown = document.getElementById('slash-dropdown');
        slashList = document.getElementById('slash-list');
        slashEmpty = document.getElementById('slash-empty');
        // Get actions bar elements for edit mode
        actionsBar = document.querySelector('.actions-bar');
        actionsLeft = document.querySelector('.actions-left');
        // End session button
        endSessionBtn = document.getElementById('end-session-btn');
    }

    function createHistoryModal() {
        // Create modal overlay
        historyModalOverlay = document.createElement('div');
        historyModalOverlay.className = 'history-modal-overlay hidden';
        historyModalOverlay.id = 'history-modal-overlay';

        // Create modal container
        historyModal = document.createElement('div');
        historyModal.className = 'history-modal';
        historyModal.id = 'history-modal';

        // Modal header
        var modalHeader = document.createElement('div');
        modalHeader.className = 'history-modal-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'history-modal-title';
        titleSpan.textContent = 'History';
        modalHeader.appendChild(titleSpan);

        // Info text - left aligned after title
        var infoSpan = document.createElement('span');
        infoSpan.className = 'history-modal-info';
        infoSpan.textContent = 'History is stored in VS Code globalStorage/tool-history.json';
        modalHeader.appendChild(infoSpan);

        // Clear all button (icon only)
        historyModalClearAll = document.createElement('button');
        historyModalClearAll.className = 'history-modal-clear-btn';
        historyModalClearAll.innerHTML = '<span class="codicon codicon-trash"></span>';
        historyModalClearAll.title = 'Clear all history';
        modalHeader.appendChild(historyModalClearAll);

        // Close button
        historyModalClose = document.createElement('button');
        historyModalClose.className = 'history-modal-close-btn';
        historyModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
        historyModalClose.title = 'Close';
        modalHeader.appendChild(historyModalClose);

        // Modal body (list)
        historyModalList = document.createElement('div');
        historyModalList.className = 'history-modal-list';
        historyModalList.id = 'history-modal-list';

        // Assemble modal
        historyModal.appendChild(modalHeader);
        historyModal.appendChild(historyModalList);
        historyModalOverlay.appendChild(historyModal);

        // Add to DOM
        document.body.appendChild(historyModalOverlay);
    }

    function createEditModeUI() {
        // Create edit actions container (hidden by default)
        editActionsContainer = document.createElement('div');
        editActionsContainer.className = 'edit-actions-container hidden';
        editActionsContainer.id = 'edit-actions-container';

        // Edit mode label
        var editLabel = document.createElement('span');
        editLabel.className = 'edit-mode-label';
        editLabel.textContent = 'Editing prompt';

        // Cancel button (X)
        editCancelBtn = document.createElement('button');
        editCancelBtn.className = 'icon-btn edit-cancel-btn';
        editCancelBtn.title = 'Cancel edit (Esc)';
        editCancelBtn.setAttribute('aria-label', 'Cancel editing');
        editCancelBtn.innerHTML = '<span class="codicon codicon-close"></span>';

        // Confirm button (✓)
        editConfirmBtn = document.createElement('button');
        editConfirmBtn.className = 'icon-btn edit-confirm-btn';
        editConfirmBtn.title = 'Confirm edit (Enter)';
        editConfirmBtn.setAttribute('aria-label', 'Confirm edit');
        editConfirmBtn.innerHTML = '<span class="codicon codicon-check"></span>';

        // Assemble edit actions
        editActionsContainer.appendChild(editLabel);
        var btnGroup = document.createElement('div');
        btnGroup.className = 'edit-btn-group';
        btnGroup.appendChild(editCancelBtn);
        btnGroup.appendChild(editConfirmBtn);
        editActionsContainer.appendChild(btnGroup);

        // Insert into actions bar (will be shown/hidden as needed)
        if (actionsBar) {
            actionsBar.appendChild(editActionsContainer);
        }
    }

    function createApprovalModal() {
        // Create approval bar that appears at the top of input-wrapper (inside the border)
        approvalModal = document.createElement('div');
        approvalModal.className = 'approval-bar hidden';
        approvalModal.id = 'approval-bar';
        approvalModal.setAttribute('role', 'toolbar');
        approvalModal.setAttribute('aria-label', 'Quick approval options');

        // Left side label
        var labelSpan = document.createElement('span');
        labelSpan.className = 'approval-label';
        labelSpan.textContent = 'Waiting on your input..';

        // Right side buttons container
        var buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'approval-buttons';

        // No/Reject button (secondary action - text only)
        approvalNoBtn = document.createElement('button');
        approvalNoBtn.className = 'approval-btn approval-reject-btn';
        approvalNoBtn.setAttribute('aria-label', 'Reject and provide custom response');
        approvalNoBtn.textContent = 'No';

        // Continue/Accept button (primary action)
        approvalContinueBtn = document.createElement('button');
        approvalContinueBtn.className = 'approval-btn approval-accept-btn';
        approvalContinueBtn.setAttribute('aria-label', 'Yes and continue');
        approvalContinueBtn.textContent = 'Yes';

        // Assemble buttons: [No] [Yes]
        buttonsContainer.appendChild(approvalNoBtn);
        buttonsContainer.appendChild(approvalContinueBtn);

        // Assemble bar
        approvalModal.appendChild(labelSpan);
        approvalModal.appendChild(buttonsContainer);

        // Insert at top of input-wrapper (inside the border)
        var inputWrapper = document.getElementById('input-wrapper');
        if (inputWrapper) {
            inputWrapper.insertBefore(approvalModal, inputWrapper.firstChild);
        }
    }

    function createSettingsModal() {
        // Create modal overlay
        settingsModalOverlay = document.createElement('div');
        settingsModalOverlay.className = 'settings-modal-overlay hidden';
        settingsModalOverlay.id = 'settings-modal-overlay';

        // Create modal container
        settingsModal = document.createElement('div');
        settingsModal.className = 'settings-modal';
        settingsModal.id = 'settings-modal';
        settingsModal.setAttribute('role', 'dialog');
        settingsModal.setAttribute('aria-labelledby', 'settings-modal-title');

        // Modal header
        var modalHeader = document.createElement('div');
        modalHeader.className = 'settings-modal-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'settings-modal-title';
        titleSpan.id = 'settings-modal-title';
        titleSpan.textContent = 'Settings';
        modalHeader.appendChild(titleSpan);

        // Header buttons container
        var headerButtons = document.createElement('div');
        headerButtons.className = 'settings-modal-header-buttons';

        // Report Issue button
        var reportBtn = document.createElement('button');
        reportBtn.className = 'settings-modal-header-btn';
        reportBtn.innerHTML = '<span class="codicon codicon-report"></span>';
        reportBtn.title = 'Report Issue';
        reportBtn.setAttribute('aria-label', 'Report an issue on GitHub');
        reportBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'openExternal', url: 'https://github.com/rajeevreddyms5/vscode-flowcommand/issues/new' });
        });
        headerButtons.appendChild(reportBtn);

        // Close button
        settingsModalClose = document.createElement('button');
        settingsModalClose.className = 'settings-modal-header-btn';
        settingsModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
        settingsModalClose.title = 'Close';
        settingsModalClose.setAttribute('aria-label', 'Close settings');
        headerButtons.appendChild(settingsModalClose);

        modalHeader.appendChild(headerButtons);

        // Modal content
        var modalContent = document.createElement('div');
        modalContent.className = 'settings-modal-content';

        // === Interactive Approval (TOP - standalone) ===
        var approvalSection = document.createElement('div');
        approvalSection.className = 'settings-section';
        approvalSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-checklist"></span> Interactive Approvals</div>' +
            '<div class="toggle-switch active" id="interactive-approval-toggle" role="switch" aria-checked="true" aria-label="Enable interactive approval and choice buttons" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(approvalSection);

        // === NOTIFICATIONS (Collapsible Group) ===
        var notificationsGroup = document.createElement('div');
        notificationsGroup.className = 'settings-group collapsed';
        notificationsGroup.id = 'notifications-group';
        notificationsGroup.innerHTML = 
            '<div class="settings-group-header" id="notifications-group-toggle">' +
            '<span class="codicon codicon-chevron-down settings-group-chevron"></span>' +
            '<span class="settings-group-title">Notifications</span>' +
            '</div>' +
            '<div class="settings-group-content">' +
            // Sound
            '<div class="settings-section"><div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-unmute"></span> Sound</div>' +
            '<div class="toggle-switch active" id="sound-toggle" role="switch" aria-checked="true" aria-label="Enable notification sound" tabindex="0"></div>' +
            '</div></div>' +
            // Desktop Notification
            '<div class="settings-section"><div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-bell"></span> Desktop Notification</div>' +
            '<div class="toggle-switch active" id="desktop-notification-toggle" role="switch" aria-checked="true" aria-label="Enable desktop notification popup" tabindex="0"></div>' +
            '</div></div>' +
            // Auto-Focus Panel
            '<div class="settings-section"><div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-pin"></span> Auto-Focus Panel</div>' +
            '<div class="toggle-switch active" id="auto-focus-panel-toggle" role="switch" aria-checked="true" aria-label="Auto-focus FlowCommand panel on new question" tabindex="0"></div>' +
            '</div></div>' +
            // Mobile Notification
            '<div class="settings-section"><div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-device-mobile"></span> Mobile Notification</div>' +
            '<div class="toggle-switch" id="mobile-notification-toggle" role="switch" aria-checked="false" aria-label="Enable mobile browser push notification" tabindex="0"></div>' +
            '</div></div>' +
            '</div>';
        modalContent.appendChild(notificationsGroup);

        // === INSTRUCTION INJECTION (Collapsible Group) ===
        var instructionGroup = document.createElement('div');
        instructionGroup.className = 'settings-group collapsed';
        instructionGroup.id = 'instruction-group';
        instructionGroup.innerHTML = 
            '<div class="settings-group-header" id="instruction-group-toggle">' +
            '<span class="codicon codicon-chevron-down settings-group-chevron"></span>' +
            '<span class="settings-group-title">Instruction Injection</span>' +
            '</div>' +
            '<div class="settings-group-content">' +
            '<div class="settings-section-description">Injects FlowCommand instructions into Copilot so it always calls ask_user and plan_review. Injection is applied at <strong>workspace level</strong> — it only affects this workspace. Choose a method and click Inject.</div>' +
            '<div class="form-row" style="margin-top:8px;">' +
            '<label class="form-label" for="instruction-injection-select">Method</label>' +
            '<select class="form-select" id="instruction-injection-select">' +
            '<option value="copilotInstructionsMd">copilot-instructions.md (Recommended)</option>' +
            '<option value="codeGenerationSetting">Code Generation Setting</option>' +
            '</select>' +
            '</div>' +
            '<div class="instruction-actions" style="margin-top:8px;display:flex;gap:8px;">' +
            '<button class="form-btn form-btn-save" id="instruction-inject-btn">Inject</button>' +
            '<button class="form-btn form-btn-save" id="instruction-reinject-btn" style="display:none;">Re-inject</button>' +
            '<button class="form-btn form-btn-cancel" id="instruction-remove-btn">Remove</button>' +
            '</div>' +
            '<div class="instruction-status" id="instruction-status" style="margin-top:6px;font-size:11px;"></div>' +
            '<div class="form-row" style="margin-top:10px;">' +
            '<label class="form-label" for="instruction-text-area">Instruction Text <span style="opacity:0.6;font-weight:normal;">(editable)</span></label>' +
            '<textarea class="form-input form-textarea instruction-textarea" id="instruction-text-area" rows="8" placeholder="Enter the instruction text to inject..."></textarea>' +
            '</div>' +
            '<div class="form-actions" style="margin-top:6px;">' +
            '<button class="form-btn form-btn-cancel" id="instruction-reset-btn" title="Reset to default instructions">Reset Default</button>' +
            '<button class="form-btn form-btn-save" id="instruction-text-save-btn">Save Instructions</button>' +
            '</div>' +
            '</div>';
        modalContent.appendChild(instructionGroup);

        // === MCP SERVER (Collapsible Group) ===
        var mcpGroup = document.createElement('div');
        mcpGroup.className = 'settings-group collapsed';
        mcpGroup.id = 'mcp-group';
        mcpGroup.innerHTML = 
            '<div class="settings-group-header" id="mcp-group-toggle">' +
            '<span class="codicon codicon-chevron-down settings-group-chevron"></span>' +
            '<span class="settings-group-title">MCP Server</span>' +
            '</div>' +
            '<div class="settings-group-content">' +
            '<div class="settings-section-description">Advanced: Control the local MCP server used by external tools. The URL is used for client configuration.</div>' +
            '<div class="form-row" style="margin-top:8px;">' +
            '<label class="form-label">Status</label>' +
            '<div id="mcp-status-text" style="font-size:12px;"></div>' +
            '</div>' +
            '<div class="form-row" style="margin-top:6px;">' +
            '<label class="form-label">URL</label>' +
            '<div id="mcp-url-text" style="font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; word-break: break-all;"></div>' +
            '</div>' +
            '<div class="form-actions" style="margin-top:6px;">' +
            '<button class="form-btn form-btn-save" id="mcp-toggle-btn">Start</button>' +
            '<button class="form-btn form-btn-cancel" id="mcp-copy-btn">Copy URL</button>' +
            '</div>' +
            '</div>';
        modalContent.appendChild(mcpGroup);

        // Assemble modal
        settingsModal.appendChild(modalHeader);
        settingsModal.appendChild(modalContent);
        settingsModalOverlay.appendChild(settingsModal);

        // Add to DOM
        document.body.appendChild(settingsModalOverlay);

        // Cache inner elements
        soundToggle = document.getElementById('sound-toggle');
        desktopNotificationToggle = document.getElementById('desktop-notification-toggle');
        autoFocusPanelToggle = document.getElementById('auto-focus-panel-toggle');
        mobileNotificationToggle = document.getElementById('mobile-notification-toggle');
        interactiveApprovalToggle = document.getElementById('interactive-approval-toggle');
        instructionInjectionSelect = document.getElementById('instruction-injection-select');
        instructionTextArea = document.getElementById('instruction-text-area');
        instructionTextSaveBtn = document.getElementById('instruction-text-save-btn');
        instructionInjectBtn = document.getElementById('instruction-inject-btn');
        instructionReinjectBtn = document.getElementById('instruction-reinject-btn');
        instructionRemoveBtn = document.getElementById('instruction-remove-btn');
        instructionResetBtn = document.getElementById('instruction-reset-btn');
        instructionStatus = document.getElementById('instruction-status');
        mcpStatusText = document.getElementById('mcp-status-text');
        mcpUrlText = document.getElementById('mcp-url-text');
        mcpToggleBtn = document.getElementById('mcp-toggle-btn');
        mcpCopyBtn = document.getElementById('mcp-copy-btn');
    }

    function createPromptsModal() {
        // Overlay
        promptsModalOverlay = document.createElement('div');
        promptsModalOverlay.className = 'prompts-modal-overlay hidden';
        promptsModalOverlay.id = 'prompts-modal-overlay';

        // Modal container
        promptsModal = document.createElement('div');
        promptsModal.className = 'prompts-modal';
        promptsModal.id = 'prompts-modal';
        promptsModal.setAttribute('role', 'dialog');
        promptsModal.setAttribute('aria-labelledby', 'prompts-modal-title');

        // Header
        var header = document.createElement('div');
        header.className = 'prompts-modal-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'prompts-modal-title';
        titleSpan.id = 'prompts-modal-title';
        titleSpan.innerHTML = '<span class="codicon codicon-symbol-keyword"></span> Reusable Prompts';
        header.appendChild(titleSpan);

        var headerBtns = document.createElement('div');
        headerBtns.className = 'prompts-modal-header-buttons';

        // Add prompt button in header
        promptsModalAddBtn = document.createElement('button');
        promptsModalAddBtn.className = 'prompts-modal-header-btn';
        promptsModalAddBtn.innerHTML = '<span class="codicon codicon-add"></span>';
        promptsModalAddBtn.title = 'Add Prompt';
        promptsModalAddBtn.id = 'prompts-modal-add-btn';
        headerBtns.appendChild(promptsModalAddBtn);

        // Close button
        promptsModalClose = document.createElement('button');
        promptsModalClose.className = 'prompts-modal-header-btn';
        promptsModalClose.innerHTML = '<span class="codicon codicon-close"></span>';
        promptsModalClose.title = 'Close';
        headerBtns.appendChild(promptsModalClose);

        header.appendChild(headerBtns);

        // Content area
        var content = document.createElement('div');
        content.className = 'prompts-modal-content';

        // Prompt count + hint
        var hint = document.createElement('div');
        hint.className = 'prompts-modal-hint';
        hint.innerHTML = 'Type <code>/</code> in the input to use a prompt. Prompts are expanded before sending.';
        content.appendChild(hint);

        // Add/Edit form (moved BEFORE list for better UX)
        promptsModalAddForm = document.createElement('div');
        promptsModalAddForm.className = 'prompts-modal-add-form hidden';
        promptsModalAddForm.id = 'prompts-modal-add-form';
        promptsModalAddForm.innerHTML =
            '<div class="form-row"><label class="form-label" for="pm-name-input">Name <span style="opacity:0.5;font-weight:normal">(used as /command)</span></label>' +
            '<input type="text" class="form-input" id="pm-name-input" placeholder="e.g., fix, test, refactor" maxlength="30"></div>' +
            '<div class="form-row"><label class="form-label" for="pm-text-input">Prompt Text</label>' +
            '<textarea class="form-input form-textarea" id="pm-text-input" placeholder="Enter the full prompt text..." rows="4" maxlength="2000"></textarea></div>' +
            '<div class="form-actions">' +
            '<button class="form-btn form-btn-cancel" id="pm-cancel-btn">Cancel</button>' +
            '<button class="form-btn form-btn-save" id="pm-save-btn">Save</button></div>';
        content.appendChild(promptsModalAddForm);

        // Prompts list
        promptsModalList = document.createElement('div');
        promptsModalList.className = 'prompts-modal-list';
        promptsModalList.id = 'prompts-modal-list';
        content.appendChild(promptsModalList);

        // Assemble
        promptsModal.appendChild(header);
        promptsModal.appendChild(content);
        promptsModalOverlay.appendChild(promptsModal);
        document.body.appendChild(promptsModalOverlay);
    }

    function bindEventListeners() {
        if (chatInput) {
            chatInput.addEventListener('input', handleTextareaInput);
            chatInput.addEventListener('keydown', handleTextareaKeydown);
            chatInput.addEventListener('paste', handlePaste);
            // Sync scroll between textarea and highlighter
            chatInput.addEventListener('scroll', function () {
                if (inputHighlighter) {
                    inputHighlighter.scrollTop = chatInput.scrollTop;
                }
            });
        }

        // Drag-and-drop image support on the input area
        var dropTarget = inputAreaContainer || chatInput;
        console.log('[FlowCommand] Setting up drag-drop, dropTarget found:', !!dropTarget);
        if (dropTarget) {
            // Helper: check if drag event might contain files or file URIs
            function hasDragFiles(dt) {
                if (!dt || !dt.types) {
                    console.log('[FlowCommand] hasDragFiles: no dataTransfer or types');
                    return false;
                }
                console.log('[FlowCommand] hasDragFiles: types =', Array.from(dt.types).join(', '));
                for (var i = 0; i < dt.types.length; i++) {
                    var t = dt.types[i];
                    if (t === 'Files' || t === 'text/uri-list' || t.indexOf('vscode') !== -1) return true;
                }
                return false;
            }

            dropTarget.addEventListener('dragover', function (e) {
                console.log('[FlowCommand] dragover event');
                if (hasDragFiles(e.dataTransfer)) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    dropTarget.classList.add('drag-over-input');
                }
            });
            dropTarget.addEventListener('dragenter', function (e) {
                if (hasDragFiles(e.dataTransfer)) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropTarget.classList.add('drag-over-input');
                }
            });
            dropTarget.addEventListener('dragleave', function (e) {
                // Only remove class if leaving the container entirely
                if (!dropTarget.contains(e.relatedTarget)) {
                    dropTarget.classList.remove('drag-over-input');
                }
            });
            dropTarget.addEventListener('drop', function (e) {
                console.log('[FlowCommand] Drop event triggered');
                e.preventDefault();
                e.stopPropagation();
                dropTarget.classList.remove('drag-over-input');
                var handled = false;

                console.log('[FlowCommand] Files count:', e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files.length : 0);
                // First: try standard File API (works for OS file manager drops)
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    for (var i = 0; i < e.dataTransfer.files.length; i++) {
                        var file = e.dataTransfer.files[i];
                        console.log('[FlowCommand] File:', file.name, 'type:', file.type);
                        if (file.type.indexOf('image/') === 0) {
                            console.log('[FlowCommand] Processing image file:', file.name);
                            processImageFile(file);
                            handled = true;
                        }
                    }
                }

                // Fallback: try text/uri-list (for VS Code Explorer or other URI-based drops)
                if (!handled && e.dataTransfer) {
                    var uriList = e.dataTransfer.getData('text/uri-list');
                    if (uriList) {
                        var uris = uriList.split(/\r?\n/).filter(function (u) { return u && u.indexOf('#') !== 0; });
                        var imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
                        for (var j = 0; j < uris.length; j++) {
                            var uri = uris[j].trim();
                            if (!uri) continue;
                            var lowerUri = uri.toLowerCase();
                            var isImage = imageExtensions.some(function (ext) { return lowerUri.endsWith(ext); });
                            if (isImage) {
                                // Send URI to extension for processing (extension can read from disk)
                                vscode.postMessage({ type: 'saveImageFromUri', uri: uri });
                                handled = true;
                            }
                        }
                    }
                }
            });
        }
        if (sendBtn) sendBtn.addEventListener('click', handleSend);
        if (attachBtn) attachBtn.addEventListener('click', handleAttach);
        if (modeBtn) modeBtn.addEventListener('click', toggleModeDropdown);

        document.querySelectorAll('.mode-option').forEach(function (option) {
            option.addEventListener('click', function () {
                setMode(option.getAttribute('data-mode'), true);
                closeModeDropdown();
            });
        });

        document.addEventListener('click', function (e) {
            if (dropdownOpen && !e.target.closest('.mode-selector') && !e.target.closest('.mode-dropdown')) closeModeDropdown();
            if (autocompleteVisible && !e.target.closest('.autocomplete-dropdown') && !e.target.closest('#chat-input')) hideAutocomplete();
            if (slashDropdownVisible && !e.target.closest('.slash-dropdown') && !e.target.closest('#chat-input')) hideSlashDropdown();
        });

        if (queueHeader) queueHeader.addEventListener('click', handleQueueHeaderClick);
        if (queuePauseBtn) queuePauseBtn.addEventListener('click', handleQueuePauseClick);
        if (queueClearBtn) queueClearBtn.addEventListener('click', handleQueueClearClick);
        if (historyModalClose) historyModalClose.addEventListener('click', closeHistoryModal);
        if (historyModalClearAll) historyModalClearAll.addEventListener('click', clearAllPersistedHistory);
        if (historyModalOverlay) {
            historyModalOverlay.addEventListener('click', function (e) {
                if (e.target === historyModalOverlay) closeHistoryModal();
            });
        }
        // Edit mode button events
        if (editCancelBtn) editCancelBtn.addEventListener('click', cancelEditMode);
        if (editConfirmBtn) editConfirmBtn.addEventListener('click', confirmEditMode);

        // Approval modal button events
        if (approvalContinueBtn) approvalContinueBtn.addEventListener('click', handleApprovalContinue);
        if (approvalNoBtn) approvalNoBtn.addEventListener('click', handleApprovalNo);

        // End session button (always visible)
        if (endSessionBtn) endSessionBtn.addEventListener('click', handleEndSessionClick);

        // Settings modal events
        if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettingsModal);
        if (settingsModalOverlay) {
            settingsModalOverlay.addEventListener('click', function (e) {
                if (e.target === settingsModalOverlay) closeSettingsModal();
            });
        }
        
        // Notifications group collapsible toggle
        var notificationsGroupToggle = document.getElementById('notifications-group-toggle');
        if (notificationsGroupToggle) {
            notificationsGroupToggle.addEventListener('click', function() {
                var group = document.getElementById('notifications-group');
                if (group) {
                    group.classList.toggle('collapsed');
                }
            });
        }

        // Instruction Injection group collapsible toggle
        var instructionGroupToggle = document.getElementById('instruction-group-toggle');
        if (instructionGroupToggle) {
            instructionGroupToggle.addEventListener('click', function() {
                var group = document.getElementById('instruction-group');
                if (group) {
                    group.classList.toggle('collapsed');
                }
            });
        }

        // MCP Server group collapsible toggle
        var mcpGroupToggle = document.getElementById('mcp-group-toggle');
        if (mcpGroupToggle) {
            mcpGroupToggle.addEventListener('click', function() {
                var group = document.getElementById('mcp-group');
                if (group) {
                    group.classList.toggle('collapsed');
                }
            });
        }
        
        if (soundToggle) {
            soundToggle.addEventListener('click', toggleSoundSetting);
            soundToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSoundSetting();
                }
            });
        }
        if (desktopNotificationToggle) {
            desktopNotificationToggle.addEventListener('click', toggleDesktopNotificationSetting);
            desktopNotificationToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDesktopNotificationSetting(); }
            });
        }
        if (autoFocusPanelToggle) {
            autoFocusPanelToggle.addEventListener('click', toggleAutoFocusPanelSetting);
            autoFocusPanelToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAutoFocusPanelSetting(); }
            });
        }
        if (mobileNotificationToggle) {
            mobileNotificationToggle.addEventListener('click', toggleMobileNotificationSetting);
            mobileNotificationToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMobileNotificationSetting(); }
            });
        }
        if (interactiveApprovalToggle) {
            interactiveApprovalToggle.addEventListener('click', toggleInteractiveApprovalSetting);
            interactiveApprovalToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleInteractiveApprovalSetting();
                }
            });
        }
        // Prompts modal events
        if (promptsModalClose) promptsModalClose.addEventListener('click', closePromptsModal);
        if (promptsModalOverlay) {
            promptsModalOverlay.addEventListener('click', function (e) {
                if (e.target === promptsModalOverlay) closePromptsModal();
            });
        }
        if (promptsModalAddBtn) promptsModalAddBtn.addEventListener('click', showPromptsModalAddForm);
        var pmCancelBtn = document.getElementById('pm-cancel-btn');
        var pmSaveBtn = document.getElementById('pm-save-btn');
        if (pmCancelBtn) pmCancelBtn.addEventListener('click', hidePromptsModalAddForm);
        if (pmSaveBtn) pmSaveBtn.addEventListener('click', savePromptsModalPrompt);

        // Instruction injection events
        if (instructionInjectBtn) {
            instructionInjectBtn.addEventListener('click', function () {
                if (instructionInjectionSelect) {
                    vscode.postMessage({ type: 'updateInstructionInjection', method: instructionInjectionSelect.value });
                }
            });
        }
        if (instructionReinjectBtn) {
            instructionReinjectBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'reinjectInstruction' });
            });
        }
        if (instructionRemoveBtn) {
            instructionRemoveBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'updateInstructionInjection', method: 'off' });
            });
        }
        if (instructionTextSaveBtn) {
            instructionTextSaveBtn.addEventListener('click', function () {
                if (instructionTextArea) {
                    vscode.postMessage({ type: 'updateInstructionText', text: instructionTextArea.value });
                }
            });
        }
        if (instructionResetBtn) {
            instructionResetBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'resetInstructionText' });
            });
        }
        if (mcpToggleBtn) {
            mcpToggleBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'mcpToggle' });
            });
        }
        if (mcpCopyBtn) {
            mcpCopyBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'mcpCopyUrl' });
            });
        }

        window.addEventListener('message', handleExtensionMessage);
        
        // Expose dispatchVSCodeMessage for remote UI server
        // This allows socket.io messages from the remote server to be processed
        // by the same handler as VS Code extension messages
        window.dispatchVSCodeMessage = function(message) {
            console.log('[FlowCommand Webview] dispatchVSCodeMessage called:', message.type);
            handleExtensionMessage({ data: message });
        };
        if (window.__flowcommandInitialState && typeof window.__applyFlowCommandInitialState === 'function') {
            window.__applyFlowCommandInitialState(window.__flowcommandInitialState);
            window.__flowcommandInitialState = null;
        }
        console.log('[FlowCommand Webview] dispatchVSCodeMessage registered on window');
    }

    function openHistoryModal() {
        if (!historyModalOverlay) return;
        // Request persisted history from extension
        vscode.postMessage({ type: 'openHistoryModal' });
        historyModalOverlay.classList.remove('hidden');
    }

    function closeHistoryModal() {
        if (!historyModalOverlay) return;
        historyModalOverlay.classList.add('hidden');
    }

    function clearAllPersistedHistory() {
        if (persistedHistory.length === 0) return;
        vscode.postMessage({ type: 'clearPersistedHistory' });
        persistedHistory = [];
        renderHistoryModal();
    }

    function initCardSelection() {
        if (cardVibe) {
            cardVibe.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                selectCard('normal', true);
            });
        }
        if (cardSpec) {
            cardSpec.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                selectCard('queue', true);
            });
        }
        // Don't set default here - wait for updateQueue message from extension
        // which contains the persisted enabled state
        updateCardSelection();
    }

    function selectCard(card, notify) {
        selectedCard = card;
        queueEnabled = card === 'queue';
        updateCardSelection();
        updateModeUI();
        updateQueueVisibility();

        // Only notify extension if user clicked (not on init from persisted state)
        if (notify) {
            vscode.postMessage({ type: 'toggleQueue', enabled: queueEnabled });
        }
    }

    function updateCardSelection() {
        // card-vibe = Normal mode, card-spec = Queue mode
        if (cardVibe) cardVibe.classList.toggle('selected', !queueEnabled);
        if (cardSpec) cardSpec.classList.toggle('selected', queueEnabled);
    }

    function autoResizeTextarea() {
        if (!chatInput) return;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    }

    /**
     * Update the input highlighter overlay to show syntax highlighting
     * for slash commands (/command) and file references (#file)
     */
    function updateInputHighlighter() {
        if (!inputHighlighter || !chatInput) return;

        var text = chatInput.value;
        if (!text) {
            inputHighlighter.innerHTML = '';
            return;
        }

        // Build a list of known slash command names for exact matching
        var knownSlashNames = reusablePrompts.map(function (p) { return p.name; });
        // Also add any pending stored mappings
        var mappings = chatInput._slashPrompts || {};
        Object.keys(mappings).forEach(function (name) {
            if (knownSlashNames.indexOf(name) === -1) knownSlashNames.push(name);
        });

        // Escape HTML first
        var html = escapeHtml(text);

        // Highlight slash commands - match /word patterns
        // Only highlight if it's a known command OR any /word pattern
        html = html.replace(/(^|\s)(\/[a-zA-Z0-9_-]+)(\s|$)/g, function (match, before, slash, after) {
            var cmdName = slash.substring(1); // Remove the /
            // Highlight if it's a known command or if we have prompts defined
            if (knownSlashNames.length === 0 || knownSlashNames.indexOf(cmdName) >= 0) {
                return before + '<span class="slash-highlight">' + slash + '</span>' + after;
            }
            // Still highlight as generic slash command
            return before + '<span class="slash-highlight">' + slash + '</span>' + after;
        });

        // Highlight file references - match #word patterns
        html = html.replace(/(^|\s)(#[a-zA-Z0-9_.\/-]+)(\s|$)/g, function (match, before, hash, after) {
            return before + '<span class="hash-highlight">' + hash + '</span>' + after;
        });

        // Don't add trailing space - causes visual artifacts
        // html += '&nbsp;';

        inputHighlighter.innerHTML = html;

        // Sync scroll position
        inputHighlighter.scrollTop = chatInput.scrollTop;
    }

    function handleTextareaInput() {
        autoResizeTextarea();
        updateInputHighlighter();
        handleAutocomplete();
        handleSlashCommands();
        // Context items (#terminal, #problems) now handled via handleAutocomplete()
        syncAttachmentsWithText();
        updateSendButtonState();
        // Persist input value so it survives sidebar tab switches
        saveWebviewState();
    }

    function updateSendButtonState() {
        if (!sendBtn || !chatInput) return;
        var hasText = chatInput.value.trim().length > 0;
        sendBtn.classList.toggle('has-text', hasText);
    }

    function handleTextareaKeydown(e) {
        // Handle approval modal keyboard shortcuts when visible
        if (isApprovalQuestion && approvalModal && !approvalModal.classList.contains('hidden')) {
            // Enter sends "Continue" when approval modal is visible and input is empty
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                var inputText = chatInput ? chatInput.value.trim() : '';
                if (!inputText) {
                    e.preventDefault();
                    handleApprovalContinue();
                    return;
                }
                // If there's text, fall through to normal send behavior
            }
            // Escape dismisses approval modal
            if (e.key === 'Escape') {
                e.preventDefault();
                handleApprovalNo();
                return;
            }
        }

        // Handle edit mode keyboard shortcuts
        if (editingPromptId) {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelEditMode();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                confirmEditMode();
                return;
            }
            // Allow other keys in edit mode
            return;
        }

        // Handle slash command dropdown navigation
        if (slashDropdownVisible) {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (selectedSlashIndex < slashResults.length - 1) { selectedSlashIndex++; updateSlashSelection(); } return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedSlashIndex > 0) { selectedSlashIndex--; updateSlashSelection(); } return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && selectedSlashIndex >= 0) { e.preventDefault(); selectSlashItem(selectedSlashIndex); return; }
            if (e.key === 'Escape') { e.preventDefault(); hideSlashDropdown(); return; }
        }

        if (autocompleteVisible) {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (selectedAutocompleteIndex < autocompleteResults.length - 1) { selectedAutocompleteIndex++; updateAutocompleteSelection(); } return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedAutocompleteIndex > 0) { selectedAutocompleteIndex--; updateAutocompleteSelection(); } return; }
            if ((e.key === 'Enter' || e.key === 'Tab') && selectedAutocompleteIndex >= 0) { e.preventDefault(); selectAutocompleteItem(selectedAutocompleteIndex); return; }
            if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
        }

        // Context dropdown navigation removed - context now uses # via file autocomplete

        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); handleSend(); }
    }

    /**
     * Parse text to detect and extract list items.
     * Supports: numbered (1. 1) 1:), lettered (a. A)), bulleted (- * •)
     * @returns Array of items if list detected, or null if not a list
     */
    function parseListItems(text) {
        if (!text || !text.trim()) return null;

        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        
        // Need at least 2 lines to be considered a list
        if (lines.length < 2) return null;

        // Patterns for different list types
        var numberedPattern = /^(\d+)[.\):\-]\s*(.+)$/;         // 1. or 1) or 1: or 1-
        var letteredPattern = /^([a-zA-Z])[.\):\-]\s*(.+)$/;    // a. or A) or a: or a-
        var bulletedPattern = /^[-*•]\s*(.+)$/;                 // - or * or •
        var romanPattern = /^([ivxIVX]+)[.\):\-]\s*(.+)$/;      // i. or II) etc

        var items = [];
        var listType = null;
        var expectedNumber = 1;
        var expectedLetter = 'a';

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var match;

            // Try numbered pattern first
            match = line.match(numberedPattern);
            if (match) {
                var num = parseInt(match[1], 10);
                // For first item, detect list type. For subsequent, verify sequence.
                if (i === 0) {
                    listType = 'numbered';
                    expectedNumber = num + 1;
                } else if (listType === 'numbered') {
                    // Allow some flexibility: item can be expectedNumber or continue from previous
                    expectedNumber = num + 1;
                } else {
                    // List type mismatch
                    return null;
                }
                items.push(match[2].trim());
                continue;
            }

            // Try lettered pattern
            match = line.match(letteredPattern);
            if (match) {
                var letter = match[1].toLowerCase();
                if (i === 0) {
                    listType = 'lettered';
                    expectedLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
                } else if (listType === 'lettered') {
                    expectedLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
                } else {
                    return null;
                }
                items.push(match[2].trim());
                continue;
            }

            // Try bulleted pattern
            match = line.match(bulletedPattern);
            if (match) {
                if (i === 0) {
                    listType = 'bulleted';
                } else if (listType !== 'bulleted') {
                    return null;
                }
                items.push(match[1].trim());
                continue;
            }

            // Try roman numeral pattern
            match = line.match(romanPattern);
            if (match) {
                if (i === 0) {
                    listType = 'roman';
                } else if (listType !== 'roman') {
                    return null;
                }
                items.push(match[2].trim());
                continue;
            }

            // Line doesn't match any list pattern - not a valid list
            return null;
        }

        // Only return items if we detected a consistent list with at least 2 items
        return items.length >= 2 ? items : null;
    }

    function handleSend() {
        var text = chatInput ? chatInput.value.trim() : '';
        if (!text && currentAttachments.length === 0) return;

        // Expand slash commands to full prompt text
        text = expandSlashCommands(text);

        // Hide approval modal and choices bar when sending any response
        hideApprovalModal();
        hideChoicesBar();

        // If there's a pending tool call, ALWAYS submit directly (never queue)
        // This ensures typed text works the same as clicking approval/choice buttons
        if (pendingToolCall) {
            vscode.postMessage({ type: 'submit', value: text, attachments: currentAttachments });
            if (chatInput) {
                chatInput.value = '';
                chatInput.style.height = 'auto';
                updateInputHighlighter();
            }
            currentAttachments = [];
            updateChipsDisplay();
            updateSendButtonState();
            saveWebviewState();
            return;
        }

        // If processing response (AI working) and no pending tool call, auto-queue the message
        if (isProcessingResponse && text) {
            // Check if text is a list - if so, add each item separately to queue
            var listItems = parseListItems(text);
            if (listItems && listItems.length > 0) {
                listItems.forEach(function(item) {
                    addToQueue(item);
                });
            } else {
                addToQueue(text);
            }
            // This reduces friction - user's prompt is in queue, so show them queue mode
            if (!queueEnabled) {
                queueEnabled = true;
                updateModeUI();
                updateQueueVisibility();
                updateCardSelection();
                vscode.postMessage({ type: 'toggleQueue', enabled: true });
            }
            if (chatInput) {
                chatInput.value = '';
                chatInput.style.height = 'auto';
                updateInputHighlighter();
            }
            currentAttachments = [];
            updateChipsDisplay();
            updateSendButtonState();
            // Clear persisted state after sending
            saveWebviewState();
            return;
        }

        if (queueEnabled && text && !pendingToolCall) {
            // Check if text is a list - if so, add each item separately to queue
            var listItems = parseListItems(text);
            if (listItems && listItems.length > 0) {
                listItems.forEach(function(item) {
                    addToQueue(item);
                });
            } else {
                addToQueue(text);
            }
        } else {
            vscode.postMessage({ type: 'submit', value: text, attachments: currentAttachments });
        }

        if (chatInput) {
            chatInput.value = '';
            chatInput.style.height = 'auto';
            updateInputHighlighter();
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        // Clear persisted state after sending
        saveWebviewState();
    }

    function handleAttach() { vscode.postMessage({ type: 'addAttachment' }); }

    function toggleModeDropdown(e) {
        e.stopPropagation();
        if (dropdownOpen) closeModeDropdown();
        else {
            dropdownOpen = true;
            positionModeDropdown();
            modeDropdown.classList.remove('hidden');
            modeDropdown.classList.add('visible');
        }
    }

    function positionModeDropdown() {
        if (!modeDropdown || !modeBtn) return;
        var rect = modeBtn.getBoundingClientRect();
        modeDropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        modeDropdown.style.left = rect.left + 'px';
    }

    function closeModeDropdown() {
        dropdownOpen = false;
        if (modeDropdown) {
            modeDropdown.classList.remove('visible');
            modeDropdown.classList.add('hidden');
        }
    }

    function setMode(mode, notify) {
        queueEnabled = mode === 'queue';
        updateModeUI();
        updateQueueVisibility();
        updateCardSelection();
        if (notify) vscode.postMessage({ type: 'toggleQueue', enabled: queueEnabled });
    }

    function updateModeUI() {
        if (modeLabel) modeLabel.textContent = queueEnabled ? 'Queue' : 'Normal';
        document.querySelectorAll('.mode-option').forEach(function (opt) {
            opt.classList.toggle('selected', opt.getAttribute('data-mode') === (queueEnabled ? 'queue' : 'normal'));
        });
    }

    function updateQueueVisibility() {
        if (!queueSection) return;
        // Hide queue section if: not in queue mode OR queue is empty
        var shouldHide = !queueEnabled || promptQueue.length === 0;
        var wasHidden = queueSection.classList.contains('hidden');
        queueSection.classList.toggle('hidden', shouldHide);
        // Only collapse when showing for the FIRST time (was hidden, now visible)
        // Don't collapse on subsequent updates to preserve user's expanded state
        if (wasHidden && !shouldHide && promptQueue.length > 0) {
            queueSection.classList.add('collapsed');
        }
    }

    /**
     * Update the end session button state based on whether "end" is queued
     */
    function updateEndSessionButtonState() {
        if (!endSessionBtn) return;
        // Check if "end" is in the queue
        var hasEndInQueue = promptQueue.some(function (item) {
            return item.prompt && item.prompt.toLowerCase().trim() === 'end';
        });
        endSessionBtn.classList.toggle('active', hasEndInQueue);
    }

    function handleQueueHeaderClick(e) {
        // Don't toggle collapse if clicking on the pause or clear button
        if (e.target.closest('.queue-pause-btn') || e.target.closest('.queue-clear-btn')) return;
        if (queueSection) queueSection.classList.toggle('collapsed');
    }

    function handleQueuePauseClick(e) {
        e.stopPropagation(); // Prevent header click from triggering
        if (queuePaused) {
            vscode.postMessage({ type: 'resumeQueue' });
        } else {
            vscode.postMessage({ type: 'pauseQueue' });
        }
    }

    function handleQueueClearClick(e) {
        e.stopPropagation(); // Prevent header click from triggering
        if (promptQueue.length === 0) return;
        // Clear queue locally and notify backend
        promptQueue = [];
        renderQueue();
        updateQueueVisibility();
        updateEndSessionButtonState();
        vscode.postMessage({ type: 'clearQueue' });
    }

    function updateQueuePauseUI() {
        if (!queuePauseBtn) return;
        
        var icon = queuePauseBtn.querySelector('.codicon');
        if (queuePaused) {
            if (icon) {
                icon.classList.remove('codicon-debug-pause');
                icon.classList.add('codicon-debug-start');
            }
            queuePauseBtn.title = 'Resume queue processing';
            queuePauseBtn.setAttribute('aria-label', 'Resume queue');
            queueSection.classList.add('paused');
        } else {
            if (icon) {
                icon.classList.remove('codicon-debug-start');
                icon.classList.add('codicon-debug-pause');
            }
            queuePauseBtn.title = 'Pause queue processing';
            queuePauseBtn.setAttribute('aria-label', 'Pause queue');
            queueSection.classList.remove('paused');
        }
    }

    function handleExtensionMessage(event) {
        var message = event.data;
        console.log('[FlowCommand Webview] Received message:', message.type, message);
        switch (message.type) {
            case 'updateQueue':
                promptQueue = message.queue || [];
                queueEnabled = message.enabled !== false;
                queuePaused = message.paused === true;
                renderQueue();
                updateModeUI();
                updateQueueVisibility();
                updateQueuePauseUI();
                updateCardSelection();
                // Update end session button state based on whether "end" is in queue
                updateEndSessionButtonState();
                // Hide welcome section if we have current session calls
                updateWelcomeSectionVisibility();
                break;
            case 'toolCallPending':
                console.log('[FlowCommand Webview] toolCallPending - showing question:', message.prompt?.substring(0, 50));
                showPendingToolCall(message.id, message.prompt, message.isApprovalQuestion, message.choices, message.context);
                break;
            case 'toolCallCompleted':
                addToolCallToCurrentSession(message.entry);
                break;
            case 'toolCallCancelled':
                handleToolCallCancelled(message.id);
                break;
            case 'updateCurrentSession':
                currentSessionCalls = message.history || [];
                renderCurrentSession();
                // Hide welcome section if we have completed tool calls
                updateWelcomeSectionVisibility();
                // Auto-scroll to bottom after rendering
                scrollToBottom();
                break;
            case 'updatePersistedHistory':
                persistedHistory = message.history || [];
                renderHistoryModal();
                break;
            case 'openHistoryModal':
                openHistoryModal();
                break;
            case 'openSettingsModal':
                openSettingsModal();
                break;
            case 'openPromptsModal':
                openPromptsModal();
                break;
            case 'updateSettings':
                soundEnabled = message.soundEnabled !== false;
                desktopNotificationEnabled = message.desktopNotificationEnabled !== false;
                autoFocusPanelEnabled = message.autoFocusPanelEnabled !== false;
                mobileNotificationEnabled = message.mobileNotificationEnabled === true;
                interactiveApprovalEnabled = message.interactiveApprovalEnabled !== false;
                reusablePrompts = message.reusablePrompts || [];
                instructionInjection = message.instructionInjection || 'off';
                instructionText = message.instructionText || '';
                instructionState = message.instructionStatus || 'unknown';
                mcpRunning = message.mcpRunning === true;
                mcpUrl = message.mcpUrl || '';
                updateSoundToggleUI();
                updateDesktopNotificationToggleUI();
                updateAutoFocusPanelToggleUI();
                updateMobileNotificationToggleUI();
                updateInteractiveApprovalToggleUI();
                renderPromptsList();
                updateInstructionUI();
                updateMcpUI();
                updateTemplateIndicator();
                break;
            case 'slashCommandResults':
                showSlashDropdown(message.prompts || []);
                break;
            case 'playNotificationSound':
                playNotificationSound();
                break;
            case 'fileSearchResults':
                showAutocomplete(message.files || []);
                break;
            case 'updateAttachments':
                currentAttachments = message.attachments || [];
                updateChipsDisplay();
                break;
            case 'imageSaved':
                if (message.attachment && !currentAttachments.some(function (a) { return a.id === message.attachment.id; })) {
                    currentAttachments.push(message.attachment);
                    updateChipsDisplay();
                    // Auto-add image reference to input (like file references with #)
                    var displayName = message.attachment.isTemporary ? 'pasted-image' : message.attachment.name;
                    var imageRef = '[Image: ' + displayName + ']';
                    if (chatInput) {
                        var currentText = chatInput.value;
                        // Add space before if there's existing text that doesn't end with space/newline
                        if (currentText && !currentText.match(/[\s\n]$/)) {
                            chatInput.value = currentText + ' ' + imageRef;
                        } else {
                            chatInput.value = currentText + imageRef;
                        }
                        chatInput.style.height = 'auto';
                        chatInput.style.height = chatInput.scrollHeight + 'px';
                        updateInputHighlighter();
                        updateSendButtonState();
                    }
                }
                break;
            case 'clear':
                promptQueue = [];
                currentSessionCalls = [];
                renderQueue();
                renderCurrentSession();
                break;
            case 'clearProcessing':
                // Clear the "Processing your response" state
                clearProcessingState();
                break;
            case 'planReviewPending':
                showPlanReviewModal(message.reviewId, message.title, message.plan);
                break;
            case 'planReviewCompleted':
                closePlanReviewModal(message.reviewId);
                break;
            case 'multiQuestionPending':
                showMultiQuestionModal(message.requestId, message.questions);
                break;
            case 'multiQuestionCompleted':
                closeMultiQuestionModal(message.requestId);
                break;
            case 'queuedAgentRequestCount':
                updateQueuedAgentBadge(message.count || 0);
                break;
            case 'pendingInputCount':
                updatePendingInputBadge(message.count || 0);
                break;
        }
    }

    /**
     * Clear the processing state - hide "Processing your response" indicator
     */
    function clearProcessingState() {
        isProcessingResponse = false;
        if (pendingMessage) {
            pendingMessage.classList.add('hidden');
            pendingMessage.innerHTML = '';
        }
        // Also clear any stale pending tool call state
        if (!pendingToolCall) {
            document.body.classList.remove('has-pending-toolcall');
        }
    }

    /**
     * Show/hide the queued agent requests badge.
     * Displays a small indicator when multiple AI agents are waiting in line.
     */
    function updateQueuedAgentBadge(count) {
        var badge = document.getElementById('queued-agent-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'queued-agent-badge';
                badge.className = 'queued-agent-badge';
                // Insert before the input area
                var inputArea = document.querySelector('.input-area');
                if (inputArea) {
                    inputArea.parentNode.insertBefore(badge, inputArea);
                }
            }
            badge.innerHTML = '<span class="codicon codicon-layers"></span> ' + count + ' more agent request' + (count > 1 ? 's' : '') + ' waiting';
            badge.style.display = 'flex';
        } else if (badge) {
            badge.style.display = 'none';
        }
    }

    /**
     * Show/hide the pending input count badge at the top of the chat.
     * Displays a small indicator showing how many inputs are waiting for the user.
     * Synced with the VS Code sidebar badge count.
     */
    function updatePendingInputBadge(count) {
        var badge = document.getElementById('pending-input-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'pending-input-badge';
                badge.className = 'pending-input-badge';
                // Insert at the top of the chat container
                var chatContainer = document.getElementById('chat-container');
                if (chatContainer) {
                    chatContainer.insertBefore(badge, chatContainer.firstChild);
                }
            }
            badge.innerHTML = '<span class="codicon codicon-bell"></span> ' +
                count + ' pending input' + (count > 1 ? 's' : '') +
                ' — AI is waiting for your response';
            badge.classList.remove('hidden');
            badge.classList.remove('badge-pulse');
            // Trigger reflow for animation restart
            void badge.offsetWidth;
            badge.classList.add('badge-pulse');
        } else if (badge) {
            badge.classList.add('hidden');
            badge.classList.remove('badge-pulse');
        }
    }

    function showPendingToolCall(id, prompt, isApproval, choices, context) {
        console.log('[FlowCommand Webview] showPendingToolCall called with id:', id);
        pendingToolCall = { id: id, prompt: prompt, context: context };
        isProcessingResponse = false; // AI is now asking, not processing
        isApprovalQuestion = isApproval === true;
        currentChoices = choices || [];

        // Cancel any pending processing timeout since AI is now asking a question
        cancelProcessingTimeout();

        if (welcomeSection) {
            welcomeSection.classList.add('hidden');
        }

        // Add pending class to disable session switching UI
        document.body.classList.add('has-pending-toolcall');

        // Show AI context (full response) and question
        if (pendingMessage) {
            console.log('[FlowCommand Webview] Setting pendingMessage innerHTML...');
            pendingMessage.classList.remove('hidden');
            var html = '';
            if (context && context.trim()) {
                html += '<div class="pending-ai-context">' +
                    '<div class="context-label"><span class="codicon codicon-copilot"></span> AI Response</div>' +
                    '<div class="context-content">' + formatMarkdown(context) + '</div>' +
                    '</div>';
            }
            html += '<div class="pending-ai-question">' + formatMarkdown(prompt) + '</div>';
            pendingMessage.innerHTML = html;
            console.log('[FlowCommand Webview] pendingMessage.innerHTML set, length:', pendingMessage.innerHTML.length);
        } else {
            console.error('[FlowCommand Webview] pendingMessage element is null!');
        }

        // Re-render current session (without the pending item - it's shown separately)
        renderCurrentSession();
        // Render any mermaid diagrams in pending message
        renderMermaidDiagrams();
        // Auto-scroll to show the new pending message
        scrollToBottom();

        // Show choice buttons if we have choices, otherwise show approval modal for yes/no questions
        // Only show if interactive approval is enabled
        if (interactiveApprovalEnabled) {
            if (currentChoices.length > 0) {
                showChoicesBar();
            } else if (isApprovalQuestion) {
                showApprovalModal();
            } else {
                hideApprovalModal();
                hideChoicesBar();
            }
        } else {
            // Interactive approval disabled - just focus input for manual typing
            hideApprovalModal();
            hideChoicesBar();
            if (chatInput) {
                chatInput.focus();
            }
        }
    }

    function addToolCallToCurrentSession(entry) {
        pendingToolCall = null;

        // Remove pending class to re-enable session switching UI
        document.body.classList.remove('has-pending-toolcall');

        // Hide approval modal and choices bar when tool call completes
        hideApprovalModal();
        hideChoicesBar();

        // Update or add entry to current session
        var idx = currentSessionCalls.findIndex(function (tc) { return tc.id === entry.id; });
        if (idx >= 0) {
            currentSessionCalls[idx] = entry;
        } else {
            currentSessionCalls.unshift(entry);
        }
        renderCurrentSession();

        // Show working indicator after user responds (AI is now processing the response)
        isProcessingResponse = true;
        if (pendingMessage) {
            pendingMessage.classList.remove('hidden');
            pendingMessage.innerHTML = '<div class="working-indicator">Processing your response</div>';
        }

        // Start processing timeout - auto-clear if no new ask_user within timeout
        startProcessingTimeout();

        // Auto-scroll to show the working indicator
        scrollToBottom();
    }

    /**
     * Handle tool call cancellation (e.g. user clicked Stop in Copilot chat).
     * Dismisses the pending tool call UI and clears all waiting states.
     */
    function handleToolCallCancelled(id) {
        console.log('[FlowCommand Webview] toolCallCancelled:', id);

        // Clear pending tool call - if id matches or is a stale cleanup signal
        if (pendingToolCall && (pendingToolCall.id === id || id === '__stale__')) {
            pendingToolCall = null;
        }
        // Also clear if no specific pending tool call (full state reset)
        if (id === '__stale__') {
            pendingToolCall = null;
        }

        // Remove pending class to re-enable normal UI
        document.body.classList.remove('has-pending-toolcall');

        // Hide approval modal and choices bar
        hideApprovalModal();
        hideChoicesBar();

        // Clear any processing/working state
        clearProcessingState();

        // Update the cancelled entry in current session (it will come via updateCurrentSession)
        // but also update locally if we have it
        var idx = currentSessionCalls.findIndex(function(tc) { return tc.id === id; });
        if (idx >= 0) {
            currentSessionCalls[idx].status = 'cancelled';
            currentSessionCalls[idx].response = '[Cancelled by user (Stop button)]';
            renderCurrentSession();
        }

        // Hide the pending message area
        if (pendingMessage) {
            pendingMessage.classList.add('hidden');
            pendingMessage.innerHTML = '';
        }

        // Re-enable the input area
        if (userInput) {
            userInput.disabled = false;
            userInput.focus();
        }

        updateWelcomeSectionVisibility();
    }

    /**
     * Start a timeout to auto-clear processing state if AI doesn't respond
     * This prevents the "Processing your response" from being stuck forever
     */
    function startProcessingTimeout() {
        // Clear any existing timeout
        if (processingTimeoutId) {
            clearTimeout(processingTimeoutId);
        }
        // Start new timeout
        processingTimeoutId = setTimeout(function() {
            if (isProcessingResponse) {
                console.log('[FlowCommand] Processing timeout - auto-clearing stuck processing state');
                clearProcessingState();
            }
            processingTimeoutId = null;
        }, PROCESSING_TIMEOUT_MS);
    }

    /**
     * Cancel the processing timeout (called when new toolCallPending arrives)
     */
    function cancelProcessingTimeout() {
        if (processingTimeoutId) {
            clearTimeout(processingTimeoutId);
            processingTimeoutId = null;
        }
    }

    function renderCurrentSession() {
        if (!toolHistoryArea) return;

        // Only show COMPLETED calls from current session (pending is shown separately as plain text)
        var completedCalls = currentSessionCalls.filter(function (tc) { return tc.status === 'completed'; });

        if (completedCalls.length === 0) {
            toolHistoryArea.innerHTML = '';
            return;
        }

        // Reverse to show oldest first (new items stack at bottom)
        var sortedCalls = completedCalls.slice().reverse();

        var cardsHtml = sortedCalls.map(function (tc, index) {
            // Get first sentence for title - let CSS handle truncation with ellipsis
            var firstSentence = tc.prompt.split(/[.!?]/)[0];
            var truncatedTitle = firstSentence.length > 120 ? firstSentence.substring(0, 120) + '...' : firstSentence;
            var queueBadge = tc.isFromQueue ? '<span class="tool-call-badge queue">Queue</span>' : '';

            // Build card HTML - NO X button for current session cards
            var isLatest = index === sortedCalls.length - 1;
            var cardHtml = '<div class="tool-call-card' + (isLatest ? ' expanded' : '') + '" data-id="' + escapeHtml(tc.id) + '">' +
                '<div class="tool-call-header">' +
                '<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
                '<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
                '<div class="tool-call-header-wrapper">' +
                '<span class="tool-call-title">' + escapeHtml(truncatedTitle) + queueBadge + '</span>' +
                '</div>' +
                '</div>' +
                '<div class="tool-call-body">' +
                (tc.context ? '<div class="tool-call-context"><div class="context-label"><span class="codicon codicon-copilot"></span> AI Response</div><div class="context-content">' + formatMarkdown(tc.context) + '</div></div>' : '') +
                '<div class="tool-call-ai-response">' + formatMarkdown(tc.prompt) + '</div>' +
                '<div class="tool-call-user-section">' +
                '<div class="tool-call-user-response">' + escapeHtml(tc.response) + '</div>' +
                (tc.attachments ? renderAttachmentsHtml(tc.attachments) : '') +
                '</div>' +
                '</div></div>';
            return cardHtml;
        }).join('');

        toolHistoryArea.innerHTML = cardsHtml;

        // Bind events - only expand/collapse, no remove
        toolHistoryArea.querySelectorAll('.tool-call-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                var card = header.closest('.tool-call-card');
                if (card) card.classList.toggle('expanded');
            });
        });

        // Render any mermaid diagrams
        renderMermaidDiagrams();
    }

    function renderHistoryModal() {
        if (!historyModalList) return;

        if (persistedHistory.length === 0) {
            historyModalList.innerHTML = '<div class="history-modal-empty">No history yet</div>';
            if (historyModalClearAll) historyModalClearAll.classList.add('hidden');
            return;
        }

        if (historyModalClearAll) historyModalClearAll.classList.remove('hidden');

        // Helper to render tool call card
        function renderToolCallCard(tc) {
            var firstSentence = tc.prompt.split(/[.!?]/)[0];
            var truncatedTitle = firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
            var queueBadge = tc.isFromQueue ? '<span class="tool-call-badge queue">Queue</span>' : '';

            return '<div class="tool-call-card history-card" data-id="' + escapeHtml(tc.id) + '">' +
                '<div class="tool-call-header">' +
                '<div class="tool-call-chevron"><span class="codicon codicon-chevron-down"></span></div>' +
                '<div class="tool-call-icon"><span class="codicon codicon-copilot"></span></div>' +
                '<div class="tool-call-header-wrapper">' +
                '<span class="tool-call-title">' + escapeHtml(truncatedTitle) + queueBadge + '</span>' +
                '</div>' +
                '<button class="tool-call-remove" data-id="' + escapeHtml(tc.id) + '" title="Remove"><span class="codicon codicon-close"></span></button>' +
                '</div>' +
                '<div class="tool-call-body">' +
                (tc.context ? '<div class="tool-call-context"><div class="context-label"><span class="codicon codicon-copilot"></span> AI Response</div><div class="context-content">' + formatMarkdown(tc.context) + '</div></div>' : '') +
                '<div class="tool-call-ai-response">' + formatMarkdown(tc.prompt) + '</div>' +
                '<div class="tool-call-user-section">' +
                '<div class="tool-call-user-response">' + escapeHtml(tc.response) + '</div>' +
                (tc.attachments ? renderAttachmentsHtml(tc.attachments) : '') +
                '</div>' +
                '</div></div>';
        }

        // Render all history items directly without grouping
        var cardsHtml = '<div class="history-items-list">';
        cardsHtml += persistedHistory.map(renderToolCallCard).join('');
        cardsHtml += '</div>';

        historyModalList.innerHTML = cardsHtml;

        // Bind expand/collapse events
        historyModalList.querySelectorAll('.tool-call-header').forEach(function (header) {
            header.addEventListener('click', function (e) {
                if (e.target.closest('.tool-call-remove')) return;
                var card = header.closest('.tool-call-card');
                if (card) card.classList.toggle('expanded');
            });
        });

        // Bind remove buttons
        historyModalList.querySelectorAll('.tool-call-remove').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                if (id) {
                    vscode.postMessage({ type: 'removeHistoryItem', callId: id });
                    persistedHistory = persistedHistory.filter(function (tc) { return tc.id !== id; });
                    renderHistoryModal();
                }
            });
        });
    }

    // Constants for security and performance limits
    var MARKDOWN_MAX_LENGTH = 100000; // Max markdown input length to prevent ReDoS
    var MAX_TABLE_ROWS = 100; // Max table rows to process

    /**
     * Process a buffer of table lines into HTML table markup (ReDoS-safe implementation)
     * @param {string[]} lines - Array of table row strings
     * @param {number} maxRows - Maximum number of rows to process
     * @returns {string} HTML table markup or original lines joined
     */
    function processTableBuffer(lines, maxRows) {
        if (lines.length < 2) return lines.join('\n');
        if (lines.length > maxRows) return lines.join('\n'); // Skip very large tables

        // Check if second line is separator (contains only |, -, :, spaces)
        var separatorRegex = /^\|[\s\-:|]+\|$/;
        if (!separatorRegex.test(lines[1].trim())) return lines.join('\n');

        // Parse header
        var headerCells = lines[0].split('|').filter(function (c) { return c.trim() !== ''; });
        if (headerCells.length === 0) return lines.join('\n'); // Invalid table

        var headerHtml = '<tr>' + headerCells.map(function (c) {
            return '<th>' + c.trim() + '</th>';
        }).join('') + '</tr>';

        // Parse data rows (skip separator at index 1)
        var bodyHtml = '';
        for (var i = 2; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            var cells = lines[i].split('|').filter(function (c) { return c.trim() !== ''; });
            bodyHtml += '<tr>' + cells.map(function (c) {
                return '<td>' + c.trim() + '</td>';
            }).join('') + '</tr>';
        }

        return '<table class="markdown-table"><thead>' + headerHtml + '</thead><tbody>' + bodyHtml + '</tbody></table>';
    }

    function formatMarkdown(text) {
        if (!text) return '';

        // ReDoS prevention: truncate very long inputs before regex processing
        // This prevents exponential backtracking on crafted inputs (OWASP ReDoS mitigation)
        if (text.length > MARKDOWN_MAX_LENGTH) {
            text = text.substring(0, MARKDOWN_MAX_LENGTH) + '\n... (content truncated for display)';
        }

        // Normalize line endings (Windows \r\n to \n)
        var processedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Store code blocks BEFORE escaping HTML to preserve backticks
        var codeBlocks = [];
        var mermaidBlocks = [];

        // Extract mermaid blocks first (before HTML escaping)
        // Match ```mermaid followed by newline or just content
        processedText = processedText.replace(/```mermaid\s*\n([\s\S]*?)```/g, function (match, code) {
            var index = mermaidBlocks.length;
            mermaidBlocks.push(code.trim());
            return '%%MERMAID' + index + '%%';
        });

        // Extract other code blocks (before HTML escaping)
        // Match ```lang or just ``` followed by optional newline
        processedText = processedText.replace(/```(\w*)\s*\n?([\s\S]*?)```/g, function (match, lang, code) {
            var index = codeBlocks.length;
            codeBlocks.push({ lang: lang || '', code: code.trim() });
            return '%%CODEBLOCK' + index + '%%';
        });

        // Now escape HTML on the remaining text
        var html = escapeHtml(processedText);

        // Headers (## Header) - must be at start of line
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Horizontal rules (--- or ***)
        html = html.replace(/^---+$/gm, '<hr>');
        html = html.replace(/^\*\*\*+$/gm, '<hr>');

        // Blockquotes (> text) - simple single-line support
        html = html.replace(/^&gt;\s*(.*)$/gm, '<blockquote>$1</blockquote>');
        // Merge consecutive blockquotes
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

        // Unordered lists (- item or * item)
        html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
        // Wrap consecutive <li> in <ul>
        html = html.replace(/(<li>.*<\/li>\n?)+/g, function (match) {
            return '<ul>' + match.replace(/\n/g, '') + '</ul>';
        });

        // Ordered lists (1. item)
        html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');
        // Wrap consecutive <oli> in <ol> then convert to li
        html = html.replace(/(<oli>.*<\/oli>\n?)+/g, function (match) {
            return '<ol>' + match.replace(/<oli>/g, '<li>').replace(/<\/oli>/g, '</li>').replace(/\n/g, '') + '</ol>';
        });

        // Markdown tables - SAFE approach to prevent ReDoS
        // Instead of using nested quantifiers with regex (which can cause exponential backtracking),
        // we use a line-by-line processing approach for safety
        var tableLines = html.split('\n');
        var processedLines = [];
        var tableBuffer = [];
        var inTable = false;

        for (var lineIdx = 0; lineIdx < tableLines.length; lineIdx++) {
            var line = tableLines[lineIdx];
            // Check if line looks like a table row (starts and ends with |)
            var isTableRow = /^\|.+\|$/.test(line.trim());

            if (isTableRow) {
                tableBuffer.push(line);
                inTable = true;
            } else {
                if (inTable && tableBuffer.length >= 2) {
                    // Process accumulated table buffer
                    var tableHtml = processTableBuffer(tableBuffer, MAX_TABLE_ROWS);
                    processedLines.push(tableHtml);
                }
                tableBuffer = [];
                inTable = false;
                processedLines.push(line);
            }
        }
        // Handle table at end of content
        if (inTable && tableBuffer.length >= 2) {
            processedLines.push(processTableBuffer(tableBuffer, MAX_TABLE_ROWS));
        }
        html = processedLines.join('\n');

        // Inline code (`code`)
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        // Bold (**text** or __text__)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Italic (*text* or _text_)
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

        // Line breaks - but collapse multiple consecutive breaks
        // Don't add <br> after block elements
        html = html.replace(/\n{3,}/g, '\n\n');
        html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)\n/g, '$1');
        html = html.replace(/\n/g, '<br>');

        // Restore code blocks
        codeBlocks.forEach(function (block, index) {
            var langAttr = block.lang ? ' data-lang="' + block.lang + '"' : '';
            var escapedCode = escapeHtml(block.code);
            var replacement = '<pre class="code-block"' + langAttr + '><code>' + escapedCode + '</code></pre>';
            html = html.replace('%%CODEBLOCK' + index + '%%', replacement);
        });

        // Restore mermaid blocks as diagrams
        mermaidBlocks.forEach(function (code, index) {
            var mermaidId = 'mermaid-' + Date.now() + '-' + index + '-' + Math.random().toString(36).substr(2, 9);
            var replacement = '<div class="mermaid-container" data-mermaid-id="' + mermaidId + '"><div class="mermaid" id="' + mermaidId + '">' + escapeHtml(code) + '</div></div>';
            html = html.replace('%%MERMAID' + index + '%%', replacement);
        });

        // Clean up excessive <br> around block elements
        html = html.replace(/(<br>)+(<pre|<div class="mermaid|<h[1-6]|<ul|<ol|<blockquote|<hr)/g, '$2');
        html = html.replace(/(<\/pre>|<\/div>|<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<hr>)(<br>)+/g, '$1');

        return html;
    }

    // Mermaid rendering - lazy load and render
    var mermaidLoaded = false;
    var mermaidLoading = false;

    function loadMermaid(callback) {
        if (mermaidLoaded) {
            callback();
            return;
        }
        if (mermaidLoading) {
            // Wait for existing load
            var checkInterval = setInterval(function () {
                if (mermaidLoaded) {
                    clearInterval(checkInterval);
                    callback();
                }
            }, 50);
            return;
        }
        mermaidLoading = true;

        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        script.onload = function () {
            window.mermaid.initialize({
                startOnLoad: false,
                theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark',
                securityLevel: 'loose',
                fontFamily: 'var(--vscode-font-family)'
            });
            mermaidLoaded = true;
            mermaidLoading = false;
            callback();
        };
        script.onerror = function () {
            mermaidLoading = false;
            console.error('Failed to load mermaid.js');
        };
        document.head.appendChild(script);
    }

    function renderMermaidDiagrams() {
        var containers = document.querySelectorAll('.mermaid-container:not(.rendered)');
        if (containers.length === 0) return;

        loadMermaid(function () {
            containers.forEach(function (container) {
                var mermaidDiv = container.querySelector('.mermaid');
                if (!mermaidDiv) return;

                var code = mermaidDiv.textContent;
                var id = mermaidDiv.id;

                try {
                    window.mermaid.render(id + '-svg', code).then(function (result) {
                        mermaidDiv.innerHTML = result.svg;
                        container.classList.add('rendered');
                    }).catch(function (err) {
                        // Show code block as fallback on error
                        mermaidDiv.innerHTML = '<pre class="code-block" data-lang="mermaid"><code>' + escapeHtml(code) + '</code></pre>';
                        container.classList.add('rendered', 'error');
                    });
                } catch (err) {
                    mermaidDiv.innerHTML = '<pre class="code-block" data-lang="mermaid"><code>' + escapeHtml(code) + '</code></pre>';
                    container.classList.add('rendered', 'error');
                }
            });
        });
    }

    /**
     * Update welcome section visibility based on current session state
     * Hide welcome when there are completed tool calls or a pending call
     */
    function updateWelcomeSectionVisibility() {
        if (!welcomeSection) return;
        var hasCompletedCalls = currentSessionCalls.some(function (tc) { return tc.status === 'completed'; });
        var hasPendingMessage = pendingMessage && !pendingMessage.classList.contains('hidden');
        var shouldHide = hasCompletedCalls || pendingToolCall !== null || hasPendingMessage;
        welcomeSection.classList.toggle('hidden', shouldHide);
    }

    /**
     * Auto-scroll chat container to bottom
     */
    function scrollToBottom() {
        if (!chatContainer) return;
        // Use requestAnimationFrame to ensure DOM is updated before scrolling
        requestAnimationFrame(function () {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }

    function addToQueue(prompt) {
        if (!prompt || !prompt.trim()) return;
        var id = 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
        // Store attachments with the queue item
        var attachmentsToStore = currentAttachments.length > 0 ? currentAttachments.slice() : undefined;
        promptQueue.push({ id: id, prompt: prompt.trim(), attachments: attachmentsToStore });
        renderQueue();
        // Expand queue section when adding items so user can see what was added
        if (queueSection) queueSection.classList.remove('collapsed');
        // Send to backend with attachments
        vscode.postMessage({ type: 'addQueuePrompt', prompt: prompt.trim(), id: id, attachments: attachmentsToStore || [] });
        // Clear attachments after adding to queue (they're now stored with the queue item)
        currentAttachments = [];
        updateChipsDisplay();
    }

    function removeFromQueue(id) {
        promptQueue = promptQueue.filter(function (item) { return item.id !== id; });
        renderQueue();
        vscode.postMessage({ type: 'removeQueuePrompt', promptId: id });
    }

    function renderQueue() {
        if (!queueList) return;
        if (queueCount) queueCount.textContent = promptQueue.length;

        // Update visibility based on queue state
        updateQueueVisibility();

        if (promptQueue.length === 0) {
            queueList.innerHTML = '<div class="queue-empty">No prompts in queue</div>';
            return;
        }

        queueList.innerHTML = promptQueue.map(function (item, index) {
            var bulletClass = index === 0 ? 'active' : 'pending';
            var truncatedPrompt = item.prompt.length > 80 ? item.prompt.substring(0, 80) + '...' : item.prompt;
            // Show attachment indicator if this queue item has attachments
            var attachmentBadge = (item.attachments && item.attachments.length > 0)
                ? '<span class="queue-item-attachment-badge" title="' + item.attachments.length + ' attachment(s)" aria-label="' + item.attachments.length + ' attachments"><span class="codicon codicon-file-media" aria-hidden="true"></span></span>'
                : '';
            return '<div class="queue-item" data-id="' + escapeHtml(item.id) + '" data-index="' + index + '" tabindex="0" draggable="true" role="listitem" aria-label="Queue item ' + (index + 1) + ': ' + escapeHtml(truncatedPrompt) + '">' +
                '<span class="bullet ' + bulletClass + '" aria-hidden="true"></span>' +
                '<span class="text" title="' + escapeHtml(item.prompt) + '">' + (index + 1) + '. ' + escapeHtml(truncatedPrompt) + '</span>' +
                attachmentBadge +
                '<div class="queue-item-actions">' +
                '<button class="edit-btn" data-id="' + escapeHtml(item.id) + '" title="Edit" aria-label="Edit queue item ' + (index + 1) + '"><span class="codicon codicon-edit" aria-hidden="true"></span></button>' +
                '<button class="remove-btn" data-id="' + escapeHtml(item.id) + '" title="Remove" aria-label="Remove queue item ' + (index + 1) + '"><span class="codicon codicon-close" aria-hidden="true"></span></button>' +
                '</div></div>';
        }).join('');

        queueList.querySelectorAll('.remove-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                if (id) removeFromQueue(id);
            });
        });

        queueList.querySelectorAll('.edit-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                if (id) startEditPrompt(id);
            });
        });

        bindDragAndDrop();
        bindKeyboardNavigation();
    }

    function startEditPrompt(id) {
        // Cancel any existing edit first
        if (editingPromptId && editingPromptId !== id) {
            cancelEditMode();
        }

        var item = promptQueue.find(function (p) { return p.id === id; });
        if (!item) return;

        // Save current state
        editingPromptId = id;
        editingOriginalPrompt = item.prompt;
        savedInputValue = chatInput ? chatInput.value : '';

        // Mark queue item as being edited
        var queueItem = queueList.querySelector('.queue-item[data-id="' + id + '"]');
        if (queueItem) {
            queueItem.classList.add('editing');
        }

        // Switch to edit mode UI
        enterEditMode(item.prompt);
    }

    function enterEditMode(promptText) {
        // Hide normal actions, show edit actions
        if (actionsLeft) actionsLeft.classList.add('hidden');
        if (sendBtn) sendBtn.classList.add('hidden');
        if (editActionsContainer) editActionsContainer.classList.remove('hidden');

        // Mark input container as in edit mode
        if (inputContainer) {
            inputContainer.classList.add('edit-mode');
            inputContainer.setAttribute('aria-label', 'Editing queue prompt');
        }

        // Set input value to the prompt being edited
        if (chatInput) {
            chatInput.value = promptText;
            chatInput.setAttribute('aria-label', 'Edit prompt text. Press Enter to confirm, Escape to cancel.');
            chatInput.focus();
            // Move cursor to end
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
            autoResizeTextarea();
        }
    }

    function exitEditMode() {
        // Show normal actions, hide edit actions
        if (actionsLeft) actionsLeft.classList.remove('hidden');
        if (sendBtn) sendBtn.classList.remove('hidden');
        if (editActionsContainer) editActionsContainer.classList.add('hidden');

        // Remove edit mode class from input container
        if (inputContainer) {
            inputContainer.classList.remove('edit-mode');
            inputContainer.removeAttribute('aria-label');
        }

        // Remove editing class from queue item
        if (queueList) {
            var editingItem = queueList.querySelector('.queue-item.editing');
            if (editingItem) editingItem.classList.remove('editing');
        }

        // Restore original input value and accessibility
        if (chatInput) {
            chatInput.value = savedInputValue;
            chatInput.setAttribute('aria-label', 'Message input');
            autoResizeTextarea();
        }

        // Reset edit state
        editingPromptId = null;
        editingOriginalPrompt = null;
        savedInputValue = '';
    }

    function confirmEditMode() {
        if (!editingPromptId) return;

        var newValue = chatInput ? chatInput.value.trim() : '';

        if (!newValue) {
            // If empty, remove the prompt
            removeFromQueue(editingPromptId);
        } else if (newValue !== editingOriginalPrompt) {
            // Update the prompt
            var item = promptQueue.find(function (p) { return p.id === editingPromptId; });
            if (item) {
                item.prompt = newValue;
                vscode.postMessage({ type: 'editQueuePrompt', promptId: editingPromptId, newPrompt: newValue });
            }
        }

        // Clear saved input - we don't want to restore old value after editing
        savedInputValue = '';

        exitEditMode();
        renderQueue();
    }

    function cancelEditMode() {
        exitEditMode();
        renderQueue();
    }

    /**
     * Handle "accept" button click in approval modal
     * Sends "yes" as the response
     */
    function handleApprovalContinue() {
        if (!pendingToolCall) return;

        // Hide approval modal
        hideApprovalModal();

        // Send affirmative response
        vscode.postMessage({ type: 'submit', value: 'yes', attachments: [] });
        if (chatInput) {
            chatInput.value = '';
            chatInput.style.height = 'auto';
            updateInputHighlighter();
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        saveWebviewState();
    }

    /**
     * Handle "No" button click in approval modal
     * Dismisses modal and focuses input for custom response
     */
    function handleApprovalNo() {
        // Hide approval modal but keep pending state
        hideApprovalModal();

        // Focus input for custom response
        if (chatInput) {
            chatInput.focus();
            // Optionally pre-fill with "No, " to help user
            if (!chatInput.value.trim()) {
                chatInput.value = 'No, ';
                chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
            }
            autoResizeTextarea();
            updateInputHighlighter();
            updateSendButtonState();
            saveWebviewState();
        }
    }

    /**
     * Handle End Session button click (always visible in actions bar)
     * - If there's a pending request: send "end" immediately
     * - If no pending request: add "end" to the queue
     */
    function handleEndSessionClick() {
        if (pendingToolCall) {
            // There's a pending request - send "end" immediately
            hideApprovalModal();
            hideChoicesBar();
            vscode.postMessage({ type: 'submit', value: 'end', attachments: [] });
            if (chatInput) {
                chatInput.value = '';
                chatInput.style.height = 'auto';
                updateInputHighlighter();
            }
            currentAttachments = [];
            updateChipsDisplay();
            updateSendButtonState();
            saveWebviewState();
        } else {
            // No pending request - add "end" to queue so it's processed after current task
            addToQueue('end');
            // Update UI to show "end" is queued
            if (endSessionBtn) {
                endSessionBtn.classList.add('active');
            }
            // Clear input
            if (chatInput) {
                chatInput.value = '';
                chatInput.style.height = 'auto';
                updateInputHighlighter();
            }
            currentAttachments = [];
            updateChipsDisplay();
            updateSendButtonState();
            saveWebviewState();
        }
    }

    /**
     * Show approval modal
     */
    function showApprovalModal() {
        if (!approvalModal) return;
        approvalModal.classList.remove('hidden');
        // Focus chat input instead of Yes button to prevent accidental Enter approvals
        // User can still click Yes/No or use keyboard navigation
        if (chatInput) {
            chatInput.focus();
        }
    }

    /**
     * Hide approval modal
     */
    function hideApprovalModal() {
        if (!approvalModal) return;
        approvalModal.classList.add('hidden');
        isApprovalQuestion = false;
    }

    /**
     * Show choices bar with dynamic buttons based on parsed choices
     */
    function showChoicesBar() {
        // Hide approval modal first
        hideApprovalModal();

        // Create or get choices bar
        var choicesBar = document.getElementById('choices-bar');
        if (!choicesBar) {
            choicesBar = document.createElement('div');
            choicesBar.className = 'choices-bar';
            choicesBar.id = 'choices-bar';
            choicesBar.setAttribute('role', 'toolbar');
            choicesBar.setAttribute('aria-label', 'Quick choice options');

            // Insert at top of input-wrapper
            var inputWrapper = document.getElementById('input-wrapper');
            if (inputWrapper) {
                inputWrapper.insertBefore(choicesBar, inputWrapper.firstChild);
            }
        }

        // Build choice buttons
        var buttonsHtml = currentChoices.map(function (choice, index) {
            var shortLabel = choice.shortLabel || choice.value;
            var title = choice.label || choice.value;
            return '<button class="choice-btn" data-value="' + escapeHtml(choice.value) + '" ' +
                'data-index="' + index + '" title="' + escapeHtml(title) + '">' +
                escapeHtml(shortLabel) + '</button>';
        }).join('');

        choicesBar.innerHTML = '<span class="choices-label">Choose:</span>' +
            '<div class="choices-buttons">' + buttonsHtml + '</div>';

        // Bind click events to choice buttons
        choicesBar.querySelectorAll('.choice-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var value = btn.getAttribute('data-value');
                handleChoiceClick(value);
            });
        });

        choicesBar.classList.remove('hidden');

        // Don't auto-focus buttons - let user click or use keyboard
        // Focus the chat input instead for immediate typing
        if (chatInput) {
            chatInput.focus();
        }
    }

    /**
     * Hide choices bar
     */
    function hideChoicesBar() {
        var choicesBar = document.getElementById('choices-bar');
        if (choicesBar) {
            choicesBar.classList.add('hidden');
        }
        currentChoices = [];
    }

    /**
     * Handle choice button click
     */
    function handleChoiceClick(value) {
        if (!pendingToolCall) return;

        // Hide choices bar
        hideChoicesBar();

        // Send the choice value as response
        vscode.postMessage({ type: 'submit', value: value, attachments: [] });
        if (chatInput) {
            chatInput.value = '';
            chatInput.style.height = 'auto';
            updateInputHighlighter();
        }
        currentAttachments = [];
        updateChipsDisplay();
        updateSendButtonState();
        saveWebviewState();
    }

    // ===== SETTINGS MODAL FUNCTIONS =====

    function openSettingsModal() {
        if (!settingsModalOverlay) return;
        vscode.postMessage({ type: 'openSettingsModal' });
        settingsModalOverlay.classList.remove('hidden');
    }

    function closeSettingsModal() {
        if (!settingsModalOverlay) return;
        settingsModalOverlay.classList.add('hidden');
    }

    function toggleSoundSetting() {
        soundEnabled = !soundEnabled;
        updateSoundToggleUI();
        vscode.postMessage({ type: 'updateSoundSetting', enabled: soundEnabled });
    }

    function updateSoundToggleUI() {
        if (!soundToggle) return;
        soundToggle.classList.toggle('active', soundEnabled);
        soundToggle.setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
    }

    function toggleDesktopNotificationSetting() {
        desktopNotificationEnabled = !desktopNotificationEnabled;
        updateDesktopNotificationToggleUI();
        vscode.postMessage({ type: 'updateDesktopNotificationSetting', enabled: desktopNotificationEnabled });
    }

    function updateDesktopNotificationToggleUI() {
        if (!desktopNotificationToggle) return;
        desktopNotificationToggle.classList.toggle('active', desktopNotificationEnabled);
        desktopNotificationToggle.setAttribute('aria-checked', desktopNotificationEnabled ? 'true' : 'false');
    }

    function toggleAutoFocusPanelSetting() {
        autoFocusPanelEnabled = !autoFocusPanelEnabled;
        updateAutoFocusPanelToggleUI();
        vscode.postMessage({ type: 'updateAutoFocusPanelSetting', enabled: autoFocusPanelEnabled });
    }

    function updateAutoFocusPanelToggleUI() {
        if (!autoFocusPanelToggle) return;
        autoFocusPanelToggle.classList.toggle('active', autoFocusPanelEnabled);
        autoFocusPanelToggle.setAttribute('aria-checked', autoFocusPanelEnabled ? 'true' : 'false');
    }

    function toggleMobileNotificationSetting() {
        mobileNotificationEnabled = !mobileNotificationEnabled;
        updateMobileNotificationToggleUI();
        // Request notification permission immediately on user gesture (required by browsers)
        if (mobileNotificationEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().then(function(permission) {
                console.log('[FlowCommand] Notification permission:', permission);
            });
        }
        vscode.postMessage({ type: 'updateMobileNotificationSetting', enabled: mobileNotificationEnabled });
    }

    function updateMobileNotificationToggleUI() {
        if (!mobileNotificationToggle) return;
        mobileNotificationToggle.classList.toggle('active', mobileNotificationEnabled);
        mobileNotificationToggle.setAttribute('aria-checked', mobileNotificationEnabled ? 'true' : 'false');
    }

    function toggleInteractiveApprovalSetting() {
        interactiveApprovalEnabled = !interactiveApprovalEnabled;
        updateInteractiveApprovalToggleUI();
        vscode.postMessage({ type: 'updateInteractiveApprovalSetting', enabled: interactiveApprovalEnabled });
    }

    function updateInteractiveApprovalToggleUI() {
        if (!interactiveApprovalToggle) return;
        interactiveApprovalToggle.classList.toggle('active', interactiveApprovalEnabled);
        interactiveApprovalToggle.setAttribute('aria-checked', interactiveApprovalEnabled ? 'true' : 'false');
    }

    function updateInstructionUI() {
        if (instructionInjectionSelect && instructionInjection !== 'off') {
            instructionInjectionSelect.value = instructionInjection;
        }
        if (instructionTextArea) {
            instructionTextArea.value = instructionText;
        }
        if (instructionReinjectBtn) {
            var needsReinject = instructionInjection !== 'off' &&
                (instructionState === 'modified' || instructionState === 'missing' || instructionState === 'corrupted' || instructionState === 'no-file');
            instructionReinjectBtn.style.display = needsReinject ? 'inline-flex' : 'none';
        }
        if (instructionStatus) {
            if (instructionInjection === 'off') {
                instructionStatus.innerHTML = '<span style="color:var(--vscode-descriptionForeground);">Status: Not injected</span>';
            } else if (instructionState === 'correct') {
                if (instructionInjection === 'copilotInstructionsMd') {
                    instructionStatus.innerHTML = '<span style="color:var(--vscode-charts-green, #89d185);"><span class="codicon codicon-check"></span> Injected into .github/copilot-instructions.md (workspace)</span>';
                } else if (instructionInjection === 'codeGenerationSetting') {
                    instructionStatus.innerHTML = '<span style="color:var(--vscode-charts-green, #89d185);"><span class="codicon codicon-check"></span> Injected into Code Generation settings (workspace)</span>';
                }
            } else if (instructionState === 'modified') {
                instructionStatus.innerHTML = '<span style="color:var(--vscode-charts-yellow, #d7ba7d);"><span class="codicon codicon-warning"></span> Instructions were modified. Re-inject to restore FlowCommand defaults.</span>';
            } else if (instructionState === 'missing' || instructionState === 'no-file') {
                instructionStatus.innerHTML = '<span style="color:var(--vscode-charts-yellow, #d7ba7d);"><span class="codicon codicon-warning"></span> Instructions missing. Re-inject to restore FlowCommand defaults.</span>';
            } else if (instructionState === 'corrupted') {
                instructionStatus.innerHTML = '<span style="color:var(--vscode-errorForeground);"><span class="codicon codicon-error"></span> Instruction markers corrupted. Re-inject to fix.</span>';
            } else {
                instructionStatus.innerHTML = '<span style="color:var(--vscode-descriptionForeground);">Status: Unknown</span>';
            }
        }
    }

    function updateMcpUI() {
        if (mcpStatusText) {
            if (mcpRunning) {
                mcpStatusText.innerHTML = '<span style="color:var(--vscode-charts-green, #89d185);"><span class="codicon codicon-check"></span> Running</span>';
            } else {
                mcpStatusText.innerHTML = '<span style="color:var(--vscode-descriptionForeground);">Stopped</span>';
            }
        }
        if (mcpUrlText) {
            mcpUrlText.textContent = mcpUrl || 'Not available';
        }
        if (mcpToggleBtn) {
            mcpToggleBtn.textContent = mcpRunning ? 'Stop' : 'Start';
        }
    }

    // ===== PLAN REVIEW MODAL (for remote/sidebar) =====

    var activePlanReview = null; // { reviewId, overlay, comments }

    function showPlanReviewModal(reviewId, title, plan) {
        // Close existing if any
        if (activePlanReview) {
            closePlanReviewModal(activePlanReview.reviewId);
        }

        var comments = [];
        var overlay = document.createElement('div');
        overlay.className = 'plan-review-overlay';
        overlay.innerHTML =
            '<div class="plan-review-modal">' +
            // Header
            '<div class="plan-review-header">' +
            '<span class="plan-review-title">' + escapeHtml(title || 'Plan Review') + '</span>' +
            '<span class="plan-review-badge">Review</span>' +
            '<button class="plan-review-close-btn" id="pr-close-' + reviewId + '" title="Cancel review"><span class="codicon codicon-close"></span></button>' +
            '</div>' +
            // Split content area: plan left, comments right
            '<div class="plan-review-content">' +
            '<div class="plan-review-body" id="pr-body-' + reviewId + '"></div>' +
            '<div class="plan-review-sidebar" id="pr-sidebar-' + reviewId + '">' +
            '<div class="plan-review-comments-header">' +
            'Comments <span class="plan-review-comments-count" id="pr-count-' + reviewId + '">0</span>' +
            '<button class="plan-review-clear-all hidden" id="pr-clear-all-' + reviewId + '" title="Clear all comments">Clear All</button>' +
            '</div>' +
            '<div class="plan-review-comments-list" id="pr-clist-' + reviewId + '">' +
            '<div class="plan-review-no-comments">No comments yet. Click the <span class="codicon codicon-comment"></span> icon next to any section to add feedback.</div>' +
            '</div>' +
            '<div class="plan-review-add-comment">' +
            '<textarea class="form-input form-textarea" id="pr-comment-input-' + reviewId + '" placeholder="Your feedback or revision instructions..." rows="2"></textarea>' +
            '<input class="form-input" id="pr-comment-part-' + reviewId + '" placeholder="Which part? (e.g., Step 3)" />' +
            '<button class="form-btn form-btn-save" id="pr-add-comment-' + reviewId + '">Add Comment</button>' +
            '</div>' +
            '</div>' +
            '</div>' +
            // Footer
            '<div class="plan-review-footer">' +
            '<button class="form-btn form-btn-cancel" id="pr-cancel-' + reviewId + '">Cancel</button>' +
            '<div class="plan-review-footer-right">' +
            '<button class="form-btn form-btn-cancel" id="pr-reject-' + reviewId + '" disabled>Request Changes</button>' +
            '<button class="form-btn form-btn-save" id="pr-approve-' + reviewId + '">Approve</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // Render plan content with inline comment icons
        var bodyEl = document.getElementById('pr-body-' + reviewId);
        if (bodyEl) {
            bodyEl.innerHTML = formatMarkdown(plan || '');
            // Wrap hoverable sections with comment icons
            var elements = bodyEl.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, tr');
            elements.forEach(function (el) {
                if (el.closest('pre') || el.closest('code')) return;
                if (el.parentElement && el.parentElement.classList.contains('pr-line-wrapper')) return;

                var wrapper = document.createElement('div');
                wrapper.className = 'pr-line-wrapper';
                var textContent = (el.textContent || '').substring(0, 200);
                wrapper.setAttribute('data-text', textContent);

                var commentBtn = document.createElement('button');
                commentBtn.className = 'pr-comment-icon';
                commentBtn.innerHTML = '<span class="codicon codicon-comment"></span>';
                commentBtn.title = 'Add comment on this section';
                commentBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var partInput = document.getElementById('pr-comment-part-' + reviewId);
                    var commentInput = document.getElementById('pr-comment-input-' + reviewId);
                    if (partInput) partInput.value = textContent.substring(0, 80);
                    if (commentInput) commentInput.focus();
                    // Scroll sidebar to bottom to show the input
                    var sidebar = document.getElementById('pr-sidebar-' + reviewId);
                    if (sidebar) sidebar.scrollTop = sidebar.scrollHeight;
                });

                el.parentNode.insertBefore(wrapper, el);
                wrapper.appendChild(commentBtn);
                wrapper.appendChild(el);
            });
        }

        activePlanReview = { reviewId: reviewId, overlay: overlay, comments: comments };

        // Bind events
        var approveBtn = document.getElementById('pr-approve-' + reviewId);
        var rejectBtn = document.getElementById('pr-reject-' + reviewId);
        var cancelBtn = document.getElementById('pr-cancel-' + reviewId);
        var closeBtn = document.getElementById('pr-close-' + reviewId);
        var addCommentBtn = document.getElementById('pr-add-comment-' + reviewId);
        var clearAllBtn = document.getElementById('pr-clear-all-' + reviewId);

        if (approveBtn) {
            approveBtn.addEventListener('click', function () {
                var action = comments.length > 0 ? 'approvedWithComments' : 'approved';
                vscode.postMessage({ type: 'planReviewResponse', reviewId: reviewId, action: action, revisions: comments });
                closePlanReviewModal(reviewId);
            });
        }

        if (rejectBtn) {
            rejectBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'planReviewResponse', reviewId: reviewId, action: 'recreateWithChanges', revisions: comments });
                closePlanReviewModal(reviewId);
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'planReviewResponse', reviewId: reviewId, action: 'closed', revisions: comments });
                closePlanReviewModal(reviewId);
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'planReviewResponse', reviewId: reviewId, action: 'closed', revisions: comments });
                closePlanReviewModal(reviewId);
            });
        }

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', function () {
                comments.length = 0;
                renderPlanReviewComments(reviewId, comments);
                updatePlanReviewButtons(reviewId, comments);
                updatePlanReviewLineHighlights(reviewId, comments);
            });
        }

        if (addCommentBtn) {
            addCommentBtn.addEventListener('click', function () {
                var commentInput = document.getElementById('pr-comment-input-' + reviewId);
                var partInput = document.getElementById('pr-comment-part-' + reviewId);
                if (!commentInput || !partInput) return;
                var instruction = commentInput.value.trim();
                var part = partInput.value.trim();
                if (!instruction) return;
                comments.push({ revisedPart: part || '(general)', revisorInstructions: instruction });
                commentInput.value = '';
                partInput.value = '';
                renderPlanReviewComments(reviewId, comments);
                updatePlanReviewButtons(reviewId, comments);
                updatePlanReviewLineHighlights(reviewId, comments);
            });
        }

        // Keyboard support
        var commentInput = document.getElementById('pr-comment-input-' + reviewId);
        var partInput = document.getElementById('pr-comment-part-' + reviewId);

        // Enter in part input moves focus to comment input
        if (partInput) {
            partInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (commentInput) commentInput.focus();
                }
            });
        }

        // Enter in comment input adds the comment (Shift+Enter for new line)
        if (commentInput) {
            commentInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    // Trigger the add comment button click
                    var addBtn = document.getElementById('pr-add-comment-' + reviewId);
                    if (addBtn) addBtn.click();
                }
            });
        }
    }

    function updatePlanReviewButtons(reviewId, comments) {
        var rejectBtn = document.getElementById('pr-reject-' + reviewId);
        var approveBtn = document.getElementById('pr-approve-' + reviewId);
        var clearAllBtn = document.getElementById('pr-clear-all-' + reviewId);
        if (rejectBtn) rejectBtn.disabled = comments.length === 0;
        if (approveBtn) approveBtn.textContent = comments.length > 0 ? 'Approve with Comments' : 'Approve';
        if (clearAllBtn) {
            if (comments.length > 0) clearAllBtn.classList.remove('hidden');
            else clearAllBtn.classList.add('hidden');
        }
    }

    function updatePlanReviewLineHighlights(reviewId, comments) {
        var bodyEl = document.getElementById('pr-body-' + reviewId);
        if (!bodyEl) return;
        // Clear all highlights
        bodyEl.querySelectorAll('.pr-line-wrapper.has-comment').forEach(function (el) {
            el.classList.remove('has-comment');
        });
        // Highlight lines that have comments
        comments.forEach(function (comment) {
            bodyEl.querySelectorAll('.pr-line-wrapper').forEach(function (wrapper) {
                var wrapperText = wrapper.getAttribute('data-text') || '';
                if (wrapperText && comment.revisedPart.includes(wrapperText.substring(0, 50))) {
                    wrapper.classList.add('has-comment');
                }
            });
        });
    }

    function renderPlanReviewComments(reviewId, comments) {
        var countEl = document.getElementById('pr-count-' + reviewId);
        var listEl = document.getElementById('pr-clist-' + reviewId);
        if (countEl) countEl.textContent = comments.length;
        if (!listEl) return;

        if (comments.length === 0) {
            listEl.innerHTML = '<div class="plan-review-no-comments">No comments yet. Click the <span class="codicon codicon-comment"></span> icon next to any section to add feedback.</div>';
            return;
        }

        listEl.innerHTML = comments.map(function (c, i) {
            return '<div class="plan-review-comment-item">' +
                '<div class="pr-comment-citation">' + escapeHtml(c.revisedPart) + '</div>' +
                '<div class="pr-comment-text">' + escapeHtml(c.revisorInstructions) + '</div>' +
                '<div class="pr-comment-actions">' +
                '<button class="pr-remove-comment" data-index="' + i + '">Remove</button>' +
                '</div>' +
                '</div>';
        }).join('');

        // Bind remove buttons
        listEl.querySelectorAll('.pr-remove-comment').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-index'));
                comments.splice(idx, 1);
                renderPlanReviewComments(reviewId, comments);
                updatePlanReviewButtons(reviewId, comments);
                updatePlanReviewLineHighlights(reviewId, comments);
            });
        });
    }

    function closePlanReviewModal(reviewId) {
        console.log('[FlowCommand] closePlanReviewModal called with:', reviewId, 'activePlanReview:', activePlanReview ? activePlanReview.reviewId : null);
        if (!activePlanReview || activePlanReview.reviewId !== reviewId) {
            console.log('[FlowCommand] closePlanReviewModal: no matching modal to close');
            return;
        }
        if (activePlanReview.overlay && activePlanReview.overlay.parentNode) {
            activePlanReview.overlay.parentNode.removeChild(activePlanReview.overlay);
        }
        activePlanReview = null;
        console.log('[FlowCommand] closePlanReviewModal: modal closed');
    }

    // Multi-question inline display (replacing modal approach)
    var activeMultiQuestion = null;

    function showMultiQuestionModal(requestId, questions) {
        // Input validation - prevent hangs from malformed data
        if (!requestId || !questions || !Array.isArray(questions) || questions.length === 0) {
            console.error('[FlowCommand] showMultiQuestionModal: invalid input', requestId, questions);
            // Send empty response to unblock the AI
            vscode.postMessage({ type: 'multiQuestionResponse', requestId: requestId || 'invalid', answers: [], cancelled: true });
            return;
        }

        // Close existing if any
        if (activeMultiQuestion) {
            closeMultiQuestionModal(activeMultiQuestion.requestId);
        }

        // Cancel any pending processing timeout since AI is now asking a question
        cancelProcessingTimeout();
        
        // Hide welcome section
        if (welcomeSection) {
            welcomeSection.classList.add('hidden');
        }

        // Add pending class to disable session switching UI
        document.body.classList.add('has-pending-toolcall');

        // Sanitize and limit questions to prevent UI issues
        var safeQuestions = questions.slice(0, 10).map(function(q) {
            return {
                header: String(q.header || 'Question').substring(0, 50),
                question: String(q.question || '').substring(0, 2000),
                options: Array.isArray(q.options) ? q.options.slice(0, 20) : null,
                multiSelect: Boolean(q.multiSelect),
                allowFreeformInput: Boolean(q.allowFreeformInput)
            };
        });

        // Track answers for each question
        var answers = safeQuestions.map(function (q) {
            return { header: q.header, selected: [], freeformText: '' };
        });

        // Build inline questions HTML
        var questionsHtml = safeQuestions.map(function (q, qIndex) {
            var optionsHtml = '';
            
            if (q.options && q.options.length > 0) {
                // Render options as radio buttons or checkboxes
                var inputType = q.multiSelect ? 'checkbox' : 'radio';
                optionsHtml = q.options.map(function (opt, oIndex) {
                    var recommendedBadge = opt.recommended ? '<span class="mq-recommended">recommended</span>' : '';
                    var description = opt.description ? '<span class="mq-option-desc">' + escapeHtml(opt.description) + '</span>' : '';
                    return '<label class="mq-option' + (opt.recommended ? ' mq-option-recommended' : '') + '">' +
                        '<input type="' + inputType + '" name="mq-q' + qIndex + '" value="' + escapeHtml(opt.label) + '" data-qindex="' + qIndex + '" data-oindex="' + oIndex + '" />' +
                        '<span class="mq-option-label">' + escapeHtml(opt.label) + recommendedBadge + '</span>' +
                        description +
                        '</label>';
                }).join('');
                
                // Add "Other" option with text input
                optionsHtml += '<label class="mq-option mq-option-other">' +
                    '<input type="' + inputType + '" name="mq-q' + qIndex + '" value="__other__" data-qindex="' + qIndex + '" data-other="true" />' +
                    '<span class="mq-option-label">Other:</span>' +
                    '<input type="text" class="mq-other-input" id="mq-other-' + qIndex + '" placeholder="Type your answer..." disabled />' +
                    '</label>';
            }
            
            // Freeform input (always shown if allowFreeformInput, or if no options)
            var freeformHtml = '';
            if (!q.options || q.options.length === 0 || q.allowFreeformInput) {
                var placeholder = q.options && q.options.length > 0 ? 'Additional details (optional)...' : 'Type your answer...';
                freeformHtml = '<textarea class="mq-freeform" id="mq-freeform-' + qIndex + '" data-qindex="' + qIndex + '" placeholder="' + placeholder + '" rows="2"></textarea>';
            }
            
            return '<div class="mq-question" data-qindex="' + qIndex + '">' +
                '<div class="mq-question-header">' +
                '<span class="mq-question-number">' + (qIndex + 1) + '</span>' +
                '<span class="mq-question-label">' + escapeHtml(q.header) + '</span>' +
                '</div>' +
                '<div class="mq-question-text">' + escapeHtml(q.question) + '</div>' +
                '<div class="mq-options">' + optionsHtml + '</div>' +
                freeformHtml +
                '</div>';
        }).join('');

        // Render questions inline in pendingMessage area
        if (pendingMessage) {
            pendingMessage.classList.remove('hidden');
            pendingMessage.innerHTML = 
                '<div class="mq-inline-container" id="mq-container-' + requestId + '">' +
                '<div class="mq-inline-header">' +
                '<span class="codicon codicon-copilot"></span>' +
                '<span class="mq-inline-title">AI has questions for you</span>' +
                '</div>' +
                '<div class="mq-inline-content">' + questionsHtml + '</div>' +
                '<div class="mq-inline-footer">' +
                '<button class="form-btn form-btn-cancel" id="mq-cancel-' + requestId + '">Cancel</button>' +
                '<button class="form-btn form-btn-save" id="mq-submit-' + requestId + '">Submit</button>' +
                '</div>' +
                '</div>';
        }

        activeMultiQuestion = { requestId: requestId, answers: answers, questions: safeQuestions };

        // Bind option change events
        var container = document.getElementById('mq-container-' + requestId);
        if (container) {
            container.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function (input) {
                input.addEventListener('change', function () {
                    var qIndex = parseInt(input.getAttribute('data-qindex'), 10);
                    if (isNaN(qIndex) || qIndex < 0 || qIndex >= safeQuestions.length) return;
                    
                    var isOther = input.getAttribute('data-other') === 'true';
                    var otherInput = document.getElementById('mq-other-' + qIndex);
                    
                    if (safeQuestions[qIndex].multiSelect) {
                        // Checkbox: toggle in array
                        if (input.checked) {
                            if (isOther) {
                                if (otherInput) otherInput.disabled = false;
                            } else {
                                answers[qIndex].selected.push(input.value);
                            }
                        } else {
                            if (isOther) {
                                if (otherInput) {
                                    otherInput.disabled = true;
                                    otherInput.value = '';
                                }
                                answers[qIndex].selected = answers[qIndex].selected.filter(function(v) { return !v.startsWith('Other: '); });
                            } else {
                                answers[qIndex].selected = answers[qIndex].selected.filter(function (v) { return v !== input.value; });
                            }
                        }
                    } else {
                        // Radio: replace
                        if (isOther) {
                            answers[qIndex].selected = [];
                            if (otherInput) otherInput.disabled = false;
                        } else {
                            answers[qIndex].selected = [input.value];
                            if (otherInput) {
                                otherInput.disabled = true;
                                otherInput.value = '';
                            }
                        }
                    }
                });
            });

            // Bind "Other" text input changes
            container.querySelectorAll('.mq-other-input').forEach(function (input) {
                input.addEventListener('input', function () {
                    var qIndex = parseInt(input.id.replace('mq-other-', ''), 10);
                    if (isNaN(qIndex) || qIndex < 0 || qIndex >= answers.length) return;
                    var otherValue = input.value.trim().substring(0, 500); // Limit length
                    // Remove any previous "Other: ..." value
                    answers[qIndex].selected = answers[qIndex].selected.filter(function(v) { return !v.startsWith('Other: '); });
                    if (otherValue) {
                        answers[qIndex].selected.push('Other: ' + otherValue);
                    }
                });
            });

            // Bind freeform textarea changes
            container.querySelectorAll('.mq-freeform').forEach(function (textarea) {
                textarea.addEventListener('input', function () {
                    var qIndex = parseInt(textarea.getAttribute('data-qindex'), 10);
                    if (isNaN(qIndex) || qIndex < 0 || qIndex >= answers.length) return;
                    answers[qIndex].freeformText = textarea.value.substring(0, 5000); // Limit length
                });
            });

            // Bind submit button
            var submitBtn = document.getElementById('mq-submit-' + requestId);
            if (submitBtn) {
                submitBtn.addEventListener('click', function () {
                    vscode.postMessage({ type: 'multiQuestionResponse', requestId: requestId, answers: answers });
                    closeMultiQuestionModal(requestId);
                });
            }

            // Bind cancel button
            var cancelBtn = document.getElementById('mq-cancel-' + requestId);
            if (cancelBtn) {
                cancelBtn.addEventListener('click', function () {
                    vscode.postMessage({ type: 'multiQuestionResponse', requestId: requestId, answers: [], cancelled: true });
                    closeMultiQuestionModal(requestId);
                });
            }
        }

        // Re-render current session
        renderCurrentSession();
        // Auto-scroll to show the questions
        scrollToBottom();
    }

    function closeMultiQuestionModal(requestId) {
        if (!activeMultiQuestion || activeMultiQuestion.requestId !== requestId) return;
        
        // Remove inline content from pendingMessage
        var container = document.getElementById('mq-container-' + requestId);
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        
        // Hide pendingMessage if empty
        if (pendingMessage && pendingMessage.innerHTML.trim() === '') {
            pendingMessage.classList.add('hidden');
        }
        
        // Remove pending class
        document.body.classList.remove('has-pending-toolcall');
        
        activeMultiQuestion = null;
    }

    function renderPromptsList() {
        // Render full card list in prompts modal
        renderPromptsModalList();
    }

    function renderPromptsModalList() {
        if (!promptsModalList) return;

        if (reusablePrompts.length === 0) {
            promptsModalList.innerHTML = '<div class="prompts-modal-empty"><span class="codicon codicon-symbol-keyword"></span><p>No prompts yet</p><p class="prompts-modal-empty-hint">Add a prompt with the <span class="codicon codicon-add"></span> button above.<br>Use <code>/name</code> in the input to expand it.</p></div>';
            return;
        }

        promptsModalList.innerHTML = reusablePrompts.map(function (p, index) {
            var promptPreview = p.prompt.length > 60 ? p.prompt.substring(0, 60) + '...' : p.prompt;
            var templateBtnTitle = p.isTemplate ? 'Unset Template' : 'Set as Template';
            var templateBtnClass = p.isTemplate ? 'pm-template-btn active' : 'pm-template-btn';
            return '<div class="prompt-card' + (p.isTemplate ? ' is-template' : '') + '" data-id="' + escapeHtml(p.id) + '">' +
                '<div class="prompt-card-header">' +
                '<span class="prompt-card-name">/' + escapeHtml(p.name) + '</span>' +
                '<span class="prompt-card-preview">' + escapeHtml(promptPreview) + '</span>' +
                '<div class="prompt-card-actions-inline">' +
                '<button class="prompt-card-btn-icon ' + templateBtnClass + '" data-id="' + escapeHtml(p.id) + '" title="' + templateBtnTitle + '"><span class="codicon codicon-pinned"></span></button>' +
                '<button class="prompt-card-btn-icon pm-edit-btn" data-id="' + escapeHtml(p.id) + '" title="Edit"><span class="codicon codicon-edit"></span></button>' +
                '<button class="prompt-card-btn-icon pm-delete-btn" data-id="' + escapeHtml(p.id) + '" title="Delete"><span class="codicon codicon-trash"></span></button>' +
                '</div>' +
                '<span class="prompt-card-expand"><span class="codicon codicon-chevron-down"></span></span>' +
                '</div>' +
                '<div class="prompt-card-body">' +
                '<div class="prompt-card-text">' + escapeHtml(p.prompt) + '</div>' +
                '</div></div>';
        }).join('');

        // Bind template toggle
        promptsModalList.querySelectorAll('.pm-template-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                togglePromptTemplate(id);
            });
        });
        // Bind edit/delete
        promptsModalList.querySelectorAll('.pm-edit-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                editPromptInModal(id);
            });
        });
        promptsModalList.querySelectorAll('.pm-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                deletePrompt(id);
            });
        });
        // Bind accordion expand/collapse on card click
        promptsModalList.querySelectorAll('.prompt-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                // Don't toggle if clicking on action buttons
                if (e.target.closest('.prompt-card-actions-inline')) return;
                card.classList.toggle('expanded');
            });
        });
        
        // Update template indicator in UI
        updateTemplateIndicator();
    }

    // ===== Prompts Modal Functions =====
    function openPromptsModal() {
        if (!promptsModalOverlay) return;
        renderPromptsModalList();
        promptsModalOverlay.classList.remove('hidden');
    }

    function closePromptsModal() {
        if (!promptsModalOverlay) return;
        promptsModalOverlay.classList.add('hidden');
        hidePromptsModalAddForm();
    }

    function showPromptsModalAddForm() {
        if (!promptsModalAddForm) return;
        promptsModalAddForm.classList.remove('hidden');
        promptsModalAddForm.removeAttribute('data-editing-id');
        var nameInput = document.getElementById('pm-name-input');
        var textInput = document.getElementById('pm-text-input');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        if (textInput) textInput.value = '';
    }

    function hidePromptsModalAddForm() {
        if (!promptsModalAddForm) return;
        promptsModalAddForm.classList.add('hidden');
        promptsModalAddForm.removeAttribute('data-editing-id');
    }

    function editPromptInModal(id) {
        var prompt = reusablePrompts.find(function (p) { return p.id === id; });
        if (!prompt) return;

        promptsModalAddForm.classList.remove('hidden');
        promptsModalAddForm.setAttribute('data-editing-id', id);
        var nameInput = document.getElementById('pm-name-input');
        var textInput = document.getElementById('pm-text-input');
        if (nameInput) { nameInput.value = prompt.name; nameInput.focus(); }
        if (textInput) textInput.value = prompt.prompt;
    }

    function savePromptsModalPrompt() {
        var nameInput = document.getElementById('pm-name-input');
        var textInput = document.getElementById('pm-text-input');
        if (!nameInput || !textInput) return;

        var name = nameInput.value.trim();
        var prompt = textInput.value.trim();
        if (!name || !prompt) return;

        var editingId = promptsModalAddForm.getAttribute('data-editing-id');
        if (editingId) {
            vscode.postMessage({ type: 'editReusablePrompt', id: editingId, name: name, prompt: prompt });
        } else {
            vscode.postMessage({ type: 'addReusablePrompt', name: name, prompt: prompt });
        }
        hidePromptsModalAddForm();
    }

    function deletePrompt(id) {
        vscode.postMessage({ type: 'removeReusablePrompt', id: id });
    }

    /**
     * Toggle a prompt as template (auto-append to all messages)
     */
    function togglePromptTemplate(id) {
        var prompt = reusablePrompts.find(function (p) { return p.id === id; });
        if (!prompt) return;

        if (prompt.isTemplate) {
            // Clear template
            vscode.postMessage({ type: 'clearPromptTemplate' });
        } else {
            // Set as template
            vscode.postMessage({ type: 'setPromptTemplate', id: id });
        }
    }

    /**
     * Update the template indicator near the input area
     */
    function updateTemplateIndicator() {
        var indicator = document.getElementById('template-indicator');
        var activeTemplate = reusablePrompts.find(function (p) { return p.isTemplate === true; });
        
        if (!indicator) {
            // Create the indicator if it doesn't exist
            var inputWrapper = document.getElementById('input-wrapper');
            if (!inputWrapper) return;
            
            indicator = document.createElement('div');
            indicator.id = 'template-indicator';
            indicator.className = 'template-indicator hidden';
            indicator.innerHTML = '<span class="codicon codicon-pinned"></span> <span class="template-name"></span> <button class="template-clear-btn" title="Disable template"><span class="codicon codicon-close"></span></button>';
            inputWrapper.insertBefore(indicator, inputWrapper.firstChild);
            
            // Bind clear button
            indicator.querySelector('.template-clear-btn').addEventListener('click', function () {
                vscode.postMessage({ type: 'clearPromptTemplate' });
            });
        }
        
        var nameSpan = indicator.querySelector('.template-name');
        
        if (activeTemplate) {
            nameSpan.textContent = 'Template: /' + activeTemplate.name;
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }

    // ===== SLASH COMMAND FUNCTIONS =====

    /**
     * Expand /commandName patterns to their full prompt text
     * Only expands known commands at the start of lines or after whitespace
     */
    function expandSlashCommands(text) {
        if (!text || reusablePrompts.length === 0) return text;

        // Use stored mappings from selectSlashItem if available
        var mappings = chatInput && chatInput._slashPrompts ? chatInput._slashPrompts : {};

        // Build a regex to match all known prompt names
        var promptNames = reusablePrompts.map(function (p) { return p.name; });
        if (Object.keys(mappings).length > 0) {
            Object.keys(mappings).forEach(function (name) {
                if (promptNames.indexOf(name) === -1) promptNames.push(name);
            });
        }

        // Match /promptName at start or after whitespace
        var expanded = text;
        promptNames.forEach(function (name) {
            // Escape special regex chars in name
            var escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var regex = new RegExp('(^|\\s)/' + escapedName + '(?=\\s|$)', 'g');
            var fullPrompt = mappings[name] || (reusablePrompts.find(function (p) { return p.name === name; }) || {}).prompt || '';
            if (fullPrompt) {
                expanded = expanded.replace(regex, '$1' + fullPrompt);
            }
        });

        // Clear stored mappings after expansion
        if (chatInput) chatInput._slashPrompts = {};

        return expanded.trim();
    }

    function handleSlashCommands() {
        if (!chatInput) return;
        var value = chatInput.value;
        // On some mobile browsers, selectionStart may not be updated synchronously
        var cursorPos = chatInput.selectionStart;
        if (cursorPos === 0 && value.length > 0) {
            cursorPos = value.length;
        }

        // Find slash at start of input or after whitespace
        var slashPos = -1;
        for (var i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '/') {
                // Check if it's at start or after whitespace
                if (i === 0 || /\s/.test(value[i - 1])) {
                    slashPos = i;
                }
                break;
            }
            if (/\s/.test(value[i])) break;
        }

        if (slashPos >= 0 && reusablePrompts.length > 0) {
            var query = value.substring(slashPos + 1, cursorPos);
            slashStartPos = slashPos;
            if (slashDebounceTimer) clearTimeout(slashDebounceTimer);
            slashDebounceTimer = setTimeout(function () {
                // Filter locally for instant results
                var queryLower = query.toLowerCase();
                var matchingPrompts = reusablePrompts.filter(function (p) {
                    return p.name.toLowerCase().includes(queryLower) ||
                        p.prompt.toLowerCase().includes(queryLower);
                });
                showSlashDropdown(matchingPrompts);
            }, 50);
        } else if (slashDropdownVisible) {
            hideSlashDropdown();
        }
    }

    function showSlashDropdown(results) {
        if (!slashDropdown || !slashList || !slashEmpty) return;
        slashResults = results;
        selectedSlashIndex = results.length > 0 ? 0 : -1;

        // Hide file autocomplete if showing slash commands
        hideAutocomplete();

        if (results.length === 0) {
            slashList.classList.add('hidden');
            slashEmpty.classList.remove('hidden');
        } else {
            slashList.classList.remove('hidden');
            slashEmpty.classList.add('hidden');
            renderSlashList();
        }
        slashDropdown.classList.remove('hidden');
        slashDropdownVisible = true;
    }

    function hideSlashDropdown() {
        if (slashDropdown) slashDropdown.classList.add('hidden');
        slashDropdownVisible = false;
        slashResults = [];
        selectedSlashIndex = -1;
        slashStartPos = -1;
        if (slashDebounceTimer) { clearTimeout(slashDebounceTimer); slashDebounceTimer = null; }
    }

    function renderSlashList() {
        if (!slashList) return;
        slashList.innerHTML = slashResults.map(function (p, index) {
            var truncatedPrompt = p.prompt.length > 50 ? p.prompt.substring(0, 50) + '...' : p.prompt;
            // Prepare tooltip text - escape for HTML attribute
            var tooltipText = p.prompt.length > 500 ? p.prompt.substring(0, 500) + '...' : p.prompt;
            tooltipText = tooltipText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return '<div class="slash-item' + (index === selectedSlashIndex ? ' selected' : '') + '" data-index="' + index + '" data-tooltip="' + tooltipText + '">' +
                '<span class="slash-item-icon"><span class="codicon codicon-symbol-keyword"></span></span>' +
                '<div class="slash-item-content">' +
                '<span class="slash-item-name">/' + escapeHtml(p.name) + '</span>' +
                '<span class="slash-item-preview">' + escapeHtml(truncatedPrompt) + '</span>' +
                '</div></div>';
        }).join('');

        slashList.querySelectorAll('.slash-item').forEach(function (item) {
            item.addEventListener('click', function () { selectSlashItem(parseInt(item.getAttribute('data-index'), 10)); });
            item.addEventListener('mouseenter', function () { selectedSlashIndex = parseInt(item.getAttribute('data-index'), 10); updateSlashSelection(); });
        });
        scrollToSelectedSlashItem();
    }

    function updateSlashSelection() {
        if (!slashList) return;
        slashList.querySelectorAll('.slash-item').forEach(function (item, index) {
            item.classList.toggle('selected', index === selectedSlashIndex);
        });
        scrollToSelectedSlashItem();
    }

    function scrollToSelectedSlashItem() {
        var selectedItem = slashList ? slashList.querySelector('.slash-item.selected') : null;
        if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function selectSlashItem(index) {
        if (index < 0 || index >= slashResults.length || !chatInput || slashStartPos < 0) return;
        var prompt = slashResults[index];
        var value = chatInput.value;
        var cursorPos = chatInput.selectionStart;

        // Create a slash tag representation - when sent, we'll expand it to full prompt
        // For now, insert /name as text and store the mapping
        var slashText = '/' + prompt.name + ' ';
        chatInput.value = value.substring(0, slashStartPos) + slashText + value.substring(cursorPos);
        var newCursorPos = slashStartPos + slashText.length;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);

        // Store the prompt reference for expansion on send
        if (!chatInput._slashPrompts) chatInput._slashPrompts = {};
        chatInput._slashPrompts[prompt.name] = prompt.prompt;

        hideSlashDropdown();
        chatInput.focus();
        updateSendButtonState();
    }

    // ===== NOTIFICATION SOUND FUNCTION =====

    /**
     * Unlock audio playback after first user interaction
     * Required due to browser autoplay policy
     */
    function unlockAudioOnInteraction() {
        function unlock() {
            if (audioUnlocked) return;
            var audio = document.getElementById('notification-sound');
            if (audio) {
                // Play and immediately pause to unlock
                audio.volume = 0;
                var playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(function () {
                        audio.pause();
                        audio.currentTime = 0;
                        audio.volume = 0.5;
                        audioUnlocked = true;
                        console.log('[FlowCommand] Audio unlocked successfully');
                    }).catch(function () {
                        // Still locked, will try again on next interaction
                    });
                }
            }
            // Remove listeners after first attempt
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
        }
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
    }

    function playNotificationSound() {
        console.log('[FlowCommand] playNotificationSound called, audioUnlocked:', audioUnlocked);
        
        // First try the preloaded audio element
        try {
            var audio = document.getElementById('notification-sound');
            console.log('[FlowCommand] Audio element found:', !!audio);
            if (audio && audio.src && !audio.error) {
                audio.currentTime = 0; // Reset to beginning
                audio.volume = 0.5;
                console.log('[FlowCommand] Attempting to play audio file...');
                var playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(function () {
                        console.log('[FlowCommand] Audio playback started successfully');
                    }).catch(function (e) {
                        console.log('[FlowCommand] Could not play audio file:', e.message);
                        // If autoplay blocked or file missing, try Web Audio API beep
                        playWebAudioBeep();
                    });
                    return;
                }
            }
        } catch (e) {
            console.log('[FlowCommand] Audio element error:', e);
        }
        
        // Fallback to Web Audio API beep
        playWebAudioBeep();
    }
    
    function playWebAudioBeep() {
        console.log('[FlowCommand] Playing Web Audio API beep');
        try {
            var AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                console.log('[FlowCommand] Web Audio API not supported');
                flashNotification();
                return;
            }
            
            var audioCtx = new AudioContext();
            var oscillator = audioCtx.createOscillator();
            var gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            // Create a pleasant notification beep (A5 note = 880Hz)
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
            
            // Fade in and out for smooth sound
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
            
            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.2);
            
            console.log('[FlowCommand] Web Audio beep played');
        } catch (e) {
            console.log('[FlowCommand] Web Audio API beep failed:', e);
            flashNotification();
        }
    }

    function flashNotification() {
        // Visual flash when audio fails
        var body = document.body;
        body.style.transition = 'background-color 0.1s ease';
        var originalBg = body.style.backgroundColor;
        body.style.backgroundColor = 'var(--vscode-textLink-foreground, #3794ff)';
        setTimeout(function () {
            body.style.backgroundColor = originalBg || '';
        }, 150);
    }

    function bindDragAndDrop() {
        if (!queueList) return;
        
        // Global state for mouse drag (prevents flickering)
        var mouseDragItem = null;
        var mouseDragIndex = -1;
        
        // Variables for touch drag
        var touchDragItem = null;
        var touchStartY = 0;
        var touchCurrentY = 0;
        var touchStartIndex = -1;
        var touchPlaceholder = null;
        
        queueList.querySelectorAll('.queue-item').forEach(function (item) {
            // Track dragenter/dragleave count to handle child elements properly
            var dragEnterCount = 0;
            
            // Mouse drag and drop (desktop) - fixed to prevent flickering
            item.addEventListener('dragstart', function (e) {
                mouseDragItem = item;
                mouseDragIndex = parseInt(item.getAttribute('data-index'), 10);
                e.dataTransfer.setData('text/plain', String(mouseDragIndex));
                e.dataTransfer.effectAllowed = 'move';
                // Use setTimeout to allow the drag image to be captured first
                setTimeout(function() {
                    item.classList.add('dragging');
                }, 0);
            });
            
            item.addEventListener('dragend', function () {
                item.classList.remove('dragging');
                // Clean up all drag-over states
                queueList.querySelectorAll('.queue-item').forEach(function(qi) {
                    qi.classList.remove('drag-over');
                });
                mouseDragItem = null;
                mouseDragIndex = -1;
            });
            
            item.addEventListener('dragenter', function (e) {
                e.preventDefault();
                dragEnterCount++;
                // Don't show drag-over on the item being dragged
                if (mouseDragItem !== item && dragEnterCount === 1) {
                    item.classList.add('drag-over');
                }
            });
            
            item.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                // Don't add class here - dragenter handles it (prevents flicker)
            });
            
            item.addEventListener('dragleave', function (e) {
                dragEnterCount--;
                // Only remove when actually leaving the item (not entering a child)
                if (dragEnterCount === 0) {
                    item.classList.remove('drag-over');
                }
            });
            
            item.addEventListener('drop', function (e) {
                e.preventDefault();
                dragEnterCount = 0;
                var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                var toIndex = parseInt(item.getAttribute('data-index'), 10);
                item.classList.remove('drag-over');
                if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
                    reorderQueue(fromIndex, toIndex);
                }
            });
            
            // Touch drag and drop (mobile/touch devices)
            item.addEventListener('touchstart', function (e) {
                // Only allow drag from the drag handle area (left side)
                var touch = e.touches[0];
                var itemRect = item.getBoundingClientRect();
                var touchX = touch.clientX - itemRect.left;
                
                // Allow drag if touch is in the first 50px (drag handle area) or on the whole item
                // This works better for small touch targets
                touchDragItem = item;
                touchStartY = touch.clientY;
                touchCurrentY = touch.clientY;
                touchStartIndex = parseInt(item.getAttribute('data-index'), 10);
                
                // Add dragging class after a short delay to distinguish from tap
                setTimeout(function() {
                    if (touchDragItem === item) {
                        item.classList.add('dragging');
                        item.style.opacity = '0.7';
                    }
                }, 150);
            }, { passive: true });
            
            item.addEventListener('touchmove', function (e) {
                if (touchDragItem !== item) return;
                
                var touch = e.touches[0];
                touchCurrentY = touch.clientY;
                
                // Find the item we're hovering over
                var items = queueList.querySelectorAll('.queue-item');
                items.forEach(function(targetItem) {
                    if (targetItem === item) return;
                    
                    var rect = targetItem.getBoundingClientRect();
                    if (touchCurrentY >= rect.top && touchCurrentY <= rect.bottom) {
                        targetItem.classList.add('drag-over');
                    } else {
                        targetItem.classList.remove('drag-over');
                    }
                });
                
                // Prevent scrolling while dragging
                e.preventDefault();
            }, { passive: false });
            
            item.addEventListener('touchend', function (e) {
                if (touchDragItem !== item) return;
                
                item.classList.remove('dragging');
                item.style.opacity = '';
                
                // Find the drop target
                var items = queueList.querySelectorAll('.queue-item');
                var toIndex = -1;
                
                items.forEach(function(targetItem, idx) {
                    targetItem.classList.remove('drag-over');
                    
                    var rect = targetItem.getBoundingClientRect();
                    if (touchCurrentY >= rect.top && touchCurrentY <= rect.bottom) {
                        toIndex = parseInt(targetItem.getAttribute('data-index'), 10);
                    }
                });
                
                // Perform the reorder if valid
                if (toIndex !== -1 && touchStartIndex !== toIndex && !isNaN(touchStartIndex) && !isNaN(toIndex)) {
                    reorderQueue(touchStartIndex, toIndex);
                }
                
                touchDragItem = null;
                touchStartIndex = -1;
            });
            
            item.addEventListener('touchcancel', function () {
                if (touchDragItem === item) {
                    item.classList.remove('dragging');
                    item.style.opacity = '';
                    
                    var items = queueList.querySelectorAll('.queue-item');
                    items.forEach(function(targetItem) {
                        targetItem.classList.remove('drag-over');
                    });
                    
                    touchDragItem = null;
                    touchStartIndex = -1;
                }
            });
        });
    }

    function bindKeyboardNavigation() {
        if (!queueList) return;
        var items = queueList.querySelectorAll('.queue-item');
        items.forEach(function (item, index) {
            item.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' && index < items.length - 1) { e.preventDefault(); items[index + 1].focus(); }
                else if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); items[index - 1].focus(); }
                else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); var id = item.getAttribute('data-id'); if (id) removeFromQueue(id); }
            });
        });
    }

    function reorderQueue(fromIndex, toIndex) {
        // Update the data array
        var removed = promptQueue.splice(fromIndex, 1)[0];
        promptQueue.splice(toIndex, 0, removed);
        
        // Move DOM element directly instead of re-rendering (prevents flickering)
        if (queueList) {
            var items = queueList.querySelectorAll('.queue-item');
            var draggedItem = items[fromIndex];
            var targetItem = items[toIndex];
            
            if (draggedItem && targetItem) {
                // Move the DOM element
                if (fromIndex < toIndex) {
                    // Moving down: insert after target
                    targetItem.parentNode.insertBefore(draggedItem, targetItem.nextSibling);
                } else {
                    // Moving up: insert before target
                    targetItem.parentNode.insertBefore(draggedItem, targetItem);
                }
                
                // Update data-index attributes and visual numbers
                var updatedItems = queueList.querySelectorAll('.queue-item');
                updatedItems.forEach(function(item, idx) {
                    item.setAttribute('data-index', idx);
                    item.setAttribute('aria-label', 'Queue item ' + (idx + 1) + ': ' + item.querySelector('.text').textContent);
                    // Update the visual number in the text
                    var textSpan = item.querySelector('.text');
                    if (textSpan && textSpan.textContent) {
                        // Replace "N. " prefix with new number
                        textSpan.textContent = textSpan.textContent.replace(/^\d+\.\s*/, (idx + 1) + '. ');
                    }
                    // Update bullet class (first item is active, rest are pending)
                    var bullet = item.querySelector('.bullet');
                    if (bullet) {
                        bullet.classList.remove('active', 'pending');
                        bullet.classList.add(idx === 0 ? 'active' : 'pending');
                    }
                });
            } else {
                // Fallback to full re-render if elements not found
                renderQueue();
            }
        }
        
        vscode.postMessage({ type: 'reorderQueue', fromIndex: fromIndex, toIndex: toIndex });
    }

    function handleAutocomplete() {
        if (!chatInput) return;
        var value = chatInput.value;
        // On some mobile browsers, selectionStart may not be updated synchronously
        // with the input event. Fall back to value.length if selectionStart is 0
        // but there's content (user is likely typing at the end).
        var cursorPos = chatInput.selectionStart;
        if (cursorPos === 0 && value.length > 0) {
            cursorPos = value.length;
        }
        var hashPos = -1;
        for (var i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '#') { hashPos = i; break; }
            if (value[i] === ' ' || value[i] === '\n') break;
        }
        if (hashPos >= 0) {
            var query = value.substring(hashPos + 1, cursorPos);
            autocompleteStartPos = hashPos;
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            // Use shorter debounce for initial trigger (just #) to feel more responsive
            var debounceMs = query.length === 0 ? 50 : 150;
            searchDebounceTimer = setTimeout(function () {
                vscode.postMessage({ type: 'searchFiles', query: query });
            }, debounceMs);
        } else if (autocompleteVisible) {
            hideAutocomplete();
        }
    }

    function showAutocomplete(results) {
        if (!autocompleteDropdown || !autocompleteList || !autocompleteEmpty) return;
        autocompleteResults = results;
        selectedAutocompleteIndex = results.length > 0 ? 0 : -1;
        if (results.length === 0) {
            autocompleteList.classList.add('hidden');
            autocompleteEmpty.classList.remove('hidden');
        } else {
            autocompleteList.classList.remove('hidden');
            autocompleteEmpty.classList.add('hidden');
            renderAutocompleteList();
        }
        autocompleteDropdown.classList.remove('hidden');
        autocompleteVisible = true;
    }

    function hideAutocomplete() {
        if (autocompleteDropdown) autocompleteDropdown.classList.add('hidden');
        autocompleteVisible = false;
        autocompleteResults = [];
        selectedAutocompleteIndex = -1;
        autocompleteStartPos = -1;
        if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
    }

    function renderAutocompleteList() {
        if (!autocompleteList) return;
        autocompleteList.innerHTML = autocompleteResults.map(function (file, index) {
            return '<div class="autocomplete-item' + (index === selectedAutocompleteIndex ? ' selected' : '') + '" data-index="' + index + '">' +
                '<span class="autocomplete-item-icon"><span class="codicon codicon-' + file.icon + '"></span></span>' +
                '<div class="autocomplete-item-content"><span class="autocomplete-item-name">' + escapeHtml(file.name) + '</span>' +
                '<span class="autocomplete-item-path">' + escapeHtml(file.path) + '</span></div></div>';
        }).join('');

        autocompleteList.querySelectorAll('.autocomplete-item').forEach(function (item) {
            item.addEventListener('click', function () { selectAutocompleteItem(parseInt(item.getAttribute('data-index'), 10)); });
            item.addEventListener('mouseenter', function () { selectedAutocompleteIndex = parseInt(item.getAttribute('data-index'), 10); updateAutocompleteSelection(); });
        });
        scrollToSelectedItem();
    }

    function updateAutocompleteSelection() {
        if (!autocompleteList) return;
        autocompleteList.querySelectorAll('.autocomplete-item').forEach(function (item, index) {
            item.classList.toggle('selected', index === selectedAutocompleteIndex);
        });
        scrollToSelectedItem();
    }

    function scrollToSelectedItem() {
        var selectedItem = autocompleteList ? autocompleteList.querySelector('.autocomplete-item.selected') : null;
        if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function selectAutocompleteItem(index) {
        if (index < 0 || index >= autocompleteResults.length || !chatInput || autocompleteStartPos < 0) return;
        var file = autocompleteResults[index];
        var value = chatInput.value;
        var cursorPos = chatInput.selectionStart;

        // Check if this is a context item (#terminal, #problems)
        if (file.isContext && file.uri && file.uri.startsWith('context://')) {
            // Remove the #query from input - chip will be added
            chatInput.value = value.substring(0, autocompleteStartPos) + value.substring(cursorPos);
            var newCursorPos = autocompleteStartPos;
            chatInput.setSelectionRange(newCursorPos, newCursorPos);

            // Send context reference request to backend
            vscode.postMessage({
                type: 'selectContextReference',
                contextType: file.name, // 'terminal' or 'problems'
                options: undefined
            });

            hideAutocomplete();
            chatInput.focus();
            autoResizeTextarea();
            updateInputHighlighter();
            saveWebviewState();
            updateSendButtonState();
            return;
        }

        // Regular file/folder reference
        var referenceText = '#' + file.name + ' ';
        chatInput.value = value.substring(0, autocompleteStartPos) + referenceText + value.substring(cursorPos);
        var newCursorPos = autocompleteStartPos + referenceText.length;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);
        vscode.postMessage({ type: 'addFileReference', file: file });
        hideAutocomplete();
        chatInput.focus();
    }

    function syncAttachmentsWithText() {
        var text = chatInput ? chatInput.value : '';
        var toRemove = [];
        currentAttachments.forEach(function (att) {
            // Skip temporary attachments (like pasted images)
            if (att.isTemporary) return;
            // Skip context attachments (#terminal, #problems) - they use context:// URI
            if (att.uri && att.uri.startsWith('context://')) return;
            // Only sync file references that have isTextReference flag
            if (!att.isTextReference) return;
            // Check if the #filename reference still exists in text
            if (text.indexOf('#' + att.name) === -1) toRemove.push(att.id);
        });
        if (toRemove.length > 0) {
            toRemove.forEach(function (id) { vscode.postMessage({ type: 'removeAttachment', attachmentId: id }); });
            currentAttachments = currentAttachments.filter(function (a) { return toRemove.indexOf(a.id) === -1; });
            updateChipsDisplay();
        }
    }

    function handlePaste(event) {
        if (!event.clipboardData) return;
        var items = event.clipboardData.items;
        var files = event.clipboardData.files;
        var hasImage = false;
        var processedFiles = new Set();

        // First pass: check DataTransferItemList (standard approach for screenshots)
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') === 0) {
                hasImage = true;
                var file = items[i].getAsFile();
                if (file) {
                    processedFiles.add(file.name + '_' + file.size);
                    processImageFile(file);
                }
            }
        }

        // Second pass: check FileList (for multi-file paste from file managers)
        // Some browsers/Electron provide copied image files through .files but not .items
        if (files && files.length > 0) {
            for (var j = 0; j < files.length; j++) {
                var f = files[j];
                if (f.type.indexOf('image/') === 0) {
                    var fileKey = f.name + '_' + f.size;
                    if (!processedFiles.has(fileKey)) {
                        hasImage = true;
                        processImageFile(f);
                    }
                }
            }
        }

        if (hasImage) event.preventDefault();
    }

    function processImageFile(file) {
        console.log('[FlowCommand] processImageFile called for:', file.name);
        var reader = new FileReader();
        reader.onload = function (e) {
            console.log('[FlowCommand] FileReader loaded, sending saveImage message');
            if (e.target && e.target.result) vscode.postMessage({ type: 'saveImage', data: e.target.result, mimeType: file.type });
        };
        reader.onerror = function () {
            console.error('[FlowCommand] Failed to read image file:', file.name);
        };
        reader.readAsDataURL(file);
    }

    function updateChipsDisplay() {
        if (!chipsContainer) return;
        if (currentAttachments.length === 0) {
            chipsContainer.classList.add('hidden');
            chipsContainer.innerHTML = '';
        } else {
            chipsContainer.classList.remove('hidden');
            chipsContainer.innerHTML = currentAttachments.map(function (att) {
                var isImage = att.isTemporary || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.name);
                var iconClass = att.isFolder ? 'folder' : (isImage ? 'file-media' : 'file');
                var displayName = att.isTemporary ? 'Pasted Image' : att.name;
                return '<div class="chip" data-id="' + att.id + '" title="' + escapeHtml(att.uri || att.name) + '">' +
                    '<span class="chip-icon"><span class="codicon codicon-' + iconClass + '"></span></span>' +
                    '<span class="chip-text">' + escapeHtml(displayName) + '</span>' +
                    '<button class="chip-remove" data-remove="' + att.id + '" title="Remove"><span class="codicon codicon-close"></span></button></div>';
            }).join('');

            chipsContainer.querySelectorAll('.chip-remove').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var attId = btn.getAttribute('data-remove');
                    if (attId) removeAttachment(attId);
                });
            });
        }
        // Persist attachments so they survive sidebar tab switches
        saveWebviewState();
    }

    function removeAttachment(attachmentId) {
        vscode.postMessage({ type: 'removeAttachment', attachmentId: attachmentId });
        currentAttachments = currentAttachments.filter(function (a) { return a.id !== attachmentId; });
        updateChipsDisplay();
        // saveWebviewState() is called in updateChipsDisplay
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderAttachmentsHtml(attachments) {
        if (!attachments || attachments.length === 0) return '';
        var items = attachments.map(function (att) {
            var iconClass = 'file';
            if (att.isFolder) iconClass = 'folder';
            else if (att.name && (att.name.endsWith('.png') || att.name.endsWith('.jpg') || att.name.endsWith('.jpeg'))) iconClass = 'file-media';
            else if ((att.uri || '').indexOf('context://terminal') !== -1) iconClass = 'terminal';
            else if ((att.uri || '').indexOf('context://problems') !== -1) iconClass = 'error';

            return '<div class="chip" style="margin-top:0;" title="' + escapeHtml(att.name) + '">' +
                '<span class="chip-icon"><span class="codicon codicon-' + iconClass + '"></span></span>' +
                '<span class="chip-text">' + escapeHtml(att.name) + '</span>' +
                '</div>';
        }).join('');

        return '<div class="chips-container" style="padding: 6px 0 0 0; border: none;">' + items + '</div>';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
