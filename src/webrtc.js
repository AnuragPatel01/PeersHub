// src/webrtc.js (replace existing)
import Peer from "peerjs";
import { nanoid } from "nanoid";

let peer = null;
let connections = {}; // peerId -> DataConnection
let peersList = []; // connected peer IDs
let peerNames = {}; // id -> name

let reconnectInterval = null;
const RECONNECT_INTERVAL_MS = 3000;

const LS_PEER_ID = "ph_peer_id";
const LS_HUB_BOOTSTRAP = "ph_hub_bootstrap";
const LS_LOCAL_NAME = "ph_name";

// global callbacks so election/everywhere can notify UI / messages
let onMessageGlobal = null;
let onPeerListUpdateGlobal = null;
let onBootstrapChangedGlobal = null;

/**
 * initPeer(onMessage, onPeerListUpdate, localName = "Anonymous", onBootstrapChange = null)
 */
export const initPeer = (onMessage, onPeerListUpdate, localName = "Anonymous", onBootstrapChange = null) => {
  onMessageGlobal = onMessage || null;
  onPeerListUpdateGlobal = onPeerListUpdate || null;
  onBootstrapChangedGlobal = onBootstrapChange || null;

  const storedId = localStorage.getItem(LS_PEER_ID);
  const desiredId = storedId || nanoid(6);
  peer = new Peer(desiredId);

  peer.on("open", (id) => {
    console.log("My ID:", id);
    if (!storedId) localStorage.setItem(LS_PEER_ID, id);
    peerNames[id] = localName;

    const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
    if (bootstrap && bootstrap !== id) {
      try {
        connectToPeer(bootstrap, onMessageGlobal, onPeerListUpdateGlobal, localName);
      } catch (e) {
        startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, localName);
      }
    }
  });

  peer.on("connection", (conn) => {
    setupConnection(conn, onMessageGlobal, onPeerListUpdateGlobal, localName);
  });

  peer.on("error", (err) => console.warn("Peer error:", err));

  return peer;
};

export const connectToPeer = (peerId, onMessage, onPeerListUpdate, localName = "Anonymous") => {
  if (!peer) return;
  if (peerId === peer.id) return;
  if (connections[peerId]) return;

  const conn = peer.connect(peerId, { reliable: true });
  setupConnection(conn, onMessage, onPeerListUpdate, localName);
};

export const joinHub = (bootstrapPeerId) => {
  if (!bootstrapPeerId) return;
  localStorage.setItem(LS_HUB_BOOTSTRAP, bootstrapPeerId);
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(bootstrapPeerId);
};

export const leaveHub = () => {
  stopReconnectLoop();
  Object.values(connections).forEach((conn) => {
    try { conn.close && conn.close(); } catch (e) {}
  });
  connections = {};
  peersList = [];
  peerNames = {};
  localStorage.removeItem(LS_HUB_BOOTSTRAP);
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(null);
};

// Broadcast a bootstrap change to all peers
const broadcastBootstrapChange = (newBootstrapId) => {
  const payload = { type: "bootstrap", id: newBootstrapId };
  Object.values(connections).forEach((conn) => sendToConn(conn, payload));
};

// Elect a new bootstrap deterministically (lexicographically smallest id among connected + self)
const electBootstrapIfNeeded = () => {
  const storedBootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
  if (storedBootstrap && (storedBootstrap === (peer && peer.id) || peersList.includes(storedBootstrap))) return;

  const candidates = [...new Set([...(peersList || []), peer?.id].filter(Boolean))];
  if (candidates.length === 0) return;

  candidates.sort();
  const newBootstrap = candidates[0];

  localStorage.setItem(LS_HUB_BOOTSTRAP, newBootstrap);
  broadcastBootstrapChange(newBootstrap);
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(newBootstrap);
  console.log("Elected new bootstrap:", newBootstrap);

  // Notify the newly elected bootstrap: either locally, or by sending a system message if we have a connection
  const systemText = "You're the host now";
  if (newBootstrap === peer?.id) {
    // If this client is the new bootstrap, show system message locally
    if (onMessageGlobal) onMessageGlobal("System", systemText);
  } else {
    // If we have a connection to the new bootstrap, send them a system message
    const connToBootstrap = connections[newBootstrap];
    if (connToBootstrap) {
      sendToConn(connToBootstrap, { type: "system", text: systemText });
    }
  }
};

const setupConnection = (conn, onMessage, onPeerListUpdate, localName = "Anonymous") => {
  conn.on("open", () => {
    console.log("Connected to", conn.peer);
    connections[conn.peer] = conn;

    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    onPeerListUpdate && onPeerListUpdate([...peersList]);

    // send intro
    sendToConn(conn, {
      type: "intro",
      id: peer.id,
      name: peerNames[peer.id] || localName,
      peers: [...peersList],
    });

    // After connecting, validate bootstrap
    electBootstrapIfNeeded();
  });

  conn.on("data", (raw) => {
    const data = parseMessage(raw);
    if (!data || typeof data !== "object") return;

    if (data.type === "intro") {
      if (data.id && data.name) peerNames[data.id] = data.name;
      if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

      (data.peers || []).forEach((p) => {
        if (p !== peer.id && !connections[p]) {
          try { connectToPeer(p, onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id] || localName); } catch (e) {}
        }
      });

      onPeerListUpdate && onPeerListUpdate([...peersList]);
      electBootstrapIfNeeded();
      return;
    }

    if (data.type === "bootstrap") {
      if (data.id) {
        localStorage.setItem(LS_HUB_BOOTSTRAP, data.id);
        if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(data.id);
        if (data.id !== peer.id && !connections[data.id]) {
          try { connectToPeer(data.id, onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id] || localName); } catch (e) {}
        }
      }
      return;
    }

    if (data.type === "system") {
      // system messages delivered to UI as from "System"
      if (onMessageGlobal) onMessageGlobal("System", data.text ?? "");
      return;
    }

    if (data.type === "chat") {
      const fromName = data.fromName || peerNames[data.from] || data.from || "peer";
      if (onMessageGlobal) onMessageGlobal(fromName, data.text ?? "");
      return;
    }

    // fallback
    if (onMessageGlobal) onMessageGlobal(data.fromName ?? data.from ?? conn.peer, data.text ? data.text : JSON.stringify(data));
  });

  conn.on("close", () => {
    console.log("Disconnected from", conn.peer);
    delete connections[conn.peer];
    peersList = peersList.filter((p) => p !== conn.peer);
    delete peerNames[conn.peer];
    onPeerListUpdate && onPeerListUpdate([...peersList]);

    electBootstrapIfNeeded();

    const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
    if (bootstrap && bootstrap !== peer.id && !connections[bootstrap]) {
      startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id] || localStorage.getItem(LS_LOCAL_NAME) || "Anonymous");
    }
  });

  conn.on("error", (err) => console.warn("Connection error with", conn.peer, err));
};

export const broadcastMessage = (fromName, text) => {
  const payload = { type: "chat", from: peer?.id, fromName, text };
  Object.values(connections).forEach((conn) => sendToConn(conn, payload));
};

export const getPeers = () => peersList;
export const getPeerNames = () => ({ ...peerNames });
export const getLocalPeerId = () => (peer ? peer.id : localStorage.getItem(LS_PEER_ID) || null);

/* helpers */
const sendToConn = (conn, payload) => {
  try {
    if (typeof payload === "string") conn.send(payload);
    else conn.send(JSON.stringify(payload));
  } catch (e) {
    console.warn("Send failed", e);
  }
};

const parseMessage = (raw) => {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (e) { return { type: "chat", text: raw }; }
  }
  if (typeof raw === "object" && raw !== null) return raw;
  return { type: "chat", text: String(raw) };
};

/* reconnect loop */
const startReconnectLoop = (onMessage, onPeerListUpdate, localName) => {
  stopReconnectLoop();
  reconnectInterval = setInterval(() => {
    const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
    if (!bootstrap || !peer) { stopReconnectLoop(); return; }
    if (connections[bootstrap]) { stopReconnectLoop(); return; }
    try { connectToPeer(bootstrap, onMessage, onPeerListUpdate, localName); } catch (e) {}
  }, RECONNECT_INTERVAL_MS);
};

const stopReconnectLoop = () => {
  if (reconnectInterval) { clearInterval(reconnectInterval); reconnectInterval = null; }
};
