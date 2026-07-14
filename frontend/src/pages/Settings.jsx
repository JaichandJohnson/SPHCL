import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FloppyDisk } from "@phosphor-icons/react";

const splitValues = (value) =>
  String(value || "")
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

export default function Settings() {
  const [datasets, setDatasets] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [form, setForm] = useState({
    key: "",
    name: "",
    prefix: "",
    next_number: 1,
    active: true,
    testsText: "",
    samplesText: "",
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const response = await api.get("/datasets");
      setDatasets(response.data || []);
      if (!selectedKey && response.data?.length) {
        chooseDataset(response.data[0]);
      }
    } catch (error) {
      toast.error("Failed to load Dataset Master");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseDataset = (dataset) => {
    setSelectedKey(dataset.key);
    setForm({
      key: dataset.key || "",
      name: dataset.name || "",
      prefix: dataset.prefix || "",
      next_number: dataset.next_number || 1,
      active: dataset.active !== false,
      testsText: (dataset.tests || []).join("\n"),
      samplesText: (dataset.sample_types || []).join("\n"),
    });
  };

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.key || !form.name || !form.prefix) {
      toast.error("Dataset key, name and prefix are required");
      return;
    }

    setSaving(true);
    try {
      await api.post("/datasets", {
        key: form.key,
        name: form.name,
        prefix: form.prefix,
        next_number: Number(form.next_number) || 1,
        active: form.active,
        tests: splitValues(form.testsText),
        sample_types: splitValues(form.samplesText),
      });
      toast.success("Dataset Master updated");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Masters
        </div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">
          Dataset Master
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="p-3 border border-slate-200 shadow-none">
          <div className="space-y-1">
            {datasets.map((dataset) => (
              <button
                type="button"
                key={dataset.key}
                onClick={() => chooseDataset(dataset)}
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
              <Input value={form.key} onChange={(e) => update("key", e.target.value)} />
            </Field>
            <Field label="Dataset name">
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
            </Field>
            <Field label="Lab number prefix">
              <Input value={form.prefix} onChange={(e) => update("prefix", e.target.value)} />
            </Field>
            <Field label="Next number">
              <Input
                type="number"
                min="1"
                value={form.next_number}
                onChange={(e) => update("next_number", e.target.value)}
              />
            </Field>

            <div className="md:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => update("active", e.target.checked)}
                />
                Active
              </label>
            </div>

            <Field label="Valid sample types — one per line">
              <textarea
                rows={10}
                value={form.samplesText}
                onChange={(e) => update("samplesText", e.target.value)}
                className="w-full border rounded p-2 bg-white"
              />
            </Field>

            <Field label="Valid tests — one per line">
              <textarea
                rows={10}
                value={form.testsText}
                onChange={(e) => update("testsText", e.target.value)}
                className="w-full border rounded p-2 bg-white"
              />
            </Field>
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              <FloppyDisk size={16} className="mr-2" />
              {saving ? "Saving…" : "Save Dataset"}
            </Button>
          </div>
        </Card>
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
