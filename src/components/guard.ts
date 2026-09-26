import { useEffect, useRef } from 'react';
import { ask } from './Dialog';

type Guard = () => Promise<boolean>;
let current: Guard | null = null;

/** Asks the open screen whether it is OK to leave (unsaved changes). */
export async function canLeave(): Promise<boolean> {
  return current ? current() : true;
}

/** While `dirty`, leaving the screen (back arrow, Android back) asks first. `onLeave` can save instead of asking. */
export function useLeaveGuard(dirty: boolean, onLeave?: () => Promise<boolean>) {
  const fn = useRef(onLeave);
  fn.current = onLeave;
  useEffect(() => {
    if (!dirty) return;
    const g: Guard = () =>
      fn.current
        ? fn.current()
        : ask({ title: 'יש שינויים שלא נשמרו', text: 'לצאת בלי לשמור? מה שהוקלד יימחק.', ok: 'לצאת בלי לשמור', cancel: 'להישאר', danger: true });
    current = g;
    return () => {
      if (current === g) current = null;
    };
  }, [dirty]);
}
