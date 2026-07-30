import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TestTube, ClockCounterClockwise, MapPin, ListChecks, PlusCircle } from "@phosphor-icons/react";

const StatCard = ({ icon: Icon, label, value, hint }) => (
  <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
        <div className="mt-2 text-3xl font-semibold text-slate-900">{value ?? "—"}</div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="rounded-full bg-blue-50 p-3 text-blue-600">
        <Icon size={24} />
      </div>
    </div>
  </Card>
);

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get("/stats").then((r) => setStats(r.data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Overview</div>
          <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">Laboratory Dashboard</h1>
        </div>
        <Button onClick={() => nav("/entry")} className="bg-blue-600 hover:bg-blue-700 text-white rounded-md h-10">
          <PlusCircle size={18} className="mr-2" /> New Record
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={ListChecks} label="Lab Records" value={stats?.total_records} hint="Patient/sample records" />
        <StatCard icon={TestTube} label="Tests" value={stats?.total_tests} hint="All tests across records" />
        <StatCard icon={ClockCounterClockwise} label="Pending" value={stats?.pending_tests} hint="Tests without result" />
        <StatCard icon={MapPin} label="Districts" value={stats?.district_count} hint="Districts represented" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
          <div className="font-semibold text-slate-900">Dataset Summary</div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Dataset</th>
                  <th className="py-2 text-right">Records</th>
                  <th className="py-2 text-right">Tests</th>
                </tr>
              </thead>
              <tbody>
                {stats?.datasets?.length ? stats.datasets.map((d) => (
                  <tr key={d.dataset} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{d.dataset}</td>
                    <td className="py-2 text-right tabular-nums">{d.records}</td>
                    <td className="py-2 text-right tabular-nums">{d.tests}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-500">No records yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
          <div className="font-semibold text-slate-900">Top Tests</div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Test</th>
                  <th className="py-2 text-right">Samples</th>
                </tr>
              </thead>
              <tbody>
                {stats?.top_tests?.length ? stats.top_tests.map((t) => (
                  <tr key={t.test} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{t.test}</td>
                    <td className="py-2 text-right tabular-nums">{t.count}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={2} className="py-6 text-center text-slate-500">No records yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
