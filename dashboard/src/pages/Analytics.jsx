import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import adminApi from '../api/adminApi';
import api from '../api/client';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm">
        <p className="font-semibold mb-1">{label}</p>
        {payload.map((e, i) => (
          <p key={i} style={{ color: e.color }}>{e.name}: {e.value}</p>
        ))}
      </div>
    );
  }
  return null;
};

// Build chart-friendly data from usage API response
function buildChartData(customers) {
  if (!customers || customers.length === 0) return [];
  // Generate a 30-day series showing aggregate query volume
  const data = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    // Distribute total queries realistically across 30 days
    const totalQ = customers.reduce((s, c) => s + (c.queries || 0), 0);
    const dailyAvg = Math.max(1, Math.round(totalQ / 30));
    const variance = Math.random() * 0.6 + 0.7; // 0.7 to 1.3
    const queries = Math.round(dailyAvg * variance * (isWeekend ? 0.6 : 1));
    const resolved = Math.round(queries * (0.75 + Math.random() * 0.15));
    data.push({ date: day, queries, resolved });
  }
  return data;
}

const DEFAULT_FAQS = [
  { question: "How do I reset my account password?", frequency: 1245, resolved: 98, trend: "+12%" },
  { question: "What is your refund policy?", frequency: 890, resolved: 92, trend: "-5%" },
  { question: "How to integrate the REST API?", frequency: 650, resolved: 75, trend: "+24%" },
  { question: "Where can I find the billing invoices?", frequency: 412, resolved: 95, trend: "+2%" },
  { question: "Can I upgrade my subscription plan mid-cycle?", frequency: 320, resolved: 88, trend: "+8%" }
];

export default function Analytics() {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [faqs, setFaqs] = useState([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!user) return;
      if (!user.customerId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.get('/api/usage/analytics');
        const analyticsData = res.data;
        
        setStats({
          total_queries: analyticsData.total_queries,
          ai_resolved: analyticsData.ai_resolved,
        });
        setData(analyticsData.query_volume || []);
        setFaqs(analyticsData.faqs || []);
      } catch (err) {
        console.error('Failed to fetch usage analytics', err);
        setError('Failed to load query volume data.');
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, [user]);

  const totalQ = stats?.total_queries || 0;
  const totalR = stats?.ai_resolved || 0;
  const rate = totalQ > 0 ? Math.round((totalR / totalQ) * 100) : 0;

  // Loading skeleton
  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Query analytics for the last 30 days</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-3"></div>
              <div className="h-8 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-8 animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-6"></div>
          <div className="h-80 bg-gray-100 rounded-lg flex items-center justify-center">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <span className="text-sm text-gray-400 font-medium">Loading analytics data...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Query analytics for the last 30 days</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-red-100 flex items-center justify-center text-red-500 mx-auto mb-4">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-gray-700 font-medium mb-1">Unable to load analytics</p>
          <p className="text-sm text-gray-500 mb-5">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 shadow-lg shadow-brand-500/25 transition-all duration-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Query analytics for the last 30 days</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm text-gray-500 font-medium">Total Queries (30d)</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {totalQ.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm text-gray-500 font-medium">AI Resolved</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{totalR.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm text-gray-500 font-medium">Resolution Rate</p>
          <p className="text-3xl font-bold text-brand-600 mt-1">{rate}%</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-8 w-full overflow-hidden min-w-0">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Query Volume</h2>
        <p className="text-sm text-gray-500 mb-6">Daily breakdown of queries and resolutions</p>
        <div className="w-full min-w-0">
          <ResponsiveContainer width="100%" height={320} minWidth={0}>
            <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="cQ" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00ffd5" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#00ffd5" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="cR" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false}/>
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} dy={8} interval={4}/>
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} dx={-8}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Area type="monotone" dataKey="queries" name="Queries" stroke="#00ffd5" strokeWidth={2} fill="url(#cQ)"/>
              <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} fill="url(#cR)"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-6 mt-4 justify-center">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-brand-500"></span><span className="text-xs text-gray-500 font-medium">Queries</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500"></span><span className="text-xs text-gray-500 font-medium">Resolved</span></div>
        </div>
      </div>

      {/* Top Customer Questions (FAQs) */}
      <div className="mt-8 bg-white rounded-xl border border-gray-100 shadow-sm p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Top Customer Questions</h2>
        </div>

        <p className="text-sm text-gray-500 mb-6">Frequently asked questions and AI resolution rates</p>
        <div className="overflow-x-auto">
          {faqs.length > 0 ? (
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="py-3 px-4 font-semibold text-sm text-gray-500">Question Topic</th>
                  <th className="py-3 px-4 font-semibold text-sm text-gray-500 text-right">Volume</th>
                  <th className="py-3 px-4 font-semibold text-sm text-gray-500 text-right">Trend</th>
                  <th className="py-3 px-4 font-semibold text-sm text-gray-500 text-right">AI Resolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {faqs.map((faq, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3.5 px-4 w-1/2">
                      <div className="text-sm font-medium text-gray-900 line-clamp-1">{faq.question}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="text-sm text-gray-700 font-semibold">{faq.frequency.toLocaleString()}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${faq.trend.startsWith('+') ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                         {faq.trend}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-sm font-semibold text-gray-700">{faq.resolved}%</span>
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden sm:block">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${faq.resolved}%` }}></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">
              No questions asked yet.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
