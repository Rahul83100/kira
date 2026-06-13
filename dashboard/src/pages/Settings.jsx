import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function Settings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [saved, setSaved] = useState(false);
  
  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role: 'Owner',
    avatar: user?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rahul'
  });

  const [about, setAbout] = useState({
    organizationName: user?.company || '',
    industry: '',
    companySize: '',
    audience: '',
    website: '',
    phone: ''
  });

  const [address, setAddress] = useState({
    street: '',
    city: 'BANGALORE',
    state: '',
    zip: '',
    country: 'India'
  });

  const [social, setSocial] = useState({
    facebook: '',
    twitter: '',
    linkedin: '',
    instagram: ''
  });
  
  const [customPrompt, setCustomPrompt] = useState('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);

  const getWordCount = (str) => {
    return str.trim().split(/\s+/).filter(Boolean).length;
  };

  useEffect(() => {
    const fetchConfig = async () => {
      if (!user?.slug) return;
      try {
        const res = await api.get(`/api/client/${user.slug}`);
        const data = res.data;
        // Check both nested and flattened structure
        const prompt = data.customPrompt || (data.client && data.client.customPrompt);
        if (prompt) setCustomPrompt(prompt);

        // Load customer's real name from the API (this is the DB name, not widget name)
        const customerName = data.customerName || (data.client && data.client.name);
        if (customerName) setProfile(p => ({ ...p, name: customerName }));

        const welcome = data.welcome || (data.client && data.client.widget_welcome);
        if (welcome) setAbout(a => ({ ...a, welcome: welcome }));
      } catch (err) {
        console.error('Failed to fetch client config', err);
      } finally {
        setLoadingConfig(false);
      }
    };
    fetchConfig();
  }, [user?.slug]);

  const [savedProfile, setSavedProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const handleSaveProfile = async () => {
    try {
      if (!user?.slug) return;
      if (!profile.name.trim()) {
        alert('Name cannot be empty.');
        return;
      }
      setSavingProfile(true);
      await api.put(`/api/client/${user.slug}/profile`, {
        name: profile.name.trim(),
      });
      setSavedProfile(true);
      setTimeout(() => setSavedProfile(false), 2000);
    } catch (err) {
      console.error('Failed to save profile', err);
      alert('Failed to save name. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      if (!user?.slug) return;

      if (getWordCount(customPrompt) > 500) {
        alert('System prompt exceeds 500 words limit. Please shorten it.');
        return;
      }

      await api.put(`/api/client/${user.slug}/widget`, {
        custom_prompt: customPrompt,
      });
      setSaved(true);
      setIsEditingPrompt(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save AI config', err);
    }
  };

  const inputClass = "w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all";
  const selectClass = "w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all appearance-none";

  return (
    <div className="animate-fade-in max-w-4xl pb-10">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your company details and profile configuration</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Profile Header */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-6">
            <img src={profile.avatar} alt="Profile" className="w-20 h-20 rounded-full object-cover border border-gray-100 shadow-sm" />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-semibold text-gray-900">{profile.name || 'Your Name'}</h2>
                <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg border border-gray-200">{profile.role}</span>
              </div>
              <p className="text-gray-500 text-sm">{profile.email}</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Your Name</label>
            <div className="flex gap-3">
              <input
                type="text"
                value={profile.name}
                onChange={e => setProfile({...profile, name: e.target.value})}
                placeholder="Enter your name"
                className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all"
              />
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className={`px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${savedProfile ? 'bg-emerald-500 text-white shadow-emerald-500/25' : 'bg-brand-500 text-white hover:bg-brand-600 shadow-brand-500/25'} shadow-lg disabled:opacity-50`}
              >
                {savedProfile ? '✓ Saved' : savingProfile ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">About</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Organization name</label>
              <input type="text" value={about.organizationName} onChange={e => setAbout({...about, organizationName: e.target.value})} placeholder="Enter organization name" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Industry</label>
              <div className="relative">
                <select value={about.industry} onChange={e => setAbout({...about, industry: e.target.value})} className={selectClass}>
                  <option value="" disabled>Search industry</option>
                  <option value="tech">Technology</option>
                  <option value="ecommerce">E-commerce</option>
                  <option value="finance">Finance</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="education">Education</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-400">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Company size</label>
              <div className="relative">
                <select value={about.companySize} onChange={e => setAbout({...about, companySize: e.target.value})} className={selectClass}>
                  <option value="" disabled>Select company size</option>
                  <option value="1-10">1-10 employees</option>
                  <option value="11-50">11-50 employees</option>
                  <option value="51-200">51-200 employees</option>
                  <option value="201-500">201-500 employees</option>
                  <option value="500+">500+ employees</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-400">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Audience</label>
              <div className="relative">
                <select value={about.audience} onChange={e => setAbout({...about, audience: e.target.value})} className={selectClass}>
                  <option value="" disabled>Select audience types</option>
                  <option value="b2b">B2B (Business to Business)</option>
                  <option value="b2c">B2C (Business to Consumer)</option>
                  <option value="both">Both B2B & B2C</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-400">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Website address</label>
              <input type="url" value={about.website} onChange={e => setAbout({...about, website: e.target.value})} placeholder="e.g. yourcompany.com" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Mobile phone number</label>
              <div className="flex">
                <div className="flex-shrink-0 inline-flex items-center py-3 px-4 text-sm font-medium text-center text-gray-600 bg-gray-50 border border-r-0 border-gray-200 rounded-l-xl">
                  🇮🇳 <span className="ml-1 text-xs text-gray-400">▼</span>
                </div>
                <input type="tel" value={about.phone} onChange={e => setAbout({...about, phone: e.target.value})} placeholder="081234 56789" className={`rounded-l-none ${inputClass}`} />
              </div>
            </div>
          </div>
        </div>

        {/* Address Section */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Address</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Street</label>
              <input type="text" value={address.street} onChange={e => setAddress({...address, street: e.target.value})} placeholder="Enter street address" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">City</label>
              <input type="text" value={address.city} onChange={e => setAddress({...address, city: e.target.value})} placeholder="Enter city" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">State / Province / Region</label>
              <input type="text" value={address.state} onChange={e => setAddress({...address, state: e.target.value})} placeholder="Enter state" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">ZIP code</label>
              <input type="text" value={address.zip} onChange={e => setAddress({...address, zip: e.target.value})} placeholder="Enter ZIP code" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Country</label>
              <div className="relative">
                <select value={address.country} onChange={e => setAddress({...address, country: e.target.value})} className={selectClass}>
                  <option value="India">India</option>
                  <option value="USA">United States</option>
                  <option value="UK">United Kingdom</option>
                  <option value="Canada">Canada</option>
                  <option value="Australia">Australia</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-gray-400">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Personality & System Prompt Section */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI Agent Configuration</h2>
              <p className="text-sm text-gray-500">Define your AI's personality and instructions.</p>
            </div>
            {!isEditingPrompt ? (
              <button 
                onClick={() => setIsEditingPrompt(true)}
                className="px-4 py-2 text-xs font-semibold text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
              >
                Edit Configuration
              </button>
            ) : (
              <button 
                onClick={() => setIsEditingPrompt(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5 flex justify-between">
                <span>Custom System Prompt</span>
                <span className={`text-xs ${getWordCount(customPrompt) > 500 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                  {getWordCount(customPrompt)} / 500 words
                </span>
              </label>
              <textarea 
                value={customPrompt} 
                onChange={e => setCustomPrompt(e.target.value)} 
                rows={6}
                disabled={!isEditingPrompt}
                placeholder="e.g. You are a professional sales assistant for Site2Success. Your goal is to help businesses with their online presence. Smoothly collect the visitor's Name, Email, and Phone number during the conversation." 
                className={`${inputClass} resize-none ${!isEditingPrompt ? 'bg-gray-50 text-gray-500 border-dashed cursor-not-allowed' : ''}`}
              />
              <p className="mt-2 text-xs text-gray-400">This prompt directly instructs the Gemini AI on how to interact with your customers.</p>
            </div>
          </div>
        </div>

        {/* Social Media Section */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Social media</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Facebook</label>
              <input type="url" value={social.facebook} onChange={e => setSocial({...social, facebook: e.target.value})} placeholder="https://facebook.com/page" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">X (previously Twitter)</label>
              <input type="url" value={social.twitter} onChange={e => setSocial({...social, twitter: e.target.value})} placeholder="https://x.com/username" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">LinkedIn</label>
              <input type="url" value={social.linkedin} onChange={e => setSocial({...social, linkedin: e.target.value})} placeholder="https://linkedin.com/company/name" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Instagram</label>
              <input type="url" value={social.instagram} onChange={e => setSocial({...social, instagram: e.target.value})} placeholder="https://instagram.com/username" className={inputClass} />
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400">The details above (Organization, Address, Social) are not yet persisted.</p>
          <button onClick={handleSaveConfig}
            className={`px-8 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${saved ? 'bg-emerald-500 text-white shadow-emerald-500/25' : 'bg-brand-500 text-white hover:bg-brand-600 shadow-brand-500/25'} shadow-lg`}>
            {saved ? '✓ Saved Successfully' : 'Save AI Config'}
          </button>
        </div>
      </div>
    </div>
  );
}
