import { useCallback, useEffect, useState } from 'react';

let push: ((msg: string) => void) | null = null;

/** Show a short confirmation at the bottom of the screen. */
export function toast(msg: string) {
  push?.(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => setMsg(m), []);
  useEffect(() => {
    push = show;
    return () => {
      push = null;
    };
  }, [show]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}
