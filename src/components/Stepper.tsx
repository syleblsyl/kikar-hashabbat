import { useState } from 'react';
import { Icon } from './Icon';

type Props = { value: number; onChange: (n: number) => void; max?: number; label: string; tone?: 'primary' | 'gold' };

/** Big + / − buttons; tapping the number lets you type it. */
export function Stepper({ value, onChange, max, label, tone = 'primary' }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const clamp = (n: number) => Math.max(0, max != null ? Math.min(max, n) : n);

  return (
    <div className="stepper">
      <button type="button" className={`plus ${tone}`} aria-label={`הוספה – ${label}`} onClick={() => onChange(clamp(value + 1))}>
        <Icon name="plus" stroke={2.6} />
      </button>
      {editing ? (
        <input
          autoFocus
          inputMode="numeric"
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => {
            setEditing(false);
            if (text !== '') onChange(clamp(parseInt(text, 10)));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button
          type="button"
          className="num"
          aria-label={`${label}: ${value}. לחץ להקלדה`}
          onClick={() => {
            setText(value ? String(value) : '');
            setEditing(true);
          }}
        >
          {value}
        </button>
      )}
      <button type="button" className="minus" aria-label={`הפחתה – ${label}`} onClick={() => onChange(clamp(value - 1))} disabled={value <= 0}>
        <Icon name="minus" stroke={2.6} />
      </button>
    </div>
  );
}
