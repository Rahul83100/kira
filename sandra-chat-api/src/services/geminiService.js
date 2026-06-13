const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  buildDynamicSystemPrompt,
  detectEscalation: detectEscalationFromManager,
  ensureManifest
} = require('./promptManager');

// Initialize Gemini Client
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

/**
 * Build system prompt — delegates to promptManager for versioned prompts
 * Signature: buildSystemPrompt(sessionId, companyName, chunks, languageInstruction, toneInstruction, customPrompt)
 */
function buildSystemPrompt(sessionId, companyName, chunks, languageInstruction, toneInstruction, customPrompt, businessPhone, businessEmail) {
  const basePrompt = buildDynamicSystemPrompt(sessionId, companyName, chunks, languageInstruction, toneInstruction);
  
  const leadGenMission = `
# CORE MISSION: CUSTOMER SUPPORT & PROACTIVE LEAD GENERATION
- You are a professional Customer Support Agent for the business.
- Your ULTIMATE GOAL is to collect the user's Full Name, Email Address, and Phone Number.
- If any of these are missing from the conversation history, you MUST answer the user's question first and then IMMEDIATELY ask for the missing info.
- Be proactive. Transition naturally: "I'd love to assist you further with that. Could you please share your name and email so I can send you a formal quote/details?"
- If they share one detail, ask for the others in the next turn.
  `.trim();

  const defaultLeadPrompt = `
CRITICAL OPERATIONAL RULE: PROACTIVE LEAD COLLECTION
- Always ask for missing contact info (Name, Email, Phone) in your next response.
- Do not be passive. Be a proactive lead generator.
  `.trim();

  // STRUCTURE: Mission (Top) -> Base -> Custom -> Rule (Bottom)
  let finalPrompt = `${leadGenMission}\n\n${basePrompt}`;

  if (customPrompt) {
    finalPrompt += `\n\nBUSINESS OWNER CUSTOM BEHAVIORAL INSTRUCTIONS (SPECIFIC RULES & TONE):\n${customPrompt}`;
  }

  // Inject business contact details so the LLM can share them when escalating
  if (businessPhone || businessEmail) {
    finalPrompt += `\n\nBUSINESS CONTACT DETAILS (share these when you cannot help or when the user asks for direct contact):`;
    if (businessPhone) finalPrompt += `\n- Phone: ${businessPhone}`;
    if (businessEmail) finalPrompt += `\n- Email: ${businessEmail}`;
  }

  // Final reinforcement
  finalPrompt += `\n\nOPERATIONAL RULE: ${defaultLeadPrompt}`;

  // Keep replies concise to reduce token usage while remaining useful.
  finalPrompt += `\n\nRESPONSE LENGTH CONSTRAINT:
- Keep answers short and practical: 1-2 sentences by default.
- Only use 3-4 short sentences when the user explicitly asks for detail.
- Avoid long introductions, repeated reassurance, and extra filler.
- Ask for only ONE missing lead field per turn after answering the question.`;

  return finalPrompt;
}

/**
 * Normalizes history for Gemini SDK requirements
 */
function formatGeminiHistory(history) {
  return history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));
}

/**
 * Call Gemini (Non-streaming) with fallback models
 */
async function callGemini(systemPrompt, conversationHistory, newMessage) {
  if (!genAI) throw new Error('Gemini API Key missing');

  // List of models to try in order of preference
  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt
      });

      const chat = model.startChat({
        history: formatGeminiHistory(conversationHistory)
      });

      const result = await chat.sendMessage(newMessage);
      return result.response.text();

    } catch (err) {
      console.warn(`⚠️ Gemini model ${modelName} failed:`, err.message);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
        console.error('🛑 Gemini Final Fallback Failure:', err.message);
        return "I'm having a little trouble connecting right now, but I would still love to help! Could you please try again in a moment?";
      }
      continue;
    }
  }
}

/**
 * Streaming version of callGemini
 */
async function* callGeminiStream(systemPrompt, conversationHistory, newMessage) {
  if (!genAI) {
    yield "[Error] No API Key configured.";
    return;
  }

  const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt
      });

      const chat = model.startChat({
        history: formatGeminiHistory(conversationHistory)
      });

      const result = await chat.sendMessageStream(newMessage);
      for await (const chunk of result.stream) {
        if (chunk.text()) yield chunk.text();
      }
      return;

    } catch (err) {
      console.warn(`⚠️ Gemini Streaming model ${modelName} failed:`, err.message);
      if (modelName === modelsToTry[modelsToTry.length - 1]) {
        console.error('🛑 Gemini Streaming Final Fallback Failure:', err.message);
        yield "I'm having a little trouble connecting right now, but I'm still here to help! Please try again or leave your name and number.";
      }
      continue;
    }
  }
}

/**
 * Detect escalation — delegates to promptManager for per-version phrases
 */
function detectEscalation(reply, sessionId) {
  return detectEscalationFromManager(reply, sessionId);
}

module.exports = { 
  buildSystemPrompt, 
  callGemini, 
  callGeminiStream, 
  detectEscalation, 
  ensureManifest 
};
