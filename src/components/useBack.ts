import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { canLeave } from './guard';

/**
 * Go back inside the app (asking first if the screen has unsaved changes); with no history, go home instead of leaving the app.
 * `force` skips the question (used right after saving).
 */
export function useBack() {
  const nav = useNavigate();
  return useCallback(
    async (opts?: { force?: boolean }) => {
      if (!opts?.force && !(await canLeave())) return;
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) nav(-1);
      else nav('/', { replace: true });
    },
    [nav],
  );
}
