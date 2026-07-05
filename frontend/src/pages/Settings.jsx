import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash, CloudCheck, CloudSlash, ArrowsClockwise } from "@phosphor-icons/react";
import {
  isDriveConfigured, isConnected, connectDrive, disconnectDrive,
  syncNow, getLastSync, onSyncChange,
} from "@/lib/drive";

const CATS = [
  { key: "test", label: "Tests" },
  { key: "district", label: "Districts" },
  { key: "sample_type", label: "Sample Types" },
];

export default function Settings() {
  const [opts, setOpts] = useState({ test: [], district: [], sample_type: [] });
  const [inputs, setInputs] = useState({ test: "", district: "", sample_type: "" });

  const load = () => api.get("/options").then((r) => setOpts(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async (type) => {
    const value = inputs[type].trim();
    if (!value) return;
    try {
      await api.post("/options", { type, value });
      setInputs((s) => ({ ...s, [type]: "" }));
      toast.success("Added");
      load();
    } catch (e) { toast.error("Failed"); }
  };
  const del = async (type, value) => {
    try {
      await api.delete("/options", { params: { type, value } });
      toast.success("Removed");
      load();
    } catch (e) { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4" data-testid="settings-page">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Settings</div>
        <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">Manage Dropdowns</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {CATS.map((c) => (
          <Card key={c.key} className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{c.label}</div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                data-testid={`opt-input-${c.key}`}
                value={inputs[c.key]}
                onChange={(e) => setInputs((s) => ({ ...s, [c.key]: e.target.value }))}
                placeholder={`Add ${c.label.toLowerCase().slice(0, -1)}`}
                onKeyDown={(e) => e.key === "Enter" && add(c.key)}
              />
              <Button onClick={() => add(c.key)} data-testid={`opt-add-${c.key}`} className="bg-blue-600 hover:bg-blue-700 rounded-md">
                <Plus size={14} />
              </Button>
            </div>
            <ul className="mt-3 space-y-1 max-h-72 overflow-auto">
              {opts[c.key]?.map((v) => (
                <li key={v} className="flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-slate-50">
                  <span className="text-slate-800">{v}</span>
                  <button
                    onClick={() => del(c.key, v)}
                    data-testid={`opt-del-${c.key}-${v}`}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash size={14} />
                  </button>
                </li>
              ))}
              {!opts[c.key]?.length && <li className="text-xs text-slate-500 py-2">No entries.</li>}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="p-5 border border-slate-200 rounded-md shadow-none bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Google Drive · Auto Backup</div>
            <DriveStatus />
          </div>
          <DriveActions />
        </div>
      </Card>
    </div>
  );
}

const DriveStatus = () => {
  const [, force] = useState(0);
  useEffect(() => onSyncChange(() => force((x) => x + 1)), []);
  const last = getLastSync();
  if (!isDriveConfigured()) {
    return (
      <div className="mt-2 text-sm text-slate-600 leading-relaxed max-w-xl">
        Google Drive backup is not yet configured. To enable, set <span className="font-mono text-slate-900 bg-slate-100 px-1 rounded">REACT_APP_GOOGLE_CLIENT_ID</span> in <span className="font-mono">/app/frontend/.env</span> and restart the frontend. Get a Web OAuth client ID from Google Cloud Console → APIs &amp; Services → Credentials, and add your app&apos;s origin to Authorized JavaScript origins.
      </div>
    );
  }
  return (
    <div className="mt-2 text-sm text-slate-600 leading-relaxed max-w-xl">
      {isConnected() ? (
        <>
          Connected. Records are automatically backed up to your Google Drive as a single Excel file
          (<span className="font-mono">SPHCL_LabRecords_Backup.xlsx</span>) after every change (5s debounce).
          {" "}
          <span className="text-slate-500">Last sync: <span className="tabular-nums text-slate-800">{last ? last.toLocaleString() : "never"}</span></span>
        </>
      ) : (
        <>Not connected. Click <span className="font-medium text-slate-900">Connect Drive</span> to authorize once; after that, backups happen automatically.</>
      )}
    </div>
  );
};

const DriveActions = () => {
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  useEffect(() => onSyncChange(() => force((x) => x + 1)), []);
  if (!isDriveConfigured()) return null;
  const connect = async () => {
    setBusy(true);
    try { await connectDrive(); await syncNow(); toast.success("Connected and synced"); }
    catch (e) { toast.error(e.message || "Failed to connect"); }
    finally { setBusy(false); }
  };
  const disc = async () => {
    setBusy(true);
    try { await disconnectDrive(); toast.success("Disconnected"); } finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try { await syncNow(); toast.success("Synced"); }
    catch (e) { toast.error(e.message || "Sync failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2 shrink-0">
      {isConnected() ? (
        <>
          <Button variant="outline" onClick={sync} disabled={busy} data-testid="drive-sync-now" className="rounded-md">
            <ArrowsClockwise size={14} className="mr-1.5" /> Sync now
          </Button>
          <Button variant="outline" onClick={disc} disabled={busy} data-testid="drive-disconnect" className="rounded-md text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700">
            <CloudSlash size={14} className="mr-1.5" /> Disconnect
          </Button>
        </>
      ) : (
        <Button onClick={connect} disabled={busy} data-testid="drive-connect" className="rounded-md bg-slate-900 hover:bg-slate-800 text-white">
          <CloudCheck size={14} className="mr-1.5" /> Connect Drive
        </Button>
      )}
    </div>
  );
};
