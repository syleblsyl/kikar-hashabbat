import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Icon } from './Icon';
import { checkForUpdate, installUpdate, InstallPermissionNeeded, type UpdateInfo } from '../lib/updater';

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'error'; msg: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'permission' }
  | { kind: 'installing' };

type Props = { update: UpdateInfo | null; setUpdate: (u: UpdateInfo | null) => void; rowClass?: string };

/** "Check for updates" row + the update box (download progress, install permission, installer). */
export function UpdatePanel({ update, setUpdate, rowClass = 'set-row' }: Props) {
  const [st, setSt] = useState<State>({ kind: 'idle' });

  // coming back from Android's settings or a cancelled installer: show the button again
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('resume', () => setSt((s) => (s.kind === 'installing' || s.kind === 'permission' ? { kind: 'idle' } : s)));
    return () => {
      h.then((x) => x.remove());
    };
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
    if (!update?.apkUrl || st.kind === 'downloading') return;
    setSt({ kind: 'downloading', percent: 0 });
    try {
      await installUpdate(update, (p) => setSt({ kind: 'downloading', percent: p }));
      setSt({ kind: 'installing' });
    } catch (e) {
      if (e instanceof InstallPermissionNeeded) setSt({ kind: 'permission' });
      else if (String((e as Error)?.message ?? '').includes('checksum')) setSt({ kind: 'error', msg: 'הקובץ שירד פגום. נסה שוב.' });
      else setSt({ kind: 'error', msg: 'ההורדה נכשלה. בדוק את החיבור לאינטרנט ונסה שוב.' });
    }
  }

  return (
    <>
      {update?.available && st.kind !== 'latest' && (
        <div className="update-box">
          <p>
            <b>גרסה חדשה {update.latestName} זמינה</b>
            {update.notes ? `\n${update.notes}` : ''}
          </p>
          {st.kind === 'downloading' ? (
            <>
              <div className="progress" role="progressbar" aria-valuenow={st.percent} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${st.percent}%` }} />
              </div>
              <p>מוריד… {st.percent}%</p>
            </>
          ) : st.kind === 'installing' ? (
            <p>נפתח מסך ההתקנה של אנדרואיד. לוחצים "עדכון" ומחכים שהאפליקציה תיפתח מחדש.</p>
          ) : (
            <>
              {st.kind === 'permission' && (
                <p>בפעם הראשונה צריך לאשר לכיכר השבת להתקין עדכונים: במסך שנפתח מפעילים "אישור ממקור זה", חוזרים לכאן ולוחצים שוב על עדכון.</p>
              )}
              <button type="button" className="btn small" onClick={install}>
                <Icon name="download" /> עדכון עכשיו
              </button>
            </>
          )}
        </div>
      )}
      {st.kind === 'latest' && <div className="update-box ok"><p>יש לך את הגרסה האחרונה.</p></div>}
      {st.kind === 'error' && <div className="update-box err"><p>{st.msg}</p></div>}
      <button type="button" className={rowClass} onClick={check} disabled={st.kind === 'checking' || st.kind === 'downloading'}>
        <span className="ic"><Icon name="refresh" /></span>
        <span className="grow">
          {st.kind === 'checking' ? 'בודק…' : 'בדיקת עדכונים'}
          <span>האפליקציה בודקת גם לבד</span>
        </span>
      </button>
    </>
  );
}
