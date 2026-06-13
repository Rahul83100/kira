// leadExtractor.js
// Uses Gemini Structured Output (JSON Schema enforcement) to extract
// lead information from conversation history as a strict JSON object.

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

function extractLeadWithRegex(conversationHistory = []) {
  const recentHistory = conversationHistory.slice(-10);
  const userMessages = recentHistory
    .filter((msg) => msg.role === 'user' && typeof msg.content === 'string')
    .map((msg) => msg.content)
    .join('\n');
  const allText = recentHistory
    .map((msg) => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content || ''}`)
    .join('\n');

  const emailMatch = userMessages.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = userMessages.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  const introNameMatch = userMessages.match(/\b(?:my name is|i am|i'm|this is|call me)\s+([A-Za-z][A-Za-z\s]{1,40})/i);

  let inferredName = introNameMatch ? introNameMatch[1].trim() : null;
  if (!inferredName) {
    const latestUser = [...recentHistory]
      .reverse()
      .find((msg) => msg.role === 'user' && typeof msg.content === 'string');
    if (latestUser) {
      const firstChunk = latestUser.content.split(',')[0]?.trim();
      if (firstChunk && /^[A-Za-z][A-Za-z\s]{1,40}$/.test(firstChunk)) {
        inferredName = firstChunk;
      }
    }
  }

  const interestMatch = userMessages.match(/\b(?:need|looking for|interested in|help with|want)\s+([^.!\n,]{3,80})/i);
  const serviceInterest = interestMatch ? interestMatch[1].trim() : null;
  const hasContact = !!(emailMatch || phoneMatch || inferredName);
  const priority = (emailMatch || phoneMatch) && serviceInterest ? 'high' : hasContact ? 'medium' : 'low';

  if (!hasContact) return null;

  return {
    name: inferredName || null,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    serviceInterest: serviceInterest || null,
    priority,
  };
}

// JSON Schema for lead extraction — Gemini MUST output this exact structure
const leadSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: {
      type: SchemaType.STRING,
      description: 'Full name of the customer. null if not provided.',
      nullable: true
    },
    email: {
      type: SchemaType.STRING,
      description: 'Email address if provided. null if not mentioned.',
      nullable: true
    },
    phone: {
      type: SchemaType.STRING,
      description: 'Phone number if provided. null if not mentioned.',
      nullable: true
    },
    serviceInterest: {
      type: SchemaType.STRING,
      description: 'Service, product or topic the customer expressed interest in. null if not mentioned.',
      nullable: true
    },
    priority: {
      type: SchemaType.STRING,
      description: 'Lead priority based on engagement: high (shared contact info + specific interest), medium (shared some info), low (general enquiry only)',
      enum: ['high', 'medium', 'low']
    }
  },
  required: ['priority']
};

/**
 * Extract lead information from conversation history using Gemini Structured Output.
 * Returns a validated lead object or null if no extractable contact info found.
 *
 * @param {Array<{role: string, content: string}>} conversationHistory - Recent messages
 * @returns {Promise<{name: string|null, email: string|null, phone: string|null, serviceInterest: string|null, priority: string}|null>}
 */
async function extractLeadFromConversation(conversationHistory) {
  if (!genAI) {
    console.warn('⚠️ LeadExtractor: No GEMINI_API_KEY — using regex fallback.');
    return extractLeadWithRegex(conversationHistory);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: leadSchema
      }
    });

    // Use only the last 6 messages for context (keeps the call cheap)
    const recentHistory = conversationHistory.slice(-6);
    const conversationText = recentHistory
      .map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`)
      .join('\n');

    const extractionPrompt = `You are a lead extraction assistant. Analyse the following support conversation and extract any contact information the user has shared.

CONVERSATION:
${conversationText}

INSTRUCTIONS:
- Extract name, email, phone number, and service/product interest if mentioned
- Set fields to null if the user did not provide that information
- Set priority to "high" if the user shared phone or email AND mentioned a specific service or interest
- Set priority to "medium" if the user shared at least one piece of contact info
- Set priority to "low" if the user only asked general questions without sharing contact details
- Return ONLY the JSON object, nothing else`;

    const result = await model.generateContent(extractionPrompt);
    const responseText = result.response.text();
    const leadData = JSON.parse(responseText);

    // Validate: at least name or phone must exist for a meaningful lead
    if (!leadData.name && !leadData.phone && !leadData.email) {
      return extractLeadWithRegex(conversationHistory);
    }

    console.log('✅ LeadExtractor: Extracted lead →', JSON.stringify(leadData));
    return leadData;

  } catch (err) {
    console.error('⚠️ LeadExtractor failed:', err.message);
    return extractLeadWithRegex(conversationHistory);
  }
}

/**
 * Detect if a user message contains contact information patterns.
 * Used as a lightweight pre-check before triggering the full Gemini extraction.
 *
 * @param {string} message - The user's raw message
 * @returns {boolean}
 */
function containsContactInfo(message) {
  // Phone number patterns (Indian + international)
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
  // Email pattern
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  // Name introduction or inquiry patterns
  const namePatterns = /\b(my name is|i am|i'm|call me|this is|your name|what is your name)\b/i;
  // Keywords that suggest contact info exchange
  const keywords = /\b(email|phone|number|contact|whatsapp|mobile)\b/i;

  return phoneRegex.test(message) || emailRegex.test(message) || namePatterns.test(message) || keywords.test(message);
}

module.exports = { extractLeadFromConversation, containsContactInfo };
