const PREFIX = 'mcfps-v1-';
const MAX_PLAYERS = 6;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

/**
 * PeerJS star topology: host owns room id, clients connect to host.
 * Host relays broadcasts. Zero-config (public PeerJS cloud).
 */
export class NetSession {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.roomCode = '';
    this.localId = '';
    this.playerName = '';
    this.connections = new Map();
    this.players = new Map();
    this._handlers = {};
    this.status = 'idle';
    this.error = '';
  }

  on(event, fn) {
    this._handlers[event] = fn;
  }

  _emit(event, data) {
    const fn = this._handlers[event];
    if (fn) fn(data);
  }

  _peerIdForRoom(code) {
    return PREFIX + String(code).toUpperCase();
  }

  async createRoom(name) {
    this.playerName = (name || '玩家').slice(0, 12);
    this.roomCode = makeCode();
    this.isHost = true;
    this.status = 'connecting';
    await this._openPeer(this._peerIdForRoom(this.roomCode));
    this.localId = this.peer.id;
    this.players.set(this.localId, {
      id: this.localId,
      name: this.playerName,
      ready: true,
      host: true,
    });
    this.status = 'lobby';
    this._emit('lobby', this._lobbySnapshot());
    this.peer.on('connection', (conn) => this._setupConn(conn, true));
    return this.roomCode;
  }

  async joinRoom(code, name) {
    this.playerName = (name || '玩家').slice(0, 12);
    this.roomCode = String(code).toUpperCase().trim();
    if (this.roomCode.length < 4) throw new Error('房间码无效');
    this.isHost = false;
    this.status = 'connecting';
    await this._openPeer(null);
    this.localId = this.peer.id;
    const hostId = this._peerIdForRoom(this.roomCode);
    const conn = this.peer.connect(hostId, { reliable: true });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('连接超时，请确认房间码与网络')), 12000);
      conn.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      this.peer.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    this._setupConn(conn, false);
    this._send(conn, { type: 'hello', name: this.playerName });
    this.status = 'lobby';
  }

  async _openPeer(id) {
    const mod = await import('peerjs');
    const Peer = mod.Peer || mod.default?.Peer || mod.default?.default || mod.default;
    if (typeof Peer !== 'function') {
      throw new Error('PeerJS 加载失败');
    }
    return new Promise((resolve, reject) => {
      this.peer = id ? new Peer(id) : new Peer();
      const fail = (err) => {
        this.status = 'error';
        this.error = err?.type || err?.message || String(err);
        reject(err instanceof Error ? err : new Error(this.error));
      };
      this.peer.on('open', () => resolve(this.peer.id));
      this.peer.on('error', fail);
      setTimeout(() => {
        if (this.status === 'connecting') fail(new Error('信令服务器连接超时'));
      }, 15000);
    });
  }

  _setupConn(conn, fromIncoming) {
    const onOpen = () => {
      this.connections.set(conn.peer, conn);
      if (this.isHost && fromIncoming) {
        if (this.players.size >= MAX_PLAYERS) {
          this._send(conn, { type: 'reject', reason: '房间已满' });
          conn.close();
        }
      }
    };
    if (conn.open) onOpen();
    else conn.on('open', onOpen);
    conn.on('data', (raw) => this._onData(conn, raw));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      if (this.players.has(conn.peer)) {
        this.players.delete(conn.peer);
        this._emit('lobby', this._lobbySnapshot());
        if (this.isHost) {
          this._broadcast({ type: 'lobby', players: this._lobbySnapshot().players }, conn.peer);
        }
        this._emit('peerLeft', { id: conn.peer });
      }
    });
    conn.on('error', () => {
      this.connections.delete(conn.peer);
    });
  }

  _onData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'hello': {
        if (!this.isHost) break;
        this.players.set(conn.peer, {
          id: conn.peer,
          name: msg.name || '玩家',
          ready: true,
          host: false,
        });
        this._send(conn, {
          type: 'welcome',
          hostId: this.localId,
          roomCode: this.roomCode,
          players: this._lobbySnapshot().players,
          yourId: conn.peer,
        });
        this._broadcast({ type: 'lobby', players: this._lobbySnapshot().players }, conn.peer);
        this._emit('lobby', this._lobbySnapshot());
        break;
      }
      case 'welcome': {
        this.players.clear();
        for (const p of msg.players || []) this.players.set(p.id, p);
        this.players.set(this.localId, {
          id: this.localId,
          name: this.playerName,
          ready: true,
          host: false,
        });
        this._emit('lobby', this._lobbySnapshot());
        break;
      }
      case 'lobby': {
        this.players.clear();
        for (const p of msg.players || []) this.players.set(p.id, p);
        this._emit('lobby', this._lobbySnapshot());
        break;
      }
      case 'reject': {
        this.error = msg.reason || '加入失败';
        this.status = 'error';
        this._emit('error', this.error);
        break;
      }
      case 'start': {
        this._emit('start', msg);
        break;
      }
      case 'relay': {
        if (this.isHost) {
          const payload = { ...msg.payload, from: conn.peer };
          this._broadcast(payload, conn.peer);
          this._emit('net', payload);
        }
        break;
      }
      default: {
        this._emit('net', msg);
        break;
      }
    }
  }

  _lobbySnapshot() {
    return {
      roomCode: this.roomCode,
      isHost: this.isHost,
      localId: this.localId,
      players: [...this.players.values()],
    };
  }

  _send(conn, data) {
    if (conn && conn.open) {
      try {
        conn.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  _broadcast(data, exceptId = null) {
    for (const [id, conn] of this.connections) {
      if (id === exceptId) continue;
      this._send(conn, data);
    }
  }

  startMatch(spawns) {
    if (!this.isHost) return;
    const payload = {
      type: 'start',
      spawns: spawns || {},
      players: this._lobbySnapshot().players,
    };
    this._broadcast(payload);
    this._emit('start', payload);
  }

  send(payload) {
    if (this.isHost) {
      this._broadcast({ ...payload, from: this.localId });
    } else {
      const hostConn = [...this.connections.values()][0];
      if (hostConn) {
        this._send(hostConn, {
          type: 'relay',
          payload: { ...payload, from: this.localId },
        });
      }
    }
  }

  destroy() {
    for (const c of this.connections.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.connections.clear();
    this.players.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
    }
    this.peer = null;
    this.status = 'idle';
  }
}

export { MAX_PLAYERS };
