'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser } from '@/lib/firebase/firestore';
import type { ILGUser } from '@/types';

export interface AuthState {
  firebaseUser: User | null;
  ilgUser: ILGUser | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    ilgUser: null,
    loading: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const ilgUser = await getUser(user.uid);
        setState({ firebaseUser: user, ilgUser, loading: false });
      } else {
        setState({ firebaseUser: null, ilgUser: null, loading: false });
      }
    });
    return unsub;
  }, []);

  return state;
}
