import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { backupStats, lastBackup, makeBackup, markBackedUp, parseBackup, restoreBackup } from '../db/backup';
import { fromIso, iso, today } from '../lib/dates';
import { shareFile } from '../lib/share';

export function BackupScreen() {
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    lastBackup().then(setLast);
  }, []);

  async function backup() {
    setBusy(true);
    try {
      const b = await makeBackup();
      const s = backupStats(b);
      const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
      await shareFile(`kikar-backup-${iso(today())}.json`, blob, 'גיבוי כיכר השבת');
      await markBackedUp();
      setLast(iso(today()));
      toast(`הגיבוי מוכן: ${s.products} מוצרים, ${s.agents} סוכנים, ${s.deliveries} אספקות`);
    } catch (e) {
      console.error(e);
      toast('הגיבוי נכשל');
    }
    setBusy(false);
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const b = parseBackup(await f.text());
      const s = backupStats(b);
      const when = new Date(b.created_at).toLocaleString('he-IL');
      if (!window.confirm(`לשחזר את הגיבוי מ-${when}?\n${s.products} מוצרים, ${s.agents} סוכנים, ${s.deliveries} אספקות, ${s.days} ימי הכנסה.\n\nכל הנתונים שבטלפון עכשיו יוחלפו בנתוני הגיבוי.`)) return;
      setBusy(true);
      await restoreBackup(b);
      toast('השחזור הושלם');
      setTimeout(() => {
        window.location.hash = '#/';
        window.location.reload();
      }, 800);
    } catch (err) {
      console.error(err);
      toast('הקובץ הזה לא נראה כמו גיבוי של כיכר השבת');
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
            אם הטלפון יאבד או יתקלקל, רק גיבוי יחזיר את המחירון, הסוכנים וכל הרישומים. הגיבוי הוא קובץ אחד. אפשר לשמור אותו ב-Google Drive, לשלוח לעצמך בוואטסאפ או במייל.
          </p>
          <p className="hint" style={{ margin: 0 }}>
            גיבוי אחרון: <b style={{ color: last ? 'var(--ink)' : 'var(--red)' }}>{last ? fromIso(last).toLocaleDateString('he-IL') : 'עוד לא נעשה'}</b>
          </p>
        </div>
        <button type="button" className="btn" onClick={backup} disabled={busy}>
          <Icon name="upload" /> יצירת גיבוי ושמירה
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
