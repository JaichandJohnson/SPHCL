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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash, CheckCircle } from "@phosphor-icons/react";
import { BULK, TABLE } from "@/constants/testIds";

export default function BulkResult() {
  const [opts, setOpts] = useState({ test: [] });
  const [test, setTest] = useState("");
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [results, setResults] = useState([{ name: "Result", value: "" }]);
  const [resultDate, setResultDate] = useState(new Date().toISOString().slice(0, 10));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/options").then((r) => setOpts(r.data)).catch(() => {}); }, []);

  const load = async () => {
    if (!test) return;
    setLoading(true);
    setSelected({});
    try {
      const r = await api.get("/records", { params: { test, pending: true, page: 1, page_size: 200 } });
      setItems(r.data.items);
    } catch (e) { toast.error("Failed"); } finally { setLoading(false); }
  };

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const allChecked = items.length > 0 && selectedIds.length === items.length;

  const toggleAll = () => {
    if (allChecked) setSelected({});
    else setSelected(Object.fromEntries(items.map((i) => [i.id, true])));
  };

  const apply = async () => {
    if (selectedIds.length === 0) return toast.error("Select at least one sample");
    if (!results.some((r) => r.value.trim())) return toast.error("Enter at least one result value");
    try {
      await api.post("/records/bulk-result", {
        ids: selectedIds,
        results: results.filter((r) => r.value !== ""),
        result_date: resultDate || null,
      });
      toast.success(`Applied to ${selectedIds.length} samples`);
      scheduleDriveSync();
      setOpen(false);
      setResults([{ name: "Result", value: "" }]);
      load();
    } catch (e) {
      toast.error("Apply failed");
    }
  };

  return (
    <div className="space-y-4" data-testid="bulk-result-page">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Bulk result entry</div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">Apply Same Result to Multiple Samples</h1>
      </div>

      <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="flex items-end gap-3">
          <div className="w-72">
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">Choose test</Label>
            <Select value={test} onValueChange={setTest}>
              <SelectTrigger data-testid={BULK.testFilter} className="mt-1.5 bg-white">
                <SelectValue placeholder="Select a test" />
              </SelectTrigger>
              <SelectContent>
                {opts.test?.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={!test} className="bg-blue-600 hover:bg-blue-700 rounded-md h-10">Load pending</Button>
          <div className="flex-1" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={selectedIds.length === 0} data-testid={BULK.applyOpen} className="rounded-md bg-emerald-600 hover:bg-emerald-700 h-10">
                <CheckCircle size={16} className="mr-1.5" /> Apply result to {selectedIds.length} selected
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Apply result to {selectedIds.length} samples</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">Result date</Label>
                  <Input data-testid={BULK.resultDate} type="date" className="mt-1.5" value={resultDate} onChange={(e) => setResultDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">Results</Label>
                  <div className="mt-1.5 bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2">
                    {results.map((r, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2">
                        <Input
                          placeholder="Result Name"
                          className="col-span-5 bg-white"
                          data-testid={BULK.resultName(i)}
                          value={r.name}
                          onChange={(e) => setResults((prev) => prev.map((x, k) => k === i ? { ...x, name: e.target.value } : x))}
                        />
                        <Input
                          placeholder="Value"
                          className="col-span-6 bg-white"
                          data-testid={BULK.resultValue(i)}
                          value={r.value}
                          onChange={(e) => setResults((prev) => prev.map((x, k) => k === i ? { ...x, value: e.target.value } : x))}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setResults((prev) => prev.filter((_, k) => k !== i))}
                          disabled={results.length <= 1}
                          className="col-span-1 text-slate-500 hover:text-red-600"
                        >
                          <Trash size={16} />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button" variant="outline" data-testid={BULK.addResult}
                      onClick={() => setResults((prev) => [...prev, { name: `Result ${prev.length + 1}`, value: "" }])}
                      className="text-blue-600 border-blue-200 hover:bg-blue-50"
                    >
                      <Plus size={14} className="mr-1" /> Add result
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={apply} data-testid={BULK.applyConfirm} className="bg-emerald-600 hover:bg-emerald-700">Apply</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-md shadow-none bg-white overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="w-full text-sm zebra">
            <thead className="bg-white sticky top-0 border-b border-slate-200">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    data-testid={TABLE.selectAll}
                  />
                </th>
                <th className="px-3 py-2">Lab #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">Sample</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
              {!loading && items.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                  {test ? "No pending samples for this test." : "Select a test to load pending samples."}
                </td></tr>
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
                  <td className="px-3 py-2 font-mono text-xs">{r.lab_number}</td>
                  <td className="px-3 py-2 tabular-nums">{r.date}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                  <td className="px-3 py-2">{r.district}</td>
                  <td className="px-3 py-2">{r.sample_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
