import { useCallback, useState } from 'react';
import type { AuctionView, BidEvent, LobbyUpdate, PlaybackView } from '@deadline-day/protocol';
import { errorMessage } from '../lib/api';
import { useGameStore } from '../stores/game';
import { toast } from '../stores/toast';

/**
 * Runs a game mutation: applies the returned lobby or auction state at once (the socket update follows), shows
 * server errors as toasts, and tracks which action is pending so its button can spin.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | null> => {
    setPending(key);
    try {
      const res = await fn();
      const out = res as { state?: LobbyUpdate; auction?: AuctionView; bid?: BidEvent; playback?: PlaybackView } | undefined;
      const store = useGameStore.getState();
      if (out?.state) store.applyState(out.state);
      if (out?.auction) store.applyAuction(out.auction);
      if (out?.bid) store.applyBid(out.bid);
      if (out?.playback) store.applyPlayback(out.playback);
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
