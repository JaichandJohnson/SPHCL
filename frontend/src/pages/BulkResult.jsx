import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FloppyDisk } from "@phosphor-icons/react";
import {
  localDateValue,
  millisecondsUntilNextDay,
} from "@/lib/localDate";

const blank = (value) =>
  value === null ||
  value === undefined ||
  String(value).trim() === "";

const shortEpid = (value) => {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length >= 4
    ? parts.slice(-4).join(" ")
    : value || "—";
};

const displayDate = (value) => {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const pendingRows = (records, selectedTest) =>
  records.flatMap((record) =>
    (record.samples || []).flatMap((sample, sampleIndex) =>
      (sample.tests || [])
        .map((test, testIndex) => ({
          key: `${record.id}::${sample.id || sampleIndex}::${
            test.id || testIndex
          }`,
          recordId: record.id,
          sampleId: sample.id,
          sampleIndex,
          testIndex,
          dataset: sample.dataset || record.dataset,
          labNumber: sample.lab_number || "",
          epidNumber: sample.epid_number || record.epid_number || "",
          date: record.date || "",
          name: record.name || "",
          sampleType: sample.sample_type || "",
          testName: test.test || "",
          result1: test.result1 || "",
          result2: test.result2 || "",
          resultDate: test.result_date || "",
          remarks: test.remarks || "",
        }))
        .filter(
          (row) =>
            row.testName === selectedTest &&
            blank(row.result1) &&
            blank(row.result2)
        )
    )
  );

export default function BulkResult() {
  const [opts, setOpts] = useState({
    test: [],
    datasets: [],
    tests_by_dataset: {},
  });
  const [dataset, setDataset] = useState("");
  const [test, setTest] = useState("");
  const [records, setRecords] = useState([]);
  const [pendingKeys, setPendingKeys] = useState(new Set());
  const [selected, setSelected] = useState({});
  const [applyResult, setApplyResult] = useState("Negative");
  const [applyDate, setApplyDate] = useState(localDateValue());
  const [dirtyRecords, setDirtyRecords] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/options").then((response) => setOpts(response.data));
  }, []);

  useEffect(() => {
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setApplyDate(localDateValue());
        schedule();
      }, millisecondsUntilNextDay());
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const datasets = opts.datasets || opts.dataset || [];
  const availableTests = useMemo(
    () =>
      dataset && opts.tests_by_dataset?.[dataset]
        ? opts.tests_by_dataset[dataset]
        : opts.test || [],
    [dataset, opts]
  );

  const rows = useMemo(
    () =>
      pendingRows(records, test).filter((row) =>
        pendingKeys.has(row.key)
      ),
    [records, test, pendingKeys]
  );

  const load = async () => {
    if (!test) {
      toast.error("Select a test");
      return;
    }

    setLoading(true);
    try {
      const response = await api.get("/records", {
        params: {
          dataset: dataset || undefined,
          test,
          pending: true,
          page: 1,
          page_size: 1000,
        },
      });
      const loaded = response.data?.items || [];
      const loadedRows = pendingRows(loaded, test);
      setRecords(loaded);
      setPendingKeys(new Set(loadedRows.map((row) => row.key)));
      setSelected({});
      setDirtyRecords(new Set());
    } catch {
      toast.error("Failed to load pending records");
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (row, field, value) => {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== row.recordId) return record;
        const next = structuredClone(record);
        const target =
          next.samples[row.sampleIndex].tests[row.testIndex];
        target[field] = value;
        if (
          (field === "result1" || field === "result2") &&
          value &&
          !target.result_date
        ) {
          target.result_date = localDateValue();
        }
        return next;
      })
    );
    setDirtyRecords((current) => new Set(current).add(row.recordId));
  };

  const selectedRows = rows.filter((row) => selected[row.key]);

  const applyToSelected = () => {
    if (!selectedRows.length) {
      toast.error("Select at least one pending record");
      return;
    }
    selectedRows.forEach((row) => {
      updateRow(row, "result1", applyResult);
      updateRow(row, "result_date", applyDate);
    });
    toast.success(
      `Result filled in ${selectedRows.length} row${
        selectedRows.length === 1 ? "" : "s"
      }. Review and click Save Records.`
    );
  };

  const saveRecords = async () => {
    if (!dirtyRecords.size) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    try {
      const changed = records.filter((record) =>
        dirtyRecords.has(record.id)
      );
      for (const record of changed) {
        const firstSample = record.samples?.[0] || {};
        const firstTests = firstSample.tests || [];
        await api.put(`/records/${record.id}`, {
          dataset: firstSample.dataset || record.dataset || "routine",
          date: record.date,
          name: record.name,
          age: record.age ?? null,
          sex: record.sex || null,
          district: record.district,
          requesting_institution:
            record.requesting_institution || null,
          epid_number: record.epid_number || null,
          samples: record.samples,
          remarks: record.remarks || null,
          sample_type: firstSample.sample_type || "",
          tests: firstTests,
          test: firstTests[0]?.test || "",
          result_date: firstTests[0]?.result_date || null,
          results: firstTests.map((item) => ({
            name: item.result1 || "",
            value: item.result2 || "",
          })),
        });
      }

      const savedIds = new Set(changed.map((record) => record.id));
      setPendingKeys((current) => {
        const next = new Set(current);
        rows.forEach((row) => {
          if (!savedIds.has(row.recordId)) return;
          const record = records.find(
            (item) => item.id === row.recordId
          );
          const target =
            record?.samples?.[row.sampleIndex]?.tests?.[row.testIndex];
          if (
            !blank(target?.result1) ||
            !blank(target?.result2)
          ) {
            next.delete(row.key);
          }
        });
        return next;
      });
      setSelected({});
      setDirtyRecords(new Set());
      scheduleDriveSync();
      toast.success("Records saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const allSelected =
    rows.length > 0 && rows.every((row) => selected[row.key]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Bulk result entry
          </div>
          <h1 className="mt-1 font-heading text-3xl font-semibold">
            Pending Sample Results
          </h1>
        </div>

        <Button
          onClick={saveRecords}
          disabled={saving || dirtyRecords.size === 0}
          className="bg-blue-600 text-white"
        >
          <FloppyDisk size={16} className="mr-2" />
          {saving
            ? "Saving…"
            : `Save Records${
                dirtyRecords.size ? ` (${dirtyRecords.size})` : ""
              }`}
        </Button>
      </div>

      <Card className="border p-4 shadow-none">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Field label="Dataset">
            <select
              value={dataset}
              onChange={(event) => {
                setDataset(event.target.value);
                setTest("");
                setRecords([]);
              }}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">All Datasets</option>
              {datasets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Test">
            <select
              value={test}
              onChange={(event) => setTest(event.target.value)}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select test</option>
              {availableTests.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Apply Result">
            <select
              value={applyResult}
              onChange={(event) =>
                setApplyResult(event.target.value)
              }
              className="w-full rounded border bg-white p-2"
            >
              <option value="Positive">Positive</option>
              <option value="Negative">Negative</option>
              <option value="Indeterminate">Indeterminate</option>
            </select>
          </Field>

          <Field label="Result Date">
            <Input
              type="date"
              value={applyDate}
              onChange={(event) => setApplyDate(event.target.value)}
            />
          </Field>

          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={load}
              disabled={loading}
              className="flex-1"
            >
              {loading ? "Loading…" : "Load Pending"}
            </Button>
            <Button
              type="button"
              onClick={applyToSelected}
              disabled={!selectedRows.length}
              className="flex-1"
            >
              Apply to Selected
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500">
                <th className="px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? Object.fromEntries(
                              rows.map((row) => [row.key, true])
                            )
                          : {}
                      )
                    }
                  />
                </th>
                {[
                  "Lab #",
                  "EPID #",
                  "Date",
                  "Patient",
                  "Sample",
                  "Test",
                  "Result",
                  "Additional Result",
                  "Result Date",
                  "Test Remarks",
                ].map((heading) => (
                  <th key={heading} className="px-3 py-2">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr>
                  <td
                    colSpan={11}
                    className="p-10 text-center text-slate-500"
                  >
                    Select a test and load pending records.
                  </td>
                </tr>
              )}

              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-t ${
                    dirtyRecords.has(row.recordId)
                      ? "bg-amber-50/50"
                      : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={Boolean(selected[row.key])}
                      onCheckedChange={(checked) =>
                        setSelected((current) => ({
                          ...current,
                          [row.key]: Boolean(checked),
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.labNumber}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {shortEpid(row.epidNumber)}
                  </td>
                  <td className="px-3 py-2">
                    {displayDate(row.date)}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {row.name}
                  </td>
                  <td className="px-3 py-2">{row.sampleType}</td>
                  <td className="px-3 py-2">{row.testName}</td>
                  <td className="min-w-44 px-3 py-2">
                    <ResultEditor
                      value={row.result1}
                      onChange={(value) =>
                        updateRow(row, "result1", value)
                      }
                    />
                  </td>
                  <td className="min-w-44 px-3 py-2">
                    <Input
                      value={row.result2}
                      onChange={(event) =>
                        updateRow(
                          row,
                          "result2",
                          event.target.value
                        )
                      }
                    />
                  </td>
                  <td className="min-w-40 px-3 py-2">
                    <Input
                      type="date"
                      value={row.resultDate}
                      onChange={(event) =>
                        updateRow(
                          row,
                          "result_date",
                          event.target.value
                        )
                      }
                    />
                  </td>
                  <td className="min-w-56 px-3 py-2">
                    <Input
                      value={row.remarks}
                      onChange={(event) =>
                        updateRow(
                          row,
                          "remarks",
                          event.target.value
                        )
                      }
                    />
                  </td>
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
    <Label className="text-xs font-semibold uppercase text-slate-500">
      {label}
    </Label>
    <div className="mt-1.5">{children}</div>
  </div>
);

const ResultEditor = ({ value, onChange }) => {
  const standard = ["", "Positive", "Negative", "Indeterminate"];
  const custom = value && !standard.includes(value);

  if (custom) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <select
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded border bg-white p-2"
    >
      <option value="">Pending</option>
      <option value="Positive">Positive</option>
      <option value="Negative">Negative</option>
      <option value="Indeterminate">Indeterminate</option>
    </select>
  );
};
