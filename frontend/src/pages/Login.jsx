import React, { useEffect, useRef, useState } from "react";
import { TestTube, ShieldCheck, Database } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { AUTH } from "@/constants/testIds";

const GOOGLE_SCRIPT_ID = "google-identity-services";

export default function Login() {
  const googleButtonRef = useRef(null);
  const navigate = useNavigate();
  const { user, loginWithGoogle } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    }
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
            toast.error(
              error?.response?.data?.detail || "Google sign-in failed"
            );
          }
        },
      });

      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        type: "standard",
        shape: "rectangular",
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
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white">
      <div className="hidden lg:block relative overflow-hidden">
        <img
          alt=""
          src="https://images.pexels.com/photos/8442037/pexels-photo-8442037.jpeg"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/60" />
        <div className="relative z-10 p-12 h-full flex flex-col justify-between text-white">
          <div className="flex items-center gap-2">
            <TestTube size={22} weight="bold" />
            <div className="font-heading font-semibold">
              MDS Laboratory Information Management System
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-blue-200 mb-3">
              Molecular Diagnosis Section
            </div>
            <h1 className="font-heading text-4xl lg:text-5xl font-semibold leading-tight tracking-tight">
              Precise data.<br />Public health decisions.
            </h1>
            <p className="mt-4 text-sm text-slate-200 max-w-md leading-relaxed">
              Unified data entry, real-time reports, and secure exports for the
              State Public Health &amp; Clinical Laboratory, Trivandrum.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 text-xs text-slate-200">
              <div className="flex items-start gap-2">
                <ShieldCheck size={16} className="text-emerald-300 mt-0.5" />
                <span>Google secured sign-in</span>
              </div>
              <div className="flex items-start gap-2">
                <Database size={16} className="text-blue-300 mt-0.5" />
                <span>Multi-user concurrent editing</span>
              </div>
            </div>
          </div>

          <div className="text-[10px] uppercase tracking-widest text-slate-300">
            © Government of Kerala
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mb-2">
            Sign in
          </div>
          <h2 className="font-heading text-3xl font-semibold text-slate-900">
            MDS LIMS
          </h2>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            Use your authorized Google account to access records, generate
            reports, and manage entries.
          </p>

          <div
            ref={googleButtonRef}
            data-testid={AUTH.loginButton}
            className="mt-8 min-h-11 flex items-center justify-center"
          />

          {!ready && (
            <div className="mt-3 text-xs text-center text-slate-400">
              Loading Google sign-in…
            </div>
          )}

          <div className="mt-8 text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-4">
            Authorized institutional use only. Do not share credentials.
          </div>
        </div>
      </div>
    </div>
  );
}
