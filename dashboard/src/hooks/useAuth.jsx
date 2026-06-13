import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signInWithCredential, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

const AuthContext = createContext(null);
const API_URL = import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

async function provisionGoogleCustomer(firebaseUser, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_URL}/api/auth/google-provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: firebaseUser.displayName || 'User',
          email: firebaseUser.email,
          avatar: firebaseUser.photoURL,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.customer || null;
    } catch (err) {
      console.warn(`[Auth] Provision attempt ${attempt + 1}/${retries + 1} failed:`, err.message);
      if (attempt < retries) {
        // Exponential backoff: 1s, 2s
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        throw err; // Re-throw after all retries exhausted
      }
    }
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true while Firebase initializes
  const firebaseUserRef = useRef(null);

  // Build profile from customer record
  const buildProfile = useCallback(async (firebaseUser) => {
    const profile = {
      uid: firebaseUser.uid,
      name: firebaseUser.displayName || 'User',
      email: firebaseUser.email,
      avatar: firebaseUser.photoURL,
      company: null,
      apiToken: null,
      slug: null,
      // null = unknown (API hasn't responded yet or failed)
      // false = confirmed new user who hasn't completed onboarding
      // true = existing user who completed onboarding
      onboardingCompleted: null,
    };

    let customer = null;
    try {
      customer = await provisionGoogleCustomer(firebaseUser);
    } catch (err) {
      console.error('[Auth] Customer profile provisioning failed after retries:', err);
      // Keep onboardingCompleted as null — fail-open to dashboard
    }

    if (customer) {
      profile.apiToken = customer.api_token;
      profile.company = customer.company_name;
      profile.customerId = customer.id;
      profile.plan = customer.plan;
      profile.slug = customer.slug;
      // Only set to false for confirmed new users; true for existing users
      profile.onboardingCompleted = customer.onboarding_completed === true;
    }

    return profile;
  }, []);

  // Listen to Firebase auth state
  useEffect(() => {
    if (!auth) {
      console.error("Firebase auth is null. Cannot listen to auth state.");
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        firebaseUserRef.current = firebaseUser;
        const profile = await buildProfile(firebaseUser);
        setUser(profile);
        // Persist api_token for the axios interceptor
        if (profile.apiToken) {
          localStorage.setItem('sg_api_token', profile.apiToken);
        }
        // Persist user profile so WidgetSetup can resolve slug on refresh
        localStorage.setItem('kiraUser', JSON.stringify({
          id: profile.customerId || profile.uid,
          name: profile.name,
          email: profile.email,
          picture: profile.avatar || null,
          provider: 'google',
          isLoggedIn: true,
          apiToken: profile.apiToken,
          slug: profile.slug || null,
          messagesUsed: 0,
        }));
      } else {
        firebaseUserRef.current = null;
        setUser(null);
        localStorage.removeItem('sg_api_token');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [buildProfile]);

  const login = useCallback(async () => {
    try {
      setLoading(true);
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged will handle the rest
    } catch (err) {
      console.error('Google sign-in failed:', err);
      setLoading(false);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('sg_api_token');
      setUser(null);
    } catch (err) {
      console.error('Sign-out failed:', err);
    }
  }, []);

  const loginWithRedirectAction = useCallback(async () => {
    try {
      setLoading(true);
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      console.error('Google redirect sign-in failed:', err);
      setLoading(false);
      throw err;
    }
  }, []);

  const loginWithTokenAction = useCallback(async (idToken) => {
    try {
      setLoading(true);
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
    } catch (err) {
      console.error('Token sign-in failed:', err);
      setLoading(false);
      throw err;
    }
  }, []);

  // Re-fetch the customer profile (e.g. after onboarding completes)
  const refreshUser = useCallback(async () => {
    const fbUser = firebaseUserRef.current;
    if (!fbUser) return;
    const profile = await buildProfile(fbUser);
    setUser(profile);
    if (profile.apiToken) {
      localStorage.setItem('sg_api_token', profile.apiToken);
    }
  }, [buildProfile]);

  return (
    <AuthContext.Provider value={{ user, login, logout, loginWithRedirectAction, loginWithTokenAction, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default useAuth;
