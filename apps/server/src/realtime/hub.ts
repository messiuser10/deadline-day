/**
 * Socket.IO: one room per game. A client watches a game by code and immediately receives the full
 * authoritative snapshot; after that it gets small events (lobby updates, presence, chat, notices,
 * auction state, single bids and sales, and the season playback clock).
 * The session cookie from the handshake identifies the user; anyone may watch (spectate) by code.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { joinCodeSchema, type ClientToServerEvents, type ServerToClientEvents } from '@deadline-day/protocol';
import type { UserRow } from '../auth/sessions';
import { toApiError } from '../errors';
import type { Broadcaster, GameService } from '../games/service';

interface SocketData {
  user: UserRow | null;
  /** gameId -> participantId (null when spectating). */
  watching: Map<string, string | null>;
}

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const gameRoom = (gameId: string) => `game:${gameId}`;
const userRoom = (userId: string) => `user:${userId}`;

export class Hub implements Broadcaster {
  readonly io: IoServer;
  /** participantId -> connected socket ids, for presence. */
  private readonly presenceSockets = new Map<string, Set<string>>();

  constructor(
    httpServer: HttpServer,
    private readonly games: GameService,
    resolveUser: (cookieHeader: string | undefined) => UserRow | null,
  ) {
    this.io = new Server(httpServer, { path: '/socket.io', serveClient: false });
    this.io.use((socket, next) => {
      try {
        socket.data.user = resolveUser(socket.request.headers.cookie);
      } catch {
        socket.data.user = null;
      }
      socket.data.watching = new Map();
      next();
    });
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  private onConnection(socket: IoSocket): void {
    const user = socket.data.user;
    if (user) void socket.join(userRoom(user.id));

    socket.on('time:sync', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('game:watch', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const code = joinCodeSchema.parse(payload?.code);
        const game = this.games.findGame(code);
        const participantId = user ? this.games.participantIdFor(game.id, user.id) : null;
        this.unwatch(socket, game.id);
        void socket.join(gameRoom(game.id));
        socket.data.watching.set(game.id, participantId);
        if (participantId) this.addPresence(game.id, participantId, socket.id);
        reply({ ok: true, snapshot: this.games.snapshot(game) });
      } catch (err) {
        reply({ ok: false, error: toApiError(err).body().error });
      }
    });

    socket.on('game:unwatch', (payload) => {
      try {
        const game = this.games.findGame(joinCodeSchema.parse(payload?.code));
        this.unwatch(socket, game.id);
      } catch {
        // Unknown code: nothing to leave.
      }
    });

    socket.on('disconnect', () => {
      for (const gameId of [...socket.data.watching.keys()]) this.unwatch(socket, gameId);
    });
  }

  private unwatch(socket: IoSocket, gameId: string): void {
    if (!socket.data.watching.has(gameId)) return;
    const participantId = socket.data.watching.get(gameId);
    socket.data.watching.delete(gameId);
    void socket.leave(gameRoom(gameId));
    if (participantId) this.removePresence(gameId, participantId, socket.id);
  }

  private addPresence(gameId: string, participantId: string, socketId: string): void {
    const set = this.presenceSockets.get(participantId) ?? new Set<string>();
    const wasOnline = set.size > 0;
    set.add(socketId);
    this.presenceSockets.set(participantId, set);
    if (!wasOnline) this.games.setConnected(gameId, participantId, true);
  }

  private removePresence(gameId: string, participantId: string, socketId: string): void {
    const set = this.presenceSockets.get(participantId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      this.presenceSockets.delete(participantId);
      try {
        this.games.setConnected(gameId, participantId, false);
      } catch {
        // The participant may have been removed (kicked or left) in the meantime.
      }
    }
  }

  // Broadcaster -------------------------------------------------------------

  lobbyUpdate: Broadcaster['lobbyUpdate'] = (gameId, update) => {
    this.io.to(gameRoom(gameId)).emit('lobby:update', update);
  };

  snapshot: Broadcaster['snapshot'] = (gameId, snapshot) => {
    this.io.to(gameRoom(gameId)).emit('game:snapshot', snapshot);
  };

  presence: Broadcaster['presence'] = (gameId, p) => {
    this.io.to(gameRoom(gameId)).emit('presence', p);
  };

  chat: Broadcaster['chat'] = (gameId, message) => {
    this.io.to(gameRoom(gameId)).emit('chat:message', message);
  };

  notice: Broadcaster['notice'] = (gameId, notice) => {
    this.io.to(gameRoom(gameId)).emit('game:notice', notice);
  };

  auctionState: Broadcaster['auctionState'] = (gameId, view) => {
    this.io.to(gameRoom(gameId)).emit('auction:state', view);
  };

  auctionBid: Broadcaster['auctionBid'] = (gameId, bid) => {
    this.io.to(gameRoom(gameId)).emit('auction:bid', bid);
  };

  auctionSold: Broadcaster['auctionSold'] = (gameId, sale) => {
    this.io.to(gameRoom(gameId)).emit('auction:sold', sale);
  };

  seasonPlayback: Broadcaster['seasonPlayback'] = (gameId, playback) => {
    this.io.to(gameRoom(gameId)).emit('season:playback', playback);
  };

  kicked: Broadcaster['kicked'] = (userId, gameId, code) => {
    this.io.to(userRoom(userId)).emit('game:kicked', { code });
    // Their sockets stop receiving this game's events; they may still watch again as a spectator.
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.user?.id !== userId || !socket.data.watching.has(gameId)) continue;
      const participantId = socket.data.watching.get(gameId);
      socket.data.watching.delete(gameId);
      void socket.leave(gameRoom(gameId));
      if (participantId) this.presenceSockets.delete(participantId);
    }
  };

  /** Drop every client; the HTTP server itself is closed by Fastify. */
  close(): void {
    this.io.disconnectSockets(true);
    this.io.engine.close();
  }
}
