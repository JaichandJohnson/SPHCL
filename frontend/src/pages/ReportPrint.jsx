import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import logo from "@/assets/mds-logo.png";
import reportSignature from "@/assets/report-signature.png";

const EPID_DATASETS = new Set([
  "mr_surveillance",
  "diphtheria",
  "pertussis",
]);

const DATASET_TITLES = {
  routine: "Laboratory Test Report",
  mr_surveillance: "Measles / Rubella Surveillance Sample Report",
  diphtheria: "Diphtheria Surveillance Report",
  pertussis: "Pertussis Surveillance Report",
  rabies: "National Rabies Control Programme - Rabies Surveillance Report",
  fla: "Amoebic Meningoencephalitis Report",
  special_serology: "Special Serology Report",
  typhoid_surveillance: "Typhoid Surveillance Report",
};

const fmt = (value) => {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : value;
};

const reportDate = (record) => {
  const dates = (record.samples || []).flatMap((sample) =>
    (sample.tests || [])
      .map((test) => test.result_date)
      .filter(Boolean)
  );
  return dates.sort().at(-1) || record.date;
};

const completedSamples = (record) =>
  (record.samples || [])
    .map((sample) => ({
      ...sample,
      tests: (sample.tests || []).filter(
        (test) =>
          String(test.result1 || "").trim() ||
          String(test.result2 || "").trim()
      ),
    }))
    .filter((sample) => sample.tests.length);

export default function ReportPrint() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") || "individual";
  const [record, setRecord] = useState(null);
  const [records, setRecords] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportRemarks, setReportRemarks] = useState("");
  const [selectedPrintRows, setSelectedPrintRows] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      if (type === "individual") {
        setReportRemarks(
          localStorage.getItem("mds_individual_report_remarks") || ""
        );
      } else {
        try {
          const payload = JSON.parse(
            localStorage.getItem(
              "mds_consolidated_report_payload"
            ) || "{}"
          );
          setReportRemarks(payload.remarks || "");
          setSelectedPrintRows(payload.selectedRows || []);
        } catch {
          setReportRemarks("");
          setSelectedPrintRows([]);
        }
      }
      try {
        const optionsResponse = await api.get("/options");
        setDatasets(
          optionsResponse.data?.datasets ||
            optionsResponse.data?.dataset ||
            []
        );

        if (type === "individual") {
          const id = searchParams.get("id");
          const response = await api.get(`/records/${id}`);
          setRecord(response.data);
        } else {
          const response = await api.get("/records", {
            params: {
              district: searchParams.get("district") || undefined,
              dataset: searchParams.get("dataset") || undefined,
              date_from: searchParams.get("date_from") || undefined,
              date_to: searchParams.get("date_to") || undefined,
              page: 1,
              page_size: 2000,
            },
          });
          setRecords(response.data?.items || []);
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [searchParams, type]);

  const selectedTest = searchParams.get("test") || "";
  const selectedPanelId = searchParams.get("panel") || "";
  const selectedSpecimen = searchParams.get("specimen") || "";
  const template = searchParams.get("template") || "generic";

  const districtRows = useMemo(() => {
    const panel = (
      datasets.length
        ? []
        : []
    );
    return records.flatMap((item) =>
      completedSamples(item).flatMap((sample) =>
        sample.tests
          .filter(
            (test) =>
              (!selectedTest || test.test === selectedTest) &&
              (!selectedSpecimen ||
                sample.sample_type === selectedSpecimen)
          )
          .map((test, index) => ({
            key: `${item.id}-${sample.id}-${test.id || index}`,
            record: item,
            sample,
            test,
          }))
      )
    );
  }, [
    records,
    selectedTest,
    selectedSpecimen,
  ]);

  if (loading) {
    return <div className="p-10 text-center">Loading report…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 py-5 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-between px-3">
        <Button variant="outline" onClick={() => navigate("/reports")}>
          <ArrowLeft size={16} className="mr-2" />
          Back to Reports
        </Button>
        <Button onClick={() => window.print()}>
          <Printer size={16} className="mr-2" />
          Print / Save as PDF
        </Button>
      </div>

      {type === "individual" ? (
        record ? (
          <IndividualDocument
            record={record}
            datasets={datasets}
            reportRemarks={reportRemarks}
          />
        ) : (
          <div className="p-10 text-center">Record not found.</div>
        )
      ) : (
        <DistrictDocument
          rows={districtRows}
          datasets={datasets}
          district={searchParams.get("district")}
          dataset={searchParams.get("dataset")}
          dateFrom={searchParams.get("date_from")}
          dateTo={searchParams.get("date_to")}
          selectedTest={selectedTest}
          selectedSpecimen={selectedSpecimen}
          template={template}
          reportRemarks={reportRemarks}
          selectedPrintRows={selectedPrintRows}
        />
      )}

      <style>{`
        @page {
          size: A4;
          margin: 12mm;
        }

        @media print {
          .no-print {
            display: none !important;
          }

          body {
            background: white !important;
          }

          .report-sheet {
            width: auto !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }

          .avoid-break {
            break-inside: avoid;
          }

          thead {
            display: table-header-group;
          }
        }
      `}</style>
    </div>
  );
}

function Header({ title }) {
  return (
    <header className="relative min-h-[145px] border-b-2 border-black pb-4 text-center">
      <img
        src={logo}
        alt=""
        className="absolute left-0 top-5 h-36 w-36 rounded-full object-contain"
      />

      <div className="mx-auto flex min-h-[112px] max-w-[540px] flex-col items-center justify-center px-4">
        <div className="text-center text-[18px] font-bold uppercase leading-snug tracking-wide">
          State Public Health and Clinical Laboratory, Trivandrum
        </div>
        <div className="mt-2 text-center text-[15px] font-semibold uppercase">
          Molecular Diagnosis Section
        </div>
      </div>

      <div className="mt-1 text-center text-[15px] font-bold">
        {title}
      </div>
    </header>
  );
}

function IndividualDocument({ record, datasets, reportRemarks }) {
  const samples = completedSamples(record);
  const primaryDataset = samples[0]?.dataset || record.dataset;
  const title =
    DATASET_TITLES[primaryDataset] || "Laboratory Test Report";

  return (
    <main className="report-sheet mx-auto min-h-[297mm] w-[210mm] bg-white p-[14mm] text-[12px] text-black shadow-lg">
      <Header title={title} />

      <section className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3">
        <Info label="Name" value={record.name} />
        <Info label="Age" value={record.age ?? "—"} />
        <Info label="Sex" value={record.sex || "—"} />
        <Info
          label="Referred from"
          value={record.requesting_institution || "—"}
        />
        <Info label="District" value={record.district || "—"} />
        <Info label="Received on" value={fmt(record.date)} />
      </section>

      <section className="mt-7 space-y-6">
        {samples.map((sample, sampleIndex) => (
          <div
            key={sample.id || sampleIndex}
            className="avoid-break"
          >
            <div
              className={`mb-2 grid border border-black ${
                EPID_DATASETS.has(sample.dataset)
                  ? "grid-cols-3"
                  : "grid-cols-2"
              }`}
            >
              <InfoCell
                label="Specimen No."
                value={sample.lab_number || "—"}
              />
              {EPID_DATASETS.has(sample.dataset) && (
                <InfoCell
                  label="EPID No."
                  value={sample.epid_number || "—"}
                />
              )}
              <InfoCell
                label="Specimen"
                value={sample.sample_type || "—"}
              />
            </div>

            <table className="w-full border-collapse border border-black">
              <thead>
                <tr>
                  <th className="w-12 border border-black px-2 py-2 text-center">
                    Sl.
                  </th>
                  <th className="border border-black px-3 py-2 text-left">
                    Test
                  </th>
                  <th className="w-56 border border-black px-3 py-2 text-left">
                    Result
                  </th>
                  <th className="w-28 border border-black px-3 py-2 text-left">
                    Result Date
                  </th>
                  <th className="w-40 border border-black px-3 py-2 text-left">
                    Test Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {sample.tests.map((test, index) => (
                  <tr key={test.id || index}>
                    <td className="border border-black px-2 py-3 text-center">
                      {index + 1}
                    </td>
                    <td className="border border-black px-3 py-3">
                      {test.test}
                    </td>
                    <td className="border border-black px-3 py-3 font-semibold">
                      {[test.result1, test.result2]
                        .filter(Boolean)
                        .join(" / ")}
                    </td>
                    <td className="border border-black px-3 py-3">
                      {fmt(test.result_date)}
                    </td>
                    <td className="border border-black px-3 py-3">
                      {test.remarks || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {sample.remarks && (
              <div className="mt-2">
                <span className="font-semibold">Sample Remarks: </span>
                {sample.remarks}
              </div>
            )}
          </div>
        ))}
      </section>

      {reportRemarks && (
        <section className="mt-7 min-h-20">
          <span className="font-semibold">Remarks: </span>
          {reportRemarks}
        </section>
      )}

      {reportRemarks && (
        <section className="mt-7">
          <span className="font-semibold">Remarks: </span>
          {reportRemarks}
        </section>
      )}

      <footer className="mt-12 flex items-end justify-between">
        <div>
          <span className="font-semibold">Date: </span>
          {fmt(reportDate(record))}
        </div>
        <div className="w-52 text-center">
          <img
            src={reportSignature}
            alt="Authorized signature"
            className="mx-auto h-20 w-44 object-contain"
          />
          <div className="border-t border-black pt-2">
            Authorized Signature
          </div>
        </div>
      </footer>
    </main>
  );
}

function DistrictDocument({
  rows,
  datasets,
  district,
  dataset,
  dateFrom,
  dateTo,
  selectedTest,
  selectedSpecimen,
  template,
  reportRemarks,
  selectedPrintRows,
}) {
  const isQuantitation = template === "quantitation";

  return (
    <main className="report-sheet mx-auto min-h-[297mm] w-[210mm] bg-white p-[10mm] text-[10px] text-black shadow-lg">
      <Header title="Consolidated Laboratory Report" />

      <section className="mt-4 grid grid-cols-3 gap-3 border border-black p-3">
        <Info label="District" value={district || "—"} />
        <Info label="Specimen" value={selectedSpecimen || "All"} />
        <Info label="Test" value={selectedTest || "Selected Panel"} />
      </section>

      <table className="mt-4 w-full border-collapse border border-black">
        <thead>
          <tr>
            {[
              "Sl.",
              "Lab No.",
              "EPID No.",
              "Name",
              "Age",
              "Sex",
              "Requesting Institution",
              "Date Received",
              isQuantitation ? "Result 1" : "Result",
              ...(isQuantitation ? ["Result 2"] : []),
            ].map((heading) => (
              <th
                key={heading}
                className="border border-black px-1.5 py-2 text-left"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((row) =>
              !selectedPrintRows.length ||
              selectedPrintRows.includes(row.key)
            )
            .map(({ record, sample, test }, index) => {
            const showEpid = EPID_DATASETS.has(sample.dataset);
            return (
              <tr key={`${record.id}-${sample.id}-${test.id || index}`}>
                <td className="border border-black px-1.5 py-2">
                  {index + 1}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {sample.lab_number || "—"}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {showEpid ? sample.epid_number || "—" : ""}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {record.name}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {record.age ?? "—"}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {record.sex || "—"}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {record.requesting_institution || "—"}
                </td>
                <td className="border border-black px-1.5 py-2">
                  {fmt(record.date)}
                </td>
                <td className="border border-black px-1.5 py-2 font-semibold">
                  {test.result1 || "—"}
                </td>
                {isQuantitation && (
                  <td className="border border-black px-1.5 py-2 font-semibold">
                    {test.result2 || "—"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <footer className="mt-12 flex items-end justify-between">
        <div>
          <span className="font-semibold">Generated on: </span>
          {new Date().toLocaleDateString("en-GB")}
        </div>
        <div className="w-52 text-center">
          <img
            src={reportSignature}
            alt="Authorized signature"
            className="mx-auto h-20 w-44 object-contain"
          />
          <div className="border-t border-black pt-2">
            Authorized Signature
          </div>
        </div>
      </footer>
    </main>
  );
}

const Info = ({ label, value }) => (
  <div>
    <span className="font-semibold">{label}: </span>
    <span>{value || "—"}</span>
  </div>
);

const InfoCell = ({ label, value }) => (
  <div className="border-r border-black p-2 last:border-r-0">
    <div className="text-[9px] font-semibold uppercase">{label}</div>
    <div className="mt-1 font-medium">{value}</div>
  </div>
);
