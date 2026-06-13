const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

/**
 * Transcribe an audio/video file using Google Gemini API.
 * 
 * @param {string} filePath - Absolute path to the local media file
 * @returns {Promise<string>} The transcribed text
 */
async function transcribeAudio(filePath) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing from environment variables');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  console.log(`🎤 Starting audio transcription via Gemini for file: ${filePath}`);

  try {
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = 'audio/mp3';
    if (ext === '.wav') mimeType = 'audio/wav';
    else if (ext === '.m4a') mimeType = 'audio/mp4'; // Gemini treats m4a as audio/mp4
    else if (ext === '.ogg') mimeType = 'audio/ogg';
    else if (ext === '.mp4') mimeType = 'video/mp4';

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Please transcribe the following audio/video exactly as spoken. Return only the transcription text.' },
            { 
              inlineData: {
                 data: fs.readFileSync(filePath).toString('base64'),
                 mimeType: mimeType
              }
            }
          ]
        }
      ]
    });

    const transcriptionText = response.text;
    console.log(`🎤 Transcription complete! Length: ${transcriptionText.length} chars`);
    return transcriptionText;
  } catch (error) {
    console.error('API Error during transcription:', error);
    throw new Error(`Speech-to-text transcription failed: ${error.message}`);
  }
}

module.exports = { transcribeAudio };
