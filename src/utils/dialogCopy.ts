/**
 * Returns user-facing confirmation text for deleting a conversation that is
 * accurate for both local guest storage and Supabase-backed authenticated accounts.
 */
export function formatDeleteConversationMessage(title?: string | null): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return `Are you sure you want to delete "${trimmedTitle}"? This action cannot be undone.`;
  }
  return 'Are you sure you want to delete this conversation? This action cannot be undone.';
}
