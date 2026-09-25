import { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BottomNav } from './components/BottomNav';
import { getDb } from './db/sqlite';
import { hasPin } from './lib/pin';
import { startOfWeek, today } from './lib/dates';
import { checkForUpdate, type UpdateInfo } from './lib/updater';
import { Home } from './screens/Home';
import { Lock } from './screens/Lock';
import { Settings } from './screens/Settings';
import { Soon } from './screens/Soon';

type Gate = 'loading' | 'setup' | 'locked' | 'open' | 'change-pin' | 'error';

const LOCK_AFTER_MS = 60_000;

function Shell({ onLock, onChangePin }: { onLock: () => void; onChangePin: () => void }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today()));
  const nav = useNavigate();
  const loc = useLocation();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkForUpdate().then(setUpdate).catch(() => undefined);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [loc.pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (loc.pathname === '/') CapApp.minimizeApp();
      else nav(-1);
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [loc.pathname, nav]);

  const mainTabs = ['/', '/catalog', '/agents', '/reports', '/settings'];
  const showNav = mainTabs.includes(loc.pathname);

  return (
    <div className="app">
      <div className="screen" ref={scroller}>
        <Routes>
          <Route path="/" element={<Home update={update} weekStart={weekStart} setWeekStart={setWeekStart} onLock={onLock} />} />
          <Route path="/settings" element={<Settings update={update} setUpdate={setUpdate} onChangePin={onChangePin} onLock={onLock} />} />
          <Route path="/catalog" element={<Soon withBar={false} title="מחירון" what="כאן יופיעו כל המוצרים עם תמונה, קטגוריה, מחיר קנייה ומחיר מכירה." />} />
          <Route path="/agents" element={<Soon withBar={false} title="סוכנים" what="כאן תנהל את הסוכנים, המוצרים של כל סוכן, התשלומים והיתרה." />} />
          <Route path="/agents/:id" element={<Soon title="סוכן" what="כרטיס סוכן עם תנועות, תשלומים ויתרה." />} />
          <Route path="/reports" element={<Soon withBar={false} title="דוחות" what="דוח חודשי מפורט עם ייצוא לאקסל ול-PDF." />} />
          <Route path="/delivery" element={<Soon title="קבלת סחורה" what="בוחרים סוכן ורושמים כמה הגיע מכל מוצר בכפתורי + ו־−." />} />
          <Route path="/returns" element={<Soon title="החזרות" what="ביום ראשון רושמים כמה נשאר מכל מוצר, והזיכוי מהסוכן מחושב לבד." />} />
          <Route path="/income" element={<Soon title="הכנסה יומית" what="רישום יומי של מזומן, אשראי ואחר." />} />
          <Route path="/payment" element={<Soon title="תשלום לסוכן" what="רישום תאריך וסכום לכל תשלום, והיתרה מתעדכנת." />} />
          <Route path="/expense" element={<Soon title="הוצאה כללית" what="שכירות, חשמל וכל הוצאה אחרת לפי סוגים שתגדיר." />} />
          <Route path="*" element={<Soon title="לא נמצא" what="המסך הזה לא קיים." />} />
        </Routes>
      </div>
      {showNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  const [gate, setGate] = useState<Gate>('loading');
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await getDb();
        setGate((await hasPin()) ? 'locked' : 'setup');
      } catch (e) {
        console.error(e);
        setGate('error');
      }
    })();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) {
        setGate((g) => (g === 'open' ? 'locked' : g));
      }
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, []);

  const lock = useCallback(() => setGate('locked'), []);
  const changePin = useCallback(() => setGate('change-pin'), []);

  if (gate === 'loading') {
    return (
      <div className="app">
        <div className="loading"><img src="/logo.webp" alt="כיכר השבת" /></div>
      </div>
    );
  }
  if (gate === 'error') {
    return (
      <div className="app">
        <div className="card soon-box">
          <h2>שגיאה בפתיחת הנתונים</h2>
          <p>סגור את האפליקציה ופתח אותה שוב.</p>
        </div>
      </div>
    );
  }
  if (gate === 'setup' || gate === 'locked' || gate === 'change-pin') {
    return (
      <div className="app">
        <Lock
          key={gate}
          mode={gate === 'setup' ? 'setup' : gate === 'change-pin' ? 'change' : 'unlock'}
          onDone={() => setGate('open')}
          onCancel={gate === 'change-pin' ? () => setGate('open') : undefined}
        />
      </div>
    );
  }
  return (
    <HashRouter>
      <Shell onLock={lock} onChangePin={changePin} />
    </HashRouter>
  );
}
