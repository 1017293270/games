import { NavLink } from 'react-router';
import { Glyph, type GlyphName } from '../design';

interface TabDef {
  to: string;
  label: string;
  glyph: GlyphName;
  end?: boolean;
}

const TABS: TabDef[] = [
  { to: '/', label: '修炼', glyph: 'cultivate', end: true },
  { to: '/explore', label: '探索', glyph: 'explore' },
  { to: '/realm', label: '秘境', glyph: 'realm' },
  { to: '/social', label: '社交', glyph: 'social' },
  { to: '/character', label: '角色', glyph: 'self' },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `tab ${isActive ? 'tab--on' : ''}`}
        >
          <Glyph name={tab.glyph} />
          <span>{tab.label}</span>
          <span className="tab__mark" />
        </NavLink>
      ))}
    </nav>
  );
}
