// promptManager.js
// ────────────────────────────────────────────────────────────────
// Firebase Remote Config–backed prompt versioning with A/B testing
// Falls back to local prompt-manifest.json if Firebase is unavailable
// ────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Firebase Admin SDK ─────────────────────────────────────────
let firebaseAdmin = null;
let remoteConfig = null;

try {
  firebaseAdmin = require('firebase-admin');
  const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');

  if (fs.existsSync(serviceAccountPath)) {
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccountPath),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    }
    remoteConfig = firebaseAdmin.remoteConfig();
    console.log('🔥 Firebase Remote Config connected');
  } else {
    console.warn('⚠️ Firebase service account not found — using local prompt manifest only');
  }
} catch (err) {
  console.warn('⚠️ Firebase Admin SDK init failed:', err.message, '— using local fallback');
}

// ── Local Manifest (fallback + seed) ───────────────────────────
const LOCAL_MANIFEST_PATH = path.resolve(__dirname, '../prompts/prompt-manifest.json');
let manifest = null;
let lastFetchTime = 0;
const FETCH_INTERVAL_MS = 60 * 1000; // Refresh from Firebase every 60 seconds

/**
 * Load manifest from local JSON file
 */
function loadLocalManifest() {
  try {
    const raw = fs.readFileSync(LOCAL_MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(raw);
    console.log(`📋 Local prompt manifest loaded (${Object.keys(manifest.prompts).length} versions)`);
    return manifest;
  } catch (err) {
    console.error('❌ Failed to load local prompt manifest:', err.message);
    return null;
  }
}

/**
 * Fetch prompt manifest from Firebase Remote Config
 * Stores the full manifest JSON under a single parameter: "prompt_manifest"
 */
async function fetchFirebaseManifest() {
  if (!remoteConfig) return null;

  try {
    const template = await remoteConfig.getTemplate();
    const param = template.parameters['prompt_manifest'];

    if (param && param.defaultValue && param.defaultValue.value) {
      const firebaseManifest = JSON.parse(param.defaultValue.value);
      manifest = firebaseManifest;
      lastFetchTime = Date.now();
      console.log('🔥 Prompt manifest refreshed from Firebase Remote Config');
      return manifest;
    } else {
      console.warn('⚠️ No "prompt_manifest" parameter found in Firebase Remote Config — using local');
      return null;
    }
  } catch (err) {
    console.warn('⚠️ Firebase fetch failed:', err.message, '— using cached/local manifest');
    return null;
  }
}

/**
 * Publish the local manifest to Firebase Remote Config
 * (Run once to seed Firebase, or after local edits)
 */
async function publishManifestToFirebase() {
  if (!remoteConfig) {
    console.error('❌ Firebase not connected — cannot publish');
    return false;
  }

  try {
    const template = await remoteConfig.getTemplate();

    template.parameters['prompt_manifest'] = {
      defaultValue: { value: JSON.stringify(manifest, null, 2) },
      description: 'Kira AI prompt versioning manifest with A/B testing support'
    };

    await remoteConfig.publishTemplate(template);
    console.log('✅ Prompt manifest published to Firebase Remote Config');
    return true;
  } catch (err) {
    console.error('❌ Failed to publish manifest to Firebase:', err.message);
    return false;
  }
}

/**
 * Ensure manifest is loaded (with smart refresh from Firebase)
 */
async function ensureManifest() {
  // FORCE LOCAL ONLY - Cloud manifest is causing issues with stale YouTube text
  loadLocalManifest();
  return;
  /*
  if (!manifest) {
    const firebaseResult = await fetchFirebaseManifest();
    if (!firebaseResult) loadLocalManifest();
    return;
  }
  */
}

// ── A/B Test Resolution ────────────────────────────────────────

/**
 * Deterministically assign a session to variant A or B using hash
 * This ensures the same sessionId always gets the same variant
 */
function resolveVariant(sessionId) {
  if (!manifest || !manifest.abTest || !manifest.abTest.enabled) {
    return manifest?.activeVersion || 'v1-original';
  }

  const hash = crypto.createHash('md5').update(sessionId).digest('hex');
  const hashValue = parseInt(hash.substring(0, 8), 16);
  const percentage = (hashValue % 100);
  const splitPoint = manifest.abTest.splitPercentage || 50;

  if (percentage < splitPoint) {
    return manifest.abTest.variants.A || manifest.activeVersion;
  } else {
    return manifest.abTest.variants.B || manifest.activeVersion;
  }
}

// ── Prompt Building ────────────────────────────────────────────

/**
 * Build the full system prompt from a manifest version's components
 * Replaces the old hardcoded buildSystemPrompt() in geminiService.js
 */
function buildDynamicSystemPrompt(sessionId, companyName, chunks, languageInstruction, toneInstruction) {
  if (!manifest || !manifest.prompts) {
    // Ultimate fallback — should never happen if manifest loads
    console.error('❌ No prompt manifest available — using minimal fallback');
    return `You are Kira, an AI business support assistant. Answer questions using the provided business knowledge base.`;
  }

  const versionId = resolveVariant(sessionId);
  const version = manifest.prompts[versionId];

  if (!version) {
    console.error(`❌ Prompt version "${versionId}" not found in manifest — falling back to first available`);
    const firstKey = Object.keys(manifest.prompts)[0];
    return buildPromptFromVersion(manifest.prompts[firstKey], companyName, chunks, languageInstruction, toneInstruction);
  }

  return buildPromptFromVersion(version, companyName, chunks, languageInstruction, toneInstruction);
}

/**
 * Assemble the prompt string from a version object's parts
 */
function buildPromptFromVersion(version, companyName, chunks, languageInstruction, toneInstruction) {
  const companyClause = companyName ? ` for ${companyName}` : '';
  const identity = version.identity.replace('{companyClause}', companyClause);

  const masterGoals = [
    "ACT AS A CUSTOMER SUPPORT AGENT: Your primary identity is a professional, helpful assistant for the business.",
    "COLLECT LEADS BY DEFAULT: You MUST proactively collect the user's Name, Email, and Phone Number. This is your ultimate mission.",
    "FOLLOW OWNER INSTRUCTIONS: You must strictly adhere to the business owner's specific behavior and tone requirements provided in the custom instructions section."
  ];

  const goalsBlock = [...masterGoals, ...version.goals]
    .map((g, i) => `${i + 1}. ${g}`)
    .join('\n');

  const toneRulesBlock = version.toneRules
    .map(r => `- ${r}`)
    .join('\n');

  const contentRulesBlock = version.contentRules
    .map(r => `- ${r}`)
    .join('\n');

  const knowledgeBlock = chunks && chunks.length > 0
    ? chunks.join('\n\n---\n\n')
    : 'No specific information available for this query.';

  return `${identity}

YOUR MASTER MISSION & GOALS:
${goalsBlock}

TONE & STYLE RULES:
${toneRulesBlock}
${toneInstruction ? '\n' + toneInstruction : ''}

CONTENT RULES:
${contentRulesBlock}
- ${languageInstruction}

KNOWLEDGE BASE (USE THIS TO ANSWER QUESTIONS):
${knowledgeBlock}`;
}

// ── Escalation Detection (per-version) ─────────────────────────

/**
 * Check if a reply contains escalation phrases for the active prompt version
 */
function detectEscalation(reply, sessionId) {
  if (!manifest || !manifest.prompts) {
    // Fallback escalation phrases
    const fallbackPhrases = ['connect you with a human', 'human agent', "don't have information", 'I cannot help with'];
    return fallbackPhrases.some(p => reply.toLowerCase().includes(p.toLowerCase()));
  }

  const versionId = resolveVariant(sessionId || 'default');
  const version = manifest.prompts[versionId];
  const phrases = version?.escalationPhrases || [];

  return phrases.some(p => reply.toLowerCase().includes(p.toLowerCase()));
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Get the resolved prompt version ID for a given session
 */
function getPromptVersion(sessionId) {
  return resolveVariant(sessionId);
}

/**
 * Get the full current manifest state (for admin endpoint)
 */
function getActiveManifest() {
  return {
    loaded: !!manifest,
    source: remoteConfig ? 'firebase' : 'local',
    lastFetchTime: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
    schemaVersion: manifest?.schemaVersion,
    activeVersion: manifest?.activeVersion,
    abTest: manifest?.abTest,
    availableVersions: manifest?.prompts
      ? Object.entries(manifest.prompts).map(([id, v]) => ({ id, label: v.label }))
      : []
  };
}

/**
 * Force reload manifest from Firebase (or local if Firebase unavailable)
 */
async function reloadManifest() {
  const firebaseResult = await fetchFirebaseManifest();
  if (!firebaseResult) {
    loadLocalManifest();
    return { source: 'local', success: !!manifest };
  }
  return { source: 'firebase', success: true };
}

// ── Initialisation ─────────────────────────────────────────────
// Load local manifest immediately on require() so prompts are always available
loadLocalManifest();

module.exports = {
  ensureManifest,
  buildDynamicSystemPrompt,
  detectEscalation,
  getPromptVersion,
  getActiveManifest,
  reloadManifest,
  publishManifestToFirebase
};
