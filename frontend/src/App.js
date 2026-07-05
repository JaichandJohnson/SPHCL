import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import DataEntry from "@/pages/DataEntry";
import Records from "@/pages/Records";
import Reports from "@/pages/Reports";
import BulkImport from "@/pages/BulkImport";
import BulkResult from "@/pages/BulkResult";
import Settings from "@/pages/Settings";

function AppRouter() {
  const location = useLocation();
  // Synchronous check for session_id in fragment — must happen before other route logic
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/entry" element={<DataEntry />} />
        <Route path="/entry/:id" element={<DataEntry />} />
        <Route path="/records" element={<Records />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/import" element={<BulkImport />} />
        <Route path="/bulk-result" element={<BulkResult />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
