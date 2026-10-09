import { useEffect, useState } from 'react';
import { ask } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { BackupError, backupStats, lastBackup, makeBackup, markBackedUp, parseBackup, restoreBackup } from '../db/backup';
import { fromIso, iso, today } from '../lib/dates';
import { saveToDownloads, shareFile, ShareCancelled } from '../lib/share';

export function BackupScreen() {
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    lastBackup().then(setLast);
  }, []);

  const [savedAs, setSavedAs] = useState<string | null>(null);

  async function backupFile() {
    const b = await makeBackup();
    return { b, blob: new Blob([JSON.stringify(b)], { type: 'application/json' }), name: `kikar-backup-${iso(today())}.json` };
  }

  /** The backup goes to the phone's Download folder, like any download. */
  async function backup() {
    setBusy(true);
    try {
      const { blob, name } = await backupFile();
      const saved = await saveToDownloads(name, blob);
      await markBackedUp();
      setLast(iso(today()));
      setSavedAs(saved);
      toast('הגיבוי נשמר בהורדות ✓');
    } catch (e) {
      console.error(e);
      const why = String((e as Error)?.message ?? e);
      toast(/permission/.test(why) ? 'אין הרשאה לשמור בהורדות. אפשר לאשר בהגדרות הטלפון, או לשלוח את הגיבוי.' : 'השמירה נכשלה. נסה שוב, או שלח את הגיבוי.', 'err');
    }
    setBusy(false);
  }

  /** An extra copy, sent to WhatsApp / Drive / email. */
  async function send() {
    setBusy(true);
    try {
      const { blob, name } = await backupFile();
      await shareFile(name, blob, 'גיבוי כיכר השבת');
      await markBackedUp();
      setLast(iso(today()));
    } catch (e) {
      if (!(e instanceof ShareCancelled)) {
        console.error(e);
        toast('השליחה נכשלה. נסה שוב.', 'err');
      }
    }
    setBusy(false);
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let b;
    try {
      b = parseBackup(await f.text());
    } catch (err) {
      const reason = err instanceof BackupError ? err.reason : 'not-backup';
      toast(
        reason === 'newer'
          ? 'הגיבוי נעשה בגרסה חדשה יותר של האפליקציה. צריך קודם לעדכן (הגדרות ← בדיקת עדכונים).'
          : reason === 'broken'
            ? 'קובץ הגיבוי פגום או חלקי. נסה קובץ גיבוי אחר.'
            : 'הקובץ הזה לא נראה כמו גיבוי של כיכר השבת',
        'err',
      );
      return;
    }
    const s = backupStats(b);
    const when = new Date(b.created_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
    const ok = await ask({
      title: `לשחזר את הגיבוי מ-${when}?`,
      text: `${s.products} מוצרים, ${s.agents} סוכנים, ${s.deliveries} קבלות סחורה, ${s.invoices} חשבוניות, ${s.days} ימי הכנסה.\n\nכל הנתונים שבטלפון עכשיו יוחלפו בנתוני הגיבוי.`,
      ok: 'שחזור',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await restoreBackup(b);
      toast('השחזור הושלם');
      setTimeout(() => {
        window.location.hash = '#/';
        window.location.reload();
      }, 800);
    } catch (err) {
      console.error(err);
      const why = String((err as Error)?.message ?? err).replace(/^(\w+: )+/, '').slice(0, 80);
      toast(`השחזור נכשל. הנתונים הקודמים נשארו כמו שהיו.\n(${why})`, 'err');
      setBusy(false);
    }
  }

  return (
    <>
      <SubBar title="גיבוי ושחזור" />
      <div className="form">
        <div className="box" style={{ gap: 8 }}>
          <b style={{ fontSize: 18 }}>כל הנתונים נשמרים רק בטלפון</b>
          <p className="hint" style={{ margin: 0 }}>
            אם הטלפון יאבד או יתקלקל, רק גיבוי יחזיר את המחירון, הסוכנים וכל הרישומים. הגיבוי הוא קובץ אחד, והוא נשמר בתיקיית ההורדות (Download) של הטלפון.
          </p>
          <p className="hint" style={{ margin: 0 }}>
            גיבוי אחרון: <b style={{ color: last ? 'var(--ink)' : 'var(--red)' }}>{last ? fromIso(last).toLocaleDateString('he-IL') : 'עוד לא נעשה'}</b>
          </p>
        </div>
        <button type="button" className="btn" onClick={backup} disabled={busy}>
          <Icon name="download" /> שמירת גיבוי בהורדות
        </button>
        {savedAs && (
          <div className="update-box ok" style={{ margin: 0 }}>
            <p>
              <b>✓ הגיבוי נשמר בתיקיית ההורדות (Download)</b>
              {'\n'}
              <bdi dir="ltr">{savedAs}</bdi>
              {'\n'}אפשר למצוא אותו באפליקציית "קבצים" או "ההורדות שלי".
            </p>
          </div>
        )}
        <button type="button" className="center-link" style={{ background: 'none', border: 0 }} onClick={send} disabled={busy}>
          רוצה גם עותק בוואטסאפ, Drive או מייל? שליחה
        </button>
        <div className="box" style={{ gap: 8 }}>
          <b style={{ fontSize: 17 }}>שחזור מגיבוי</b>
          <p className="hint" style={{ margin: 0 }}>בטלפון חדש, או אחרי מחיקה: בוחרים את קובץ הגיבוי, וכל הנתונים חוזרים. קוד הכניסה של הטלפון הזה נשאר.</p>
          <label className="file-btn">
            <Icon name="download" size={20} /> בחירת קובץ גיבוי
            <input type="file" onChange={restore} disabled={busy} aria-label="בחירת קובץ גיבוי" />
          </label>
        </div>
      </div>
    </>
  );
}
