// Detect language of incoming message
// Use Unicode ranges for Indian scripts

function detectLanguage(text) {
  if (/[\u0900-\u097F]/.test(text)) return { code: 'hi', name: 'Hindi', instruction: 'Reply in Hindi (Devanagari script).' };
  if (/[\u0B80-\u0BFF]/.test(text)) return { code: 'ta', name: 'Tamil', instruction: 'Reply in Tamil script.' };
  if (/[\u0C80-\u0CFF]/.test(text)) return { code: 'kn', name: 'Kannada', instruction: 'Reply in Kannada script.' };
  if (/[\u0C00-\u0C7F]/.test(text)) return { code: 'te', name: 'Telugu', instruction: 'Reply in Telugu script.' };
  if (/[\u0A00-\u0A7F]/.test(text)) return { code: 'pa', name: 'Punjabi', instruction: 'Reply in Punjabi (Gurmukhi script).' };
  if (/[\u0600-\u06FF]/.test(text)) return { code: 'ur', name: 'Urdu', instruction: 'Reply in Urdu script.' };
  // Default: English
  return { code: 'en', name: 'English', instruction: 'Reply in English.' };
}

module.exports = { detectLanguage };
