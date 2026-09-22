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

const displayAge = (record) => {
  const years = record.age_years ?? record.age;
  const months = record.age_months;
  const days = record.age_days;
  const parts = [];
  if (years !== null && years !== undefined && years !== "") parts.push(`${years}y`);
  if (months !== null && months !== undefined && months !== "") parts.push(`${months}m`);
  if (days !== null && days !== undefined && days !== "") parts.push(`${days}d`);
  return parts.length ? parts.join(" ") : "—";
};

const emptyFilters = {
  dataset: ANY,
  test: ANY,
  district: ANY,
  sample_type: ANY,
  result_contains: "",
  date_from: "",
  date_to: "",
  nvhcp_program: ANY,
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
        sample_quality: sample.sample_quality || "",
        transport_condition: sample.transport_condition || "",
        nvhcp_program: Boolean(sample.nvhcp_program),
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
      sample_quality: "",
      transport_condition: "",
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
  const [individualDateFrom, setIndividualDateFrom] = useState("");
  const [individualDateTo, setIndividualDateTo] = useState("");
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
  const [individualReportRemarks, setIndividualReportRemarks] = useState("");
  const [selectedRemarkRecord, setSelectedRemarkRecord] = useState(null);
  const [savingReportRemarks, setSavingReportRemarks] = useState(false);
  const [consolidatedReportRemarks, setConsolidatedReportRemarks] =
    useState("");
  const [selectedConsolidatedRows, setSelectedConsolidatedRows] =
    useState({});
  const [consolidatedSort, setConsolidatedSort] = useState({
    column: "name",
    direction: "asc",
  });
  const [tatThresholds, setTatThresholds] = useState([]);
  const [monthly, setMonthly] = useState(null);
  const [monthlyMonth, setMonthlyMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [monthlyDatasets, setMonthlyDatasets] = useState(null);

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
  const monthlyKeys = monthlyDatasets === null ? datasets.map(d => d.key) : monthlyDatasets;
  const availableTests =
    filters.dataset !== ANY &&
    opts.tests_by_dataset?.[filters.dataset]
      ? opts.tests_by_dataset[filters.dataset]
      : opts.test || [];

  const params = () => {
    const values = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (!value || value === ANY) return;
      if (key === "nvhcp_program") {
        values[key] = value === "true";
        return;
      }
      values[key] = value;
    });
    return values;
  };

  const run = async () => {
    setLoading(true);

    try {
      if (tab === "monthly") {
        if (!monthlyKeys.length) throw new Error("Select a dataset");
        const response = await api.get("/reports/monthly-summary", {params: {month: monthlyMonth, datasets: monthlyKeys.join(",")}});
        setMonthly(response.data);
      } else if (tab === "individual") {
        const response = await api.get("/records", {
          params: {
            search: individualSearch.trim() || undefined,
            date_from: individualDateFrom || undefined,
            date_to: individualDateTo || undefined,
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
        error?.response?.data?.detail || error?.message || "Failed to run report"
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

  const exportStatisticsExcel = async () => {
    try {
      const response = await api.get(
        "/reports/test-statistics/export",
        {
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
          responseType: "blob",
        }
      );

      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `MDS_LIMS_Test_Statistics_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Test Statistics Excel export failed");
    }
  };

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

  const selectRemarkRecord = (record) => {
    setSelectedRemarkRecord(record);
    setIndividualReportRemarks(record.report_remarks || "");
  };

  const saveIndividualRemarks = async () => {
    if (!selectedRemarkRecord) return false;
    setSavingReportRemarks(true);
    try {
      const response = await api.put(`/records/${selectedRemarkRecord.id}/report-remarks`, {
        report_remarks: individualReportRemarks,
      });
      const saved = response.data.report_remarks;
      setIndividualReportRemarks(saved);
      setSelectedRemarkRecord(previous => ({ ...previous, report_remarks: saved }));
      setIndividualItems(previous => previous.map(item => item.id === selectedRemarkRecord.id
        ? { ...item, report_remarks: saved } : item));
      toast.success("Report remarks saved to record");
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save report remarks");
      return false;
    } finally {
      setSavingReportRemarks(false);
    }
  };

  const openIndividualReport = async (recordId) => {
    // Always save before opening the print page, including an intentionally cleared remark.
    const record = individualItems.find(item => item.id === recordId);
    const text = selectedRemarkRecord?.id === recordId
      ? individualReportRemarks : (record?.report_remarks || "");
    try {
      await api.put(`/records/${recordId}/report-remarks`, { report_remarks: text });
      setIndividualItems(previous => previous.map(item => item.id === recordId
        ? { ...item, report_remarks: text.trim() } : item));
      navigate(`/reports/print?${new URLSearchParams({ type: "individual", id: recordId })}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not save report remarks; printing cancelled");
    }
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
    ["monthly", "Monthly Summary"],
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

      {tab === "monthly" ? (
        <MonthlySummary data={monthly} month={monthlyMonth} setMonth={value => {setMonthlyMonth(value);setMonthly(null);}} datasets={datasets} selected={monthlyKeys} setSelected={value => {setMonthlyDatasets(value);setMonthly(null);}} run={run} loading={loading} />
      ) : tab === "individual" ? (
        <IndividualReportSearch
          search={individualSearch}
          setSearch={setIndividualSearch}
          run={run}
          loading={loading}
          records={individualItems}
          datasets={datasets}
          selectedDataset={individualDataset}
          dateFrom={individualDateFrom}
          setDateFrom={(value) => {
            setIndividualDateFrom(value);
            setIndividualPage(1);
          }}
          dateTo={individualDateTo}
          setDateTo={(value) => {
            setIndividualDateTo(value);
            setIndividualPage(1);
          }}
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
          selectedRemarkRecord={selectedRemarkRecord}
          selectRemarkRecord={selectRemarkRecord}
          saveIndividualRemarks={saveIndividualRemarks}
          savingReportRemarks={savingReportRemarks}
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
            <Statistics items={stats} onExportExcel={exportStatisticsExcel} />
          ) : tab === "tat_report" ? (
            <TatReport
              filters={filters}
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
            <Tat data={tat} filters={filters} datasets={datasets} />
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
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  sort,
  setSort,
  page,
  setPage,
  pageSize,
  setPageSize,
  openReport,
  reportRemarks,
  setReportRemarks,
  selectedRemarkRecord,
  selectRemarkRecord,
  saveIndividualRemarks,
  savingReportRemarks,
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
    .filter((record) => {
      const recordDate = String(record.date || "").slice(0, 10);
      if (dateFrom && recordDate < dateFrom) return false;
      if (dateTo && recordDate > dateTo) return false;
      return true;
    })
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

        <div className="mt-3 rounded border border-blue-100 bg-blue-50/50 p-3">
          <div className="mb-1 text-sm font-semibold">Report Remarks</div>
          <div className="mb-2 text-xs text-slate-600">
            {selectedRemarkRecord
              ? `Selected record: ${selectedRemarkRecord.name} (${selectedRemarkRecord.lab_number || selectedRemarkRecord.patient_id || "—"})`
              : "Select a record using Edit Remarks in the results table below."}
          </div>
          <textarea rows={3} value={reportRemarks} disabled={!selectedRemarkRecord}
            onChange={event => setReportRemarks(event.target.value)}
            placeholder="Saved permanently with the selected record and included on future prints"
            className="w-full rounded border bg-white p-2 text-sm" />
          <Button type="button" size="sm" className="mt-2" disabled={!selectedRemarkRecord || savingReportRemarks}
            onClick={saveIndividualRemarks}>{savingReportRemarks ? "Saving…" : "Save Report Remarks"}</Button>
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

          <div className="flex items-center gap-2">
            <Field label="From">
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) =>
                  setDateFrom(event.target.value)
                }
              />
            </Field>

            <Field label="To">
              <Input
                type="date"
                value={dateTo}
                onChange={(event) =>
                  setDateTo(event.target.value)
                }
              />
            </Field>
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
                        {displayAge(record)} / {record.sex || "—"}
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
                        <Button size="sm" variant={selectedRemarkRecord?.id === record.id ? "default" : "outline"}
                          className="mr-2" onClick={() => selectRemarkRecord(record)}>
                          Edit Remarks
                        </Button>
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
  const districtField = (
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
  );

  const fromField = (
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
  );

  const toField = (
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
  );

  return (
    <Card className="border p-3 shadow-none">
      {tab === "district" ? (
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3 lg:grid-cols-4 lg:items-start">
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

          <Select
            label="Panel"
            value={consolidatedPanel || ANY}
            onChange={(value) => {
              setConsolidatedPanel(value === ANY ? "" : value);
              setConsolidatedTests([]);
            }}
            options={opts.panels || []}
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

          <div className="lg:col-start-4 lg:row-start-1 lg:row-span-2">
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
                size={7}
                className="h-40 w-full rounded border bg-white p-2"
              >
                {(opts.test || []).map((testName) => (
                  <option key={testName} value={testName}>
                    {testName}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                Hold Shift (or Ctrl/⌘) to select multiple tests.
              </div>
            </Field>
          </div>

          <div className="lg:col-start-1 lg:row-start-2">
            {districtField}
          </div>
          <div className="lg:col-start-2 lg:row-start-2">
            {fromField}
          </div>
          <div className="lg:col-start-3 lg:row-start-2">
            {toField}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3 lg:grid-cols-4">
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

          {(tab === "filtered" ||
            tab === "tat" ||
            tab === "tat_report") && (
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

          {districtField}

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

          {tab === "filtered" && (
            <Select
              label="NVHCP Programme"
              value={filters.nvhcp_program}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  nvhcp_program: value,
                }))
              }
              options={[
                { key: "true", name: "Yes" },
                { key: "false", name: "No" },
              ]}
            />
          )}

          {fromField}
          {toField}
        </div>
      )}

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
  const panel = safePanels.find((item) => item.id === selectedPanel);
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
          const selectedPanelDefinition = safePanels.find(
            (item) => item.id === selectedPanel
          );
          const panelTests = new Set(
            selectedPanelDefinition?.tests || []
          );

          return (
            (row.panel_ids || []).includes(selectedPanel) ||
            panelTests.has(row.test)
          );
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
      age: [a.record.age_years ?? a.record.age ?? -1, b.record.age_years ?? b.record.age ?? -1],
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
                "Sample Quality",
                "Transport Condition",
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
                  {displayAge(record)}
                </td>
                <td className="px-3 py-2">{record.district}</td>
                <td className="px-3 py-2">{row.sample_type}</td>
                <td className="px-3 py-2">{row.sample_quality || "—"}</td>
                <td className="px-3 py-2">{row.transport_condition || "—"}</td>
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

function Statistics({ items, onExportExcel }) {
  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-sm font-medium text-slate-700">
          Panel and individual test statistics are counted separately.
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onExportExcel}
        >
          <MicrosoftExcelLogo size={16} className="mr-2" />
          Export Excel
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500">
              {[
                "Type",
                "Test / Panel",
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
              <tr
                key={`${item.item_type || "test"}-${item.test}`}
                className="border-t"
              >
                <td className="px-3 py-2">
                  <span
                    className={
                      item.item_type === "panel"
                        ? "rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                        : "text-slate-600"
                    }
                  >
                    {item.item_type === "panel"
                      ? "Panel"
                      : "Individual Test"}
                  </span>
                </td>
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

// TAT exports use the same already-filtered response displayed on screen.
const tatEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const tatDownload = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
const tatCsv = (rows, filename) => {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  tatDownload(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), filename);
};
const tatPrint = (title, meta, body) => {
  const popup = window.open("", "_blank");
  if (!popup) { toast.error("Allow pop-ups to print or save this report as PDF"); return; }
  const metadata = Object.entries(meta).map(([key, value]) => `<span><b>${tatEscape(key)}:</b> ${tatEscape(value || "All")}</span>`).join(" &nbsp; | &nbsp; ");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${tatEscape(title)}</title><style>@page{size:A4 landscape;margin:13mm}body{font:12px Arial;color:#172b4d}h1{text-align:center;font-size:18px;margin:8px}header{text-align:center;border-bottom:1px solid #888;padding-bottom:10px}small{display:block;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #999;padding:6px;text-align:left}th{background:#e8edf3}tr{break-inside:avoid}svg{max-width:100%;height:auto}footer{margin-top:15px;font-size:10px;color:#555}@media print{button{display:none}}</style></head><body><header><b>STATE PUBLIC HEALTH & CLINICAL LABORATORY</b><br>Molecular Diagnosis Section · MDS LIMS<h1>${tatEscape(title)}</h1></header><small>${metadata}</small>${body}<footer>Generated: ${tatEscape(new Date().toLocaleString())} · TAT measured in days · Use Print → Save as PDF for a PDF copy.</footer><p><button onclick="window.print()">Print / Save as PDF</button></p></body></html>`);
  popup.document.close();
};
const tatMeta = (filters, datasets) => ({
  Dataset: filters.dataset === ANY ? "All" : datasets.find((item) => item.key === filters.dataset)?.name || filters.dataset,
  Test: filters.test === ANY ? "All" : filters.test,
  District: filters.district === ANY ? "All" : filters.district,
  "Date from": filters.date_from || "All", "Date to": filters.date_to || "All",
});

function Tat({ data, filters, datasets }) {
  const points = data.points || [];
  const summary = data.summary || {};
  const width = 900;
  const height = 360;
  const padding = 65;
  const maximum = Math.max(
    1,
    ...points.filter((point) => Number.isFinite(Number(point.tat_days)) && point.tat_days !== null && point.tat_days !== "").map((point) => Number(point.tat_days))
  );
  const usableWidth = width - 2 * padding;
  const usableHeight = height - 2 * padding;
  const validPoints = points.filter((point) => point.tat_days !== null && point.tat_days !== "" && Number.isFinite(Number(point.tat_days)))
    .sort((a, b) => String(a.result_date || a.date || "").localeCompare(String(b.result_date || b.date || "")));
  const plot = validPoints.map((point, index) => ({
    ...point,
    x:
      padding +
      (validPoints.length <= 1
        ? usableWidth / 2
        : (index / (validPoints.length - 1)) * usableWidth),
    y:
      padding +
      usableHeight -
      (Number(point.tat_days) / maximum) * usableHeight,
  }));

  const graphMeta = tatMeta(filters, datasets);
  const printGraph = () => {
    const svg = document.getElementById("tat-export-graph");
    if (!svg) { toast.error("Run the report before exporting the graph"); return; }
    const printSvg = svg.cloneNode(true);
    printSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    printSvg.setAttribute("width", String(width));
    printSvg.setAttribute("height", String(height));
    const serialized = new XMLSerializer().serializeToString(printSvg);
    const summaryRows = Object.entries(summary).map(([key, value]) => `<tr><th>${tatEscape(key)}</th><td>${tatEscape(value)}</td></tr>`).join("");
    tatPrint("TAT Graph", graphMeta, `<table>${summaryRows}</table><p><b>X-axis:</b> Completed result date / plotted result order &nbsp; <b>Y-axis:</b> Turnaround time (days)</p><br>${serialized}`);
  };
  const exportPng = () => {
    const svg = document.getElementById("tat-export-graph");
    if (!svg) { toast.error("Run the report before exporting the graph"); return; }
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
    clone.setAttribute("style", "background:white;color:#172b4d");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {type:"image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
      const context = canvas.getContext("2d"); context.scale(2,2); context.fillStyle = "white"; context.fillRect(0,0,width,height);
      context.drawImage(image,0,0,width,height);
      canvas.toBlob((png) => { if (png) tatDownload(png,"MDS_LIMS_TAT_Graph.png"); else toast.error("PNG export failed"); URL.revokeObjectURL(url); }, "image/png");
    };
    image.onerror = () => { URL.revokeObjectURL(url); toast.error("PNG export failed"); };
    image.src = url;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!points.length} onClick={printGraph}><Printer size={16} className="mr-2" />Print / PDF</Button>
        <Button type="button" variant="outline" disabled={!points.length} onClick={exportPng}>Export PNG</Button>
        <Button type="button" variant="outline" disabled={!points.length} onClick={() => tatCsv([["Dataset","Test / Panel","Type","Completed date","TAT (days)"], ...points.map((p) => [p.dataset,p.test,p.item_type || "test",p.date,p.tat_days])], "MDS_LIMS_TAT_Graph_Data.csv")}>Export data (CSV)</Button>
      </div>
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
            id="tat-export-graph"
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
            {[0, 1, 2, 3, 4].map((tick) => {
              const value = (maximum * tick) / 4;
              const y = height - padding - (usableHeight * tick) / 4;
              return <g key={`y-${tick}`}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#cbd5e1" strokeDasharray="3 5" />
                <text x={padding - 9} y={y + 4} textAnchor="end" fontSize="12" fill="#172b4d">{Number(value.toFixed(2))}</text>
              </g>;
            })}
            <text x={width / 2} y={height - 8} textAnchor="middle" fontSize="13" fill="#172b4d">Result completion date (DD-MM)</text>
            <text transform={`translate(17 ${height / 2}) rotate(-90)`} textAnchor="middle" fontSize="13" fill="#172b4d">Turnaround time (days)</text>
            {plot.filter((_, i) => i % Math.max(1, Math.ceil(plot.length / 8)) === 0 || i === plot.length - 1).map((point, i) => <text key={`x-${i}`} x={point.x} y={height - padding + 18} textAnchor="middle" fontSize="10" fill="#172b4d">{String(point.result_date || point.date || '').slice(5, 10).split("-").reverse().join("-")}</text>)}
            <polyline
              fill="none"
              stroke="#172b4d"
              strokeWidth="1.5"
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
                  fill="#172b4d"
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
          option.key ||
          option.value ||
          option.id ||
          option.name ||
          option;
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
  filters,
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
  const [tatStatus, setTatStatus] = useState("all");
  const [exceededSort, setExceededSort] = useState("excess_desc");

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

  const assessedPoints = (data.points || []).filter((point) => point.tat_days !== null && point.tat_days !== "" && Number.isFinite(Number(point.tat_days))).map((point) => {
    const threshold = thresholdMap.get(`${point.dataset || selectedDataset || ""}::${point.item_type || "test"}::${point.test}`);
    return { ...point, actual: Number(point.tat_days), threshold, excess: threshold === undefined || !Number.isFinite(threshold) ? null : Number(point.tat_days) - threshold };
  });
  const exceededPoints = assessedPoints.filter((point) => point.excess !== null && point.excess > 0).sort((a,b) => exceededSort === "date" ? String(a.result_date || a.date).localeCompare(String(b.result_date || b.date)) : exceededSort === "lab" ? String(a.lab_number).localeCompare(String(b.lab_number), undefined, {numeric:true}) : b.excess - a.excess);
  const exceptionHeaders = ["Lab number", "Dataset", "Type", "Test / Panel", "Received", "Completed", "Actual TAT (days)", "Threshold (days)", "Exceeded by (days)"];
  const exceptionRows = exceededPoints.map((point) => [point.lab_number || "—", datasets.find((item) => item.key === point.dataset)?.name || point.dataset || "—", point.item_type === "panel" ? "Panel" : "Test", point.test || "—", point.date || "—", point.result_date || "—", point.actual, point.threshold, Number(point.excess.toFixed(2))]);
  const exceptionPrint = () => tatPrint("TAT Threshold Exceeded Report", tatMeta(filters, datasets), `<p>Exceeded: ${exceptionRows.length} of ${assessedPoints.filter(p => p.excess !== null).length} assessed results with a configured threshold. Pending results and results without thresholds are excluded.</p><table><thead><tr>${exceptionHeaders.map(h => `<th>${tatEscape(h)}</th>`).join("")}</tr></thead><tbody>${exceptionRows.map(row => `<tr>${row.map(cell => `<td>${tatEscape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);

  const printableRows = rows.map((row) => [datasets.find((item) => item.key === row.dataset)?.name || row.dataset, row.item_type === "panel" ? "Panel" : "Test", row.test, row.count, row.average.toFixed(2), row.threshold === undefined ? "Not configured" : row.threshold, row.within === null ? "—" : row.within, row.compliance === null ? "—" : row.compliance.toFixed(1) + "%"]);
  const headers = ["Dataset", "Type", "Test / Panel", "Completed", "Average TAT (days)", "Threshold (days)", "Within threshold", "Compliance"];
  const printReport = () => tatPrint("TAT Compliance Report", tatMeta(filters, datasets), `<table><thead><tr>${headers.map((h) => `<th>${tatEscape(h)}</th>`).join("")}</tr></thead><tbody>${printableRows.map((row) => `<tr>${row.map((cell) => `<td>${tatEscape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="flex flex-wrap gap-2 border-b px-4 py-3">
        <Button type="button" variant="outline" disabled={!rows.length} onClick={printReport}><Printer size={16} className="mr-2" />Print / PDF</Button>
        <Button type="button" variant="outline" disabled={!rows.length} onClick={() => tatCsv([headers, ...printableRows], "MDS_LIMS_TAT_Report.csv")}>Export data (CSV)</Button>
      </div>
      <div className="border-b px-4 py-3 space-y-3">
        <div className="font-semibold">TAT Threshold Exceeded Report</div>
        <p className="text-sm text-slate-600">{exceededPoints.length} exceeded out of {assessedPoints.filter(p => p.excess !== null).length} completed test/panel results with a configured threshold. Values are in days. Pending results and missing thresholds are excluded.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="tat-status">Show:</label><select id="tat-status" className="rounded border p-2" value={tatStatus} onChange={e=>setTatStatus(e.target.value)}><option value="all">All / compliance summary</option><option value="exceeded">Exceeded threshold only</option></select>
          {tatStatus === "exceeded" && <><label htmlFor="tat-sort">Sort:</label><select id="tat-sort" className="rounded border p-2" value={exceededSort} onChange={e=>setExceededSort(e.target.value)}><option value="excess_desc">Highest excess first</option><option value="date">Completion date</option><option value="lab">Lab number</option></select>
          <Button type="button" variant="outline" disabled={!exceptionRows.length} onClick={exceptionPrint}><Printer size={16} className="mr-2"/>Print / PDF exceeded report</Button>
          <Button type="button" variant="outline" disabled={!exceptionRows.length} onClick={()=>tatCsv([exceptionHeaders,...exceptionRows],"MDS_LIMS_TAT_Threshold_Exceeded.csv")}>Export exceeded (CSV)</Button></>}
        </div>
        {tatStatus === "exceeded" && <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-xs"><thead><tr>{exceptionHeaders.map(h=><th key={h} className="border p-2 text-left">{h}</th>)}</tr></thead><tbody>{exceptionRows.length ? exceptionRows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} className="border p-2">{v}</td>)}</tr>) : <tr><td colSpan={exceptionHeaders.length} className="p-4">No completed results exceed their configured threshold for the selected filters.</td></tr>}</tbody></table></div>}
      </div>
      {tatStatus === "all" && <div className="border-b px-4 py-3">
        <div className="font-semibold">TAT Compliance Report</div>
        <div className="text-xs text-slate-500">
          Thresholds are maintained in Master Data → TAT Threshold Master.
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
      </div></div>}
    </Card>
  );
}


function MonthlySummary({data, month, setMonth, datasets, selected, setSelected, run, loading}) {
  const [downloading, setDownloading] = useState(false);
  const columns = [["Dataset","name"],["Received","received"],["Completed*","completed"],["Pending*","pending"],["Rejected","rejected"],["TAT assessed","tat_assessed"],["Within","tat_within"],["Exceeded","tat_exceeded"],["Average TAT (days)","average_tat_days"],["Compliance (%)","tat_compliance_percent"]];
  const testColumns = [["Dataset","dataset_name"],["Type","item_type"],["Test / Panel","test"],["Assigned","assigned"],["Positive","positive"],["Negative","negative"],["Indeterminate","indeterminate"],["Other","other"],["Pending","pending"]];
  const printableTable = (cols, rows) => `<table><thead><tr>${cols.map(([title])=>`<th>${tatEscape(title)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(([,key])=>`<td>${tatEscape(r[key] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const print = () => data && tatPrint("Monthly Laboratory Summary Report", `Month: ${tatEscape(data.month)} | Datasets: ${data.datasets.map(k=>datasets.find(d=>d.key===k)?.name||k).join(", ")}`, `<h3>Consolidated and dataset-wise summary</h3>${printableTable(columns,[...data.rows,data.totals])}<h3>Testing summary — samples received in month</h3>${printableTable(testColumns,data.testing)}<p>*Completed: samples with at least one result date in month. Pending: samples received in month with no result date recorded at report generation. TAT: completed test/panel results in month with a configured threshold, in calendar days. Report reflects current records, not a locked month-end snapshot.</p><p>Prepared by: __________________ &nbsp; Reviewed by: __________________</p>`);
  const excel = async () => {setDownloading(true);try {const response=await api.get("/reports/monthly-summary/export",{params:{month,datasets:selected.join(",")},responseType:"blob"});const url=URL.createObjectURL(response.data);const a=document.createElement("a");a.href=url;a.download=`MDS_LIMS_Monthly_${month}.xlsx`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}catch(e){toast.error(e?.response?.data?.detail||"Monthly Excel export failed");}finally{setDownloading(false);}};
  return <Card className="p-4 space-y-4">
    <h2 className="font-semibold text-lg">Monthly Laboratory Summary Report</h2>
    <div className="flex flex-wrap gap-3 items-end"><label className="text-sm">Reporting month <Input type="month" value={month} onChange={e=>setMonth(e.target.value)} /></label><Button type="button" variant="outline" onClick={()=>setSelected(datasets.map(d=>d.key))}>Select all</Button><Button type="button" variant="outline" onClick={()=>setSelected([])}>Clear all</Button><Button disabled={loading||!month||!selected.length} onClick={run}>{loading?"Loading…":"Generate report"}</Button></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{datasets.map(d=><label key={d.key} className="flex gap-2 items-center text-sm"><input type="checkbox" checked={selected.includes(d.key)} onChange={e=>setSelected(e.target.checked?[...selected,d.key]:selected.filter(k=>k!==d.key))}/>{d.name}</label>)}</div>
    {data && <><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={print}><Printer size={16} className="mr-2"/>Print / Save as PDF</Button><Button variant="outline" onClick={excel} disabled={downloading}>{downloading?"Exporting…":"Export Excel (.xlsx)"}</Button></div><div className="text-sm text-slate-600">Month: {data.month} · {data.datasets.length} dataset(s) · Generated: {new Date(data.generated_at).toLocaleString()}</div><h3 className="font-semibold">Consolidated and dataset-wise summary</h3><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-xs"><thead><tr>{columns.map(([name])=><th key={name} className="border p-2 text-left">{name}</th>)}</tr></thead><tbody>{[...data.rows,data.totals].map((r,i)=><tr key={i} className={i===data.rows.length?"font-bold bg-slate-100":""}>{columns.map(([,key])=><td key={key} className="border p-2">{r[key]??"—"}</td>)}</tr>)}</tbody></table></div><h3 className="font-semibold">Test / panel summary for samples received in month</h3><div className="overflow-x-auto"><table className="w-full min-w-[950px] text-xs"><thead><tr>{testColumns.map(([name])=><th key={name} className="border p-2 text-left">{name}</th>)}</tr></thead><tbody>{data.testing.map((r,i)=><tr key={i}>{testColumns.map(([,key])=><td key={key} className="border p-2">{r[key]??"—"}</td>)}</tr>)}</tbody></table></div><p className="text-xs text-slate-600">*Completed counts samples with at least one result date in the month; it does not necessarily mean every assigned test is complete. Pending counts received samples with no result date recorded at report generation. TAT counts completed test/panel results in the month with configured thresholds, in calendar days. These are live figures, not a locked month-end snapshot.</p></>}
  </Card>;
}
