import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FileCsv, MicrosoftExcelLogo, CloudArrowUp, Funnel, ArrowCounterClockwise } from "@phosphor-icons/react";
import { REPORT } from "@/constants/testIds";
import { uploadBlobToDrive, isDriveConfigured } from "@/lib/drive";

const displayDate = (value) => {
  if (!value || value === "—") return value || "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : value;
};

const ANY = "__any__";
const emptyF = {
  dataset: ANY,
  test: ANY,
  district: ANY,
  sample_type: ANY,
  result_contains: "",
  date_from: "",
  date_to: "",
};

const normalizeTests = (record) => {
  if (Array.isArray(record.tests) && record.tests.length) {
    return record.tests.map((t) => ({
      test: t.test || t.name || "—",
      result: [t.result1, t.result2].filter(Boolean).join(" / ") || "Pending",
      result_date: t.result_date || record.result_date || "—",
    }));
  }

  if (record.test) {
    const resultText = record.results?.length
      ? record.results.map((x) => [x.name, x.value].filter(Boolean).join(" ")).join(" / ")
      : "Pending";

    return [{
      test: record.test,
      result: resultText,
      result_date: record.result_date || "—",
    }];
  }

  return [{ test: "—", result: "Pending", result_date: record.result_date || "—" }];
};

export default function Reports() {
  const [opts, setOpts] = useState({ datasets: [], test: [], tests_by_dataset: {}, district: [], sample_type: [] });
  const [f, setF] = useState(emptyF);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/options").then((r) => setOpts(r.data)).catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, []);

  const params = () => {
    const p = {};
    Object.entries(f).forEach(([k, v]) => {
      if (v && v !== ANY) p[k] = v;
    });
    return p;
  };

  const datasets = opts.datasets || opts.dataset || [];

  const availableTests = f.dataset !== ANY && opts.tests_by_dataset?.[f.dataset]
    ? opts.tests_by_dataset[f.dataset]
    : opts.test || [];

  const run = async () => {
    setLoading(true);
    try {
      const r = await api.get("/records", { params: { ...params(), page: 1, page_size: 200 } });
      setItems(r.data.items);
      setTotal(r.data.total);
    } catch (e) {
      toast.error("Failed to run report");
    } finally {
      setLoading(false);
    }
  };

  const doExport = async (format) => {
    try {
      const r = await api.get("/export", {
        params: { ...params(), format },
        responseType: "blob",
      });
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
      const r = await api.get("/export", {
        params: { ...params(), format: "xlsx" },
        responseType: "blob",
      });
      const filename = `SPHCL_LabRecords_${new Date().toISOString().slice(0, 10)}.xlsx`;
      toast.loading("Uploading to Google Drive…", { id: "drive" });
      await uploadBlobToDrive(
        r.data,
        filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      toast.success("Saved to Google Drive", { id: "drive" });
    } catch (e) {
      toast.error(e.message || "Drive upload failed", { id: "drive" });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Reports</div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">Filtered Reports & Export</h1>
      </div>

      <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <FilterSelect
            label="Dataset"
            value={f.dataset}
            onChange={(v) => setF({ ...f, dataset: v, test: ANY })}
            options={datasets}
            testId={REPORT.filterDataset}
          />
          <FilterSelect
            label="Test"
            value={f.test}
            onChange={(v) => setF({ ...f, test: v })}
            options={availableTests}
            testId={REPORT.filterTest}
          />
          <FilterSelect
            label="District"
            value={f.district}
            onChange={(v) => setF({ ...f, district: v })}
            options={opts.district}
            testId={REPORT.filterDistrict}
          />
          <FilterSelect
            label="Sample Type"
            value={f.sample_type}
            onChange={(v) => setF({ ...f, sample_type: v })}
            options={opts.sample_type}
            testId={REPORT.filterSampleType}
          />

          <Field label="Result contains">
            <Input
              data-testid={REPORT.filterResult}
              value={f.result_contains}
              onChange={(e) => setF({ ...f, result_contains: e.target.value })}
              placeholder="e.g., Positive"
            />
          </Field>
          <Field label="From">
            <Input
              data-testid={REPORT.filterFrom}
              type="date"
              value={f.date_from}
              onChange={(e) => setF({ ...f, date_from: e.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              data-testid={REPORT.filterTo}
              type="date"
              value={f.date_to}
              onChange={(e) => setF({ ...f, date_to: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button data-testid={REPORT.apply} onClick={run} className="bg-blue-600 hover:bg-blue-700 text-white rounded-md">
            <Funnel size={16} className="mr-2" /> Apply filters
          </Button>
          <Button variant="outline" onClick={() => setF(emptyF)} data-testid={REPORT.reset}>
            <ArrowCounterClockwise size={16} className="mr-2" /> Reset
          </Button>
          <Button variant="outline" onClick={() => doExport("csv")} data-testid={REPORT.exportCsv} className="rounded-md">
            <FileCsv size={16} className="mr-2" /> CSV
          </Button>
          <Button variant="outline" onClick={() => doExport("xlsx")} data-testid={REPORT.exportXlsx} className="rounded-md">
            <MicrosoftExcelLogo size={16} className="mr-2" /> Excel
          </Button>
          <Button variant="outline" onClick={saveToDrive} data-testid={REPORT.saveDrive} className="rounded-md">
            <CloudArrowUp size={16} className="mr-2" /> Save to Drive
          </Button>
          <div className="ml-auto text-sm text-slate-500">Matched: {total}</div>
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-md shadow-none bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-slate-200">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Dataset</th>
                <th className="px-3 py-2">Lab #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Test</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Result Date</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {loading && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">No matching records. Adjust filters.</td></tr>
              )}
              {items.map((r) => {
                const allTests = normalizeTests(r);
                const tests = f.test !== ANY
                  ? allTests.filter((t) => t.test === f.test)
                  : allTests;
                return tests.map((t, index) => {
                  const first = index === 0;
                  return (
                    <tr key={`${r.id}-${index}`} className={first ? "border-t border-slate-200" : "border-t border-slate-50"}>
                      <td className="px-3 py-2">{first ? (datasets.find((d) => (d.key || d.value || d.name) === r.dataset)?.name || r.dataset || "—") : ""}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-900">{first ? r.lab_number : ""}</td>
                      <td className="px-3 py-2 tabular-nums">{first ? displayDate(r.date) : ""}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{first ? r.name : ""}</td>
                      <td className="px-3 py-2 tabular-nums">{first ? (r.age ?? "—") : ""}</td>
                      <td className="px-3 py-2">{first ? r.district : ""}</td>
                      <td className="px-3 py-2">{first ? r.sample_type : ""}</td>
                      <td className="px-3 py-2">{t.test}</td>
                      <td className="px-3 py-2">{t.result}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">{displayDate(t.result_date)}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <Label className="text-xs font-semibold tracking-[0.05em] uppercase text-slate-500">{label}</Label>
    <div className="mt-1.5">{children}</div>
  </div>
);

const FilterSelect = ({ label, value, onChange, options, testId }) => (
  <Field label={label}>
    <select
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border rounded p-2 bg-white"
    >
      <option value={ANY}>Any</option>
      {options?.map((o) => (
        <option key={o.value || o.name || o} value={o.key || o.value || o.name || o}>
          {o.label || o.name || o}
        </option>
      ))}
    </select>
  </Field>
);
