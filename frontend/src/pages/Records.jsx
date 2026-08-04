import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { useNavigate } from "react-router-dom";
import {
  CaretDown,
  CaretUp,
  CaretUpDown,
  MagnifyingGlass,
  PencilSimple,
  Printer,
  Trash,
} from "@phosphor-icons/react";
import { TABLE } from "@/constants/testIds";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const displayDate = (value) => {
  if (!value || value === "—") return value || "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const EPID_DATASETS = new Set([
  "mr_surveillance",
  "diphtheria",
  "pertussis",
]);

const shortEpid = (value) => {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.length >= 4 ? parts.slice(-4).join(" ") : value || "—";
};

const day = (value) => {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const tat = (recordDate, resultDate) => {
  const start = day(recordDate);
  const end = day(resultDate);
  return start === null || end === null
    ? null
    : Math.round((end - start) / 86400000);
};

const resultText = (test) =>
  [test?.result1 || test?.result_1, test?.result2 || test?.result_2]
    .filter(Boolean)
    .join(" / ") || "Pending";

const normalizeSamples = (record) => {
  if (Array.isArray(record.samples) && record.samples.length) {
    return record.samples;
  }

  return [
    {
      id: "legacy",
      lab_number: record.lab_number || "",
      sample_type: record.sample_type || "",
      tests:
        Array.isArray(record.tests) && record.tests.length
          ? record.tests
          : [
              {
                test: record.test || "—",
                result1: record.results?.[0]?.name || "",
                result2: record.results?.[0]?.value || "",
                result_date: record.result_date || "",
              },
            ],
    },
  ];
};

const hasCompletedTests = (record) =>
  normalizeSamples(record).some((sample) =>
    (sample.tests || []).some(
      (test) =>
        String(test.result1 || test.result_1 || "").trim() ||
        String(test.result2 || test.result_2 || "").trim()
    )
  );

const openPrintReport = (recordId) => {
  window.open(
    `/reports/print?type=individual&id=${recordId}`,
    "_blank",
    "noopener,noreferrer"
  );
};

const rowsFor = (record) => {
  const rows = [];

  normalizeSamples(record).forEach((sample, sampleIndex) => {
    const tests =
      Array.isArray(sample.tests) && sample.tests.length
        ? sample.tests
        : [{ test: "—", result1: "", result2: "", result_date: "" }];

    tests.forEach((test, testIndex) => {
      const resultDate =
        test.result_date || test.resultDate || record.result_date || "";

      rows.push({
        key: `${record.id}-${sample.id || sampleIndex}-${test.id || testIndex}`,
        recordId: record.id,
        sampleId: sample.id || "",
        sampleIndex,
        testIndex,
        dataset: sample.dataset || record.dataset || "routine",
        labNumber: sample.lab_number || "",
        epidNumber: sample.epid_number || record.epid_number || "",
        sampleType: sample.sample_type || "—",
        test: test.test || test.name || "—",
        result: resultText(test),
        resultDate,
        tat: tat(record.date, resultDate),
      });
    });
  });

  return rows;
};

const resultSortRank = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized || normalized === "pending") return 0;
  if (normalized === "positive") return 1;
  if (normalized === "negative") return 2;
  if (normalized === "indeterminate") return 3;
  return 4;
};

const sortVal = (record, column) => {
  const rows = rowsFor(record);
  const first = rows[0] || {};

  if (column === "result") {
    // Use the highest-priority result anywhere in the record so a record
    // containing a pending test is brought to the top.
    return rows.length
      ? Math.min(...rows.map((row) => resultSortRank(row.result)))
      : resultSortRank("Pending");
  }

  return {
    lab_number: first.labNumber || "",
    epid_number: first.epidNumber || "",
    date: record.date || "",
    name: record.name || "",
    age: Number(record.age ?? -1),
    district: record.district || "",
    sample_type: first.sampleType || "",
    test: first.test || "",
    result_date: first.resultDate || "",
    tat: first.tat ?? Number.MAX_SAFE_INTEGER,
  }[column];
};

export default function Records() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState({
    column: "date",
    direction: "desc",
  });
  const [data, setData] = useState({
    items: [],
    total: 0,
    page_size: 10,
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/records", {
        params: {
          search: q || undefined,
          page,
          page_size: pageSize,
        },
      });
      setData(response.data);
    } catch {
      toast.error("Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [q, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...(data.items || [])].sort((a, b) => {
      const x = sortVal(a, sort.column);
      const y = sortVal(b, sort.column);
      let comparison;

      if (sort.column === "result") {
        comparison = Number(x) - Number(y);
      } else {
        comparison =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y), undefined, {
                numeric: true,
                sensitivity: "base",
              });
      }

      return comparison * direction;
    });
  }, [data.items, sort]);

  const toggle = (column) =>
    setSort((current) => ({
      column,
      direction:
        current.column === column
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : column === "result"
            ? "asc"
            : "asc",
    }));

  const del = async (id) => {
    try {
      await api.delete(`/records/${id}`);
      toast.success("Record deleted");
      scheduleDriveSync();
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const heads = [
    ["lab_number", "Lab #"],
    ["epid_number", "EPID #"],
    ["date", "Date"],
    ["name", "Name"],
    ["age", "Age"],
    ["district", "District"],
    ["sample_type", "Sample"],
    ["test", "Test"],
    ["result", "Result"],
    ["result_date", "Result Date"],
    ["tat", "TAT"],
  ];

  return (
    <div className="space-y-4" data-testid="records-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Line list
          </div>
          <h1 className="mt-1 font-heading text-3xl font-semibold text-slate-900">
            All Records
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Records per page
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded border bg-white p-2"
            >
              {[10, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <div className="relative">
            <MagnifyingGlass
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder="Search name or sample lab number"
              className="w-72 bg-white pl-9"
              value={q}
              onChange={(event) => {
                setPage(1);
                setQ(event.target.value);
              }}
            />
          </div>

          <Button
            onClick={() => nav("/entry")}
            className="bg-blue-600 hover:bg-blue-700"
          >
            New Record
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border border-slate-200 bg-white shadow-none">
        <div className="overflow-x-auto">
          <table data-testid={TABLE.root} className="zebra w-full text-sm">
            <thead className="sticky top-0 border-b bg-white">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {heads.map(([column, label]) => (
                  <th key={column} className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(column)}
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
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="text-slate-700">
              {loading && (
                <tr>
                  <td colSpan={12} className="p-6 text-center">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="p-10 text-center text-slate-500"
                  >
                    No records found.
                  </td>
                </tr>
              )}

              {!loading &&
                items.flatMap((record) => {
                  const rows = rowsFor(record);

                  const displayedRows =
                    sort.column === "result"
                      ? [...rows].sort((left, right) => {
                          const difference =
                            resultSortRank(left.result) -
                            resultSortRank(right.result);
                          return sort.direction === "asc"
                            ? difference
                            : -difference;
                        })
                      : rows;

                  return displayedRows.map((row, rowIndex) => {
                    const firstRecordRow = rowIndex === 0;
                    const previousRow =
                      rowIndex > 0 ? displayedRows[rowIndex - 1] : null;
                    const firstSampleRow =
                      !previousRow ||
                      previousRow.sampleId !== row.sampleId;

                    return (
                      <tr
                        key={row.key}
                        className="border-b hover:bg-blue-50/40"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {firstSampleRow ? row.labNumber : ""}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {firstSampleRow &&
                          EPID_DATASETS.has(row.dataset)
                            ? shortEpid(row.epidNumber)
                            : ""}
                        </td>
                        <td className="px-3 py-2">
                          {firstRecordRow ? displayDate(record.date) : ""}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {firstRecordRow ? record.name : ""}
                        </td>
                        <td className="px-3 py-2">
                          {firstRecordRow ? record.age ?? "—" : ""}
                        </td>
                        <td className="px-3 py-2">
                          {firstRecordRow ? record.district : ""}
                        </td>
                        <td className="px-3 py-2">
                          {firstSampleRow ? row.sampleType : ""}
                        </td>
                        <td className="px-3 py-2">{row.test}</td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              row.result === "Pending"
                                ? "font-medium text-amber-600"
                                : ""
                            }
                          >
                            {row.result}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {displayDate(row.resultDate)}
                        </td>
                        <td className="px-3 py-2">
                          {row.tat === null
                            ? "—"
                            : `${row.tat} day${row.tat === 1 ? "" : "s"}`}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {firstRecordRow && (
                            <div className="inline-flex">
                              <Button
                                variant="ghost"
                                size="icon"
                                title={
                                  hasCompletedTests(record)
                                    ? "Print completed tests"
                                    : "No completed tests to print"
                                }
                                disabled={!hasCompletedTests(record)}
                                onClick={() => openPrintReport(record.id)}
                              >
                                <Printer size={16} />
                              </Button>

                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => nav(`/entry/${record.id}`)}
                              >
                                <PencilSimple size={16} />
                              </Button>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="hover:text-red-600"
                                  >
                                    <Trash size={16} />
                                  </Button>
                                </AlertDialogTrigger>

                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Delete this patient record?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will delete all samples belonging to{" "}
                                      {record.name}. This action cannot be
                                      undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => del(record.id)}
                                      className="bg-red-600"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="text-xs text-slate-500">
            Showing {data.items.length} of {data.total} patient records · Page{" "}
            {page} / {pages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((current) => Math.min(pages, current + 1))
              }
              disabled={page >= pages}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
