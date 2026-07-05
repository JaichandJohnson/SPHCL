import React, { useEffect, useState } from "react";
import { api, API } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileCsv, MicrosoftExcelLogo, CloudArrowUp, Funnel, ArrowCounterClockwise } from "@phosphor-icons/react";
import { REPORT } from "@/constants/testIds";
import { uploadBlobToDrive, isDriveConfigured } from "@/lib/drive";

const ANY = "__any__";
const emptyF = { test: ANY, district: ANY, sample_type: ANY, result_contains: "", date_from: "", date_to: "" };

export default function Reports() {
  const [opts, setOpts] = useState({ test: [], district: [], sample_type: [] });
  const [f, setF] = useState(emptyF);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/options").then((r) => setOpts(r.data)).catch(() => {}); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, []);

  const params = () => {
    const p = {};
    Object.entries(f).forEach(([k, v]) => {
      if (v && v !== ANY) p[k] = v;
    });
    return p;
  };

  const run = async () => {
    setLoading(true);
    try {
      const r = await api.get("/records", { params: { ...params(), page: 1, page_size: 200 } });
      setItems(r.data.items); setTotal(r.data.total);
    } catch (e) {
      toast.error("Failed to run report");
    } finally {
      setLoading(false);
    }
  };

  const doExport = async (format) => {
    try {
      const r = await api.get("/export", { params: { ...params(), format }, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lab_records.${format === "xlsx" ? "xlsx" : "csv"}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${format.toUpperCase()}`);
      return r.data;
    } catch (e) {
      toast.error("Export failed");
    }
  };

  const saveToDrive = async () => {
    if (!isDriveConfigured()) {
      toast.error("Google Drive not configured. Add REACT_APP_GOOGLE_CLIENT_ID.");
      return;
    }
    try {
      const r = await api.get("/export", { params: { ...params(), format: "xlsx" }, responseType: "blob" });
      const filename = `SPHCL_LabRecords_${new Date().toISOString().slice(0, 10)}.xlsx`;
      toast.loading("Uploading to Google Drive…", { id: "drive" });
      await uploadBlobToDrive(r.data, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast.success("Saved to Google Drive", { id: "drive" });
    } catch (e) {
      toast.error(e.message || "Drive upload failed", { id: "drive" });
    }
  };

  return (
    <div className="space-y-4" data-testid="reports-page">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Reports</div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">Filtered Reports &amp; Export</h1>
      </div>

      <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <FilterSelect label="Test" testId={REPORT.filterTest} value={f.test} onChange={(v) => setF({ ...f, test: v })} options={opts.test} />
          <FilterSelect label="District" testId={REPORT.filterDistrict} value={f.district} onChange={(v) => setF({ ...f, district: v })} options={opts.district} />
          <FilterSelect label="Sample Type" testId={REPORT.filterSampleType} value={f.sample_type} onChange={(v) => setF({ ...f, sample_type: v })} options={opts.sample_type} />
          <div>
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">Result contains</Label>
            <Input data-testid={REPORT.filterResult} className="mt-1.5" value={f.result_contains} onChange={(e) => setF({ ...f, result_contains: e.target.value })} placeholder="e.g., Positive" />
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">From</Label>
            <Input data-testid={REPORT.filterFrom} type="date" className="mt-1.5" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">To</Label>
            <Input data-testid={REPORT.filterTo} type="date" className="mt-1.5" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <Button onClick={run} data-testid={REPORT.apply} className="bg-blue-600 hover:bg-blue-700 rounded-md">
              <Funnel size={14} className="mr-1.5" /> Apply filters
            </Button>
            <Button variant="ghost" onClick={() => { setF(emptyF); }} data-testid={REPORT.reset}>
              <ArrowCounterClockwise size={14} className="mr-1.5" /> Reset
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => doExport("csv")} data-testid={REPORT.exportCsv} className="rounded-md">
              <FileCsv size={14} className="mr-1.5" /> CSV
            </Button>
            <Button variant="outline" onClick={() => doExport("xlsx")} data-testid={REPORT.exportXlsx} className="rounded-md">
              <MicrosoftExcelLogo size={14} className="mr-1.5 text-emerald-600" /> Excel
            </Button>
            <Button
              onClick={saveToDrive}
              data-testid={REPORT.saveDrive}
              className="rounded-md bg-slate-900 hover:bg-slate-800 text-white"
              title={isDriveConfigured() ? "Save to Google Drive" : "Set REACT_APP_GOOGLE_CLIENT_ID to enable"}
            >
              <CloudArrowUp size={14} className="mr-1.5" /> Save to Drive
            </Button>
          </div>
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-md shadow-none bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm text-slate-600 tabular-nums">Matched: <span className="font-semibold text-slate-900">{total}</span></div>
          {loading && <div className="text-xs text-slate-500">Loading…</div>}
        </div>
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm zebra">
            <thead className="bg-white border-b border-slate-200 sticky top-0">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Lab #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">Test</th>
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Results</th>
                <th className="px-3 py-2">Result Date</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.lab_number}</td>
                  <td className="px-3 py-2 tabular-nums">{r.date}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                  <td className="px-3 py-2 tabular-nums">{r.age ?? "—"}</td>
                  <td className="px-3 py-2">{r.district}</td>
                  <td className="px-3 py-2">{r.test}</td>
                  <td className="px-3 py-2">{r.sample_type}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.results?.map((x, i) => `${x.name}: ${x.value}`).join(" · ") || <span className="text-amber-600">Pending</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{r.result_date ?? "—"}</td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">No matching records. Adjust filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const FilterSelect = ({ label, value, onChange, options, testId }) => (
  <div>
    <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId} className="mt-1.5 bg-white">
        <SelectValue placeholder="Any" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any</SelectItem>
        {options?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
);
