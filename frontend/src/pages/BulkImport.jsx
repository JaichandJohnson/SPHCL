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

      const r = await api.post("/records/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

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
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Bulk import
        </div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">
          Import from CSV / Excel
        </h1>
      </div>

      <Card className="p-6 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="flex items-start gap-3 rounded-md border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
          <Info size={20} className="mt-0.5 text-blue-600 shrink-0" />
          <div className="space-y-2">
            <div className="font-semibold text-slate-900">Column requirements</div>
            <div>
              Required columns: <b>dataset</b>, <b>date</b>, <b>name</b>, <b>district</b>, <b>sample_type</b>, and <b>test</b>.
              Optional columns: <b>age</b>, <b>result_1</b>, <b>result_2</b>, <b>result_date</b>, and <b>remarks</b>.
            </div>
            <div>
              Do not include lab number in the import file. The system will automatically assign lab numbers using the selected dataset prefix,
              such as MDS, MR, WD, WP, R, FLA, or VPD.
            </div>
            <div>
              Multiple consecutive rows with the same dataset, date, patient, district, and sample type will be imported as one lab record with multiple tests.
              The Excel row order will be retained.
            </div>
          </div>
        </div>

        <label className="mt-5 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:bg-slate-100">
          <FileCsv size={34} className="text-slate-500" />
          <div className="mt-3 font-medium text-slate-900">
            {file ? file.name : "Choose CSV / XLSX file"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {file ? `${(file.size / 1024).toFixed(1)} KB` : "Drag & drop or click"}
          </div>
          <input
            data-testid={IMPORT.fileInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>

        <div className="mt-5 flex justify-end">
          <Button
            data-testid={IMPORT.uploadButton}
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <UploadSimple size={16} className="mr-2" />
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>

        {result && (
          <div data-testid={IMPORT.result} className="mt-5 rounded-md border border-slate-200 bg-white p-4 text-sm">
            <div className="font-semibold text-slate-900">Import Result</div>
            <div className="mt-2 text-slate-700">Inserted: {result.inserted}</div>
            {typeof result.rows_processed !== "undefined" && (
              <div className="text-slate-700">Rows processed: {result.rows_processed}</div>
            )}
            {result.errors?.length > 0 && (
              <div className="mt-3">
                <div className="font-medium text-red-700">Errors ({result.errors.length})</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-red-700">
                  {result.errors.map((e, i) => (
                    <li key={i}>Row {e.row}: {e.error}</li>
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
