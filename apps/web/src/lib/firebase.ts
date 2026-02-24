import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Each variable is accessed statically so Vite can inline the values at build time.
// If any value is empty/undefined after building, check that GitHub Secrets names have
// NO quotes and values contain the real Firebase credentials (not placeholder text).
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

// Warn in the browser console if any config value is missing after build
if (import.meta.env.DEV || import.meta.env.MODE === 'production') {
  const bad = Object.entries(firebaseConfig).filter(([, v]) => !v || v === 'undefined')
  if (bad.length > 0) {
    console.error(
      '[MessageHub] Firebase config incompleto. Variables vacías:',
      bad.map(([k]) => k),
      '\nRevisa los Secrets de GitHub: sin comillas en nombre ni en valor.',
    )
  }
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

