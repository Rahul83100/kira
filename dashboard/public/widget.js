/**
 * KIRA — Embeddable Chat Widget v3.0
 * Refactored to Firebase Compat (UMD) to support static servers (npx serve).
 * Author: Karline | Branch: feature/karline-widget
 * Date: 31 March 2026
 *
 * Features:
 *   - Voice-to-Text (hold-to-speak + click-to-toggle)
 *   - Reactive Dynamic Theming Engine
 *   - Spring-Based CSS Animations
 *   - Drag-and-Drop File Upload with Preview
 *   - Full Keyboard Accessibility (WCAG 2.1 AA)
 *   - Offline Message Queueing
 *   - Markdown Rendering
 *   - Connection Status Indicator
 *
 * Zero dependencies. Shadow DOM isolated. Vanilla JS only.
 */
(function () {
    'use strict';

    // ─── Firebase Initialization (UMD) — OPTIONAL (analytics only) ───
    // The widget works fully without Firebase. To enable optional widget
    // analytics, set `window.KIRA_FIREBASE_CONFIG = { apiKey, projectId, ... }`
    // before this script loads. Otherwise it is silently skipped.
    const firebaseConfig = (typeof window !== 'undefined' && window.KIRA_FIREBASE_CONFIG) || null;

    let app = null;
    let analytics = null;

    try {
        if (firebaseConfig && typeof firebase !== 'undefined') {
            if (!firebase.apps.length) {
                app = firebase.initializeApp(firebaseConfig);
            } else {
                app = firebase.app();
            }
            analytics = firebase.analytics();
            console.log("Firebase initialized in widget (UMD).");
        } else {
            console.warn("Firebase global not found in widget. Ensure compat scripts are loaded.");
        }
    } catch (err) {
        console.error("Firebase initialization failed in widget:", err);
    }

    // ─── Feature Detection ───
    const features = {
        speechRecognition: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window,
        mediaRecorder: 'MediaRecorder' in window,
        fileAPI: 'File' in window && 'FileReader' in window,
        clipboard: !!(navigator.clipboard && navigator.clipboard.read),
        intersectionObserver: 'IntersectionObserver' in window,
        prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        backdropFilter: CSS.supports && CSS.supports('backdrop-filter', 'blur(10px)')
    };

    // ─── Configuration ───
    function getWidgetScript() {
        if (document.currentScript) return document.currentScript;
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            if (scripts[i].src.includes('widget.js')) return scripts[i];
        }
        return null;
    }

    const script = getWidgetScript();
    const API_BASE_URL = script
        ? (script.getAttribute('data-api') || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin))
        : (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin);
    if (!script) return;

    const CONFIG = {
        token: script.getAttribute('data-token') || '',
        color: script.getAttribute('data-color') || '#06b6d4',
        agentName: script.getAttribute('data-name') || 'Zara',
        logo: script.getAttribute('data-logo') ? `${script.getAttribute('data-logo')}?t=${Date.now()}` : null,
        welcome: script.getAttribute('data-welcome') || `Hi, I'm ${script.getAttribute('data-name') || 'KIRA'}. How can I help you today?`,
        // Business contact details — fetched from live config, used in escalation messages
        businessPhone: null,
        businessEmail: null,
    };

    function readAttribution() {
        const params = new URLSearchParams(window.location.search);
        const source = params.get('utm_source') || params.get('source') || '';
        const medium = params.get('utm_medium') || params.get('medium') || '';
        const campaignId = params.get('utm_campaign') || params.get('campaign_id') || params.get('campaignId') || '';
        const outboundLeadId = params.get('outbound_lead_id') || params.get('outboundLeadId') || params.get('lead_id') || '';

        return {
            source,
            medium,
            campaignId,
            outboundLeadId,
            isOutbound: source === 'kira_outbound',
            welcome: source === 'kira_outbound'
                ? `Hi! I saw you came from our outreach message. I'm ${CONFIG.agentName}. What would you like to know about our services?`
                : CONFIG.welcome
        };
    }

    const ATTRIBUTION = readAttribution();

    function getAttributionPayload() {
        if (!ATTRIBUTION.source && !ATTRIBUTION.medium && !ATTRIBUTION.campaignId && !ATTRIBUTION.outboundLeadId) {
            return {};
        }

        return {
            source: ATTRIBUTION.source || undefined,
            medium: ATTRIBUTION.medium || undefined,
            campaign_id: ATTRIBUTION.campaignId || undefined,
            outbound_lead_id: ATTRIBUTION.outboundLeadId || undefined,
            utm_source: ATTRIBUTION.source || undefined,
            utm_medium: ATTRIBUTION.medium || undefined,
            utm_campaign: ATTRIBUTION.campaignId || undefined
        };
    }

    // ─── Centralized State ───
    const widgetState = {
        isOpen: false,
        isRecording: false,
        connectionStatus: 'online',
        theme: null,
        messageHistory: [],
        pendingUploads: [],
        autoSendVoice: false,
        isSending: false,
        welcomeShown: false,
        isVoiceEnabled: false,
        leadFormShown: false,
        userMessageCount: 0
    };

    function setState(key, value) {
        const old = widgetState[key];
        widgetState[key] = value;
        onStateChange(key, value, old);
    }

    function onStateChange(key, value, old) {
        switch (key) {
            case 'isOpen':
                windowEl.classList.toggle('open', value);
                bubble.classList.toggle('open', value);
                if (value) {
                    input.focus();
                    windowEl.setAttribute('aria-hidden', 'false');
                    trapFocus();
                } else {
                    windowEl.setAttribute('aria-hidden', 'true');
                    bubble.focus();
                }
                break;
            case 'isRecording':
                micBtn.classList.toggle('recording', value);
                micBtn.setAttribute('aria-pressed', String(value));
                input.placeholder = value ? '🎙️ Listening…' : 'Type a message…';
                if (value) {
                    interimEl.classList.add('visible');
                } else {
                    interimEl.classList.remove('visible');
                }
                break;
            case 'connectionStatus':
                updateStatusUI(value);
                break;
        }
    }

    // ─── Theming Engine ───
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
            : '6, 182, 212';
    }

    // ─── Color Derivation Engine ───
    function hexToHSL(hex) {
        const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!res) return { h: 190, s: 95, l: 43 };
        let r = parseInt(res[1], 16) / 255, g = parseInt(res[2], 16) / 255, b = parseInt(res[3], 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; }
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function deriveColors(hex) {
        const hsl = hexToHSL(hex);
        const rgb = hexToRgb(hex);
        return {
            primary: hex, primaryRgb: rgb,
            hover: hslToHex(hsl.h, Math.min(hsl.s + 5, 100), Math.min(hsl.l + 10, 95)),
            active: hslToHex(hsl.h, hsl.s, Math.max(hsl.l - 10, 5)),
            glass: `rgba(${rgb}, 0.05)`,
            glassBorder: `rgba(${rgb}, 0.12)`,
            shadow: `rgba(${rgb}, 0.25)`,
            tint: `rgba(${rgb}, 0.08)`,
            contrast: hsl.l > 55 ? '#020617' : '#f8fafc',
        };
    }

    const themeSubscribers = [];

    function applyTheme(theme) {
        if (!theme) return;
        const root = host;
        if (theme.primaryColor) {
            root.style.setProperty('--echo-primary', theme.primaryColor);
            root.style.setProperty('--echo-primary-rgb', hexToRgb(theme.primaryColor));
            const derived = deriveColors(theme.primaryColor);
            root.style.setProperty('--brand-primary', theme.primaryColor);
            root.style.setProperty('--brand-primary-rgb', derived.primaryRgb);
            root.style.setProperty('--brand-hover', derived.hover);
            root.style.setProperty('--brand-active', derived.active);
            root.style.setProperty('--brand-contrast', derived.contrast);
        }
        if (theme.accentColor) {
            root.style.setProperty('--echo-accent', theme.accentColor);
            root.style.setProperty('--brand-accent', theme.accentColor);
            root.style.setProperty('--brand-accent-rgb', hexToRgb(theme.accentColor));
        }
        if (theme.fontFamily) root.style.setProperty('--echo-font', theme.fontFamily);
        if (theme.borderRadius) root.style.setProperty('--echo-radius', theme.borderRadius);

        // Always use simple light theme
        root.style.setProperty('--echo-bg', '#ffffff');
        root.style.setProperty('--echo-text', '#1f2937');
        root.style.setProperty('--echo-msg-bg', '#ffffff');
        root.style.setProperty('--echo-input-bg', '#f9fafb');
        root.style.setProperty('--echo-input-border', '#e5e7eb');
        root.style.setProperty('--echo-bar-bg', '#ffffff');
        root.style.setProperty('--echo-msg-assistant-bg', theme.primaryColor || '#00ffd5');
        root.style.setProperty('--echo-msg-assistant-border', 'transparent');

        if (theme.glassEffect && features.backdropFilter) {
            windowEl.classList.add('glass-effect');
        } else {
            windowEl.classList.remove('glass-effect');
        }

        if (theme.animations === 'none' || features.prefersReducedMotion) {
            host.classList.add('reduced-motion');
        } else {
            host.classList.remove('reduced-motion');
        }

        if (theme.customCSS) {
            let customStyle = shadow.getElementById('echo-custom-css');
            if (!customStyle) {
                customStyle = document.createElement('style');
                customStyle.id = 'echo-custom-css';
                shadow.appendChild(customStyle);
            }
            customStyle.textContent = theme.customCSS;
        }
        if (theme.autoSendVoice !== undefined) widgetState.autoSendVoice = theme.autoSendVoice;
    }

    // Reactive theme watcher with hash comparison
    let lastThemeHash = '';
    function hashCode(str) {
        return str.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
    }
    function startThemeWatcher() {
        setInterval(() => {
            const theme = window.KiraTheme || window.EchoTheme || window.SupportGenieTheme;
            if (!theme) return;
            const currentHash = String(hashCode(JSON.stringify(theme)));
            if (currentHash !== lastThemeHash) {
                applyTheme(theme);
                lastThemeHash = currentHash;
            }
        }, 500);
    }

    // ─── Session Management ───
    function getOrCreateSessionId() {
        const KEY = 'kira_session_id';
        let id = localStorage.getItem(KEY);
        if (!id) {
            // Bulletproof UUID generation (works in non-HTTPS/local environments)
            id = (typeof crypto !== 'undefined' && crypto.randomUUID) 
                ? crypto.randomUUID() 
                : 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                }) + '-' + Date.now().toString(16);
            localStorage.setItem(KEY, id);
        }
        return id;
    }

    // ─── API Layer ───
    let lastUserMessage = '';

    async function realChatAPI(message) {
        const sessionId = getOrCreateSessionId();
        const res = await fetch(`${API_BASE_URL}/api/chat/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${CONFIG.token}`,
            },
            body: JSON.stringify({
                token: CONFIG.token,
                message: message,
                sessionId: sessionId,
                ...getAttributionPayload(),
            }),
        });
        if (res.status === 429) {
            throw new Error('429');
        }
        if (res.status === 402) {
            throw new Error('Credit exhausted. Please upgrade your plan.');
        }
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        return await res.json();
    }

    async function callChatAPI(message) {
        return realChatAPI(message);
    }

    // ─── Markdown Renderer ───
    function renderMarkdown(text) {
        if (!text) return '';
        let html = sanitizeHTML(text);
        // Code blocks
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre class="sg-code-block"><code>$2</code></pre>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code class="sg-inline-code">$1</code>');
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="sg-link">$1</a>');
        // Unordered lists
        html = html.replace(/^[\-\*] (.+)/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, '<ul class="sg-list">$1</ul>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function sanitizeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ─── Component Creation ───
    const host = document.createElement('div');
    host.id = 'echo-widget';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // Google Fonts injection (into light DOM for font availability)
    if (!document.querySelector('link[href*="Outfit"]')) {
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap';
        document.head.appendChild(fontLink);
    }

    const styles = document.createElement('style');
    styles.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }
    :host {
        all: initial;
        font-family: var(--echo-font, 'Outfit', system-ui, sans-serif);
        --echo-primary: ${CONFIG.color};
        --echo-primary-rgb: ${hexToRgb(CONFIG.color)};
        --echo-accent: #0ea5e9;
        --echo-radius: 20px;
        --echo-bg: #ffffff;
        --echo-text: #1f2937;
        --echo-msg-bg: #ffffff;
        --echo-input-bg: #f9fafb;
        --echo-input-border: #e5e7eb;
        --echo-bar-bg: #ffffff;
        --echo-msg-assistant-bg: var(--echo-primary);
        --echo-msg-assistant-border: transparent;
        --echo-glass: none;
        --echo-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
        --echo-spring-bouncy: cubic-bezier(0.34, 1.56, 0.64, 1);
        --echo-smooth: cubic-bezier(0.4, 0, 0.2, 1);
        /* ── Brand Color System (auto-derived via JS) ── */
        --brand-primary: ${CONFIG.color};
        --brand-primary-rgb: ${hexToRgb(CONFIG.color)};
        --brand-accent: #0ea5e9;
        --brand-accent-rgb: 14, 165, 233;
        --brand-hover: ${CONFIG.color};
        --brand-active: ${CONFIG.color};
        --brand-contrast: #f8fafc;
        /* ── Spring Physics Curves ── */
        --spring-gentle: cubic-bezier(0.25, 0.46, 0.45, 0.94);
        --spring-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
        --spring-elastic: cubic-bezier(0.68, -0.55, 0.265, 1.55);
        --spring-snap: cubic-bezier(0.23, 1, 0.32, 1);
    }

    /* ── Reduced Motion ── */
    :host(.reduced-motion) *, :host(.reduced-motion) *::before, :host(.reduced-motion) *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }

    /* ── Premium Spring Keyframes ── */
    @keyframes sgWindowSpringIn {
        0% { opacity: 0; transform: translateY(24px) scale(0.82); }
        40% { opacity: 1; transform: translateY(-8px) scale(1.03); }
        65% { transform: translateY(3px) scale(0.99); }
        85% { transform: translateY(-1px) scale(1.005); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes sgWindowSpringOut {
        0% { opacity: 1; transform: translateY(0) scale(1); }
        25% { transform: translateY(-6px) scale(1.02); }
        100% { opacity: 0; transform: translateY(20px) scale(0.85); }
    }
    @keyframes sgMsgSlideLeft {
        0% { opacity: 0; transform: translateX(-18px) translateY(6px) scale(0.92); }
        50% { opacity: 1; transform: translateX(3px) translateY(-1px) scale(1.01); }
        100% { opacity: 1; transform: translateX(0) translateY(0) scale(1); }
    }
    @keyframes sgMsgSlideRight {
        0% { opacity: 0; transform: translateX(18px) translateY(6px) scale(0.92); }
        50% { opacity: 1; transform: translateX(-3px) translateY(-1px) scale(1.01); }
        100% { opacity: 1; transform: translateX(0) translateY(0) scale(1); }
    }
    @keyframes sgSendPress {
        0% { transform: scale(1); }
        25% { transform: scale(0.82) rotate(-3deg); }
        55% { transform: scale(1.12) rotate(2deg); }
        75% { transform: scale(0.96); }
        100% { transform: scale(1); }
    }
    @keyframes sgBadgePop {
        0% { transform: scale(0); opacity: 0; }
        50% { transform: scale(1.35); opacity: 1; }
        70% { transform: scale(0.85); }
        85% { transform: scale(1.08); }
        100% { transform: scale(1); opacity: 1; }
    }
    @keyframes sgBubbleIdle {
        0%, 100% { box-shadow: 0 8px 32px rgba(var(--echo-primary-rgb), 0.4), 0 0 0 0 rgba(var(--echo-primary-rgb), 0.15); }
        50% { box-shadow: 0 8px 32px rgba(var(--echo-primary-rgb), 0.4), 0 0 0 10px rgba(var(--echo-primary-rgb), 0); }
    }
    @keyframes sgFormSlideUp {
        0% { opacity: 0; transform: translateY(16px) scale(0.95); }
        50% { transform: translateY(-3px) scale(1.01); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes sgTypingBreath {
        0%, 100% { opacity: 0.85; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.02); }
    }

    /* ── Chat Window ── */
    .sg-window {
        position: fixed; bottom: 100px; right: 24px; width: 400px; height: 560px;
        background: var(--echo-bg); border-radius: var(--echo-radius);
        box-shadow: 0 10px 40px rgba(0,0,0,0.12);
        display: flex; flex-direction: column; overflow: hidden; z-index: 2147483646;
        opacity: 0; transform: translateY(20px) scale(0.85);
        transform-origin: bottom right;
        pointer-events: none;
        border: 1px solid rgba(0,0,0,0.05);
    }
    .sg-window.open {
        opacity: 1; transform: translateY(0) scale(1);
        pointer-events: auto;
        animation: sgWindowSpringIn 0.65s var(--spring-snap) forwards;
    }
    .sg-window.closing {
        animation: sgWindowSpringOut 0.38s var(--spring-gentle) forwards;
        pointer-events: none;
    }

    /* Glassmorphism disabled */
    .sg-window.glass-effect {}

    /* ── Header ── */
    .sg-header {
        background: var(--echo-primary);
        color: #ffffff; padding: 20px; display: flex; align-items: center;
        justify-content: space-between; position: relative;
        z-index: 10;
    }
    .sg-header-left { display: flex; align-items: center; gap: 14px; }
    .sg-header-right { display: flex; align-items: center; gap: 8px; }

    .sg-avatar {
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(255, 255, 255, 0.2); display: flex;
        align-items: center; justify-content: center;
        font-size: 18px; font-weight: 800; color: #ffffff;
        overflow: hidden;
    }
    .sg-avatar.has-logo {
        border-radius: 10px;
        background: #ffffff;
        padding: 3px;
    }
    .sg-avatar:hover { transform: scale(1.05) rotate(5deg); }
    .sg-avatar img {
        width: 100%; height: 100%;
        object-fit: contain;
        border-radius: inherit;
    }
    
    .sg-avatar-letter {
        font-family: inherit;
        font-size: 18px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
    }
    
    .sg-header-info { display: flex; flex-direction: column; gap: 2px; }
    .sg-header-name { font-size: 15px; font-weight: 600; font-family: inherit; color: #ffffff; }
    .sg-header-status {
        font-size: 12px; color: rgba(255, 255, 255, 0.85); display: flex; align-items: center; gap: 6px; font-weight: 500;
    }
    .sg-header-status::before {
        content: ''; width: 8px; height: 8px; border-radius: 50%;
        background: #ffffff;
    }

    .sg-header-btn {
        background: transparent; border: none;
        cursor: pointer; color: rgba(255, 255, 255, 0.85);
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s ease;
        width: 32px; height: 32px; border-radius: 8px;
    }
    .sg-header-btn:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
    .sg-header-btn svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 2.2; }
    .sg-close-btn:hover { background: rgba(0,0,0,0.1); }

    /* ── Messages ── */
    .sg-messages {
        flex: 1; overflow-y: auto; padding: 20px;
        background: var(--echo-msg-bg);
        display: flex; flex-direction: column; gap: 10px;
        scroll-behavior: smooth;
    }
    .sg-messages::-webkit-scrollbar { width: 4px; }
    .sg-messages::-webkit-scrollbar-track { background: transparent; }
    .sg-messages::-webkit-scrollbar-thumb {
        background: rgba(var(--echo-primary-rgb), 0.3); border-radius: 10px;
    }

    .sg-msg-container {
        display: flex; gap: 10px; align-items: flex-end; width: 100%;
        margin-bottom: 4px;
    }
    .sg-msg-container.assistant { align-self: flex-start; justify-content: flex-start; }
    .sg-msg-container.user { align-self: flex-end; justify-content: flex-end; }

    .sg-msg-avatar {
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--echo-primary); overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
    }
    .sg-msg-avatar.has-logo {
        border-radius: 8px;
        background: #ffffff;
        padding: 2px;
        border: 1px solid rgba(0,0,0,0.08);
    }
    .sg-msg-avatar img { width: 100%; height: 100%; object-fit: contain; border-radius: inherit; }
    .sg-msg-avatar-letter { font-weight: 800; font-size: 11px; color: #ffffff; display: flex; align-items: center; justify-content: center; }

    /* User Avatar (initials-based fallback) */
    .sg-user-avatar {
        background: linear-gradient(135deg, var(--echo-primary), var(--echo-accent)) !important;
        border: 1.5px solid rgba(255,255,255,0.2);
        box-shadow: 0 4px 12px rgba(var(--echo-primary-rgb), 0.25);
    }
    .sg-user-avatar img {
        width: 100% !important; height: 100% !important;
        object-fit: cover !important; border-radius: 50% !important;
        mix-blend-mode: normal !important; filter: none !important;
    }
    .sg-user-initials {
        font-weight: 800; font-size: 12px; font-family: 'Orbitron', sans-serif;
        color: #020617; letter-spacing: 0.5px;
        display: flex; align-items: center; justify-content: center;
        width: 100%; height: 100%;
    }

    /* Handoff Form */
    .sg-handoff-form {
        border-color: rgba(var(--echo-primary-rgb), 0.3);
        background: rgba(var(--echo-primary-rgb), 0.03);
        animation: sgFormSlideUp 0.6s var(--echo-spring-bouncy);
    }

    .sg-msg {
        max-width: 80%; padding: 12px 16px; border-radius: 18px;
        font-size: 14px; line-height: 1.6; word-wrap: break-word;
        animation: sgMsgIn 0.4s var(--echo-spring-bouncy);
        position: relative;
    }
    .sg-msg.msg-enter-left {
        animation: sgMsgSlideLeft 0.5s var(--spring-overshoot) forwards;
    }
    .sg-msg.msg-enter-right {
        animation: sgMsgSlideRight 0.5s var(--spring-overshoot) forwards;
    }
    @keyframes sgMsgIn {
        from { opacity: 0; transform: translateY(12px) scale(0.92); }
        to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .sg-msg.assistant {
        background: var(--echo-primary); color: #ffffff;
        border: none;
        border-bottom-left-radius: 4px;
    }
    .sg-msg.user {
        background: #f3f4f6;
        color: #1f2937; font-weight: 500;
        border-bottom-right-radius: 4px;
    }
    .sg-msg.system {
        background: rgba(239, 68, 68, 0.08); color: #fca5a5;
        align-self: center; font-size: 12px; border-radius: 12px;
        font-weight: 700; border: 1px solid rgba(239, 68, 68, 0.2);
        padding: 8px 16px; text-transform: uppercase; letter-spacing: 0.5px;
    }

    /* ── Escalation Banner ── */
    /* WHY A SEPARATE STYLE: The escalation banner is distinct from system
       messages. It's amber/yellow (not red) to convey "action happening"
       rather than "error". The pulsing dot indicates an active process. */
    .sg-escalation-banner {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 18px; margin: 8px 0; border-radius: 14px;
        background: rgba(251, 191, 36, 0.08);
        border: 1px solid rgba(251, 191, 36, 0.25);
        color: #fbbf24; font-size: 13px; font-weight: 700;
        animation: sgFormSlideUp 0.6s var(--echo-spring-bouncy);
        align-self: stretch;
    }
    .sg-escalation-banner svg {
        flex-shrink: 0; stroke: #fbbf24; opacity: 0.9;
        animation: sgPulseOnline 2s infinite;
    }
    .sg-escalation-banner span {
        letter-spacing: 0.3px;
    }

    /* Markdown styles */
    .sg-msg strong { font-weight: 700; }
    .sg-msg em { font-style: italic; }
    .sg-code-block { background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin: 8px 0; font-family: monospace; font-size: 12px; overflow-x: auto; border: 1px solid #e5e7eb; color: #1f2937; }
    .sg-inline-code {
        background: rgba(var(--echo-primary-rgb), 0.15); padding: 2px 6px;
        border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 12px;
        color: var(--echo-primary);
    }
    .sg-link {
        color: var(--echo-primary); text-decoration: underline;
        text-underline-offset: 2px;
    }
    .sg-link:hover { opacity: 0.8; }
    .sg-list { padding-left: 18px; margin: 6px 0; }
    .sg-list li { margin: 2px 0; }

    /* ── Lead Form ── */
    .sg-lead-form {
        background: rgba(var(--echo-primary-rgb), 0.05);
        border: 1px solid rgba(var(--echo-primary-rgb), 0.2);
        border-radius: 16px; padding: 20px; margin: 12px 0;
        display: flex; flex-direction: column; gap: 12px;
        animation: sgFormIn 0.5s var(--echo-spring-bouncy);
    }
    @keyframes sgFormIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } }
    .sg-form-title { font-size: 15px; font-weight: 800; color: #1f2937; margin-bottom: 4px; }
    .sg-form-group { display: flex; flex-direction: column; gap: 6px; }
    .sg-form-label { font-size: 11px; font-weight: 700; color: var(--echo-primary); text-transform: uppercase; letter-spacing: 0.5px; }
    .sg-form-input {
        background: #f9fafb; border: 1px solid #e5e7eb;
        border-radius: 8px; padding: 10px 12px; color: #1f2937; font-size: 13px; outline: none; transition: 0.3s; }
    .sg-form-input:focus { border-color: var(--echo-primary); background: #ffffff; }
    .sg-form-select {
        background: #ffffff; border: 1px solid #e5e7eb;
        border-radius: 8px; padding: 10px 12px; color: #1f2937; font-size: 13px; outline: none; cursor: pointer; appearance: none; }
    .sg-form-select:focus { border-color: var(--echo-primary); }
    .sg-submit-btn {
        background: var(--echo-primary); color: #020617; border: none;
        border-radius: 10px; padding: 12px; font-weight: 800; cursor: pointer;
        transition: 0.3s; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px;
    }
    .sg-submit-btn:hover { transform: scale(1.02); filter: brightness(1.1); }
    .sg-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Status Bar ── */
    .sg-status-bar {
        padding: 6px 20px; font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.5px;
        display: none; align-items: center; gap: 6px;
        background: var(--echo-bar-bg); border-bottom: 1px solid rgba(0,0,0,0.05);
        transition: all 0.3s ease;
    }
    .sg-status-bar.visible { display: flex; }
    .sg-status-dot { width: 6px; height: 6px; border-radius: 50%; }
    .status-online { color: #34d399; }
    .status-online .sg-status-dot { background: #34d399; }
    .status-offline { color: #f87171; }
    .status-offline .sg-status-dot { background: #f87171; animation: sgBlink 1s infinite; }
    .status-reconnecting { color: #fbbf24; }
    .status-reconnecting .sg-status-dot { background: #fbbf24; animation: sgBlink 0.7s infinite; }

    /* ── Typing Indicator ── */
    .sg-typing {
        display: none; align-items: center; gap: 8px;
        padding: 12px 16px; font-size: 13px; color: #94a3b8;
        animation: sgMsgIn 0.3s ease;
        background: var(--echo-msg-assistant-bg);
        border: 1px solid var(--echo-msg-assistant-border);
        border-radius: 18px; border-bottom-left-radius: 6px;
        align-self: flex-start; max-width: 160px;
    }
    .sg-typing.visible { display: flex; }
    .sg-dots {
        display: flex; align-items: flex-end; gap: 6px;
        height: 12px; line-height: 0;
    }
    .sg-dot {
        width: 6px; height: 6px; background: var(--echo-primary);
        border-radius: 50%; opacity: 0.5;
        flex: 0 0 6px;
        transform: translate3d(0, 0, 0);
        will-change: transform, opacity;
        animation: sgBounce 1.05s infinite ease-in-out;
    }
    .sg-dot:nth-child(1) { animation-delay: 0s; }
    .sg-dot:nth-child(2) { animation-delay: 0.14s; }
    .sg-dot:nth-child(3) { animation-delay: 0.28s; }

    @keyframes sgBounce {
        0%, 70%, 100% { transform: translate3d(0, 0, 0); opacity: 0.5; }
        35% { transform: translate3d(0, -5px, 0); opacity: 1; }
    }

    /* ── Interim Voice Transcript ── */
    .sg-interim {
        display: none; padding: 6px 20px; font-size: 12px;
        color: var(--echo-primary); font-style: italic;
        background: rgba(var(--echo-primary-rgb), 0.05);
        border-bottom: 1px solid rgba(var(--echo-primary-rgb), 0.1);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .sg-interim.visible { display: block; }

    /* ── Preview Container ── */
    .sg-preview-container {
        display: flex; gap: 8px; padding: 8px 20px; overflow-x: auto;
        background: var(--echo-bar-bg);
    }
    .sg-preview-container:empty { display: none; }
    .sg-preview-item {
        position: relative; width: 56px; height: 56px; border-radius: 10px;
        overflow: hidden; border: 2px solid rgba(var(--echo-primary-rgb), 0.3);
        flex-shrink: 0; transition: transform 0.2s ease;
        animation: sgMsgIn 0.3s ease;
    }
    .sg-preview-item:hover { transform: scale(1.08); }
    .sg-preview-item img { width: 100%; height: 100%; object-fit: cover; }
    .sg-preview-remove {
        position: absolute; top: 2px; right: 2px;
        background: rgba(0,0,0,0.7); color: #fff; border: none;
        border-radius: 50%; width: 18px; height: 18px;
        font-size: 11px; cursor: pointer; display: flex;
        align-items: center; justify-content: center;
        transition: background 0.2s;
    }
    .sg-preview-remove:hover { background: #ef4444; }

    /* ── Input Bar ── */
    .sg-input-bar {
        padding: 14px 16px; border-top: 1px solid rgba(0,0,0,0.06);
        display: flex; align-items: center; gap: 10px;
        background: var(--echo-bar-bg);
    }
    .sg-input-actions { display: flex; align-items: center; gap: 2px; }

    .sg-input {
        flex: 1; border: 1px solid var(--echo-input-border);
        border-radius: 14px; padding: 11px 16px; outline: none;
        transition: all 0.3s ease; font-size: 14px;
        font-weight: 500; font-family: inherit;
        background: var(--echo-input-bg); color: var(--echo-text);
        resize: none; overflow-y: auto; max-height: 120px; min-height: 43px;
    }
    .sg-input::placeholder { color: #64748b; }
    .sg-input::-webkit-scrollbar { width: 4px; }
    .sg-input::-webkit-scrollbar-track { background: transparent; }
    .sg-input::-webkit-scrollbar-thumb {
        background: rgba(var(--echo-primary-rgb), 0.3); border-radius: 10px;
    }
    .sg-input:focus {
        border-color: var(--echo-primary);
        box-shadow: 0 0 0 3px rgba(var(--echo-primary-rgb), 0.15);
    }

    .sg-char-counter {
        font-size: 10px;
        color: #64748b;
        text-align: right;
        margin-top: 4px;
        font-family: inherit;
    }
    .sg-char-counter.limit-reached {
        color: #ef4444;
    }

    .sg-action-btn {
        background: transparent; border: none; cursor: pointer;
        color: #64748b; display: flex; align-items: center;
        justify-content: center; transition: all 0.3s var(--echo-smooth);
        width: 36px; height: 36px; border-radius: 10px;
    }
    .sg-action-btn:hover { color: var(--echo-primary); background: rgba(var(--echo-primary-rgb), 0.1); }
    .sg-action-btn:focus-visible { outline: 2px solid var(--echo-primary); outline-offset: 2px; }
    .sg-action-btn svg { width: 18px; height: 18px; }

    /* Mic Button */
    .sg-mic-btn {
        background: transparent; border: none; cursor: pointer;
        color: #64748b; display: flex; align-items: center;
        justify-content: center; transition: all 0.3s var(--echo-smooth);
        width: 36px; height: 36px; border-radius: 10px;
        position: relative;
    }
    .sg-mic-btn:hover { color: var(--echo-primary); background: rgba(var(--echo-primary-rgb), 0.1); }
    .sg-mic-btn:focus-visible { outline: 2px solid var(--echo-primary); outline-offset: 2px; }
    .sg-mic-btn svg { width: 18px; height: 18px; position: relative; z-index: 1; }
    .sg-mic-btn.recording {
        color: #fff; background: #ef4444;
        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5);
        animation: sgMicPulse 1.5s infinite;
    }
    @keyframes sgMicPulse {
        0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
        70% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
        100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }
    @keyframes sgBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    /* Send Button */
    .sg-send-btn {
        width: 42px; height: 42px; border-radius: 12px; border: none; cursor: pointer;
        background: linear-gradient(135deg, var(--echo-primary), var(--echo-accent));
        color: #fff; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 14px rgba(var(--echo-primary-rgb), 0.35);
        transition: all 0.3s var(--echo-spring);
    }
    .sg-send-btn:hover:not(:disabled) {
        transform: scale(1.08);
        box-shadow: 0 6px 20px rgba(var(--echo-primary-rgb), 0.45);
    }
    .sg-send-btn:active { animation: sgSendPress 0.45s var(--spring-overshoot); }
    .sg-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .sg-send-btn:focus-visible { outline: 2px solid var(--echo-primary); outline-offset: 2px; }
    .sg-send-btn svg { width: 18px; height: 18px; }

    /* ── Drop Zone ── */
    .sg-drop-zone {
        position: absolute; inset: 0;
        background: rgba(var(--echo-primary-rgb), 0.08);
        backdrop-filter: blur(8px); display: none;
        align-items: center; justify-content: center;
        font-weight: 700; font-size: 16px; color: var(--echo-primary);
        border: 3px dashed var(--echo-primary);
        z-index: 20; border-radius: var(--echo-radius);
        flex-direction: column; gap: 12px;
    }
    .sg-drop-zone.active { display: flex; }
    .sg-drop-zone svg { width: 48px; height: 48px; opacity: 0.7; }

    /* ── Chat Bubble ── (HIDDEN UNTIL INTRO COMPLETES) */
    .sg-bubble {
        position: fixed !important; 
        bottom: 32px !important; 
        right: 32px !important;
        width: 64px !important; 
        height: 64px !important; 
        border-radius: 18px !important;
        background: linear-gradient(135deg, var(--echo-primary), var(--echo-accent)) !important;
        color: #fff !important; 
        border: none !important; 
        cursor: pointer !important;
        box-shadow: 0 8px 32px rgba(var(--echo-primary-rgb), 0.4),
                    0 0 0 0 rgba(var(--echo-primary-rgb), 0.3) !important;
        display: flex !important; 
        align-items: center !important; 
        justify-content: center !important;
        z-index: 2147483647 !important;
        transition: all 0.4s var(--echo-spring) !important;
        /* START HIDDEN — revealed by host page after cinematic intro */
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        transform: scale(1) translateY(0);
    }
    /* Activated by window.__kiraShowBubble() after intro completes */
    .sg-bubble.intro-ready {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        animation: sgBubbleEntry 0.6s var(--echo-spring-bouncy) forwards !important;
    }
    @keyframes sgBubbleEntry {
        from { opacity: 0; transform: scale(0.5) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .sg-bubble.intro-ready:not(.open) { animation: sgBubbleEntry 0.6s var(--echo-spring-bouncy), sgBubbleIdle 3s ease-in-out 1.5s infinite; }
    .sg-bubble:hover {
        transform: scale(1.08);
        box-shadow: 0 12px 40px rgba(var(--echo-primary-rgb), 0.5),
                    0 0 20px rgba(var(--echo-primary-rgb), 0.3);
        animation: none;
    }
    .sg-bubble:active { transform: scale(0.9); }
    .sg-bubble:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
    .sg-bubble svg {
        width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 2.5;
        stroke-linecap: round; stroke-linejoin: round;
        transition: all 0.5s var(--echo-spring-bouncy);
    }
    .sg-bubble.open .icon-chat { transform: scale(0.3) rotate(135deg); opacity: 0; position: absolute; }
    .sg-bubble:not(.open) .icon-close { transform: scale(0.3) rotate(-135deg); opacity: 0; position: absolute; }
    .sg-bubble.open .icon-close { transform: scale(1) rotate(0); opacity: 1; }
    .sg-bubble:not(.open) .icon-chat { transform: scale(1) rotate(0); opacity: 1; }

    /* ── Notification Badge ── */
    .sg-badge {
        position: absolute; top: -4px; right: -4px;
        background: #ef4444; color: #fff; font-size: 11px;
        font-weight: 800; width: 20px; height: 20px;
        border-radius: 50%; display: none; align-items: center;
        justify-content: center; border: 2px solid var(--echo-bg);
    }
    .sg-badge.visible { display: flex; animation: sgBadgePop 0.5s var(--spring-overshoot) forwards; }

    /* ── Powered By ── */
    .sg-powered {
        text-align: center; padding: 6px; font-size: 10px;
        color: #64748b; background: var(--echo-bar-bg);
        border-top: 1px solid rgba(255,255,255,0.04);
        letter-spacing: 0.3px;
    }
    .sg-powered a { color: var(--echo-primary); text-decoration: none; font-weight: 700; }

    /* ── Mobile Takeover ── */
    @media (max-width: 768px) {
        .sg-window {
            width: calc(100% - 16px) !important;
            height: 70vh !important;
            right: 8px !important;
            bottom: 90px !important;
            border-radius: 20px !important;
            max-height: calc(100vh - 100px);
        }
        .sg-bubble {
            width: 56px !important;
            height: 56px !important;
            bottom: 20px !important;
            right: 20px !important;
            border-radius: 16px !important;
        }
        .sg-bubble svg {
            width: 24px; height: 24px;
        }
        .sg-header {
            padding: 16px;
        }
        .sg-input-bar {
            padding: 10px 12px;
        }
        .sg-input {
            font-size: 16px; /* Prevents iOS zoom on focus */
            min-height: 44px; /* Apple HIG tap target */
        }
        .sg-action-btn, .sg-mic-btn {
            width: 44px; height: 44px; /* Touch-friendly */
        }
        .sg-send-btn {
            width: 44px; height: 44px;
        }
        .sg-msg {
            max-width: 88%;
        }
    }
    @media (max-width: 480px) {
        .sg-window {
            width: 100% !important; height: 100% !important;
            right: 0 !important; bottom: 0 !important;
            border-radius: 0 !important;
            top: 0 !important;
            max-height: 100vh;
            /* Safe area for notched phones */
            padding-top: env(safe-area-inset-top, 0);
            padding-bottom: env(safe-area-inset-bottom, 0);
        }
        .sg-bubble.open { display: none !important; }
        .sg-input-bar {
            padding-bottom: calc(10px + env(safe-area-inset-bottom, 0));
        }
    }

    /* ── Focus Visible Styles ── */
    *:focus-visible {
        outline: 2px solid var(--echo-primary);
        outline-offset: 2px;
    }
    `;

    const container = document.createElement('div');
    container.innerHTML = `
    <div class="sg-window" id="sgWindow" role="dialog" aria-label="Chat with ${CONFIG.agentName}" aria-hidden="true">
      <div class="sg-header">
        <div class="sg-header-left">
          <div class="sg-avatar${CONFIG.logo ? ' has-logo' : ''}" aria-hidden="true">${CONFIG.logo ? `<img src="${CONFIG.logo}" alt="${CONFIG.agentName}" />` : '<span class="sg-avatar-letter">KIRA</span>'}</div>
          <div class="sg-header-info">
            <div class="sg-header-name">${CONFIG.agentName}</div>
            <div class="sg-header-status"><span>Online</span></div>
          </div>
        </div>
        <div class="sg-header-right">
          <button class="sg-header-btn" id="sgVoiceToggle" aria-label="Toggle voice output" aria-pressed="false" title="Read responses aloud">
            <svg class="icon-speaker-on" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            <svg class="icon-speaker-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
          </button>
          <button class="sg-header-btn sg-close-btn" id="sgClose" aria-label="Close chat" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      <div id="sgStatus" class="sg-status-bar" role="status" aria-live="polite">
        <div class="sg-status-dot"></div>
        <span id="sgStatusText">Online</span>
      </div>
      <div class="sg-messages" id="sgMessages" role="log" aria-label="Chat messages" aria-live="polite">
        <div class="sg-typing" id="sgTyping" aria-label="Kira is thinking">
          <div class="sg-dots"><div class="sg-dot"></div><div class="sg-dot"></div><div class="sg-dot"></div></div>
          <span>Kira is thinking</span>
        </div>
      </div>
      <div id="sgInterim" class="sg-interim" aria-live="polite"></div>
      <div id="sgPreview" class="sg-preview-container" aria-label="File previews"></div>
      <div class="sg-input-bar">
        <div class="sg-input-actions">
            <button class="sg-mic-btn" id="sgMic" aria-label="Voice input: hold to speak or click to toggle" aria-pressed="false" title="Voice input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
        </div>
        <div class="sg-input-wrapper" style="flex:1; display:flex; flex-direction:column; position:relative;">
            <textarea id="sgInput" class="sg-input" placeholder="Type a message..." aria-label="Chat input" rows="1" maxlength="500"></textarea>
            <div id="sgCharCounter" class="sg-char-counter">0/500</div>
        </div>
        <button class="sg-send-btn" id="sgSend" aria-label="Send message" title="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
      <div class="sg-powered">Powered by <a href="#">KIRA</a></div>
      <div id="sgDropZone" class="sg-drop-zone" aria-label="File drop zone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <span>Drop files here</span>
      </div>
    </div>
    <button class="sg-bubble" id="sgBubble" aria-label="Open support chat" title="Chat with ${CONFIG.agentName}">
      <span class="sg-badge" id="sgBadge">1</span>
      <svg class="icon-chat" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <svg class="icon-close" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
    `;

    shadow.appendChild(styles);
    shadow.appendChild(container);

    // ─── DOM References ───
    const bubble = shadow.getElementById('sgBubble');
    const windowEl = shadow.getElementById('sgWindow');
    const closeBtn = shadow.getElementById('sgClose');
    const voiceToggle = shadow.getElementById('sgVoiceToggle');
    const messages = shadow.getElementById('sgMessages');
    const input = shadow.getElementById('sgInput');
    const sendBtn = shadow.getElementById('sgSend');
    const micBtn = shadow.getElementById('sgMic');
    const typing = shadow.getElementById('sgTyping');
    const statusEl = shadow.getElementById('sgStatus');
    const statusText = shadow.getElementById('sgStatusText');
    const interimEl = shadow.getElementById('sgInterim');
    const badge = shadow.getElementById('sgBadge');

    let speechTimeout = null;
    let recognition = null;
    let holdTimer = null;
    let isHoldMode = false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const synth = window.speechSynthesis;
    let voices = [];
    const messageQueue = [];

    // ─── Focus Trap ───
    function trapFocus() {
        const focusable = windowEl.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        windowEl.addEventListener('keydown', function trap(e) {
            if (e.key !== 'Tab') return;
            if (e.shiftKey) {
                if (shadow.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (shadow.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
    }

    // ─── Network Resilience ───
    function updateStatusUI(status) {
        statusEl.className = `sg-status-bar visible status-${status}`;
        const labels = {
            online: 'Connected',
            offline: 'Offline — messages will be queued',
            reconnecting: 'Reconnecting…'
        };
        statusText.textContent = labels[status] || status;
        if (status === 'online') {
            setTimeout(() => statusEl.classList.remove('visible'), 3000);
            // Retry queued messages
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                sendMessage(msg);
            }
        }
    }

    window.addEventListener('online', () => setState('connectionStatus', 'online'));
    window.addEventListener('offline', () => setState('connectionStatus', 'offline'));

    // ─── Text-to-Speech ───
    function loadVoices() {
        if (!synth) return;
        voices = synth.getVoices();
    }
    if (synth) {
        if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
        loadVoices();
    }

    function speak(text) {
        if (!widgetState.isVoiceEnabled || !synth) return;
        synth.cancel();
        synth.resume();
        const utter = new SpeechSynthesisUtterance(text);
        utter.volume = 1.0;
        const femaleVoice = voices.find(v =>
            (v.name.includes('Google') || v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Zira')) &&
            v.lang.startsWith('en')
        );
        if (femaleVoice) utter.voice = femaleVoice;
        utter.pitch = 1.1;
        utter.rate = 1;
        synth.speak(utter);
    }

    // ─── Voice Input (Speech-to-Text) ───
    if (SpeechRecognition && features.speechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let baseText = '';
        recognition.onstart = () => {
            setState('isRecording', true);
            // Preserve existing text if any and add a space if needed
            baseText = input.value.trim();
            if (baseText) baseText += ' ';
            clearTimeout(speechTimeout);
        };

        recognition.onresult = (event) => {
            // Prevent speech results from repopulating input after send
            if (widgetState.isSending) return;
            let interim = '';
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }

            if (final) {
                baseText += final + ' ';
            }
            
            // Instantly update input field to make translation feel fast
            input.value = baseText + interim;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            interimEl.textContent = '';

            clearTimeout(speechTimeout);
            // Auto stop mic and send after 6s of silence
            speechTimeout = setTimeout(() => {
                if (widgetState.isRecording) {
                    recognition.stop();
                }
                if (input.value.trim()) {
                    sendMessage();
                }
            }, 6000);
        };

        recognition.onerror = (event) => {
            if (event.error !== 'aborted') {
                console.warn('[KIRA] Speech error:', event.error);
                if (event.error === 'not-allowed') {
                    appendMessage('system', '⚠️ Please allow microphone access in your browser settings to use voice input.');
                } else if (event.error === 'network') {
                    appendMessage('system', '⚠️ Network error during voice recognition.');
                }
            }
            setState('isRecording', false);
            interimEl.textContent = '';
        };

        recognition.onend = () => {
            setState('isRecording', false);
            interimEl.textContent = '';
            input.focus();
        };

        // ─── Unified Smart Voice Handling ───
        let micStartTime = 0;
        let isStartedByHold = false;

        micBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            micStartTime = Date.now();
            isHoldMode = false;
            isStartedByHold = false;

            holdTimer = setTimeout(() => {
                isHoldMode = true;
                isStartedByHold = true;
                if (!widgetState.isRecording) {
                    try { recognition.start(); } catch (err) { /* Already starting */ }
                }
            }, 250); // Threshold for long-press
        });

        micBtn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            clearTimeout(holdTimer);
            const duration = Date.now() - micStartTime;

            if (duration < 250) {
                // Short Tap: Toggle Mode
                if (widgetState.isRecording) {
                    recognition.stop();
                } else {
                    try { recognition.start(); } catch (err) { /* Already starting */ }
                }
            } else if (isStartedByHold && widgetState.isRecording) {
                // Long Press End: Release to stop
                recognition.stop();
            }
            
            isHoldMode = false;
        });

        // Prevent ghost clicks from interfering
        micBtn.addEventListener('click', (e) => e.preventDefault());
    } else {
        // Graceful degradation - hide mic button
        micBtn.style.display = 'none';
    }

    // ─── Voice Toggle (TTS) ───
    voiceToggle.addEventListener('click', () => {
        widgetState.isVoiceEnabled = !widgetState.isVoiceEnabled;
        voiceToggle.classList.toggle('active', widgetState.isVoiceEnabled);
        voiceToggle.setAttribute('aria-pressed', String(widgetState.isVoiceEnabled));
        voiceToggle.querySelector('.icon-speaker-on').style.display = widgetState.isVoiceEnabled ? 'block' : 'none';
        voiceToggle.querySelector('.icon-speaker-off').style.display = widgetState.isVoiceEnabled ? 'none' : 'block';
        if (!widgetState.isVoiceEnabled && synth) synth.cancel();
    });

    // ─── Chat Toggle ───
    function toggleChat() {
        const opening = !widgetState.isOpen;

        if (!opening) {
            // Closing animation
            windowEl.classList.add('closing');
            setTimeout(() => {
                windowEl.classList.remove('closing', 'open');
                setState('isOpen', false);
            }, 350);
            if (recognition && widgetState.isRecording) recognition.stop();
            if (synth) synth.cancel();
            bubble.classList.remove('open');
            badge.classList.remove('visible');
        } else {
            windowEl.classList.remove('closing');
            setState('isOpen', true);
            bubble.classList.add('open');
            if (!widgetState.welcomeShown) {
                widgetState.welcomeShown = true;
                setTimeout(() => appendMessage('assistant', ATTRIBUTION.isOutbound ? ATTRIBUTION.welcome : CONFIG.welcome), 400);
            }
        }
    }

    bubble.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    if (ATTRIBUTION.isOutbound) {
        setTimeout(() => {
            if (!widgetState.isOpen) {
                toggleChat();
            }
        }, 700);
    }
    
    // ─── Lead Form Logic ───
    function isEscalation(text) {
        const keywords = [
            'human', 'agent', 'person', 'talk to someone', 'speak to', 'representative',
            'help me', 'urgent', 'manager', 'support', 'frustrated', 'angry', 'escalate'
        ];
        const lower = (text || '').toLowerCase();
        return keywords.some(k => lower.includes(k));
    }

    // ─── Message Append ───
    function getUserInitials() {
        try {
            const userStr = localStorage.getItem('kiraUser');
            if (!userStr) return null;
            const user = JSON.parse(userStr);
            if (!user || !user.name) return null;
            const parts = user.name.trim().split(/\s+/);
            if (parts.length > 1) {
                return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
            }
            return parts[0].charAt(0).toUpperCase();
        } catch (e) { return null; }
    }

    function getUserPicture() {
        try {
            const userStr = localStorage.getItem('kiraUser');
            if (!userStr) return null;
            const user = JSON.parse(userStr);
            return user && user.picture ? user.picture : null;
        } catch (e) { return null; }
    }

    function appendMessage(role, text, isError = false) {
        // Create container for avatar + message
        const container = document.createElement('div');
        container.className = `sg-msg-container ${role}`;

        if (role === 'assistant') {
            const avatar = document.createElement('div');
            avatar.className = 'sg-msg-avatar';
            if (CONFIG.logo) avatar.classList.add('has-logo');
            avatar.innerHTML = CONFIG.logo 
                ? `<img src="${CONFIG.logo}" alt="${CONFIG.agentName}" />` 
                : `<span class="sg-msg-avatar-letter">KIRA</span>`;
            container.appendChild(avatar);
        }

        if (role === 'user') {
            // User avatar with initials or profile picture
            const userPic = getUserPicture();
            const userInitials = getUserInitials() || '?';
            const avatar = document.createElement('div');
            avatar.className = 'sg-msg-avatar sg-user-avatar';
            const initialsHTML = `<span class="sg-user-initials">${userInitials}</span>`;
            if (userPic) {
                const img = document.createElement('img');
                img.src = sanitizeHTML(userPic);
                img.alt = 'You';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                img.referrerPolicy = 'no-referrer';
                img.onerror = () => { avatar.innerHTML = initialsHTML; };
                avatar.appendChild(img);
            } else {
                avatar.innerHTML = initialsHTML;
            }
            // User avatar goes after the message bubble (right side)
            container._userAvatar = avatar;
        }

        const msg = document.createElement('div');
        msg.className = `sg-msg ${role}${isError ? ' error' : ''}`;
        msg.setAttribute('role', 'article');
        // Directional spring entrance animation
        if (role === 'user') msg.classList.add('msg-enter-right');
        else if (role === 'assistant') msg.classList.add('msg-enter-left');
        
        container.appendChild(msg);
        // Append user avatar AFTER the message bubble
        if (role === 'user' && container._userAvatar) {
            container.appendChild(container._userAvatar);
            delete container._userAvatar;
        }

        // Hide dots immediately for non-assistant or error messages
        if (role !== 'assistant') {
            typing.classList.remove('visible');
            if (role === 'user') {
                widgetState.userMessageCount++;
                if (widgetState.userMessageCount >= 3) {
                    setTimeout(showLeadForm, 1000);
                }
            }
        }

        // Insert before typing indicator immediately
        messages.insertBefore(container, typing);
        messages.scrollTop = messages.scrollHeight;

        if (role === 'assistant') {
            const fullHtml = renderMarkdown(text);
            msg.innerHTML = '';
            speak(text);

            const chars = [];
            const tokens = fullHtml.split(/(<[^>]+>|&[a-zA-Z0-9#]+;)/);
            for (const token of tokens) {
                if (!token) continue;
                if ((token.startsWith('<') && token.endsWith('>')) || (token.startsWith('&') && token.endsWith(';'))) {
                    chars.push(token);
                } else {
                    chars.push(...Array.from(token));
                }
            }

            let currentIndex = 0;
            let currentStr = '';
            let typingTimer = null;
            let isTyping = true;

            const skipHandler = () => {
                if (isTyping) {
                    isTyping = false;
                    clearTimeout(typingTimer);
                    msg.innerHTML = fullHtml;
                    messages.scrollTop = messages.scrollHeight;
                    windowEl.removeEventListener('click', skipHandler, true);
                }
            };
            
            windowEl.addEventListener('click', skipHandler, true);

            const typeNext = () => {
                if (!isTyping) return;
                
                if (currentIndex < chars.length) {
                    currentStr += chars[currentIndex++];
                    
                    while (currentIndex < chars.length && 
                          ((chars[currentIndex].startsWith('<') && chars[currentIndex].endsWith('>')) || 
                           (chars[currentIndex].startsWith('&') && chars[currentIndex].endsWith(';')))) {
                        currentStr += chars[currentIndex++];
                    }
                    
                    msg.innerHTML = currentStr;
                    messages.scrollTop = messages.scrollHeight;
                    
                    // Hide typing indicator after a few characters are out to ensure a smooth handoff
                    if (currentIndex > 15) typing.classList.remove('visible');

                    typingTimer = setTimeout(typeNext, 20); // 20ms = Fast but natural
                } else {
                    isTyping = false;
                    typing.classList.remove('visible'); // Ensure it is gone when finished
                    windowEl.removeEventListener('click', skipHandler, true);
                }
            };
            
            typeNext();
        } else {
            msg.textContent = text;
            messages.scrollTop = messages.scrollHeight;
        }

        // Store in history
        widgetState.messageHistory.push({ role, text, timestamp: Date.now() });

        return msg;
    }

    // ─── Send Message ───
    async function sendMessage(text) {
        if (recognition && widgetState.isRecording) {
            recognition.stop();
        }
        clearTimeout(speechTimeout);

        const val = text || input.value.trim();
        if (!val && widgetState.pendingUploads.length === 0) return;
        if (widgetState.isSending) return;

        if (widgetState.connectionStatus === 'offline') {
            messageQueue.push(val);
            appendMessage('system', '📨 Message queued — will send when connected.');
            input.value = '';
            preview.innerHTML = '';
            widgetState.pendingUploads = [];
            return;
        }

        lastUserMessage = val;
        widgetState.isSending = true;
        sendBtn.disabled = true;

        appendMessage('user', val);
        input.value = '';
        input.style.height = 'auto';
        preview.innerHTML = '';
        widgetState.pendingUploads = [];

        typing.classList.add('visible');
        messages.scrollTop = messages.scrollHeight;

        try {
            const data = await callChatAPI(val);
            
            if (data.daily_limit_reached) {
                input.disabled = true;
                input.placeholder = "Daily limit reached.";
                sendBtn.disabled = true;
                appendMessage('system', "You've reached your daily chat limit. Come back tomorrow! 🕐");
                widgetState.isSending = false;
                typing.classList.remove('visible');
                return;
            }

            if (data.credits_exhausted) {
                input.disabled = true;
                input.placeholder = "Support unavailable.";
                sendBtn.disabled = true;
                appendMessage('system', "Support is currently unavailable. Contact the business directly.");
                widgetState.isSending = false;
                typing.classList.remove('visible');
                return;
            }

            // API returns { success, data: { reply } } — extract the nested reply
            const reply = (data && data.data && data.data.reply) || data.reply || (typeof data === 'string' ? data : 'Sorry, I couldn\'t generate a response.');
            appendMessage('assistant', reply);

        } catch (err) {
            console.error('[KIRA Widget] Chat error:', err);
            typing.classList.remove('visible');
            
            if (err.message === '429') {
                appendMessage('system', "You're typing too fast! Please wait a moment.");
                input.disabled = true;
                sendBtn.disabled = true;
                setTimeout(() => {
                    input.disabled = false;
                    sendBtn.disabled = false;
                }, 10000);
            } else if (err.message.includes('exhausted') || err.message.includes('limit')) {
                const errorMsg = appendMessage('system', err.message);
                const dashLink = document.createElement('a');
                dashLink.href = window.location.origin + '/checkout';
                dashLink.target = '_blank';
                dashLink.style.color = 'var(--echo-primary)';
                dashLink.style.marginLeft = '10px';
                dashLink.textContent = 'Upgrade Now';
                errorMsg.appendChild(dashLink);
            } else {
                const errorMsg = appendMessage('system', '⚠️ Failed to send. Click to retry.');
                errorMsg.style.cursor = 'pointer';
                errorMsg.addEventListener('click', () => {
                    errorMsg.remove();
                    sendMessage(val);
                });
            }
        } finally {
            if (!input.disabled) {
                widgetState.isSending = false;
                sendBtn.disabled = false;
            }
        }
    }

    // ─── Event Listeners ───
    sendBtn.addEventListener('click', () => sendMessage());

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // ─── Character Limit (500) ───
    const MAX_CHARS = 500;
    const charCounter = shadow.getElementById('sgCharCounter');

    function updateCharCounter() {
        const len = input.value.length;
        if (len === 0) {
            if(charCounter) charCounter.textContent = '';
            input.classList.remove('limit-reached');
            return;
        }
        if(charCounter) {
            charCounter.textContent = `${len}/${MAX_CHARS}`;
            if (len >= MAX_CHARS) {
                charCounter.className = 'sg-char-counter limit';
                input.classList.add('limit-reached');
            } else if (len >= MAX_CHARS * 0.85) {
                charCounter.className = 'sg-char-counter warn';
                input.classList.remove('limit-reached');
            } else {
                charCounter.className = 'sg-char-counter';
                input.classList.remove('limit-reached');
            }
        }
    }

    input.addEventListener('input', () => {
        if (input.value.length > MAX_CHARS) {
            input.value = input.value.substring(0, MAX_CHARS);
        }
        updateCharCounter();
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        const count = input.value.length;
        const charCounter = shadow.getElementById('sgCharCounter');
        if (charCounter) {
            charCounter.textContent = `${count}/500`;
            if (count >= 500) {
                charCounter.classList.add('limit-reached');
                charCounter.textContent = 'Character limit reached';
            } else {
                charCounter.classList.remove('limit-reached');
            }
        }
    });

    // ─── Global Keyboard Shortcuts ───
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && widgetState.isOpen) {
            toggleChat();
        }
    });

    // ─── Initialization ───
    startThemeWatcher();
    const initTheme = window.KiraTheme || window.EchoTheme || window.SupportGenieTheme;
    if (initTheme) {
        applyTheme(initTheme);
        widgetState.theme = initTheme;
    }
    // Initialize derived brand colors from CONFIG
    const initDerived = deriveColors(CONFIG.color);
    host.style.setProperty('--brand-hover', initDerived.hover);
    host.style.setProperty('--brand-active', initDerived.active);
    host.style.setProperty('--brand-contrast', initDerived.contrast);

    // Auto-detect system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const theme = window.KiraTheme || window.EchoTheme || window.SupportGenieTheme;
        if (theme && theme.mode === 'auto') applyTheme(theme);
    });

    // ─── Public Theme Provider API ───
    window.KiraThemeProvider = {
        setTheme(config) {
            const theme = {};
            if (config.primary) {
                theme.primaryColor = config.primary;
                const derived = deriveColors(config.primary);
                host.style.setProperty('--brand-primary', config.primary);
                host.style.setProperty('--brand-primary-rgb', derived.primaryRgb);
                host.style.setProperty('--brand-hover', derived.hover);
                host.style.setProperty('--brand-active', derived.active);
                host.style.setProperty('--brand-contrast', derived.contrast);
            }
            if (config.accent) {
                theme.accentColor = config.accent;
                host.style.setProperty('--brand-accent', config.accent);
                host.style.setProperty('--brand-accent-rgb', hexToRgb(config.accent));
            }
            if (config.mode) theme.mode = config.mode;
            if (config.font) theme.fontFamily = config.font;
            if (config.radius) theme.borderRadius = config.radius;
            if (config.glass !== undefined) theme.glassEffect = config.glass;
            applyTheme(theme);
            widgetState.theme = { ...widgetState.theme, ...theme };
            themeSubscribers.forEach(cb => { try { cb(widgetState.theme); } catch(e) {} });
        },
        getTheme() {
            return { ...widgetState.theme };
        },
        subscribe(callback) {
            if (typeof callback === 'function') {
                themeSubscribers.push(callback);
                return () => {
                    const idx = themeSubscribers.indexOf(callback);
                    if (idx > -1) themeSubscribers.splice(idx, 1);
                };
            }
        },
        reset() {
            const defaultTheme = { primaryColor: CONFIG.color, accentColor: '#0ea5e9', mode: 'dark' };
            applyTheme(defaultTheme);
            widgetState.theme = defaultTheme;
            const derived = deriveColors(CONFIG.color);
            host.style.setProperty('--brand-primary', CONFIG.color);
            host.style.setProperty('--brand-primary-rgb', derived.primaryRgb);
            host.style.setProperty('--brand-hover', derived.hover);
            host.style.setProperty('--brand-active', derived.active);
            host.style.setProperty('--brand-contrast', derived.contrast);
            themeSubscribers.forEach(cb => { try { cb(defaultTheme); } catch(e) {} });
        }
    };

    // ─── Dynamic Config Sync ───
    async function fetchLiveConfig() {
        if (!CONFIG.token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/client/config/by-token/${encodeURIComponent(CONFIG.token)}`);
            if (!res.ok) return;
            const data = await res.json();
            
            // Update CONFIG
            if (data.color) CONFIG.color = data.color;
            if (data.agentName) CONFIG.agentName = data.agentName;
            // Logo: use API value (could be null if deleted) with cache-bust
            CONFIG.logo = data.logo ? `${data.logo}?t=${Date.now()}` : null;
            if (data.welcome) {
                CONFIG.welcome = data.welcome;
                ATTRIBUTION.welcome = data.welcome;
            }
            // Store business contact details for dynamic escalation messages
            CONFIG.businessPhone = data.businessPhone || null;
            CONFIG.businessEmail = data.businessEmail || null;

            // Apply theming dynamically
            applyTheme({
                primaryColor: CONFIG.color,
                accentColor: data.accentColor || CONFIG.color
            });

            // Update DOM
            const nameEl = shadow.getElementById('echo-agent-name');
            if (nameEl) nameEl.textContent = CONFIG.agentName;

            const avatarWrap = shadow.querySelector('.sg-avatar');
            if (avatarWrap) {
                if (CONFIG.logo) {
                    avatarWrap.classList.add('has-logo');
                    avatarWrap.innerHTML = `<img src="${CONFIG.logo}" alt="${CONFIG.agentName}" />`;
                } else {
                    avatarWrap.classList.remove('has-logo');
                    avatarWrap.innerHTML = `<span class="sg-avatar-letter">${(CONFIG.agentName || 'K').charAt(0).toUpperCase()}</span>`;
                }
            }
        } catch (e) {
            console.warn('[Kira] Failed to fetch live config:', e);
        }
    }
    
    // Fire it off immediately
    fetchLiveConfig();

    // ─── Public API: Show Bubble After Intro ───
    window.__kiraShowBubble = function() {
        const b = shadow.getElementById('sgBubble');
        if (b) {
            b.classList.add('intro-ready');
            console.log('✅ KIRA Bubble revealed after intro.');
        }
    };

    // ─── Mobile: Virtual Keyboard Handler ───
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (!widgetState.isOpen) return;
            const vvh = window.visualViewport.height;
            const wh = window.innerHeight;
            // If keyboard is open (viewport shrunk significantly)
            if (wh - vvh > 100) {
                windowEl.style.height = vvh + 'px';
                windowEl.style.bottom = '0';
            } else {
                windowEl.style.height = '';
                windowEl.style.bottom = '';
            }
        });
    }

})();
