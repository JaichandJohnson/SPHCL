import React, { useEffect, useState } from 'react';
import { mobileApi } from '@/lib/mobileApi';

export default function MobileDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    mobileApi.get('/stats').then(({ data }) => { if (active) setStats(data); })
      .catch(() => { if (active) setError('Unable to load dashboard statistics.'); });
    return () => { active = false; };
  }, []);
  const cards = [
    ['Lab Records', stats?.total_records], ['Tests', stats?.total_tests],
    ['Pending', stats?.pending_tests], ['Districts', stats?.district_count],
  ];
  return <div className="space-y-5">
    <h2 className="text-xl font-bold">Laboratory Dashboard</h2>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!stats && !error && <p className="text-sm text-slate-500">Loading statistics…</p>}
    <div className="grid grid-cols-2 gap-3">{cards.map(([label, value]) =>
      <section key={label} className="bg-white rounded-xl border p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold">{value ?? '—'}</div></section>
    )}</div>
    <section className="bg-white rounded-xl border p-4"><h3 className="font-semibold mb-3">Dataset Summary</h3>
      {(stats?.datasets || []).map((d) => <div key={d.dataset} className="flex justify-between gap-2 border-t py-2 text-sm"><span>{d.dataset}</span><span>{d.records} records · {d.tests} tests</span></div>)}
    </section>
    <section className="bg-white rounded-xl border p-4"><h3 className="font-semibold mb-3">Top Tests</h3>
      {(stats?.top_tests || []).map((t) => <div key={t.test} className="flex justify-between gap-2 border-t py-2 text-sm"><span>{t.test}</span><span>{t.count}</span></div>)}
    </section>
  </div>;
}
