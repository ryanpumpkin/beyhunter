import { useState } from 'react';
import Header from './components/Header.jsx';
import FeedPage from './pages/FeedPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import SkuPage from './pages/SkuPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import SafetyPage from './pages/SafetyPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

// page: {name:'feed'} | {name:'catalog'} | {name:'sku', code} | {name:'report'} | {name:'safety'} | {name:'settings'}
export default function App() {
  const [page, setPage] = useState(() =>
    new URLSearchParams(window.location.search).has('admin') ? { name: 'settings' } : { name: 'feed' }
  );
  const nav = p => { setPage(p); window.scrollTo(0, 0); };

  return (
    <div className="min-h-screen">
      <Header page={page} nav={nav} />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
        {page.name === 'feed' && <FeedPage nav={nav} />}
        {page.name === 'catalog' && <CatalogPage nav={nav} />}
        {page.name === 'sku' && <SkuPage code={page.code} nav={nav} />}
        {page.name === 'report' && <ReportPage nav={nav} />}
        {page.name === 'safety' && <SafetyPage />}
        {page.name === 'settings' && <SettingsPage />}
      </main>
      <footer className="border-t border-white/10 py-6 text-center text-xs text-white/40">
        BeyHunter — 情報聚合自公開來源，落單前請自行核實舖家。價格僅供參考。
      </footer>
    </div>
  );
}
