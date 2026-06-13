const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Clients
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

/**
 * Unified LLM Service with Fallback Logic
 */
async function* callLLMStream(systemPrompt, history, newMessage) {
  // 1. Try Gemini

  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: systemPrompt,
        generationConfig: {
          maxOutputTokens: 250,
          temperature: 0.2,
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      const chat = model.startChat({
        history: history.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      });

      const result = await chat.sendMessageStream(newMessage);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
      return;
    } catch (err) {
      console.error(`LLM Stream: Gemini failed:`, err.message);
    }
  }

  // 2. Final Smart Fallback (No-API / No-DB Mode)
  const response = generateSmartFallback(systemPrompt, newMessage, history);
  yield* smartFallbackStream(response);
}

/**
 * Non-streaming version
 */
async function callLLM(systemPrompt, history, newMessage) {
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt, generationConfig: { maxOutputTokens: 250, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } } });
      const chat = model.startChat({
        history: history.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      });
      const result = await chat.sendMessage(newMessage);
      return result.response.text();
    } catch (err) {
      console.error(`LLM JSON: Gemini failed:`, err.message);
    }
  }

  return generateSmartFallback(systemPrompt, newMessage, history);
}

/**
 * Smart KIRA Brain — Professional, Persona-driven fallback AI.
 * Used when ALL external AI APIs (Gemini/OpenAI) are offline or rate-limited.
 *
 * PRIORITY ORDER (most specific first):
 *   1. Hardcoded KIRA knowledge (greetings, support, identity, booking…)
 *   2. Database document search (only for unknown document-specific questions)
 *   3. Default warm engagement response
 */
function generateSmartFallback(systemPrompt, userQuery, history = []) {
  const query = userQuery.toLowerCase();
  const words = query.split(/\s+/).map(w => w.replace(/[!?.]/g, ''));

  // Utility: every keyword must be present
  const T = (keys) => keys.every(k => query.includes(k));

  // Helper: Check if we already have lead info in history
  const historyText = (history || []).map(h => h.content.toLowerCase()).join(' ');
  const hasPhone = /(\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(historyText);
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(historyText);
  const hasName = /\b(my name is|i am|i'm|call me|this is)\b/i.test(historyText);
  
  const needsInfo = !hasPhone || !hasEmail || !hasName;
  const alreadyContactTopic = /\b(contact|email|phone|number|reach|callback|call)\b/i.test(query);
  const leadHook = needsInfo && !alreadyContactTopic
    ? " Please share your name and phone number so our team can follow up."
    : "";

  // ─────────────────────────────────────────────
  // STEP 1: Hardcoded KIRA Knowledge (ALWAYS first)
  // ─────────────────────────────────────────────

  // Greetings / Identity intro
  const greetings = ['hello', 'hi', 'hey', 'greetings', 'zahra', 'zara', 'kira'];
  const isGreeting = words.length <= 3 && words.some(w => greetings.includes(w));
  if (isGreeting) {
    if (/[\u0900-\u097F]/.test(query)) return "नमस्ते! मैं किरा हूँ, आपकी AI सहायक। मैं आपके सवालों के जवाब देने में आपकी मदद कर सकती हूँ। आज मैं आपकी क्या सेवा कर सकती हूँ?" + leadHook;
    return "Hello! I'm Kira, your AI Support Assistant. I'm here to help answer your questions and guide you through our services. How can I assist you today?" + leadHook;
  }

  // Thank you
  if (words.some(w => ['thanks', 'thank'].includes(w))) {
    return "You're very welcome! I'm happy I could help. Please let me know if you have any other questions!" + leadHook;
  }

  // Identity — who are you / what do you do
  if (T(['kira']) || (T(['who']) && T(['you'])) || (T(['what']) && T(['do']) && T(['you']))) {
    return "I am Kira, an intelligent AI dedicated to providing 24/7 support and guidance. I'm here to ensure you have all the information you need to make the right choice!" + leadHook;
  }

  // Booking / Scheduling / Demo
  if (T(['book']) || T(['schedule']) || T(['appointment']) || T(['slot']) || T(['demo']) || T(['call'])) {
    return "I would be delighted to help you schedule a call with our team! To get started, could you please share your name and phone number? We'll reach out to find a slot that works perfectly for you." + leadHook;
  }

  // Onboarding / Process / Steps
  if (T(['onboarding']) || T(['setup']) || T(['implementation']) || T(['apply']) || T(['enroll']) || T(['enrollment']) || T(['cutoff']) ||
      (T(['process']) && !T(['array'])) || (T(['step']) && !T(['array']))) {
    return "Our process is simple and transparent. We begin with your requirements, then align on scope, then move into implementation planning. Would you like to share your contact details so our team can guide you?" + leadHook;
  }

  // Fees / Cost / Price / Payment
  if (T(['fee']) || T(['fees']) || T(['cost']) || T(['price']) || T(['payment']) || T(['scholarship'])) {
    return "Our pricing structure is designed to be accessible! We offer flexible payment options to suit your needs. Could you share your name and contact number so our team can walk you through a personalized plan?" + leadHook;
  }

  // Duration / Course length
  if (T(['duration']) || T(['long']) || T(['months']) || T(['weeks']) || T(['years'])) {
    return "Our services are available in various formats to suit different goals. Could you let me know which specific area you're interested in, so I can give you more details on timing?" + leadHook;
  }

  // Certificate / Degree / Placement
  if (T(['certificate']) || T(['degree']) || T(['placement']) || T(['job']) || T(['career'])) {
    return "We provide professional services focused on outcomes and quality. Would you like to know more about our track record or specific service results?" + leadHook;
  }

  // Eligibility / Qualification / Criteria
  if (T(['eligib']) || T(['qualif']) || T(['criteria']) || T(['requir']) || T(['minimum'])) {
    return "Criteria vary depending on the service, but we welcome all inquiries. Our team can guide you based on your specific needs. Could you share your current requirements so I can give you accurate details?" + leadHook;
  }

  // Contact Info
  if (T(['contact']) || T(['reach']) || T(['email']) || T(['phone']) || T(['number']) || T(['support'])) {
    return "You can reach our team directly through our website or leave your contact details here and we'll get back to you promptly. Could you share your name and preferred callback number?" + leadHook;
  }

  // Vague follow-ups (yes, tell me more, etc.) — answer from db if chunks are there
  const VAGUE = /^(yes|yeah|yep|yea|sure|ok|okay|go on|go ahead|tell me more|more|continue|please|details|explain|elaborate)$/i;

  // ─────────────────────────────────────────────
  // STEP 2: Database Document Search
  // Only used for specific factual questions not covered above (e.g., "internship letter", "array types")
  // ─────────────────────────────────────────────
  const knowledgeMatch = systemPrompt.match(/KNOWLEDGE BASE:([\s\S]*)/i) ||
                         systemPrompt.match(/Context Information:([\s\S]*?)###/i) ||
                         systemPrompt.match(/Context chunks:([\s\S]*)/i);

  if (knowledgeMatch && knowledgeMatch[1] && !knowledgeMatch[1].includes('No specific information')) {
    const rawKnowledge = knowledgeMatch[1].trim();
    const chunksArray = rawKnowledge.split(/\n\n---\n\n/).filter(c => c.trim().length > 15);

    // Vague follow-up: just return the first chunk
    if (VAGUE.test(userQuery.trim()) && chunksArray.length > 0) {
      let ctx = chunksArray[0].replace(/^[\s\-\*#]+|[\s\-\*#]+$/g, '').replace(/\s+/g, ' ').trim();
      if (ctx.length > 200) ctx = ctx.substring(0, 197) + '...';
      if (!/[.!?]$/.test(ctx)) ctx += '.';
      const lc = ctx.charAt(0).toLowerCase() + ctx.slice(1);
      return `Sure. To give you more context: ${lc} Would you like to hear more?` + leadHook;
    }

    // Topic search: find the chunk that has the most descriptive substance
    let bestChunk = null;
    let bestScore = -1;
    
    chunksArray.forEach((chunk, index) => {
      const lowerChunk = chunk.toLowerCase();
      let score = words.filter(w => w.length > 3 && lowerChunk.includes(w.toLowerCase())).length;
      
      // Bonus: Early chunks in a document are usually the most descriptive (Introduction)
      if (index === 0) score += 0.5;
      if (index === 1) score += 0.2;
      
      // Bonus: Descriptive markers
      if (/\b(is|includes|contains|provides|offers|policy|guideline|stipend)\b/i.test(lowerChunk)) score += 0.4;
      
      // Penalty: Sign-off fragments (prevents grabbing the footer/email)
      if (/\b(regards|sincerely|thank you|founder|coo|ceo|gmail\.com|@)\b/i.test(lowerChunk)) score -= 0.6;

      if (score > bestScore) {
        bestScore = score;
        bestChunk = chunk;
      }
    });

    // Only use the database if we have a valid match
    if (bestChunk && bestScore >= 1.5) {
      let cleaned = bestChunk.replace(/^[\s\-\*#]+|[\s\-\*#]+$/g, '').replace(/\s+/g, ' ').trim();

      // HEURISTIC CLEANING: Remove signatures, emails, and footer noise
      cleaned = cleaned.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, ''); // Aggressive email remove
      cleaned = cleaned.replace(/(Best of Luck|Regards|Sincerely|Thank You)[!.,\s]+.*$/gi, ''); // Aggressive sign-off remove
      cleaned = cleaned.replace(/(Founder|COO|CEO|Manager|Director|Site2success)[!.,\s:\-]+.*$/gi, ''); // Aggressive title/name remove
      cleaned = cleaned.trim().replace(/[,.\s\-]+$/, '.'); // Clean trailing punctuation

      // Fragment protection: skip leading lowercase fragment before first capital sentence
      const firstCapital = cleaned.search(/[A-Z]/);
      if (firstCapital > 0 && firstCapital < 50) {
        const fragment = cleaned.substring(0, firstCapital);
        if (fragment.includes('.') || fragment.includes('!') || fragment.includes('?')) {
          cleaned = cleaned.substring(firstCapital);
        }
      }

      // Graceful truncation (max 450 chars)
      if (cleaned.length > 450) {
        const truncated = cleaned.substring(0, 447);
        const lastPunc = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
        cleaned = lastPunc > 300 ? truncated.substring(0, lastPunc + 1) : truncated.substring(0, truncated.lastIndexOf(' ')) + '...';
      } else if (!/[.!?]$/.test(cleaned) && cleaned.length > 5) {
        cleaned += '.';
      }

      let introPhrase = cleaned;
      if (cleaned.length > 0 && !/^(I|Kira|We|The|This)\b/.test(cleaned)) {
        introPhrase = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
      }

      const wrappers = [
        `Certainly! Here's what I found: ${cleaned}${leadHook}`,
        `I can help with that: ${cleaned}${leadHook}`,
        `Based on our records, ${introPhrase}${leadHook}`,
        `Here's some relevant information: ${cleaned}${leadHook}`
      ];
      return wrappers[Math.floor(Math.random() * wrappers.length)];
    }
  }

  // ─────────────────────────────────────────────
  // STEP 3: Default warm engagement (last resort)
  // ─────────────────────────────────────────────
  const defaultResponses = [
    "I'm Kira, and I'd love to help you with that! Could you tell me a bit more so I can provide the most accurate information regarding our services or platform?" + leadHook,
    "That's a great question. While I'm looking into the specifics, feel free to share your interests and I can connect you with the right specialist from our team!" + leadHook,
    "I'm here to guide you through everything from general questions to technical support. What specific details can I help you find right now?" + leadHook
  ];

  return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

async function* smartFallbackStream(response) {
  const words = response.split(' ');
  for (const word of words) {
    yield word + ' ';
    await new Promise(r => setTimeout(r, 25)); // Slight delay for natural feel
  }
}


module.exports = { callLLMStream, callLLM, generateSmartFallback };
