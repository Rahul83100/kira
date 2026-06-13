import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/client';

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amountPaise, currency = 'INR') {
  const amount = Number(amountPaise || 0) / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
}

function normalizeStatus(status) {
  const s = (status || '').toLowerCase();
  if (s === 'captured' || s === 'paid') return 'paid';
  if (s === 'failed') return 'failed';
  if (s === 'refunded') return 'refunded';
  return s || 'pending';
}

function statusClasses(status) {
  const s = normalizeStatus(status);
  if (s === 'paid') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  if (s === 'refunded') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function eventDotClass(eventType) {
  if (eventType === 'trial_expired' || eventType === 'payment_failed') return 'bg-red-500';
  if (eventType === 'payment_success') return 'bg-green-500';
  return 'bg-brand-500';
}

export default function Billing() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [events, setEvents] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryRes, transactionsRes, eventsRes] = await Promise.all([
        api.get('/api/billing/summary'),
        api.get('/api/billing/transactions'),
        api.get('/api/billing/events'),
      ]);
      setSummary(summaryRes.data || null);
      setTransactions(transactionsRes.data?.transactions || []);
      setEvents(eventsRes.data?.events || []);
    } catch (err) {
      console.error('Billing load failed:', err);
      setError('Unable to load billing data right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const usagePercent = useMemo(() => {
    if (!summary?.messages_limit) return 0;
    return Math.min(100, Math.round(((summary.messages_used || 0) / summary.messages_limit) * 100));
  }, [summary]);

  const timelineEvents = useMemo(() => {
    return [...events].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [events]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-44" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="h-36 bg-white border border-gray-100 rounded-xl" />
          <div className="h-36 bg-white border border-gray-100 rounded-xl" />
          <div className="h-36 bg-white border border-gray-100 rounded-xl" />
        </div>
        <div className="h-80 bg-white border border-gray-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500 mt-1">Plan, usage, transactions and subscription events.</p>
        </div>
        <button
          onClick={loadData}
          className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={loadData} className="text-sm font-semibold text-red-700 hover:text-red-800">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Plan</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{summary?.plan || '-'}</p>
          <p className="mt-2 text-sm text-gray-600">Status: <span className="font-semibold">{summary?.subscription_status || '-'}</span></p>
          <p className="mt-1 text-sm text-gray-600">Billing: <span className="font-semibold">{summary?.billing_cycle || '-'}</span></p>
          <p className="mt-1 text-sm text-gray-600">Renews: <span className="font-semibold">{formatDate(summary?.renewal_date)}</span></p>
        </section>

        <section className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Usage</p>
          <p className="mt-2 text-xl font-bold text-gray-900">
            {summary?.messages_used ?? 0} / {summary?.messages_limit ?? 0}
          </p>
          <p className="mt-1 text-sm text-gray-600">AI messages used</p>
          <div className="mt-3 h-2 w-full bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${usagePercent}%` }} />
          </div>
          <p className="mt-2 text-sm text-gray-600">Storage: {(summary?.storage_used || 0).toLocaleString()} / {(summary?.storage_limit || 0).toLocaleString()} chars</p>
          <p className="mt-1 text-sm text-gray-600">Documents: {summary?.document_count ?? 0}</p>
        </section>

        <section className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Payment Method</p>
          {summary?.payment_method ? (
            <>
              <p className="mt-2 text-xl font-bold text-gray-900">
                {summary.payment_method.brand?.toUpperCase()} •••• {summary.payment_method.last4}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Expires {summary.payment_method.expiry_month}/{summary.payment_method.expiry_year}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-base font-semibold text-gray-900">No saved payment method</p>
              <p className="mt-2 text-sm text-gray-600">Payment method details are not available in your account yet.</p>
            </>
          )}
        </section>
      </div>

      <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Transaction History</h2>
        </div>
        {transactions.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">Plan</th>
                  <th className="px-4 py-3 text-left font-semibold">Amount</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Billing Period</th>
                  <th className="px-4 py-3 text-left font-semibold">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((tx, idx) => (
                  <tr key={`${tx.id || tx.razorpay_payment_id || tx.created_at || 'tx'}-${idx}`}>
                    <td className="px-4 py-3 text-gray-700">{formatDate(tx.created_at)}</td>
                    <td className="px-4 py-3 text-gray-700">{tx.plan || '-'}</td>
                    <td className="px-4 py-3 text-gray-900 font-semibold">{formatCurrency(tx.amount_paise, tx.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold ${statusClasses(tx.payment_status)}`}>
                        {normalizeStatus(tx.payment_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {tx.billing_period_start || tx.billing_period_end
                        ? `${formatDate(tx.billing_period_start)} - ${formatDate(tx.billing_period_end)}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {tx.receipt_url ? (
                        <a className="text-brand-600 hover:underline" href={tx.receipt_url} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Subscription Timeline</h2>
        </div>
        {timelineEvents.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No billing events yet.</div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {timelineEvents.map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${eventDotClass(event.event_type)}`} />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{event.title || event.event_type}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{event.description || '-'}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatDate(event.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
