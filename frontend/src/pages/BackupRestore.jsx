import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowClockwise,
  CheckCircle,
  CloudArrowUp,
  LinkSimple,
  Plug,
  WarningCircle,
} from "@phosphor-icons/react";

const dateTime = (value) =>
  value ? new Date(value).toLocaleString("en-IN") : "—";

const fileSize = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

export default function BackupRestore() {
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get("/backup/status");
      setStatus(response.data);
      if (response.data.connected) {
        const history = await api.get("/backup/history");
        setFiles(history.data.items || []);
      } else {
        setFiles([]);
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to load backup status");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "connected") {
      toast.success("Google Drive connected");
      window.history.replaceState({}, "", "/backup");
      load();
    }
  }, [load]);

  const connect = async () => {
    try {
      const response = await api.get("/backup/google/connect-url");
      window.location.href = response.data.authorization_url;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to connect Google Drive");
    }
  };

  const runBackup = async () => {
    setBusy(true);
    try {
      const response = await api.post("/backup/run");
      toast.success(`Backup completed: ${response.data.filename}`);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.post("/backup/disconnect");
      toast.success("Google Drive disconnected");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to disconnect");
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
          Data protection
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
          Backup &amp; Restore
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Automatic and manual database backups to Google Drive.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Status
          label="Google Drive"
          value={connected ? "Connected" : "Not connected"}
          detail={connected ? "Ready for backup" : "Connect an account"}
          good={connected}
        />
        <Status
          label="Automatic backup"
          value={status?.automatic_enabled ? "Enabled" : "Disabled"}
          detail={`${status?.schedule || "02:00"} · ${status?.timezone || "Asia/Kolkata"}`}
          good={status?.automatic_enabled}
        />
        <Status
          label="Last backup"
          value={dateTime(status?.last_backup_at)}
          detail={status?.last_backup_name || status?.last_error || "No backup yet"}
          good={status?.last_backup_status === "success"}
        />
        <Status
          label="Retention"
          value={`${status?.retention_count || 30} backups`}
          detail="Older files removed automatically"
          good
        />
      </div>

      <Card className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Google Drive connection</h2>
            <p className="mt-1 text-sm text-slate-500">
              Backups are stored in the MDS LIMS Backups folder in My Drive.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button onClick={connect} className="bg-teal-600 text-white hover:bg-teal-700">
                <Plug size={17} className="mr-2" />
                Connect Google Drive
              </Button>
            ) : (
              <>
                <Button
                  onClick={runBackup}
                  disabled={busy}
                  className="bg-teal-600 text-white hover:bg-teal-700"
                >
                  <CloudArrowUp size={17} className="mr-2" />
                  {busy ? "Backing up…" : "Backup Now"}
                </Button>
                <Button variant="outline" onClick={load}>
                  <ArrowClockwise size={17} className="mr-2" />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  onClick={disconnect}
                  className="border-red-200 text-red-600"
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">Recent backups</h2>
        </div>
        {!files.length ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {connected ? "No backup files found." : "Connect Google Drive to view backups."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div>
                  <div className="font-medium text-slate-800">{file.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {dateTime(file.createdTime)} · {fileSize(file.size)}
                  </div>
                </div>
                <a
                  href={file.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-teal-700"
                >
                  <LinkSimple size={16} />
                  Open in Drive
                </a>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Status({ label, value, detail, good }) {
  return (
    <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{detail}</div>
        </div>
        {good ? (
          <CheckCircle size={22} weight="fill" className="text-emerald-500" />
        ) : (
          <WarningCircle size={22} weight="fill" className="text-amber-500" />
        )}
      </div>
    </Card>
  );
}
