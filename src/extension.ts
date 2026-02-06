import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskSyncWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';
import { ContextManager } from './context';
import { RemoteUiServer, RemoteMessage } from './server/remoteUiServer';

let mcpServer: McpServerManager | undefined;
let webviewProvider: TaskSyncWebviewProvider | undefined;
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
            // Check if tasksync-chat is registered
            if (config.mcpServers?.['tasksync-chat']) {
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

export function activate(context: vscode.ExtensionContext) {
    // Initialize context manager for #terminal, #problems features
    contextManager = new ContextManager();
    context.subscriptions.push({ dispose: () => contextManager?.dispose() });

    const provider = new TaskSyncWebviewProvider(context.extensionUri, context, contextManager);
    webviewProvider = provider;

    // Register the provider and add it to disposables for proper cleanup
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TaskSyncWebviewProvider.viewType, provider),
        provider // Provider implements Disposable for cleanup
    );

    // Register VS Code LM Tools (always available for Copilot)
    registerTools(context, provider);

    // Initialize MCP server manager (but don't start yet)
    mcpServer = new McpServerManager(provider);

    // Check if MCP should auto-start based on settings and external client configs
    // Deferred to avoid blocking activation with file I/O
    const config = vscode.workspace.getConfiguration('tasksync');
    const mcpEnabled = config.get<boolean>('mcpEnabled', false);
    const autoStartIfClients = config.get<boolean>('mcpAutoStartIfClients', true);

    // Start MCP server only if:
    // 1. Explicitly enabled in settings, OR
    // 2. Auto-start is enabled AND external clients are configured
    // Note: Check is deferred to avoid blocking extension activation with file I/O
    if (mcpEnabled) {
        // Explicitly enabled - start immediately without checking external clients
        mcpServer.start();
    } else if (autoStartIfClients) {
        // Defer the external client check to avoid blocking activation
        hasExternalMcpClientsAsync().then(hasClients => {
            if (hasClients && mcpServer) {
                mcpServer.start();
            }
        }).catch(err => {
            console.error('[TaskSync] Failed to check external MCP clients:', err);
        });
    }

    // Start MCP server command
    const startMcpCmd = vscode.commands.registerCommand('tasksync.startMcp', async () => {
        if (mcpServer && !mcpServer.isRunning()) {
            await mcpServer.start();
            vscode.window.showInformationMessage('TaskSync MCP Server started');
        } else if (mcpServer?.isRunning()) {
            vscode.window.showInformationMessage('TaskSync MCP Server is already running');
        }
    });

    // Restart MCP server command
    const restartMcpCmd = vscode.commands.registerCommand('tasksync.restartMcp', async () => {
        if (mcpServer) {
            await mcpServer.restart();
        }
    });

    // Show MCP configuration command
    const showMcpConfigCmd = vscode.commands.registerCommand('tasksync.showMcpConfig', async () => {
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
    const openHistoryCmd = vscode.commands.registerCommand('tasksync.openHistory', () => {
        provider.openHistoryModal();
    });

    // Clear current session command (triggered from view title bar)
    const clearSessionCmd = vscode.commands.registerCommand('tasksync.clearCurrentSession', async () => {
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
    const openSettingsCmd = vscode.commands.registerCommand('tasksync.openSettings', () => {
        provider.openSettingsModal();
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
    remoteStatusBarItem.command = 'tasksync.showRemoteUrl';
    context.subscriptions.push(remoteStatusBarItem);

    // Function to update status bar based on server state
    function updateRemoteStatusBar() {
        if (!remoteStatusBarItem) return;
        
        if (remoteServer?.isRunning()) {
            const info = remoteServer.getConnectionInfo();
            const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
            remoteStatusBarItem.text = '$(broadcast) TaskSync';
            remoteStatusBarItem.tooltip = new vscode.MarkdownString(
                `**TaskSync Remote Server**\n\n` +
                `**URL:** \`${networkUrl}\`\n\n` +
                `**PIN:** \`${info.pin}\`\n\n` +
                `_Click to copy_`
            );
            remoteStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            remoteStatusBarItem.show();
        } else {
            remoteStatusBarItem.hide();
        }
    }

    // Auto-start remote server if enabled
    const remoteConfig = vscode.workspace.getConfiguration('tasksync');
    const remoteEnabled = remoteConfig.get<boolean>('remoteEnabled', false);
    if (remoteEnabled) {
        remoteServer.start().then(() => {
            const info = remoteServer!.getConnectionInfo();
            vscode.window.showInformationMessage(
                `TaskSync Remote started: ${info.urls[1] || info.urls[0]} | PIN: ${info.pin}`
            );
            updateRemoteStatusBar();
        }).catch(err => {
            console.error('[TaskSync] Failed to start remote server:', err);
        });
    }

    // Toggle remote server command (triggered from view title bar)
    const toggleRemoteCmd = vscode.commands.registerCommand('tasksync.toggleRemoteServer', async () => {
        if (!remoteServer) return;
        
        if (remoteServer.isRunning()) {
            remoteServer.stop();
            updateRemoteStatusBar();
            vscode.window.showInformationMessage('TaskSync Remote Server stopped');
        } else {
            try {
                await remoteServer.start();
                updateRemoteStatusBar();
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
    const startRemoteCmd = vscode.commands.registerCommand('tasksync.startRemoteServer', async () => {
        if (!remoteServer) return;
        
        if (remoteServer.isRunning()) {
            vscode.window.showInformationMessage('Remote server is already running');
            return;
        }
        
        try {
            await remoteServer.start();
            updateRemoteStatusBar();
            const info = remoteServer.getConnectionInfo();
            vscode.window.showInformationMessage(
                `Remote Server started: ${info.urls[1] || info.urls[0]} | PIN: ${info.pin}`
            );
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to start remote server: ${err}`);
        }
    });

    // Stop remote server command
    const stopRemoteCmd = vscode.commands.registerCommand('tasksync.stopRemoteServer', () => {
        if (!remoteServer) return;
        
        if (!remoteServer.isRunning()) {
            vscode.window.showInformationMessage('Remote server is not running');
            return;
        }
        
        remoteServer.stop();
        updateRemoteStatusBar();
        vscode.window.showInformationMessage('Remote server stopped');
    });

    // Show remote URL command
    const showRemoteUrlCmd = vscode.commands.registerCommand('tasksync.showRemoteUrl', async () => {
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

    context.subscriptions.push(
        startMcpCmd, restartMcpCmd, showMcpConfigCmd, 
        openHistoryCmd, clearSessionCmd, openSettingsCmd,
        toggleRemoteCmd, startRemoteCmd, stopRemoteCmd, showRemoteUrlCmd,
        remoteServer
    );
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
