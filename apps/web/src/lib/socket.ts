/**
 * One Socket.IO connection for the whole app. The session cookie identifies the user at connect
 * time, so the socket reconnects after login, guest sign-in or logout.
 */
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import type { ClientToServerEvents, ServerToClientEvents } from '@deadline-day/protocol';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionState = 'connecting' | 'online' | 'offline';

export const useConnection = create<{ state: ConnectionState }>(() => ({ state: 'connecting' }));

let socket: AppSocket | null = null;
/** serverTime - clientTime, in ms. */
let clockOffset = 0;

export function getSocket(): AppSocket {
  if (socket) return socket;
  const s: AppSocket = io({ path: '/socket.io', withCredentials: true });
  s.on('connect', () => {
    useConnection.setState({ state: 'online' });
    void syncClock(s);
  });
  s.on('disconnect', () => useConnection.setState({ state: 'offline' }));
  s.io.on('reconnect_attempt', () => useConnection.setState({ state: 'connecting' }));
  socket = s;
  return s;
}

/** Reconnect so the server sees the new session cookie. */
export function reconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

/** Estimate the clock offset from a few round trips, keeping the one with the smallest latency. */
async function syncClock(s: AppSocket): Promise<void> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 3; i++) {
    const sample = await new Promise<{ rtt: number; offset: number } | null>((resolve) => {
      const t0 = Date.now();
      const timer = setTimeout(() => resolve(null), 3000);
      s.emit('time:sync', (serverTime) => {
        clearTimeout(timer);
        const t1 = Date.now();
        resolve({ rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 });
      });
    });
    if (sample && (!best || sample.rtt < best.rtt)) best = sample;
  }
  if (best) clockOffset = best.offset;
}

export function serverNow(): number {
  return Date.now() + clockOffset;
}
