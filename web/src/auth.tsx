import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './api';
import { supabase } from './supabase';

type AuthState = {
  user: Me | null;
  loading: boolean;
  setUser: (user: Me | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    // Logging in and out from this tab sets the user directly. This catches
    // the rest: an expired session, or logging out in another tab.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUser(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// For pages that only render when someone is logged in.
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('useMe called while logged out');
  return user;
}
