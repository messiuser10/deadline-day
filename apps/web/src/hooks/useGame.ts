import { useCallback, useEffect } from 'react';
import { useGameStore } from '../stores/game';
import { getSocket } from '../lib/socket';
import { toast } from '../stores/toast';

/**
 * Watch a game over Socket.IO: get the snapshot on watch (and again after every reconnect), then
 * apply lobby updates, auction states, bids, sales, the playback clock, presence and chat. Returns `rewatch` for after
 * joining or being kicked.
 */
export function useGame(rawCode: string) {
  const code = rawCode.toUpperCase();
  const snapshot = useGameStore((s) => s.snapshot);
  const error = useGameStore((s) => s.error);

  const rewatch = useCallback(() => {
    const store = useGameStore.getState();
    getSocket().emit('game:watch', { code }, (res) => {
      if (res.ok) store.setSnapshot(res.snapshot);
      else store.setError(res.error);
    });
  }, [code]);

  useEffect(() => {
    const store = useGameStore.getState();
    store.watch(code);
    const socket = getSocket();
    const onConnect = () => rewatch();
    const onKicked = (p: { code: string }) => {
      if (p.code !== code) return;
      toast('The host removed your team from this game', 'error');
      rewatch();
    };
    const onNotice = (n: { level: 'info' | 'error'; message: string }) => toast(n.message, n.level === 'error' ? 'error' : 'info');

    socket.on('connect', onConnect);
    socket.on('game:snapshot', store.setSnapshot);
    socket.on('lobby:update', store.applyState);
    socket.on('presence', store.applyPresence);
    socket.on('chat:message', store.addChat);
    socket.on('game:kicked', onKicked);
    socket.on('game:notice', onNotice);
    socket.on('auction:state', store.applyAuction);
    socket.on('auction:bid', store.applyBid);
    socket.on('auction:sold', store.applySold);
    socket.on('season:playback', store.applyPlayback);
    if (socket.connected) rewatch();

    return () => {
      socket.off('connect', onConnect);
      socket.off('game:snapshot', store.setSnapshot);
      socket.off('lobby:update', store.applyState);
      socket.off('presence', store.applyPresence);
      socket.off('chat:message', store.addChat);
      socket.off('game:kicked', onKicked);
      socket.off('game:notice', onNotice);
      socket.off('auction:state', store.applyAuction);
      socket.off('auction:bid', store.applyBid);
      socket.off('auction:sold', store.applySold);
      socket.off('season:playback', store.applyPlayback);
      socket.emit('game:unwatch', { code });
    };
  }, [code, rewatch]);

  return { code, snapshot: snapshot?.game.code === code ? snapshot : null, error, rewatch };
}
