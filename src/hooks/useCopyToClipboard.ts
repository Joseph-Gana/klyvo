import { useCallback, useState } from 'react';

export function useCopyToClipboard(timeoutMs = 1800) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback(
    async (text: string, id = 'default'): Promise<boolean> => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }
        setCopiedId(id);
        window.setTimeout(() => {
          setCopiedId((current) => (current === id ? null : current));
        }, timeoutMs);
        return true;
      } catch {
        return false;
      }
    },
    [timeoutMs],
  );

  return { copiedId, copy };
}
