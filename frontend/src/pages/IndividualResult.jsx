import React, { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FloppyDisk,
  MagnifyingGlass,
  ArrowLeft,
} from "@phosphor-icons/react";

const RESULT_OPTIONS = ["Positive", "Negative", "Indeterminate"];

const displayDate = (value) => {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}-${parts[1]}-${parts[0]}`
    : value;
};

const datasetLabel = (value, datasets) => {
  const item = datasets.find(
    (dataset) =>
      (dataset.key || dataset.value || dataset.name) === value
  );
  return item?.name || item?.label || value || "—";
};

const normalizeRecord = (record) => ({
  ...record,
  samples: (record.samples || []).map((sample) => ({
    ...sample,
    dataset: sample.dataset || record.dataset || "routine",
    tests: (sample.tests || []).map((test) => ({
      ...test,
      result1: test.result1 || "",
      result2: test.result2 || "",
      result_date: test.result_date || "",
      remarks: test.remarks || "",
    })),
    remarks: sample.remarks || "",
  })),
  remarks: record.remarks || "",
});

export default function IndividualResult() {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const sampleCount = useMemo(
    () => selected?.samples?.length || 0,
    [selected]
  );

  const search = async () => {
    const term = query.trim();
    if (!term) {
      toast.error("Enter a patient name, patient ID, lab number or EPID number");
      return;
    }

    setSearching(true);
    setSelected(null);

    try {
      const [recordsResponse, optionsResponse] = await Promise.all([
        api.get("/records", {
          params: {
            search: term,
            page: 1,
            page_size: 100,
          },
        }),
        api.get("/options"),
      ]);

      setRecords(recordsResponse.data?.items || []);
      setDatasets(
        optionsResponse.data?.datasets ||
          optionsResponse.data?.dataset ||
          []
      );

      if ((recordsResponse.data?.items || []).length === 0) {
        toast.info("No matching patient records found");
      }
    } catch {
      toast.error("Search failed");
    } finally {
      setSearching(false);
    }
  };

  const selectRecord = (record) => {
    setSelected(normalizeRecord(record));
  };

  const updateTest = (sampleIndex, testIndex, key, value) => {
    setSelected((current) => {
      const next = structuredClone(current);
      const test = next.samples[sampleIndex].tests[testIndex];
      test[key] = value;

      if (
        (key === "result1" || key === "result2") &&
        value &&
        !test.result_date
      ) {
        test.result_date = new Date().toISOString().slice(0, 10);
      }

      return next;
    });
  };

  const updateSampleRemarks = (sampleIndex, value) => {
    setSelected((current) => {
      const next = structuredClone(current);
      next.samples[sampleIndex].remarks = value;
      return next;
    });
  };

  const save = async () => {
    if (!selected) return;

    setSaving(true);

    try {
      const firstSample = selected.samples?.[0] || {};
      const firstTests = firstSample.tests || [];

      const payload = {
        dataset: firstSample.dataset || selected.dataset || "routine",
        date: selected.date,
        name: selected.name,
        age: selected.age ?? null,
        sex: selected.sex || null,
        district: selected.district,
        requesting_institution:
          selected.requesting_institution || null,
        epid_number: selected.epid_number || null,
        samples: selected.samples,
        remarks: selected.remarks || null,

        // Compatibility fields retained for existing reports and exports.
        sample_type: firstSample.sample_type || "",
        tests: firstTests,
        test: firstTests[0]?.test || "",
        result_date: firstTests[0]?.result_date || null,
        results: firstTests.map((test) => ({
          name: test.result1 || "",
          value: test.result2 || "",
        })),
      };

      const response = await api.put(
        `/records/${selected.id}`,
        payload
      );

      setSelected(normalizeRecord(response.data));
      scheduleDriveSync();
      toast.success("Results saved successfully");
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || "Failed to save results"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Result entry
        </div>
        <h1 className="mt-1 font-heading text-3xl font-semibold text-slate-900">
          Individual Result Entry
        </h1>
      </div>

      <Card className="border border-slate-200 bg-white p-5 shadow-none">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") search();
              }}
              placeholder="Patient name, patient ID, sample lab number or EPID number"
              className="pl-9"
            />
          </div>

          <Button
            type="button"
            onClick={search}
            disabled={searching}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </Card>

      {!selected && records.length > 0 && (
        <Card className="overflow-hidden border border-slate-200 bg-white shadow-none">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">
              Matching Patients
            </div>
            <div className="text-xs text-slate-500">
              Select a patient to enter or update results.
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {records.map((record) => (
              <button
                type="button"
                key={record.id}
                onClick={() => selectRecord(record)}
                className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition hover:bg-blue-50/50 md:grid-cols-4"
              >
                <div>
                  <div className="text-xs uppercase text-slate-500">
                    Patient
                  </div>
                  <div className="font-medium text-slate-900">
                    {record.name}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase text-slate-500">
                    Patient ID
                  </div>
                  <div className="font-mono text-xs text-slate-700">
                    {record.patient_id || "—"}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase text-slate-500">
                    Sample Lab Numbers
                  </div>
                  <div className="text-sm text-slate-700">
                    {(record.samples || [])
                      .map((sample) => sample.lab_number)
                      .filter(Boolean)
                      .join(", ") || record.lab_number || "—"}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase text-slate-500">
                    District
                  </div>
                  <div className="text-sm text-slate-700">
                    {record.district || "—"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {selected && (
        <>
          <Card className="border border-slate-200 bg-white p-5 shadow-none">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="text-2xl font-semibold text-slate-900">
                  {selected.name}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Patient ID: {selected.patient_id || "—"}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft size={16} className="mr-2" />
                Back to Search Results
              </Button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-4">
              <Info label="Date" value={displayDate(selected.date)} />
              <Info label="Age" value={selected.age ?? "—"} />
              <Info label="Sex" value={selected.sex || "—"} />
              <Info label="District" value={selected.district || "—"} />
              <Info
                label="Requesting Institution"
                value={selected.requesting_institution || "—"}
              />
              <Info
                label="EPID Number"
                value={
                  selected.epid_number ||
                  selected.samples
                    ?.map((sample) => sample.epid_number)
                    .filter(Boolean)
                    .join(", ") ||
                  "—"
                }
              />
              <Info label="Samples" value={sampleCount} />
            </div>
          </Card>

          {selected.samples.map((sample, sampleIndex) => (
            <Card
              key={sample.id || sampleIndex}
              className="overflow-hidden border border-slate-200 bg-white shadow-none"
            >
              <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center">
                <div>
                  <div className="font-semibold text-slate-900">
                    {sample.lab_number || "Lab number pending"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {datasetLabel(sample.dataset, datasets)} ·{" "}
                    {sample.sample_type || "Sample type not specified"}
                  </div>
                </div>

                {sample.epid_number && (
                  <div className="text-xs font-medium text-slate-600">
                    EPID: {sample.epid_number}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-white">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2">Test</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">
                        Additional Result
                      </th>
                      <th className="px-3 py-2">Result Date</th>
                      <th className="px-3 py-2">Test Remarks</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(sample.tests || []).map((test, testIndex) => (
                      <tr
                        key={test.id || `${test.test}-${testIndex}`}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="min-w-48 px-3 py-2 font-medium text-slate-900">
                          {test.test}
                        </td>
                        <td className="min-w-48 px-3 py-2">
                          <Input
                            list="individual-result-options"
                            value={test.result1 || ""}
                            onChange={(event) =>
                              updateTest(
                                sampleIndex,
                                testIndex,
                                "result1",
                                event.target.value
                              )
                            }
                            placeholder="Select or type result"
                          />
                        </td>
                        <td className="min-w-44 px-3 py-2">
                          <Input
                            value={test.result2 || ""}
                            onChange={(event) =>
                              updateTest(
                                sampleIndex,
                                testIndex,
                                "result2",
                                event.target.value
                              )
                            }
                            placeholder="Optional"
                          />
                        </td>
                        <td className="min-w-40 px-3 py-2">
                          <Input
                            type="date"
                            value={test.result_date || ""}
                            onChange={(event) =>
                              updateTest(
                                sampleIndex,
                                testIndex,
                                "result_date",
                                event.target.value
                              )
                            }
                          />
                        </td>
                        <td className="min-w-52 px-3 py-2">
                          <Input
                            value={test.remarks || ""}
                            onChange={(event) =>
                              updateTest(
                                sampleIndex,
                                testIndex,
                                "remarks",
                                event.target.value
                              )
                            }
                            placeholder="Optional"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-100 p-4">
                <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                  Sample Remarks
                </Label>
                <Textarea
                  rows={2}
                  className="mt-1.5"
                  value={sample.remarks || ""}
                  onChange={(event) =>
                    updateSampleRemarks(
                      sampleIndex,
                      event.target.value
                    )
                  }
                  placeholder="Remarks for this sample"
                />
              </div>
            </Card>
          ))}

          <Card className="border border-slate-200 bg-white p-5 shadow-none">
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
              Overall Report Remarks
            </Label>
            <Textarea
              rows={3}
              className="mt-1.5"
              value={selected.remarks || ""}
              onChange={(event) =>
                setSelected((current) => ({
                  ...current,
                  remarks: event.target.value,
                }))
              }
              placeholder="Remarks to include in the patient report"
            />

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                onClick={save}
                disabled={saving}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                <FloppyDisk size={16} className="mr-2" />
                {saving ? "Saving…" : "Save Results"}
              </Button>
            </div>
          </Card>

          <datalist id="individual-result-options">
            {RESULT_OPTIONS.map((result) => (
              <option key={result} value={result} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}

const Info = ({ label, value }) => (
  <div>
    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {label}
    </div>
    <div className="mt-1 text-sm text-slate-800">{value}</div>
  </div>
);
