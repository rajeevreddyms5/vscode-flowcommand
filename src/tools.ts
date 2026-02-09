import * as vscode from 'vscode';
import * as fs from 'fs';
import { TaskSyncWebviewProvider } from './webview/webviewProvider';
import { getImageMimeType } from './utils/imageUtils';

export interface Input {
    question: string;
    context?: string;
    choices?: Array<{ label: string; value: string }>;
}

export interface AskUserToolResult {
    response: string;
    attachments: string[];
}

// Types for ask_questions tool
export interface QuestionOption {
    label: string;
    description?: string;
    recommended?: boolean;
}

export interface Question {
    header: string;
    question: string;
    options?: QuestionOption[];
    multiSelect?: boolean;
    allowFreeformInput?: boolean;
}

export interface AskQuestionsInput {
    questions: Question[];
}

export interface QuestionAnswer {
    header: string;
    selectedOptions?: string[];
    freeformText?: string;
}

export interface AskQuestionsResult {
    answers: QuestionAnswer[];
}

/**
 * Reads a file as Uint8Array for efficient binary handling
 */
async function readFileAsBuffer(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buffer);
}

/**
 * Creates a cancellation promise with proper cleanup to prevent memory leaks.
 * Returns both the promise and a dispose function to clean up the event listener.
 */
function createCancellationPromise(token: vscode.CancellationToken): {
    promise: Promise<never>;
    dispose: () => void;
} {
    let disposable: vscode.Disposable | undefined;

    const promise = new Promise<never>((_, reject) => {
        if (token.isCancellationRequested) {
            reject(new vscode.CancellationError());
            return;
        }
        disposable = token.onCancellationRequested(() => {
            reject(new vscode.CancellationError());
        });
    });

    return {
        promise,
        dispose: () => disposable?.dispose()
    };
}

/**
 * Core logic to ask user, reusable by MCP server
 * Queue handling and history tracking is done in waitForUserResponse()
 */
export async function askUser(
    params: Input,
    provider: TaskSyncWebviewProvider,
    token: vscode.CancellationToken
): Promise<AskUserToolResult> {
    // Check if already cancelled before starting
    if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
    }

    // Create cancellation promise with cleanup capability
    const cancellation = createCancellationPromise(token);

    try {
        // Race the user response against cancellation
        const result = await Promise.race([
            provider.waitForUserResponse(params.question, params.choices, params.context),
            cancellation.promise
        ]);

        // Handle case where request was superseded by another call
        if (result.cancelled) {
            return {
                response: result.value,
                attachments: []
            };
        }

        let responseText = result.value;
        const validAttachments: string[] = [];

        // Process attachments to resolve context content
        if (result.attachments && result.attachments.length > 0) {
            // When user submits only attachments without typing text, add a descriptive header
            // so the AI model doesn't think the response is empty
            if (!responseText.trim()) {
                responseText = '(User attached the following files/context without additional text)';
            }
            for (const att of result.attachments) {
                if (att.uri.startsWith('context://')) {
                    // Start of context content
                    responseText += `\n\n[Attached Context: ${att.name}]\n`;

                    const content = await provider.resolveContextContent(att.uri);
                    if (content) {
                        responseText += content;
                    } else {
                        responseText += '(Context content not available)';
                    }

                    // End of context content
                    responseText += '\n[End of Context]\n';
                } else {
                    // Regular file attachment - check if image or text
                    try {
                        const fileUri = vscode.Uri.parse(att.uri);
                        const filePath = fileUri.fsPath;
                        const mimeType = getImageMimeType(filePath);

                        if (mimeType !== 'application/octet-stream') {
                            // Image file → pass through for LanguageModelDataPart
                            validAttachments.push(att.uri);
                        } else {
                            // Non-image file → read content and include as text
                            const stats = await fs.promises.stat(filePath);
                            if (stats.size > 500 * 1024) {
                                responseText += `\n\n[Attached File: ${att.name}] (File too large: ${(stats.size / 1024).toFixed(1)}KB, max 500KB for text inclusion)\n`;
                            } else {
                                const fileContent = await fs.promises.readFile(filePath, 'utf-8');
                                responseText += `\n\n[Attached File: ${att.name}]\n`;
                                responseText += '```\n' + fileContent + '\n```';
                                responseText += '\n[End of File]\n';
                            }
                        }
                    } catch (err) {
                        responseText += `\n\n[Attached File: ${att.name}] (Error: could not read file)\n`;
                    }
                }
            }
        }

        return {
            response: responseText,
            attachments: validAttachments
        };
    } catch (error) {
        // Handle cancellation: clean up pending state in provider before re-throwing
        if (error instanceof vscode.CancellationError) {
            provider.cancelPendingRequest();
            throw error;
        }
        // Log other errors
        console.error('[TaskSync] askUser error:', error instanceof Error ? error.message : error);
        // Show error to user so they know something went wrong
        vscode.window.showErrorMessage(`TaskSync: ${error instanceof Error ? error.message : 'Failed to show question'}`);
        return {
            response: '',
            attachments: []
        };
    } finally {
        // Always clean up the cancellation listener to prevent memory leaks
        cancellation.dispose();
    }
}

export function registerTools(context: vscode.ExtensionContext, provider: TaskSyncWebviewProvider) {

    // Register ask_user tool (VS Code native LM tool)
    const askUserTool = vscode.lm.registerTool('ask_user', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<Input>, token: vscode.CancellationToken) {
            const params = options.input;

            try {
                const result = await askUser(params, provider, token);

                // Build result parts - text first, then images
                const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        response: result.response,
                        queued: provider.isQueueEnabled(),
                        attachmentCount: result.attachments.length
                    }))
                ];

                // Add image attachments as LanguageModelDataPart for vision models
                if (result.attachments && result.attachments.length > 0) {
                    const imagePromises = result.attachments.map(async (uri) => {
                        try {
                            const fileUri = vscode.Uri.parse(uri);
                            const filePath = fileUri.fsPath;

                            // Check if file exists
                            if (!fs.existsSync(filePath)) {
                                console.error('[TaskSync] Attachment file does not exist:', filePath);
                                return null;
                            }

                            const mimeType = getImageMimeType(filePath);

                            // Only process image files (skip non-image attachments)
                            if (mimeType !== 'application/octet-stream') {
                                const data = await readFileAsBuffer(filePath);
                                const dataPart = vscode.LanguageModelDataPart.image(data, mimeType);
                                return dataPart;
                            }
                            return null;
                        } catch (error) {
                            console.error('[TaskSync] Failed to read image attachment:', error);
                            return null;
                        }
                    });

                    const imageParts = await Promise.all(imagePromises);
                    for (const part of imageParts) {
                        if (part !== null) {
                            resultParts.push(part);
                        }
                    }
                }

                return new vscode.LanguageModelToolResult(resultParts);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart("Error: " + message)
                ]);
            }
        }
    });

    context.subscriptions.push(askUserTool);
}
