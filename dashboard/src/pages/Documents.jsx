import { useState, useEffect, useCallback, useRef } from 'react';
import DocumentRow from '../components/DocumentRow';
import UploadZone from '../components/UploadZone';
import { ToastContainer } from '../components/Toast';
import api from '../api/client';
import { useAuth } from '../hooks/useAuth';

export default function Documents() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [usage, setUsage] = useState(null);
  const sseRef = useRef(null);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Fetch documents from the real API
  const fetchDocuments = useCallback(async () => {
    if (!user?.customerId) return;
    try {
      const [docRes, usageRes] = await Promise.all([
        api.get('/api/documents'),
        api.get('/api/usage')
      ]);
      setDocuments(docRes.data.documents || []);
      setUsage(usageRes.data);
      setError(null);
      return docRes.data.documents || [];
    } catch (err) {
      console.error('Failed to fetch documents/usage:', err);
      setError('Could not load data. Make sure the Ingestion API is running.');
      return null;
    }
  }, [user]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      if (!user?.customerId) return;
      setLoading(true);
      const fetchUsage = async () => {
        try {
          const res = await api.get('/api/usage');
          setUsage(res.data);
        } catch (err) {
          console.warn('Could not fetch usage:', err);
        }
      };
      await Promise.all([fetchDocuments(), fetchUsage()]);
      setLoading(false);
    };
    load();
  }, [fetchDocuments, user]);

  // ── SSE: Real-time document status updates ─────────────────
  // WHY SSE INSTEAD OF POLLING:
  // - Instant updates when the worker finishes (no 3s delay)
  // - No wasted network requests when nothing is happening
  // - Browser handles reconnection automatically
  // - Falls back to polling if SSE connection fails
  useEffect(() => {
    const token = localStorage.getItem('sg_api_token') || import.meta.env.VITE_API_TOKEN || 'sk_demo_local_token';
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

    // EventSource doesn't support custom headers, so we pass the token as a query param
    // The SSE endpoint also accepts auth from the cookie/query as fallback
    const sseUrl = `${baseUrl}/api/documents/events`;

    try {
      // We use fetch-based SSE since native EventSource doesn't support headers
      const connectSSE = () => {
        fetch(sseUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
        }).then(response => {
          if (!response.ok) {
            console.warn('SSE connection failed, events will use polling fallback');
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const processStream = ({ done, value }) => {
            if (done) {
              console.log('SSE stream ended, reconnecting in 5s...');
              setTimeout(connectSSE, 5000);
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            let eventName = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith('data: ') && eventName === 'document:status-changed') {
                try {
                  const payload = JSON.parse(line.slice(6));
                  console.log('📡 SSE event received:', payload);

                  // Update the specific document in-place
                  setDocuments(prev => prev.map(doc => {
                    if (String(doc.id) === String(payload.doc_id)) {
                      return {
                        ...doc,
                        status: payload.status,
                        chunk_count: payload.chunk_count ?? doc.chunk_count,
                        error_message: payload.error_message ?? doc.error_message,
                      };
                    }
                    return doc;
                  }));

                  // Show toast notification
                  if (payload.status === 'ready') {
                    addToast(`Document processed — ${payload.chunk_count} chunks created`, 'success');
                  } else if (payload.status === 'error') {
                    addToast(`Document processing failed: ${payload.error_message || 'Unknown error'}`, 'error');
                  }
                } catch (e) {
                  console.warn('Failed to parse SSE data:', e);
                }
                eventName = '';
              }
            }

            reader.read().then(processStream);
          };

          sseRef.current = { abort: () => reader.cancel() };
          reader.read().then(processStream);
        }).catch(err => {
          console.warn('SSE connection error:', err.message);
        });
      };

      connectSSE();
    } catch (err) {
      console.warn('SSE setup failed:', err.message);
    }

    return () => {
      if (sseRef.current?.abort) {
        sseRef.current.abort();
      }
    };
  }, [addToast]);

  // Upload PDF or TXT file via the unified upload-file endpoint
  const handleUpload = async (file) => {
    if (usage && usage.storage) {
      if (file.size > usage.storage.max_file_mb * 1024 * 1024) {
        addToast(`File too large. Maximum ${usage.storage.max_file_mb} MB on ${usage.plan} plan.`, 'error');
        return;
      }
      
      if (usage.storage.sources >= usage.storage.max_sources) {
        addToast(`Maximum ${usage.storage.max_sources} sources allowed on ${usage.plan} plan.`, 'error');
        return;
      }
      
      if (usage.storage.used_chars >= usage.storage.limit_chars) {
        addToast(`Storage limit reached. You've used ${usage.storage.used_chars.toLocaleString()} total characters. Upgrade your plan.`, 'error');
        return;
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use the unified /upload-file endpoint for both .pdf and .txt
      const res = await api.post('/api/documents/upload-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      addToast(`"${file.name}" uploaded — processing started`, 'info');
      await fetchDocuments();
      // No need to start polling — SSE will notify us when processing completes
    } catch (err) {
      console.error('Upload failed:', err);
      addToast(err.response?.data?.error || 'Failed to upload file. Check that the API is running.', 'error');
    }
    setUploading(false);
  };

  // Add URL
  const handleAddUrl = async () => {
    if (!urlInput.trim()) return;

    if (usage && usage.storage) {
      if (usage.storage.sources >= usage.storage.max_sources) {
        addToast(`Maximum ${usage.storage.max_sources} sources allowed on ${usage.plan || 'free'} plan.`, 'error');
        return;
      }
    }

    const url = urlInput.trim();
    setShowUrlModal(false);
    setUrlInput('');
    try {
      const res = await api.post('/api/documents/add-url', { url });
      addToast(`URL added — processing started`, 'info');
      await fetchDocuments();
      // SSE will handle the status update notification
    } catch (err) {
      console.error('Add URL failed:', err);
      addToast(err.response?.data?.error || 'Failed to add URL. Check that the API is running.', 'error');
    }
  };

  // Delete
  const handleDelete = (docId) => { setShowConfirmDelete(docId); };

  const confirmDelete = async () => {
    const docId = showConfirmDelete;
    const doc = documents.find(d => String(d.id) === String(docId));
    
    // Optimistic UI: save backup, remove row immediately, close modal
    const backup = [...documents];
    setDocuments(prev => prev.filter(d => String(d.id) !== String(docId)));
    setShowConfirmDelete(null);
    addToast(`"${doc?.filename || doc?.source_url || 'Document'}" deleted`, 'success');

    // Fire the API call in the background
    try {
      await api.delete(`/api/documents/${docId}`);
    } catch (err) {
      // API failed — restore the document row
      console.error('Delete failed:', err);
      setDocuments(backup);
      addToast(err.response?.data?.error || 'Delete failed — document restored.', 'error');
    }
  };

  // Loading skeleton
  const LoadingSkeleton = () => (
    <div className="space-y-0">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-gray-50 animate-pulse">
          <div className="w-9 h-9 rounded-lg bg-gray-200" />
          <div className="flex-1 space-y-2"><div className="h-4 bg-gray-200 rounded w-1/3" /></div>
          <div className="h-4 bg-gray-200 rounded w-12" />
          <div className="h-6 bg-gray-200 rounded-full w-16" />
          <div className="h-8 w-8 bg-gray-200 rounded-lg" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Documents</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your AI's knowledge base</p>
        </div>
        <button
          onClick={() => setShowUrlModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 shadow-lg shadow-brand-500/25 transition-all duration-200 hover:-translate-y-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add URL
        </button>
      </div>

      {/* Upload Zone */}
      <div className="mb-6">
        {usage && usage.storage && (() => {
          const percent = Math.min(100, Math.max(0, (usage.storage.used_chars / usage.storage.limit_chars) * 100));

          return (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span className="text-brand-500">📚</span> Knowledge Base Storage
                  </h3>
                  <p className="text-xs text-gray-500 mt-1 capitalize">
                    Max file size: {usage.storage.max_file_mb} MB per upload
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">
                    {usage.storage.used_chars.toLocaleString()} / {usage.storage.limit_chars.toLocaleString()} characters
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {usage.storage.sources} / {usage.storage.max_sources} sources used
                  </p>
                </div>
              </div>
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${percent > 90 ? 'bg-red-500' : percent > 75 ? 'bg-amber-500' : 'bg-brand-500'}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })()}

        <UploadZone onFileSelect={handleUpload} />
        {uploading && (
          <div className="mt-3 flex items-center gap-2 text-sm text-brand-600">
            <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Uploading…
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={() => { setLoading(true); setError(null); fetchDocuments().then(() => setLoading(false)); }}
            className="px-4 py-2 text-sm font-semibold text-red-600 bg-red-100 hover:bg-red-200 rounded-lg transition-colors flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Documents Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Document Name</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Chunks</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Date Added</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}><LoadingSkeleton /></td></tr>
              ) : (
                <>
                  {documents.map(doc => (
                    <DocumentRow key={doc.id} doc={doc} onDelete={handleDelete} />
                  ))}
                  {documents.length === 0 && !error && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
                            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                          </div>
                          <p className="text-gray-400 text-sm">No documents yet. Upload a PDF or add a URL to get started.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* URL Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowUrlModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Add URL</h2>
            <p className="text-sm text-gray-500 mb-5">Enter a documentation URL to crawl and index</p>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://docs.example.com"
              autoFocus
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all duration-200 mb-5"
              onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowUrlModal(false); setUrlInput(''); }} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
              <button onClick={handleAddUrl} disabled={!urlInput.trim()} className="px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 shadow-lg shadow-brand-500/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 text-center mb-1">Delete this document?</h3>
            <p className="text-sm text-gray-500 text-center mb-6">This action cannot be undone. The document will be removed from your knowledge base.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmDelete(null)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-lg shadow-red-500/25 transition-all duration-200">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
