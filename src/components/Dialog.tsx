import { useEffect, useRef, useState } from 'react';

type Choice = { label: string; value: string; danger?: boolean };

type Req =
  | { kind: 'choose'; title: string; text?: string; options: Choice[]; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; text?: string; ok: string; cancel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; text?: string; ok: string; cancel: string; value: string; placeholder?: string; resolve: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;
let dismiss: (() => boolean) | null = null;

/** Closes an open dialog (Android back). Returns true if one was open. */
export function dismissDialog(): boolean {
  return dismiss ? dismiss() : false;
}

/** In-app yes/no dialog with Hebrew buttons. Resolves true when confirmed. */
export function ask(o: { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.confirm([o.title, o.text].filter(Boolean).join('\n')));
    push({ kind: 'confirm', title: o.title, text: o.text, ok: o.ok ?? 'אישור', cancel: o.cancel ?? 'ביטול', danger: !!o.danger, resolve });
  });
}

/** In-app dialog with several answers (plus "ביטול"). Resolves the chosen value, or null. */
export function choose(o: { title: string; text?: string; options: Choice[] }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.confirm(o.title) ? o.options[0]?.value ?? null : null);
    push({ kind: 'choose', title: o.title, text: o.text, options: o.options, resolve });
  });
}

/** In-app text input dialog. Resolves the trimmed text, or null when cancelled/empty. */
export function askText(o: { title: string; text?: string; value?: string; placeholder?: string; ok?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.prompt(o.title, o.value ?? ''));
    push({ kind: 'prompt', title: o.title, text: o.text, ok: o.ok ?? 'שמירה', cancel: 'ביטול', value: o.value ?? '', placeholder: o.placeholder, resolve });
  });
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [value, setValue] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    push = (r) => {
      setReq(r);
      setValue(r.kind === 'prompt' ? r.value : '');
    };
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (req?.kind === 'confirm') okRef.current?.focus();
    dismiss = () => {
      if (!req) return false;
      if (req.kind === 'confirm') req.resolve(false);
      else req.resolve(null);
      setReq(null);
      return true;
    };
    return () => {
      dismiss = null;
    };
  }, [req]);

  if (!req) return null;

  const close = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok);
    else if (req.kind === 'choose') req.resolve(null);
    else req.resolve(ok && value.trim() ? value.trim() : null);
    setReq(null);
  };

  return (
    <div className="dialog-back" onClick={() => close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-title">{req.title}</h2>
        {req.text && <p>{req.text}</p>}
        {req.kind === 'prompt' && (
          <input
            className="input"
            autoFocus
            value={value}
            placeholder={req.placeholder}
            aria-label={req.title}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && close(true)}
          />
        )}
        {req.kind === 'choose' ? (
          <div className="dialog-actions">
            {req.options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                className={`btn small${o.danger ? ' danger' : i > 0 ? ' ghost' : ''} opt`}
                onClick={() => {
                  req.resolve(o.value);
                  setReq(null);
                }}
              >
                {o.label}
              </button>
            ))}
            <button type="button" className="btn small ghost cancel" onClick={() => close(false)}>
              ביטול
            </button>
          </div>
        ) : (
        <div className="dialog-actions">
          <button ref={okRef} type="button" className={`btn small${req.kind === 'confirm' && req.danger ? ' danger' : ''} ok`} onClick={() => close(true)}>
            {req.ok}
          </button>
          <button type="button" className="btn small ghost cancel" onClick={() => close(false)}>
            {req.cancel}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
