import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as QRCode from 'qrcode';
import { FlowCommandWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';
import { ContextManager } from './context';
import { RemoteUiServer, RemoteMessage } from './server/remoteUiServer';
import { registerPlanReviewTool } from './planReview';

let mcpServer: McpServerManager | undefined;
let webviewProvider: FlowCommandWebviewProvider | undefined;
let contextManager: ContextManager | undefined;
let remoteServer: RemoteUiServer | undefined;
let remoteStatusBarItem: vscode.StatusBarItem | undefined;

// Memoized result for external MCP client check (only checked once per activation)
let _hasExternalMcpClientsResult: boolean | undefined;

/**
 * Check if external MCP client configs exist (Kiro, Cursor, Antigravity)
 * This indicates user has external tools that need the MCP server
 * Result is memoized to avoid repeated file system reads
 * Uses async I/O to avoid blocking the extension host thread
 */
async function hasExternalMcpClientsAsync(): Promise<boolean> {
    // Return cached result if available
    if (_hasExternalMcpClientsResult !== undefined) {
        return _hasExternalMcpClientsResult;
    }

    const configPaths = [
        path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
        path.join(os.homedir(), '.cursor', 'mcp.json'),
        path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
    ];

    for (const configPath of configPaths) {
        try {
            const content = await fs.promises.readFile(configPath, 'utf8');
            const config = JSON.parse(content);
            // Check if flowcommand-chat is registered
            if (config.mcpServers?.['flowcommand-chat']) {
                _hasExternalMcpClientsResult = true;
                return true;
            }
        } catch {
            // File doesn't exist or parse error - continue to next path
        }
    }
    _hasExternalMcpClientsResult = false;
    return false;
}

function getMcpStatus() {
    const running = mcpServer?.isRunning() ?? false;
    const url = mcpServer?.getServerUrl() ?? null;
    const port = mcpServer?.getPort() ?? null;
    return { running, url, port };
}

function refreshMcpStatus(): void {
    const status = getMcpStatus();
    webviewProvider?.setMcpStatus(status.running, status.url);
}

export function activate(context: vscode.ExtensionContext) {
    // Store context reference for state storage
    extensionContext = context;

    // Initialize context manager for #terminal, #problems features
    contextManager = new ContextManager();
    context.subscriptions.push({ dispose: () => contextManager?.dispose() });

    const provider = new FlowCommandWebviewProvider(context.extensionUri, context, contextManager);
    webviewProvider = provider;

    // Register the provider and add it to disposables for proper cleanup
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(FlowCommandWebviewProvider.viewType, provider),
        provider // Provider implements Disposable for cleanup
    );

    // Register VS Code LM Tools (always available for Copilot)
    registerTools(context, provider);

    // Register plan_review tool (opens a dedicated review panel)
    const planReviewDisposable = registerPlanReviewTool(context, provider);
    context.subscriptions.push(planReviewDisposable);

    // Inject instructions based on configured method (non-aggressive: only if needed)
    handleInstructionInjection(false);

    // Listen for settings changes to toggle instruction injection
    // User explicitly changed settings - force inject
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('flowcommand.instructionInjection') || e.affectsConfiguration('flowcommand.instructionText')) {
            handleInstructionInjection(true); // Force inject when user changes settings
        }
    });
    context.subscriptions.push(configWatcher);

    // Initialize MCP server manager (but don't start yet)
    mcpServer = new McpServerManager(provider, context.extensionUri);
    refreshMcpStatus();

    // Check if MCP should auto-start based on settings and external client configs
    // Deferred to avoid blocking activation with file I/O
    const config = vscode.workspace.getConfiguration('flowcommand');
    const mcpEnabled = config.get<boolean>('mcpEnabled', false);
    const autoStartIfClients = config.get<boolean>('mcpAutoStartIfClients', true);

    // Start MCP server only if:
    // 1. Explicitly enabled in settings, OR
    // 2. Auto-start is enabled AND external clients are configured
    // Note: Check is deferred to avoid blocking extension activation with file I/O
    if (mcpEnabled) {
        // Explicitly enabled - start immediately without checking external clients
        mcpServer.start().then(() => refreshMcpStatus());
    } else if (autoStartIfClients) {
        // Defer the external client check to avoid blocking activation
        hasExternalMcpClientsAsync().then(hasClients => {
            if (hasClients && mcpServer) {
                mcpServer.start().then(() => refreshMcpStatus());
            }
        }).catch(err => {
            console.error('[FlowCommand] Failed to check external MCP clients:', err);
        });
    }

    // Start MCP server command
    const startMcpCmd = vscode.commands.registerCommand('flowcommand.startMcp', async () => {
        if (mcpServer && !mcpServer.isRunning()) {
            await mcpServer.start();
            refreshMcpStatus();
            vscode.window.showInformationMessage('FlowCommand MCP Server started');
        } else if (mcpServer?.isRunning()) {
            vscode.window.showInformationMessage('FlowCommand MCP Server is already running');
        }
    });

    // Restart MCP server command
    const restartMcpCmd = vscode.commands.registerCommand('flowcommand.restartMcp', async () => {
        if (mcpServer) {
            await mcpServer.restart();
            refreshMcpStatus();
        }
    });

    // Stop MCP server command
    const stopMcpCmd = vscode.commands.registerCommand('flowcommand.stopMcp', async () => {
        if (!mcpServer || !mcpServer.isRunning()) {
            vscode.window.showInformationMessage('FlowCommand MCP Server is not running');
            return;
        }
        await mcpServer.stop();
        refreshMcpStatus();
        vscode.window.showInformationMessage('FlowCommand MCP Server stopped');
    });

    // Toggle MCP server command
    const toggleMcpCmd = vscode.commands.registerCommand('flowcommand.toggleMcp', async () => {
        if (!mcpServer) return;
        if (mcpServer.isRunning()) {
            await mcpServer.stop();
            refreshMcpStatus();
            vscode.window.showInformationMessage('FlowCommand MCP Server stopped');
        } else {
            await mcpServer.start();
            refreshMcpStatus();
            vscode.window.showInformationMessage('FlowCommand MCP Server started');
        }
    });

    // Get MCP status command (used by settings UI)
    const getMcpStatusCmd = vscode.commands.registerCommand('flowcommand.getMcpStatus', () => {
        return getMcpStatus();
    });

    // Show MCP configuration command
    const showMcpConfigCmd = vscode.commands.registerCommand('flowcommand.showMcpConfig', async () => {
        const config = (mcpServer as any).getMcpConfig?.();
        if (!config) {
            vscode.window.showErrorMessage('MCP server not running');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            [
                { label: 'Kiro', description: 'Kiro IDE', value: 'kiro' },
                { label: 'Cursor', description: 'Cursor Editor', value: 'cursor' },
                { label: 'Antigravity', description: 'Gemini CLI', value: 'antigravity' }
            ],
            { placeHolder: 'Select MCP client to configure' }
        );

        if (!selected) return;

        const cfg = config[selected.value];
        const configJson = JSON.stringify(cfg.config, null, 2);

        const message = `Add this to ${cfg.path}:\n\n${configJson}`;
        const action = await vscode.window.showInformationMessage(message, 'Copy to Clipboard', 'Open File');

        if (action === 'Copy to Clipboard') {
            await vscode.env.clipboard.writeText(configJson);
            vscode.window.showInformationMessage('Configuration copied to clipboard');
        } else if (action === 'Open File') {
            const uri = vscode.Uri.file(cfg.path);
            await vscode.commands.executeCommand('vscode.open', uri);
        }
    });

    // Open history modal command (triggered from view title bar)
    const openHistoryCmd = vscode.commands.registerCommand('flowcommand.openHistory', () => {
        provider.openHistoryModal();
    });

    // Clear current session command (triggered from view title bar)
    const clearSessionCmd = vscode.commands.registerCommand('flowcommand.clearCurrentSession', async () => {
        const result = await vscode.window.showWarningMessage(
            'Clear all tool calls from current session?',
            { modal: true },
            'Clear'
        );
        if (result === 'Clear') {
            provider.clearCurrentSession();
        }
    });

    // Open settings modal command (triggered from view title bar)
    const openSettingsCmd = vscode.commands.registerCommand('flowcommand.openSettings', () => {
        void provider.openSettingsModal();
    });

    // Open prompts modal command (triggered from view title bar)
    const openPromptsCmd = vscode.commands.registerCommand('flowcommand.openPrompts', () => {
        provider.openPromptsModal();
    });

    // Initialize Remote Server
    remoteServer = new RemoteUiServer(context.extensionUri, context);
    context.subscriptions.push(remoteServer);
    
    // Connect remote server to webview provider for state sync
    // Match original API signature: onMessage(callback: (message, respond) => void)
    remoteServer.onMessage((message: RemoteMessage, respond) => {
        // Forward messages from remote clients to the webview provider
        // The provider will handle them the same as webview messages
        provider.handleRemoteMessage(message as any);
    });
    
    // Use getStateForRemote for original API compatibility
    remoteServer.onGetState(() => {
        // Return current state for new remote connections using public method
        return provider.getStateForRemote();
    });

    // Connect context manager to remote server for terminal history and problems
    remoteServer.onGetTerminalHistory(() => {
        return contextManager!.terminal.getRecentCommands();
    });

    remoteServer.onGetProblems(() => {
        return contextManager!.problems.getProblems();
    });

    // Subscribe to new terminal commands and broadcast to remote clients
    contextManager!.terminal.onCommand((command) => {
        if (remoteServer && remoteServer.isRunning()) {
            remoteServer.broadcast({
                type: 'terminalCommand',
                command: command
            } as RemoteMessage);
        }
    });

    // Set up broadcast callback: when webview state changes, broadcast to remote clients
    // Use setRemoteBroadcastCallback for original API compatibility
    provider.setRemoteBroadcastCallback((message) => {
        if (remoteServer && remoteServer.isRunning()) {
            remoteServer.broadcast(message as RemoteMessage);
        }
    });

    // Create status bar item for remote server
    remoteStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    remoteStatusBarItem.command = 'flowcommand.showRemoteUrl';
    context.subscriptions.push(remoteStatusBarItem);

    // Function to update status bar based on server state
    async function updateRemoteStatusBar() {
        if (!remoteStatusBarItem) return;
        
        if (remoteServer?.isRunning()) {
            const info = remoteServer.getConnectionInfo();
            const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
            remoteStatusBarItem.text = '$(broadcast) FlowCommand';
            let qrDataUrl: string | undefined;
            try {
                qrDataUrl = await QRCode.toDataURL(networkUrl, { margin: 1, width: 160 });
            } catch (err) {
                console.error('[FlowCommand] Failed to generate QR code:', err);
            }

            const tooltip = new vscode.MarkdownString(undefined, true);
            tooltip.appendMarkdown(`**FlowCommand Remote Server**\n\n`);
            tooltip.appendMarkdown(`**URL:** \`${networkUrl}\`\n\n`);
            tooltip.appendMarkdown(`**PIN:** \`${info.pin}\`\n\n`);
            if (qrDataUrl) {
                tooltip.appendMarkdown(`![FlowCommand QR](${qrDataUrl})\n\n`);
            }
            tooltip.appendMarkdown('_Click to copy_');
            tooltip.isTrusted = true;
            remoteStatusBarItem.tooltip = tooltip;
            remoteStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            remoteStatusBarItem.show();
        } else {
            remoteStatusBarItem.hide();
        }
    }

    // Auto-start remote server if enabled
    const remoteConfig = vscode.workspace.getConfiguration('flowcommand');
    const remoteEnabled = remoteConfig.get<boolean>('remoteEnabled', false);
    if (remoteEnabled) {
        remoteServer.start().then(() => {
            const info = remoteServer!.getConnectionInfo();
            vscode.window.showInformationMessage(
                `FlowCommand Remote started: ${info.urls[1] || info.urls[0]} | PIN: ${info.pin}`
            );
            void updateRemoteStatusBar();
        }).catch(err => {
            console.error('[FlowCommand] Failed to start remote server:', err);
        });
    }

    // Toggle remote server command (triggered from view title bar)
    const toggleRemoteCmd = vscode.commands.registerCommand('flowcommand.toggleRemoteServer', async () => {
        if (!remoteServer) return;
        
        if (remoteServer.isRunning()) {
            remoteServer.stop();
            void updateRemoteStatusBar();
            vscode.window.showInformationMessage('FlowCommand Remote Server stopped');
        } else {
            try {
                await remoteServer.start();
                void updateRemoteStatusBar();
                const info = remoteServer.getConnectionInfo();
                const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
                
                const action = await vscode.window.showInformationMessage(
                    `Remote Server started! URL: ${networkUrl} | PIN: ${info.pin}`,
                    'Copy URL', 'Copy PIN'
                );
                
                if (action === 'Copy URL') {
                    await vscode.env.clipboard.writeText(networkUrl);
                    vscode.window.showInformationMessage('URL copied to clipboard');
                } else if (action === 'Copy PIN') {
                    await vscode.env.clipboard.writeText(info.pin);
                    vscode.window.showInformationMessage('PIN copied to clipboard');
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to start remote server: ${err}`);
            }
        }
    });

    // Start remote server command
    const startRemoteCmd = vscode.commands.registerCommand('flowcommand.startRemoteServer', async () => {
        if (!remoteServer) return;
        
        if (remoteServer.isRunning()) {
            vscode.window.showInformationMessage('Remote server is already running');
            return;
        }
        
        try {
            await remoteServer.start();
            void updateRemoteStatusBar();
            const info = remoteServer.getConnectionInfo();
            vscode.window.showInformationMessage(
                `Remote Server started: ${info.urls[1] || info.urls[0]} | PIN: ${info.pin}`
            );
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to start remote server: ${err}`);
        }
    });

    // Stop remote server command
    const stopRemoteCmd = vscode.commands.registerCommand('flowcommand.stopRemoteServer', () => {
        if (!remoteServer) return;
        
        if (!remoteServer.isRunning()) {
            vscode.window.showInformationMessage('Remote server is not running');
            return;
        }
        
        remoteServer.stop();
        void updateRemoteStatusBar();
        vscode.window.showInformationMessage('Remote server stopped');
    });

    // Show remote URL command
    const showRemoteUrlCmd = vscode.commands.registerCommand('flowcommand.showRemoteUrl', async () => {
        if (!remoteServer || !remoteServer.isRunning()) {
            vscode.window.showWarningMessage('Remote server is not running. Start it first.');
            return;
        }
        
        const info = remoteServer.getConnectionInfo();
        const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
        
        const action = await vscode.window.showInformationMessage(
            `URL: ${networkUrl}\nPIN: ${info.pin}`,
            'Copy URL', 'Copy PIN', 'Copy Both'
        );
        
        if (action === 'Copy URL') {
            await vscode.env.clipboard.writeText(networkUrl);
        } else if (action === 'Copy PIN') {
            await vscode.env.clipboard.writeText(info.pin);
        } else if (action === 'Copy Both') {
            await vscode.env.clipboard.writeText(`URL: ${networkUrl}\nPIN: ${info.pin}`);
        }
    });

    // Reinject instructions command (force)
    const reinjectInstructionsCmd = vscode.commands.registerCommand('flowcommand.reinjectInstructions', async () => {
        await handleInstructionInjection(true);
    });

    // Get current instruction status (used by settings UI)
    const getInstructionStatusCmd = vscode.commands.registerCommand('flowcommand.getInstructionStatus', async () => {
        return await getInstructionStatus();
    });

    context.subscriptions.push(
        startMcpCmd, restartMcpCmd, stopMcpCmd, toggleMcpCmd, getMcpStatusCmd, showMcpConfigCmd, 
        openHistoryCmd, clearSessionCmd, openSettingsCmd, openPromptsCmd,
        toggleRemoteCmd, startRemoteCmd, stopRemoteCmd, showRemoteUrlCmd,
        reinjectInstructionsCmd, getInstructionStatusCmd,
        remoteServer
    );
}

const FLOWCOMMAND_SECTION_START = '<!-- [FlowCommand] START -->';
const FLOWCOMMAND_SECTION_END = '<!-- [FlowCommand] END -->';
const FLOWCOMMAND_MARKER = '[FlowCommand]';

type InstructionStatus = 'off' | 'correct' | 'missing' | 'modified' | 'corrupted' | 'no-file';

// Storage keys for tracking injection state
const INJECTION_STATE_KEY = 'flowcommand.injectionState';

interface InjectionState {
    method: string;
    contentHash: string;
    timestamp: number;
    acceptedModifiedHash?: string; // hash of user-modified content they chose to "Keep Current"
}

// Extension context reference for state storage
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Simple hash function to detect content changes
 */
function hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
}

/**
 * Get stored injection state from workspace state
 */
function getStoredInjectionState(): InjectionState | undefined {
    if (!extensionContext) return undefined;
    return extensionContext.workspaceState.get<InjectionState>(INJECTION_STATE_KEY);
}

/**
 * Store injection state to workspace state
 */
async function storeInjectionState(state: InjectionState | undefined): Promise<void> {
    if (!extensionContext) return;
    await extensionContext.workspaceState.update(INJECTION_STATE_KEY, state);
}

/**
 * Check if copilot-instructions.md has the correct FlowCommand section
 * Returns: 'correct' | 'missing' | 'modified' | 'corrupted' | 'no-file'
 */
async function checkCopilotInstructionsState(expectedContent: string): Promise<'correct' | 'missing' | 'modified' | 'corrupted' | 'no-file'> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return 'no-file';

    const filePath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.github', 'copilot-instructions.md');

    try {
        const fileData = await vscode.workspace.fs.readFile(filePath);
        const content = Buffer.from(fileData).toString('utf-8');

        const startIdx = content.indexOf(FLOWCOMMAND_SECTION_START);
        const endIdx = content.indexOf(FLOWCOMMAND_SECTION_END);

        // No FlowCommand section found
        if (startIdx === -1 && endIdx === -1) {
            return 'missing';
        }

        // Corrupted: only one marker found
        if ((startIdx === -1) !== (endIdx === -1)) {
            return 'corrupted';
        }

        // Corrupted: end marker before start marker
        if (endIdx < startIdx) {
            return 'corrupted';
        }

        // Extract current section content
        const currentSection = content.substring(startIdx, endIdx + FLOWCOMMAND_SECTION_END.length);
        const expectedSection = `${FLOWCOMMAND_SECTION_START}\n${expectedContent}\n${FLOWCOMMAND_SECTION_END}`;

        if (currentSection === expectedSection) {
            return 'correct';
        }

        return 'modified';
    } catch {
        return 'no-file';
    }
}

/**
 * Get hash of the actual FlowCommand section content in copilot-instructions.md
 * Used to track user-accepted modifications across restarts
 */
async function getActualCopilotInstructionsHash(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;

    const filePath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.github', 'copilot-instructions.md');
    try {
        const fileData = await vscode.workspace.fs.readFile(filePath);
        const content = Buffer.from(fileData).toString('utf-8');
        const startIdx = content.indexOf(FLOWCOMMAND_SECTION_START);
        const endIdx = content.indexOf(FLOWCOMMAND_SECTION_END);
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            const section = content.substring(startIdx, endIdx + FLOWCOMMAND_SECTION_END.length);
            return hashContent(section);
        }
    } catch { /* file doesn't exist */ }
    return undefined;
}

/**
 * Get hash of the actual FlowCommand entry in codeGeneration.instructions settings
 * Used to track user-accepted modifications across restarts
 */
function getActualCodeGenSettingsHash(): string | undefined {
    const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
    const currentInstructions = copilotConfig.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);
    const existingEntry = currentInstructions.find(
        (inst) => inst.text && inst.text.includes(FLOWCOMMAND_MARKER)
    );
    if (existingEntry?.text) {
        return hashContent(existingEntry.text);
    }
    return undefined;
}

/**
 * Check if codeGeneration.instructions has the correct FlowCommand entry
 * Returns: 'correct' | 'missing' | 'modified'
 */
function checkCodeGenSettingsState(expectedContent: string): 'correct' | 'missing' | 'modified' {
    const settingsText = `${FLOWCOMMAND_MARKER} ${expectedContent}`;
    const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
    const currentInstructions = copilotConfig.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);

    const existingEntry = currentInstructions.find(
        (inst) => inst.text && inst.text.includes(FLOWCOMMAND_MARKER)
    );

    if (!existingEntry) {
        return 'missing';
    }

    if (existingEntry.text === settingsText) {
        return 'correct';
    }

    return 'modified';
}

/**
 * Get current instruction injection status for UI display
 */
async function getInstructionStatus(): Promise<InstructionStatus> {
    const config = vscode.workspace.getConfiguration('flowcommand');
    const method = config.get<string>('instructionInjection', 'off');
    const instructionText = getInstructionText();

    if (method === 'off') {
        return 'off';
    }

    if (method === 'copilotInstructionsMd') {
        return await checkCopilotInstructionsState(instructionText);
    }

    const settingsState = checkCodeGenSettingsState(instructionText);
    if (settingsState === 'correct') return 'correct';
    if (settingsState === 'missing') return 'missing';
    return 'modified';
}

/**
 * Refresh status in the webview provider (if available)
 */
async function refreshInstructionStatus(): Promise<InstructionStatus> {
    const status = await getInstructionStatus();
    webviewProvider?.setInstructionStatus(status);
    return status;
}

/**
 * Handle instruction injection based on the selected method.
 * Supports: 'off', 'copilotInstructionsMd', 'codeGenerationSetting'
 * 
 * Smart behavior:
 * - On IDE restart: only inject if not already correctly injected
 * - Detects user changes and warns appropriately
 * - Handles edge cases like corrupted markers
 * 
 * @param forceInject - If true, bypass state checks and force injection (used when settings change)
 */
async function handleInstructionInjection(forceInject: boolean = false): Promise<void> {
    const config = vscode.workspace.getConfiguration('flowcommand');
    const method = config.get<string>('instructionInjection', 'off');
    const instructionText = getInstructionText();

    const contentHash = hashContent(instructionText);
    const storedState = getStoredInjectionState();

    try {
        switch (method) {
            case 'copilotInstructionsMd': {
                // Remove from codeGeneration.instructions if switching methods
                removeFromCodeGenSettings();

                // Check current state of the file
                const fileState = await checkCopilotInstructionsState(instructionText);

                if (fileState === 'correct' && !forceInject) {
                    // Already correctly injected - nothing to do
                    console.log('[FlowCommand] Instructions already correctly injected in copilot-instructions.md');
                    return;
                }

                if (fileState === 'corrupted') {
                    if (forceInject) {
                        // Force fix: remove corrupted markers and re-inject
                        await removeFromCopilotInstructionsMd();
                        await injectIntoCopilotInstructionsMd(true);
                    } else {
                        // Corrupted markers - warn user and offer to fix
                        const action = await vscode.window.showWarningMessage(
                            'FlowCommand detected corrupted instruction markers in copilot-instructions.md. This may cause issues.',
                            'Fix Now',
                            'Ignore'
                        );
                        if (action === 'Fix Now') {
                            await removeFromCopilotInstructionsMd();
                            await injectIntoCopilotInstructionsMd(true);
                        }
                        return;
                    }
                } else if (fileState === 'correct' || fileState === 'modified') {
                    if (forceInject) {
                        // Force re-inject: update the existing section
                        await injectIntoCopilotInstructionsMd(true);
                    } else if (fileState === 'modified') {
                        // Check if user previously accepted this modification
                        const currentFileHash = await getActualCopilotInstructionsHash();
                        if (!forceInject && currentFileHash && storedState?.acceptedModifiedHash === currentFileHash) {
                            console.log('[FlowCommand] User previously accepted modified instructions, skipping prompt');
                            return;
                        }
                        // User modified the FlowCommand section - warn them
                        const action = await vscode.window.showWarningMessage(
                            'FlowCommand instructions in copilot-instructions.md have been modified. Re-inject to restore expected behavior?',
                            'Re-inject',
                            'Keep Current'
                        );
                        if (action === 'Re-inject') {
                            await injectIntoCopilotInstructionsMd(true);
                        } else if (action === 'Keep Current') {
                            // Store acceptance so we don't prompt again on next restart
                            await storeInjectionState({ method, contentHash, timestamp: Date.now(), acceptedModifiedHash: currentFileHash });
                        }
                        return;
                    }
                } else if (fileState === 'missing' || fileState === 'no-file') {
                    // Check if this is a settings-triggered injection (force) or IDE restart
                    if (!forceInject && storedState?.method === method && storedState?.contentHash === contentHash) {
                        // Previously injected with same settings but file/section is now missing
                        // User likely deleted it intentionally - warn but don't auto-inject
                        const action = await vscode.window.showWarningMessage(
                            'FlowCommand instructions are configured but not present in copilot-instructions.md. Re-inject?',
                            'Re-inject',
                            'Turn Off'
                        );
                        if (action === 'Re-inject') {
                            await injectIntoCopilotInstructionsMd(false);
                        } else if (action === 'Turn Off') {
                            await config.update('instructionInjection', 'off', vscode.ConfigurationTarget.Workspace);
                        }
                        return;
                    }
                    // First time injection or settings changed - proceed with injection
                    await injectIntoCopilotInstructionsMd(false);
                }

                // Store the new state
                await storeInjectionState({ method, contentHash, timestamp: Date.now() });
                break;
            }

            case 'codeGenerationSetting': {
                // Remove from copilot-instructions.md if switching methods
                await removeFromCopilotInstructionsMd();

                // Check current state
                const settingsState = checkCodeGenSettingsState(instructionText);

                if (settingsState === 'correct' && !forceInject) {
                    // Already correctly injected
                    console.log('[FlowCommand] Instructions already correctly injected in codeGeneration settings');
                    return;
                }

                if ((settingsState === 'correct' || settingsState === 'modified') && forceInject) {
                    // Force re-inject: update the settings entry
                    injectIntoCodeGenSettings();
                } else if (settingsState === 'modified' && !forceInject) {
                    // Check if user previously accepted this modification
                    const currentSettingsHash = getActualCodeGenSettingsHash();
                    if (currentSettingsHash && storedState?.acceptedModifiedHash === currentSettingsHash) {
                        console.log('[FlowCommand] User previously accepted modified settings instructions, skipping prompt');
                        return;
                    }
                    // User modified - warn
                    const action = await vscode.window.showWarningMessage(
                        'FlowCommand instructions in Code Generation settings have been modified. Re-inject?',
                        'Re-inject',
                        'Keep Current'
                    );
                    if (action === 'Re-inject') {
                        injectIntoCodeGenSettings();
                    } else if (action === 'Keep Current') {
                        // Store acceptance so we don't prompt again on next restart
                        await storeInjectionState({ method, contentHash, timestamp: Date.now(), acceptedModifiedHash: currentSettingsHash });
                    }
                    return;
                } else if (settingsState === 'missing') {
                    if (!forceInject && storedState?.method === method && storedState?.contentHash === contentHash) {
                        // Previously injected but now missing
                        const action = await vscode.window.showWarningMessage(
                            'FlowCommand instructions are configured but not present in Code Generation settings. Re-inject?',
                            'Re-inject',
                            'Turn Off'
                        );
                        if (action === 'Re-inject') {
                            injectIntoCodeGenSettings();
                        } else if (action === 'Turn Off') {
                            await config.update('instructionInjection', 'off', vscode.ConfigurationTarget.Workspace);
                        }
                        return;
                    }
                    injectIntoCodeGenSettings();
                }

                await storeInjectionState({ method, contentHash, timestamp: Date.now() });
                break;
            }

            case 'off':
            default: {
                // Remove from both locations
                removeFromCodeGenSettings();
                await removeFromCopilotInstructionsMd();
                // Clear stored state
                await storeInjectionState(undefined);
                break;
            }
        }
    } catch (err) {
        console.error('[FlowCommand] Failed to handle instruction injection:', err);
    } finally {
        try {
            await refreshInstructionStatus();
        } catch (err) {
            console.error('[FlowCommand] Failed to refresh instruction status:', err);
        }
    }
}

/**
 * Get the instruction text from settings
 */
function getInstructionText(): string {
    const config = vscode.workspace.getConfiguration('flowcommand');
    return config.get<string>('instructionText', '');
}

/**
 * Inject FlowCommand instructions into .github/copilot-instructions.md
 * @param skipPrompt - If true, inject without prompting user (used for re-injection after user confirms)
 */
async function injectIntoCopilotInstructionsMd(skipPrompt: boolean = false): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const instructionText = getInstructionText();
    if (!instructionText.trim()) return;

    const rootUri = workspaceFolders[0].uri;
    const githubDir = vscode.Uri.joinPath(rootUri, '.github');
    const filePath = vscode.Uri.joinPath(githubDir, 'copilot-instructions.md');

    const sectionContent = `\n\n${FLOWCOMMAND_SECTION_START}\n${instructionText}\n${FLOWCOMMAND_SECTION_END}`;

    try {
        // Check if file exists
        let existingContent = '';
        let fileExists = false;
        try {
            const fileData = await vscode.workspace.fs.readFile(filePath);
            existingContent = Buffer.from(fileData).toString('utf-8');
            fileExists = true;
        } catch {
            // File doesn't exist
        }

        // Check if FlowCommand section already exists
        if (fileExists && existingContent.includes(FLOWCOMMAND_SECTION_START)) {
            // Update existing section
            const startIdx = existingContent.indexOf(FLOWCOMMAND_SECTION_START);
            const endIdx = existingContent.indexOf(FLOWCOMMAND_SECTION_END);
            if (startIdx !== -1 && endIdx !== -1) {
                const currentSection = existingContent.substring(startIdx, endIdx + FLOWCOMMAND_SECTION_END.length);
                const newSection = `${FLOWCOMMAND_SECTION_START}\n${instructionText}\n${FLOWCOMMAND_SECTION_END}`;
                if (currentSection !== newSection) {
                    const updatedContent = existingContent.substring(0, startIdx) + newSection + existingContent.substring(endIdx + FLOWCOMMAND_SECTION_END.length);
                    await vscode.workspace.fs.writeFile(filePath, Buffer.from(updatedContent, 'utf-8'));
                    console.log('[FlowCommand] Updated instructions in copilot-instructions.md');
                }
            }
            return;
        }

        // Need to create or append
        if (!skipPrompt) {
            // Ask user for confirmation
            const action = fileExists ? 'append to' : 'create';
            const confirm = await vscode.window.showInformationMessage(
                `FlowCommand wants to ${action} .github/copilot-instructions.md with FlowCommand tool instructions. This ensures the AI always calls ask_user and plan_review.`,
                'Allow',
                'Cancel'
            );

            if (confirm !== 'Allow') {
                // User declined — reset setting to 'off'
                const cfg = vscode.workspace.getConfiguration('flowcommand');
                cfg.update('instructionInjection', 'off', vscode.ConfigurationTarget.Workspace);
                return;
            }
        }

        if (fileExists) {
            // Append to existing file
            const updatedContent = existingContent + sectionContent;
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(updatedContent, 'utf-8'));
            console.log('[FlowCommand] Appended instructions to copilot-instructions.md');
        } else {
            // Create .github directory and file
            try { await vscode.workspace.fs.createDirectory(githubDir); } catch { /* exists */ }
            const newContent = `# Copilot Instructions\n${sectionContent}`;
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(newContent, 'utf-8'));
            console.log('[FlowCommand] Created copilot-instructions.md with instructions');
        }
    } catch (err) {
        console.error('[FlowCommand] Failed to inject into copilot-instructions.md:', err);
    }
}

/**
 * Remove FlowCommand section from .github/copilot-instructions.md
 */
async function removeFromCopilotInstructionsMd(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const filePath = vscode.Uri.joinPath(workspaceFolders[0].uri, '.github', 'copilot-instructions.md');

    try {
        const fileData = await vscode.workspace.fs.readFile(filePath);
        const content = Buffer.from(fileData).toString('utf-8');

        if (!content.includes(FLOWCOMMAND_SECTION_START)) return;

        const startIdx = content.indexOf(FLOWCOMMAND_SECTION_START);
        const endIdx = content.indexOf(FLOWCOMMAND_SECTION_END);
        if (startIdx === -1 || endIdx === -1) return;

        // Remove the section (including surrounding newlines)
        let before = content.substring(0, startIdx);
        let after = content.substring(endIdx + FLOWCOMMAND_SECTION_END.length);

        // Clean up extra newlines
        while (before.endsWith('\n\n')) before = before.slice(0, -1);
        while (after.startsWith('\n\n')) after = after.substring(1);

        const updatedContent = (before + after).trim();

        if (updatedContent.length === 0 || updatedContent === '# Copilot Instructions') {
            // File would be empty or just the header we created — delete it
            await vscode.workspace.fs.delete(filePath);
            console.log('[FlowCommand] Removed copilot-instructions.md (was only FlowCommand content)');
        } else {
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(updatedContent + '\n', 'utf-8'));
            console.log('[FlowCommand] Removed FlowCommand section from copilot-instructions.md');
        }
    } catch {
        // File doesn't exist, nothing to remove
    }
}

/**
 * Inject FlowCommand instructions into workspace-level codeGeneration.instructions setting
 */
function injectIntoCodeGenSettings(): void {
    const instructionText = getInstructionText();
    if (!instructionText.trim()) return;

    // Create a concise version for the settings (settings warn about long instructions)
    const settingsText = `${FLOWCOMMAND_MARKER} ${instructionText}`;

    const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
    const currentInstructions = copilotConfig.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);

    const existingIndex = currentInstructions.findIndex(
        (inst) => inst.text && inst.text.includes(FLOWCOMMAND_MARKER)
    );

    if (existingIndex === -1) {
        const updated = [...currentInstructions, { text: settingsText }];
        copilotConfig.update('codeGeneration.instructions', updated, vscode.ConfigurationTarget.Workspace)
            .then(
                () => console.log('[FlowCommand] Workspace settings instructions injected'),
                (err: unknown) => console.error('[FlowCommand] Failed to inject settings instructions:', err)
            );
    } else if (currentInstructions[existingIndex].text !== settingsText) {
        const updated = [...currentInstructions];
        updated[existingIndex] = { text: settingsText };
        copilotConfig.update('codeGeneration.instructions', updated, vscode.ConfigurationTarget.Workspace)
            .then(
                () => console.log('[FlowCommand] Workspace settings instructions updated'),
                (err: unknown) => console.error('[FlowCommand] Failed to update settings instructions:', err)
            );
    }
}

/**
 * Remove FlowCommand instructions from codeGeneration.instructions setting
 */
function removeFromCodeGenSettings(): void {
    const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
    const currentInstructions = copilotConfig.get<Array<{ text?: string; file?: string }>>('codeGeneration.instructions', []);

    const filtered = currentInstructions.filter(
        (inst) => !(inst.text && inst.text.includes(FLOWCOMMAND_MARKER))
    );

    if (filtered.length !== currentInstructions.length) {
        const newValue = filtered.length > 0 ? filtered : undefined;
        copilotConfig.update('codeGeneration.instructions', newValue, vscode.ConfigurationTarget.Workspace)
            .then(
                () => console.log('[FlowCommand] Removed settings instructions'),
                (err: unknown) => console.error('[FlowCommand] Failed to remove settings instructions:', err)
            );
    }
}

export async function deactivate() {
    // Save current tool call history to persisted history before deactivating
    if (webviewProvider) {
        webviewProvider.saveCurrentSessionToHistory();
        webviewProvider = undefined;
    }

    // Stop remote server
    if (remoteServer) {
        remoteServer.dispose();
        remoteServer = undefined;
    }

    if (mcpServer) {
        await mcpServer.dispose();
        mcpServer = undefined;
    }
}
