import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);
const CHAT_API_URL = import.meta.env.VITE_CHAT_API_URL || 'http://localhost:3001';

const TONES = [
  { id: 'professional', label: 'Professional', icon: '💼', desc: 'Formal and business-like' },
  { id: 'concise', label: 'Concise', icon: '⚡', desc: 'Short and to the point' },
  { id: 'polite', label: 'Polite', icon: '🤝', desc: 'Courteous and respectful' },
  { id: 'friendly', label: 'Friendly', icon: '😊', desc: 'Warm and approachable' },
  { id: 'casual', label: 'Casual', icon: '✌️', desc: 'Relaxed and informal' },
];

const GOALS = [
  { id: 'support', label: 'Automate Support', icon: '🤖', desc: 'Let AI handle customer questions 24/7' },
];

const DEFAULT_INSTRUCTIONS = {
  support: "You're a helpful support assistant. Answer questions based on the knowledge base. Be clear and helpful. If you don't know the answer, politely say so and offer to connect with a human agent.",
};

// ─── Stepper ───────────────────────────────────────────────
function Stepper({ current, steps }) {
  return (
    <div className="flex items-center gap-1 w-full max-w-xl mx-auto">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center flex-1">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-300 flex-shrink-0 ${
            i < current ? 'bg-brand-500 text-black' : i === current ? 'bg-brand-500/20 text-brand-400 ring-2 ring-brand-500' : 'bg-white/5 text-white/30'
          }`}>
            {i < current ? '✓' : i + 1}
          </div>
          {i < steps.length - 1 && (
            <div className={`h-[2px] flex-1 mx-1.5 rounded-full transition-all duration-500 ${i < current ? 'bg-brand-500' : 'bg-white/10'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Widget Preview Panel ─────────────────────────────────
function WidgetPreview({ config }) {
  const color = config.color || '#00ffd5';
  const name = config.agent_name || 'Kira';
  const welcome = config.welcome || 'Hi! How can I help you today?';

  return (
    <div className="hidden lg:flex flex-col items-center justify-center p-8">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-6">Widget Preview</p>
      <div className="bg-white rounded-2xl shadow-2xl w-[300px] overflow-hidden border border-white/10">
        <div className="px-4 py-3.5 text-white flex items-center gap-3" style={{ backgroundColor: color }}>
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-extrabold">KIRA</div>
          <div>
            <p className="font-semibold text-sm leading-tight">{name}</p>
            <p className="text-[10px] opacity-80 flex items-center gap-1 mt-0.5"><span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />Online</p>
          </div>
        </div>
        <div className="p-4 bg-white min-h-[200px]">
          <div className="flex gap-2 items-end">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: color }}>K</div>
            <div className="text-xs px-3 py-2.5 rounded-2xl rounded-bl text-white max-w-[80%]" style={{ backgroundColor: color }}>{welcome}</div>
          </div>
        </div>
        <div className="px-3 py-2.5 border-t border-gray-100 flex items-center gap-2">
          <input disabled placeholder="Type a message..." className="flex-1 px-3 py-2 bg-gray-50 rounded-xl text-xs text-gray-400 border border-gray-200 outline-none" />
          <button disabled className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: color }}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div className="text-center py-1 text-[9px] text-gray-400 border-t border-gray-50">Powered by <span className="font-bold" style={{ color }}>KIRA</span></div>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────
export default function OnboardingWizard() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const token = user?.apiToken || localStorage.getItem('sg_api_token');

  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [crawling, setCrawling] = useState(false);
  const [crawlResult, setCrawlResult] = useState(null);
  const [crawlError, setCrawlError] = useState('');
  const [agentName, setAgentName] = useState('Kira');
  const [tone, setTone] = useState('friendly');
  const [instructions, setInstructions] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [completing, setCompleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState(user?.slug || '');
  const [color] = useState('#00ffd5');

  // Preview step — interactive chat state
  const [previewChatOpen, setPreviewChatOpen] = useState(true);
  const [previewMessages, setPreviewMessages] = useState([
    { role: 'bot', text: 'Hi! How can I help you today? 👋' },
  ]);
  const [previewInput, setPreviewInput] = useState('');
  const [previewTyping, setPreviewTyping] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);

  const handlePreviewSend = () => {
    const msg = previewInput.trim();
    if (!msg) return;
    setPreviewMessages(prev => [...prev, { role: 'user', text: msg }]);
    setPreviewInput('');
    setPreviewTyping(true);
    setTimeout(() => {
      setPreviewMessages(prev => [...prev, {
        role: 'bot',
        text: "I'm almost ready! 🚀 Please complete the remaining setup steps so I can be fully trained on your content. Once you launch, I'll be able to answer all your customers' questions!"
      }]);
      setPreviewTyping(false);
    }, 1200);
  };

  // Load saved state
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/onboarding/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.onboarding_completed) { navigate('/dashboard', { replace: true }); return; }
        if (data.goal) setGoal(data.goal);
        if (data.agent_tone) setTone(data.agent_tone);
        if (data.agent_instructions) setInstructions(data.agent_instructions);
        if (data.agent_name) setAgentName(data.agent_name);
        if (data.screenshot_url) setScreenshotUrl(data.screenshot_url);
        if (data.slug) setSlug(data.slug);
      }).catch(() => {});
  }, [token, navigate]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Step 1 — Save goal
  const handleGoalNext = async () => {
    if (!goal) return;
    setInstructions(DEFAULT_INSTRUCTIONS[goal] || '');
    try { await fetch(`${API_URL}/api/onboarding/goal`, { method: 'POST', headers, body: JSON.stringify({ goal }) }); } catch {}
    setStep(1);
  };

  // Step 2 — Train website
  const handleTrainWebsite = async () => {
    if (!websiteUrl) return;
    setCrawling(true); setCrawlError(''); setCrawlResult(null);
    try {
      const res = await fetch(`${API_URL}/api/onboarding/train-website`, { method: 'POST', headers, body: JSON.stringify({ url: websiteUrl }) });
      const data = await res.json();
      if (!res.ok) { setCrawlError(data.error || 'Failed to crawl website'); if (data.screenshot_url) setScreenshotUrl(data.screenshot_url); }
      else { setCrawlResult(data); if (data.screenshot_url) setScreenshotUrl(data.screenshot_url); }
    } catch (err) { setCrawlError('Network error. Please try again.'); }
    setCrawling(false);
  };

  // Step 3 — Save config
  const handleConfigNext = async () => {
    try { await fetch(`${API_URL}/api/onboarding/configure-agent`, { method: 'POST', headers, body: JSON.stringify({ agent_name: agentName, tone, instructions }) }); } catch {}
    setStep(3);
  };

  // Step 5 — Complete
  const handleComplete = async () => {
    setCompleting(true);
    try {
      await fetch(`${API_URL}/api/onboarding/complete`, { method: 'POST', headers });
      if (refreshUser) await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch { setCompleting(false); }
  };

  const embedCode = `<script\n  src="${window.location.origin}/widget.js"\n  data-token="${token || 'loading...'}"\n  data-color="${color}"\n  data-name="${agentName}"\n  data-api="${CHAT_API_URL}"\n></script>`;

  const stepLabels = ['Goal', 'Train', 'Configure', 'Preview', 'Launch'];
  const widgetConfig = { color, agent_name: agentName, welcome: 'Hi! How can I help you today?' };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-black border border-brand-500/30 flex items-center justify-center overflow-hidden">
            <img src="/kira-logo.png" alt="Kira" className="w-7 h-7 object-contain drop-shadow-[0_0_8px_rgba(0,255,213,0.5)]" />
          </div>
          <span className="text-base font-bold tracking-tight">Kira</span>
          <span className="text-[10px] text-white/30 font-medium uppercase tracking-widest ml-1">Setup</span>
        </div>
        <Stepper current={step} steps={stepLabels} />
        <div className="w-24" />
      </header>

      {/* Content */}
      <div className="flex-1 flex">
        {/* Left — Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className={`w-full animate-fade-in ${step === 3 ? 'max-w-5xl' : 'max-w-lg'}`} key={step}>

            {/* ── STEP 0: Goal ── */}
            {step === 0 && (
              <div className="space-y-8">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight mb-2">What should <span className="text-brand-500">Kira</span> do first?</h1>
                  <p className="text-sm text-white/50">Choose your primary goal. You can always change this later.</p>
                </div>
                <div className="space-y-3">
                  {GOALS.map(g => (
                    <button key={g.id} onClick={() => setGoal(g.id)}
                      className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-200 flex items-center gap-4 group ${
                        goal === g.id ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30' : 'border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04]'
                      }`}>
                      <span className="text-2xl">{g.icon}</span>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{g.label}</p>
                        <p className="text-xs text-white/40 mt-0.5">{g.desc}</p>
                      </div>
                      {goal === g.id && <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>}
                    </button>
                  ))}
                </div>
                <button onClick={handleGoalNext} disabled={!goal}
                  className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-200 ${goal ? 'bg-brand-500 text-black hover:bg-brand-400 shadow-lg shadow-brand-500/25' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}>
                  Next →
                </button>
              </div>
            )}

            {/* ── STEP 1: Train ── */}
            {step === 1 && (
              <div className="space-y-8">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight mb-2">Train your <span className="text-brand-500">AI Agent</span></h1>
                  <p className="text-sm text-white/50">Paste your website URL and we'll extract your content to train Kira.</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">Your website URL</label>
                    <input type="url" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="e.g. https://yourcompany.com"
                      className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all" />
                  </div>
                  {crawlError && <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{crawlError}</div>}
                  {crawlResult && (
                    <div className="px-4 py-3 bg-brand-500/10 border border-brand-500/20 rounded-xl text-xs text-brand-400 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      Website trained! {crawlResult.chunks_created} sections extracted.
                    </div>
                  )}
                  {/* Show Next button after successful train, otherwise show Train button */}
                  {crawlResult ? (
                    <div className="flex gap-3">
                      <button onClick={() => setStep(0)} className="px-6 py-3.5 rounded-xl text-sm font-medium text-white/50 border border-white/10 hover:bg-white/5 transition-all">Back</button>
                      <button onClick={() => setStep(2)} className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-brand-500 text-black hover:bg-brand-400 shadow-lg shadow-brand-500/25 transition-all">Next →</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={handleTrainWebsite} disabled={!websiteUrl || crawling}
                        className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-200 ${crawling ? 'bg-brand-500/20 text-brand-400' : websiteUrl ? 'bg-brand-500 text-black hover:bg-brand-400 shadow-lg shadow-brand-500/25' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}>
                        {crawling ? <span className="flex items-center justify-center gap-2"><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Crawling & training...</span> : 'Train from Website'}
                      </button>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-[10px] text-white/30 uppercase tracking-wider">or</span>
                        <div className="flex-1 h-px bg-white/10" />
                      </div>
                      <button onClick={() => setStep(2)} className="w-full py-3 rounded-xl text-sm font-medium text-white/50 border border-white/10 hover:bg-white/5 hover:text-white/70 transition-all">
                        Skip — I'll add content later
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 2: Configure Agent ── */}
            {step === 2 && (
              <div className="space-y-7">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight mb-2">Configure your <span className="text-brand-500">Agent</span></h1>
                  <p className="text-sm text-white/50">Set how Kira sounds and behaves when talking to your customers.</p>
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">Agent Name</label>
                    <input type="text" value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="e.g. Zara, Atlas, Support Bot"
                      className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">Tone of Voice</label>
                    <div className="grid grid-cols-5 gap-2">
                      {TONES.map(t => (
                        <button key={t.id} onClick={() => setTone(t.id)}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all duration-200 ${
                            tone === t.id ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30' : 'border-white/10 hover:border-white/20 bg-white/[0.02]'
                          }`}>
                          <span className="text-lg">{t.icon}</span>
                          <span className="text-[10px] font-semibold">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">Custom Instructions</label>
                    <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={4} placeholder="Tell Kira how to behave..."
                      className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all resize-none" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="px-6 py-3.5 rounded-xl text-sm font-medium text-white/50 border border-white/10 hover:bg-white/5 transition-all">Back</button>
                  <button onClick={handleConfigNext} className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-brand-500 text-black hover:bg-brand-400 shadow-lg shadow-brand-500/25 transition-all">Next →</button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Live Preview ── */}
            {step === 3 && (
              <div className="space-y-5 max-w-5xl w-full mx-auto">
                <div className="flex items-end justify-between">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Live Preview on your <span className="text-brand-500">Website</span></h1>
                    <p className="text-sm text-white/50">See exactly how Kira will appear — try chatting with the widget!</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep(2)} className="px-5 py-2.5 rounded-xl text-sm font-medium text-white/50 border border-white/10 hover:bg-white/5 transition-all">Back</button>
                    <button onClick={() => setStep(4)} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-brand-500 text-black hover:bg-brand-400 shadow-lg shadow-brand-500/25 transition-all">Next →</button>
                  </div>
                </div>

                {/* Browser Frame */}
                <div className="rounded-2xl border border-white/10 overflow-hidden bg-gray-900 shadow-2xl shadow-black/50">
                  {/* Browser Chrome */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-800/80 border-b border-white/5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400/80" />
                      <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                      <div className="w-3 h-3 rounded-full bg-green-400/80" />
                    </div>
                    <div className="flex-1 flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-1.5 max-w-lg mx-auto">
                      <svg className="w-3 h-3 text-green-400/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                      <span className="text-[11px] text-white/40 font-mono truncate">{websiteUrl || 'yourcompany.com'}</span>
                      {!iframeFailed && websiteUrl && <span className="text-[9px] text-green-400/60 font-medium ml-auto">LIVE</span>}
                    </div>
                    <div className="w-16" />
                  </div>

                  {/* Website Content — Live iframe or Screenshot fallback */}
                  <div className="relative bg-white" style={{ height: 560 }}>
                    {/* Try iframe first */}
                    {websiteUrl && !iframeFailed && (
                      <>
                        {!iframeLoaded && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10">
                            <svg className="w-8 h-8 animate-spin text-brand-500 mb-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                            <p className="text-sm text-white/40">Loading your website...</p>
                          </div>
                        )}
                        <iframe
                          src={websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`}
                          className="w-full h-full border-0"
                          style={{ opacity: iframeLoaded ? 1 : 0, transition: 'opacity 0.5s ease' }}
                          onLoad={() => setIframeLoaded(true)}
                          onError={() => setIframeFailed(true)}
                          sandbox="allow-scripts allow-same-origin allow-popups"
                          title="Website Preview"
                        />
                      </>
                    )}

                    {/* Fallback: screenshot or skeleton */}
                    {(iframeFailed || !websiteUrl) && (
                      screenshotUrl ? (
                        <img src={`${API_URL}${screenshotUrl}`} alt="Your website" className="w-full h-full object-cover object-top" />
                      ) : (
                        <div className="p-10 space-y-5 bg-gradient-to-b from-gray-100 to-gray-50 h-full">
                          <div className="h-6 bg-gray-200 rounded w-2/3" />
                          <div className="h-4 bg-gray-200 rounded w-full" />
                          <div className="h-4 bg-gray-200 rounded w-5/6" />
                          <div className="h-4 bg-gray-200 rounded w-4/5" />
                          <div className="grid grid-cols-3 gap-4 mt-6">
                            <div className="h-28 bg-gray-200 rounded-xl" />
                            <div className="h-28 bg-gray-200 rounded-xl" />
                            <div className="h-28 bg-gray-200 rounded-xl" />
                          </div>
                        </div>
                      )
                    )}

                    {/* ── Interactive Chat Widget Overlay ── */}
                    <div className="absolute bottom-5 right-5 z-20" style={{ pointerEvents: 'auto' }}>
                      {previewChatOpen ? (
                        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200" style={{ width: 320, boxShadow: '0 25px 60px -12px rgba(0,0,0,0.4)' }}>
                          {/* Header */}
                          <div className="px-4 py-3 text-white flex items-center gap-3 cursor-pointer" style={{ backgroundColor: color }} onClick={() => setPreviewChatOpen(false)}>
                            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-[9px] font-extrabold tracking-wider">KIRA</div>
                            <div className="flex-1">
                              <p className="font-semibold text-[13px] leading-tight">{agentName}</p>
                              <p className="text-[10px] opacity-80 flex items-center gap-1 mt-0.5"><span className="w-1.5 h-1.5 rounded-full bg-white inline-block animate-pulse" />Online</p>
                            </div>
                            <svg className="w-4 h-4 opacity-70 hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                          </div>

                          {/* Messages */}
                          <div className="p-3 bg-gray-50 space-y-3 overflow-y-auto" style={{ height: 220 }} ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
                            {previewMessages.map((m, i) => (
                              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'items-end'}`}>
                                {m.role === 'bot' && <div className="w-6 h-6 rounded-full flex-shrink-0 text-[8px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: color }}>K</div>}
                                <div className={`text-[12px] px-3 py-2 rounded-2xl max-w-[80%] leading-relaxed ${
                                  m.role === 'user'
                                    ? 'bg-gray-200 text-gray-800 rounded-br-sm'
                                    : 'text-white rounded-bl-sm'
                                }`} style={m.role === 'bot' ? { backgroundColor: color } : {}}>
                                  {m.text}
                                </div>
                              </div>
                            ))}
                            {previewTyping && (
                              <div className="flex gap-2 items-end">
                                <div className="w-6 h-6 rounded-full flex-shrink-0 text-[8px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: color }}>K</div>
                                <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-white" style={{ backgroundColor: color }}>
                                  <div className="flex gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '0ms' }}/><span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '150ms' }}/><span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '300ms' }}/></div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Input */}
                          <form onSubmit={e => { e.preventDefault(); handlePreviewSend(); }} className="px-3 py-2.5 border-t border-gray-100 flex items-center gap-2 bg-white">
                            <input
                              value={previewInput}
                              onChange={e => setPreviewInput(e.target.value)}
                              placeholder="Try asking a question..."
                              className="flex-1 px-3 py-2 bg-gray-50 rounded-xl text-[12px] text-gray-700 border border-gray-200 outline-none focus:border-[#00ffd5] focus:ring-1 focus:ring-[#00ffd5]/20 transition-all"
                            />
                            <button type="submit" className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95" style={{ background: color }}>
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                            </button>
                          </form>
                          <div className="text-center py-1 text-[8px] text-gray-400 border-t border-gray-50 bg-white">Powered by <span className="font-bold" style={{ color }}>KIRA</span></div>
                        </div>
                      ) : (
                        <button onClick={() => setPreviewChatOpen(true)} className="w-14 h-14 rounded-2xl shadow-xl flex items-center justify-center text-white transition-transform hover:scale-110 active:scale-95" style={{ background: `linear-gradient(135deg, ${color}, #0ea5e9)`, boxShadow: `0 8px 25px ${color}40` }}>
                          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {iframeFailed && (
                  <div className="px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-400 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"/></svg>
                    Your website blocks embedding — showing a screenshot instead. Don't worry, the widget will work perfectly on your actual site!
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 4: Embed Code ── */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight mb-2">Get your <span className="text-brand-500">Embed Code</span></h1>
                  <p className="text-sm text-white/50">Copy this snippet and paste it before {'</body>'} on your website.</p>
                </div>
                <div className="relative">
                  <pre className="bg-white/5 border border-white/10 rounded-xl p-5 text-xs font-mono text-brand-300 overflow-x-auto whitespace-pre-wrap">{embedCode}</pre>
                  <button onClick={() => { navigator.clipboard.writeText(embedCode); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className={`absolute top-3 right-3 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${copied ? 'bg-brand-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                    {copied ? '✓ Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="px-4 py-3 bg-brand-500/5 border border-brand-500/10 rounded-xl text-xs text-white/50">
                  <p><span className="text-brand-400 font-semibold">🎁 Free Trial:</span> Your 7-day trial with 100 AI messages starts when you launch.</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(3)} className="px-6 py-3.5 rounded-xl text-sm font-medium text-white/50 border border-white/10 hover:bg-white/5 transition-all">Back</button>
                  <button onClick={handleComplete} disabled={completing}
                    className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-brand-500 text-black hover:bg-brand-400 shadow-lg shadow-brand-500/25 transition-all disabled:opacity-50">
                    {completing ? 'Launching...' : '🚀 Launch Kira & Go to Dashboard'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right — Widget Preview (steps 0-2) */}
        {step <= 2 && (
          <div className="hidden lg:flex w-[380px] bg-gradient-to-b from-gray-900 to-gray-950 border-l border-white/5 items-center justify-center">
            <WidgetPreview config={widgetConfig} />
          </div>
        )}
      </div>
    </div>
  );
}
