export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function isMenuNavigationKey(key: string): key is MenuNavigationKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

export function getNextMenuItemIndex(
  currentIndex: number,
  itemCount: number,
  key: MenuNavigationKey,
): number {
  if (itemCount <= 0) return -1;

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return itemCount - 1;
    case 'ArrowDown':
      if (currentIndex < 0 || currentIndex >= itemCount - 1) return 0;
      return currentIndex + 1;
    case 'ArrowUp':
      if (currentIndex <= 0) return itemCount - 1;
      return currentIndex - 1;
  }
}

export interface EventTargetElementLike {
  tagName?: string;
  isContentEditable?: boolean;
}

export function isEditableElement(target: EventTargetElementLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
