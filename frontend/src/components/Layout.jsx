import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  House, PlusCircle, Table as TableIcon, ChartLine,
  UploadSimple, CheckSquare, Gear, SignOut, TestTube,
  CloudCheck, CloudSlash, CloudArrowUp,
} from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { NAV, AUTH } from "@/constants/testIds";
import { Toaster } from "@/components/ui/sonner";
import { isConnected, isDriveConfigured, getLastSync, onSyncChange } from "@/lib/drive";

const NavItem = ({ to, icon: Icon, label, testId }) => (
  <NavLink
    to={to}
    end
    data-testid={testId}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 ${
        isActive
          ? "bg-blue-600 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`
    }
  >
    <Icon size={18} weight="regular" />
    <span>{label}</span>
  </NavLink>
);

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [, setTick] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  React.useEffect(() => onSyncChange((s) => {
    if (s?.syncing !== undefined) setSyncing(!!s.syncing);
    setTick((x) => x + 1);
  }), []);
  const connected = isConnected();
  const last = getLastSync();

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <TestTube size={22} weight="bold" className="text-blue-600" />
            <div>
              <div className="font-heading text-[15px] font-semibold text-slate-900 leading-tight">SPHCL · MDS</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5">Trivandrum</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavItem to="/dashboard" icon={House} label="Dashboard" testId={NAV.dashboard} />
          <NavItem to="/entry" icon={PlusCircle} label="New Record" testId={NAV.dataEntry} />
          <NavItem to="/records" icon={TableIcon} label="Records" testId={NAV.records} />
          <NavItem to="/reports" icon={ChartLine} label="Reports & Export" testId={NAV.reports} />
          <NavItem to="/import" icon={UploadSimple} label="Bulk Import" testId={NAV.bulkImport} />
          <NavItem to="/bulk-result" icon={CheckSquare} label="Bulk Result" testId={NAV.bulkResult} />
          <NavItem to="/settings" icon={Gear} label="Settings" testId={NAV.settings} />
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="flex items-center gap-3 px-2 py-2">
            {user?.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-200" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-900 truncate">{user?.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{user?.email}</div>
            </div>
            <button
              data-testid={AUTH.logoutButton}
              onClick={logout}
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title="Sign out"
            >
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 backdrop-blur-xl bg-white/70 border-b border-slate-200">
          <div className="px-6 py-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Molecular Diagnosis Section</div>
              <div className="font-heading text-base font-medium text-slate-900">State Public Health &amp; Clinical Laboratory, Trivandrum</div>
            </div>
            {isDriveConfigured() && (
              <button
                onClick={() => navigate("/settings")}
                data-testid="drive-status-pill"
                className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  connected
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
                title={connected ? (last ? `Last synced ${last.toLocaleString()}` : "Connected") : "Click to connect Google Drive"}
              >
                {syncing ? (
                  <CloudArrowUp size={14} className="animate-pulse" />
                ) : connected ? (
                  <CloudCheck size={14} weight="fill" />
                ) : (
                  <CloudSlash size={14} />
                )}
                <span className="font-medium">
                  {syncing
                    ? "Syncing…"
                    : connected
                      ? (last ? `Synced ${timeAgo(last)}` : "Connected")
                      : "Drive disconnected"}
                </span>
              </button>
            )}
          </div>
        </header>
        <main className="flex-1 p-6 overflow-x-auto">
          <Outlet />
        </main>
      </div>
      <Toaster position="top-right" richColors />
    </div>
  );
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}
