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
import { Catalog } from './screens/Catalog';
import { ProductEdit } from './screens/ProductEdit';
import { Agents } from './screens/Agents';
import { AgentEdit } from './screens/AgentEdit';
import { Categories } from './screens/Categories';
import { AgentCard } from './screens/AgentCard';
import { Delivery } from './screens/Delivery';
import { Returns } from './screens/Returns';
import { Income } from './screens/Income';
import { Expenses } from './screens/Expenses';
import { PaymentPick } from './screens/PaymentPick';
import { ToastHost } from './components/Toast';
import { Report } from './screens/Report';
import { BackupScreen } from './screens/BackupScreen';
import { ListManager } from './screens/ListManager';
import { backupDue as isBackupDue } from './db/backup';
import { addExpenseType, addMethod, listExpenseTypes, listMethods, renameExpenseType, renameMethod, setExpenseTypeActive, setMethodActive } from './db/ops';
import { useBack } from './components/useBack';

type Gate = 'loading' | 'setup' | 'locked' | 'open' | 'change-pin' | 'error';

const LOCK_AFTER_MS = 60_000;

function Shell({ onLock, onChangePin }: { onLock: () => void; onChangePin: () => void }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today()));
  const [backupDue, setBackupDue] = useState(false);
  const nav = useNavigate();
  const back = useBack();
  const loc = useLocation();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkForUpdate().then(setUpdate).catch(() => undefined);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    if (loc.pathname === '/') isBackupDue().then(setBackupDue).catch(() => undefined);
  }, [loc.pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (loc.pathname === '/') CapApp.minimizeApp();
      else back();
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
          <Route path="/" element={<Home update={update} weekStart={weekStart} setWeekStart={setWeekStart} onLock={onLock} backupDue={backupDue} />} />
          <Route path="/settings" element={<Settings update={update} setUpdate={setUpdate} onChangePin={onChangePin} onLock={onLock} />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/product/:id" element={<ProductEdit />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agent/new" element={<AgentEdit />} />
          <Route path="/agent/:id" element={<AgentCard />} />
          <Route path="/agent/:id/edit" element={<AgentEdit />} />
          <Route path="/settings/categories" element={<Categories />} />
          <Route path="/reports" element={<Report />} />
          <Route path="/settings/backup" element={<BackupScreen />} />
          <Route
            path="/settings/methods"
            element={
              <ListManager
                title="אמצעי תשלום"
                hint="אמצעי התשלום שמופיעים במסך ההכנסה היומית. אמצעי שמוסתר לא יופיע יותר, אבל ההכנסות שנרשמו בו נשמרות."
                placeholder="למשל: ביט"
                load={() => listMethods(true)}
                add={addMethod}
                rename={renameMethod}
                setActive={setMethodActive}
              />
            }
          />
          <Route
            path="/settings/expense-types"
            element={
              <ListManager
                title="סוגי הוצאות"
                hint="הסוגים שמופיעים במסך ההוצאות ובדוח החודשי."
                placeholder="למשל: שכירות"
                load={() => listExpenseTypes(true)}
                add={addExpenseType}
                rename={renameExpenseType}
                setActive={setExpenseTypeActive}
              />
            }
          />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/income" element={<Income />} />
          <Route path="/payment" element={<PaymentPick />} />
          <Route path="/expense" element={<Expenses />} />
          <Route path="*" element={<Soon title="לא נמצא" what="המסך הזה לא קיים." />} />
        </Routes>
      </div>
      {showNav && <BottomNav />}
      <ToastHost />
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
