import { useCallback, useEffect, useState } from 'react';

type Msg = { text: string; err: boolean; n: number };
let push: ((m: Msg) => void) | null = null;
let counter = 0;

/** Show a short message at the top of the screen. `err` shows it in red and a little longer. */
export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  push?.({ text, err: kind === 'err', n: ++counter });
}

export function ToastHost() {
  const [msg, setMsg] = useState<Msg | null>(null);
  const show = useCallback((m: Msg) => setMsg(m), []);
  useEffect(() => {
    push = show;
    return () => {
      push = null;
    };
  }, [show]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.err ? 3600 : 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? (
    <div key={msg.n} className={`toast${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'} onClick={() => setMsg(null)}>
      {msg.text}
    </div>
  ) : null;
}
