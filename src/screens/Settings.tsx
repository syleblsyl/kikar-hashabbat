import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { UpdatePanel } from '../components/UpdatePanel';
import type { UpdateInfo } from '../lib/updater';
import { currentVersion, type AppVersion } from '../lib/version';
import { getNetMode, setSetting, type NetMode } from '../db/repo';

type Props = {
  update: UpdateInfo | null;
  setUpdate: (u: UpdateInfo | null) => void;
  lockOn: boolean;
  onLockSetting: (on: boolean) => void;
  onChangePin: () => void;
  onLock: () => void;
};

export function Settings({ update, setUpdate, lockOn, onLockSetting, onChangePin, onLock }: Props) {
  const [netMode, setNetModeState] = useState<NetMode | null>(null);

  useEffect(() => {
    getNetMode().then(setNetModeState);
  }, []);

  async function changeNetMode(m: NetMode) {
    await setSetting('net_mode', m);
    setNetModeState(m);
  }
  const [ver, setVer] = useState<AppVersion | null>(null);
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    currentVersion().then(setVer);
  }, []);

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

        <UpdatePanel update={update} setUpdate={setUpdate} />
      </section>

      <section className="card set-group">
        <h2>חישוב הרווח הנקי</h2>
        <div className="set-row" style={{ borderTop: 0, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="segment wrap" role="radiogroup" aria-label="חישוב הרווח הנקי">
            <button type="button" role="radio" aria-checked={netMode === 'paid'} className={netMode === 'paid' ? 'on' : ''} onClick={() => changeNetMode('paid')}>
              לפי תשלומים לסוכנים
            </button>
            <button type="button" role="radio" aria-checked={netMode === 'goods'} className={netMode === 'goods' ? 'on' : ''} onClick={() => changeNetMode('goods')}>
              לפי סחורה שהתקבלה
            </button>
          </div>
          <span className="hint">
            {netMode === 'goods'
              ? 'רווח נקי = הכנסות − סחורה שנשארה (אחרי החזרות) − הוצאות. התשלומים לסוכנים לא מורדים שוב.'
              : 'רווח נקי = הכנסות − מה ששילמת לסוכנים − הוצאות. כל תשלום לסוכן יורד מהרווח בתאריך התשלום.'}
          </span>
        </div>
      </section>

      <section className="card set-group">
        <h2>קוד כניסה</h2>
        <div className="set-row" style={{ borderTop: 0 }}>
          <span className="ic"><Icon name="lock" /></span>
          <span className="grow">
            קוד כניסה לאפליקציה
            <span>{lockOn ? 'נדרש קוד בפתיחה ואחרי דקה ברקע' : 'כבוי – האפליקציה נפתחת ישר'}</span>
          </span>
          <button type="button" role="switch" aria-checked={lockOn} aria-label="קוד כניסה לאפליקציה" className={`switch${lockOn ? ' on' : ''}`} onClick={() => onLockSetting(!lockOn)}>
            <span />
          </button>
        </div>
        {lockOn && (
          <>
            <button type="button" className="set-row" onClick={onChangePin}>
              <span className="ic"><Icon name="key" /></span>
              <span className="grow">שינוי קוד כניסה</span>
            </button>
            <button type="button" className="set-row" onClick={onLock}>
              <span className="ic"><Icon name="lock" /></span>
              <span className="grow">נעילה עכשיו</span>
            </button>
          </>
        )}
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
