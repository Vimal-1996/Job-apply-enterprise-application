import { useSyncExternalStore } from 'react';
import { isSigningOut, subscribeSigningOut } from './signOut';

export function useSigningOut(): boolean {
  return useSyncExternalStore(subscribeSigningOut, isSigningOut);
}
