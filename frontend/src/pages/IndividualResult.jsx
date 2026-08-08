import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { localDateValue, millisecondsUntilNextDay } from "@/lib/localDate";
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

const DATASET_ORDER = [
  "routine",
  "mr_surveillance",
  "diphtheria",
  "pertussis",
  "rabies",
  "fla",
  "special_serology",
  "typhoid_surveillance",
];

const sortDatasets = (items) => {
  const rank = new Map(
    DATASET_ORDER.map((key, index) => [key, index])
  );

  return [...items].sort((a, b) => {
    const aRank = rank.has(a.key) ? rank.get(a.key) : 999;
    const bRank = rank.has(b.key) ? rank.get(b.key) : 999;

    if (aRank !== bRank) return aRank - bRank;
    return String(a.label).localeCompare(String(b.label));
  });
};

const RESULT_OPTIONS = ["Positive", "Negative", "Indeterminate"];

const displayDate = (value) => {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const shortEpid = (value) => {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.length >= 4 ? parts.slice(-4).join(" ") : value || "—";
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
          epidNumber: sample.epid_number || record.epid_number || "",
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
    epidNumber: row.epidNumber,
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
  const [panelsByDataset, setPanelsByDataset] = useState({});
  const [panelSampleKey, setPanelSampleKey] = useState("");
  const [panelId, setPanelId] = useState("");
  const [panelResultDate, setPanelResultDate] = useState(
    localDateValue()
  );
  const [panelRemarks, setPanelRemarks] = useState("");
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

  useEffect(() => {
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setPanelResultDate(localDateValue());
        schedule();
      }, millisecondsUntilNextDay());
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

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
          ? [
              { key: "", label: "All Datasets" },
              ...sortDatasets(normalizedDatasets),
            ]
          : FALLBACK_DATASETS
      );
      setPanelsByDataset(
        optionsResponse.data?.panels_by_dataset || {}
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

  const panelSampleOptions = useMemo(() => {
    const seen = new Set();
    const options = [];

    records.forEach((record) => {
      (record.samples || []).forEach((sample, sampleIndex) => {
        const sampleDataset =
          sample.dataset || record.dataset || "routine";

        if (dataset && sampleDataset !== dataset) return;
        if (!(sample.assigned_panels || []).length) return;

        const hasPendingPanelTest = (
          sample.assigned_panels || []
        ).some((assignment) =>
          (sample.tests || []).some((test, testIndex) => {
            const rowKey = `${record.id}::${
              sample.id || sampleIndex
            }::${test.id || testIndex}`;
            return (
              (assignment.tests || []).includes(test.test) &&
              pendingKeys.has(rowKey)
            );
          })
        );

        if (!hasPendingPanelTest) return;

        const key = `${record.id}::${sample.id || sampleIndex}`;
        if (seen.has(key)) return;
        seen.add(key);

        options.push({
          key,
          recordId: record.id,
          sampleId: sample.id,
          sampleIndex,
          dataset: sampleDataset,
          labNumber: sample.lab_number || "",
          name: record.name || "",
          sampleType: sample.sample_type || "",
          assignedPanels: sample.assigned_panels || [],
        });
      });
    });

    return options.sort((a, b) =>
      `${a.name} ${a.labNumber}`.localeCompare(
        `${b.name} ${b.labNumber}`,
        undefined,
        { numeric: true, sensitivity: "base" }
      )
    );
  }, [records, dataset]);

  const selectedPanelSample = panelSampleOptions.find(
    (item) => item.key === panelSampleKey
  );

  const availablePanels = useMemo(() => {
    if (!selectedPanelSample) return [];

    const record = records.find(
      (item) => item.id === selectedPanelSample.recordId
    );
    const sample =
      record?.samples?.[selectedPanelSample.sampleIndex];

    if (!sample) return [];

    const unique = new Map();

    (selectedPanelSample.assignedPanels || []).forEach(
      (assignment) => {
        const hasPending = (sample.tests || []).some((test, testIndex) => {
          const rowKey = `${record.id}::${
            sample.id || selectedPanelSample.sampleIndex
          }::${test.id || testIndex}`;
          return (
            (assignment.tests || []).includes(test.test) &&
            pendingKeys.has(rowKey)
          );
        });

        if (!hasPending) return;
        if (!assignment.panel_id || unique.has(assignment.panel_id)) {
          return;
        }

        unique.set(assignment.panel_id, {
          id: assignment.panel_id,
          name: assignment.panel_name,
          tests: assignment.tests || [],
        });
      }
    );

    return [...unique.values()].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, {
        sensitivity: "base",
      })
    );
  }, [selectedPanelSample, records]);

  useEffect(() => {
    if (
      panelId &&
      !availablePanels.some((panel) => panel.id === panelId)
    ) {
      setPanelId("");
    }
  }, [availablePanels, panelId]);

  const markAllNegative = () => {
    if (!selectedPanelSample) {
      toast.error("Select a sample");
      return;
    }

    const panel = availablePanels.find(
      (item) => item.id === panelId
    );
    if (!panel) {
      toast.error("Select a test panel");
      return;
    }

    const panelTests = new Set(panel.tests || []);
    const targetRecord = records.find(
      (record) => record.id === selectedPanelSample.recordId
    );
    const targetSample =
      targetRecord?.samples?.[selectedPanelSample.sampleIndex];

    if (!targetSample) {
      toast.error("The selected sample could not be found");
      return;
    }

    const matchingTestIndexes = [];

    (targetSample.tests || []).forEach((test, testIndex) => {
      const rowKey = `${targetRecord.id}::${
        targetSample.id || selectedPanelSample.sampleIndex
      }::${test.id || testIndex}`;

      const currentResult1 = String(test.result1 || "").trim();
      const currentResult2 = String(test.result2 || "").trim();

      if (
        pendingKeys.has(rowKey) &&
        panelTests.has(test.test) &&
        !currentResult1 &&
        !currentResult2
      ) {
        matchingTestIndexes.push(testIndex);
      }
    });

    if (!matchingTestIndexes.length) {
      toast.info("No blank pending tests from this panel were found");
      return;
    }

    setRecords((current) =>
      current.map((record) => {
        if (record.id !== selectedPanelSample.recordId) {
          return record;
        }

        const next = structuredClone(record);
        const sample = next.samples[selectedPanelSample.sampleIndex];

        matchingTestIndexes.forEach((testIndex) => {
          const test = sample.tests[testIndex];
          test.result1 = "Negative";
          test.result_date =
            panelResultDate ||
            localDateValue();

          if (panelRemarks.trim()) {
            test.remarks = panelRemarks.trim();
          }
        });

        return next;
      })
    );

    setDirtyRecords((current) => {
      const next = new Set(current);
      next.add(selectedPanelSample.recordId);
      return next;
    });

    toast.success(
      `Negative applied to ${matchingTestIndexes.length} blank pending panel test${
        matchingTestIndexes.length === 1 ? "" : "s"
      }. Existing positive or other entered results were not changed.`
    );
  };

  const selectedPanel = availablePanels.find(
    (item) => item.id === panelId
  );

  const selectedPanelTests = new Set(selectedPanel?.tests || []);

  const orderedRows = useMemo(() => {
    if (!selectedPanelSample) return rows;

    return [...rows].sort((left, right) => {
      const leftSelected =
        left.recordId === selectedPanelSample.recordId &&
        left.sampleIndex === selectedPanelSample.sampleIndex;
      const rightSelected =
        right.recordId === selectedPanelSample.recordId &&
        right.sampleIndex === selectedPanelSample.sampleIndex;

      if (leftSelected !== rightSelected) {
        return leftSelected ? -1 : 1;
      }

      if (leftSelected && panelId) {
        const leftPanel = selectedPanelTests.has(left.testName);
        const rightPanel = selectedPanelTests.has(right.testName);
        if (leftPanel !== rightPanel) return leftPanel ? -1 : 1;
      }

      return 0;
    });
  }, [
    rows,
    selectedPanelSample,
    panelId,
    selectedPanel?.id,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(orderedRows.length / pageSize)
  );
  const visibleRows = orderedRows.slice(
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

  const quantitativeTests = new Set([
    "Hepatitis B Virus quantitation",
    "Hepatitis C Virus quantitation",
    "Cytomegalovirus quantitation",
  ]);

  const normalizeAdditionalResult = (testName, value) => {
    const text = String(value || "").trim();
    if (
      text &&
      quantitativeTests.has(testName) &&
      /^-?\d+(?:\.\d+)?$/.test(text)
    ) {
      return `${text} IU/ml`;
    }
    return text;
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
          test.result_date = localDateValue();
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
    ["epidNumber", "EPID #"],
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

      <Card className="border border-slate-200 bg-white p-4 shadow-none">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
            Panel Result Tools
          </div>
          <p className="text-xs text-slate-500">
            Mark only blank pending tests in the selected panel as Negative.
            Enter Positive or another exception directly in the relevant test row.
          </p>
        </div>

        {selectedPanelSample && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <span className="font-semibold">Currently selected: </span>
            {selectedPanelSample.name} · {selectedPanelSample.labNumber} ·{" "}
            {selectedPanelSample.sampleType}
            {selectedPanel ? ` · Panel: ${selectedPanel.name}` : ""}
            {selectedPanel
              ? ` · ${selectedPanel.tests?.length || 0} tests`
              : ""}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
          <Field label="Patient Sample">
            <select
              value={panelSampleKey}
              onChange={(event) => {
                setPanelSampleKey(event.target.value);
                setPanelId("");
                setPage(1);
              }}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select sample</option>
              {panelSampleOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.labNumber} · {item.name} · {item.sampleType} ·{" "}
                  {datasets.find(
                    (datasetItem) =>
                      datasetItem.key === item.dataset
                  )?.label || item.dataset}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Test Panel">
            <select
              value={panelId}
              onChange={(event) => {
                setPanelId(event.target.value);
                setPage(1);
              }}
              disabled={!selectedPanelSample}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select panel</option>
              {availablePanels.map((panel) => (
                <option key={panel.id} value={panel.id}>
                  {panel.name} ({panel.tests?.length || 0} tests)
                </option>
              ))}
            </select>
          </Field>

          <Field label="Result Date">
            <Input
              type="date"
              value={panelResultDate}
              onChange={(event) =>
                setPanelResultDate(event.target.value)
              }
            />
          </Field>

          <Field label="Remarks">
            <Input
              value={panelRemarks}
              onChange={(event) => setPanelRemarks(event.target.value)}
              placeholder="Optional"
            />
          </Field>

          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              onClick={markAllNegative}
              disabled={!panelId}
              className="w-full"
            >
              Mark All Negative
            </Button>
          </div>
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
                  <td colSpan={13} className="p-8 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="p-10 text-center text-slate-500">
                    No pending results found for the selected dataset or search.
                  </td>
                </tr>
              )}

              {!loading &&
                visibleRows.map((row) => (
                  <tr
                    key={row.key}
                    className={`border-b border-slate-100 ${
                      selectedPanelSample &&
                      row.recordId === selectedPanelSample.recordId &&
                      row.sampleIndex === selectedPanelSample.sampleIndex &&
                      selectedPanelTests.has(row.testName)
                        ? "bg-blue-100 ring-1 ring-inset ring-blue-300"
                        : selectedPanelSample &&
                            row.recordId === selectedPanelSample.recordId &&
                            row.sampleIndex === selectedPanelSample.sampleIndex
                          ? "bg-blue-50/60"
                          : "hover:bg-blue-50/40"
                    } ${
                      dirtyRecords.has(row.recordId)
                        ? "bg-amber-50/40"
                        : ""
                    }`}
                  >
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
                    <td className="px-3 py-2">{row.age || "—"}</td>
                    <td className="px-3 py-2">{row.district}</td>
                    <td className="px-3 py-2">{row.sampleType}</td>
                    <td className="px-3 py-2 font-medium">{row.testName}</td>
                    <td className="min-w-48 px-3 py-2">
                      <ResultEditor
                        value={row.result1}
                        onChange={(value) =>
                          updateRow(row, "result1", value)
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


const ResultEditor = ({ value, onChange }) => {
  const standard = ["", "Positive", "Negative", "Indeterminate"];
  const isCustom = value && !standard.includes(value);
  const [custom, setCustom] = React.useState(isCustom);

  React.useEffect(() => {
    setCustom(Boolean(value && !standard.includes(value)));
  }, [value]);

  if (custom) {
    return (
      <div className="flex gap-1">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter result"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCustom(false);
            onChange("");
          }}
        >
          List
        </Button>
      </div>
    );
  }

  return (
    <select
      value={standard.includes(value) ? value : ""}
      onChange={(event) => {
        if (event.target.value === "__custom__") {
          setCustom(true);
          onChange("");
        } else {
          onChange(event.target.value);
        }
      }}
      className="w-full rounded border bg-white p-2"
    >
      <option value="">Pending</option>
      <option value="Positive">Positive</option>
      <option value="Negative">Negative</option>
      <option value="Indeterminate">Indeterminate</option>
      <option value="__custom__">Other / custom</option>
    </select>
  );
};
