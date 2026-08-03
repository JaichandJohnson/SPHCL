import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle,
  MagnifyingGlass,
  Plus,
  Trash,
  FloppyDisk,
  X,
} from "@phosphor-icons/react";
import { RECORDS } from "@/constants/testIds";

const DATASETS = [
  { key: "routine", label: "Routine", prefix: "MDS" },
  { key: "mr_surveillance", label: "MR Surveillance", prefix: "MR" },
  { key: "diphtheria", label: "Diphtheria", prefix: "WD" },
  { key: "pertussis", label: "Pertussis", prefix: "WP" },
  { key: "rabies", label: "Rabies", prefix: "R" },
  { key: "fla", label: "FLA", prefix: "FLA" },
  { key: "special_serology", label: "Special Serology", prefix: "VPD" },
  { key: "typhoid_surveillance", label: "Typhoid Surveillance", prefix: "TY" },
];

const RESULT_OPTIONS = ["Positive", "Negative", "Indeterminate"];
const EPID_DATASETS = new Set(["mr_surveillance", "diphtheria", "pertussis"]);

const getSavedDataset = () =>
  localStorage.getItem("mds_last_dataset") || "routine";

const newTest = (name = "") => ({
  id: `test_${crypto.randomUUID?.() || Date.now()}`,
  test: name,
  result1: "",
  result2: "",
  result_date: "",
  remarks: "",
});

const newSample = (dataset = getSavedDataset()) => ({
  id: `sample_${crypto.randomUUID?.() || Date.now()}`,
  dataset,
  sample_type: "",
  tests: [],
  remarks: "",
  testSearch: "",
});

const empty = (dataset = getSavedDataset()) => ({
  dataset,
  date: new Date().toISOString().slice(0, 10),
  name: "",
  age: "",
  sex: "",
  district: "Trivandrum",
  requesting_institution: "",
  epid_number: "",
  samples: [newSample(dataset)],
  remarks: "",
});

const normalizeTest = (test, recordResultDate = "") => ({
  id: test.id || `test_${crypto.randomUUID?.() || Date.now()}`,
  test: test.test || test.name || "",
  result1: test.result1 || test.result_1 || test.result || "",
  result2: test.result2 || test.result_2 || "",
  result_date: test.result_date || recordResultDate || "",
  remarks: test.remarks || "",
});

const normalizeSamples = (record) => {
  if (Array.isArray(record.samples) && record.samples.length) {
    return record.samples.map((sample) => ({
      id: sample.id || `sample_${crypto.randomUUID?.() || Date.now()}`,
      dataset: sample.dataset || record.dataset || "routine",
      lab_number: sample.lab_number || "",
      sample_type: sample.sample_type || "",
      remarks: sample.remarks || "",
      testSearch: "",
      tests: (sample.tests || []).map((test) =>
        normalizeTest(test, record.result_date)
      ),
    }));
  }

  let tests = [];
  if (Array.isArray(record.tests) && record.tests.length) {
    tests = record.tests.map((test) => normalizeTest(test, record.result_date));
  } else if (record.test) {
    const firstResult =
      Array.isArray(record.results) && record.results.length
        ? record.results[0]
        : {};
    tests = [
      normalizeTest(
        {
          test: record.test,
          result1: firstResult.name || "",
          result2: firstResult.value || "",
          result_date: record.result_date || "",
        },
        record.result_date
      ),
    ];
  }

  return [
    {
      id: `sample_${crypto.randomUUID?.() || Date.now()}`,
      dataset: record.dataset || "routine",
      lab_number: record.lab_number || "",
      sample_type: record.sample_type || "",
      tests,
      remarks: "",
      testSearch: "",
    },
  ];
};

export default function DataEntry() {
  const { id } = useParams();
  const nav = useNavigate();
  const nameRef = useRef(null);

  const [form, setForm] = useState(empty());
  const [opts, setOpts] = useState({
    test: [],
    tests_by_dataset: {},
    panels_by_dataset: {},
    district: [],
    sample_type: [],
    sample_types_by_dataset: {},
    sample_mappings_by_dataset: {},
  });
  const [institutions, setInstitutions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [defaultDataset, setDefaultDataset] = useState(getSavedDataset());

  const datasetInfo = (datasetKey) =>
    DATASETS.find((dataset) => dataset.key === datasetKey) || DATASETS[0];

  const mappingsForDataset = (datasetKey) =>
    opts.sample_mappings_by_dataset?.[datasetKey] || [];

  const testOptionsForDataset = (datasetKey) => {
    const datasetTests = opts.tests_by_dataset?.[datasetKey];
    return Array.isArray(datasetTests) && datasetTests.length
      ? datasetTests
      : opts.test || [];
  };

  const sampleOptionsForDataset = (datasetKey) => {
    const mappings = mappingsForDataset(datasetKey);
    if (mappings.length) {
      return mappings
        .map((mapping) => mapping.sample_type)
        .filter(Boolean);
    }

    const datasetSamples = opts.sample_types_by_dataset?.[datasetKey];
    return Array.isArray(datasetSamples) && datasetSamples.length
      ? datasetSamples
      : opts.sample_type || [];
  };

  const mappingForSample = (sample) =>
    mappingsForDataset(sample.dataset).find(
      (mapping) =>
        String(mapping.sample_type || "").toLowerCase() ===
        String(sample.sample_type || "").toLowerCase()
    );

  const testsForSample = (sample) => {
    const mapping = mappingForSample(sample);
    return mapping
      ? mapping.tests || []
      : testOptionsForDataset(sample.dataset);
  };

  const panelOptionsForDataset = (datasetKey) =>
    opts.panels_by_dataset?.[datasetKey] || [];


  useEffect(() => {
    if (!id) {
      window.setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [id]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const optionsResponse = await api.get("/options");
        setOpts((current) => ({ ...current, ...optionsResponse.data }));

        if (id) {
          const recordResponse = await api.get(`/records/${id}`);
          const record = recordResponse.data;
          const loadedDefaultDataset =
            record.samples?.[0]?.dataset ||
            record.dataset ||
            record.dataset_type ||
            "routine";

          setDefaultDataset(loadedDefaultDataset);
          setForm({
            dataset: loadedDefaultDataset,
            date: record.date || "",
            name: record.name || "",
            age: record.age ?? "",
            sex: record.sex || "",
            district: record.district || "Trivandrum",
            requesting_institution: record.requesting_institution || "",
            epid_number: record.epid_number || "",
                      samples: normalizeSamples(record),
            remarks: record.remarks || "",
          });
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to load data");
      }
    };

    loadData();
  }, [id]);

  useEffect(() => {
    const query = form.requesting_institution.trim();
    if (!query) {
      setInstitutions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get("/institutions", {
          params: { search: query },
        });
        setInstitutions(response.data?.items || response.data || []);
      } catch {
        setInstitutions([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [form.requesting_institution]);

  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  const updateDefaultDataset = (dataset) => {
    localStorage.setItem("mds_last_dataset", dataset);
    setDefaultDataset(dataset);

    setForm((current) => {
      const samples = [...current.samples];

      if (
        samples.length === 1 &&
        !samples[0].sample_type &&
        samples[0].tests.length === 0 &&
        !samples[0].lab_number
      ) {
        samples[0] = {
          ...samples[0],
          dataset,
          sample_type: "",
          tests: [],
          testSearch: "",
        };
      }

      return {
        ...current,
        dataset,
        samples,
      };
    });
  };

  const updateSample = (sampleIndex, key, value) => {
    setForm((current) => {
      const samples = [...current.samples];
      const updated = { ...samples[sampleIndex], [key]: value };

      if (key === "dataset") {
        updated.sample_type = "";
        updated.tests = [];
        updated.testSearch = "";
      }

      if (key === "sample_type") {
        const mapping = mappingForSample(updated);
        const allowedTests = new Set((mapping?.tests || []).map(String));

        updated.tests = (updated.tests || []).filter((test) =>
          allowedTests.size ? allowedTests.has(test.test) : true
        );

        if (mapping?.auto_assign) {
          const existing = new Set(updated.tests.map((test) => test.test));
          updated.tests = [
            ...updated.tests,
            ...(mapping.tests || [])
              .filter((name) => !existing.has(name))
              .map((name) => newTest(name)),
          ];
        }

        updated.testSearch = "";
      }

      samples[sampleIndex] = updated;

      return {
        ...current,
        dataset: samples[0]?.dataset || current.dataset,
        samples,
      };
    });
  };


  const addSample = () =>
    setForm((current) => ({
      ...current,
      samples: [
        ...current.samples,
        newSample(defaultDataset || current.dataset),
      ],
    }));

  const removeSample = (sampleIndex) => {
    setForm((current) => {
      if (current.samples.length === 1) {
        toast.error("At least one sample is required");
        return current;
      }
      return {
        ...current,
        samples: current.samples.filter((_, index) => index !== sampleIndex),
      };
    });
  };

  const selectableItems = (sample) => {
    const query = (sample.testSearch || "").trim().toLowerCase();
    const allowedTests = testsForSample(sample);
    const allowedSet = new Set(allowedTests);

    const panels = panelOptionsForDataset(sample.dataset)
      .map((panel) => ({
        key: `panel::${panel.id}`,
        name: panel.name,
        kind: "panel",
        tests: (panel.tests || []).filter((test) =>
          allowedSet.size ? allowedSet.has(test) : true
        ),
      }))
      .filter((panel) => panel.tests.length > 0);

    const tests = allowedTests.map((test) => ({
      key: `test::${test}`,
      name: test,
      kind: "test",
      tests: [],
    }));

    return [...panels, ...tests].filter(
      (item) => !query || item.name.toLowerCase().includes(query)
    );
  };


  const addSelection = (sampleIndex, value) => {
    if (!value) return;

    setForm((current) => {
      const samples = [...current.samples];
      const sample = { ...samples[sampleIndex] };
      const existing = new Set(sample.tests.map((item) => item.test));

      let names = [];
      let successMessage = "";

      if (value.startsWith("panel::")) {
        const panel = panelOptionsForDataset(sample.dataset).find(
          (item) => item.id === value.slice(7)
        );
        if (!panel) return current;
        names = panel.tests || [];
        successMessage = `${panel.name} added`;
      } else {
        names = [value.startsWith("test::") ? value.slice(6) : value];
      }

      const additions = names
        .filter((name) => !existing.has(name))
        .map((name) => newTest(name));

      if (!additions.length) {
        toast.error("The selected test or panel is already added");
        return current;
      }

      sample.tests = [...sample.tests, ...additions];
      sample.testSearch = "";
      samples[sampleIndex] = sample;

      if (successMessage) toast.success(successMessage);
      return { ...current, samples };
    });
  };

  const updateTest = (sampleIndex, testIndex, key, value) => {
    setForm((current) => {
      const samples = [...current.samples];
      const sample = { ...samples[sampleIndex] };
      const tests = [...sample.tests];
      const test = { ...tests[testIndex], [key]: value };

      if (
        (key === "result1" || key === "result2") &&
        value &&
        !test.result_date
      ) {
        test.result_date = new Date().toISOString().slice(0, 10);
      }

      tests[testIndex] = test;
      sample.tests = tests;
      samples[sampleIndex] = sample;
      return { ...current, samples };
    });
  };

  const removeTest = (sampleIndex, testIndex) => {
    setForm((current) => {
      const samples = [...current.samples];
      samples[sampleIndex] = {
        ...samples[sampleIndex],
        tests: samples[sampleIndex].tests.filter(
          (_, index) => index !== testIndex
        ),
      };
      return { ...current, samples };
    });
  };



  const save = async (event) => {
    event.preventDefault();

    if (!form.name || !form.district) {
      toast.error("Please complete the required patient fields");
      return;
    }

    const invalidSample = form.samples.find(
      (sample) => !sample.sample_type || sample.tests.length === 0
    );
    if (invalidSample) {
      toast.error("Each sample needs a sample type and at least one test");
      return;
    }

    setSaving(true);
    try {
      const samples = form.samples.map((sample) => ({
        id: sample.id,
        dataset: sample.dataset,
        lab_number: sample.lab_number || null,
        sample_type: sample.sample_type,
        remarks: sample.remarks || null,
        tests: sample.tests.map((test) => ({
          id: test.id,
          test: test.test,
          result1: test.result1 || "",
          result2: test.result2 || "",
          result_date: test.result_date || null,
          remarks: test.remarks || null,
        })),
      }));

      const firstSample = samples[0] || {};
      const firstTests = firstSample.tests || [];

      const payload = {
        dataset: firstSample.dataset || form.dataset,
        date: form.date,
        name: form.name,
        age: form.age === "" ? null : Number(form.age),
        sex: form.sex || null,
        district: form.district || "Trivandrum",
        requesting_institution: form.requesting_institution || null,
        epid_number: EPID_DATASETS.has(firstSample.dataset || form.dataset)
          ? form.epid_number || null
          : null,
        samples,
        remarks: form.remarks || null,

        // Temporary compatibility for older screens and exports.
        sample_type: firstSample.sample_type || "",
        tests: firstTests,
        result_date: firstTests[0]?.result_date || null,
        test: firstTests[0]?.test || "",
        results: firstTests.map((test) => ({
          name: test.result1 || "",
          value: test.result2 || "",
        })),
      };

      let saved;
      if (id) {
        saved = await api.put(`/records/${id}`, payload);
        toast.success("Record updated");
      } else {
        saved = await api.post("/records", payload);
        toast.success("Record saved");
      }

      scheduleDriveSync();

      if (id) {
        nav("/records");
        return;
      }

      const retainedDataset =
        defaultDataset || firstSample.dataset || form.dataset;
      localStorage.setItem("mds_last_dataset", retainedDataset);
      const savedRecord = saved.data || {};
      setForm(empty(retainedDataset));
      window.setTimeout(() => nameRef.current?.focus(), 0);

      const generatedNumbers = (savedRecord.samples || [])
        .map((sample) => sample.lab_number)
        .filter(Boolean);
      if (generatedNumbers.length) {
        toast.success(`Lab Number${generatedNumbers.length > 1 ? "s" : ""}: ${generatedNumbers.join(", ")}`, {
          duration: 6000,
        });
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {id ? "Edit" : "New"}
        </div>
        <h1 className="mt-1 font-heading text-3xl font-semibold text-slate-900">
          {id ? "Update Record" : "New Lab Record"}
        </h1>
      </div>

      <Card className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm">
        <form onSubmit={save} className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
              Dataset *
            </Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DATASETS.map((dataset) => (
                <label
                  key={dataset.key}
                  className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition ${
                    defaultDataset === dataset.key
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="default-dataset"
                    value={dataset.key}
                    checked={defaultDataset === dataset.key}
                    onChange={() => updateDefaultDataset(dataset.key)}
                  />
                  <span>{dataset.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              This dataset is used automatically for new samples and remains
              selected for the next patient. Change the dataset inside an
              individual sample only when required.
            </p>
          </div>

          <Field label="Patient Name *">
            <Input
              ref={nameRef}
              autoFocus={!id}
              data-testid={RECORDS.name}
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>

          <Field label="Date *">
            <Input
              data-testid={RECORDS.date}
              type="date"
              value={form.date}
              onChange={(event) => update("date", event.target.value)}
            />
          </Field>

          <Field label="Age">
            <Input
              data-testid={RECORDS.age}
              type="number"
              min="0"
              value={form.age}
              onChange={(event) => update("age", event.target.value)}
            />
          </Field>

          <Field label="Sex">
            <select
              value={form.sex}
              onChange={(event) => update("sex", event.target.value)}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select sex</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
              <option value="Not specified">Not specified</option>
            </select>
          </Field>

          <Field label="District *">
            <select
              value={form.district}
              onChange={(event) => update("district", event.target.value)}
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select district</option>
              {!opts.district.includes("Trivandrum") && (
                <option value="Trivandrum">Trivandrum</option>
              )}
              {opts.district.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Requesting Institution">
            <Input
              list="institution-suggestions"
              value={form.requesting_institution}
              onChange={(event) =>
                update("requesting_institution", event.target.value)
              }
              placeholder="Type or select a previous institution"
            />
            <datalist id="institution-suggestions">
              {institutions.map((item) => {
                const value =
                  typeof item === "string" ? item : item.value || item.name;
                return value ? <option key={value} value={value} /> : null;
              })}
            </datalist>
          </Field>

          {EPID_DATASETS.has(
            form.samples[0]?.dataset || form.dataset
          ) && (
            <Field label="EPID Number">
              <Input
                value={form.epid_number}
                onChange={(event) => update("epid_number", event.target.value)}
              />
            </Field>
          )}

          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                  Samples *
                </Label>
                <p className="mt-1 text-xs text-slate-500">
                  Add each specimen separately and assign its associated tests.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={addSample}>
                <Plus size={16} className="mr-2" />
                Add Sample
              </Button>
            </div>

            {form.samples.map((sample, sampleIndex) => (
              <Card
                key={sample.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 shadow-none"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">
                    Sample {sampleIndex + 1}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSample(sampleIndex)}
                    className="text-slate-500 hover:text-red-600"
                  >
                    <Trash size={16} className="mr-1.5" />
                    Remove Sample
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <Field label="Dataset *">
                    <select
                      value={sample.dataset}
                      onChange={(event) =>
                        updateSample(
                          sampleIndex,
                          "dataset",
                          event.target.value
                        )
                      }
                      className="w-full rounded border bg-white p-2"
                    >
                      {DATASETS.map((dataset) => (
                        <option key={dataset.key} value={dataset.key}>
                          {dataset.label}
                        </option>
                        )
                      )}
                    </select>
                  </Field>

                  <Field label="Lab Number">
                    <Input
                      value={
                        sample.lab_number ||
                        `${datasetInfo(sample.dataset).prefix} - auto generated on save`
                      }
                      readOnly
                      className="bg-slate-50 text-slate-500"
                    />
                  </Field>

                  <Field label="Type of Sample *">
                    <select
                      value={sample.sample_type}
                      onChange={(event) =>
                        updateSample(
                          sampleIndex,
                          "sample_type",
                          event.target.value
                        )
                      }
                      className="w-full rounded border bg-white p-2"
                    >
                      <option value="">Select sample type</option>
                      {sampleOptionsForDataset(sample.dataset).map(
                        (sampleType) => (
                        <option key={sampleType} value={sampleType}>
                          {sampleType}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {sample.sample_type && mappingForSample(sample) && (
                    <p className="text-xs text-slate-500">
                      {mappingForSample(sample).auto_assign
                        ? "Mapped tests are assigned automatically. You may remove any that are not required."
                        : "Only tests mapped to this sample type are available."}
                    </p>
                  )}

                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                      Select Tests *
                    </Label>
                    <div className="mt-1.5 space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="relative">
                        <MagnifyingGlass
                          size={17}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <Input
                          value={sample.testSearch}
                          onChange={(event) =>
                            updateSample(
                              sampleIndex,
                              "testSearch",
                              event.target.value
                            )
                          }
                          placeholder="Search and click a test or panel"
                          className="pl-9"
                        />
                      </div>

                      <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                        {selectableItems(sample).map((item) => {
                          const alreadyAdded =
                            item.kind === "test" &&
                            sample.tests.some(
                              (test) => test.test === item.name
                            );

                          return (
                            <button
                              type="button"
                              key={item.key}
                              onClick={() =>
                                addSelection(sampleIndex, item.key)
                              }
                              disabled={alreadyAdded}
                              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                                alreadyAdded
                                  ? "cursor-default border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : item.kind === "panel"
                                    ? "border-indigo-200 bg-indigo-50/70 text-indigo-900 hover:bg-indigo-100"
                                    : "border-slate-200 bg-white text-slate-800 hover:border-teal-300 hover:bg-teal-50"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {alreadyAdded && (
                                  <CheckCircle size={16} weight="fill" />
                                )}
                                <span className="text-sm font-medium">
                                  {item.name}
                                </span>
                              </div>
                              {item.kind === "panel" && (
                                <div className="mt-1 text-[11px] text-indigo-600">
                                  {item.tests.length} tests
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="overflow-x-auto rounded-md border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50">
                            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              <th className="px-3 py-2">Test Name</th>
                              <th className="px-3 py-2">Result</th>
                              <th className="px-3 py-2">Additional Result</th>
                              <th className="px-3 py-2">Result Date</th>
                              <th className="px-3 py-2">Test Remarks</th>
                              <th className="px-3 py-2 text-right">Remove</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sample.tests.length === 0 && (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-3 py-6 text-center text-slate-500"
                                >
                                  No tests selected.
                                </td>
                              </tr>
                            )}

                            {sample.tests.map((test, testIndex) => (
                              <tr
                                key={test.id || `${test.test}-${testIndex}`}
                                className="border-b border-slate-100 last:border-b-0"
                              >
                                <td className="px-3 py-2 font-medium text-slate-900">
                                  {test.test}
                                </td>
                                <td className="min-w-44 px-3 py-2">
                                  <Input
                                    list="standard-result-options"
                                    value={test.result1}
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
                                <td className="min-w-40 px-3 py-2">
                                  <Input
                                    value={test.result2}
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
                                <td className="min-w-36 px-3 py-2">
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
                                <td className="min-w-44 px-3 py-2">
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
                                <td className="px-3 py-2 text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      removeTest(sampleIndex, testIndex)
                                    }
                                    className="text-slate-500 hover:text-red-600"
                                  >
                                    <Trash size={16} />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <Field label="Sample Remarks">
                    <Textarea
                      rows={2}
                      value={sample.remarks || ""}
                      onChange={(event) =>
                        updateSample(
                          sampleIndex,
                          "remarks",
                          event.target.value
                        )
                      }
                    />
                  </Field>
                </div>
              </Card>
            ))}
          </div>

          <datalist id="standard-result-options">
            {RESULT_OPTIONS.map((result) => (
              <option key={result} value={result} />
            ))}
          </datalist>

          <div className="md:col-span-2">
            <Field label="Overall Remarks">
              <Textarea
                data-testid={RECORDS.remarks}
                rows={3}
                value={form.remarks}
                onChange={(event) => update("remarks", event.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2 md:col-span-2">
            <Button
              type="button"
              variant="ghost"
              data-testid={RECORDS.cancel}
              onClick={() => nav("/records")}
            >
              <X size={14} className="mr-1.5" />
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              data-testid={RECORDS.submit}
              className="h-10 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              <FloppyDisk size={16} className="mr-2" />
              {saving ? "Saving…" : id ? "Update Record" : "Save Record"}
            </Button>
          </div>
        </form>
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
