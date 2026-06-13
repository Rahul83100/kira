import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';

// Firebase is OPTIONAL. It only powers Google sign-in in the dashboard.
// Self-hosters can ignore it entirely and use email/password auth instead.
// To enable Google sign-in, create a free Firebase project and set the
// VITE_FIREBASE_* variables in your .env — see .env.example.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app = null;
let auth = null;
let googleProvider = null;
let analytics = null;

if (firebaseEnabled) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
      analytics = getAnalytics(app);
    }
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
} else {
  console.info("Firebase not configured — Google sign-in disabled, using email/password auth.");
}

export { firebaseEnabled };

export { app, auth, googleProvider, analytics };
export default app;
