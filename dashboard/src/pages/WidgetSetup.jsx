import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import EmbedCodeBlock from '../components/EmbedCodeBlock';
import { QRCodeCanvas } from 'qrcode.react';

// ── Constants ────────────────────────────────────────────────
const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const isLocalHost = () => window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const productionSafeUrl = (envUrl, localUrl, productionUrl) => {
  if (!envUrl) return isLocalHost() ? localUrl : productionUrl;
  if (!isLocalHost() && /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(envUrl)) {
    return productionUrl;
  }
  return envUrl;
};

// Helper to compress and resize image client-side before upload
const resizeAndCompressImage = (file, maxWidth = 400, maxHeight = 400, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                type: 'image/webp',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Canvas compression failed'));
            }
          },
          'image/webp',
          quality
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export default function WidgetSetup() {
  const [config, setConfig] = useState({
    name: 'Zara',
    color: '#00ffd5',
    welcome: 'Hi! How can I help you today?',
    prompt: '',
    businessPhone: '',
    businessEmail: '',
    standaloneTheme: 'dark',
    standaloneBgColor: '#f4f4f5',
    standaloneChatboxColor: '#ffffff',
  });
  const { user } = useAuth();
  const [apiToken, setApiToken] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenError, setTokenError] = useState(null);
  const [slug, setSlug] = useState(null);
  const [qrCopied, setQrCopied] = useState(false);
  const [sigCopied, setSigCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const qrRef = useRef(null);
  const qrCanvasRef = useRef(null);

  // ── Logo Upload State ──────────────────────────────────────
  const [widgetLogo, setWidgetLogo] = useState({ preview: null, uploading: false, error: null, serverUrl: null, progress: 0 });
  const widgetLogoRef = useRef(null);
  const logoPreviewUrlsRef = useRef(new Set());

  const setLogoPreviewFromServer = useCallback(async (serverUrl) => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}${serverUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, {
        mode: 'cors',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      logoPreviewUrlsRef.current.add(objectUrl);
      setWidgetLogo(prev => ({ ...prev, serverUrl, preview: objectUrl }));
    } catch (err) {
      console.warn('Logo preview blob load failed, falling back to direct URL:', err);
      setWidgetLogo(prev => ({ ...prev, serverUrl, preview: serverUrl }));
    }
  }, []);

  useEffect(() => () => {
    logoPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    logoPreviewUrlsRef.current.clear();
  }, []);

  // Fetch the real api_token for this user from the backend
  useEffect(() => {
    const loadToken = async () => {
      setTokenLoading(true);
      setTokenError(null);

      // First check if the auth context already has the token
      if (user?.apiToken) {
        setApiToken(user.apiToken);
        if (user.slug) setSlug(user.slug);
        setTokenLoading(false);
        return;
      }

      const storedToken = localStorage.getItem('sg_api_token');
      const storedUser = JSON.parse(localStorage.getItem('kiraUser') || 'null');
      if (storedToken) {
        setApiToken(storedToken);
        if (storedUser?.slug) setSlug(storedUser.slug);
        setTokenLoading(false);
        return;
      }

      setTokenError(user?.email ? 'Account profile is still loading. Please refresh if this persists.' : 'Please sign in to generate your embed code.');
      setTokenLoading(false);
    };
    loadToken();
  }, [user]);

  // When QR is generated, save to localStorage so Channels page can download it
  useEffect(() => {
    if (!showQr) return;
    const timer = setTimeout(() => {
      const canvas = qrCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 10), Math.min(canvas.height, 10));
      if (imageData.data.some(v => v !== 0)) {
        try { localStorage.setItem('kira_qr_data', canvas.toDataURL('image/png')); } catch {}
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [showQr]);

  const authToken = apiToken || localStorage.getItem('sg_api_token');
  const displayToken = authToken || 'loading...';

  const widgetBaseUrl = window.location.origin;
  const chatApiUrl = import.meta.env.VITE_CHAT_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://kira-chat-api.onrender.com');
  const dashboardApiUrl = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
  const [configLoading, setConfigLoading] = useState(false);
  const [configLoadError, setConfigLoadError] = useState(null);
  const [isPromptLocked, setIsPromptLocked] = useState(false);

  const MAX_PROMPT_CHARS = 500;

  // Load initial widget config from backend when slug is available
  useEffect(() => {
    if (!slug) return;
    const loadWidgetConfig = async () => {
      setConfigLoading(true);
      setConfigLoadError(null);
      try {
        const res = await fetch(`${dashboardApiUrl}/api/client/${encodeURIComponent(slug)}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const client = data.client || {};

        const name = data.agentName || client.widget_name || client.agentName || client.agent_name || '';
        const welcome = data.welcome || client.widget_welcome || client.welcome || client.welcome_message || '';
        const savedPrompt = (data.customPrompt ?? client.customPrompt ?? client.custom_prompt ?? '').toString();
        const color = data.color || client.branding_color || client.color || client.brand_color || '';

        const businessPhone = data.businessPhone || client.businessPhone || client.business_phone || '';
        const businessEmail = data.businessEmail || client.businessEmail || client.business_email || '';

        const standaloneTheme = data.standaloneTheme || client.standaloneTheme || client.standalone_theme || 'dark';
        const standaloneBgColor = data.standaloneBgColor || client.standaloneBgColor || client.standalone_bg_color || '#f4f4f5';
        const standaloneChatboxColor = data.standaloneChatboxColor || client.standaloneChatboxColor || client.standalone_chatbox_color || '#ffffff';

        const standaloneAgentName = (data.standaloneAgentName !== name) ? (data.standaloneAgentName || client.standalone_agent_name || '') : '';

        setConfig(prev => ({
          ...prev,
          name: name || prev.name,
          welcome: welcome || prev.welcome,
          prompt: savedPrompt,
          businessPhone,
          businessEmail,
          color: color || prev.color,
          standaloneTheme,
          standaloneBgColor,
          standaloneChatboxColor,
          standaloneAgentName,
        }));
        setIsPromptLocked(savedPrompt.trim().length > 0);

        // Logo resolution
        const hasWidgetLogo = data.hasWidgetLogo !== undefined ? data.hasWidgetLogo : (client.hasWidgetLogo || Boolean(client.widget_logo_data));
        const widgetLogoUrl = data.widgetLogo || data.logo || client.branding_logo || client.widgetLogo;

        if (hasWidgetLogo && widgetLogoUrl) {
          setWidgetLogo(prev => ({ ...prev, serverUrl: widgetLogoUrl }));
          setLogoPreviewFromServer(widgetLogoUrl);
        } else {
          setWidgetLogo(prev => prev.uploading ? prev : ({ ...prev, serverUrl: null, preview: null }));
        }
      } catch (e) {
        console.warn('Could not load widget config from API:', e);
        setConfigLoadError('Could not load saved widget configuration from the database.');
      } finally {
        setConfigLoading(false);
      }
    };
    loadWidgetConfig();
  }, [slug, dashboardApiUrl, setLogoPreviewFromServer]);

  // Explicit save function
  const saveConfig = async () => {
    if (!slug) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`${dashboardApiUrl}/api/client/${encodeURIComponent(slug)}/widget`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          widget_name: config.name,
          standalone_agent_name: config.standaloneAgentName || undefined,
          widget_welcome: config.welcome,
          custom_prompt: config.prompt.slice(0, MAX_PROMPT_CHARS),
          color: config.color,
          standalone_theme: config.standaloneTheme,
          standalone_bg_color: config.standaloneBgColor,
          standalone_chatbox_color: config.standaloneChatboxColor,
          business_phone: config.businessPhone.trim() || null,
          business_email: config.businessEmail.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfigLoadError(null);
      setSaveStatus('success');
      setIsPromptLocked(config.prompt.trim().length > 0);
    } catch (e) {
      console.warn('Widget config save failed:', e);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // ── Logo Upload Helpers ────────────────────────────────────
  const handleLogoUpload = useCallback(async (file, type) => {
    const setter = setWidgetLogo;

    // Validate file size
    if (file.size > MAX_LOGO_SIZE) {
      setter(prev => ({ ...prev, error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 5MB.` }));
      return;
    }
    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setter(prev => ({ ...prev, error: 'Unsupported file type. Use PNG, JPEG, WebP, or SVG.' }));
      return;
    }

    // Instant preview
    const previewUrl = URL.createObjectURL(file);
    setter({ preview: previewUrl, uploading: true, error: null, serverUrl: null, progress: 0 });

    try {
      let fileToUpload = file;
      // Skip compression for SVGs to keep them vector, compress other images client-side
      if (file.type !== 'image/svg+xml') {
        try {
          fileToUpload = await resizeAndCompressImage(file, 400, 400, 0.8);
          console.log(`[Dashboard] Compressed logo from ${(file.size / 1024).toFixed(1)}KB to ${(fileToUpload.size / 1024).toFixed(1)}KB`);
        } catch (compressErr) {
          console.warn('[Dashboard] Image compression failed, uploading original:', compressErr);
        }
      }

      const formData = new FormData();
      formData.append('logo', fileToUpload);

      // Use XMLHttpRequest for upload progress tracking.
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${dashboardApiUrl}/api/client/${encodeURIComponent(slug)}/logo/${type}`);
        if (authToken) {
          xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        }

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setter(prev => ({ ...prev, progress: pct }));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || 'Upload failed'));
            } catch {
              reject(new Error(`Upload failed (HTTP ${xhr.status})`));
            }
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(formData);
      });

      const logoUrl = result.logo_url ? `${result.logo_url}?v=${Date.now()}` : null;
      setter(prev => ({ ...prev, uploading: false, serverUrl: logoUrl, progress: 100 }));
      if (logoUrl) setLogoPreviewFromServer(logoUrl);
    } catch (err) {
      setter(prev => ({ ...prev, uploading: false, error: err.message, progress: 0 }));
    }
  }, [dashboardApiUrl, authToken, slug, setLogoPreviewFromServer]);

  const handleLogoRemove = useCallback(async (type) => {
    const setter = setWidgetLogo;
    const ref = widgetLogoRef;

    try {
      await fetch(`${dashboardApiUrl}/api/client/${encodeURIComponent(slug)}/logo/${type}`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
    } catch (e) {
      console.warn('Logo delete failed:', e);
    }

    setter({ preview: null, uploading: false, error: null, serverUrl: null });
    if (ref.current) ref.current.value = '';
  }, [dashboardApiUrl, authToken, slug]);

  const handleFileDrop = useCallback((e, type) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleLogoUpload(file, type);
  }, [handleLogoUpload]);

  const handleFileSelect = useCallback((e, type) => {
    const file = e.target.files?.[0];
    if (file) handleLogoUpload(file, type);
  }, [handleLogoUpload]);

  // Widget.js is served from the karline-widget static server (port 3500), not the dashboard.
  // This ensures it works when embedded on any external website.
  const widgetServerUrl = productionSafeUrl(import.meta.env.VITE_WIDGET_URL, 'http://localhost:3500', window.location.origin);
  const marketingUrl = productionSafeUrl(import.meta.env.VITE_MARKETING_URL, 'http://localhost:5500', window.location.origin);
  const embedCode = `<script
  src="${widgetServerUrl}/widget.js"
  data-token="${displayToken}"
  data-color="${config.color}"
  data-name="${config.name}"
  data-welcome="${config.welcome}"
  data-api="${chatApiUrl}"${widgetLogo.serverUrl ? `\n  data-logo="${widgetLogo.serverUrl}"` : ''}
  defer
></script>`;

  const handleChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  // ── Reusable Logo Upload Zone Component ─────────────────────
  const LogoUploadZone = ({ type, logo, inputRef, label }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {logo.preview ? (
        /* Preview + Actions */
        <div className="relative group">
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border-2 border-gray-200 transition-all duration-200">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-white border border-gray-200 flex-shrink-0 flex items-center justify-center shadow-sm">
              <img
                src={logo.preview}
                alt={`${type} logo preview`}
                className="w-full h-full object-contain"
                onError={() => {}}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {logo.uploading ? (
                  <div className="w-full">
                    <span className="flex items-center gap-2 text-sm text-blue-600 mb-1">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      Uploading... {logo.progress || 0}%
                    </span>
                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300 ease-out"
                        style={{
                          width: `${logo.progress || 0}%`,
                          background: 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                        }}
                      />
                    </div>
                  </div>
                ) : logo.serverUrl ? (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Uploaded successfully
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-gray-400 mt-1 truncate">Click &quot;Replace&quot; to change or &quot;Remove&quot; to delete</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="px-3 py-1.5 text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors duration-150"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => handleLogoRemove(type)}
                className="px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors duration-150"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Drop Zone */
        <div
          className="relative border-2 border-dashed border-gray-300 hover:border-brand-400 rounded-xl p-6 text-center cursor-pointer transition-all duration-200 hover:bg-brand-50/30 group"
          onDrop={(e) => handleFileDrop(e, type)}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={() => inputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-gray-100 group-hover:bg-brand-100 flex items-center justify-center transition-colors duration-200">
              <svg className="w-6 h-6 text-gray-400 group-hover:text-brand-500 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">
                <span className="text-brand-600">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-gray-400 mt-0.5">PNG, JPEG, WebP or SVG — max 5MB</p>
            </div>
          </div>
        </div>
      )}
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => handleFileSelect(e, type)}
      />
      {/* Error message */}
      {logo.error && (
        <div className="mt-2 flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {logo.error}
        </div>
      )}
    </div>
  );

  const downloadQR = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;

    const doDownload = () => {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        // Save to localStorage so Channels page can also download it
        try { localStorage.setItem('kira_qr_data', canvas.toDataURL('image/png')); } catch {}
        const link = document.createElement('a');
        link.download = `kira-qr-${slug || 'bot'}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
      }, 'image/png');
    };

    // Check if canvas has been painted — QRCodeCanvas draws in a useEffect
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 10), Math.min(canvas.height, 10));
    const hasContent = imageData.data.some(v => v !== 0);

    if (!hasContent) {
      setTimeout(doDownload, 200);
    } else {
      doDownload();
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Widget Setup</h1>
        <p className="text-sm text-gray-500 mt-1">Customise your chat widget and get the embed code</p>
      </div>

      {/* Token Status Banner */}
      {tokenLoading && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <p className="text-sm text-blue-800">Loading your API token...</p>
        </div>
      )}

      {tokenError && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-800">{tokenError}</p>
        </div>
      )}

      {configLoading && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <p className="text-sm text-blue-800">Loading saved widget configuration from database...</p>
        </div>
      )}

      {configLoadError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-red-800">{configLoadError}</p>
        </div>
      )}

      {apiToken && !tokenLoading && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-emerald-800">
            Your unique API token is loaded: <code className="bg-emerald-100 px-1.5 py-0.5 rounded text-xs font-mono">{apiToken.slice(0, 16)}…</code>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Configuration Form */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Configuration</h2>
          <div className="space-y-5">
            <div>
              <label htmlFor="agent-name" className="block text-sm font-medium text-gray-700 mb-1.5">Company / Agent Name</label>
              <input
                id="agent-name"
                type="text"
                value={config.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all duration-200"
              />
            </div>
            <LogoUploadZone
              type="widget"
              logo={widgetLogo}
              inputRef={widgetLogoRef}
              label="Company Logo"
            />
            <div>
              <label htmlFor="primary-color" className="block text-sm font-medium text-gray-700 mb-1.5">Primary Color</label>
              <div className="flex items-center gap-3">
                <input
                  id="primary-color"
                  type="color"
                  value={config.color}
                  onChange={(e) => handleChange('color', e.target.value)}
                  className="w-12 h-12 rounded-xl border border-gray-200 cursor-pointer p-1"
                />
                <input
                  type="text"
                  value={config.color}
                  onChange={(e) => handleChange('color', e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all duration-200"
                />
              </div>
            </div>
            <div>
              <label htmlFor="welcome-msg" className="block text-sm font-medium text-gray-700 mb-1.5">Welcome Message</label>
              <textarea
                id="welcome-msg"
                value={config.welcome}
                onChange={(e) => handleChange('welcome', e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all duration-200 resize-none"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="system-prompt" className="block text-sm font-medium text-gray-700">System Prompt (AI Instructions)</label>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-medium ${
                    config.prompt.length > MAX_PROMPT_CHARS * 0.9
                      ? config.prompt.length >= MAX_PROMPT_CHARS ? 'text-red-500' : 'text-amber-500'
                      : 'text-gray-400'
                  }`}>
                    {config.prompt.length}/{MAX_PROMPT_CHARS}
                  </span>
                  {isPromptLocked && (
                    <button
                      type="button"
                      onClick={() => setIsPromptLocked(false)}
                      className="px-2.5 py-1 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="system-prompt"
                value={config.prompt}
                onChange={(e) => handleChange('prompt', e.target.value.slice(0, MAX_PROMPT_CHARS))}
                rows={6}
                maxLength={MAX_PROMPT_CHARS}
                readOnly={isPromptLocked}
                placeholder="Example: Act like a customer support agent. Organically ask for the user's name, email, and phone number before answering sensitive questions."
                className={`w-full px-4 py-3 rounded-xl border text-sm transition-all duration-200 resize-none font-mono ${
                  isPromptLocked
                    ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed'
                    : `focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                        config.prompt.length >= MAX_PROMPT_CHARS
                          ? 'border-red-300 focus:border-red-400 focus:ring-red-500/20'
                          : 'border-gray-200 focus:border-brand-400'
                      }`
                }`}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                {isPromptLocked
                  ? 'Prompt is locked after save. Click Edit to update it.'
                  : "This prompt defines your AI's personality and rules. Be specific about what info it should collect."}
              </p>
            </div>

            {/* Business Contact Details */}
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-900">Business Contact Details <span className="font-normal text-blue-500">(optional)</span></p>
                  <p className="text-xs text-blue-600 mt-0.5">When the chatbot escalates a conversation, it will show these details. If left empty, it will say <em>"We will reach out to you shortly."</em></p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label htmlFor="business-phone" className="block text-xs font-semibold text-blue-800 mb-1">Business Phone Number</label>
                  <input
                    id="business-phone"
                    type="tel"
                    value={config.businessPhone}
                    onChange={(e) => handleChange('businessPhone', e.target.value)}
                    placeholder="e.g. +91 98765 43210"
                    className="w-full px-3 py-2.5 rounded-lg border border-blue-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="business-email" className="block text-xs font-semibold text-blue-800 mb-1">Business Email Address</label>
                  <input
                    id="business-email"
                    type="email"
                    value={config.businessEmail}
                    onChange={(e) => handleChange('businessEmail', e.target.value)}
                    placeholder="e.g. support@yourcompany.com"
                    className="w-full px-3 py-2.5 rounded-lg border border-blue-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              {/* Save status toast */}
              {saveStatus === 'success' && (
                <div className="mb-3 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2.5 rounded-xl">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Configuration saved successfully!
                </div>
              )}
              {saveStatus === 'error' && (
                <div className="mb-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-2.5 rounded-xl">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  {!slug ? 'Account not loaded yet. Please wait and try again.' : 'Save failed. Please try again.'}
                </div>
              )}
              <button
                onClick={saveConfig}
                disabled={isSaving}
                className={`w-full py-3 px-4 rounded-xl text-sm font-semibold text-white transition-all duration-200 ${
                  isSaving 
                    ? 'bg-brand-400 cursor-not-allowed' 
                    : 'bg-brand-500 hover:bg-brand-600 hover:shadow-lg hover:shadow-brand-500/30 active:transform active:scale-[0.98]'
                }`}
              >
                {isSaving ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </span>
                ) : (
                  'Save Configuration'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Live Preview</h2>
          <div className="relative bg-gray-100 rounded-xl overflow-hidden border border-gray-200" style={{ minHeight: '520px' }}>
            {/* Fake browser chrome */}
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400"></div>
              </div>
              <div className="flex-1 bg-gray-100 rounded-md px-3 py-1 text-xs text-gray-400 font-mono">
                https://yourcompany.com
              </div>
            </div>

            {/* Fake website content */}
            <div className="p-6">
              <div className="h-6 bg-gray-200 rounded-md w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-6"></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="h-20 bg-gray-200 rounded-lg"></div>
                <div className="h-20 bg-gray-200 rounded-lg"></div>
                <div className="h-20 bg-gray-200 rounded-lg"></div>
              </div>
            </div>

            {/* Chat Widget Preview */}
            <div className="absolute bottom-4 right-4 flex flex-col items-end gap-3">
              {/* Chat popup */}
              <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-[320px] overflow-hidden border border-black/5 animate-slide-in flex flex-col" style={{ height: '380px' }}>
                {/* Header — matches widget sg-header */}
                <div 
                  className="px-5 py-4 text-white flex items-center justify-between"
                  style={{ backgroundColor: config.color }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-[11px] font-extrabold tracking-wide overflow-hidden">
                      {widgetLogo.preview ? (
                        <img src={widgetLogo.preview} alt="logo" className="w-full h-full object-cover" />
                      ) : (
                        'KIRA'
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-[15px] leading-tight">{config.name}</p>
                      <p className="text-xs opacity-85 flex items-center gap-1.5 mt-0.5 font-medium">
                        <span className="w-2 h-2 rounded-full bg-white inline-block"></span>
                        Online
                      </p>
                    </div>
                  </div>
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors" disabled>
                    <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                {/* Messages area */}
                <div className="flex-1 p-5 bg-white flex flex-col gap-2.5">
                  <div className="flex gap-2.5 items-end">
                    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-extrabold text-white" style={{ backgroundColor: config.color }}>
                      K
                    </div>
                    <div 
                      className="text-sm px-4 py-3 rounded-[18px] rounded-bl-[4px] max-w-[85%] text-white leading-relaxed"
                      style={{ backgroundColor: config.color }}
                    >
                      {config.welcome}
                    </div>
                  </div>
                </div>
                {/* Input bar — matches widget sg-input-bar */}
                <div className="px-4 py-3 border-t border-black/5 flex items-center gap-2.5 bg-white">
                  <button className="w-9 h-9 rounded-[10px] flex items-center justify-center text-gray-400" disabled>
                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                      <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                  </button>
                  <input
                    type="text"
                    placeholder="Type a message..."
                    disabled
                    className="flex-1 px-4 py-2.5 bg-gray-50 rounded-[14px] text-sm text-gray-400 border border-gray-200 outline-none"
                  />
                  <button 
                    className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-white shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${config.color}, #0ea5e9)`, boxShadow: `0 4px 14px ${config.color}59` }}
                    disabled
                  >
                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
                {/* Powered by */}
                <div className="text-center py-1.5 text-[10px] text-gray-400 border-t border-black/5 tracking-wide">
                  Powered by <span className="font-bold" style={{ color: config.color }}>KIRA</span>
                </div>
              </div>

              {/* FAB — matches widget sg-bubble (rounded-square, gradient) */}
              <button
                className="w-16 h-16 rounded-[18px] shadow-xl flex items-center justify-center text-white transition-transform duration-200 hover:scale-110"
                style={{ background: `linear-gradient(135deg, ${config.color}, #0ea5e9)`, boxShadow: `0 8px 32px ${config.color}66` }}
              >
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Embed Code */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Embed Code</h2>
        <p className="text-sm text-gray-500 mb-4">Copy this code and paste it before the closing <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-brand-600">&lt;/body&gt;</code> tag on your website.</p>
        <EmbedCodeBlock code={embedCode} />
      </div>

      {/* Standalone Page Configuration */}
      <div className="mt-8">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Standalone Page Appearance</h2>
              <p className="text-sm text-gray-500">Customise the look of your standalone chat page that visitors see when they scan the QR code or click the shared link.</p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {/* Logo note */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center gap-3">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 7.5a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              <p className="text-xs text-gray-500">
                The <strong>Company Logo</strong> you uploaded above is used on this page too. Changes auto-sync.
              </p>
            </div>

            {/* Standalone Page Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Standalone Page Name</label>
              <input
                type="text"
                value={config.standaloneAgentName}
                onChange={(e) => handleChange('standaloneAgentName', e.target.value)}
                placeholder="Leave blank to use the Company/Agent Name from above"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all duration-200"
              />
              <p className="text-xs text-gray-400 mt-1.5">The name that appears at the top left of your standalone page.</p>
            </div>

            {/* Design info */}
            <div className="p-4 bg-gradient-to-r from-indigo-50 to-brand-50 rounded-xl border border-indigo-100">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">Clean, Modern Layout</p>
                  <p className="text-xs text-gray-500 mt-0.5">Your standalone page uses a premium chat interface — similar to ChatGPT or Claude. The <strong>Accent Color</strong> you set in the Widget Config above is used for buttons, user bubbles, and highlights.</p>
                </div>
              </div>
            </div>

            {/* Background Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Page Background Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={config.standaloneBgColor}
                  onChange={(e) => handleChange('standaloneBgColor', e.target.value)}
                  className="w-12 h-12 rounded-xl border border-gray-200 cursor-pointer p-1"
                />
                <input
                  type="text"
                  value={config.standaloneBgColor}
                  onChange={(e) => handleChange('standaloneBgColor', e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all duration-200"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">The background behind the chat area. Try <code className="bg-gray-100 px-1 rounded text-[10px]">#f4f4f5</code> for a clean gray or <code className="bg-gray-100 px-1 rounded text-[10px]">#eef2ff</code> for a subtle blue tint.</p>
            </div>

            {/* Preview hint and Save button */}
            {slug && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center gap-3 flex-1">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  <p className="text-xs text-gray-500">
                    Save your config then <a href={`${widgetServerUrl}/final-webpage/chat.html?slug=${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline font-medium">preview your standalone page</a>.
                  </p>
                </div>
                <button
                  onClick={saveConfig}
                  disabled={isSaving}
                  className={`py-3 px-6 rounded-xl text-sm font-semibold text-white transition-all duration-200 whitespace-nowrap ${
                    isSaving 
                      ? 'bg-brand-400 cursor-not-allowed' 
                      : 'bg-brand-500 hover:bg-brand-600 hover:shadow-lg hover:shadow-brand-500/30'
                  }`}
                >
                  {isSaving ? 'Saving...' : 'Save Appearance'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* QR Code + Email Signature — side by side */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* QR Code Download */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">QR Code</h2>
          <p className="text-sm text-gray-500 mb-5">Print this QR code on brochures, posters, or standees. It links directly to your AI chat page.</p>
          {slug ? (() => {
            const chatUrl = `${widgetServerUrl}/final-webpage/chat.html?slug=${encodeURIComponent(slug)}&utm_source=qr_code&utm_medium=offline&utm_campaign=${encodeURIComponent(`qr_${slug}`)}`;
            return (
            <div className="flex flex-col items-center gap-4">
              {showQr ? (
                <>
                  <div className="bg-white p-4 rounded-xl border-2 border-dashed border-gray-200" ref={qrRef}>
                    <QRCodeCanvas
                      ref={qrCanvasRef}
                      value={chatUrl}
                      size={200}
                      fgColor={config.color}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                  <p className="text-xs text-gray-400 font-mono">{marketingUrl}/final-webpage/chat.html?slug={slug}&utm_source=qr_code</p>
                </>
              ) : (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 mx-auto mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-500">Generate your QR code when you are ready.</p>
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowQr(true)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg transition-all duration-200 ${showQr ? 'bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-brand-500 text-white hover:bg-brand-600 shadow-brand-500/25'}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                  </svg>
                  Generate QR
                </button>
                <button
                  onClick={downloadQR}
                  disabled={!showQr}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg transition-all duration-200 ${showQr ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/25' : 'cursor-not-allowed bg-gray-200 text-gray-400 shadow-none'}`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download PNG
                </button>
              </div>
            </div>
            );
          })() : (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 mx-auto mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">No slug configured for your account.</p>
              <p className="text-xs text-gray-400 mt-1">Contact support to set up your standalone chat page.</p>
            </div>
          )}
        </div>

        {/* Email Signature Generator */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Email Signature</h2>
          <p className="text-sm text-gray-500 mb-5">Add this to your email signature so every email becomes a lead capture opportunity.</p>
          {slug ? (() => {
            const chatUrl = `${marketingUrl}/final-webpage/chat.html?slug=${encodeURIComponent(slug)}`;
            const sigHtml = `<table cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;">
  <tr>
    <td style="padding:12px 16px;background:${config.color};border-radius:8px;">
      <a href="${chatUrl}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
        💬 Chat with our AI Assistant →
      </a>
    </td>
  </tr>
  <tr>
    <td style="padding-top:6px;">
      <span style="font-size:11px;color:#999;">Powered by Kira AI</span>
    </td>
  </tr>
</table>`;
            return (
              <div>
                {/* Preview */}
                <div className="mb-5 p-5 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Preview</p>
                  <table cellPadding="0" cellSpacing="0" style={{ fontFamily: 'Arial, sans-serif' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '12px 16px', background: config.color, borderRadius: '8px' }}>
                          <a href={chatUrl} style={{ color: '#ffffff', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }} onClick={(e) => e.preventDefault()}>
                            💬 Chat with our AI Assistant →
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: '6px' }}>
                          <span style={{ fontSize: '11px', color: '#999' }}>Powered by Kira AI</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* HTML Code */}
                <div className="relative">
                  <pre className="bg-gray-900 text-gray-300 p-4 rounded-xl text-xs font-mono overflow-x-auto max-h-32">{sigHtml}</pre>
                  <button
                    onClick={() => {
                      try {
                        const type = "text/html";
                        const blob = new Blob([sigHtml], { type });
                        const data = [new ClipboardItem({ 
                          [type]: blob,
                          "text/plain": new Blob([sigHtml], { type: "text/plain" }) 
                        })];
                        navigator.clipboard.write(data).then(() => {
                          setSigCopied(true);
                          setTimeout(() => setSigCopied(false), 2000);
                        });
                      } catch (err) {
                        navigator.clipboard.writeText(sigHtml);
                        setSigCopied(true);
                        setTimeout(() => setSigCopied(false), 2000);
                      }
                    }}
                    className={`absolute top-3 right-3 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${sigCopied ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    {sigCopied ? '✓ Copied!' : 'Copy for Gmail'}
                  </button>
                </div>
              </div>
            );
          })() : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">Set up your slug first to generate an email signature.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
