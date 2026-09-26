import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { parseAmountStrict, qty } from '../lib/money';

type Props = { value: number; onChange: (n: number) => void; max?: number; label: string; tone?: 'primary' | 'gold' };

const LIMIT = 99999;

/**
 * Big + / − buttons. Tapping the number opens it for typing with the old value selected, so typing
 * replaces it (20 → type 25 → 25, never 2025). Decimals are allowed (7.5 ק״ג). Enter jumps to the next product.
 */
export function Stepper({ value, onChange, max, label, tone = 'primary' }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const cap = Math.min(LIMIT, max ?? LIMIT);
  const clamp = (n: number) => Math.round(Math.max(0, Math.min(cap, n)) * 1000) / 1000;

  function commit() {
    setEditing(false);
    const n = parseAmountStrict(text);
    if (n !== null && text.trim() !== '') onChange(clamp(n));
  }

  function openNext() {
    const all = Array.from(document.querySelectorAll<HTMLElement>('.stepper'));
    const i = all.indexOf(root.current!);
    const next = all[i + 1]?.querySelector<HTMLButtonElement>('.num');
    if (next) {
      next.click();
      next.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
  }

  return (
    <div className="stepper" ref={root} role="group" aria-label={label}>
      <button type="button" className={`plus ${tone}`} aria-label={`הוספה – ${label}`} onClick={() => onChange(clamp(value + 1))} disabled={value >= cap}>
        <Icon name="plus" stroke={2.6} />
      </button>
      {editing ? (
        <input
          autoFocus
          inputMode="decimal"
          enterKeyHint="next"
          aria-label={label}
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              setTimeout(openNext, 0);
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="num"
          aria-label={`${label}: ${qty(value)}. לחיצה להקלדה`}
          onClick={() => {
            setText(value ? String(value) : '');
            setEditing(true);
          }}
        >
          {qty(value)}
        </button>
      )}
      <button type="button" className="minus" aria-label={`הפחתה – ${label}`} onClick={() => onChange(clamp(value - 1))} disabled={value <= 0}>
        <Icon name="minus" stroke={2.6} />
      </button>
      <span className="sr-only" aria-live="polite">{qty(value)}</span>
    </div>
  );
}
