import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';

const ITEMS = [
  { to: '/', icon: 'home', label: 'בית' },
  { to: '/catalog', icon: 'tag', label: 'מחירון' },
  { to: '/agents', icon: 'users', label: 'סוכנים' },
  { to: '/reports', icon: 'chart', label: 'דוחות' },
  { to: '/settings', icon: 'sliders', label: 'הגדרות' },
];

export function BottomNav() {
  return (
    <nav className="nav">
      {ITEMS.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="pillicon">
            <Icon name={it.icon} />
          </span>
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
