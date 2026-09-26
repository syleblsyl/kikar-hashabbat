import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { checkPin, pinFailed, pinSucceeded, pinWaitLeft, savePin } from '../lib/pin';

type Props = { mode: 'setup' | 'unlock' | 'change'; onDone: () => void; onCancel?: () => void };

const LEN = 4;

export function Lock({ mode, onDone, onCancel }: Props) {
  const [digits, setDigits] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const setupLike = mode === 'setup' || mode === 'change';
  const waiting = waitUntil > now;
  const secs = Math.ceil((waitUntil - now) / 1000);
  const prompt = waiting
    ? `יותר מדי ניסיונות. אפשר לנסות שוב בעוד ${secs >= 60 ? `${Math.ceil(secs / 60)} דק׳` : `${secs} שניות`}`
    : error
      ? error
      : setupLike
        ? first === null
          ? mode === 'change'
            ? 'בחר קוד חדש בן 4 ספרות'
            : 'בחר קוד כניסה בן 4 ספרות'
          : 'הקש שוב את הקוד לאישור'
        : 'הקש קוד כניסה';

  // a lockout survives closing the app
  useEffect(() => {
    if (mode !== 'unlock') return;
    pinWaitLeft().then((ms) => ms > 0 && setWaitUntil(Date.now() + ms));
  }, [mode]);

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

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
          await pinSucceeded();
          onDone();
        } else {
          fail('הקודים לא תואמים, נסה שוב');
          setFirst(null);
        }
      } else if (await checkPin(code)) {
        await pinSucceeded();
        onDone();
      } else {
        const wait = await pinFailed();
        fail('קוד שגוי');
        if (wait > 0) {
          setNow(Date.now());
          setWaitUntil(Date.now() + wait);
        }
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
    if (busy || waiting) return;
    setError('');
    setDigits((s) => (s.length < LEN ? s + d : s));
  }

  function back() {
    setDigits((s) => s.slice(0, -1));
  }

  return (
    <div className="lock">
      <img src="/logo.webp" alt="כיכר השבת – יריד מעדני השבת" />
      <div className={`prompt${error || waiting ? ' err' : ''}`} role="status" aria-live="polite">
        {prompt}
      </div>
      <div className={`dots${shake ? ' shake' : ''}`} role="img" aria-label={`${digits.length} מתוך ${LEN} ספרות`}>
        {Array.from({ length: LEN }, (_, i) => (
          <span key={i} className={i < digits.length ? 'on' : ''} />
        ))}
      </div>
      <div className={`keypad${waiting ? ' off' : ''}`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={waiting}>
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
        <button type="button" onClick={() => press('0')} disabled={waiting}>
          0
        </button>
        <button type="button" className="plain" onClick={back} aria-label="מחיקת ספרה">
          <Icon name="backspace" size={28} />
        </button>
      </div>
    </div>
  );
}
