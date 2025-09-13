// // src/webrtc.js
// import Peer from "peerjs";
// import { nanoid } from "nanoid";

// let peer = null;
// let connections = {}; // peerId -> DataConnection
// let peersList = []; // connected peer IDs
// let peerNames = {}; // id -> name

// let reconnectInterval = null;
// const RECONNECT_INTERVAL_MS = 3000;

// const LS_PEER_ID = "ph_peer_id";
// const LS_HUB_BOOTSTRAP = "ph_hub_bootstrap";
// const LS_LOCAL_NAME = "ph_name";

// // global callbacks
// let onMessageGlobal = null;
// let onPeerListUpdateGlobal = null;
// let onBootstrapChangedGlobal = null;

// /**
//  * initPeer(onMessage, onPeerListUpdate, localName = "Anonymous", onBootstrapChange = null)
//  * - onMessage(from, payloadOrText)
//  *   payloadOrText may be string OR object { type, text, id, ... }
//  */
// export const initPeer = (onMessage, onPeerListUpdate, localName = "Anonymous", onBootstrapChange = null) => {
//   onMessageGlobal = onMessage || null;
//   onPeerListUpdateGlobal = onPeerListUpdate || null;
//   onBootstrapChangedGlobal = onBootstrapChange || null;

//   const storedId = localStorage.getItem(LS_PEER_ID);
//   const desiredId = storedId || nanoid(6);
//   peer = new Peer(desiredId);

//   peer.on("open", (id) => {
//     console.log("My ID:", id);
//     if (!storedId) localStorage.setItem(LS_PEER_ID, id);
//     peerNames[id] = localName;

//     // If user previously joined a hub, try to connect to bootstrap
//     const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
//     if (bootstrap && bootstrap !== id) {
//       try {
//         connectToPeer(bootstrap, onMessageGlobal, onPeerListUpdateGlobal, localName);
//       } catch (e) {
//         // start reconnect loop if immediate connect fails
//         startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, localName);
//       }
//     }
//   });

//   peer.on("connection", (conn) => {
//     setupConnection(conn, onMessageGlobal, onPeerListUpdateGlobal, localName);
//   });

//   peer.on("error", (err) => {
//     console.warn("Peer error:", err);
//   });

//   return peer;
// };

// export const connectToPeer = (peerId, onMessage, onPeerListUpdate, localName = "Anonymous") => {
//   if (!peer) {
//     console.warn("Peer not initialized yet");
//     return;
//   }
//   if (peerId === peer.id) return;
//   if (connections[peerId]) return;

//   const conn = peer.connect(peerId, { reliable: true });
//   setupConnection(conn, onMessage, onPeerListUpdate, localName);
// };

// /**
//  * Persist bootstrap id (join hub)
//  */
// export const joinHub = (bootstrapPeerId) => {
//   if (!bootstrapPeerId) return;
//   localStorage.setItem(LS_HUB_BOOTSTRAP, bootstrapPeerId);
//   if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(bootstrapPeerId);
// };

// /**
//  * Leave hub: clear connections and persisted bootstrap
//  */
// export const leaveHub = () => {
//   stopReconnectLoop();
//   Object.values(connections).forEach((conn) => {
//     try { conn.close && conn.close(); } catch (e) {}
//   });
//   connections = {};
//   peersList = [];
//   peerNames = {};
//   localStorage.removeItem(LS_HUB_BOOTSTRAP);
//   if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(null);
// };

// /**
//  * If bootstrap is missing or offline, elect a bootstrap.
//  * Deterministic rule: lexicographically smallest id among (connected peers + self).
//  *
//  * New rule to avoid duplicate broadcasts:
//  * - Only the elected bootstrap peer (peer.id === newBootstrap) will broadcast the *public* announcement.
//  * - All peers will persist the new bootstrap locally.
//  */
// const electBootstrapIfNeeded = () => {
//   const storedBootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
//   if (storedBootstrap && (storedBootstrap === (peer && peer.id) || peersList.includes(storedBootstrap))) {
//     // bootstrap exists and is present
//     return;
//   }

//   const candidates = [...new Set([...(peersList || []), peer?.id].filter(Boolean))];
//   if (candidates.length === 0) return;

//   candidates.sort(); // lexicographic deterministic
//   const newBootstrap = candidates[0];

//   // set persistently
//   const prev = localStorage.getItem(LS_HUB_BOOTSTRAP);
//   if (prev === newBootstrap) return; // nothing changed

//   localStorage.setItem(LS_HUB_BOOTSTRAP, newBootstrap);
//   if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(newBootstrap);

//   // Build announcement payloads
//   const publicId = `bootstrap-${newBootstrap}`;
//   const privateId = `bootstrap-private-${newBootstrap}`;
//   const displayName = peerNames[newBootstrap] || newBootstrap;
//   const publicText = `${displayName} is now the host`;
//   const privateText = `You're the host now`;

//   // Only the elected bootstrap itself will broadcast the public announcement widely (to avoid multiple peers simultaneously broadcasting)
//   if (peer?.id === newBootstrap) {
//     // Broadcast public announcement
//     broadcastRaw({ type: "system_public", text: publicText, id: publicId });
//     // Also notify self privately
//     if (onMessageGlobal) onMessageGlobal("System", { type: "system_private", text: privateText, id: privateId });
//   } else {
//     // Non-elected peers: if they have a connection to the new bootstrap, send that bootstrap a private system message
//     const connToBootstrap = connections[newBootstrap];
//     if (connToBootstrap) {
//       sendToConn(connToBootstrap, { type: "system_private", text: privateText, id: privateId });
//     }
//     // do not broadcast public announcement; elected bootstrap will broadcast it
//   }
//   console.log("Elected new bootstrap:", newBootstrap);
// };

// /**
//  * Setup connection object handlers
//  */
// const setupConnection = (conn, onMessage, onPeerListUpdate, localName = "Anonymous") => {
//   conn.on("open", () => {
//     console.log("Connected to", conn.peer);
//     connections[conn.peer] = conn;

//     if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
//     onPeerListUpdate && onPeerListUpdate([...peersList]);

//     // send intro (advertise id, name, and known peers)
//     sendToConn(conn, {
//       type: "intro",
//       id: peer.id,
//       name: peerNames[peer.id] || localName,
//       peers: [...peersList],
//     });

//     // after connecting, ensure bootstrap is valid (may trigger election)
//     electBootstrapIfNeeded();
//   });

//   conn.on("data", (raw) => {
//     const data = parseMessage(raw);
//     if (!data || typeof data !== "object") return;

//     if (data.type === "intro") {
//       if (data.id && data.name) peerNames[data.id] = data.name;
//       if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

//       // auto-connect to peers introducer knows
//       (data.peers || []).forEach((p) => {
//         if (p !== peer.id && !connections[p]) {
//           try { connectToPeer(p, onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id] || localName); } catch (e) {}
//         }
//       });

//       onPeerListUpdate && onPeerListUpdate([...peersList]);
//       electBootstrapIfNeeded();
//       return;
//     }

//     if (data.type === "system_public") {
//       // global public system message (broadcast by elected bootstrap)
//       if (onMessageGlobal) onMessageGlobal("System", { type: "system_public", text: data.text, id: data.id });
//       return;
//     }

//     if (data.type === "system_private") {
//       // private system message targeted to a peer
//       if (onMessageGlobal) onMessageGlobal("System", { type: "system_private", text: data.text, id: data.id });
//       return;
//     }

//     if (data.type === "bootstrap") {
//       // old-style bootstrap message support (if any)
//       if (data.id) {
//         localStorage.setItem(LS_HUB_BOOTSTRAP, data.id);
//         if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(data.id);
//         if (data.id !== peer.id && !connections[data.id]) {
//           try { connectToPeer(data.id, onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id] || localName); } catch (e) {}
//         }
//       }
//       return;
//     }

//     if (data.type === "chat") {
//       const fromName = data.fromName || peerNames[data.from] || data.from || "peer";
//       if (onMessageGlobal) onMessageGlobal(fromName, data.text ?? "");
//       return;
//     }

//     // fallback: unknown
//     if (onMessageGlobal) onMessageGlobal(data.fromName ?? data.from ?? conn.peer, data.text ? data.text : JSON.stringify(data));
//   });

//   conn.on("close", () => {
//     console.log("Disconnected from", conn.peer);
//     delete connections[conn.peer];
//     peersList = peersList.filter((p) => p !== conn.peer);
//     delete peerNames[conn.peer];
//     onPeerListUpdate && onPeerListUpdate([...peersList]);

//     // elect new bootstrap if needed
//     electBootstrapIfNeeded();

//     const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
//     if (bootstrap && bootstrap !== peer.id && !connections[bootstrap]) {
//       startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id] || localStorage.getItem(LS_LOCAL_NAME) || "Anonymous");
//     }
//   });

//   conn.on("error", (err) => console.warn("Connection error with", conn.peer, err));
// };

// /**
//  * Broadcast chat message to all peers
//  */
// export const broadcastMessage = (fromName, text) => {
//   const payload = { type: "chat", from: peer?.id, fromName, text };
//   Object.values(connections).forEach((conn) => sendToConn(conn, payload));
// };

// /**
//  * Utility to broadcast arbitrary object to all connections
//  */
// const broadcastRaw = (payload) => {
//   Object.values(connections).forEach((conn) => sendToConn(conn, payload));
// };

// export const getPeers = () => peersList;
// export const getPeerNames = () => ({ ...peerNames });
// export const getLocalPeerId = () => (peer ? peer.id : localStorage.getItem(LS_PEER_ID) || null);

// /* helpers */
// const sendToConn = (conn, payload) => {
//   try {
//     if (typeof payload === "string") conn.send(payload);
//     else conn.send(JSON.stringify(payload));
//   } catch (e) {
//     console.warn("Send failed", e);
//   }
// };

// const parseMessage = (raw) => {
//   if (typeof raw === "string") {
//     try { return JSON.parse(raw); } catch (e) { return { type: "chat", text: raw }; }
//   }
//   if (typeof raw === "object" && raw !== null) return raw;
//   return { type: "chat", text: String(raw) };
// };

// /* reconnect loop */
// const startReconnectLoop = (onMessage, onPeerListUpdate, localName) => {
//   stopReconnectLoop();
//   reconnectInterval = setInterval(() => {
//     const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
//     if (!bootstrap || !peer) { stopReconnectLoop(); return; }
//     if (connections[bootstrap]) { stopReconnectLoop(); return; }
//     try { connectToPeer(bootstrap, onMessage, onPeerListUpdate, localName); } catch (e) {}
//   }, RECONNECT_INTERVAL_MS);
// };

// const stopReconnectLoop = () => {
//   if (reconnectInterval) { clearInterval(reconnectInterval); reconnectInterval = null; }
// };






// new integration 




// src/webrtc.js
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

// global callbacks
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
  if (!peer) {
    console.warn("Peer not initialized yet");
    return;
  }
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

// low-level send helpers
const sendToConn = (conn, payload) => {
  try {
    if (typeof payload === "string") conn.send(payload);
    else conn.send(JSON.stringify(payload));
  } catch (e) {
    console.warn("Send failed", e);
  }
};

const broadcastRaw = (payload) => {
  Object.values(connections).forEach((conn) => sendToConn(conn, payload));
};

// public chat send (UI should call this)
export const sendChat = (msgObj) => {
  const payload = { type: "chat", ...msgObj };
  broadcastRaw(payload);
};

// public typing signal
export const sendTyping = (fromName, isTyping) => {
  const payload = { type: "typing", fromName, isTyping };
  broadcastRaw(payload);
};

// previously internal: send ack deliver to a specific peer
const sendAckDeliver = (toPeerId, msgId) => {
  const conn = connections[toPeerId];
  if (conn) {
    sendToConn(conn, { type: "ack_deliver", id: msgId, from: peer.id });
  } else {
    // fall back: route via broadcast with 'to' field so only the receiver uses it
    broadcastRaw({ type: "ack_deliver", id: msgId, from: peer.id, to: toPeerId });
  }
};

// NEW exported: send ack read to origin peer (clean helper)
export const sendAckRead = (msgId, originPeerId) => {
  if (!msgId) return;
  try {
    if (originPeerId && connections[originPeerId]) {
      // send directly
      sendToConn(connections[originPeerId], { type: "ack_read", id: msgId, from: peer.id });
      return;
    }
    // fallback: broadcast with 'to' so the origin processes it when it sees it
    broadcastRaw({ type: "ack_read", id: msgId, from: peer.id, to: originPeerId || null });
  } catch (e) {
    console.warn("sendAckRead failed", e);
  }
};

const parseMessage = (raw) => {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (e) { return { type: "chat", text: raw }; }
  }
  if (typeof raw === "object" && raw !== null) return raw;
  return { type: "chat", text: String(raw) };
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
  });

  conn.on("data", (raw) => {
    const data = parseMessage(raw);
    if (!data || typeof data !== "object") return;

    // If message has a 'to' field and it's not for me, ignore it (routing)
    if (data.to && data.to !== peer.id) {
      // not for me — ignore
      return;
    }

    if (data.type === "intro") {
      if (data.id && data.name) peerNames[data.id] = data.name;
      if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

      (data.peers || []).forEach((p) => {
        if (p !== peer.id && !connections[p]) {
          try { connectToPeer(p, onMessage, onPeerListUpdate, peerNames[peer.id] || localName); } catch (e) {}
        }
      });

      onPeerListUpdate && onPeerListUpdate([...peersList]);
      return;
    }

    if (data.type === "typing") {
      if (onMessage) onMessage("__system_typing__", { fromName: data.fromName, isTyping: data.isTyping });
      return;
    }

    if (data.type === "chat") {
      // notify UI and also send ack_deliver back to origin
      if (onMessage) onMessage(data.from, data);
      // send ack_deliver back to original sender (use 'origin' if supplied)
      const origin = data.origin || data.from;
      if (origin && origin !== peer.id) {
        sendAckDeliver(origin, data.id);
      }
      return;
    }

    if (data.type === "ack_deliver") {
      // someone acknowledges delivery for msg id
      if (onMessage) onMessage("__system_ack_deliver__", { fromPeer: data.from, id: data.id });
      return;
    }

    if (data.type === "ack_read") {
      // read ack — deliver to UI
      if (onMessage) onMessage("__system_ack_read__", { fromPeer: data.from, id: data.id });
      return;
    }

    // fallback
    if (onMessage) onMessage(data.from || conn.peer, data);
  });

  conn.on("close", () => {
    console.log("Disconnected from", conn.peer);
    delete connections[conn.peer];
    peersList = peersList.filter((p) => p !== conn.peer);
    delete peerNames[conn.peer];
    onPeerListUpdate && onPeerListUpdate([...peersList]);
  });

  conn.on("error", (err) => console.warn("Connection error with", conn.peer, err));
};

export const getPeers = () => peersList;
export const getPeerNames = () => ({ ...peerNames });
export const getLocalPeerId = () => (peer ? peer.id : localStorage.getItem(LS_PEER_ID) || null);

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
