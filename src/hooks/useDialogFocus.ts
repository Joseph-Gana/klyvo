import { useEffect, useRef, type RefObject } from 'react';
import {
  focusInitialDialogElement,
  trapTabKeyInContainer,
} from '../utils/focusManagement';

interface DialogStackEntry {
  id: symbol;
  container: HTMLElement | null;
  backgroundElement: HTMLElement | null;
}

const activeDialogStack: DialogStackEntry[] = [];

function getDefaultBackgroundElement(dialogEl: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const root = document.getElementById('root');
  if (root && (!dialogEl || !root.contains(dialogEl))) {
    return root;
  }
  return null;
}

function syncBackgroundInertState() {
  if (typeof document === 'undefined') return;

  const targetedElements = new Set<HTMLElement>();
  for (const entry of activeDialogStack) {
    const bg = entry.backgroundElement ?? getDefaultBackgroundElement(entry.container);
    if (bg) targetedElements.add(bg);
  }

  for (const el of targetedElements) {
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  }
}

function restoreBackgroundIfUnused(
  backgroundEl: HTMLElement | null,
  stillUsed: boolean,
) {
  if (!backgroundEl || stillUsed) return;
  backgroundEl.removeAttribute('inert');
  backgroundEl.removeAttribute('aria-hidden');
}

export interface UseDialogFocusOptions {
  isOpen: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusToRef?: RefObject<HTMLElement | null>;
  backgroundRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  closeOnEscape?: boolean;
}

export function useDialogFocus({
  isOpen,
  containerRef,
  initialFocusRef,
  restoreFocusToRef,
  backgroundRef,
  onEscape,
  closeOnEscape = true,
}: UseDialogFocusOptions): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;

  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const dialogId = Symbol('klyvo-dialog');
    const capturedActive =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    previousActiveElementRef.current = capturedActive;

    const containerEl = containerRef.current;
    const explicitBg = backgroundRef?.current ?? null;
    const managedBg = explicitBg ?? getDefaultBackgroundElement(containerEl);

    const entry: DialogStackEntry = {
      id: dialogId,
      container: containerEl,
      backgroundElement: managedBg,
    };
    activeDialogStack.push(entry);
    syncBackgroundInertState();

    const rafId = window.requestAnimationFrame(() => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      entry.container = currentContainer;
      if (!currentContainer.contains(document.activeElement)) {
        focusInitialDialogElement(
          currentContainer,
          initialFocusRef?.current ?? null,
        );
      }
    });

    const isTopDialog = () =>
      activeDialogStack.length > 0 &&
      activeDialogStack[activeDialogStack.length - 1].id === dialogId;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;

      if (event.key === 'Escape') {
        if (closeOnEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current?.();
        }
        return;
      }

      if (event.key === 'Tab') {
        const currentContainer = containerRef.current;
        if (!currentContainer) return;
        const activeEl =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        trapTabKeyInContainer(currentContainer, event, activeEl);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopDialog()) return;
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      const target = event.target as Node | null;
      if (target && !currentContainer.contains(target)) {
        focusInitialDialogElement(
          currentContainer,
          initialFocusRef?.current ?? null,
        );
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);

      const idx = activeDialogStack.findIndex((item) => item.id === dialogId);
      if (idx !== -1) {
        activeDialogStack.splice(idx, 1);
      }

      const bgStillUsed = activeDialogStack.some(
        (item) =>
          (item.backgroundElement ?? getDefaultBackgroundElement(item.container)) ===
          managedBg,
      );
      restoreBackgroundIfUnused(managedBg, bgStillUsed);
      syncBackgroundInertState();

      const restoreTarget =
        restoreFocusToRef?.current ?? previousActiveElementRef.current;
      previousActiveElementRef.current = null;

      if (restoreTarget && restoreTarget.isConnected) {
        window.requestAnimationFrame(() => {
          if (restoreTarget.isConnected) {
            restoreTarget.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [isOpen, containerRef, initialFocusRef, restoreFocusToRef, backgroundRef]);
}
