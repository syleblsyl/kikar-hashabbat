import type { CheckState } from '../db/money';
import { shekelSmart } from '../lib/money';

/** Short status of an agent's month: invoice against stock. */
export function checkLabel(state: CheckState, diff: number): string {
  switch (state) {
    case 'match':
      return 'תואם ✓';
    case 'mismatch':
      return `הפרש ${shekelSmart(Math.abs(diff))}`;
    case 'checked':
      return `הפרש ${shekelSmart(Math.abs(diff))} · נבדק`;
    case 'waiting':
      return 'ממתין לחשבונית';
    case 'no-stock':
      return 'בלי מלאי';
    case 'merged':
      return 'בחשבונית של החודש הבא';
    default:
      return '';
  }
}

export function CheckPill({ state, diff, waitingText }: { state: CheckState; diff: number; waitingText?: string }) {
  if (state === 'empty') return null;
  const tone = state === 'match' || state === 'merged' ? 'ok' : state === 'mismatch' ? 'bad' : state === 'waiting' ? 'gold' : 'mute';
  return <span className={`pill ${tone} nowrap`}>{state === 'waiting' && waitingText ? waitingText : checkLabel(state, diff)}</span>;
}
