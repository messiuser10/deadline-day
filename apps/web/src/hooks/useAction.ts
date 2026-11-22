import { useCallback, useState } from 'react';
import type { LobbyUpdate } from '@deadline-day/protocol';
import { errorMessage } from '../lib/api';
import { useGameStore } from '../stores/game';
import { toast } from '../stores/toast';

/**
 * Runs a lobby mutation: applies the returned state at once (the socket update follows), shows
 * server errors as toasts, and tracks which action is pending so its button can spin.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | null> => {
    setPending(key);
    try {
      const res = await fn();
      const state = (res as { state?: LobbyUpdate } | undefined)?.state;
      if (state) useGameStore.getState().applyState(state);
      if (success) toast(success, 'success');
      return res;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return null;
    } finally {
      setPending(null);
    }
  }, []);
  return { run, pending };
}
