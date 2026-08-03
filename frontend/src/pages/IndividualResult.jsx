import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CaretDown,
  CaretUp,
  CaretUpDown,
  FloppyDisk,
  MagnifyingGlass,
  ArrowClockwise,
} from "@phosphor-icons/react";

const FALLBACK_DATASETS = [
  { key: "", label: "All Datasets" },
  { key: "routine", label: "Routine" },
  { key: "mr_surveillance", label: "MR Surveillance" },
  { key: "diphtheria", label: "Diphtheria" },
  { key: "pertussis", label: "Pertussis" },
  { key: "rabies", label: "Rabies" },
  { key: "fla", label: "FLA" },
  { key: "special_serology", label: "Special Serology" },
  { key: "typhoid_surveillance", label: "Typhoid Surveillance" },
];

const RESULT_OPTIONS = ["Positive", "Negative", "Indeterminate"];

const displayDate = (value) => {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const resultText = (test) =>
  [test?.result1, test?.result2].filter(Boolean).join(" / ") || "Pending";

const flattenRecords = (records, pendingKeys) => {
  const rows = [];

  records.forEach((record) => {
    (record.samples || []).forEach((sample, sampleIndex) => {
      (sample.tests || []).forEach((test, testIndex) => {
        const key = `${record.id}::${sample.id || sampleIndex}::${
          test.id || testIndex
        }`;

        if (!pendingKeys.has(key)) return;

        rows.push({
          key,
          recordId: record.id,
          sampleId: sample.id,
          sampleIndex,
          testIndex,
          dataset: sample.dataset || record.dataset || "routine",
          labNumber: sample.lab_number || "",
          date: record.date || "",
          name: record.name || "",
          age: record.age ?? "",
          sex: record.sex || "",
          district: record.district || "",
          sampleType: sample.sample_type || "",
          testName: test.test || "",
          result1: test.result1 || "",
          result2: test.result2 || "",
          resultDate: test.result_date || "",
          testRemarks: test.remarks || "",
          recordRemarks: record.remarks || "",
          status: resultText(test),
        });
      });
    });
  });

  return rows;
};

const sortValue = (row, column) => {
  const values = {
    labNumber: row.labNumber,
    date: row.date,
    name: row.name,
    age: Number(row.age || -1),
    district: row.district,
    sampleType: row.sampleType,
    testName: row.testName,
    result1: row.result1,
    resultDate: row.resultDate,
  };
  return values[column] ?? "";
};

export default function IndividualResult() {
  const [dataset, setDataset] = useState("");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState([]);
  const [datasets, setDatasets] = useState(FALLBACK_DATASETS);
  const [pendingKeys, setPendingKeys] = useState(new Set());
  const [dirtyRecords, setDirtyRecords] = useState(new Set());
  const [sort, setSort] = useState({
    column: "date",
    direction: "desc",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const [recordsResponse, optionsResponse] = await Promise.all([
        api.get("/records", {
          params: {
            search: query.trim() || undefined,
            pending: true,
            page: 1,
            page_size: 500,
          },
        }),
        api.get("/options"),
      ]);

      const loadedRecords = recordsResponse.data?.items || [];
      setRecords(loadedRecords);

      const rawDatasets =
        optionsResponse.data?.datasets ||
        optionsResponse.data?.dataset ||
        [];

      const normalizedDatasets = rawDatasets
        .map((item) => {
          if (typeof item === "string") {
            return { key: item, label: item };
          }

          return {
            key: item.key || item.value || "",
            label:
              item.name ||
              item.label ||
              item.value ||
              item.key ||
              "",
          };
        })
        .filter((item) => item.key && item.label);

      setDatasets(
        normalizedDatasets.length
          ? [{ key: "", label: "All Datasets" }, ...normalizedDatasets]
          : FALLBACK_DATASETS
      );

      const keys = new Set();

      loadedRecords.forEach((record) => {
        (record.samples || []).forEach((sample, sampleIndex) => {
          (sample.tests || []).forEach((test, testIndex) => {
            const result1 = String(test.result1 || "").trim();
            const result2 = String(test.result2 || "").trim();

            if (!result1 && !result2) {
              keys.add(
                `${record.id}::${sample.id || sampleIndex}::${
                  test.id || testIndex
                }`
              );
            }
          });
        });
      });

      setPendingKeys(keys);
      setDirtyRecords(new Set());
      setPage(1);
    } catch {
      toast.error("Failed to load pending records");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;

    return flattenRecords(records, pendingKeys)
      .filter((row) => !dataset || row.dataset === dataset)
      .sort((a, b) => {
      const x = sortValue(a, sort.column);
      const y = sortValue(b, sort.column);

      const comparison =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, {
              numeric: true,
              sensitivity: "base",
            });

        return comparison * direction;
      });
  }, [records, pendingKeys, dataset, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const toggleSort = (column) => {
    setSort((current) => ({
      column,
      direction:
        current.column === column && current.direction === "asc"
          ? "desc"
          : "asc",
    }));
  };

  const updateRow = (row, field, value) => {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== row.recordId) return record;

        const next = structuredClone(record);
        const test = next.samples[row.sampleIndex].tests[row.testIndex];

        test[field] = value;

        if (
          (field === "result1" || field === "result2") &&
          value &&
          !test.result_date
        ) {
          test.result_date = new Date().toISOString().slice(0, 10);
        }

        return next;
      })
    );

    setDirtyRecords((current) => {
      const next = new Set(current);
      next.add(row.recordId);
      return next;
    });
  };

  const saveChanges = async () => {
    if (dirtyRecords.size === 0) {
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
          results: firstTests.map((test) => ({
            name: test.result1 || "",
            value: test.result2 || "",
          })),
        });
      }

      scheduleDriveSync();

      const savedIds = new Set(changed.map((record) => record.id));

      setPendingKeys((current) => {
        const next = new Set(current);

        rows.forEach((row) => {
          if (!savedIds.has(row.recordId)) return;

          const record = records.find(
            (item) => item.id === row.recordId
          );
          const test =
            record?.samples?.[row.sampleIndex]?.tests?.[row.testIndex];

          if (
            String(test?.result1 || "").trim() ||
            String(test?.result2 || "").trim()
          ) {
            next.delete(row.key);
          }
        });

        return next;
      });

      setDirtyRecords(new Set());
      toast.success(
        `Saved changes for ${changed.length} patient record${
          changed.length === 1 ? "" : "s"
        }`
      );
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || "Failed to save results"
      );
    } finally {
      setSaving(false);
    }
  };

  const headers = [
    ["labNumber", "Lab #"],
    ["date", "Date"],
    ["name", "Patient Name"],
    ["age", "Age"],
    ["district", "District"],
    ["sampleType", "Sample"],
    ["testName", "Test"],
    ["result1", "Result"],
    ["resultDate", "Result Date"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Fast result entry
          </div>
          <h1 className="mt-1 font-heading text-3xl font-semibold text-slate-900">
            Individual Result Entry
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Rows per page
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded border bg-white p-2"
            >
              {[25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <ArrowClockwise size={16} className="mr-2" />
            Refresh
          </Button>

          <Button
            type="button"
            onClick={saveChanges}
            disabled={saving || dirtyRecords.size === 0}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            <FloppyDisk size={16} className="mr-2" />
            {saving
              ? "Saving…"
              : `Save Changes${
                  dirtyRecords.size ? ` (${dirtyRecords.size})` : ""
                }`}
          </Button>
        </div>
      </div>

      <Card className="border border-slate-200 bg-white p-4 shadow-none">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
            Dataset
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {datasets.map((item) => (
              <button
                type="button"
                key={item.key || "all"}
                onClick={() => {
                  setDataset(item.key);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                  dataset === item.key
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mt-4">
          <MagnifyingGlass
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") load();
            }}
            placeholder="Search by patient name, lab number, patient ID or EPID number"
            className="pl-9"
          />
        </div>
      </Card>

      <Card className="overflow-hidden border border-slate-200 bg-white shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {headers.map(([column, label]) => (
                  <th key={column} className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1 hover:text-blue-600"
                    >
                      {label}
                      {sort.column !== column ? (
                        <CaretUpDown size={12} />
                      ) : sort.direction === "asc" ? (
                        <CaretUp size={12} />
                      ) : (
                        <CaretDown size={12} />
                      )}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2">Additional Result</th>
                <th className="px-3 py-2">Test Remarks</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>

            <tbody className="text-slate-700">
              {loading && (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-10 text-center text-slate-500">
                    No pending results found for the selected dataset or search.
                  </td>
                </tr>
              )}

              {!loading &&
                visibleRows.map((row) => (
                  <tr
                    key={row.key}
                    className={`border-b border-slate-100 hover:bg-blue-50/40 ${
                      dirtyRecords.has(row.recordId)
                        ? "bg-amber-50/40"
                        : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-900">
                      {row.labNumber}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayDate(row.date)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {row.name}
                    </td>
                    <td className="px-3 py-2">{row.age || "—"}</td>
                    <td className="px-3 py-2">{row.district}</td>
                    <td className="px-3 py-2">{row.sampleType}</td>
                    <td className="px-3 py-2 font-medium">{row.testName}</td>
                    <td className="min-w-48 px-3 py-2">
                      <Input
                        list="individual-result-options"
                        value={row.result1}
                        onChange={(event) =>
                          updateRow(
                            row,
                            "result1",
                            event.target.value
                          )
                        }
                        placeholder="Select or type"
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
                        placeholder="Optional"
                      />
                    </td>
                    <td className="min-w-52 px-3 py-2">
                      <Input
                        value={row.testRemarks}
                        onChange={(event) =>
                          updateRow(
                            row,
                            "remarks",
                            event.target.value
                          )
                        }
                        placeholder="Optional"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.status === "Pending"
                            ? "font-medium text-amber-600"
                            : "text-emerald-700"
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">
            Showing {visibleRows.length} of {rows.length} test rows · Page{" "}
            {page} / {totalPages}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((current) => Math.max(1, current - 1))
              }
              disabled={page === 1}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((current) =>
                  Math.min(totalPages, current + 1)
                )
              }
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <datalist id="individual-result-options">
        {RESULT_OPTIONS.map((result) => (
          <option key={result} value={result} />
        ))}
      </datalist>
    </div>
  );
}
