import React, { useEffect, useRef, useState } from "react";
import { Database, ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { AUTH } from "@/constants/testIds";
import logo from "@/assets/mds-logo.png";

const GOOGLE_SCRIPT_ID = "google-identity-services";

export default function Login() {
  const googleButtonRef = useRef(null);
  const navigate = useNavigate();
  const { user, loginWithGoogle } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      toast.error("Google Client ID is not configured");
      return;
    }

    const initializeGoogle = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            await loginWithGoogle(response.credential);
            navigate("/dashboard", { replace: true });
          } catch (error) {
            toast.error(error?.response?.data?.detail || "Google sign-in failed");
          }
        },
      });

      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        type: "standard",
        shape: "pill",
        text: "continue_with",
        width: 352,
      });
      setReady(true);
    };

    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID);
    if (existingScript) {
      initializeGoogle();
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    script.onerror = () => toast.error("Unable to load Google sign-in");
    document.head.appendChild(script);
  }, [loginWithGoogle, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-teal-950 to-indigo-950 p-4 md:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl md:min-h-[calc(100vh-4rem)] lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-slate-950 via-teal-900 to-cyan-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="absolute -bottom-28 -left-28 h-80 w-80 rounded-full bg-indigo-400/15 blur-3xl" />

          <div className="relative flex items-center gap-4">
            <img
              src={logo}
              alt="Molecular Diagnosis Section logo"
              className="h-28 w-28 rounded-full border border-white/90 bg-white object-cover p-[2px] shadow-xl"
            />
            <div>
              <div className="text-xl font-semibold">
                MDS Laboratory Information Management System
              </div>
              <div className="mt-1 text-sm text-teal-100">
                State Public Health &amp; Clinical Laboratory, Trivandrum
              </div>
              <div className="text-sm text-teal-100">
                Molecular Diagnosis Section
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
              Secure laboratory data management
            </div>
            <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-tight">
              Precise data.
              <br />
              Public health decisions.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-200">
              Unified registration, multi-test processing, surveillance datasets,
              real-time reports and secure exports for the Molecular Diagnosis
              Section.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <ShieldCheck size={24} className="text-emerald-300" />
                <div className="mt-3 font-medium">Google secured sign-in</div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                <Database size={24} className="text-cyan-300" />
                <div className="mt-3 font-medium">Centralized laboratory records</div>
              </div>
            </div>
          </div>

          <div className="relative text-xs text-teal-100">
            © Government of Kerala
          </div>
        </section>

        <section className="flex items-center justify-center bg-slate-50 p-8 md:p-12">
          <div className="w-full max-w-sm">
            <div className="mb-7 flex justify-center lg:hidden">
              <img
                src={logo}
                alt="Molecular Diagnosis Section logo"
                className="h-32 w-32 rounded-full border border-white bg-white object-cover p-[2px] shadow-xl"
              />
            </div>

            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
              Authorized access
            </div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              Sign in to MDS LIMS
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Use your authorized Google account to access records, reports,
              bulk operations and master data.
            </p>

            <div
              ref={googleButtonRef}
              data-testid={AUTH.loginButton}
              className="mt-8 flex min-h-12 items-center justify-center rounded-full"
            />

            {!ready && (
              <div className="mt-3 text-center text-xs text-slate-400">
                Loading Google sign-in…
              </div>
            )}

            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 text-[11px] leading-5 text-slate-500 shadow-sm">
              Authorized institutional use only. Laboratory records and personal
              information must be handled according to applicable confidentiality
              and data-security requirements.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
