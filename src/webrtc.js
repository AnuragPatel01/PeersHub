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

/**
 * Robust webrtc helpers for PeersHub
 * - persists local peer id
 * - keeps a persisted known-peers list so clients retry connects after refresh
 * - robust reconnect loop to bootstrap + known peers
 * - intro message propagates known peers
 */

let peer = null;
let connections = {}; // peerId -> DataConnection
let peersList = []; // currently connected peer IDs (in-memory)
let peerNames = {}; // id -> name

// persistent store keys
const LS_PEER_ID = "ph_peer_id";
const LS_HUB_BOOTSTRAP = "ph_hub_bootstrap";
const LS_KNOWN_PEERS = "ph_known_peers";
const LS_LOCAL_NAME = "ph_name";
// NEW: control whether client should auto-join stored hub after refresh
const LS_SHOULD_AUTOJOIN = "ph_should_autojoin";

let reconnectInterval = null;
const RECONNECT_INTERVAL_MS = 3000;

// global callbacks (set in initPeer)
let onMessageGlobal = null;
let onPeerListUpdateGlobal = null;
let onBootstrapChangedGlobal = null;

/* ---------- util for knownPeers persistence ---------- */
const loadKnownPeers = () => {
  try {
    const raw = localStorage.getItem(LS_KNOWN_PEERS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr);
  } catch (e) {
    return new Set();
  }
};

const saveKnownPeers = (set) => {
  try {
    localStorage.setItem(LS_KNOWN_PEERS, JSON.stringify(Array.from(set)));
  } catch (e) {}
};

const addKnownPeer = (id) => {
  if (!id || id === getLocalPeerId()) return;
  const s = loadKnownPeers();
  s.add(id);
  saveKnownPeers(s);
};

/* ---------- low-level send helpers ---------- */
const sendToConn = (conn, payload) => {
  try {
    if (!conn || conn.open === false) return;
    if (typeof payload === "string") conn.send(payload);
    else conn.send(JSON.stringify(payload));
  } catch (e) {
    console.warn("Send failed", e);
  }
};

const broadcastRaw = (payload) => {
  Object.values(connections).forEach((conn) => {
    try {
      sendToConn(conn, payload);
    } catch (e) {}
  });
};

/* ---------- public API: chat + typing + ack ---------- */
export const sendChat = (msgObj) => {
  // msgObj should include id, from, fromName, text, ts, replyTo, etc.
  const payload = { type: "chat", ...msgObj };
  broadcastRaw(payload);
};

export const sendTyping = (fromName, isTyping) => {
  const payload = { type: "typing", fromName, isTyping };
  broadcastRaw(payload);
};

const sendAckDeliver = (toPeerId, msgId) => {
  if (!msgId) return;
  const conn = connections[toPeerId];
  if (conn) {
    sendToConn(conn, { type: "ack_deliver", id: msgId, from: peer.id });
  } else {
    // route fallback — include to so only the origin processes it
    broadcastRaw({
      type: "ack_deliver",
      id: msgId,
      from: peer.id,
      to: toPeerId,
    });
  }
};

// exported clean helper for UI to call when user reads a message
export const sendAckRead = (msgId, originPeerId) => {
  if (!msgId) return;
  try {
    if (originPeerId && connections[originPeerId]) {
      sendToConn(connections[originPeerId], {
        type: "ack_read",
        id: msgId,
        from: peer.id,
      });
      return;
    }
    // fallback route
    broadcastRaw({
      type: "ack_read",
      id: msgId,
      from: peer.id,
      to: originPeerId || null,
    });
  } catch (e) {
    console.warn("sendAckRead failed", e);
  }
};

// broadcast a system-type message to all connected peers
export const broadcastSystem = (type, text, id = null) => {
  try {
    const payload = { type: type || "system_public", text: text || "", id: id || `sys-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, origin: peer ? peer.id : null };
    // reuse existing raw broadcast helper which serializes for us
    broadcastRaw(payload);
  } catch (e) {
    console.warn("broadcastSystem failed", e);
  }
};


/* ---------- helper getters ---------- */
export const getPeers = () => [...peersList];
export const getPeerNames = () => ({ ...peerNames });
export const getLocalPeerId = () =>
  peer ? peer.id : localStorage.getItem(LS_PEER_ID) || null;
export const getKnownPeers = () => Array.from(loadKnownPeers());

/* ---------- connection management ---------- */

export const connectToPeer = (
  peerId,
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous"
) => {
  if (!peer) {
    console.warn("connectToPeer: peer not initialized yet");
    return;
  }
  if (!peerId) return;
  if (peerId === peer.id) return;
  if (connections[peerId]) return; // already connected

  try {
    const conn = peer.connect(peerId, { reliable: true });
    setupConnection(conn, onMessage, onPeerListUpdate, localName);
  } catch (e) {
    console.warn("connectToPeer error", e);
  }
};

export const joinHub = (bootstrapPeerId) => {
  if (!bootstrapPeerId) return;
  localStorage.setItem(LS_HUB_BOOTSTRAP, bootstrapPeerId);
  // set the explicit autojoin flag so refresh will reconnect
  localStorage.setItem(LS_SHOULD_AUTOJOIN, "true");
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(bootstrapPeerId);
};

export const leaveHub = () => {
  stopReconnectLoop();
  Object.values(connections).forEach((conn) => {
    try {
      conn.close && conn.close();
    } catch (e) {}
  });
  connections = {};
  peersList = [];
  peerNames = {};
  // clear bootstrap AND autojoin flag on leave
  localStorage.removeItem(LS_HUB_BOOTSTRAP);
  localStorage.removeItem(LS_SHOULD_AUTOJOIN);
  // keep known-peers (so user can rejoin later if they want),
  // but we will not auto-connect without the autojoin flag.
  if (onPeerListUpdateGlobal) onPeerListUpdateGlobal([...peersList]);
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(null);
};

/* ---------- parse incoming raw data ---------- */
const parseMessage = (raw) => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { type: "chat", text: raw };
    }
  }
  if (typeof raw === "object" && raw !== null) return raw;
  return { type: "chat", text: String(raw) };
};

/* ---------- setup per-connection handlers ---------- */
const setupConnection = (
  conn,
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous"
) => {
  conn.on("open", () => {
    // store
    connections[conn.peer] = conn;
    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    if (onPeerListUpdate) onPeerListUpdate([...peersList]);

    // tell them who we are + known peers
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

    // routing: if 'to' present and not for me, ignore
    if (data.to && data.to !== peer.id) return;

    if (data.type === "intro") {
      // record name + peers
      if (data.id && data.name) peerNames[data.id] = data.name;
      if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

      // add known peers to persisted set and try to connect to them
      (data.peers || []).forEach((p) => {
        if (p && p !== peer.id) {
          addKnownPeer(p);
          if (!connections[p]) {
            // try connect after a tiny delay to avoid thundering
            setTimeout(() => {
              try {
                connectToPeer(
                  p,
                  onMessageGlobal,
                  onPeerListUpdateGlobal,
                  peerNames[peer.id] || localName
                );
              } catch (e) {}
            }, 100);
          }
        }
      });

      if (onPeerListUpdate) onPeerListUpdate([...peersList]);
      return;
    }

    if (data.type === "typing") {
      if (onMessage)
        onMessage("__system_typing__", {
          fromName: data.fromName,
          isTyping: data.isTyping,
        });
      return;
    }

    if (data.type === "chat") {
      // forward full payload to UI
      if (onMessage) onMessage(data.from, data);
      // ack delivery back to origin
      const origin = data.origin || data.from;
      if (origin && origin !== peer.id) {
        sendAckDeliver(origin, data.id);
      }
      return;
    }

    if (data.type === "ack_deliver") {
      if (onMessage)
        onMessage("__system_ack_deliver__", {
          fromPeer: data.from,
          id: data.id,
        });
      return;
    }

    if (data.type === "ack_read") {
      if (onMessage)
        onMessage("__system_ack_read__", { fromPeer: data.from, id: data.id });
      return;
    }

    // fallback: pass to UI
    if (onMessage) onMessage(data.from || conn.peer, data);
  });

  conn.on("close", () => {
    try {
      delete connections[conn.peer];
    } catch (e) {}
    peersList = peersList.filter((p) => p !== conn.peer);
    delete peerNames[conn.peer];
    if (onPeerListUpdate) onPeerListUpdate([...peersList]);
    // add to known peers (so we try to re-establish)
    addKnownPeer(conn.peer);
    // start reconnect loop so any dropped connections are attempted
    startReconnectLoop(
      onMessageGlobal,
      onPeerListUpdateGlobal,
      peerNames[peer.id]
    );
  });

  conn.on("error", (err) => {
    console.warn("Connection error with", conn.peer, err);
    // schedule reconnect attempts
    addKnownPeer(conn.peer);
    startReconnectLoop(
      onMessageGlobal,
      onPeerListUpdateGlobal,
      peerNames[peer.id]
    );
  });
};

/* ---------- reconnect loop ---------- */
const startReconnectLoop = (onMessage, onPeerListUpdate, localName) => {
  // if user opted out of auto-join, do not start reconnect attempts
  const shouldAutoNow = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
  if (!shouldAutoNow) return;

  stopReconnectLoop();
  reconnectInterval = setInterval(() => {
    // check flag every tick — stop if user disabled it in the meantime
    const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
    if (!shouldAuto) {
      stopReconnectLoop();
      return;
    }

    // attempt connect to bootstrap
    const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
    if (
      bootstrap &&
      bootstrap !== getLocalPeerId() &&
      !connections[bootstrap]
    ) {
      try {
        connectToPeer(bootstrap, onMessage, onPeerListUpdate, localName);
      } catch (e) {}
    }

    // attempt connect to known peers (only when autojoin enabled)
    const known = loadKnownPeers();
    known.forEach((p) => {
      if (!p || p === getLocalPeerId()) return;
      if (!connections[p]) {
        try {
          connectToPeer(p, onMessage, onPeerListUpdate, localName);
        } catch (e) {}
      }
    });
  }, RECONNECT_INTERVAL_MS);
};

const stopReconnectLoop = () => {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }
};

/* ---------- initPeer: create Peer & set handlers ---------- */
export const initPeer = (
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous",
  onBootstrapChange = null
) => {
  onMessageGlobal = onMessage || null;
  onPeerListUpdateGlobal = onPeerListUpdate || null;
  onBootstrapChangedGlobal = onBootstrapChange || null;

  // try stored id or generate one
  let storedId = localStorage.getItem(LS_PEER_ID);
  if (!storedId) {
    storedId = nanoid(6);
    localStorage.setItem(LS_PEER_ID, storedId);
  }

  const createPeerWithId = (id) => {
    try {
      peer = new Peer(id);

      peer.on("open", (idOpen) => {
        // ensure we persist the id used
        localStorage.setItem(LS_PEER_ID, idOpen);
        peerNames[idOpen] = localName;

        // only auto-connect if user previously opted to autojoin
        const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
        if (shouldAuto) {
          // attempt immediate connect to bootstrap (if set)
          const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
          if (bootstrap && bootstrap !== idOpen) {
            try {
              connectToPeer(
                bootstrap,
                onMessageGlobal,
                onPeerListUpdateGlobal,
                localName
              );
            } catch (e) {}
          }

          // try known peers quickly
          const known = loadKnownPeers();
          known.forEach((p) => {
            if (!p || p === idOpen) return;
            if (!connections[p]) {
              try {
                connectToPeer(
                  p,
                  onMessageGlobal,
                  onPeerListUpdateGlobal,
                  localName
                );
              } catch (e) {}
            }
          });

          // start reconnect loop to be resilient
          startReconnectLoop(
            onMessageGlobal,
            onPeerListUpdateGlobal,
            localName
          );
        } else {
          // user has explicitly disabled auto-join -> ensure no reconnect loop runs
          stopReconnectLoop();
        }
      });

      peer.on("connection", (conn) => {
        setupConnection(
          conn,
          onMessageGlobal,
          onPeerListUpdateGlobal,
          localName
        );
      });

      peer.on("error", (err) => {
        console.warn("Peer error", err);
        // if id taken / unavailable, create a new one
        // PeerJS may emit an error like 'ID is taken' — handle by recreating with new id
        try {
          if (err && err.type === "unavailable-id") {
            const newId = nanoid(6);
            localStorage.setItem(LS_PEER_ID, newId);
            // destroy old peer then recreate
            try {
              peer.destroy && peer.destroy();
            } catch (e) {}
            createPeerWithId(newId);
          }
        } catch (e) {}
      });

      // return peer instance
      return peer;
    } catch (e) {
      console.warn("createPeerWithId failed", e);
      // try again with random id
      const newId = nanoid(6);
      localStorage.setItem(LS_PEER_ID, newId);
      return createPeerWithId(newId);
    }
  };

  return createPeerWithId(storedId);
};
