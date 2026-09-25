import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { checkPin, savePin } from '../lib/pin';

type Props = { mode: 'setup' | 'unlock' | 'change'; onDone: () => void; onCancel?: () => void };

const LEN = 4;

export function Lock({ mode, onDone, onCancel }: Props) {
  const [digits, setDigits] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const setupLike = mode === 'setup' || mode === 'change';
  const prompt = error
    ? error
    : setupLike
      ? first === null
        ? mode === 'change' ? 'בחר קוד חדש בן 4 ספרות' : 'בחר קוד כניסה בן 4 ספרות'
        : 'הקש שוב את הקוד לאישור'
      : 'הקש קוד כניסה';

  useEffect(() => {
    if (digits.length !== LEN || busy) return;
    const code = digits;
    setBusy(true);
    (async () => {
      if (setupLike) {
        if (first === null) {
          setFirst(code);
          setDigits('');
        } else if (first === code) {
          await savePin(code);
          onDone();
        } else {
          fail('הקודים לא תואמים, נסה שוב');
          setFirst(null);
        }
      } else if (await checkPin(code)) {
        onDone();
      } else {
        fail('קוד שגוי');
      }
      setBusy(false);
    })();
  }, [digits]);

  function fail(msg: string) {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setDigits('');
  }

  function press(d: string) {
    if (busy) return;
    setError('');
    setDigits((s) => (s.length < LEN ? s + d : s));
  }

  function back() {
    setDigits((s) => s.slice(0, -1));
  }

  return (
    <div className="lock">
      <img src="/logo.webp" alt="כיכר השבת – יריד מעדני השבת" />
      <div className={`prompt${error ? ' err' : ''}`}>{prompt}</div>
      <div className={`dots${shake ? ' shake' : ''}`} aria-label={`${digits.length} מתוך ${LEN} ספרות`}>
        {Array.from({ length: LEN }, (_, i) => (
          <span key={i} className={i < digits.length ? 'on' : ''} />
        ))}
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        {onCancel ? (
          <button type="button" className="plain" onClick={onCancel} style={{ fontSize: 17 }}>
            ביטול
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="plain" onClick={back} aria-label="מחיקה">
          <Icon name="backspace" size={28} />
        </button>
      </div>
    </div>
  );
}
