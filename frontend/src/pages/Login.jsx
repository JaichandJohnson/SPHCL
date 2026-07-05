import React from "react";
import { Button } from "@/components/ui/button";
import { GoogleLogo, TestTube, ShieldCheck, Database } from "@phosphor-icons/react";
import { AUTH } from "@/constants/testIds";

export default function Login() {
  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

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
            <div className="font-heading font-semibold">SPHCL · MDS · Trivandrum</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-blue-200 mb-3">Molecular Diagnosis Section</div>
            <h1 className="font-heading text-4xl lg:text-5xl font-semibold leading-tight tracking-tight">
              Precise data.<br />Public health decisions.
            </h1>
            <p className="mt-4 text-sm text-slate-200 max-w-md leading-relaxed">
              Unified data entry, real-time reports, and secure exports for the State Public Health &amp; Clinical Laboratory, Trivandrum.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 text-xs text-slate-200">
              <div className="flex items-start gap-2"><ShieldCheck size={16} className="text-emerald-300 mt-0.5" /><span>Google secured sign-in</span></div>
              <div className="flex items-start gap-2"><Database size={16} className="text-blue-300 mt-0.5" /><span>Multi-user concurrent editing</span></div>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-slate-300">© Government of Kerala</div>
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mb-2">Sign in</div>
          <h2 className="font-heading text-3xl font-semibold text-slate-900">Lab Data Console</h2>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            Use your Google account to access records, generate reports and manage entries.
          </p>

          <Button
            data-testid={AUTH.loginButton}
            onClick={handleLogin}
            className="mt-8 w-full h-11 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-150"
          >
            <GoogleLogo size={18} weight="bold" className="mr-2" />
            Continue with Google
          </Button>

          <div className="mt-8 text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-4">
            By continuing you agree to authorized institutional use only. Records and personal data are stored securely; do not share credentials.
          </div>
        </div>
      </div>
    </div>
  );
}
