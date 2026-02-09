import * as vscode from 'vscode';
import { PlanReviewInput, PlanReviewToolResult, PlanReviewPanelResult } from './types';
import { FlowCommandWebviewProvider } from '../webview/webviewProvider';
import { PlanReviewPanel } from './planReviewPanel';

/**
 * Unique ID generator for plan reviews
 */
function generateReviewId(): string {
    return `pr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Pending plan review promises — resolved when remote client submits a response.
 * Used to coordinate between VS Code panel and remote clients.
 */
const pendingReviews: Map<string, (result: PlanReviewPanelResult) => void> = new Map();

/**
 * Resolve a pending plan review from the sidebar or remote client.
 * Also closes the VS Code panel if open.
 * Called by webviewProvider._handlePlanReviewResponse().
 */
export function resolvePlanReview(reviewId: string, result: PlanReviewPanelResult): boolean {
    const resolve = pendingReviews.get(reviewId);
    if (resolve) {
        resolve(result);
        pendingReviews.delete(reviewId);
        // Also close VS Code panel if open (remote client responded first)
        PlanReviewPanel.closeIfOpen(reviewId);
        return true;
    }
    return false;
}

/**
 * Core logic for plan review.
 * Opens dedicated editor panel in VS Code AND broadcasts to remote clients.
 * First response (VS Code or remote) wins.
 */
export async function planReview(
    params: PlanReviewInput,
    extensionUri: vscode.Uri,
    token: vscode.CancellationToken,
    webviewProvider?: FlowCommandWebviewProvider
): Promise<PlanReviewToolResult> {
    // Check if already cancelled
    if (token.isCancellationRequested) {
        return { status: 'cancelled', requiredRevisions: [], reviewId: '' };
    }

    const reviewId = generateReviewId();
    const plan = params.plan;
    const title = params.title || 'Plan Review';

    // Set up cancellation handling
    const cancellationDisposable = token.onCancellationRequested(() => {
        console.log('[FlowCommand] planReview cancelled by agent:', reviewId);
        // Clean up pending review
        const resolve = pendingReviews.get(reviewId);
        if (resolve) {
            resolve({ action: 'closed', requiredRevisions: [] });
            pendingReviews.delete(reviewId);
        }
        // Close VS Code panel if open
        PlanReviewPanel.closeIfOpen(reviewId);
        // Broadcast completion to dismiss remote modals
        if (webviewProvider) {
            webviewProvider.broadcastPlanReviewCompleted(reviewId, 'cancelled');
        }
    });

    try {
        // Play notification sound, show desktop notification, auto-focus, mobile notification
        if (webviewProvider) {
            webviewProvider.triggerPlanReviewNotifications(title);
        }

        // Broadcast plan review to remote clients (mobile/browser)
        if (webviewProvider) {
            webviewProvider.broadcastPlanReview(reviewId, title, plan);
        }

        // Open dedicated VS Code editor panel AND set up remote response handling
        // First response (VS Code panel or remote client) wins
        const result = await Promise.race([
            // VS Code editor panel
            PlanReviewPanel.showWithOptions(extensionUri, {
                plan,
                title,
                readOnly: false,
                existingComments: [],
                interactionId: reviewId
            }),
            // Remote client response (sidebar/mobile/browser)
            new Promise<PlanReviewPanelResult>((resolve) => {
                pendingReviews.set(reviewId, resolve);
            })
        ]);

        // Clean up the loser
        pendingReviews.delete(reviewId);
        PlanReviewPanel.closeIfOpen(reviewId);

        // Map action to tool result status
        const status: PlanReviewToolResult['status'] = [
            'approved',
            'approvedWithComments',
            'recreateWithChanges',
            'cancelled'
        ].includes(result.action)
            ? result.action as PlanReviewToolResult['status']
            : 'cancelled';

        const toolResult: PlanReviewToolResult = {
            status,
            requiredRevisions: result.requiredRevisions,
            reviewId
        };

        // Record plan review to session history
        if (webviewProvider) {
            webviewProvider.recordPlanReview(reviewId, title, status, plan, result.requiredRevisions);
        }

        // Broadcast completion to dismiss remote modals
        if (webviewProvider) {
            webviewProvider.broadcastPlanReviewCompleted(reviewId, status);
        }

        return toolResult;
    } catch (error) {
        console.error('[FlowCommand] Error in plan review:', error);
        return {
            status: 'cancelled',
            requiredRevisions: [],
            reviewId
        };
    } finally {
        cancellationDisposable.dispose();
        pendingReviews.delete(reviewId);
        PlanReviewPanel.closeIfOpen(reviewId);
    }
}

/**
 * Register the plan_review tool as a VS Code Language Model Tool
 */
export function registerPlanReviewTool(
    context: vscode.ExtensionContext,
    webviewProvider?: FlowCommandWebviewProvider
): vscode.Disposable {
    const planReviewTool = vscode.lm.registerTool('plan_review', {
        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<PlanReviewInput>,
            token: vscode.CancellationToken
        ) {
            const params = options.input;

            // Validate input
            if (!params || !params.plan || typeof params.plan !== 'string' || params.plan.trim().length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        status: 'cancelled',
                        requiredRevisions: [],
                        reviewId: '',
                        error: 'Validation error: plan content is required and cannot be empty'
                    }))
                ]);
            }

            try {
                const result = await planReview(
                    {
                        plan: params.plan,
                        title: params.title
                    },
                    context.extensionUri,
                    token,
                    webviewProvider
                );

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(result))
                ]);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        status: 'cancelled',
                        requiredRevisions: [],
                        reviewId: '',
                        error: message
                    }))
                ]);
            }
        }
    });

    return planReviewTool;
}
