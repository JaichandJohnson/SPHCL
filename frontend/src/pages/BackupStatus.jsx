import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowClockwise,
  CheckCircle,
  CloudArrowUp,
  WarningCircle,
} from "@phosphor-icons/react";

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatSize = (bytes) => {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export default function BackupStatus() {
  const [data, setData] = useState({
    enabled: false,
    configured: false,
    latest: null,
    recent: [],
  });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/backup/status");
      setData(response.data);
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || "Failed to load backup status"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const backupNow = async () => {
    setRunning(true);
    try {
      const response = await api.post("/backup/run");
      toast.success(`Backup completed: ${response.data.filename}`);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Backup failed");
    } finally {
      setRunning(false);
    }
  };

  const success = data.latest?.status === "success";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
            Infrastructure
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            Google Drive Backup
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Automatic off-site backups of laboratory records and master data.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <ArrowClockwise size={16} className="mr-2" />
            Refresh
          </Button>
          <Button
            onClick={backupNow}
            disabled={running || !data.configured}
            className="bg-teal-600 text-white hover:bg-teal-700"
          >
            <CloudArrowUp size={17} className="mr-2" />
            {running ? "Backing up…" : "Backup Now"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatusCard
          label="Configuration"
          value={data.configured ? "Configured" : "Not configured"}
          good={data.configured}
        />
        <StatusCard
          label="Automatic Backup"
          value={data.enabled ? "Enabled" : "Disabled"}
          good={data.enabled}
        />
        <StatusCard
          label="Last Backup"
          value={formatDateTime(data.latest?.completed_at)}
          good={success}
        />
        <StatusCard
          label="Retention"
          value={`${data.retention_count || 30} backups`}
          good
        />
      </div>

      <Card className="border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          {success ? (
            <CheckCircle
              size={26}
              weight="fill"
              className="mt-0.5 text-emerald-600"
            />
          ) : (
            <WarningCircle
              size={26}
              weight="fill"
              className="mt-0.5 text-amber-500"
            />
          )}
          <div>
            <div className="font-semibold text-slate-900">
              {success
                ? "The latest backup completed successfully"
                : data.latest?.status === "failed"
                  ? "The latest backup failed"
                  : "No completed backup is available yet"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Schedule: {data.schedule || "Daily at 02:00 IST"}
            </div>
            {data.latest?.error && (
              <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {data.latest.error}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Recent Backups</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.recent || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No backup history is available.
                  </td>
                </tr>
              ) : (
                data.recent.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {item.drive_url ? (
                        <a
                          href={item.drive_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-teal-700 hover:underline"
                        >
                          {item.filename || "Backup"}
                        </a>
                      ) : (
                        item.filename || "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(item.started_at)}
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(item.completed_at)}
                    </td>
                    <td className="px-4 py-3">
                      {formatSize(item.size_bytes)}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {item.trigger || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          item.status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.status === "failed"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatusCard({ label, value, good }) {
  return (
    <Card className="border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-2 text-lg font-semibold ${
          good ? "text-teal-700" : "text-amber-700"
        }`}
      >
        {value}
      </div>
    </Card>
  );
}
