import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ChartLine,
  CheckSquare,
  CloudCheck,
  CloudSlash,
  Gear,
  House,
  PlusCircle,
  SignOut,
  Table as TableIcon,
  UploadSimple,
} from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import {
  getLastSync,
  isConnected,
  isDriveConfigured,
  onSyncChange,
} from "@/lib/drive";
import logo from "@/assets/mds-logo.png";

const navItems = [
  { to: "/dashboard", icon: House, label: "Dashboard" },
  { to: "/entry", icon: PlusCircle, label: "New Record" },
  { to: "/records", icon: TableIcon, label: "All Records" },
  { to: "/bulk-result", icon: CheckSquare, label: "Bulk Result Entry" },
  { to: "/reports", icon: ChartLine, label: "Reports & Export" },
  { to: "/import", icon: UploadSimple, label: "Bulk Import" },
  { to: "/settings", icon: Gear, label: "Master Data" },
];

function NavItem({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          isActive
            ? "bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow-md shadow-teal-900/15"
            : "text-slate-600 hover:bg-teal-50 hover:text-teal-800"
        }`
      }
    >
      <Icon size={19} weight="duotone" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [, setTick] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);

  React.useEffect(
    () =>
      onSyncChange((state) => {
        if (state?.syncing !== undefined) setSyncing(Boolean(state.syncing));
        setTick((value) => value + 1);
      }),
    []
  );

  const connected = isConnected();
  const lastSync = getLastSync();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white/95 shadow-sm backdrop-blur lg:flex">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-900 px-5 py-6 text-white">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="Molecular Diagnosis Section logo"
              className="h-16 w-16 rounded-full border-2 border-white/80 bg-white object-contain shadow-lg"
            />
            <div>
              <div className="text-base font-semibold leading-tight">MDS LIMS</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-teal-100">
                SPHCL · Trivandrum
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            {user?.picture ? (
              <img
                src={user.picture}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-indigo-600 text-sm font-semibold text-white">
                {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-800">
                {user?.name || "Authorized User"}
              </div>
              <div className="truncate text-[10px] text-slate-500">
                {user?.email}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-700"
          >
            <SignOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur md:px-7">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={logo}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full border border-slate-200 bg-white object-contain shadow-sm lg:hidden"
              />
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-700">
                  MDS Laboratory Information Management System
                </div>
                <div className="truncate text-lg font-semibold text-slate-900">
                  State Public Health &amp; Clinical Laboratory
                </div>
                <div className="truncate text-xs text-slate-500">
                  Molecular Diagnosis Section • Trivandrum
                </div>
              </div>
            </div>

            {isDriveConfigured() && (
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition sm:inline-flex ${
                  connected
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
                title={
                  connected
                    ? lastSync
                      ? `Last synced ${lastSync.toLocaleString()}`
                      : "Connected"
                    : "Click to connect Google Drive"
                }
              >
                {connected ? <CloudCheck size={16} /> : <CloudSlash size={16} />}
                {syncing
                  ? "Syncing…"
                  : connected
                    ? lastSync
                      ? `Synced ${timeAgo(lastSync)}`
                      : "Drive connected"
                    : "Drive disconnected"}
              </button>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] p-4 md:p-7">
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 bg-white/70 px-5 py-4 text-center text-xs text-slate-500">
          © 2026 State Public Health &amp; Clinical Laboratory, Trivandrum.
        </footer>
      </div>

      <Toaster richColors position="top-right" />
    </div>
  );
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString();
}
