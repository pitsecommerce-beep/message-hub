import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import type { UserData, Organization } from '@/types'

interface AuthState {
  user: User | null
  userData: UserData | null
  organization: Organization | null
  loading: boolean
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    userData: null,
    organization: null,
    loading: true,
  })

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, userData: null, organization: null, loading: false })
        return
      }

      try {
        const userRef = doc(db, 'users', user.uid)
        const userSnap = await getDoc(userRef)

        if (!userSnap.exists()) {
          setState({ user, userData: null, organization: null, loading: false })
          return
        }

        const userData = { uid: user.uid, ...userSnap.data() } as UserData

        const orgRef = doc(db, 'organizations', userData.orgId)
        const orgSnap = await getDoc(orgRef)
        const organization = orgSnap.exists()
          ? ({ id: orgSnap.id, ...orgSnap.data() } as Organization)
          : null

        setState({ user, userData, organization, loading: false })
      } catch (err) {
        console.error('Error loading user data:', err)
        setState({ user, userData: null, organization: null, loading: false })
      }
    })

    return unsubscribe
  }, [])

  return state
}
