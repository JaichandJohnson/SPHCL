import React, { useEffect, useState } from 'react';
import { mobileApi } from '@/lib/mobileApi';
import { openMobilePatientReport } from '@/mobile/MobilePatientReport';

const datasets = [
  ['all','All'], ['routine','Routine'], ['mr_surveillance','MR Surveillance'],
  ['diphtheria','Diphtheria'], ['pertussis','Pertussis'], ['rabies','Rabies'],
  ['fla','FLA'], ['special_serology','Special Serology'], ['typhoid_surveillance','Typhoid Surveillance'],
];
function samplesFor(record) {
  if (Array.isArray(record.samples) && record.samples.length) return record.samples;
  return [{ lab_number: record.lab_number, sample_type: record.sample_type, tests: record.tests || [{ test: record.test, result1: record.results?.[0]?.name, result2: record.results?.[0]?.value, result_date: record.result_date }] }];
}
function resultFor(test) { return [test.result1 || test.result_1, test.result2 || test.result_2].filter(Boolean).join(' / ') || 'Pending'; }
export default function MobileRecords() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [dataset, setDataset] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    mobileApi.get('/records', { params: { search: query || undefined, dataset: dataset === 'all' ? undefined : dataset, page, page_size: 10 } })
      .then(({ data: result }) => { if (active) setData(result); })
      .catch(() => { if (active) setError('Unable to load records.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, dataset, page]);
  const pages = Math.max(1, Math.ceil(data.total / 10));
  return <div className="space-y-4">
    <h2 className="text-xl font-bold">Laboratory Records</h2>
    <form onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }} className="flex gap-2">
      <input aria-label="Search laboratory records" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or lab number" className="min-w-0 flex-1 rounded-lg border bg-white p-3 text-sm" />
      <button type="submit" className="rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white">Search</button>
    </form>
    <select aria-label="Dataset" value={dataset} onChange={(e) => { setDataset(e.target.value); setPage(1); }} className="w-full rounded-lg border bg-white p-3 text-sm">
      {datasets.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {loading && <p className="text-sm text-slate-500">Loading records…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!loading && !error && data.items.length === 0 && <p className="text-sm text-slate-500">No records found.</p>}
    {!loading && !error && data.items.map((record) => {
      const samples = samplesFor(record);
      return <details key={record.id} className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex justify-between gap-3"><div className="min-w-0"><div className="font-semibold break-words">{record.name || 'Unnamed record'}</div><div className="text-xs text-slate-600 mt-1">Lab #: {samples.map(s => s.lab_number).filter(Boolean).join(', ') || '—'}</div></div><span className="text-xs text-slate-500 shrink-0">{record.date?.slice(0,10) || '—'} ▾</span></div>
        </summary>
        <div className="mt-3 border-t pt-3 text-sm space-y-2">
          <div>Age: {record.age_years ?? record.age ?? '—'} · District: {record.district || '—'}</div>
          {samples.map((sample, i) => <div key={sample.id || i} className="rounded-lg bg-slate-50 p-3">
            <div className="font-semibold">{sample.lab_number || 'Sample'} · {sample.sample_type || '—'}</div>
            {(sample.tests || []).map((test, j) => <div key={test.id || j} className="mt-2 border-t pt-2"><div>{test.test || test.name || '—'}</div><div className="font-medium">{resultFor(test)}</div><div className="text-xs text-slate-500">Result date: {test.result_date || record.result_date || '—'}</div></div>)}
          </div>)}
          <button type="button" onClick={() => openMobilePatientReport(record.id)} className="mt-3 w-full rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white">View / Save PDF</button>
        </div>
      </details>;
    })}
    <div className="flex items-center justify-between gap-2 text-sm"><span>Page {page} of {pages} · {data.total} records</span><div className="flex gap-2"><button className="rounded border px-3 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button><button className="rounded border px-3 py-2 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
  </div>;
}
