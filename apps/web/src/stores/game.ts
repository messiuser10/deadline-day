/**
 * The game this tab is watching. The server snapshot is the source of truth; lobby updates from
 * REST responses and socket events are applied only when they are newer than what we hold.
 */
import { create } from 'zustand';
import type { ApiErrorBody, ChatMessageView, GameSnapshot, LobbyUpdate } from '@deadline-day/protocol';

interface GameStore {
  code: string | null;
  snapshot: GameSnapshot | null;
  error: ApiErrorBody['error'] | null;
  watch: (code: string) => void;
  setSnapshot: (s: GameSnapshot) => void;
  setError: (e: ApiErrorBody['error']) => void;
  applyState: (u: LobbyUpdate) => void;
  applyPresence: (p: { participantId: string; isConnected: boolean }) => void;
  addChat: (m: ChatMessageView) => void;
  clear: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  code: null,
  snapshot: null,
  error: null,
  watch: (code) => {
    if (get().code !== code) set({ code, snapshot: null, error: null });
  },
  setSnapshot: (s) => {
    if (s.game.code !== get().code) return;
    set({ snapshot: s, error: null });
  },
  setError: (error) => set({ error }),
  applyState: (u) => {
    const cur = get().snapshot;
    if (!cur || u.game.id !== cur.game.id || u.serverTime < cur.serverTime) return;
    set({ snapshot: { ...u, chat: cur.chat } });
  },
  applyPresence: ({ participantId, isConnected }) => {
    const cur = get().snapshot;
    if (!cur) return;
    set({
      snapshot: { ...cur, participants: cur.participants.map((p) => (p.id === participantId ? { ...p, isConnected } : p)) },
    });
  },
  addChat: (m) => {
    const cur = get().snapshot;
    if (!cur || cur.chat.some((c) => c.id === m.id)) return;
    set({ snapshot: { ...cur, chat: [...cur.chat, m].slice(-100) } });
  },
  clear: () => set({ code: null, snapshot: null, error: null }),
}));
