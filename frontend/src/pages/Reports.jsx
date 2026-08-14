import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ArrowCounterClockwise,
  CloudArrowUp,
  FileCsv,
  FilePdf,
  Funnel,
  MagnifyingGlass,
  MicrosoftExcelLogo,
  Printer,
} from "@phosphor-icons/react";
import {
  uploadBlobToDrive,
  isDriveConfigured,
} from "@/lib/drive";

const ANY = "__any__";

const fmt = (value) => {
  if (!value || value === "—") return value || "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const emptyFilters = {
  dataset: ANY,
  test: ANY,
  district: ANY,
  sample_type: ANY,
  result_contains: "",
  date_from: "",
  date_to: "",
};

const allSampleTests = (record) => {
  if (record.samples?.length) {
    return record.samples.flatMap((sample, sampleIndex) =>
      (sample.tests || []).map((test, testIndex) => ({
        key: `${record.id}-${sample.id || sampleIndex}-${test.id || testIndex}`,
        dataset: sample.dataset || record.dataset,
        lab_number: sample.lab_number || record.lab_number,
        epid_number: sample.epid_number || record.epid_number,
        sample_type: sample.sample_type || record.sample_type,
        sample_remarks: sample.remarks || "",
        test: test.test || "—",
        result1: test.result1 || "",
        result2: test.result2 || "",
        test_remarks: test.remarks || "",
        panel_ids: (sample.assigned_panels || [])
          .filter((panel) =>
            (panel.tests || []).includes(test.test)
          )
          .map((panel) => panel.panel_id),
        panel_names: (sample.assigned_panels || [])
          .filter((panel) =>
            (panel.tests || []).includes(test.test)
          )
          .map((panel) => panel.panel_name),
        result:
          [test.result1, test.result2].filter(Boolean).join(" / ") ||
          "Pending",
        result_date: test.result_date || "—",
        completed: Boolean(
          String(test.result1 || "").trim() ||
            String(test.result2 || "").trim()
        ),
      }))
    );
  }

  return (record.tests?.length ? record.tests : []).map(
    (test, index) => ({
      key: `${record.id}-${index}`,
      dataset: record.dataset,
      lab_number: record.lab_number,
      epid_number: record.epid_number,
      sample_type: record.sample_type,
      sample_remarks: "",
      test: test.test || "—",
      result1: test.result1 || "",
      result2: test.result2 || "",
      test_remarks: test.remarks || "",
      panel_ids: [],
      panel_names: [],
      result:
        [test.result1, test.result2].filter(Boolean).join(" / ") ||
        "Pending",
      result_date: test.result_date || record.result_date || "—",
      completed: Boolean(
        String(test.result1 || "").trim() ||
          String(test.result2 || "").trim()
      ),
    })
  );
};

export default function Reports() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(
    () => localStorage.getItem("mds_reports_tab") || "individual"
  );
  const [opts, setOpts] = useState({
    datasets: [],
    test: [],
    tests_by_dataset: {},
    district: [],
    sample_type: [],
  });
  const [filters, setFilters] = useState(emptyFilters);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState([]);
  const [tat, setTat] = useState({ points: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [individualSearch, setIndividualSearch] = useState("");
  const [individualItems, setIndividualItems] = useState([]);
  const [individualDataset, setIndividualDataset] = useState("");
  const [individualSort, setIndividualSort] = useState({
    column: "date",
    direction: "desc",
  });
  const [individualPage, setIndividualPage] = useState(1);
  const [individualPageSize, setIndividualPageSize] = useState(50);
  const [consolidatedTemplate, setConsolidatedTemplate] =
    useState("generic");
  const [consolidatedTests, setConsolidatedTests] = useState([]);
  const [consolidatedPanel, setConsolidatedPanel] = useState("");
  const [consolidatedSpecimen, setConsolidatedSpecimen] = useState("");
  const [individualReportRemarks, setIndividualReportRemarks] =
    useState("");
  const [consolidatedReportRemarks, setConsolidatedReportRemarks] =
    useState("");
  const [selectedConsolidatedRows, setSelectedConsolidatedRows] =
    useState({});
  const [consolidatedSort, setConsolidatedSort] = useState({
    column: "name",
    direction: "asc",
  });
  const [tatThresholds, setTatThresholds] = useState([]);

  useEffect(() => {
    localStorage.setItem("mds_reports_tab", tab);
  }, [tab]);

  useEffect(() => {
    Promise.all([
      api.get("/options"),
      api.get("/tat-thresholds"),
    ])
      .then(([optionsResponse, thresholdResponse]) => {
        setOpts(optionsResponse.data);
        setTatThresholds(thresholdResponse.data || []);
      })
      .catch(() => {});
  }, []);

  const datasets = opts.datasets || opts.dataset || [];
  const availableTests =
    filters.dataset !== ANY &&
    opts.tests_by_dataset?.[filters.dataset]
      ? opts.tests_by_dataset[filters.dataset]
      : opts.test || [];

  const params = () => {
    const values = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== ANY) values[key] = value;
    });
    return values;
  };

  const run = async () => {
    setLoading(true);

    try {
      if (tab === "individual") {
        const response = await api.get("/records", {
          params: {
            search: individualSearch.trim() || undefined,
            page: 1,
            page_size: 200,
          },
        });

        const completed = (response.data.items || []).filter((record) =>
          allSampleTests(record).some((row) => row.completed)
        );
        setIndividualItems(completed);
      } else if (tab === "district") {
        const response = await api.get("/records", {
          params: {
            ...params(),
            page: 1,
            page_size: 250,
          },
        });
        setItems(response.data.items || []);
        setTotal(response.data.total || 0);
      } else if (tab === "filtered") {
        const response = await api.get("/records", {
          params: {
            ...params(),
            page: 1,
            page_size: 250,
          },
        });
        setItems(response.data.items || []);
        setTotal(response.data.total || 0);
      } else if (tab === "statistics") {
        const response = await api.get("/reports/test-statistics", {
          params: {
            date_from: filters.date_from || undefined,
            date_to: filters.date_to || undefined,
            dataset:
              filters.dataset !== ANY
                ? filters.dataset
                : undefined,
            district:
              filters.district !== ANY
                ? filters.district
                : undefined,
          },
        });
        setStats(response.data.items || []);
      } else {
        const response = await api.get("/reports/tat", {
          params: {
            date_from: filters.date_from || undefined,
            date_to: filters.date_to || undefined,
            dataset:
              filters.dataset !== ANY
                ? filters.dataset
                : undefined,
            test:
              filters.test !== ANY ? filters.test : undefined,
            district:
              filters.district !== ANY
                ? filters.district
                : undefined,
          },
        });
        setTat(response.data || { points: [], summary: {} });
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || "Failed to run report"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Consolidated and filtered reports can contain large record sets.
    // They load only after the user clicks Apply, which prevents a large
    // network request simply by opening the tab.
    if (tab === "district" || tab === "filtered") {
      setLoading(false);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const exportFile = async (format) => {
    try {
      const response = await api.get("/export", {
        params: { ...params(), format },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `MDS_LIMS_records.${
        format === "xlsx" ? "xlsx" : "csv"
      }`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  const saveToDrive = async () => {
    if (!isDriveConfigured()) {
      toast.error("Google Drive is not configured");
      return;
    }

    try {
      const response = await api.get("/export", {
        params: { ...params(), format: "xlsx" },
        responseType: "blob",
      });
      const name = `MDS_LIMS_Report_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.xlsx`;

      await uploadBlobToDrive(
        response.data,
        name,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      toast.success("Report saved to Google Drive");
    } catch (error) {
      toast.error(error.message || "Drive upload failed");
    }
  };

  const openIndividualReport = (recordId) => {
    const query = new URLSearchParams({
      type: "individual",
      id: recordId,
    });

    if (individualReportRemarks.trim()) {
      query.set(
        "report_remarks",
        individualReportRemarks.trim()
      );
    }

    navigate(`/reports/print?${query.toString()}`);
  };

  const openDistrictReport = () => {
    const query = new URLSearchParams({
      type: "district",
    });

    if (filters.district !== ANY) {
      query.set("district", filters.district);
    }

    if (filters.dataset !== ANY) {
      query.set("dataset", filters.dataset);
    }
    if (filters.date_from) query.set("date_from", filters.date_from);
    if (filters.date_to) query.set("date_to", filters.date_to);
    if (consolidatedTemplate) {
      query.set("template", consolidatedTemplate);
    }
    if (consolidatedTests.length) query.set("tests", consolidatedTests.join(","));
    if (consolidatedPanel) query.set("panel", consolidatedPanel);
    if (consolidatedSpecimen) {
      query.set("specimen", consolidatedSpecimen);
    }

    localStorage.setItem(
      "mds_consolidated_report_payload",
      JSON.stringify({
        selectedRows: Object.keys(selectedConsolidatedRows).filter(
          (key) => selectedConsolidatedRows[key]
        ),
      })
    );

    if (consolidatedReportRemarks.trim()) {
      query.set(
        "report_remarks",
        consolidatedReportRemarks.trim()
      );
    }

    window.open(
      `/reports/print?${query.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const tabs = [
    ["individual", "Individual Patient Report"],
    ["district", "Consolidated Reports"],
    ["filtered", "Filtered Reports & Export"],
    ["statistics", "Test Statistics"],
    ["tat", "TAT Graph"],
    ["tat_report", "TAT Report"],
  ];

  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500">
          Reports
        </div>
        <h1 className="font-heading text-2xl font-semibold leading-tight">
          Reports & Analysis
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(([value, label]) => (
          <Button
            key={value}
            variant={tab === value ? "default" : "outline"}
            onClick={() => setTab(value)}
            className={tab === value ? "bg-blue-600" : ""}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "individual" ? (
        <IndividualReportSearch
          search={individualSearch}
          setSearch={setIndividualSearch}
          run={run}
          loading={loading}
          records={individualItems}
          datasets={datasets}
          selectedDataset={individualDataset}
          setSelectedDataset={(value) => {
            setIndividualDataset(value);
            setIndividualPage(1);
          }}
          sort={individualSort}
          setSort={setIndividualSort}
          page={individualPage}
          setPage={setIndividualPage}
          pageSize={individualPageSize}
          setPageSize={(value) => {
            setIndividualPageSize(value);
            setIndividualPage(1);
          }}
          openReport={openIndividualReport}
          reportRemarks={individualReportRemarks}
          setReportRemarks={setIndividualReportRemarks}
        />
      ) : (
        <>
          <FilterCard
            tab={tab}
            filters={filters}
            setFilters={setFilters}
            datasets={datasets}
            availableTests={availableTests}
            opts={opts}
            run={run}
            exportFile={exportFile}
            saveToDrive={saveToDrive}
            openDistrictReport={openDistrictReport}
            consolidatedTemplate={consolidatedTemplate}
            setConsolidatedTemplate={setConsolidatedTemplate}
            consolidatedTests={consolidatedTests}
            setConsolidatedTests={setConsolidatedTests}
            consolidatedPanel={consolidatedPanel}
            setConsolidatedPanel={setConsolidatedPanel}
            consolidatedSpecimen={consolidatedSpecimen}
            setConsolidatedSpecimen={setConsolidatedSpecimen}
          />

          {loading ? (
            <Card className="p-10 text-center">Loading…</Card>
          ) : tab === "district" ? (
            <DistrictPreview
              items={items}
              total={total}
              filters={filters}
              datasets={datasets}
              print={openDistrictReport}
              template={consolidatedTemplate}
              selectedTests={consolidatedTests}
              selectedPanel={consolidatedPanel}
              selectedSpecimen={consolidatedSpecimen}
              panels={opts.panels || []}
              selectedRows={selectedConsolidatedRows}
              setSelectedRows={setSelectedConsolidatedRows}
              reportRemarks={consolidatedReportRemarks}
              setReportRemarks={setConsolidatedReportRemarks}
              consolidatedSort={consolidatedSort}
              setConsolidatedSort={setConsolidatedSort}
            />
          ) : tab === "filtered" ? (
            <Filtered
              items={items}
              total={total}
              filters={filters}
              datasets={datasets}
            />
          ) : tab === "statistics" ? (
            <Statistics items={stats} />
          ) : tab === "tat_report" ? (
            <TatReport
              data={tat}
              thresholds={tatThresholds}
              selectedDataset={
                filters.dataset !== ANY
                  ? filters.dataset
                  : ""
              }
              datasets={datasets}
            />
          ) : (
            <Tat data={tat} />
          )}
        </>
      )}
    </div>
  );
}

function IndividualReportSearch({
  search,
  setSearch,
  run,
  loading,
  records,
  datasets,
  selectedDataset,
  setSelectedDataset,
  sort,
  setSort,
  page,
  setPage,
  pageSize,
  setPageSize,
  openReport,
  reportRemarks,
  setReportRemarks,
}) {
  const datasetOrder = [
    "routine",
    "mr_surveillance",
    "diphtheria",
    "pertussis",
    "rabies",
    "fla",
    "special_serology",
    "typhoid_surveillance",
  ];

  const orderedDatasets = [...datasets].sort((a, b) => {
    const aIndex = datasetOrder.indexOf(a.key);
    const bIndex = datasetOrder.indexOf(b.key);
    const aRank = aIndex < 0 ? 999 : aIndex;
    const bRank = bIndex < 0 ? 999 : bIndex;
    return aRank - bRank || String(a.name).localeCompare(String(b.name));
  });

  const rows = records
    .map((record) => {
      const completed = allSampleTests(record).filter(
        (row) =>
          row.completed &&
          (!selectedDataset || row.dataset === selectedDataset)
      );

      if (!completed.length) return null;

      return {
        record,
        completed,
        labNumbers: [
          ...new Set(
            completed.map((row) => row.lab_number).filter(Boolean)
          ),
        ],
        epidNumbers: [
          ...new Set(
            completed.map((row) => row.epid_number).filter(Boolean)
          ),
        ],
        datasetLabels: [
          ...new Set(
            completed.map((row) => {
              const dataset = datasets.find(
                (item) => item.key === row.dataset
              );
              return dataset?.name || row.dataset;
            })
          ),
        ],
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const values = {
        date: [a.record.date, b.record.date],
        name: [a.record.name, b.record.name],
        district: [a.record.district, b.record.district],
        lab: [a.labNumbers.join(" "), b.labNumbers.join(" ")],
        tests: [a.completed.length, b.completed.length],
      };
      const [left, right] = values[sort.column] || values.date;
      const comparison =
        typeof left === "number"
          ? left - right
          : String(left || "").localeCompare(
              String(right || ""),
              undefined,
              { numeric: true, sensitivity: "base" }
            );
      return sort.direction === "asc" ? comparison : -comparison;
    });

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

  const SortHeader = ({ column, children }) => (
    <button
      type="button"
      onClick={() => toggleSort(column)}
      className="font-semibold hover:text-blue-600"
    >
      {children}
      {sort.column === column
        ? sort.direction === "asc"
          ? " ↑"
          : " ↓"
        : ""}
    </button>
  );

  return (
    <div className="space-y-4">
      <Card className="border p-4 shadow-none">
        <div className="text-xs font-semibold uppercase text-slate-500">
          Dataset
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedDataset("")}
            className={`rounded-full border px-3 py-2 text-xs font-medium ${
              selectedDataset === ""
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            All Datasets
          </button>

          {orderedDatasets.map((dataset) => (
            <button
              type="button"
              key={dataset.key}
              onClick={() => setSelectedDataset(dataset.key)}
              className={`rounded-full border px-3 py-2 text-xs font-medium ${
                selectedDataset === dataset.key
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {dataset.name || dataset.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") run();
              }}
              placeholder="Search by patient name, lab number, patient ID or EPID number"
              className="pl-9"
            />
          </div>

          <Button
            onClick={run}
            disabled={loading}
            className="bg-blue-600"
          >
            {loading ? "Searching…" : "Search"}
          </Button>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            Rows
            <select
              value={pageSize}
              onChange={(event) =>
                setPageSize(Number(event.target.value))
              }
              className="rounded border bg-white p-2"
            >
              {[25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden border shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-[11px] uppercase text-slate-500">
                <th className="px-3 py-2">
                  <SortHeader column="date">Date</SortHeader>
                </th>
                <th className="px-3 py-2">
                  <SortHeader column="name">Patient Name</SortHeader>
                </th>
                <th className="px-3 py-2">Age / Sex</th>
                <th className="px-3 py-2">
                  <SortHeader column="district">District</SortHeader>
                </th>
                <th className="px-3 py-2">
                  <SortHeader column="lab">Lab Numbers</SortHeader>
                </th>
                <th className="px-3 py-2">EPID Numbers</th>
                <th className="px-3 py-2">Dataset</th>
                <th className="px-3 py-2">
                  <SortHeader column="tests">Completed Tests</SortHeader>
                </th>
                <th className="px-3 py-2 text-right">Print</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="p-8 text-center">
                    Loading completed records…
                  </td>
                </tr>
              )}

              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="p-10 text-center text-slate-500"
                  >
                    No completed patient records found.
                  </td>
                </tr>
              )}

              {!loading &&
                visibleRows.map(
                  ({
                    record,
                    completed,
                    labNumbers,
                    epidNumbers,
                    datasetLabels,
                  }) => (
                    <tr
                      key={record.id}
                      className="border-t hover:bg-blue-50/40"
                    >
                      <td className="px-3 py-2">
                        {fmt(record.date)}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {record.name}
                      </td>
                      <td className="px-3 py-2">
                        {record.age ?? "—"} / {record.sex || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {record.district}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {labNumbers.join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {epidNumbers.join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {datasetLabels.join(", ")}
                      </td>
                      <td className="px-3 py-2">
                        {completed.length}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openReport(record.id)}
                        >
                          <Printer size={16} className="mr-2" />
                          Print
                        </Button>
                      </td>
                    </tr>
                  )
                )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="text-xs text-slate-500">
            Showing {visibleRows.length} of {rows.length} completed records
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() =>
                setPage((current) => Math.max(1, current - 1))
              }
            >
              Previous
            </Button>
            <span className="self-center text-xs text-slate-500">
              Page {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() =>
                setPage((current) =>
                  Math.min(totalPages, current + 1)
                )
              }
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Card className="border p-4 shadow-none">
        <Field label="Report Remarks">
          <textarea
            rows={3}
            value={reportRemarks}
            onChange={(event) =>
              setReportRemarks(event.target.value)
            }
            placeholder="Remarks to appear at the bottom of the printed laboratory report"
            className="w-full rounded border p-3 text-sm"
          />
        </Field>
      </Card>
    </div>
  );
}

function FilterCard({
  tab,
  filters,
  setFilters,
  datasets,
  availableTests,
  opts,
  run,
  exportFile,
  saveToDrive,
  openDistrictReport,
  consolidatedTemplate,
  setConsolidatedTemplate,
  consolidatedTests,
  setConsolidatedTests,
  consolidatedPanel,
  setConsolidatedPanel,
  consolidatedSpecimen,
  setConsolidatedSpecimen,
}) {
  return (
    <Card className="border p-3 shadow-none">
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3 lg:grid-cols-4">
        {tab === "district" && (
          <>
            <Field label="Report Template">
              <select
                value={consolidatedTemplate}
                onChange={(event) =>
                  setConsolidatedTemplate(event.target.value)
                }
                className="w-full rounded border bg-white p-2"
              >
                <option value="generic">Generic Laboratory</option>
                <option value="quantitation">Quantitation</option>
                <option value="serotyping">Serotyping</option>
                <option value="panel">Panel Report</option>
                <option value="surveillance">Surveillance</option>
              </select>
            </Field>

            <Field label="Tests">
              <select
                multiple
                value={consolidatedTests}
                onChange={(event) => {
                  const values = Array.from(
                    event.target.selectedOptions
                  ).map((option) => option.value);
                  setConsolidatedTests(values);
                  if (values.length) setConsolidatedPanel("");
                }}
                size={8}
                className="h-44 w-full rounded border bg-white p-2"
              >
                {(opts.test || []).map((testName) => (
                  <option key={testName} value={testName}>
                    {testName}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                Hold Shift (or Ctrl/⌘) to select multiple tests.
                Selecting a Panel clears this list and selects all
                completed tests assigned under that panel.
              </div>
            </Field>

            <Select
              label="Panel"
              value={consolidatedPanel || ANY}
              onChange={(value) => {
                setConsolidatedPanel(
                  value === ANY ? "" : value
                );
                setConsolidatedTests([]);
              }}
              options={(opts.panels || [])
                .filter((panel) => panel.active !== false)
                .map((panel) => ({
                  key: panel.id,
                  label: panel.name,
                }))}
            />

            <Select
              label="Specimen"
              value={consolidatedSpecimen || ANY}
              onChange={(value) =>
                setConsolidatedSpecimen(
                  value === ANY ? "" : value
                )
              }
              options={opts.sample_type || []}
            />
          </>
        )}
        {tab !== "district" && (
        <Select
          label="Dataset"
          value={filters.dataset}
          onChange={(value) =>
            setFilters((current) => ({
              ...current,
              dataset: value,
              test: ANY,
            }))
          }
          options={datasets}
        />
        )}

        {(tab === "filtered" || tab === "tat" || tab === "tat_report") && (
          <Select
            label="Test"
            value={filters.test}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                test: value,
              }))
            }
            options={availableTests}
          />
        )}

        <Select
          label="District"
          value={filters.district}
          onChange={(value) =>
            setFilters((current) => ({
              ...current,
              district: value,
            }))
          }
          options={opts.district}
          anyLabel={tab === "district" ? "Any district" : "Any"}
        />

        {tab === "filtered" && (
          <Select
            label="Sample Type"
            value={filters.sample_type}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                sample_type: value,
              }))
            }
            options={opts.sample_type}
          />
        )}

        {tab !== "district" && (
        <Field label="From">
          <Input
            type="date"
            value={filters.date_from}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                date_from: event.target.value,
              }))
            }
          />
        </Field>
        )}

        {tab !== "district" && (
        <Field label="To">
          <Input
            type="date"
            value={filters.date_to}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                date_to: event.target.value,
              }))
            }
          />
        </Field>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={run} className="bg-blue-600">
          <Funnel size={16} className="mr-2" />
          Apply
        </Button>
        <Button
          variant="outline"
          onClick={() => setFilters(emptyFilters)}
        >
          <ArrowCounterClockwise size={16} className="mr-2" />
          Reset
        </Button>

        {tab === "district" && (
          <Button variant="outline" onClick={openDistrictReport}>
            <FilePdf size={16} className="mr-2" />
            Preview / Print
          </Button>
        )}

        {tab === "filtered" && (
          <>
            <Button
              variant="outline"
              onClick={() => exportFile("csv")}
            >
              <FileCsv size={16} className="mr-2" />
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => exportFile("xlsx")}
            >
              <MicrosoftExcelLogo size={16} className="mr-2" />
              Excel
            </Button>
            <Button variant="outline" onClick={saveToDrive}>
              <CloudArrowUp size={16} className="mr-2" />
              Save to Drive
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function DistrictPreview({
  items,
  total,
  filters,
  datasets,
  print,
  template,
  selectedTests,
  selectedPanel,
  selectedSpecimen,
  panels,
  selectedRows,
  setSelectedRows,
  reportRemarks,
  setReportRemarks,
  consolidatedSort,
  setConsolidatedSort,
}) {
  const safePanels = Array.isArray(panels) ? panels : [];
  const panel = safePanels.find(
    (item) => item.id === selectedPanel
  );
  const selectedTestSet = new Set(
    selectedTests?.length ? selectedTests : panel?.tests || []
  );

  const completedRows = items.flatMap((record) =>
    allSampleTests(record)
      .filter((row) => {
        if (!row.completed) return false;
        if (
          selectedSpecimen &&
          row.sample_type !== selectedSpecimen
        ) {
          return false;
        }

        if (selectedPanel) {
          return (row.panel_ids || []).includes(selectedPanel);
        }

        if (selectedTestSet.size) {
          return selectedTestSet.has(row.test);
        }

        return true;
      })
      .map((row) => ({ ...row, record }))
  );

  const showEpid = template === "surveillance";
  const isPanel = template === "panel";
  const isQuantitation =
    template === "quantitation" || template === "serotyping";
  const isGeneric = template === "generic";

  const headings = [
    "Select",
    "Sl.",
    "Lab No.",
    ...(showEpid ? ["EPID No."] : []),
    "Name",
    "Age",
    "Sex",
    "Requesting Institution",
    "Date Received",
    ...(isGeneric || isPanel ? ["Sample"] : []),
    ...(isPanel ? ["Panel"] : []),
    ...(isGeneric || isPanel || isQuantitation || showEpid
      ? ["Test"]
      : []),
    "Result",
    ...(isQuantitation || isPanel
      ? ["Additional Result", "Remarks"]
      : []),
  ];

  const sortedRows = [...completedRows].sort((a, b) => {
    const values = {
      lab: [a.lab_number, b.lab_number],
      name: [a.record.name, b.record.name],
      age: [a.record.age ?? -1, b.record.age ?? -1],
      sex: [a.record.sex || "", b.record.sex || ""],
      institution: [
        a.record.requesting_institution || "",
        b.record.requesting_institution || "",
      ],
      date: [a.record.date || "", b.record.date || ""],
      sample: [a.sample_type || "", b.sample_type || ""],
      test: [a.test || "", b.test || ""],
      result: [a.result1 || "", b.result1 || ""],
    };
    const [left, right] =
      values[consolidatedSort.column] || values.name;
    const cmp =
      typeof left === "number"
        ? left - right
        : String(left).localeCompare(String(right), undefined, {
            numeric: true,
            sensitivity: "base",
          });
    return consolidatedSort.direction === "asc" ? cmp : -cmp;
  });

  const toggleSort = (column) =>
    setConsolidatedSort((current) => ({
      column,
      direction:
        current.column === column && current.direction === "asc"
          ? "desc"
          : "asc",
    }));

  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="font-semibold">
            Consolidated Laboratory Report
          </div>
          <div className="text-sm text-slate-500">
            District:{" "}
            {filters.district === ANY ? "Not selected" : filters.district}
            {selectedSpecimen
              ? ` · Specimen: ${selectedSpecimen}`
              : ""}
            {selectedTests?.length
              ? ` · Tests: ${selectedTests.join(", ")}`
              : panel
                ? ` · Panel: ${panel.name}`
                : ""}
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={print}
          disabled={
            completedRows.length === 0 ||
            Object.values(selectedRows).every((value) => !value)
          }
        >
          <Printer size={16} className="mr-2" />
          Preview / Print Selected
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500">
              {headings.map((heading) => {
                const map = {
                  "Lab No.": "lab",
                  Name: "name",
                  Age: "age",
                  Sex: "sex",
                  "Requesting Institution": "institution",
                  "Date Received": "date",
                  Sample: "sample",
                  Test: "test",
                  Result: "result",
                };
                const column = map[heading];
                return (
                  <th key={heading} className="px-3 py-2">
                    {column ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className="font-semibold hover:text-blue-600"
                      >
                        {heading}
                        {consolidatedSort.column === column
                          ? consolidatedSort.direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </button>
                    ) : (
                      heading
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {!completedRows.length && (
              <tr>
                <td
                  colSpan={headings.length}
                  className="px-3 py-10 text-center text-slate-500"
                >
                  Select the required filters and click Apply.
                </td>
              </tr>
            )}

            {sortedRows.map((row, index) => {
              const previous =
                index > 0 ? sortedRows[index - 1] : null;
              const samePatient =
                previous?.record?.id === row.record.id;
              const sameSample =
                samePatient &&
                previous?.lab_number === row.lab_number;
              const panelName =
                selectedPanel
                  ? panel?.name
                  : (row.panel_names || [])[0] || "";

              return (
                <tr
                  key={row.key}
                  className={`border-t ${
                    samePatient
                      ? "border-slate-100"
                      : "border-slate-300"
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={sortedRows
                        .filter((item) => item.record.id === row.record.id)
                        .every((item) => selectedRows[item.key])}
                      onChange={(event) =>
                        setSelectedRows((current) => {
                          const next = { ...current };
                          sortedRows
                            .filter(
                              (item) =>
                                item.record.id === row.record.id
                            )
                            .forEach((item) => {
                              next[item.key] =
                                event.target.checked;
                            });
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">{index + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {sameSample ? "" : row.lab_number}
                  </td>
                  {showEpid && (
                    <td className="px-3 py-2 text-xs">
                      {sameSample ? "" : row.epid_number || "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 font-medium">
                    {samePatient ? "" : row.record.name}
                  </td>
                  <td className="px-3 py-2">
                    {samePatient ? "" : row.record.age ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {samePatient ? "" : row.record.sex || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {samePatient
                      ? ""
                      : row.record.requesting_institution || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {samePatient ? "" : fmt(row.record.date)}
                  </td>
                  {(isGeneric || isPanel) && (
                    <td className="px-3 py-2">
                      {sameSample ? "" : row.sample_type}
                    </td>
                  )}
                  {isPanel && (
                    <td className="px-3 py-2">
                      {sameSample ? "" : panelName || "—"}
                    </td>
                  )}
                  {(isGeneric || isPanel || isQuantitation || showEpid) && (
                    <td className="px-3 py-2 font-medium">
                      {row.test}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {row.result1 || "—"}
                  </td>
                  {(isQuantitation || isPanel) && (
                    <>
                      <td className="px-3 py-2">
                        {row.result2 || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.test_remarks || "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSelectedRows(
                Object.fromEntries(
                  completedRows.map((row) => [row.key, true])
                )
              )
            }
          >
            Select All Listed
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedRows({})}
          >
            Clear Selection
          </Button>
        </div>

        <Field label="Report Remarks">
          <textarea
            rows={3}
            value={reportRemarks}
            onChange={(event) =>
              setReportRemarks(event.target.value)
            }
            placeholder="Remarks to appear at the bottom of the consolidated report"
            className="w-full rounded border p-3 text-sm"
          />
        </Field>
      </div>
    </Card>
  );
}

function Filtered({ items, total, filters, datasets }) {
  const rows = items.flatMap((record) =>
    allSampleTests(record)
      .filter(
        (row) =>
          filters.test === ANY || row.test === filters.test
      )
      .map((row) => ({ ...row, record }))
  );

  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="border-b px-4 py-3 text-sm text-slate-500">
        Matched records: {total}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500">
              {[
                "Dataset",
                "Lab #",
                "Date",
                "Name",
                "Age",
                "District",
                "Sample",
                "Test",
                "Result",
                "Result Date",
              ].map((heading) => (
                <th key={heading} className="px-3 py-2">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ record, ...row }) => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-2">
                  {datasets.find(
                    (dataset) => dataset.key === row.dataset
                  )?.name || row.dataset}
                </td>
                <td className="px-3 py-2">{row.lab_number}</td>
                <td className="px-3 py-2">{fmt(record.date)}</td>
                <td className="px-3 py-2">{record.name}</td>
                <td className="px-3 py-2">
                  {record.age ?? "—"}
                </td>
                <td className="px-3 py-2">{record.district}</td>
                <td className="px-3 py-2">{row.sample_type}</td>
                <td className="px-3 py-2">{row.test}</td>
                <td className="px-3 py-2">{row.result}</td>
                <td className="px-3 py-2">
                  {fmt(row.result_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Statistics({ items }) {
  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500">
              {[
                "Test Name",
                "Total",
                "Positive",
                "Negative",
                "Indeterminate",
                "Pending",
                "Positivity Rate",
              ].map((heading) => (
                <th key={heading} className="px-3 py-2">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.test} className="border-t">
                <td className="px-3 py-2 font-medium">
                  {item.test}
                </td>
                <td className="px-3 py-2">{item.total}</td>
                <td className="px-3 py-2">{item.positive}</td>
                <td className="px-3 py-2">{item.negative}</td>
                <td className="px-3 py-2">
                  {item.indeterminate}
                </td>
                <td className="px-3 py-2">{item.pending}</td>
                <td className="px-3 py-2">
                  {item.positivity_rate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Tat({ data }) {
  const points = data.points || [];
  const summary = data.summary || {};
  const width = 900;
  const height = 360;
  const padding = 50;
  const maximum = Math.max(
    1,
    ...points.map((point) => point.tat_days)
  );
  const usableWidth = width - 2 * padding;
  const usableHeight = height - 2 * padding;
  const plot = points.map((point, index) => ({
    ...point,
    x:
      padding +
      (points.length <= 1
        ? usableWidth / 2
        : (index / (points.length - 1)) * usableWidth),
    y:
      padding +
      usableHeight -
      (point.tat_days / maximum) * usableHeight,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Completed", summary.count ?? 0],
          [
            "Average",
            summary.average == null
              ? "—"
              : `${summary.average} days`,
          ],
          [
            "Median",
            summary.median == null
              ? "—"
              : `${summary.median} days`,
          ],
          [
            "Minimum",
            summary.minimum == null
              ? "—"
              : `${summary.minimum} days`,
          ],
          [
            "Maximum",
            summary.maximum == null
              ? "—"
              : `${summary.maximum} days`,
          ],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-xs uppercase text-slate-500">
              {label}
            </div>
            <div className="text-xl font-semibold">{value}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto p-4">
        {!points.length ? (
          <div className="p-10 text-center text-slate-500">
            No completed tests.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full min-w-[760px]"
          >
            <line
              x1={padding}
              y1={height - padding}
              x2={width - padding}
              y2={height - padding}
              stroke="currentColor"
              opacity=".35"
            />
            <line
              x1={padding}
              y1={padding}
              x2={padding}
              y2={height - padding}
              stroke="currentColor"
              opacity=".35"
            />
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              points={plot
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
            />
            {plot.map((point, index) => (
              <g key={index}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  fill="currentColor"
                >
                  <title>
                    {`${point.test} · ${fmt(
                      point.date
                    )} · ${point.tat_days} days`}
                  </title>
                </circle>
              </g>
            ))}
          </svg>
        )}
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

const Select = ({
  label,
  value,
  onChange,
  options,
  anyLabel = "Any",
}) => (
  <Field label={label}>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded border bg-white p-2"
    >
      <option value={ANY}>{anyLabel}</option>
      {(options || []).map((option) => {
        const optionValue =
          option.key || option.value || option.name || option;
        const optionLabel =
          option.label || option.name || option;
        return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        );
      })}
    </select>
  </Field>
);


function TatReport({
  data,
  thresholds,
  selectedDataset,
  datasets,
}) {
  const thresholdMap = new Map(
    (thresholds || []).map((item) => [
      `${item.dataset}::${item.item_type || "test"}::${item.test}`,
      Number(item.threshold_days),
    ])
  );

  const groups = new Map();

  (data.points || []).forEach((point) => {
    const dataset = point.dataset || selectedDataset || "";
    const test = point.test || "Unknown Test";
    const itemType = point.item_type || "test";
    const key = `${dataset}::${itemType}::${test}`;

    if (!groups.has(key)) {
      groups.set(key, {
        dataset,
        test,
        item_type: itemType,
        values: [],
      });
    }
    groups.get(key).values.push(Number(point.tat_days || 0));
  });

  const rows = [...groups.values()]
    .map(({ dataset, test, item_type, values }) => {
      const threshold = thresholdMap.get(
        `${dataset}::${item_type}::${test}`
      );
      const hasThreshold =
        threshold !== undefined && !Number.isNaN(threshold);
      const within = hasThreshold
        ? values.filter((value) => value <= threshold).length
        : null;

      return {
        dataset,
        test,
        item_type,
        count: values.length,
        average:
          values.reduce((sum, value) => sum + value, 0) /
          Math.max(1, values.length),
        threshold,
        within,
        compliance:
          hasThreshold && values.length
            ? (within / values.length) * 100
            : null,
      };
    })
    .sort((a, b) =>
      `${a.dataset} ${a.test}`.localeCompare(
        `${b.dataset} ${b.test}`
      )
    );

  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="border-b px-4 py-3">
        <div className="font-semibold">TAT Compliance Report</div>
        <div className="text-xs text-slate-500">
          Thresholds are maintained in Master Data → TAT Threshold Master.
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500">
              <th className="px-3 py-2">Dataset</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Test / Panel</th>
              <th className="px-3 py-2">Completed</th>
              <th className="px-3 py-2">Average TAT</th>
              <th className="px-3 py-2">Threshold</th>
              <th className="px-3 py-2">Within Threshold</th>
              <th className="px-3 py-2">% Compliance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No completed tests for the selected period.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={`${row.dataset}::${row.item_type}::${row.test}`}
                  className="border-t"
                >
                  <td className="px-3 py-2">
                    {datasets.find(
                      (dataset) => dataset.key === row.dataset
                    )?.name || row.dataset || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.item_type === "panel" ? "Panel" : "Test"}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {row.test}
                  </td>
                  <td className="px-3 py-2">{row.count}</td>
                  <td className="px-3 py-2">
                    {row.average.toFixed(2)} days
                  </td>
                  <td className="px-3 py-2">
                    {row.threshold === undefined
                      ? "Not configured"
                      : `${row.threshold} days`}
                  </td>
                  <td className="px-3 py-2">
                    {row.within === null
                      ? "—"
                      : `${row.within}/${row.count}`}
                  </td>
                  <td className="px-3 py-2">
                    {row.compliance === null
                      ? "—"
                      : `${row.compliance.toFixed(1)}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
