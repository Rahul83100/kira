import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../api/client';

export default function Pricing() {
  const { user } = useAuth();
  const [loadingTier, setLoadingTier] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);

  // Load Razorpay SDK script on mount
  useEffect(() => {
    if (document.getElementById('razorpay-sdk')) return;
    const script = document.createElement('script');
    script.id = 'razorpay-sdk';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const handleCheckout = async (itemId) => {
    setLoadingTier(itemId);
    setCheckoutError(null);

    try {
      // 1. Create a Razorpay order via our backend
      const res = await api.post('/api/payments/create-order', {
        type: 'plan',
        plan_id: itemId,
      });

      const { order_id, key_id, amount, currency } = res.data;

      if (!order_id || !amount) {
        throw new Error('Backend did not return order_id or amount');
      }

      // 2. Open the Razorpay checkout popup
      const options = {
        key: key_id || import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount,
        currency: currency || 'INR',
        name: 'Kira AI',
        description: `${itemId.charAt(0).toUpperCase() + itemId.slice(1)} Plan — Monthly`,
        order_id,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        theme: { color: '#00ffd5' },
        handler: async (response) => {
          // 3. Payment succeeded — save the order / verify
          try {
            await api.post('/api/payments/save-order', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              type,
              itemId,
            });
            // Reload the page so useAuth re-fetches the user's plan
            window.location.reload();
          } catch (saveErr) {
            console.error('Save order failed:', saveErr);
            setCheckoutError('Payment succeeded but verification failed. Contact support.');
          }
        },
        modal: {
          ondismiss: () => setLoadingTier(null),
        },
      };

      if (!window.Razorpay) {
        throw new Error('Razorpay SDK not loaded. Please refresh and try again.');
      }

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        console.error('Payment failed:', resp.error);
        setCheckoutError(resp.error.description || 'Payment failed. Please try again.');
        setLoadingTier(null);
      });
      rzp.open();
    } catch (e) {
      console.error('Checkout error:', e);
      setCheckoutError(e.response?.data?.error || e.message || 'Checkout failed.');
      setLoadingTier(null);
    }
  };

  const [isAnnual, setIsAnnual] = useState(false);

  // Pricing configuration
  const PRICING = {
    base: {
      monthly: 299,
      annual: 249, // Approx 20% off
      messages: { monthly: '2,000', annual: '24,000' },
      kb: '10MB (10 sources)',
      chars: '1 Lakh Characters',
    },
    pro: {
      monthly: 499,
      annual: 399,
      messages: { monthly: '5,000', annual: '60,000' },
      kb: '15MB (20 sources)',
      chars: '3 Lakh Characters',
    },
    growth: {
      monthly: 699,
      annual: 549,
      messages: { monthly: '15,000', annual: '180,000' },
      kb: '35MB (20 sources)',
      chars: '5 Lakh Characters',
    }
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto py-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-gray-900 via-gray-700 to-gray-900 tracking-tight mb-4">
          Upgrade Your Agent
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-8">
          Scale your AI capabilities with flexible credit tiers designed for
          your business.
        </p>
        
        {/* Annual / Monthly Toggle */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <span className={`text-sm font-semibold ${!isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>Monthly</span>
          <button 
            onClick={() => setIsAnnual(!isAnnual)}
            className="relative inline-flex h-7 w-14 items-center rounded-full bg-brand-500 transition-colors focus:outline-none"
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${isAnnual ? 'translate-x-8' : 'translate-x-1'}`} />
          </button>
          <span className={`text-sm font-semibold flex items-center gap-2 ${isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>
            Annual
            <span className="bg-emerald-100 text-emerald-700 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold">Save 20%</span>
          </span>
        </div>

        {checkoutError && (
          <div className="mt-6 mx-auto max-w-lg p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-left">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-red-700">{checkoutError}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mb-16 max-w-5xl mx-auto">
        {/* Base Tier */}
        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Base</h3>
          <p className="text-sm text-gray-500 mb-6">
            Perfect for testing AI capabilities.
          </p>
          <div className="mb-6">
            <span className="text-4xl font-extrabold text-gray-900">₹{isAnnual ? PRICING.base.annual : PRICING.base.monthly}</span>
            <span className="text-gray-500">/mo</span>
            {isAnnual && <p className="text-xs text-gray-400 mt-1">Billed ₹{PRICING.base.annual * 12} yearly</p>}
          </div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> <span className="font-semibold text-gray-900">{isAnnual ? PRICING.base.messages.annual : PRICING.base.messages.monthly}</span> message credits
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> Up to <span className="font-semibold text-gray-900">10</span> sources
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> 10MB knowledge base
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> 1 Lakh Characters
            </li>
          </ul>
          <button
            onClick={() => handleCheckout(isAnnual ? "base_annual" : "base")}
            disabled={loadingTier === (isAnnual ? "base_annual" : "base")}
            className="w-full py-3.5 px-4 bg-brand-50 text-brand-600 hover:bg-brand-100 font-semibold rounded-xl text-sm transition-colors border border-brand-200"
          >
            {loadingTier === (isAnnual ? "base_annual" : "base") ? "Loading..." : "Upgrade to Base"}
          </button>
        </div>

        {/* Pro Tier (Highlight) */}
        <div className="relative bg-black rounded-3xl p-8 shadow-2xl shadow-gray-900/40 transform lg:-translate-y-4 border border-gray-800 hover:shadow-gray-900/60 transition-all duration-300 flex flex-col">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="bg-gradient-to-r from-brand-500 to-brand-400 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-lg">
              Most Popular
            </span>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
          <p className="text-sm text-gray-400 mb-6">
            For scaling businesses.
          </p>
          <div className="mb-6">
            <span className="text-4xl font-extrabold text-white">₹{isAnnual ? PRICING.pro.annual : PRICING.pro.monthly}</span>
            <span className="text-gray-400">/mo</span>
            {isAnnual && <p className="text-xs text-gray-500 mt-1">Billed ₹{PRICING.pro.annual * 12} yearly</p>}
          </div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <span className="text-brand-400 font-bold">✓</span> <span className="font-semibold text-white">{isAnnual ? PRICING.pro.messages.annual : PRICING.pro.messages.monthly}</span> message credits
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <span className="text-brand-400 font-bold">✓</span> Up to <span className="font-semibold text-white">20</span> sources
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <span className="text-brand-400 font-bold">✓</span> 15MB knowledge base
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <span className="text-brand-400 font-bold">✓</span> 3 Lakh Characters
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-300">
              <span className="text-brand-400 font-bold">✓</span> Standard Support
            </li>
          </ul>
          <button
            onClick={() => handleCheckout(isAnnual ? "pro_annual" : "pro")}
            disabled={loadingTier === (isAnnual ? "pro_annual" : "pro")}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white font-semibold rounded-xl text-sm transition-all"
          >
            {loadingTier === (isAnnual ? "pro_annual" : "pro") ? "Loading..." : "Upgrade to Pro"}
          </button>
        </div>

        {/* Growth Tier */}
        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Growth</h3>
          <p className="text-sm text-gray-500 mb-6">
            For established operations.
          </p>
          <div className="mb-6">
            <span className="text-4xl font-extrabold text-gray-900">₹{isAnnual ? PRICING.growth.annual : PRICING.growth.monthly}</span>
            <span className="text-gray-500">/mo</span>
            {isAnnual && <p className="text-xs text-gray-400 mt-1">Billed ₹{PRICING.growth.annual * 12} yearly</p>}
          </div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> <span className="font-semibold text-gray-900">{isAnnual ? PRICING.growth.messages.annual : PRICING.growth.messages.monthly}</span> message credits
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> Up to <span className="font-semibold text-gray-900">20</span> sources
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> 35MB knowledge base
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> 5 Lakh Characters
            </li>
            <li className="flex items-center gap-3 text-sm text-gray-600">
              <span className="text-brand-400 font-bold">✓</span> Priority Support
            </li>
          </ul>
          <button
            onClick={() => handleCheckout(isAnnual ? "growth_annual" : "growth")}
            disabled={loadingTier === (isAnnual ? "growth_annual" : "growth")}
            className="w-full py-3.5 px-4 bg-white border-2 border-brand-500 text-brand-600 hover:bg-brand-50 font-semibold rounded-xl text-sm transition-all"
          >
            {loadingTier === (isAnnual ? "growth_annual" : "growth") ? "Loading..." : "Upgrade to Growth"}
          </button>
        </div>
      </div>


    </div>
  );
}
