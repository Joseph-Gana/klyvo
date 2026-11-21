import { useEffect, type RefObject } from 'react';
import {
  getNextMenuItemIndex,
  isEditableElement,
  isMenuNavigationKey,
} from '../utils/menuNavigation';

export interface UseDropdownMenuOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
}

function getEnabledMenuItems(menuEl: HTMLElement | null): HTMLElement[] {
  if (!menuEl) return [];
  return Array.from(
    menuEl.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
    ),
  );
}

export function useDropdownMenu({
  isOpen,
  onClose,
  containerRef,
  menuRef,
  triggerRef,
}: UseDropdownMenuOptions): void {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const rafId = window.requestAnimationFrame(() => {
      const items = getEnabledMenuItems(menuRef.current);
      if (items.length > 0) {
        items[0].focus({ preventScroll: true });
      }
    });

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isEditableElement(target) && !menuRef.current?.contains(target)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        window.requestAnimationFrame(() => {
          triggerRef.current?.focus({ preventScroll: true });
        });
        return;
      }

      if (event.key === 'Tab') {
        onClose();
        return;
      }

      if (isMenuNavigationKey(event.key)) {
        const items = getEnabledMenuItems(menuRef.current);
        if (items.length === 0) return;

        event.preventDefault();
        event.stopPropagation();

        const currentIndex = items.findIndex(
          (item) => item === document.activeElement,
        );
        const nextIndex = getNextMenuItemIndex(
          currentIndex,
          items.length,
          event.key,
        );
        if (nextIndex >= 0 && items[nextIndex]) {
          items[nextIndex].focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, containerRef, menuRef, triggerRef]);
}
