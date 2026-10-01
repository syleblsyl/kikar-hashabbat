import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BottomNav } from './components/BottomNav';
import { DialogHost, dismissDialog } from './components/Dialog';
import { getDb } from './db/sqlite';
import { hasPin } from './lib/pin';
import { getSetting, setSetting } from './db/repo';
import { toast } from './components/Toast';
import { thisMonth } from './components/MonthBar';
import { ensureRecurring } from './db/ops';
import { Invoices } from './screens/Invoices';
import { Navigate } from 'react-router-dom';
import { checkForUpdateThrottled, type UpdateInfo } from './lib/updater';
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
import { UpdatePanel } from './components/UpdatePanel';
import { AgentStatement } from './screens/AgentStatement';
import { PaymentReceipt } from './screens/PaymentReceipt';
import { backupDue as isBackupDue } from './db/backup';
import { addExpenseType, addMethod, listExpenseTypes, listMethods, renameExpenseType, renameMethod, setExpenseTypeActive, setMethodActive } from './db/ops';
import { useBack } from './components/useBack';

type Gate = 'loading' | 'locked' | 'open' | 'change-pin' | 'enable-pin' | 'error';

const LOCK_AFTER_MS = 60_000;

/** One broken screen shows a message instead of a white page; moving to another screen resets it. */
class ScreenBoundary extends Component<{ children: ReactNode; onHome: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error(e);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card soon-box">
        <h2>משהו השתבש במסך הזה</h2>
        <p>הנתונים שלך שמורים. חוזרים למסך הבית ומנסים שוב.</p>
        <button type="button" className="btn small" style={{ width: 'auto', padding: '0 24px' }} onClick={this.props.onHome}>
          למסך הבית
        </button>
      </div>
    );
  }
}

type ShellProps = { gate: Gate; lockOn: boolean; onLock: () => void; onChangePin: () => void; onLockSetting: (on: boolean) => void };

function Shell({ gate, lockOn, onLock, onChangePin, onLockSetting }: ShellProps) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [ym, setYm] = useState(thisMonth);
  const [backupDue, setBackupDue] = useState(false);
  const nav = useNavigate();
  const back = useBack();
  const loc = useLocation();
  const scroller = useRef<HTMLDivElement>(null);
  const covered = gate !== 'open';

  useEffect(() => {
    checkForUpdateThrottled().then(setUpdate).catch(() => undefined);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    if (loc.pathname === '/') isBackupDue().then(setBackupDue).catch(() => undefined);
  }, [loc.pathname]);

  // Android back: close a dialog first, then go back a screen (asking if something is unsaved), on home leave the app
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || covered) return;
    const h = CapApp.addListener('backButton', () => {
      if (dismissDialog()) return;
      if (loc.pathname === '/') CapApp.minimizeApp();
      else back();
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [loc.pathname, back, covered]);

  const mainTabs = ['/', '/catalog', '/agents', '/reports', '/settings'];
  const showNav = mainTabs.includes(loc.pathname);

  return (
    <div className="app" aria-hidden={covered || undefined} inert={covered || undefined}>
      <div className="screen" ref={scroller}>
        <ScreenBoundary key={loc.pathname} onHome={() => nav('/', { replace: true })}>
          <Routes>
            <Route path="/" element={<Home update={update} ym={ym} setYm={setYm} onLock={onLock} lockOn={lockOn} backupDue={backupDue} />} />
            <Route path="/settings" element={<Settings update={update} setUpdate={setUpdate} lockOn={lockOn} onLockSetting={onLockSetting} onChangePin={onChangePin} onLock={onLock} />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/product/:id" element={<ProductEdit />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agent/new" element={<AgentEdit />} />
            <Route path="/agent/:id" element={<AgentCard />} />
            <Route path="/agent/:id/edit" element={<AgentEdit />} />
            <Route path="/agent/:id/statement" element={<AgentStatement />} />
            <Route path="/agent/:id/receipt/:pid" element={<PaymentReceipt />} />
            <Route path="/settings/categories" element={<Categories />} />
            <Route path="/reports" element={<Report />} />
            <Route path="/settings/backup" element={<BackupScreen />} />
            <Route
              path="/settings/methods"
              element={
                <ListManager
                  key="methods"
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
                  key="expense-types"
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
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoice/:id" element={<Delivery />} />
            <Route path="/delivery" element={<Navigate to="/invoices" replace />} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/income" element={<Income />} />
            <Route path="/payment" element={<PaymentPick />} />
            <Route path="/expense" element={<Expenses />} />
            <Route path="*" element={<Soon title="לא נמצא" what="המסך הזה לא קיים." />} />
          </Routes>
        </ScreenBoundary>
      </div>
      {showNav && <BottomNav />}
    </div>
  );
}

function OpenError({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const newer = reason.includes('database-newer-than-app');
  return (
    <div className="app">
      <div className="screen">
        <div className="card soon-box">
          <img src="/logo.webp" alt="" />
          <h2>{newer ? 'צריך לעדכן את האפליקציה' : 'שגיאה בפתיחת הנתונים'}</h2>
          <p>
            {newer
              ? 'הנתונים נשמרו בגרסה חדשה יותר של כיכר השבת. מעדכנים לגרסה האחרונה והכול יחזור.'
              : 'הנתונים לא נמחקו. נסה שוב, ואם זה חוזר – סגור את האפליקציה לגמרי ופתח מחדש.'}
          </p>
          <button type="button" className="btn small" style={{ width: 'auto', padding: '0 24px' }} onClick={onRetry}>
            ניסיון נוסף
          </button>
        </div>
        <section className="card set-group">
          <UpdatePanel update={update} setUpdate={setUpdate} />
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [gate, setGate] = useState<Gate>('loading');
  const [reason, setReason] = useState('');
  const [opened, setOpened] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const lockOnRef = useRef(false);
  lockOnRef.current = lockOn;
  const hiddenAt = useRef<number | null>(null);

  const init = useCallback(async () => {
    setGate('loading');
    try {
      await getDb();
      // fixed monthly expenses: add this month's rows (and any month missed while the app was closed)
      await ensureRecurring().catch((e) => console.error(e));
      // the entry code is optional and off unless it was turned on in Settings
      const on = (await getSetting('lock_on')) === '1' && (await hasPin());
      setLockOn(on);
      if (on) setGate('locked');
      else {
        setOpened(true);
        setGate('open');
      }
    } catch (e) {
      console.error(e);
      setReason(String((e as Error)?.message ?? e));
      setGate('error');
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  // after a minute in the background the app locks; what was on screen stays underneath (nothing typed is lost)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        hiddenAt.current = Date.now();
      } else if (lockOnRef.current && hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) {
        dismissDialog();
        setGate((g) => (g === 'open' ? 'locked' : g));
      }
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, []);

  // Android back while the lock screen is showing
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || gate === 'open') return;
    const h = CapApp.addListener('backButton', () => {
      if (dismissDialog()) return;
      if (gate === 'change-pin' || gate === 'enable-pin') setGate('open');
      else CapApp.minimizeApp();
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [gate]);

  const lock = useCallback(() => setGate('locked'), []);
  const changePin = useCallback(() => setGate('change-pin'), []);
  const unlocked = useCallback(() => {
    setOpened(true);
    setGate('open');
  }, []);
  const lockSetting = useCallback(async (on: boolean) => {
    if (on) return setGate('enable-pin'); // choose a code first; it is turned on only after that
    await setSetting('lock_on', '0');
    setLockOn(false);
    toast('קוד הכניסה בוטל – האפליקציה תיפתח בלי קוד');
  }, []);
  const pinEnabled = useCallback(async () => {
    await setSetting('lock_on', '1');
    setLockOn(true);
    setGate('open');
    toast('קוד הכניסה הופעל');
  }, []);

  if (gate === 'loading') {
    return (
      <div className="app">
        <div className="loading"><img src="/logo.webp" alt="כיכר השבת" /></div>
      </div>
    );
  }
  if (gate === 'error') return <OpenError reason={reason} onRetry={init} />;

  const lockScreen =
    gate === 'locked' || gate === 'change-pin' || gate === 'enable-pin' ? (
      <div className="lock-layer">
        <Lock
          key={gate}
          mode={gate === 'enable-pin' ? 'setup' : gate === 'change-pin' ? 'change' : 'unlock'}
          onDone={gate === 'enable-pin' ? pinEnabled : unlocked}
          onCancel={gate === 'locked' ? undefined : () => setGate('open')}
        />
      </div>
    ) : null;

  return (
    <>
      {opened && (
        <HashRouter>
          <Shell gate={gate} lockOn={lockOn} onLock={lock} onChangePin={changePin} onLockSetting={lockSetting} />
        </HashRouter>
      )}
      {lockScreen}
      <DialogHost />
      <ToastHost />
    </>
  );
}
