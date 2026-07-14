import { getAdminToken } from '../api.js';

const TABS = [
  { key: 'feed', label: '情報' },
  { key: 'catalog', label: '目錄' },
  { key: 'report', label: '回報' },
  { key: 'safety', label: '防詐' },
];

// ⚙️ 只有管理員先見到：登入過（localStorage 有 token）或者用 ?admin=1 開
// ——公開網站嘅路人連個掣都唔知存在
const showAdmin = () => !!getAdminToken() || new URLSearchParams(window.location.search).has('admin');

export default function Header({ page, nav }) {
  const tabs = showAdmin() ? [...TABS, { key: 'settings', label: '⚙️' }] : TABS;
  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-navy-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button onClick={() => nav({ name: 'feed' })} className="flex shrink-0 items-baseline gap-1">
          <span className="font-display text-2xl tracking-wide text-bey-yellow">BEYHUNTER</span>
          <span className="hidden text-xs text-white/50 md:inline">港台日陀螺情報</span>
        </button>
        <nav className="ml-auto flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => nav({ name: t.key })}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
                page.name === t.key
                  ? 'bg-bey-yellow text-navy-900'
                  : 'text-white/70 hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
