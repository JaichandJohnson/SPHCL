import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { useNavigate } from "react-router-dom";
import { PencilSimple, Trash, MagnifyingGlass } from "@phosphor-icons/react";
import { TABLE } from "@/constants/testIds";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Records() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page_size: 25 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/records", { params: { search: q || undefined, page, page_size: 25 } });
      setData(r.data);
    } catch (e) {
      toast.error("Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => { load(); }, [load]);

  const del = async (id) => {
    try {
      await api.delete(`/records/${id}`);
      toast.success("Record deleted");
      scheduleDriveSync();
      load();
    } catch (e) {
      toast.error("Delete failed");
    }
  };

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <div className="space-y-4" data-testid="records-page">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Line list</div>
          <h1 className="font-heading text-3xl font-semibold text-slate-900 mt-1">All Records</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search name or lab number"
              className="pl-9 w-72 bg-white"
              value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }}
              data-testid="records-search"
            />
          </div>
          <Button onClick={() => nav("/entry")} className="bg-blue-600 hover:bg-blue-700 rounded-md">New Record</Button>
        </div>
      </div>

      <Card className="border border-slate-200 rounded-md shadow-none bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table data-testid={TABLE.root} className="w-full text-sm zebra">
            <thead className="bg-white border-b border-slate-200 sticky top-0">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Lab #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">District</th>
                <th className="px-3 py-2">Test</th>
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Results</th>
                <th className="px-3 py-2">Result Date</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {loading && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
              )}
              {!loading && data.items.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">No records found. Create your first entry.</td></tr>
              )}
              {data.items.map((r) => (
                <tr key={r.id} data-testid={TABLE.row(r.id)} className="border-b border-slate-100 hover:bg-blue-50/40">
                  <td className="px-3 py-2 font-mono text-xs text-slate-900">{r.lab_number}</td>
                  <td className="px-3 py-2 tabular-nums">{r.date}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                  <td className="px-3 py-2 tabular-nums">{r.age ?? "—"}</td>
                  <td className="px-3 py-2">{r.district}</td>
                  <td className="px-3 py-2">{r.test}</td>
                  <td className="px-3 py-2">{r.sample_type}</td>
                 <td className="px-3 py-2">
  {r.results?.length ? (
    <div className="flex flex-wrap gap-1">
      {r.results.map((x, i) => (
        <div key={i} className="text-sm text-slate-700">
          <span className="font-medium">{x.name}</span>
          {x.value && (
            <span className="ml-2 text-slate-500">{x.value}</span>
          )}
        </div>
      ))}
    </div>
  ) : (
    <span className="text-xs text-amber-600 font-medium">
      Pending
    </span>
  )}
</td>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => nav(`/entry/${r.id}`)}
                        data-testid={TABLE.edit(r.id)}
                        className="text-slate-500 hover:text-blue-600"
                      >
                        <PencilSimple size={16} />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={TABLE.delete(r.id)} className="text-slate-500 hover:text-red-600">
                            <Trash size={16} />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Lab #{r.lab_number} · {r.name}. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del(r.id)} className="bg-red-600 hover:bg-red-700" data-testid={`confirm-delete-${r.id}`}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 flex items-center justify-between border-t border-slate-100 bg-white">
          <div className="text-xs text-slate-500 tabular-nums">
            Showing {data.items.length} of {data.total} records · Page {page} / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
