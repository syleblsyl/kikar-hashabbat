import { SubBar } from '../components/SubBar';

export function Soon({ title, what, withBar = true }: { title: string; what: string; withBar?: boolean }) {
  return (
    <>
      {withBar ? <SubBar title={title} /> : <header className="bar"><h1 className="page-title" style={{ padding: '4px 4px 0' }}>{title}</h1></header>}
      <div className="card soon-box">
        <img src="/logo.webp" alt="" />
        <h2>{title} – בעדכון הקרוב</h2>
        <p>{what}</p>
        <p>כשהעדכון יהיה מוכן, תופיע הודעה במסך הבית. לוחצים "עדכון", והנתונים נשארים.</p>
      </div>
    </>
  );
}
