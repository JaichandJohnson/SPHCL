import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMobileAuth } from '@/context/MobileAuthContext';

export default function MobileLayout() {
  const { user, logout } = useMobileAuth();
  const link = ({ isActive }) => `flex-1 py-3 text-center text-sm font-semibold ${isActive ? 'text-teal-700 border-t-2 border-teal-600' : 'text-slate-500'}`;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
        <div className="min-w-0"><h1 className="text-base font-bold truncate">MDS LIMS Mobile Viewer</h1><p className="text-xs text-teal-700">Read-only · {user?.name || user?.email || 'Authorized user'}</p></div>
        <button type="button" onClick={logout} className="shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold">Logout</button>
      </header>
      <main className="mx-auto max-w-2xl p-4"><Outlet /></main>
      <nav aria-label="Mobile navigation" className="fixed bottom-0 inset-x-0 z-10 flex bg-white border-t border-slate-200">
        <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
        <NavLink to="/records" className={link}>Records</NavLink>
      </nav>
    </div>
  );
}
