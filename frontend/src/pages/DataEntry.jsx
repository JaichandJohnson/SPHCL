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
import { Plus, Trash, FloppyDisk, X } from "@phosphor-icons/react";
import { RECORDS } from "@/constants/testIds";

const DATASETS = [
  { key: "routine", label: "Routine", prefix: "MDS" },
  { key: "mr_surveillance", label: "MR Surveillance", prefix: "MR" },
  { key: "diphtheria", label: "Diphtheria", prefix: "WD" },
  { key: "pertussis", label: "Pertussis", prefix: "WP" },
  { key: "rabies", label: "Rabies", prefix: "R" },
  { key: "fla", label: "FLA", prefix: "FLA" },
  { key: "special_serology", label: "Special Serology", prefix: "VPD" },
];

const RESULT_OPTIONS = ["Positive", "Negative", "Indeterminate"];

const getSavedDataset = () => localStorage.getItem("mds_last_dataset") || "routine";

const empty = (dataset = getSavedDataset()) => ({
  dataset,
  lab_number: "",
  date: new Date().toISOString().slice(0, 10),
  name: "",
  age: "",
  district: "",
  sample_type: "",
  selected_test: "",
  tests: [],
  result_date: "",
  remarks: "",
});

const normalizeTests = (record) => {
  if (Array.isArray(record.tests) && record.tests.length) {
    return record.tests.map((t) => ({
      test: t.test || t.name || "",
      result1: t.result1 || t.result_1 || t.result || "",
      result2: t.result2 || t.result_2 || "",
      result_date: t.result_date || record.result_date || "",
    }));
  }

  // Backward compatibility with old record structure.
  if (record.test) {
    const firstResult = Array.isArray(record.results) && record.results.length ? record.results[0] : {};
    return [
      {
        test: record.test,
        result1: firstResult.name || "",
        result2: firstResult.value || "",
        result_date: record.result_date || "",
      },
    ];
  }

  return [];
};

export default function DataEntry() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState(empty());
  const [opts, setOpts] = useState({ test: [], tests_by_dataset: {}, panels_by_dataset: {}, district: [], sample_type: [] });
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  const selectedDataset = DATASETS.find((d) => d.key === form.dataset) || DATASETS[0];

  const testOptions = useMemo(() => {
    const datasetTests = opts.tests_by_dataset?.[form.dataset];
    return Array.isArray(datasetTests) && datasetTests.length ? datasetTests : opts.test || [];
  }, [opts, form.dataset]);

  const sampleOptions = useMemo(() => {
    const datasetSamples = opts.sample_types_by_dataset?.[form.dataset];
    return Array.isArray(datasetSamples) && datasetSamples.length
      ? datasetSamples
      : opts.sample_type || [];
  }, [opts, form.dataset]);

  const panelOptions = useMemo(() => opts.panels_by_dataset?.[form.dataset] || [], [opts, form.dataset]);

  useEffect(() => {
    if (!id) {
      window.setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [id]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const optionsResponse = await api.get("/options");
        setOpts({
          test: [],
          tests_by_dataset: {},
          district: [],
          sample_type: [],
          sample_types_by_dataset: {},
          panels_by_dataset: {},
          ...optionsResponse.data,
        });

        if (id) {
          const recordResponse = await api.get(`/records/${id}`);
          const d = recordResponse.data;

          setForm({
            dataset: d.dataset || d.dataset_type || "routine",
            lab_number: d.lab_number || "",
            date: d.date || "",
            name: d.name || "",
            age: d.age ?? "",
            district: d.district || "",
            sample_type: d.sample_type || "",
            selected_test: "",
            tests: normalizeTests(d),
            result_date: d.result_date || "",
            remarks: d.remarks || "",
          });
        }
      } catch (err) {
        console.error(err);
        toast.error("Failed to load data");
      }
    };

    loadData();
  }, [id]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const updateDataset = (dataset) => {
    localStorage.setItem("mds_last_dataset", dataset);
    setForm((f) => ({
      ...f,
      dataset,
      selected_test: "",
      tests: [],
      lab_number: id ? f.lab_number : "",
    }));
  };

  const appendSelectedTest = () => {
    if (!form.selected_test) {
      toast.error("Please select a test");
      return;
    }

    if (form.tests.some((t) => t.test === form.selected_test)) {
      toast.error(`${form.selected_test} has already been added for this sample`);
      return;
    }

    setForm((f) => ({
      ...f,
      tests: [
        ...f.tests,
        {
          test: f.selected_test,
          result1: "",
          result2: "",
          result_date: "",
        },
      ],
      selected_test: "",
    }));
  };

  const selectTest = (value) => {
    if (!value) return update("selected_test", "");
    if (value.startsWith("panel::")) {
      const panel = panelOptions.find((item) => item.id === value.slice(7));
      if (!panel) return;
      setForm((current) => {
        const existing = new Set(current.tests.map((item) => item.test));
        const additions = (panel.tests || []).filter((name) => !existing.has(name)).map((name) => ({ test: name, result1: "", result2: "", result_date: "" }));
        if (!additions.length) { toast.error("All tests in this panel are already added"); return { ...current, selected_test: "" }; }
        toast.success(`${panel.name} added`);
        return { ...current, selected_test: "", tests: [...current.tests, ...additions] };
      });
      return;
    }
    if (form.tests.some((item) => item.test === value)) { toast.error(`${value} has already been added for this sample`); return; }
    if (form.tests.length === 0) { setForm((current) => ({ ...current, selected_test: "", tests: [{ test: value, result1: "", result2: "", result_date: "" }] })); return; }
    update("selected_test", value);
  };

  const updateTest = (i, k, v) => {
    setForm((f) => {
      const tests = [...f.tests];
      const current = { ...tests[i], [k]: v };

      if ((k === "result1" || k === "result2") && v && !current.result_date) {
        current.result_date = new Date().toISOString().slice(0, 10);
      }

      tests[i] = current;
      return { ...f, tests };
    });
  };

  const removeTest = (i) => {
    setForm((f) => ({ ...f, tests: f.tests.filter((_, x) => x !== i) }));
  };

  const save = async (e) => {
    e.preventDefault();

    if (!form.dataset || !form.name || !form.district || !form.sample_type || form.tests.length === 0) {
      toast.error("Please fill required fields and add at least one test");
      return;
    }

    setSaving(true);
    try {
      const cleanedTests = form.tests.map((t) => ({
        test: t.test,
        result1: t.result1 || "",
        result2: t.result2 || "",
        result_date: t.result_date || form.result_date || null,
      }));

      const payload = {
        dataset: form.dataset,
        lab_number: form.lab_number || null,
        date: form.date,
        name: form.name,
        age: form.age === "" ? null : Number(form.age),
        district: form.district,
        sample_type: form.sample_type,
        tests: cleanedTests,
        result_date: form.result_date || null,
        remarks: form.remarks || null,

        // Temporary backward-compatible fields. These can be removed after backend is refactored.
        test: cleanedTests[0]?.test || "",
        results: cleanedTests.map((t) => ({ name: t.result1, value: t.result2 })),
      };

      if (id) {
        await api.put(`/records/${id}`, payload);
        toast.success("Record updated");
        scheduleDriveSync();
        nav("/records");
      } else {
        await api.post("/records", payload);
        toast.success("Record saved");
        const retainedDataset = form.dataset;
        localStorage.setItem("mds_last_dataset", retainedDataset);
        setForm(empty(retainedDataset));
        scheduleDriveSync();
        window.setTimeout(() => nameRef.current?.focus(), 0);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {id ? "Edit" : "New"}
        </div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">
          {id ? "Update Record" : "New Lab Record"}
        </h1>
      </div>

      <Card className="p-6 border border-slate-200 rounded-md shadow-none bg-white">
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <Label className="text-xs font-semibold tracking-[0.05em] uppercase text-slate-500">
              Dataset *
            </Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DATASETS.map((dataset) => (
                <label
                  key={dataset.key}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs cursor-pointer whitespace-nowrap ${
                    form.dataset === dataset.key
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="dataset"
                    value={dataset.key}
                    checked={form.dataset === dataset.key}
                    onChange={() => updateDataset(dataset.key)}
                  />
                  <span>{dataset.label}</span>
                  <span className="ml-auto text-xs font-mono text-slate-500">{dataset.prefix}</span>
                </label>
              ))}
            </div>
          </div>

          <Field label="Lab Number">
            <Input
              data-testid={RECORDS.labNumber}
              value={form.lab_number || `${selectedDataset.prefix} - auto generated on save`}
              readOnly
              className="bg-slate-50 text-slate-500"
            />
          </Field>

          <Field label="Date *">
            <Input data-testid={RECORDS.date} type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
          </Field>

          <Field label="Patient Name *">
            <Input ref={nameRef} autoFocus={!id} data-testid={RECORDS.name} value={form.name} onChange={(e) => update("name", e.target.value)} />
          </Field>

          <Field label="Age">
            <Input data-testid={RECORDS.age} type="number" min="0" value={form.age} onChange={(e) => update("age", e.target.value)} />
          </Field>

          <Field label="District *">
            <select
              value={form.district}
              onChange={(e) => update("district", e.target.value)}
              className="w-full border rounded p-2 bg-white"
            >
              <option value="">Select district</option>
              {opts.district.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Field>

          <Field label="Type of Sample *">
            <select
              value={form.sample_type}
              onChange={(e) => update("sample_type", e.target.value)}
              className="w-full border rounded p-2 bg-white"
            >
              <option value="">Select sample type</option>
              {sampleOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>

          <div className="md:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
              Select Tests *
            </Label>
            <div className="mt-1.5 bg-slate-50 border border-slate-200 rounded-md p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                <select
                  value={form.selected_test}
                  onChange={(e) => selectTest(e.target.value)}
                  className="md:col-span-10 bg-white border rounded p-2"
                >
                  <option value="">Select test or panel</option>
                  {panelOptions.length > 0 && <optgroup label="Panels">{panelOptions.map((panel) => <option key={panel.id} value={`panel::${panel.id}`}>{panel.name}</option>)}</optgroup>}
                  <optgroup label="Individual Tests">{testOptions.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>
                </select>

                <Button
                  type="button"
                  variant="outline"
                  onClick={appendSelectedTest}
                  className="md:col-span-2 rounded-md text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                  <Plus size={14} className="mr-1.5" /> Add Another Test
                </Button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 w-[35%]">Test Name</th>
                      <th className="px-3 py-2 w-[25%]">Result Field 1</th>
                      <th className="px-3 py-2 w-[25%]">Result Field 2</th>
                      <th className="px-3 py-2 w-[10%]">Result Date</th>
                      <th className="px-3 py-2 text-right w-[5%]">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.tests.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                          No test selected. Select the first test above; it will be added automatically.
                        </td>
                      </tr>
                    )}

                    {form.tests.map((t, i) => (
                      <tr key={`${t.test}-${i}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-3 py-2 font-medium text-slate-900">{t.test}</td>
                        <td className="px-3 py-2">
                          <select
                            className="w-full bg-white border rounded p-2"
                            value={t.result1}
                            onChange={(e) => updateTest(i, "result1", e.target.value)}
                          >
                            <option value="">Select result</option>
                            {RESULT_OPTIONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            placeholder="Optional"
                            value={t.result2}
                            onChange={(e) => updateTest(i, "result2", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="date"
                            value={t.result_date || form.result_date}
                            onChange={(e) => updateTest(i, "result_date", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTest(i)}
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

          <div className="md:col-span-2">
            <Field label="Remarks">
              <Textarea data-testid={RECORDS.remarks} rows={2} value={form.remarks} onChange={(e) => update("remarks", e.target.value)} />
            </Field>
          </div>

          <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="ghost"
              data-testid={RECORDS.cancel}
              onClick={() => nav("/records")}
            >
              <X size={14} className="mr-1.5" /> Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              data-testid={RECORDS.submit}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-md h-10"
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
    <Label className="text-xs font-semibold tracking-[0.05em] uppercase text-slate-500">{label}</Label>
    <div className="mt-1.5">{children}</div>
  </div>
);
