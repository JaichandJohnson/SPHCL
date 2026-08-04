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
  const [tab, setTab] = useState("individual");
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

  useEffect(() => {
    api
      .get("/options")
      .then((response) => setOpts(response.data))
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
        if (filters.district === ANY) {
          toast.error("Select a district");
          return;
        }

        const response = await api.get("/records", {
          params: {
            ...params(),
            page: 1,
            page_size: 1000,
          },
        });
        setItems(response.data.items || []);
        setTotal(response.data.total || 0);
      } else if (tab === "filtered") {
        const response = await api.get("/records", {
          params: {
            ...params(),
            page: 1,
            page_size: 500,
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
    if (tab !== "individual") run();
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
    navigate(`/reports/print?type=individual&id=${recordId}`);
  };

  const openDistrictReport = () => {
    if (filters.district === ANY) {
      toast.error("Select a district");
      return;
    }

    const query = new URLSearchParams({
      type: "district",
      district: filters.district,
    });

    if (filters.dataset !== ANY) {
      query.set("dataset", filters.dataset);
    }
    if (filters.date_from) query.set("date_from", filters.date_from);
    if (filters.date_to) query.set("date_to", filters.date_to);

    window.open(
      `/reports/print?${query.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const tabs = [
    ["individual", "Individual Patient Report"],
    ["district", "District Consolidated Report"],
    ["filtered", "Filtered Reports & Export"],
    ["statistics", "Test Statistics"],
    ["tat", "TAT Graph"],
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500">
          Reports
        </div>
        <h1 className="font-heading text-3xl font-semibold">
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
          openReport={openIndividualReport}
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
  openReport,
}) {
  return (
    <div className="space-y-4">
      <Card className="border p-5 shadow-none">
        <div className="flex flex-col gap-3 md:flex-row">
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
            {loading ? "Searching…" : "Search Completed Records"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden border shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500">
                {[
                  "Date",
                  "Patient",
                  "District",
                  "Lab Numbers",
                  "Datasets",
                  "Completed Tests",
                  "",
                ].map((heading) => (
                  <th key={heading} className="px-3 py-2">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!records.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-10 text-center text-slate-500"
                  >
                    Search for a completed patient record.
                  </td>
                </tr>
              )}

              {records.map((record) => {
                const rows = allSampleTests(record);
                const completed = rows.filter((row) => row.completed);
                const labNumbers = [
                  ...new Set(
                    completed.map((row) => row.lab_number).filter(Boolean)
                  ),
                ];
                const datasetLabels = [
                  ...new Set(
                    completed.map((row) => {
                      const dataset = datasets.find(
                        (item) => item.key === row.dataset
                      );
                      return dataset?.name || row.dataset;
                    })
                  ),
                ];

                return (
                  <tr key={record.id} className="border-t">
                    <td className="px-3 py-2">{fmt(record.date)}</td>
                    <td className="px-3 py-2 font-medium">
                      {record.name}
                      <div className="text-xs text-slate-500">
                        {record.age ?? "—"} · {record.sex || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2">{record.district}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {labNumbers.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {datasetLabels.join(", ")}
                    </td>
                    <td className="px-3 py-2">{completed.length}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openReport(record.id)}
                      >
                        <Printer size={16} className="mr-2" />
                        Preview / Print
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
}) {
  return (
    <Card className="border p-5 shadow-none">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
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

        {(tab === "filtered" || tab === "tat") && (
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
          anyLabel={tab === "district" ? "Select district" : "Any"}
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
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
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
}) {
  const completedRows = items.flatMap((record) =>
    allSampleTests(record)
      .filter((row) => row.completed)
      .map((row) => ({ ...row, record }))
  );

  return (
    <Card className="overflow-hidden border shadow-none">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm text-slate-500">
          Completed test rows: {completedRows.length} · Matched records:{" "}
          {total}
        </div>
        <Button size="sm" variant="outline" onClick={print}>
          <Printer size={16} className="mr-2" />
          Print
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500">
              {[
                "Dataset",
                "Lab #",
                "EPID #",
                "Date",
                "Patient",
                "Age",
                "Sex",
                "Sample",
                "Test",
                "Result",
              ].map((heading) => (
                <th key={heading} className="px-3 py-2">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!completedRows.length && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-10 text-center text-slate-500"
                >
                  Apply filters to preview completed results.
                </td>
              </tr>
            )}

            {completedRows.map(({ record, ...row }) => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-2">
                  {datasets.find(
                    (dataset) => dataset.key === row.dataset
                  )?.name || row.dataset}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.lab_number}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.epid_number || "—"}
                </td>
                <td className="px-3 py-2">{fmt(record.date)}</td>
                <td className="px-3 py-2 font-medium">
                  {record.name}
                </td>
                <td className="px-3 py-2">{record.age ?? "—"}</td>
                <td className="px-3 py-2">{record.sex || "—"}</td>
                <td className="px-3 py-2">{row.sample_type}</td>
                <td className="px-3 py-2">{row.test}</td>
                <td className="px-3 py-2">{row.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
