import type { IncomeSplit, MethodTotal } from '../db/ops';
import { shekelSmart } from '../lib/money';

/** Cash green, credit blue, anything else gold / brown. */
export function methodColor(name: string, i: number) {
  if (name.includes('מזומן')) return 'var(--green)';
  if (name.includes('אשראי')) return 'var(--blue)';
  return ['var(--gold)', 'var(--primary)', 'var(--ink2)'][i % 3];
}

const pct = (v: number, of: number) => (Math.abs(of) < 0.005 ? 0 : Math.round((v / of) * 100));

/** One line per method: "מזומן 1,200 ₪ (60%)", with a bar that splits the total. */
export function MethodBar({ methods, total, compact }: { methods: MethodTotal[]; total: number; compact?: boolean }) {
  const parts = methods.filter((m) => m.total > 0);
  if (compact) {
    return (
      <div className="msplit compact">
        <div className="msplit-bar thin" aria-hidden>
          {parts.map((m) => (
            <i key={m.id} style={{ width: `${pct(m.total, total)}%`, background: methodColor(m.name, methods.indexOf(m)) }} />
          ))}
        </div>
        <div className="msplit-inline">
          {methods
            .filter((m) => m.total !== 0)
            .map((m) => (
              <span key={m.id}>
                <i style={{ background: methodColor(m.name, methods.indexOf(m)) }} />
                {m.name} <b>{shekelSmart(m.total)}</b>
              </span>
            ))}
        </div>
      </div>
    );
  }
  return (
    <div className="msplit">
      <div className="msplit-bar" aria-hidden>
        {parts.map((m) => (
          <i key={m.id} style={{ width: `${pct(m.total, total)}%`, background: methodColor(m.name, methods.indexOf(m)) }} />
        ))}
      </div>
      <div className="msplit-rows">
        {methods.map((m, i) => (
          <div key={m.id} className="msplit-row">
            <span>
              <i style={{ background: methodColor(m.name, i) }} />
              {m.name}
            </span>
            <b>{shekelSmart(m.total)}</b>
            <small>{pct(m.total, total)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The split in total, then per place in one line each. */
export function MethodSplit({ split }: { split: IncomeSplit }) {
  return (
    <>
      <MethodBar methods={split.methods} total={split.total} />
      {split.sources.length > 1 &&
        split.sources.map((s) => (
          <div key={s.id} className="msplit-src">
            <b>{s.name}</b>
            <span>
              {s.methods
                .filter((m) => m.total !== 0 || s.methods.length <= 2)
                .map((m) => `${m.name} ${shekelSmart(m.total)}`)
                .join(' · ') || 'אין הכנסות'}
            </span>
          </div>
        ))}
    </>
  );
}
