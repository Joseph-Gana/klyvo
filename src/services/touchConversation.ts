export interface TimestampUpdateResult {
  error: { message: string } | null;
}

/**
 * Runs a conversation `updated_at` timestamp update and logs any database error
 * or unexpected rejection without causing an already-saved message to fail.
 */
export async function touchConversationTimestamp(
  conversationId: string,
  runUpdate: () => PromiseLike<TimestampUpdateResult>,
): Promise<boolean> {
  try {
    const { error } = await runUpdate();

    if (error) {
      console.warn('[klyvo:workspaceService] Failed to update conversation timestamp:', {
        conversationId,
        message: error.message,
      });
      return false;
    }

    return true;
  } catch (err: unknown) {
    console.warn('[klyvo:workspaceService] Unexpected error updating conversation timestamp:', {
      conversationId,
      message: err instanceof Error ? err.message : 'Unknown error',
    });
    return false;
  }
}
