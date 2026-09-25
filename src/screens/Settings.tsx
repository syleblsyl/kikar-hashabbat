import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { checkForUpdate, installUpdate, InstallPermissionNeeded, type UpdateInfo } from '../lib/updater';
import { currentVersion, type AppVersion } from '../lib/version';

type Props = { update: UpdateInfo | null; setUpdate: (u: UpdateInfo | null) => void; onChangePin: () => void; onLock: () => void };

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'error'; msg: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'permission' }
  | { kind: 'installing' };

export function Settings({ update, setUpdate, onChangePin, onLock }: Props) {
  const [ver, setVer] = useState<AppVersion | null>(null);
  const [st, setSt] = useState<State>({ kind: 'idle' });
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    currentVersion().then(setVer);
  }, []);

  async function check() {
    setSt({ kind: 'checking' });
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      setSt(u.available ? { kind: 'idle' } : { kind: 'latest' });
    } catch {
      setSt({ kind: 'error', msg: 'לא הצלחתי לבדוק עדכונים. בדוק שיש חיבור לאינטרנט ונסה שוב.' });
    }
  }

  async function install() {
    if (!update?.apkUrl) return;
    setSt({ kind: 'downloading', percent: 0 });
    try {
      await installUpdate(update.apkUrl, (p) => setSt({ kind: 'downloading', percent: p }));
      setSt({ kind: 'installing' });
    } catch (e) {
      if (e instanceof InstallPermissionNeeded) setSt({ kind: 'permission' });
      else setSt({ kind: 'error', msg: 'ההורדה נכשלה. בדוק את החיבור לאינטרנט ונסה שוב.' });
    }
  }

  return (
    <>
      <header className="bar">
        <h1 className="page-title" style={{ padding: '4px 4px 0' }}>הגדרות</h1>
      </header>

      <section className="card set-group">
        <h2>עדכוני אפליקציה</h2>
        <div className="set-row" style={{ borderTop: 0 }}>
          <span className="ic"><Icon name="info" /></span>
          <span className="grow">
            גרסה {ver?.name ?? '…'}
            <span>{native ? 'מותקנת בטלפון' : 'גרסת בדיקה בדפדפן'}</span>
          </span>
        </div>

        {update?.available && st.kind !== 'latest' && (
          <div className="update-box">
            <p>
              <b>גרסה חדשה {update.latestName} זמינה</b>
              {update.notes ? `\n${update.notes}` : ''}
            </p>
            {st.kind === 'downloading' ? (
              <>
                <div className="progress"><div style={{ width: `${st.percent}%` }} /></div>
                <p>מוריד… {st.percent}%</p>
              </>
            ) : st.kind === 'installing' ? (
              <p>נפתח מסך ההתקנה של אנדרואיד. לוחצים "עדכון" ומחכים שהאפליקציה תיפתח מחדש.</p>
            ) : st.kind === 'permission' ? (
              <>
                <p>בפעם הראשונה צריך לאשר לכיכר השבת להתקין עדכונים: במסך שנפתח מפעילים "אישור ממקור זה", חוזרים לכאן ולוחצים שוב על עדכון.</p>
                <button type="button" className="btn small" onClick={install}>עדכון עכשיו</button>
              </>
            ) : (
              <button type="button" className="btn small" onClick={install}>
                <Icon name="download" /> עדכון עכשיו
              </button>
            )}
          </div>
        )}

        {st.kind === 'latest' && (
          <div className="update-box ok"><p>יש לך את הגרסה האחרונה.</p></div>
        )}
        {st.kind === 'error' && (
          <div className="update-box err"><p>{st.msg}</p></div>
        )}

        <button type="button" className="set-row" onClick={check} disabled={st.kind === 'checking' || st.kind === 'downloading'}>
          <span className="ic"><Icon name="refresh" /></span>
          <span className="grow">
            {st.kind === 'checking' ? 'בודק…' : 'בדיקת עדכונים'}
            <span>האפליקציה בודקת גם לבד בכל פתיחה</span>
          </span>
        </button>
      </section>

      <section className="card set-group">
        <h2>אבטחה</h2>
        <button type="button" className="set-row" style={{ borderTop: 0 }} onClick={onChangePin}>
          <span className="ic"><Icon name="key" /></span>
          <span className="grow">שינוי קוד כניסה</span>
        </button>
        <button type="button" className="set-row" onClick={onLock}>
          <span className="ic"><Icon name="lock" /></span>
          <span className="grow">
            נעילה עכשיו
            <span>האפליקציה ננעלת לבד אחרי דקה ברקע</span>
          </span>
        </button>
      </section>

      <section className="card set-group">
        <h2>נתונים ורשימות</h2>
        <Link to="/settings/backup" className="set-row" style={{ borderTop: 0 }}>
          <span className="ic"><Icon name="upload" /></span>
          <span className="grow">
            גיבוי ושחזור
            <span>שמירת כל הנתונים לקובץ, ושחזור בטלפון חדש</span>
          </span>
          <span style={{ color: 'var(--ink2)' }}><Icon name="chevron" /></span>
        </Link>
        <Link to="/settings/categories" className="set-row">
          <span className="ic"><Icon name="tag" /></span>
          <span className="grow">
            קטגוריות
            <span>מאפים, קוגלים, סלטים…</span>
          </span>
          <span style={{ color: 'var(--ink2)' }}><Icon name="chevron" /></span>
        </Link>
        <Link to="/settings/methods" className="set-row">
          <span className="ic"><Icon name="cash" /></span>
          <span className="grow">
            אמצעי תשלום
            <span>מזומן, אשראי, אחר, ומה שתוסיף</span>
          </span>
          <span style={{ color: 'var(--ink2)' }}><Icon name="chevron" /></span>
        </Link>
        <Link to="/settings/expense-types" className="set-row">
          <span className="ic"><Icon name="receipt" /></span>
          <span className="grow">
            סוגי הוצאות
            <span>שכירות, חשמל, ניקיון…</span>
          </span>
          <span style={{ color: 'var(--ink2)' }}><Icon name="chevron" /></span>
        </Link>
      </section>
    </>
  );
}
