import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useAuth } from '../hooks/useAuth';
import { getDefaultWidgetServerUrl, isWidgetServerReachable } from '../lib/widgetRuntime';

export default function Channels() {
  const { user } = useAuth();
  const qrCanvasRef = useRef(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [widgetServerHealthy, setWidgetServerHealthy] = useState(true);
  const [widgetCheckLoading, setWidgetCheckLoading] = useState(false);

  const slug = user?.slug || user?.company?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'demo-client';
  const widgetServerUrl = getDefaultWidgetServerUrl();
  const standaloneUrl = `${widgetServerUrl}/final-webpage/chat.html?slug=${encodeURIComponent(slug)}&utm_source=qr_code&utm_medium=offline&utm_campaign=${encodeURIComponent(`qr_${slug}`)}`;
  const isLocalWidget = widgetServerUrl.includes('localhost:3500') || widgetServerUrl.includes('127.0.0.1:3500');

  useEffect(() => {
    let cancelled = false;
    setWidgetCheckLoading(true);
    isWidgetServerReachable(widgetServerUrl).then((ok) => {
      if (!cancelled) {
        setWidgetServerHealthy(ok);
        setWidgetCheckLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [widgetServerUrl]);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(standaloneUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleDownloadQR = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `kira-qr-${slug || 'bot'}.png`;
    link.click();
  };

  const handleOpenStandalone = async () => {
    setWidgetCheckLoading(true);
    const healthy = await isWidgetServerReachable(widgetServerUrl, { force: true });
    setWidgetCheckLoading(false);
    setWidgetServerHealthy(healthy);

    if (!healthy) {
      window.alert('Widget server is not reachable on port 3500. Start it with "bash start-all.sh" and try again.');
      return;
    }

    window.open(standaloneUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Channels</h1>
        <p className="text-sm text-gray-500 mt-1">Deploy your AI assistant across customer touchpoints.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Standalone Chat Page</h2>
          <p className="text-sm text-gray-500 mb-4">
            Share this direct link with customers so they can instantly access your AI assistant.
          </p>
          {isLocalWidget && !widgetServerHealthy && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
              Widget server is offline (`localhost:3500`). Start local services before opening this link.
            </p>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="text"
              readOnly
              value={standaloneUrl}
              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none"
            />
            <button
              onClick={handleCopyLink}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              {copiedLink ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleOpenStandalone}
              disabled={widgetCheckLoading}
              className="px-4 py-2 text-center bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              {widgetCheckLoading ? 'Checking...' : 'Open'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center mb-4">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">QR Code</h2>
          <p className="text-sm text-gray-500 mb-4">
            Print this QR code on physical marketing material so users can scan and chat.
          </p>
          <div className="bg-white border border-dashed border-gray-200 rounded-lg p-4 flex items-center justify-center mb-4">
            <QRCodeCanvas
              ref={qrCanvasRef}
              value={standaloneUrl}
              size={180}
              level="M"
              includeMargin
              bgColor="#ffffff"
              fgColor="#111827"
            />
          </div>
          <button
            onClick={handleDownloadQR}
            className="w-full py-2.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            Download QR Code
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 md:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-[#25D366]/10 text-[#25D366] flex items-center justify-center">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">WhatsApp Integration</h2>
              <span className="px-2.5 py-1 bg-amber-100 text-amber-700 border border-amber-300 text-[10px] uppercase tracking-wider font-bold rounded-full">Coming Soon</span>
            </div>
            <p className="text-sm text-gray-500 max-w-2xl">
              Connect your WhatsApp Business account to let customers chat with your AI assistant directly on WhatsApp.
            </p>
          </div>
          <button
            disabled
            className="px-6 py-2.5 bg-[#25D366] text-white text-sm font-semibold rounded-xl opacity-50 cursor-not-allowed shadow-sm flex items-center justify-center whitespace-nowrap"
          >
            Coming Soon
          </button>
        </div>
      </div>
    </div>
  );
}
