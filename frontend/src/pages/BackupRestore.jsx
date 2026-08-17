import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowClockwise,
  CheckCircle,
  CloudArrowDown,
  CloudArrowUp,
  HardDrives,
  LinkSimple,
  LockKey,
  LockOpen,
  Plug,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";

const dateTime = (value) =>
  value ? new Date(value).toLocaleString("en-IN") : "—";

const fileSize = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

export default function BackupRestore() {
  const [unlocked, setUnlocked] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [adminPassword, setAdminPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreInfo, setRestoreInfo] = useState(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");

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
      if (error?.response?.status === 403) {
        setUnlocked(false);
        return;
      }
      toast.error(
        error?.response?.data?.detail ||
          "Failed to load backup status"
      );
    }
  }, []);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const response = await api.get("/master/status");
        const allowed = Boolean(response.data?.unlocked);
        setUnlocked(allowed);
        if (allowed) await load();
      } catch {
        setUnlocked(false);
      } finally {
        setCheckingAccess(false);
      }
    };

    checkAccess();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "connected") {
      toast.success("Google Drive connected");
      window.history.replaceState({}, "", "/backup");
      load();
    }
  }, [load]);

  const unlock = async (event) => {
    event.preventDefault();
    if (!adminPassword) {
      toast.error("Enter the admin password");
      return;
    }

    setUnlocking(true);
    try {
      await api.post("/master/unlock", {
        password: adminPassword,
      });
      setAdminPassword("");
      setUnlocked(true);
      await load();
      toast.success("Backup & Restore unlocked");
    } catch (error) {
      setUnlocked(false);
      toast.error(
        error?.response?.data?.detail ||
          "Unable to unlock Backup & Restore"
      );
    } finally {
      setUnlocking(false);
    }
  };

  const lock = async () => {
    try {
      await api.post("/master/lock");
    } finally {
      setUnlocked(false);
      setStatus(null);
      setFiles([]);
      setRestoreFile(null);
      setRestoreInfo(null);
    }
  };

  const connect = async () => {
    try {
      const response = await api.get(
        "/backup/google/connect-url"
      );
      window.location.href =
        response.data.authorization_url;
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          "Unable to connect Google Drive"
      );
    }
  };

  const runBackup = async () => {
    setBusy(true);
    try {
      const response = await api.post("/backup/run");
      toast.success(
        `Backup completed: ${response.data.filename} + ${
          response.data.excel_filename ||
          "human-readable Excel workbook"
        }`
      );
      await load();
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          "Backup failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "Disconnect Google Drive from Backup & Restore?"
      )
    ) {
      return;
    }

    try {
      await api.post("/backup/disconnect");
      toast.success("Google Drive disconnected");
      await load();
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          "Unable to disconnect"
      );
    }
  };

  const prepareRestore = async (file) => {
    setRestoreBusy(true);
    try {
      const response = await api.get(
        `/backup/inspect/${encodeURIComponent(file.id)}`
      );
      setRestoreFile(file);
      setRestoreInfo(response.data);
      setRestoreConfirmation("");
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          "Unable to inspect the selected backup"
      );
    } finally {
      setRestoreBusy(false);
    }
  };

  const restore = async () => {
    if (!restoreFile) return;

    if (restoreConfirmation !== "RESTORE") {
      toast.error('Type "RESTORE" to confirm');
      return;
    }

    setRestoreBusy(true);
    try {
      const response = await api.post("/backup/restore", {
        file_id: restoreFile.id,
        filename: restoreFile.name,
        confirmation: restoreConfirmation,
      });

      toast.success(
        `Database restored. Safety backup: ${response.data.pre_restore_backup}`
      );

      setRestoreFile(null);
      setRestoreInfo(null);
      setRestoreConfirmation("");

      // Reload all application state from the restored database.
      window.setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          "Database restore failed"
      );
    } finally {
      setRestoreBusy(false);
    }
  };

  if (checkingAccess) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Checking administrative access…
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <LockKey size={24} className="text-slate-700" />
          </div>

          <h1 className="mt-5 text-2xl font-semibold text-slate-900">
            Backup &amp; Restore is locked
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Enter the same administrator password used for Master Data.
            Access remains unlocked for the configured administrative
            session period.
          </p>

          <form onSubmit={unlock} className="mt-6 space-y-4">
            <Input
              type="password"
              value={adminPassword}
              onChange={(event) =>
                setAdminPassword(event.target.value)
              }
              placeholder="Administrator password"
              autoFocus
            />

            <Button
              type="submit"
              disabled={unlocking}
              className="w-full bg-teal-600 text-white hover:bg-teal-700"
            >
              <LockOpen size={17} className="mr-2" />
              {unlocking ? "Unlocking…" : "Unlock Backup & Restore"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const connected = Boolean(status?.connected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
            Data protection
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Backup &amp; Restore
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Database backup, human-readable Excel copy, and protected restore
            from Google Drive.
          </p>
        </div>

        <Button variant="outline" onClick={lock}>
          <LockKey size={16} className="mr-2" />
          Lock
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Status
          label="Google Drive"
          value={connected ? "Connected" : "Not connected"}
          detail={
            connected
              ? "Ready for backup & restore"
              : "Connect an account"
          }
          good={connected}
        />
        <Status
          label="Automatic backup"
          value={
            status?.automatic_enabled
              ? "Enabled"
              : "Disabled"
          }
          detail={`${status?.schedule || "02:00"} · ${
            status?.timezone || "Asia/Kolkata"
          }`}
          good={status?.automatic_enabled}
        />
        <Status
          label="Last backup"
          value={dateTime(status?.last_backup_at)}
          detail={
            status?.last_backup_name ||
            status?.last_error ||
            "No backup yet"
          }
          good={status?.last_backup_status === "success"}
        />
        <Status
          label="Retention"
          value={`${status?.retention_count || 30} backups`}
          detail="Pre-restore safety backups are also retained"
          good
        />
      </div>

      <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">Google Drive connection</h2>
            <p className="mt-1 text-sm text-slate-500">
              Each backup saves a restorable ZIP plus a human-readable
              Excel workbook in the configured MDS LIMS Backups folder.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button
                onClick={connect}
                className="bg-teal-600 text-white hover:bg-teal-700"
              >
                <Plug size={17} className="mr-2" />
                Connect Google Drive
              </Button>
            ) : (
              <>
                <Button
                  onClick={runBackup}
                  disabled={busy || restoreBusy}
                  className="bg-teal-600 text-white hover:bg-teal-700"
                >
                  <CloudArrowUp size={17} className="mr-2" />
                  {busy ? "Backing up…" : "Backup Now"}
                </Button>
                <Button
                  variant="outline"
                  onClick={load}
                  disabled={restoreBusy}
                >
                  <ArrowClockwise size={17} className="mr-2" />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  onClick={disconnect}
                  disabled={restoreBusy}
                  className="border-red-200 text-red-600"
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {restoreFile && (
        <Card className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck
              size={26}
              className="mt-0.5 shrink-0 text-amber-700"
            />
            <div className="flex-1">
              <h2 className="font-semibold text-slate-900">
                Confirm database restore
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Restoring <strong>{restoreFile.name}</strong> replaces
                database collections contained in that backup.
              </p>

              {restoreInfo && (
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                  <div>
                    <span className="font-medium">Backup created:</span>{" "}
                    {dateTime(
                      restoreInfo.metadata?.created_at_utc ||
                        restoreFile.createdTime
                    )}
                  </div>
                  <div>
                    <span className="font-medium">Collections:</span>{" "}
                    {restoreInfo.collection_count}
                  </div>
                  <div>
                    <span className="font-medium">Documents:</span>{" "}
                    {restoreInfo.total_documents}
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-lg border border-amber-200 bg-white p-3 text-sm text-slate-700">
                Before restoring, MDS LIMS will automatically create a
                fresh <strong>pre-restore safety backup</strong> of the
                current database. Active login sessions and the current
                Google Drive connection are preserved.
              </div>

              <div className="mt-4 max-w-sm">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Type RESTORE to continue
                </label>
                <Input
                  className="mt-1"
                  value={restoreConfirmation}
                  onChange={(event) =>
                    setRestoreConfirmation(
                      event.target.value.toUpperCase()
                    )
                  }
                  placeholder="RESTORE"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={restore}
                  disabled={
                    restoreBusy ||
                    restoreConfirmation !== "RESTORE"
                  }
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  <CloudArrowDown size={17} className="mr-2" />
                  {restoreBusy
                    ? "Restoring…"
                    : "Restore Database"}
                </Button>
                <Button
                  variant="outline"
                  disabled={restoreBusy}
                  onClick={() => {
                    setRestoreFile(null);
                    setRestoreInfo(null);
                    setRestoreConfirmation("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">Available backups</h2>
          <p className="mt-1 text-xs text-slate-500">
            Select Restore to inspect a backup before confirming.
          </p>
        </div>

        {!files.length ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {connected
              ? "No backup files found."
              : "Connect Google Drive to view backups."}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium text-slate-800">
                    {file.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {dateTime(file.createdTime)} ·{" "}
                    {fileSize(file.size)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => prepareRestore(file)}
                    disabled={restoreBusy}
                    className="border-amber-300 text-amber-700"
                  >
                    <HardDrives size={16} className="mr-2" />
                    Restore
                  </Button>

                  <a
                    href={file.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium text-teal-700"
                  >
                    <LinkSimple size={16} />
                    Open in Drive
                  </a>
                </div>
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
          <div className="mt-2 text-lg font-semibold text-slate-900">
            {value}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {detail}
          </div>
        </div>
        {good ? (
          <CheckCircle
            size={22}
            weight="fill"
            className="text-emerald-500"
          />
        ) : (
          <WarningCircle
            size={22}
            weight="fill"
            className="text-amber-500"
          />
        )}
      </div>
    </Card>
  );
}
