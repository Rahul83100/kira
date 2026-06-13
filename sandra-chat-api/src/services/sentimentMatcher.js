const { analyzeSentiment } = require('./sentimentService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function scoreAndMatchLeads(competitorReviews, businessProfile) {
  // 1. Filter out positive or neutral reviews (we only want complaints).
  const negativeReviews = competitorReviews.filter(rev => {
    if (!rev.review_text) return false;
    const sentiment = analyzeSentiment(rev.review_text);
    return sentiment.score <= -1; 
  });

  if (negativeReviews.length === 0 || !genAI) {
    return [];
  }

  // 2. Identify matches using Gemini
  const systemInstruction = `You are an AI sales SDR for an educational institute.
Your job is to read competitor reviews and cross-reference them with the institute's profile.
Find reviews where the complaint directly maps to one of our selling points.
For example, if the review says "expensive" and our profile says "low fees", that's a match.

Institute Profile:
${JSON.stringify(businessProfile, null, 2)}

Competitor Reviews (JSON format):
${JSON.stringify(negativeReviews.map((r, i) => ({ id: i, text: r.review_text })), null, 2)}

Return a valid JSON array of matched reviews. For each match, provide:
- "id": The id of the review from the list.
- "match_score": A number out of 100 on how good the lead is.
- "complaint_type": A short summary of the complaint (e.g. "large batch size").
- "outreach_angle": A short suggested message to pitch our institute based on their pain point.

Do not include markdown tags (\`\`\`json). Return raw JSON array.`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction
    });

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: "Process reviews and return JSON array." }] }]
    });

    const responseText = response.response.text().replace(/^```json/g, '').replace(/```$/g, '').trim();
    const rawMatches = JSON.parse(responseText);

    const scoredLeads = [];
    for (const match of rawMatches) {
      const originalReview = negativeReviews[match.id];
      if (originalReview) {
        scoredLeads.push({
          competitor_name: originalReview.competitor_name,
          reviewer_name: originalReview.reviewer_name,
          review_text: originalReview.review_text,
          rating: originalReview.rating,
          complaint_type: match.complaint_type,
          match_score: Math.min(100, Math.max(0, parseInt(match.match_score) || 0)),
          outreach_angle: match.outreach_angle
        });
      }
    }

    // Sort by match_score descending
    return scoredLeads.sort((a, b) => b.match_score - a.match_score);
  } catch (err) {
    console.error('Failed to match semantic sentiments with Gemini:', err.message);
    return []; // Proceed with empty matched leads on failure
  }
}

module.exports = { scoreAndMatchLeads };
