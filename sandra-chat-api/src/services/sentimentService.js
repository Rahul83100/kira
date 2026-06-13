// sentimentService.js
// Lightweight sentiment analysis using AFINN-165 wordlist
// Runs BEFORE the Gemini call to inject adaptive tone instructions

const Sentiment = require('sentiment');
const sentiment = new Sentiment();

/**
 * Analyse user message sentiment and return a tone instruction
 * to be injected into the Gemini system prompt.
 *
 * @param {string} message - The user's raw message text
 * @returns {{ score: number, comparative: number, toneInstruction: string }}
 */
function analyzeSentiment(message) {
  const result = sentiment.analyze(message);

  let toneInstruction = '';

  if (result.score <= -3) {
    // Strongly negative — user is frustrated or upset
    toneInstruction = '[TONE: STRICTLY APOLOGETIC — The user seems upset or frustrated. Respond with genuine empathy, acknowledge their concern, and offer immediate assistance to resolve their issue.]';
  } else if (result.score >= -2 && result.score <= -1) {
    // Mildly negative — user has concerns or doubts
    toneInstruction = '[TONE: EMPATHETIC — The user may have concerns or uncertainties. Be extra reassuring, patient, and supportive in your response.]';
  } else if (result.score >= 1 && result.score <= 3) {
    // Mildly positive — user sounds interested or hopeful
    toneInstruction = '[TONE: ENCOURAGING — The user sounds positive and interested. Match their energy professionally and reinforce their enthusiasm.]';
  } else if (result.score >= 4) {
    // Strongly positive — user is excited
    toneInstruction = '[TONE: CELEBRATORY — The user is very excited and enthusiastic. Reinforce their positive feelings about working with the business while maintaining professionalism.]';
  }
  // score === 0 → neutral, no tone instruction needed

  return {
    score: result.score,
    comparative: result.comparative,
    toneInstruction
  };
}

module.exports = { analyzeSentiment };
