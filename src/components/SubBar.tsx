import { Icon } from './Icon';
import { useBack } from './useBack';

export function SubBar({ title, sub }: { title: string; sub?: string }) {
  const back = useBack();
  return (
    <header className="bar">
      <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
        <Icon name="back" />
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h1 className="page-title">{title}</h1>
        {sub && <span className="sub" style={{ fontSize: 14 }}>{sub}</span>}
      </div>
    </header>
  );
}
