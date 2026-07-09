import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle } from "@phosphor-icons/react";
import { BULK, TABLE } from "@/constants/testIds";

export default function BulkResult() {
  const [opts, setOpts] = useState({ test: [], dataset: [] });
  const [dataset, setDataset] = useState("");
  const [test, setTest] = useState("");
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [result1, setResult1] = useState("");
  const [result2, setResult2] = useState("");
  const [resultDate, setResultDate] = useState(new Date().toISOString().slice(0, 10));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/options").then((r) => setOpts(r.data)).catch(() => {});
  }, []);

  const load = async () => {
    if (!test) return toast.error("Select a test first");

    setLoading(true);
    setSelected({});

    try {
      const params = { test, pending: true, page: 1, page_size: 200 };
      if (dataset) params.dataset = dataset;
      const r = await api.get("/records", { params });
      setItems(r.data.items);
    } catch (e) {
      toast.error("Failed to load pending samples");
    } finally {
      setLoading(false);
    }
  };

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const allChecked = items.length > 0 && selectedIds.length === items.length;

  const toggleAll = () => {
    if (allChecked) setSelected({});
    else setSelected(Object.fromEntries(items.map((i) => [i.id, true])));
  };

  const apply = async () => {
    if (selectedIds.length === 0) return toast.error("Select at least one sample");
    if (!result1 && !result2) return toast.error("Enter Result 1 or Result 2");

    try {
      await api.post("/records/bulk-result", {
        ids: selectedIds,
        test,
        result1: result1 || null,
        result2: result2 || null,
        result_date: resultDate || null,
      });

      toast.success(`Applied result to ${selectedIds.length} samples`);
      scheduleDriveSync();
      setOpen(false);
      setResult1("");
      setResult2("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Apply failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Bulk result entry
        </div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">
          Apply Same Result to Multiple Samples
        </h1>
      </div>

      <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <Field label="Dataset">
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              className="w-full border rounded p-2 bg-white"
            >
              <option value="">All datasets</option>
              {opts.dataset?.map((d) => (
                <option key={d.value || d.name || d} value={d.value || d.name || d}>
                  {d.label || d.name || d}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Choose test">
            <select
              data-testid={BULK.testFilter}
              value={test}
              onChange={(e) => setTest(e.target.value)}
              className="w-full border rounded p-2 bg-white"
            >
              <option value="">Select test</option>
              {opts.test?.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>

          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Load pending"}
          </Button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid={BULK.applyOpen}
                disabled={selectedIds.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <CheckCircle size={16} className="mr-2" />
                Apply result to {selectedIds.length} selected
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Apply result to {selectedIds.length} samples</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <Field label="Result date">
                  <Input
                    data-testid={BULK.resultDate}
                    type="date"
                    value={resultDate}
                    onChange={(e) => setResultDate(e.target.value)}
                  />
                </Field>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Result Field 1">
                    <select
                      data-testid={BULK.result1}
                      value={result1}
                      onChange={(e) => setResult1(e.target.value)}
                      className="w-full border rounded p-2 bg-white"
                    >
                      <option value="">Select result</option>
                      <option value="Positive">Positive</option>
                      <option value="Negative">Negative</option>
                      <option value="Indeterminate">Indeterminate</option>
                    </select>
                  </Field>
                  <Field label="Result Field 2">
                    <Input
                      data-testid={BULK.result2}
                      placeholder="Optional"
                      value={result2}
                      onChange={(e) => setResult2(e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button data-testid={BULK.applyConfirm} onClick={apply} className="bg-blue-600 hover:bg-blue-700 text-white">
                  Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-md shadow-none bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-slate-200">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 w-10">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} data-testid={TABLE.selectAll} />
                </th>
                <th className="px-3 py-2">Lab #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Test</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {loading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    {test ? "No pending samples for this test." : "Select a test to load pending samples."}
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-blue-50/40">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={!!selected[r.id]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))}
                      data-testid={TABLE.select(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-900">{r.lab_number}</td>
                  <td className="px-3 py-2 tabular-nums">{r.date}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                  <td className="px-3 py-2">{r.district}</td>
                  <td className="px-3 py-2">{r.sample_type}</td>
                  <td className="px-3 py-2">{test}</td>
                </tr>
              ))}
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
