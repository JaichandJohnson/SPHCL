import React, { useEffect, useState } from "react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash, FloppyDisk, X } from "@phosphor-icons/react";
import { RECORDS } from "@/constants/testIds";

const empty = () => ({
  lab_number: "", date: new Date().toISOString().slice(0, 10),
  name: "", age: "", district: "", test: "", sample_type: "",
  results: [{ name: "", value: "" }],
  result_date: "", remarks: "",
});

export default function DataEntry() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState(empty());
  const [opts, setOpts] = useState({ test: [], district: [], sample_type: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/options").then((r) => setOpts(r.data)).catch(() => {});
    if (id) {
      api.get(`/records/${id}`).then((r) => {
        const d = r.data;
        setForm({
          ...d,
          age: d.age ?? "",
          results: [{ name: "", value: "" }],
          result_date: d.result_date || "",
          remarks: d.remarks || "",
        });
      }).catch(() => toast.error("Failed to load record"));
    }
  }, [id]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updateResult = (i, k, v) => setForm((f) => {
    const r = [...f.results]; r[i] = { ...r[i], [k]: v }; return { ...f, results: r };
  });
  results: [{ name: "", value: "" }],
  const removeResult = (i) => setForm((f) => ({ ...f, results: f.results.filter((_, x) => x !== i) }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.lab_number || !form.name || !form.district || !form.test || !form.sample_type) {
      toast.error("Please fill required fields");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        age: form.age === "" ? null : Number(form.age),
        results: form.results.filter((r) => r.value !== "" || r.name !== ""),
        result_date: form.result_date || null,
        remarks: form.remarks || null,
      };
      if (id) {
        await api.put(`/records/${id}`, payload);
        toast.success("Record updated");
      } else {
        await api.post("/records", payload);
        toast.success("Record saved");
        setForm(empty());
      }
      scheduleDriveSync();
      nav("/records");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl">
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
          <Field label="Lab Number *">
            <Input data-testid={RECORDS.labNumber} value={form.lab_number} onChange={(e) => update("lab_number", e.target.value)} />
          </Field>
          <Field label="Date *">
            <Input data-testid={RECORDS.date} type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
          </Field>
          <Field label="Patient Name *">
            <Input data-testid={RECORDS.name} value={form.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
          <Field label="Age">
            <Input data-testid={RECORDS.age} type="number" min="0" value={form.age} onChange={(e) => update("age", e.target.value)} />
          </Field>
          <Field label="District *">
            <SelectField testId={RECORDS.district} value={form.district} onChange={(v) => update("district", v)} options={opts.district} placeholder="Select district" />
          </Field>
          <Field label="Test *">
            <SelectField testId={RECORDS.test} value={form.test} onChange={(v) => update("test", v)} options={opts.test} placeholder="Select test" />
          </Field>
          <Field label="Type of Sample *">
            <SelectField testId={RECORDS.sampleType} value={form.sample_type} onChange={(v) => update("sample_type", v)} options={opts.sample_type} placeholder="Select sample type" />
          </Field>
          <Field label="Result Date">
            <Input data-testid={RECORDS.resultDate} type="date" value={form.result_date} onChange={(e) => update("result_date", e.target.value)} />
          </Field>

          <div className="md:col-span-2">
            <Label className="text-xs font-semibold tracking-[0.05em] uppercase text-slate-500">Results</Label>
            <div className="mt-2 space-y-2 bg-slate-50 border border-slate-200 rounded-md p-3">
              {form.results.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    data-testid={RECORDS.resultName(i)}
                    placeholder="Result Name (e.g., Ct value)"
                    className="col-span-5 bg-white"
                    value={r.name}
                    onChange={(e) => updateResult(i, "name", e.target.value)}
                  />
                  <Input
                    data-testid={RECORDS.resultValue(i)}
                    placeholder="Value (text or number)"
                    className="col-span-6 bg-white"
                    value={r.value}
                    onChange={(e) => updateResult(i, "value", e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={RECORDS.removeResultRow(i)}
                    onClick={() => removeResult(i)}
                    disabled={form.results.length <= 1}
                    className="col-span-1 text-slate-500 hover:text-red-600"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={addResult}
                data-testid={RECORDS.addResultRow}
                className="rounded-md text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                <Plus size={14} className="mr-1.5" /> Add another result
              </Button>
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

const SelectField = ({ value, onChange, options, placeholder, testId }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger data-testid={testId} className="bg-white">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {options?.map((o) => (
        <SelectItem key={o} value={o}>{o}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);
