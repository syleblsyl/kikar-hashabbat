import { Icon } from './Icon';

type Props = { value: string; onChange: (v: string) => void; placeholder: string; className?: string };

/** Search field with a clear button. */
export function SearchBox({ value, onChange, placeholder, className = '' }: Props) {
  return (
    <label className={`searchbox ${className}`}>
      <Icon name="search" size={20} />
      <input type="search" enterKeyHint="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" aria-label="ניקוי החיפוש" onClick={() => onChange('')}>
          <Icon name="x" size={18} />
        </button>
      )}
    </label>
  );
}

/** Loose Hebrew-friendly match: ignores spaces, geresh/gershayim and case. */
export function matches(text: string | null | undefined, q: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s'"׳״\-־]/g, '');
  const n = norm(q);
  return !n || norm(text ?? '').includes(n);
}
