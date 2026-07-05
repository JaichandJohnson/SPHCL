import React, { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadSimple, FileCsv, Info } from "@phosphor-icons/react";
import { IMPORT } from "@/constants/testIds";

export default function BulkImport() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) return toast.error("Choose a CSV/Excel file first");
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/records/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data);
      toast.success(`Imported ${r.data.inserted} records`);
      scheduleDriveSync();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4" data-testid="import-page">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Bulk import</div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">Import from CSV / Excel</h1>
      </div>

      <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm">
          <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-slate-900">Column requirements</div>
            <div className="text-slate-600 mt-1 text-xs leading-relaxed">
              Required columns: <span className="font-mono">lab_number, date, name, district, test, sample_type</span>.
              Optional: <span className="font-mono">age, result_date, remarks, result_1, result_2, …</span>.
              Header names are case-insensitive; spaces converted to underscores.
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label className="flex-1 flex items-center gap-3 border border-dashed border-slate-300 rounded-md px-4 py-3 cursor-pointer hover:bg-slate-50">
            <FileCsv size={22} className="text-slate-500" />
            <div className="text-sm">
              <div className="font-medium text-slate-900">{file ? file.name : "Choose CSV / XLSX file"}</div>
              <div className="text-xs text-slate-500">{file ? `${(file.size / 1024).toFixed(1)} KB` : "Drag & drop or click"}</div>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              data-testid={IMPORT.fileInput}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <Button onClick={submit} disabled={!file || busy} data-testid={IMPORT.uploadButton} className="bg-blue-600 hover:bg-blue-700 rounded-md h-11">
            <UploadSimple size={16} className="mr-2" /> {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>

        {result && (
          <div data-testid={IMPORT.result} className="mt-4 p-3 border border-slate-200 rounded-md bg-slate-50 text-sm">
            <div className="text-slate-900 font-medium">
              Inserted: <span className="tabular-nums">{result.inserted}</span>
            </div>
            {result.errors?.length > 0 && (
              <div className="mt-2">
                <div className="text-red-600 font-medium">Errors ({result.errors.length}):</div>
                <ul className="mt-1 text-xs text-slate-600 space-y-1 max-h-40 overflow-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}><span className="font-mono">Row {e.row}:</span> {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
