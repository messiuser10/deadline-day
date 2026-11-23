/**
 * The game this tab is watching. The server snapshot is the source of truth; lobby updates, auction
 * states and single bids from REST responses and socket events are applied only when they are newer
 * than what we hold.
 */
import { create } from 'zustand';
import type { ApiErrorBody, AuctionView, BidEvent, ChatMessageView, GameSnapshot, LobbyUpdate, PresenceEvent, SaleView } from '@deadline-day/protocol';

interface GameStore {
  code: string | null;
  snapshot: GameSnapshot | null;
  error: ApiErrorBody['error'] | null;
  /** The latest lot sale, for the SOLD animation (auto-fills are not shown). */
  lastSale: SaleView | null;
  watch: (code: string) => void;
  setSnapshot: (s: GameSnapshot) => void;
  setError: (e: ApiErrorBody['error']) => void;
  applyState: (u: LobbyUpdate) => void;
  applyAuction: (view: AuctionView) => void;
  applyBid: (bid: BidEvent) => void;
  applySold: (sale: SaleView) => void;
  clearSale: () => void;
  applyPresence: (p: PresenceEvent) => void;
  addChat: (m: ChatMessageView) => void;
  clear: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  code: null,
  snapshot: null,
  error: null,
  lastSale: null,
  watch: (code) => {
    if (get().code !== code) set({ code, snapshot: null, error: null, lastSale: null });
  },
  setSnapshot: (s) => {
    if (s.game.code !== get().code) return;
    set({ snapshot: s, error: null });
  },
  setError: (error) => set({ error }),
  applyState: (u) => {
    const cur = get().snapshot;
    if (!cur || u.game.id !== cur.game.id || u.serverTime < cur.serverTime) return;
    set({ snapshot: { ...u, chat: cur.chat, auction: cur.auction } });
  },
  applyAuction: (view) => {
    const cur = get().snapshot;
    if (!cur || (cur.auction && view.version < cur.auction.version)) return;
    // The game status follows the auction (paused, complete); later stages and cancelled stay as they are.
    const keep = ['cancelled', 'simulating', 'completed'].includes(cur.game.status);
    const status = keep ? cur.game.status : view.paused ? 'paused' : view.phase === 'complete' ? 'auction_complete' : 'auctioning';
    set({ snapshot: { ...cur, game: { ...cur.game, status }, auction: view } });
  },
  applyBid: (bid) => {
    const cur = get().snapshot;
    const a = cur?.auction;
    if (!cur || !a?.lot || a.lot.id !== bid.lotId || bid.version <= a.version) return;
    const lot = { ...a.lot, currentBidM: bid.currentBidM, leaderId: bid.leaderId, bids: [...a.lot.bids, bid.bid] };
    set({ snapshot: { ...cur, auction: { ...a, version: bid.version, lot, lotDeadline: bid.lotDeadline } } });
  },
  applySold: (sale) => {
    if (sale.autoFilled || sale.sequence === null) return;
    set({ lastSale: sale });
  },
  clearSale: () => set({ lastSale: null }),
  applyPresence: ({ participantId, isConnected, disconnectedAt }) => {
    const cur = get().snapshot;
    if (!cur) return;
    set({
      snapshot: {
        ...cur,
        participants: cur.participants.map((p) => (p.id === participantId ? { ...p, isConnected, disconnectedAt: p.isBot ? null : disconnectedAt } : p)),
      },
    });
  },
  addChat: (m) => {
    const cur = get().snapshot;
    if (!cur || cur.chat.some((c) => c.id === m.id)) return;
    set({ snapshot: { ...cur, chat: [...cur.chat, m].slice(-100) } });
  },
  clear: () => set({ code: null, snapshot: null, error: null, lastSale: null }),
}));
