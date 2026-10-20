
import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { useMobileAuth } from '@/context/MobileAuthContext';

export default function MobileLogin() {
  const { user, loading, loginWithGoogle } = useMobileAuth();
  const ref = useRef(null);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const completeLogin = async (credential) => {
    if (!credential) {
      throw new Error('Google ID token was not received.');
    }
    await loginWithGoogle(credential);
    navigate('/records', { replace: true });
  };

  const signInNative = async () => {
    setSigningIn(true);
    setError('');
    try {
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = result.credential?.idToken;
      await completeLogin(credential);
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
        err?.message ||
        'Google Sign-In failed.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  useEffect(() => {
    if (loading || user || isNative) return;

    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError('Google Client ID is not configured.');
      return;
    }

    const initialize = () => {
      if (!window.google?.accounts?.id || !ref.current) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            setError('');
            await completeLogin(credential);
          } catch (err) {
            setError(
              err?.response?.data?.detail ||
              err?.message ||
              'Sign-in failed.'
            );
          }
        },
      });

      ref.current.innerHTML = '';
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 280,
      });
    };

    if (window.google?.accounts?.id) {
      initialize();
      return;
    }

    const id = 'mds-mobile-google-signin';
    let script = document.getElementById(id);

    if (!script) {
      script = document.createElement('script');
      script.id = id;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }

    script.addEventListener('load', initialize);
    return () => script.removeEventListener('load', initialize);
  }, [loading, user, isNative, loginWithGoogle, navigate]);

  if (loading) {
    return <div className="p-8 text-center">Checking session…</div>;
  }

  if (user) return <Navigate to="/records" replace />;

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-lg text-center">
        <div className="text-xs uppercase tracking-widest text-teal-700 font-bold">
          Molecular Diagnosis Section
        </div>

        <h1 className="mt-3 text-2xl font-bold text-slate-900">
          MDS LIMS Mobile Viewer
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Secure, read-only access to laboratory information
        </p>

        {isNative ? (
          <button
            type="button"
            onClick={signInNative}
            disabled={signingIn}
            className="mt-8 rounded-lg border bg-white px-6 py-3 font-semibold disabled:opacity-50"
          >
            {signingIn ? 'Signing in…' : 'Sign in with Google'}
          </button>
        ) : (
          <div ref={ref} className="mt-8 min-h-12 flex justify-center" />
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}

        <p className="mt-7 text-xs text-slate-500">
          Access restricted to authorized accounts.
          Do not share patient information.
        </p>
      </section>
    </main>
  );
}
