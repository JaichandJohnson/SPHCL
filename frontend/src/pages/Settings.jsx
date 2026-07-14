import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FloppyDisk, Plus, Trash } from "@phosphor-icons/react";

const TABS = [
  { key: "dataset", label: "Dataset Master" },
  { key: "test", label: "Test Master" },
  { key: "district", label: "District Master" },
  { key: "sample_type", label: "Sample Master" },
];

const uniqueSorted = (values) =>
  [...new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

export default function Settings() {
  const [activeTab, setActiveTab] = useState("dataset");
  const [datasets, setDatasets] = useState([]);
  const [masters, setMasters] = useState({
    test: [],
    district: [],
    sample_type: [],
  });
  const [selectedKey, setSelectedKey] = useState("");
  const [datasetForm, setDatasetForm] = useState({
    key: "",
    name: "",
    prefix: "",
    next_number: 1,
    active: true,
    tests: [],
    sample_types: [],
  });
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const selectDataset = (dataset) => {
    setSelectedKey(dataset.key);
    setDatasetForm({
      key: dataset.key || "",
      name: dataset.name || "",
      prefix: dataset.prefix || "",
      next_number: dataset.next_number || 1,
      active: dataset.active !== false,
      tests: uniqueSorted(dataset.tests),
      sample_types: uniqueSorted(dataset.sample_types),
    });
  };

  const load = async () => {
    try {
      const [datasetResponse, masterResponse] = await Promise.all([
        api.get("/datasets"),
        api.get("/masters"),
      ]);

      const loadedDatasets = datasetResponse.data || [];
      setDatasets(loadedDatasets);
      setMasters({
        test: uniqueSorted(masterResponse.data?.test),
        district: uniqueSorted(masterResponse.data?.district),
        sample_type: uniqueSorted(masterResponse.data?.sample_type),
      });

      if (loadedDatasets.length) {
        selectDataset(
          loadedDatasets.find((dataset) => dataset.key === selectedKey) ||
            loadedDatasets[0]
        );
      }
    } catch (error) {
      toast.error("Failed to load master data");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDataset = (field, value) =>
    setDatasetForm((current) => ({ ...current, [field]: value }));

  const toggleMapping = (field, value, checked) => {
    setDatasetForm((current) => ({
      ...current,
      [field]: checked
        ? uniqueSorted([...(current[field] || []), value])
        : (current[field] || []).filter((item) => item !== value),
    }));
  };

  const saveDataset = async () => {
    if (!datasetForm.key || !datasetForm.name || !datasetForm.prefix) {
      toast.error("Dataset key, name and prefix are required");
      return;
    }

    setSaving(true);
    try {
      await api.post("/datasets", {
        ...datasetForm,
        next_number: Number(datasetForm.next_number) || 1,
      });
      toast.success("Dataset Master updated");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const currentValues = useMemo(
    () => (activeTab === "dataset" ? [] : masters[activeTab] || []),
    [activeTab, masters]
  );

  const addValue = async () => {
    const value = newValue.trim();
    if (!value) return toast.error("Enter a value");

    if (currentValues.some((item) => item.toLowerCase() === value.toLowerCase())) {
      return toast.error("This value already exists");
    }

    try {
      await api.post("/options", { type: activeTab, value });
      setNewValue("");
      toast.success("Master value added");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to add value");
    }
  };

  const deleteValue = async (value) => {
    const mapped =
      activeTab === "test"
        ? datasets.some((dataset) => (dataset.tests || []).includes(value))
        : activeTab === "sample_type"
          ? datasets.some((dataset) =>
              (dataset.sample_types || []).includes(value)
            )
          : false;

    if (mapped) {
      return toast.error(
        "Remove this value from all Dataset Master mappings before deleting it"
      );
    }

    try {
      await api.delete("/options", {
        params: { type: activeTab, value },
      });
      toast.success("Master value deleted");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to delete value");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Settings
        </div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">
          Master Data
        </h1>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant={activeTab === tab.key ? "default" : "outline"}
            onClick={() => {
              setActiveTab(tab.key);
              setNewValue("");
            }}
            className={activeTab === tab.key ? "bg-blue-600 hover:bg-blue-700" : ""}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "dataset" ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card className="p-3 border border-slate-200 shadow-none">
            <div className="space-y-1">
              {datasets.map((dataset) => (
                <button
                  key={dataset.key}
                  type="button"
                  onClick={() => selectDataset(dataset)}
                  className={`w-full text-left rounded px-3 py-2 text-sm border ${
                    selectedKey === dataset.key
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{dataset.name}</div>
                  <div className="text-xs text-slate-500">
                    {dataset.prefix} · Next {dataset.next_number || 1}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-3 p-5 border border-slate-200 shadow-none">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Dataset key">
                <Input
                  value={datasetForm.key}
                  onChange={(e) => updateDataset("key", e.target.value)}
                />
              </Field>
              <Field label="Dataset name">
                <Input
                  value={datasetForm.name}
                  onChange={(e) => updateDataset("name", e.target.value)}
                />
              </Field>
              <Field label="Lab number prefix">
                <Input
                  value={datasetForm.prefix}
                  onChange={(e) => updateDataset("prefix", e.target.value)}
                />
              </Field>
              <Field label="Next number">
                <Input
                  type="number"
                  min="1"
                  value={datasetForm.next_number}
                  onChange={(e) => updateDataset("next_number", e.target.value)}
                />
              </Field>

              <div className="md:col-span-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={datasetForm.active}
                    onCheckedChange={(checked) =>
                      updateDataset("active", !!checked)
                    }
                  />
                  Active
                </label>
              </div>

              <MappingList
                title="Valid Sample Types"
                values={masters.sample_type}
                selected={datasetForm.sample_types}
                onToggle={(value, checked) =>
                  toggleMapping("sample_types", value, checked)
                }
              />

              <MappingList
                title="Valid Tests"
                values={masters.test}
                selected={datasetForm.tests}
                onToggle={(value, checked) =>
                  toggleMapping("tests", value, checked)
                }
              />
            </div>

            <div className="mt-5 flex justify-end">
              <Button
                onClick={saveDataset}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <FloppyDisk size={16} className="mr-2" />
                {saving ? "Saving…" : "Save Dataset"}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="p-5 border border-slate-200 shadow-none">
          <h2 className="font-heading text-xl font-semibold text-slate-900">
            {TABS.find((tab) => tab.key === activeTab)?.label}
          </h2>

          <div className="mt-4 flex flex-col sm:flex-row gap-2 max-w-2xl">
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addValue();
                }
              }}
              placeholder="Enter a new master value"
            />
            <Button
              onClick={addValue}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus size={16} className="mr-2" />
              Add
            </Button>
          </div>

          <div className="mt-5 border border-slate-200 rounded-md overflow-hidden max-w-3xl">
            {currentValues.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No values available.
              </div>
            ) : (
              currentValues.map((value) => (
                <div
                  key={value}
                  className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 border-slate-100"
                >
                  <span className="text-sm text-slate-800">{value}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteValue(value)}
                    className="text-slate-500 hover:text-red-600"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function MappingList({ title, values, selected, onToggle }) {
  return (
    <div>
      <Label className="text-xs font-semibold tracking-[0.05em] uppercase text-slate-500">
        {title}
      </Label>
      <div className="mt-1.5 border border-slate-200 rounded-md bg-slate-50 max-h-72 overflow-y-auto p-2">
        {values.length === 0 ? (
          <div className="text-sm text-slate-500 p-2">
            No master values available. Add them in the corresponding master.
          </div>
        ) : (
          values.map((value) => (
            <label
              key={value}
              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white text-sm"
            >
              <Checkbox
                checked={(selected || []).includes(value)}
                onCheckedChange={(checked) => onToggle(value, !!checked)}
              />
              <span>{value}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <Label className="text-xs font-semibold tracking-[0.05em] uppercase text-slate-500">
      {label}
    </Label>
    <div className="mt-1.5">{children}</div>
  </div>
);
