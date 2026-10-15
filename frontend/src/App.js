import React from 'react';
import '@/App.css';
import '@/mds-theme.css';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { MobileAuthProvider, useMobileAuth } from '@/context/MobileAuthContext';
import MobileLogin from '@/mobile/MobileLogin';
import MobileLayout from '@/mobile/MobileLayout';
import MobileDashboard from '@/mobile/MobileDashboard';
import MobileRecords from '@/mobile/MobileRecords';

function RequireMobileAuth() {
  const { user, loading } = useMobileAuth();
  if (loading) return <p className="p-8 text-center">Checking session…</p>;
  return user ? <Outlet /> : <Navigate to="/" replace />;
}
export default function App() {
  return <BrowserRouter><MobileAuthProvider><Routes>
    <Route path="/" element={<MobileLogin />} />
    <Route element={<RequireMobileAuth />}><Route element={<MobileLayout />}>
      <Route path="/dashboard" element={<MobileDashboard />} />
      <Route path="/records" element={<MobileRecords />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></MobileAuthProvider></BrowserRouter>;
}
