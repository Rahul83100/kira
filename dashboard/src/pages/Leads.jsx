import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const PRIORITY_COLORS = {
  high: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  low: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', dot: 'bg-gray-400' },
};

const SOURCE_LABELS = {
  widget: '💬 Widget',
  kira_outbound: '📤 Outbound',
  manual: '✏️ Manual',
  ai_extract: '🤖 AI Extract',
  unknown: '❓ Unknown',
};

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [exporting, setExporting] = useState(false);
  const [expandedLead, setExpandedLead] = useState(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 25 });
      if (search) params.set('search', search);
      if (filterPriority) params.set('priority', filterPriority);
      if (filterSource) params.set('source', filterSource);

      const res = await api.get(`/api/leads?${params.toString()}`);
      setLeads(res.data.leads || []);
      setPagination(res.data.pagination || { total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterPriority, filterSource]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/api/leads/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Failed to fetch lead stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/api/leads/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'kira-leads.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (leadId) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return;
    try {
      await api.delete(`/api/leads/${leadId}`);
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      fetchStats();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLeads();
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">
            Contacts captured by Kira from conversations
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || !leads.length}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          )}
          Export CSV
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-xs text-gray-500 font-medium">Total Leads</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.today}</p>
                <p className="text-xs text-gray-500 font-medium">Today</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.thisWeek}</p>
                <p className="text-xs text-gray-500 font-medium">This Week</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6 shadow-sm">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, email, phone, or interest..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
            />
          </div>
          <select
            value={filterPriority}
            onChange={(e) => { setFilterPriority(e.target.value); setPage(1); }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
          >
            <option value="">All Priorities</option>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select>
          <select
            value={filterSource}
            onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            className="px-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
          >
            <option value="">All Sources</option>
            <option value="widget">💬 Widget</option>
            <option value="kira_outbound">📤 Outbound</option>
            <option value="manual">✏️ Manual</option>
          </select>
          <button
            type="submit"
            className="px-5 py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow-md transition-all duration-200"
          >
            Search
          </button>
        </form>
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <svg className="w-6 h-6 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-500">Loading leads...</p>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No leads yet</h3>
            <p className="text-sm text-gray-500 text-center max-w-sm">
              When Kira captures contact information from chat conversations, they'll appear here automatically.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Contact</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Interest</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Source</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Priority</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Date</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {leads.map((lead) => {
                    const prio = PRIORITY_COLORS[lead.priority] || PRIORITY_COLORS.unknown;
                    return (
                      <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors duration-150">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-semibold shadow-sm flex-shrink-0">
                              {(lead.name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{lead.name || 'Unknown'}</p>
                              <div className="flex items-center gap-3 mt-0.5">
                                {lead.email && (
                                  <a href={`mailto:${lead.email}`} className="text-xs text-gray-500 hover:text-brand-600 truncate transition-colors">
                                    {lead.email}
                                  </a>
                                )}
                                {lead.phone && (
                                  <a href={`tel:${lead.phone}`} className="text-xs text-gray-500 hover:text-brand-600 truncate transition-colors">
                                    📞 {lead.phone}
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm text-gray-700 truncate max-w-[200px]">{lead.course_interest || '—'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-medium text-gray-600">
                            {SOURCE_LABELS[lead.source] || lead.source || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${prio.bg} ${prio.text} border ${prio.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${prio.dot}`} />
                            {(lead.priority || 'unknown').charAt(0).toUpperCase() + (lead.priority || 'unknown').slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-gray-500">{formatDate(lead.created_at)}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDelete(lead.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-200"
                            title="Delete lead"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {leads.map((lead) => {
                const prio = PRIORITY_COLORS[lead.priority] || PRIORITY_COLORS.unknown;
                const isExpanded = expandedLead === lead.id;
                return (
                  <div key={lead.id} className="p-4">
                    <button
                      onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                      className="w-full flex items-center gap-3 text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-semibold shadow-sm flex-shrink-0">
                        {(lead.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{lead.name || 'Unknown'}</p>
                        <p className="text-xs text-gray-500 truncate">{lead.email || lead.phone || 'No contact info'}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${prio.bg} ${prio.text} border ${prio.border}`}>
                        <span className={`w-1 h-1 rounded-full ${prio.dot}`} />
                        {(lead.priority || '—').charAt(0).toUpperCase() + (lead.priority || '').slice(1)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="mt-3 ml-13 pl-13 space-y-2 animate-fade-in" style={{ marginLeft: '52px' }}>
                        {lead.phone && <p className="text-xs text-gray-600">📞 <a href={`tel:${lead.phone}`} className="hover:text-brand-600">{lead.phone}</a></p>}
                        {lead.email && <p className="text-xs text-gray-600">✉️ <a href={`mailto:${lead.email}`} className="hover:text-brand-600">{lead.email}</a></p>}
                        {lead.course_interest && <p className="text-xs text-gray-600">🎯 {lead.course_interest}</p>}
                        <p className="text-xs text-gray-400">{SOURCE_LABELS[lead.source] || lead.source || '—'} • {formatDate(lead.created_at)}</p>
                        <button
                          onClick={() => handleDelete(lead.id)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium mt-1"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, pagination.total)} of {pagination.total} leads
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-500 px-2">
                    {page} / {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                    disabled={page === pagination.totalPages}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
