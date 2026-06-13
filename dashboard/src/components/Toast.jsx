import { useState, useEffect } from 'react';

export default function Toast({ message, type = 'success', onClose }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', icon: 'text-emerald-500', bar: 'bg-emerald-500' },
    error:   { bg: 'bg-red-50 border-red-200', text: 'text-red-800', icon: 'text-red-500', bar: 'bg-red-500' },
    info:    { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800', icon: 'text-blue-500', bar: 'bg-blue-500' },
  };
  const c = colors[type] || colors.info;

  return (
    <div className={`fixed top-4 right-4 z-[100] max-w-sm w-full pointer-events-auto transition-all duration-300 ease-out ${visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
      <div className={`rounded-xl border shadow-lg overflow-hidden ${c.bg}`}>
        <div className="flex items-start gap-3 p-4">
          {type === 'success' && (
            <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${c.icon}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {type === 'error' && (
            <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${c.icon}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
          {type === 'info' && (
            <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${c.icon}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          )}
          <p className={`flex-1 text-sm font-medium ${c.text}`}>{message}</p>
          <button onClick={() => { setVisible(false); setTimeout(onClose, 300); }} className={`flex-shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors ${c.text}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className={`h-1 ${c.bar} animate-shrink`} />
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}
