import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

const env = import.meta.env

// Check for missing or placeholder config values
const missing = REQUIRED_KEYS.filter((key) => {
  const val = env[key]
  return !val || val === 'undefined' || val.startsWith('"') || val.endsWith('"')
})

if (missing.length > 0) {
  const msg =
    `[MessageHub] Firebase no está configurado correctamente.\n` +
    `Variables faltantes o con formato incorrecto: ${missing.join(', ')}\n\n` +
    `Asegúrate de que los secretos en GitHub NO tengan comillas ni en el nombre ni en el valor.\n` +
    `Ejemplo correcto — Nombre: VITE_FIREBASE_API_KEY  Valor: AIzaSy...`
  console.error(msg)
}

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
