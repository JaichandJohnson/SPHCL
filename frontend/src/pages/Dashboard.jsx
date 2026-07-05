import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { TestTube, ClockCounterClockwise, MapPin, ListChecks, PlusCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

const StatCard = ({ icon: Icon, label, value, hint }) => (
  <Card className="p-5 border border-slate-200 shadow-none rounded-md bg-white">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
        <div className="font-heading text-3xl font-semibold text-slate-900 mt-2 tabular-nums">{value}</div>
        {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
      </div>
      <div className="w-9 h-9 rounded-md bg-blue-50 flex items-center justify-center">
        <Icon size={18} className="text-blue-600" weight="regular" />
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
    <div className="space-y-6" data-testid="dashboard">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Overview</div>
          <h1 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 mt-1">
            Laboratory Dashboard
          </h1>
        </div>
        <Button
          data-testid="quick-new-record"
          onClick={() => nav("/entry")}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md h-10"
        >
          <PlusCircle size={16} weight="bold" className="mr-2" /> New Record
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={TestTube} label="Total Records" value={stats?.total ?? "—"} hint="All samples logged" />
        <StatCard icon={ClockCounterClockwise} label="Today" value={stats?.today ?? "—"} hint="Entries dated today" />
        <StatCard icon={ListChecks} label="Pending Results" value={stats?.pending ?? "—"} hint="Awaiting result entry" />
        <StatCard icon={MapPin} label="Districts Covered" value={stats?.districts ?? "—"} hint="Unique districts" />
      </div>

      <Card className="p-5 border border-slate-200 shadow-none rounded-md bg-white">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Top Tests</div>
        <div className="mt-3">
          {stats?.top_tests?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase">
                  <th className="py-2 font-medium">Test</th>
                  <th className="py-2 font-medium text-right">Samples</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_tests.map((t) => (
                  <tr key={t.test} className="border-t border-slate-100">
                    <td className="py-2 text-slate-800">{t.test}</td>
                    <td className="py-2 text-right tabular-nums text-slate-900 font-medium">{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-slate-500">No records yet. Start by creating a new record.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
