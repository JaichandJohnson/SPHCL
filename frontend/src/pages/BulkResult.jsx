import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle } from "@phosphor-icons/react";
import { BULK, TABLE } from "@/constants/testIds";

const displayDate = (value) => {
  if (!value || value === "—") return value || "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const shortEpid = (value) => {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.length >= 4 ? parts.slice(-4).join(" ") : value || "—";
};

const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === "";

const pendingRowsFor = (record, selectedTest) => {
  const samples =
    Array.isArray(record.samples) && record.samples.length
      ? record.samples
      : [
          {
            id: "legacy",
            lab_number: record.lab_number || "",
            sample_type: record.sample_type || "",
            tests: record.tests || [],
          },
        ];

  const rows = [];

  samples.forEach((sample, sampleIndex) => {
    const test = (sample.tests || []).find(
      (entry) => entry.test === selectedTest
    );

    if (
      test &&
      isBlank(test.result1) &&
      isBlank(test.result2)
    ) {
      rows.push({
        key: `${record.id}::${sample.id || sampleIndex}`,
        recordId: record.id,
        sampleId: sample.id || "",
        labNumber: sample.lab_number || "",
        epidNumber: sample.epid_number || record.epid_number || "",
        date: record.date || "",
        name: record.name || "",
        district: record.district || "",
        sampleType: sample.sample_type || "",
        test: selectedTest,
      });
    }
  });

  return rows;
};

export default function BulkResult() {
  const [opts, setOpts] = useState({
    test: [],
    datasets: [],
    tests_by_dataset: {},
  });
  const [dataset, setDataset] = useState("");
  const [test, setTest] = useState("");
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({});
  const [result1, setResult1] = useState("");
  const [result2, setResult2] = useState("");
  const [resultDate, setResultDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get("/options")
      .then((response) => setOpts(response.data))
      .catch(() => {});
  }, []);

  const datasets = opts.datasets || opts.dataset || [];

  const availableTests = useMemo(() => {
    if (dataset && opts.tests_by_dataset?.[dataset]) {
      return opts.tests_by_dataset[dataset];
    }
    return opts.test || [];
  }, [opts, dataset]);

  useEffect(() => {
    if (test && !availableTests.includes(test)) {
      setTest("");
      setItems([]);
      setSelected({});
    }
  }, [dataset, availableTests, test]);

  const load = async () => {
    if (!test) return toast.error("Select a test first");

    setLoading(true);
    setSelected({});

    try {
      const params = {
        test,
        pending: true,
        page: 1,
        page_size: 500,
      };
      if (dataset) params.dataset = dataset;

      const response = await api.get("/records", { params });
      const rows = (response.data.items || []).flatMap((record) =>
        pendingRowsFor(record, test)
      );
      setItems(rows);
    } catch {
      toast.error("Failed to load pending samples");
    } finally {
      setLoading(false);
    }
  };

  const selectedKeys = Object.entries(selected)
    .filter(([, value]) => value)
    .map(([key]) => key);

  const selectedRows = items.filter((item) =>
    selectedKeys.includes(item.key)
  );

  const allChecked =
    items.length > 0 && selectedRows.length === items.length;

  const toggleAll = () => {
    if (allChecked) {
      setSelected({});
    } else {
      setSelected(
        Object.fromEntries(items.map((item) => [item.key, true]))
      );
    }
  };

  const apply = async () => {
    if (selectedRows.length === 0) {
      return toast.error("Select at least one sample");
    }

    if (!result1 && !result2) {
      return toast.error("Enter Result 1 or Result 2");
    }

    try {
      await Promise.all(
        selectedRows.map((row) =>
          api.post("/records/bulk-result", {
            ids: [row.recordId],
            sample_id: row.sampleId || null,
            test,
            result1: result1 || null,
            result2: result2 || null,
            result_date: resultDate || null,
          })
        )
      );

      toast.success(
        `Applied result to ${selectedRows.length} sample${
          selectedRows.length === 1 ? "" : "s"
        }`
      );
      scheduleDriveSync();

      setItems((current) =>
        current.filter((item) => !selectedKeys.includes(item.key))
      );
      setSelected({});
      setOpen(false);
      setResult1("");
      setResult2("");

      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Apply failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Bulk sample result entry
        </div>
        <h1 className="mt-1 font-heading text-3xl font-semibold text-slate-900">
          Apply Same Result to Multiple Samples
        </h1>
      </div>

      <Card className="rounded-md border border-slate-200 bg-white p-5 shadow-none">
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-4">
          <Field label="Dataset">
            <select
              value={dataset}
              onChange={(event) => {
                setDataset(event.target.value);
                setItems([]);
                setSelected({});
              }}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">All datasets</option>
              {datasets.map((item) => (
                <option
                  key={item.value || item.name || item}
                  value={item.key || item.value || item.name || item}
                >
                  {item.label || item.name || item}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Choose test">
            <select
              data-testid={BULK.testFilter}
              value={test}
              onChange={(event) => setTest(event.target.value)}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select test</option>
              {availableTests.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>

          <Button
            type="button"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load pending"}
          </Button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid={BULK.applyOpen}
                disabled={selectedRows.length === 0}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                <CheckCircle size={16} className="mr-2" />
                Apply result to {selectedRows.length} selected
              </Button>
            </DialogTrigger>

            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Apply result to {selectedRows.length} samples
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <Field label="Result date">
                  <Input
                    data-testid={BULK.resultDate}
                    type="date"
                    value={resultDate}
                    onChange={(event) =>
                      setResultDate(event.target.value)
                    }
                  />
                </Field>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Result Field 1">
                    <Input
                      data-testid={BULK.result1}
                      list="bulk-result-options"
                      placeholder="Select or type result"
                      value={result1}
                      onChange={(event) => setResult1(event.target.value)}
                    />
                    <datalist id="bulk-result-options">
                      <option value="Positive" />
                      <option value="Negative" />
                      <option value="Indeterminate" />
                    </datalist>
                  </Field>

                  <Field label="Result Field 2">
                    <Input
                      data-testid={BULK.result2}
                      placeholder="Optional"
                      value={result2}
                      onChange={(event) => setResult2(event.target.value)}
                    />
                  </Field>
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  data-testid={BULK.applyConfirm}
                  onClick={apply}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                >
                  Apply
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-white">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    data-testid={TABLE.selectAll}
                  />
                </th>
                <th className="px-3 py-2">Lab #</th>
                <th className="px-3 py-2">EPID #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Test</th>
              </tr>
            </thead>

            <tbody className="text-slate-700">
              {loading && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-slate-500"
                  >
                    {test
                      ? "No pending samples for this test."
                      : "Select a test to load pending samples."}
                  </td>
                </tr>
              )}

              {items.map((row) => (
                <tr
                  key={row.key}
                  className="border-b border-slate-100 hover:bg-blue-50/40"
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={!!selected[row.key]}
                      onCheckedChange={(value) =>
                        setSelected((current) => ({
                          ...current,
                          [row.key]: !!value,
                        }))
                      }
                      data-testid={TABLE.select(row.key)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-900">
                    {row.labNumber}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {shortEpid(row.epidNumber)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {displayDate(row.date)}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {row.name}
                  </td>
                  <td className="px-3 py-2">{row.district}</td>
                  <td className="px-3 py-2">{row.sampleType}</td>
                  <td className="px-3 py-2">{row.test}</td>
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
    <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
      {label}
    </Label>
    <div className="mt-1.5">{children}</div>
  </div>
);
