export interface FocusableElementLike {
  focus: (options?: { preventScroll?: boolean }) => void;
  hasAttribute?: (name: string) => boolean;
  getAttribute?: (name: string) => string | null;
  tabIndex?: number;
  disabled?: boolean;
}

export interface DialogContainerLike<T extends FocusableElementLike = FocusableElementLike> {
  querySelectorAll: (selector: string) => Iterable<T>;
  querySelector?: (selector: string) => T | null;
  focus?: (options?: { preventScroll?: boolean }) => void;
  tabIndex?: number;
}

export interface TabTrapEventLike {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isElementVisibleAndEnabled(el: FocusableElementLike): boolean {
  if (el.disabled) return false;
  if (el.hasAttribute?.('disabled') || el.hasAttribute?.('hidden')) return false;
  if (el.getAttribute?.('aria-hidden') === 'true') return false;
  if (el.getAttribute?.('tabindex') === '-1') return false;

  if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined' && el instanceof HTMLElement) {
    if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }

  return true;
}

export function getFocusableElements<T extends FocusableElementLike>(
  container: DialogContainerLike<T> | null | undefined,
): T[] {
  if (!container) return [];
  const candidates = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => isElementVisibleAndEnabled(el));
}

export function focusInitialDialogElement<T extends FocusableElementLike>(
  container: DialogContainerLike<T> | null | undefined,
  preferredTarget?: T | null,
): T | null {
  if (!container) return null;

  if (preferredTarget && isElementVisibleAndEnabled(preferredTarget)) {
    preferredTarget.focus({ preventScroll: true });
    return preferredTarget;
  }

  const autoFocusTarget = container.querySelector?.('[data-autofocus]');
  if (autoFocusTarget && isElementVisibleAndEnabled(autoFocusTarget)) {
    autoFocusTarget.focus({ preventScroll: true });
    return autoFocusTarget;
  }

  const focusables = getFocusableElements(container);
  if (focusables.length > 0) {
    focusables[0].focus({ preventScroll: true });
    return focusables[0];
  }

  container.focus?.({ preventScroll: true });
  return null;
}

export function trapTabKeyInContainer<T extends FocusableElementLike>(
  container: DialogContainerLike<T> | null | undefined,
  event: TabTrapEventLike,
  activeElement: T | null | undefined,
): boolean {
  if (!container || event.key !== 'Tab') {
    return false;
  }

  const focusables = getFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    container.focus?.({ preventScroll: true });
    return true;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const currentIndex = activeElement ? focusables.indexOf(activeElement) : -1;

  if (event.shiftKey) {
    if (currentIndex <= 0) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  if (currentIndex === -1 || currentIndex >= focusables.length - 1) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }

  return false;
}
