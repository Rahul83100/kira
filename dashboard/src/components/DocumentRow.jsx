export default function DocumentRow({ doc, onDelete }) {
  const statusConfig = {
    ready: {
      label: 'Ready',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dot: 'bg-emerald-500',
    },
    processing: {
      label: 'Processing',
      classes: 'bg-amber-50 text-amber-700 border-amber-200',
      dot: 'bg-amber-500 animate-pulse-soft',
    },
    error: {
      label: 'Error',
      classes: 'bg-red-50 text-red-700 border-red-200',
      dot: 'bg-red-500',
    },
  };

  const status = statusConfig[doc.status] || statusConfig.processing;
  const isUrl = doc.source_type === 'url';

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors duration-150 animate-fade-in">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isUrl ? 'bg-blue-50 text-blue-500' : 'bg-brand-50 text-brand-500'
          }`}>
            {isUrl ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.135a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.757 8.95" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate max-w-[180px] sm:max-w-xs">
              {doc.filename || doc.source_url}
            </p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{doc.source_type}</span>
      </td>
      <td className="px-5 py-4 hidden sm:table-cell">
        <span className="text-sm text-gray-600">{doc.chunk_count || '—'}</span>
      </td>
      <td className="px-5 py-4">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${status.classes}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
          {status.label}
          {doc.status === 'processing' && (
            <svg className="w-3 h-3 animate-spin-slow" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          )}
        </span>
      </td>
      <td className="px-5 py-4 hidden sm:table-cell">
        <span className="text-sm text-gray-500">{doc.created_at}</span>
      </td>
      <td className="px-5 py-4">
        <button
          onClick={() => onDelete(doc.id)}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-200"
          title="Delete document"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </td>
    </tr>
  );
}
