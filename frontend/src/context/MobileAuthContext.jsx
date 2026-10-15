import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { mobileApi, saveMobileToken, clearMobileToken } from '@/lib/mobileApi';

const Context = createContext(null);
export const useMobileAuth = () => useContext(Context);
export function MobileAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const checkAuth = useCallback(async () => {
    try {
      const { data } = await mobileApi.get('/auth/me');
      // An existing general LIMS session is not enough: require viewer access.
      await mobileApi.get('/stats');
      setUser(data);
      return data;
    } catch {
      clearMobileToken();
      setUser(null);
      return null;
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { checkAuth(); }, [checkAuth]);
  const loginWithGoogle = useCallback(async (credential) => {
    const { data } = await mobileApi.post('/auth/google', { credential });
    if (!data?.session_token) throw new Error('No session token received');
    saveMobileToken(data.session_token);
    // Verify access to a viewer-protected endpoint before entering the app.
    try {
      await mobileApi.get('/stats');
    } catch (error) {
      clearMobileToken();
      setUser(null);
      throw error;
    }
    setUser(data);
    return data;
  }, []);
  const logout = useCallback(async () => {
    try { await mobileApi.post('/auth/logout'); } catch { /* local sign-out still applies */ }
    clearMobileToken();
    setUser(null);
    window.google?.accounts?.id?.disableAutoSelect?.();
    window.location.assign('/');
  }, []);
  return <Context.Provider value={{ user, loading, loginWithGoogle, logout, checkAuth }}>{children}</Context.Provider>;
}
