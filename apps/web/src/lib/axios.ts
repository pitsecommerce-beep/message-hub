import axios from 'axios'
import { auth } from './firebase'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 15_000,
})

// Attach Firebase ID token to every request
api.interceptors.request.use(async (config) => {
  const user = auth.currentUser
  if (user) {
    const token = await user.getIdToken()
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Normalize error responses
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const message =
      error.response?.data?.message ?? error.message ?? 'Error desconocido'
    return Promise.reject(new Error(message))
  },
)

export { api }
