const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

function buildSystemPrompt(companyName, chunks, languageInstruction) {
  return `You are a helpful customer support agent for ${companyName}.

IMPORTANT RULES:
- Answer ONLY using the context provided below.
- If the answer is not in the context, say exactly: "I don't have information about that. Let me connect you with a human agent."
- Never make up information.
- ${languageInstruction}

KNOWLEDGE BASE CONTEXT:
${chunks.join('\n\n---\n\n')}`;
}

async function callClaude(systemPrompt, conversationHistory, newMessage) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  No ANTHROPIC_API_KEY found. Using mock response.');
    return `[Mock Reply] This is a simulated response for "${newMessage}". The Chat API is working correctly without a real LLM connection.`;
  }

  const messages = [
    ...conversationHistory,
    { role: 'user', content: newMessage }
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20240620', // updated to latest model name if needed
      max_tokens: 500,
      system: systemPrompt,
      messages,
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API Error, falling back to mock:', err.message);
    return `[Mock Fallback] I encountered an error connecting to Claude, but I'm still running!`;
  }
}

function detectEscalation(reply) {
  const escalationPhrases = [
    'connect you with a human',
    'human agent',
    "don't have information",
    'I cannot help with',
  ];
  return escalationPhrases.some(p => reply.toLowerCase().includes(p.toLowerCase()));
}

module.exports = { buildSystemPrompt, callClaude, detectEscalation };
