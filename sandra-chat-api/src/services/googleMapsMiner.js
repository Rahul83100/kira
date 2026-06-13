const axios = require('axios');

async function mineCompetitorReviews(city, subjects) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set');
  }

  const query = `${subjects.join(' ')} coaching classes in ${city}`;
  const url = 'https://places.googleapis.com/v1/places:searchText';

  let places = [];
  try {
    const res = await axios.post(url, {
      textQuery: query
    }, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.reviews'
      }
    });
    
    places = res.data.places || [];
  } catch (err) {
    console.error('Places API (New) failed:', err.response?.data || err.message);
    return [];
  }

  const allReviews = [];
  
  for (const place of places) {
    const compName = place.displayName?.text || 'Unknown Competitor';
    const reviews = place.reviews || [];

    for (const rev of reviews) {
      allReviews.push({
        competitor_name: compName,
        reviewer_name: rev.authorAttribution?.displayName || 'Anonymous',
        review_text: rev.text?.text || '',
        rating: rev.rating || 0
      });
    }
  }

  return allReviews;
}

module.exports = { mineCompetitorReviews };
