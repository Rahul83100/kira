import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { user, login, logout, loginWithRedirectAction, loginWithTokenAction, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Handle cross-account switching and auto-login from landing page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedEmail = params.get('email');
    const isAutoLogin = params.get('autoLogin') === 'true';
    const token = params.get('token');

    if (user && requestedEmail && user.email !== requestedEmail) {
      console.log('Account mismatch detected. Logging out to switch accounts...');
      logout();
      return;
    }

    if (!user && isAutoLogin && !isLoading) {
      if (token) {
        console.log('True SSO auto-login triggered with token from landing page...');
        setIsLoading(true);
        loginWithTokenAction(token)
          .catch(err => {
            console.error('Token auto-login failed, falling back to redirect:', err.message);
            sessionStorage.setItem('sso_in_progress', 'true');
            loginWithRedirectAction();
          });
        // Remove token from URL for security
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }

      if (sessionStorage.getItem('sso_in_progress')) {
        console.log('SSO redirect already in progress, waiting for Firebase...');
        return;
      }
      console.log('Fallback auto-login triggered from landing page...');
      setIsLoading(true);
      sessionStorage.setItem('sso_in_progress', 'true');
      loginWithRedirectAction();
      return;
    }

    if (user) {
      sessionStorage.removeItem('sso_in_progress');
      setIsLoading(false);
      // Only redirect to onboarding for confirmed new users (false).
      // null (API failure) or true → go to dashboard.
      if (user.onboardingCompleted === false) {
        navigate('/onboarding', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, navigate, logout, loginWithRedirectAction, loginWithTokenAction, isLoading]);

  const handleGoogleLogin = async () => {
    sessionStorage.removeItem('sso_in_progress');
    setIsLoading(true);
    setError(null);
    try {
      await login();
      // Navigation is handled by the useEffect above, which waits for
      // the full user profile (including onboardingCompleted) to be fetched.
    } catch (err) {
      console.error('Login error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled. Please try again.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error. Please check your connection.');
      } else {
        setError('Sign-in failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50 flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-brand-100/30 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-brand-50/50 rounded-full blur-3xl"></div>
      </div>

      {isLoading ? (
        <div className="relative flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-brand-900 shadow-2xl shadow-brand-500/20 flex items-center justify-center overflow-hidden border border-brand-500/30">
            <img src="/kira-logo.png" alt="Kira" className="w-12 h-12 object-contain drop-shadow-[0_0_8px_rgba(0,255,213,0.4)]" />
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span className="text-sm text-gray-500 font-medium">Signing you in...</span>
          </div>
        </div>
      ) : (
      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-brand-900 shadow-2xl shadow-brand-500/20 mb-5 overflow-hidden border border-brand-500/30">
            <img src="/kira-logo.png" alt="Kira" className="w-16 h-16 object-contain filter drop-shadow-[0_0_12px_rgba(0,255,213,0.6)]" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Welcome back</h1>
          <p className="text-gray-500 mt-2 text-sm">Sign in to your Kira dashboard</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-xl shadow-gray-100/50 p-8">
          {/* Error message */}
          {error && (
            <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            id="google-sign-in-btn"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <svg className="w-5 h-5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"></path>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path>
              </svg>
            )}
            {isLoading ? 'Signing in...' : 'Sign in with Google'}
          </button>

          <div className="mt-5 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex items-center gap-2.5 mb-2">
              <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <span className="text-xs font-semibold text-gray-700">Professional-grade security</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your data is encrypted end-to-end. We use Google's OAuth 2.0 for secure authentication — we never store your password.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By signing in, you agree to our <a href="#" className="text-brand-500 hover:underline">Terms</a> and <a href="#" className="text-brand-500 hover:underline">Privacy Policy</a>
        </p>
      </div>
    )}
    </div>
  );
}
