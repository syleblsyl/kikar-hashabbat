import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Go back inside the app; if there is nothing to go back to, go home instead of leaving the app. */
export function useBack() {
  const nav = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav('/', { replace: true });
  }, [nav]);
}
