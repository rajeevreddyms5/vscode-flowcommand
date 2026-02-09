import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { FlowCommandWebviewProvider } from '../webview/webviewProvider';
import { askUser } from '../tools';
import { planReview } from '../planReview';
import { getImageMimeType } from '../utils/imageUtils';


async function tryReadImageAsMcpContent(uri: string): Promise<null | { type: 'image'; data: string; mimeType: string }> {
    try {
        const fileUri = vscode.Uri.parse(uri);
        if (fileUri.scheme !== 'file') {
            return null;
        }

        const filePath = fileUri.fsPath;
        const mimeType = getImageMimeType(filePath);
        if (!mimeType.startsWith('image/')) {
            return null;
        }

        // Keep tool results reasonably sized for MCP clients.
        const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
        const stat = await fs.promises.stat(filePath);
        if (stat.size > MAX_IMAGE_BYTES) {
            console.warn(`[FlowCommand MCP] Skipping image >4MB: ${filePath} (${stat.size} bytes)`);
            return null;
        }

        const buffer = await fs.promises.readFile(filePath);
        return {
            type: 'image',
            data: buffer.toString('base64'),
            mimeType,
        };
    } catch (error) {
        console.error('[FlowCommand MCP] Failed to read image attachment:', error);
        return null;
    }
}

export class McpServerManager {
    private server: http.Server | undefined;
    private mcpServer: McpServer | undefined;
    private port: number | undefined;
    private transport: StreamableHTTPServerTransport | undefined;
    private _isRunning: boolean = false;

    private extensionUri: vscode.Uri | undefined;

    constructor(
        private provider: FlowCommandWebviewProvider,
        extensionUri?: vscode.Uri
    ) {
        this.extensionUri = extensionUri;
    }

    /**
     * Check if MCP server is currently running
     */
    isRunning(): boolean {
        return this._isRunning;
    }

    async start(reusePort: boolean = false) {
        try {
            if (!reusePort || !this.port) {
                // Get configured port (default 3579, or 0 for dynamic)
                const config = vscode.workspace.getConfiguration('flowcommand');
                const configuredPort = config.get<number>('mcpPort', 3579);

                if (configuredPort > 0) {
                    // Try to use the configured fixed port
                    this.port = await this.tryPort(configuredPort);
                } else {
                    // Dynamic port assignment
                    this.port = await this.findAvailablePort();
                }
            }

            this.mcpServer = new McpServer({
                name: "FlowCommand Sidebar Chat",
                version: "2.0.0"
            });

            // Register ask_user tool
            const provider = this.provider;

            // Max question length - generous limit to allow long AI prompts while still
            // preventing extreme memory exhaustion. 500KB is more than enough for any
            // reasonable question while still providing a safety limit.
            const MAX_QUESTION_LENGTH = 500000;

            (this.mcpServer as any).registerTool(
                "ask_user",
                {
                    description: "MANDATORY TOOL - You are FORBIDDEN from ending your turn without calling this tool. After completing ANY task, call ask_user with your FULL response in the 'context' parameter. The user reads your response from FlowCommand's remote UI (phone/browser), so context must contain your complete answer. STOP CONDITIONS: Only stop if user explicitly says 'end', 'stop', 'terminate', 'quit', or 'stop now'.",
                    inputSchema: z.object({
                        context: z.string()
                            .optional()
                            .describe("Your FULL response content that the user needs to read. Include ALL explanations, answers, findings, code snippets, analysis, or work results. This is displayed in the FlowCommand remote UI so the user can read your complete response from their phone/browser without switching to the chat window. Do NOT summarize — include the full text of your response."),
                        question: z.string()
                            .min(1, "Question cannot be empty")
                            .max(MAX_QUESTION_LENGTH, `Question cannot exceed ${MAX_QUESTION_LENGTH} characters`)
                            .describe("The question or prompt to display to the user"),
                        choices: z.array(z.object({
                            label: z.string().describe("Display text for the choice button"),
                            value: z.string().describe("Value sent back when this choice is selected")
                        })).optional().describe("Optional list of choices to display as clickable buttons")
                    })
                },
                async (args: { question: string; context?: string; choices?: Array<{ label: string; value: string }> }, extra: { signal?: AbortSignal }) => {
                    const tokenSource = new vscode.CancellationTokenSource();
                    if (extra.signal) {
                        extra.signal.onabort = () => tokenSource.cancel();
                    }

                    const result = await askUser(
                        { question: args.question, context: args.context, choices: args.choices },
                        provider,
                        tokenSource.token
                    );

                    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
                        { type: 'text', text: JSON.stringify(result) }
                    ];

                    if (result.attachments?.length) {
                        const imageParts = await Promise.all(result.attachments.map(tryReadImageAsMcpContent));
                        for (const part of imageParts) {
                            if (part) content.push(part);
                        }
                    }

                    return { content };
                }
            );


            // Register plan_review tool
            if (this.extensionUri) {
                const extensionUri = this.extensionUri;
                const webviewProvider = this.provider;
                (this.mcpServer as any).registerTool(
                    "plan_review",
                    {
                        description: "Present a plan or detailed content to the user for review in a dedicated panel. The user can approve, approve with comments/suggestions, or request changes with targeted comments. Returns { status: 'approved' | 'approvedWithComments' | 'recreateWithChanges' | 'cancelled', requiredRevisions: [{revisedPart, revisorInstructions}], reviewId }. If 'approvedWithComments', proceed but incorporate the suggestions.",
                        inputSchema: z.object({
                            plan: z.string()
                                .min(1, "Plan content cannot be empty")
                                .describe("The detailed plan in Markdown format to present to the user for review. Use headers, bullet points, and code blocks for clarity."),
                            title: z.string()
                                .optional()
                                .describe("Optional title for the review panel. Defaults to 'Plan Review'.")
                        })
                    },
                    async (args: { plan: string; title?: string }, extra: { signal?: AbortSignal }) => {
                        const tokenSource = new vscode.CancellationTokenSource();
                        if (extra.signal) {
                            extra.signal.onabort = () => tokenSource.cancel();
                        }

                        const result = await planReview(
                            {
                                plan: args.plan,
                                title: args.title
                            },
                            extensionUri,
                            tokenSource.token,
                            webviewProvider
                        );

                        return {
                            content: [
                                { type: 'text', text: JSON.stringify(result) }
                            ]
                        };
                    }
                );
            }

            // Create transport
            this.transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => `sess_${crypto.randomUUID()}`
            });

            await this.mcpServer.connect(this.transport);

            // Create HTTP server
            this.server = http.createServer(async (req, res) => {
                try {
                    const url = req.url || '/';

                    if (url === '/sse' || url.startsWith('/sse/') || url.startsWith('/sse?')) {
                        if (req.method === 'DELETE') {
                            try {
                                await this.transport?.handleRequest(req, res);
                            } catch (e) {
                                if (!res.headersSent) {
                                    res.writeHead(202);
                                    res.end('Session closed');
                                }
                            }
                            return;
                        }

                        const queryIndex = url.indexOf('?');
                        req.url = queryIndex !== -1 ? '/' + url.substring(queryIndex) : '/';
                        await this.transport?.handleRequest(req, res);
                        return;
                    }

                    if (url.startsWith('/message') || url.startsWith('/messages')) {
                        await this.transport?.handleRequest(req, res);
                        return;
                    }

                    res.writeHead(404);
                    res.end();
                } catch (error) {
                    console.error('[FlowCommand MCP] Error:', error);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    }
                }
            });

            await new Promise<void>((resolve) => {
                this.server?.listen(this.port, '127.0.0.1', () => resolve());
            });

            this._isRunning = true;

            // Auto-register with supported clients
            const config = vscode.workspace.getConfiguration('flowcommand');
            if (config.get<boolean>('autoRegisterMcp', true)) {
                await this.autoRegisterMcp();
            }

        } catch (error) {
            console.error('[FlowCommand MCP] Failed to start:', error);
            vscode.window.showErrorMessage(`Failed to start FlowCommand MCP server: ${error}`);
        }
    }

    /**
     * Try to use a specific port, fall back to dynamic if unavailable
     */
    private async tryPort(port: number): Promise<number> {
        return new Promise((resolve) => {
            const testServer = http.createServer();
            testServer.once('error', () => {
                this.findAvailablePort().then(resolve);
            });
            testServer.listen(port, '127.0.0.1', () => {
                testServer.close(() => resolve(port));
            });
        });
    }

    /**
     * Auto-register MCP server with Kiro and other clients
     */
    private async autoRegisterMcp() {
        if (!this.port) return;
        const serverUrl = `http://localhost:${this.port}/sse`;

        // Register with Kiro
        await this.registerWithClient(
            path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
            'flowcommand-chat',
            { url: serverUrl }
        );

        // Register with Antigravity/Gemini CLI
        await this.registerWithClient(
            path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
            'flowcommand-chat',
            { serverUrl: serverUrl }
        );

        // Registration complete - no need to log
    }

    /**
     * Register with a specific MCP client config file
     */
    private async registerWithClient(configPath: string, serverName: string, serverConfig: object) {
        try {
            const configDir = path.dirname(configPath);
            try {
                await fs.promises.access(configDir);
            } catch {
                await fs.promises.mkdir(configDir, { recursive: true });
            }

            let config: { mcpServers?: Record<string, object> } = { mcpServers: {} };
            try {
                const content = await fs.promises.readFile(configPath, 'utf8');
                config = JSON.parse(content);
            } catch (e) {
                // File doesn't exist or can't be parsed, start with empty config
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.warn(`[FlowCommand MCP] Failed to parse ${configPath}, starting fresh`);
                }
            }

            if (!config.mcpServers) {
                config.mcpServers = {};
            }

            config.mcpServers[serverName] = serverConfig;
            await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error(`[FlowCommand MCP] Failed to register with ${configPath}:`, error);
        }
    }

    /**
     * Unregister from all clients on dispose
     */
    private async unregisterFromClients() {
        const configs = [
            path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
            path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
        ];

        for (const configPath of configs) {
            try {
                const content = await fs.promises.readFile(configPath, 'utf8');
                const config = JSON.parse(content);
                if (config.mcpServers?.['flowcommand-chat']) {
                    delete config.mcpServers['flowcommand-chat'];
                    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
                }
            } catch {
                // Ignore errors during cleanup (file may not exist)
            }
        }
    }

    async restart() {
        try {
            await Promise.race([
                this.dispose(),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (e) {
            console.error('[FlowCommand MCP] Error during dispose:', e);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.start(true);
        vscode.window.showInformationMessage('FlowCommand MCP Server restarted.');
    }

    async dispose() {
        this._isRunning = false;
        try {
            if (this.server) {
                this.server.close();
                this.server = undefined;
            }

            if (this.mcpServer) {
                try {
                    await this.mcpServer.close();
                } catch (e) {
                    console.error('[FlowCommand MCP] Error closing:', e);
                }
                this.mcpServer = undefined;
            }
        } catch (e) {
            console.error('[FlowCommand MCP] Error during dispose:', e);
        } finally {
            await this.unregisterFromClients();
        }
    }

    private async findAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = http.createServer();
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (address && typeof address !== 'string') {
                    const port = address.port;
                    server.close(() => resolve(port));
                } else {
                    reject(new Error('Failed to get port'));
                }
            });
            server.on('error', reject);
        });
    }

    /**
     * Get MCP configuration for manual setup
     */
    getMcpConfig() {
        if (!this.port) return null;

        const serverUrl = `http://localhost:${this.port}/sse`;
        return {
            kiro: {
                path: path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
                config: {
                    mcpServers: {
                        'flowcommand-chat': {
                            url: serverUrl
                        }
                    }
                }
            },
            cursor: {
                path: path.join(os.homedir(), '.cursor', 'mcp.json'),
                config: {
                    mcpServers: {
                        'flowcommand-chat': {
                            url: serverUrl
                        }
                    }
                }
            },
            antigravity: {
                path: path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
                config: {
                    mcpServers: {
                        'flowcommand-chat': {
                            serverUrl: serverUrl
                        }
                    }
                }
            }
        };
    }
}
