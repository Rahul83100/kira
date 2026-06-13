import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import OnboardingWizard from './pages/OnboardingWizard';
import Overview from './pages/Overview';
import Documents from './pages/Documents';
import Leads from './pages/Leads';
import WidgetSetup from './pages/WidgetSetup';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Pricing from './pages/Pricing';
import Channels from './pages/Channels';
import Billing from './pages/Billing';

function AuthLoader({ children }) {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-black border border-brand-500/20 shadow-xl shadow-brand-500/25 flex items-center justify-center overflow-hidden">
            <img src="/kira-logo.png" alt="Kira" className="w-10 h-10 object-contain drop-shadow-[0_0_8px_rgba(0,255,213,0.4)] animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span className="text-sm text-gray-500 font-medium">Loading Kira...</span>
          </div>
        </div>
      </div>
    );
  }
  return children;
}

function ProtectedRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function OnboardingGate() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Only redirect to onboarding when the backend has explicitly confirmed
  // this is a new user (onboardingCompleted === false).
  // When null (API failed / unknown), fail-open to dashboard so existing
  // users aren't blocked by transient backend issues (e.g. Render cold starts).
  if (user.onboardingCompleted === false) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/**
 * PlanGate — wraps premium pages. If the user is on the free plan,
 * shows a locked paywall overlay instead of the actual page content.
 */
function PlanGate({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // For local testing, we bypass the plan gate to allow full feature access.
  const isPaid = true; 

  if (isPaid) {
    return children;
  }

  return (
    <div className="relative">
      {/* Blurred preview of the page */}
      <div className="filter blur-sm opacity-40 pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      {/* Locked overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8 max-w-md w-full mx-4 text-center animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Upgrade to Unlock</h2>
          <p className="text-sm text-gray-500 mb-6">
            This feature is available on the Growth and Pro plans. Upgrade now to access leads management, analytics, document uploads, and more.
          </p>
          <button
            onClick={() => navigate('/dashboard/pricing')}
            className="w-full px-6 py-3 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold rounded-xl shadow-lg shadow-brand-500/25 hover:shadow-xl hover:shadow-brand-500/30 transition-all duration-200"
          >
            View Pricing Plans
          </button>
          <p className="text-xs text-gray-400 mt-3">Starting at ₹3,999/month</p>
        </div>
      </div>
    </div>
  );
}

function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-[#f9fafb]">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-black border border-brand-500/30 flex items-center justify-center overflow-hidden">
              <img src="/kira-logo.png" alt="Kira" className="w-6 h-6 object-contain drop-shadow-[0_0_5px_rgba(0,255,213,0.5)]" />
            </div>
            <span className="text-sm font-bold text-gray-900">Kira</span>
          </div>
          <div className="w-10"></div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function RedirectRoot() {
  const { user } = useAuth();
  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthLoader>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RedirectRoot />} />
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<OnboardingWizard />} />
            </Route>
            <Route element={<OnboardingGate />}>
              <Route element={<DashboardLayout />}>
                {/* Free users CAN access these */}
                <Route path="/dashboard" element={<Overview />} />
                <Route path="/dashboard/settings" element={<Settings />} />
                <Route path="/dashboard/pricing" element={<Pricing />} />
                <Route path="/dashboard/billing" element={<Billing />} />

                {/* Premium pages — gated behind PlanGate */}
                <Route path="/dashboard/documents" element={<PlanGate><Documents /></PlanGate>} />
                <Route path="/dashboard/widget" element={<PlanGate><WidgetSetup /></PlanGate>} />
                <Route path="/dashboard/leads" element={<PlanGate><Leads /></PlanGate>} />
                <Route path="/dashboard/channels" element={<PlanGate><Channels /></PlanGate>} />
                <Route path="/dashboard/analytics" element={<PlanGate><Analytics /></PlanGate>} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthLoader>
    </AuthProvider>
  );
}
