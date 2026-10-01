import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { toast } from './Toast';
import { safeName, sendText, shareFile, ShareCancelled } from '../lib/share';

type Props = {
  /** the document (rendered again at a fixed width for the picture / PDF) */
  doc: ReactNode;
  /** file name without extension, e.g. "אישור-תשלום-מאפיית-לוי-2.10.2026" */
  fileBase: string;
  title: string;
  text: string;
  phone?: string | null;
  children?: ReactNode;
};

/** Preview of a document for the agent + send it as a picture, a PDF, or a WhatsApp message. */
export function DocShare({ doc, fileBase, title, text, phone, children }: Props) {
  const [busy, setBusy] = useState<'' | 'png' | 'pdf' | 'text'>('');
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function make(kind: 'png' | 'pdf') {
    setBusy(kind);
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 150));
      await document.fonts?.ready;
      const el = ref.current!;
      const { elementToPdf, elementToPng } = await import('../lib/pdf');
      const blob = kind === 'png' ? await elementToPng(el) : await elementToPdf(el);
      await shareFile(`${safeName(fileBase)}.${kind}`, blob, title);
    } catch (e) {
      if (!(e instanceof ShareCancelled)) {
        console.error(e);
        toast(kind === 'png' ? 'יצירת התמונה נכשלה. נסה שוב.' : 'יצירת ה-PDF נכשלה. נסה שוב.', 'err');
      }
    }
    setExporting(false);
    setBusy('');
  }

  async function message() {
    setBusy('text');
    try {
      await sendText(text, phone);
      if (!phone) toast('ההודעה הועתקה / נפתח תפריט שיתוף');
    } catch (e) {
      if (!(e instanceof ShareCancelled)) toast('השליחה נכשלה', 'err');
    }
    setBusy('');
  }

  return (
    <>
      <div className="doc">{doc}</div>
      <div className="sticky-save share-bar">
        <span className="share-k">שליחה לסוכן</span>
        <div className="share-row">
          <button type="button" className="btn small" onClick={() => make('png')} disabled={!!busy}>
            <Icon name="image" size={20} /> {busy === 'png' ? 'מכין…' : 'תמונה'}
          </button>
          <button type="button" className="btn small ghost" onClick={() => make('pdf')} disabled={!!busy}>
            <Icon name="file" size={20} /> {busy === 'pdf' ? 'מכין…' : 'PDF'}
          </button>
          <button type="button" className="btn small ghost wa" onClick={message} disabled={!!busy}>
            <Icon name="message" size={20} /> הודעה
          </button>
        </div>
        {children}
      </div>
      {exporting && (
        <div className="print-host" aria-hidden="true">
          <div ref={ref} className="doc export">
            {doc}
          </div>
        </div>
      )}
    </>
  );
}
