

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
 * - stronger stop logic + per-peer retry/backoff + window control hooks
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
// NEW: timestamp marker that user intentionally left (prevents auto-rejoin)
const LS_LEFT_AT = "ph_left_at";

let reconnectInterval = null;
const RECONNECT_INTERVAL_MS = 3000;

// per-peer retry bookkeeping to reduce thundering reconnects
const retryCounts = {}; // peerId -> number
const LAST_ATTEMPT = {}; // peerId -> timestamp
const MAX_RETRY_PER_PEER = 6; // after this many attempts, skip until next interval
const BACKOFF_BASE_MS = 2000; // additional exponential backoff per retry
const COOLDOWN_AFTER_MAX = 5 * 60 * 1000; // 5 minutes cooldown once max reached

// global callbacks (set in initPeer)
let onMessageGlobal = null;
let onPeerListUpdateGlobal = null;
let onBootstrapChangedGlobal = null;

// debug / control hooks for console
window.__PH_debug = () => ({
  peerId: peer ? peer.id : null,
  connections: Object.keys(connections || {}),
  peersList,
  localStorageKeys: {
    ph_hub_bootstrap: localStorage.getItem("ph_hub_bootstrap"),
    ph_should_autojoin: localStorage.getItem("ph_should_autojoin"),
    ph_known_peers: localStorage.getItem("ph_known_peers"),
    ph_left_at: localStorage.getItem("ph_left_at"),
  },
  reconnectIntervalActive: !!reconnectInterval,
  retryCounts: { ...retryCounts },
  lastAttempt: { ...LAST_ATTEMPT },
});

// allow force-stop reconnect loop & disable autojoin
window.__PH_stopReconnect = () => {
  try {
    stopReconnectLoop();
    localStorage.setItem(LS_SHOULD_AUTOJOIN, "false");
    console.log(
      "Called window.__PH_stopReconnect(): reconnect loop stopped and autojoin disabled."
    );
  } catch (e) {
    console.warn("window.__PH_stopReconnect error", e);
  }
};

// allow resume (clears left marker and enable autojoin & starts reconnect loop)
window.__PH_resumeReconnect = () => {
  try {
    localStorage.removeItem(LS_LEFT_AT);
    localStorage.setItem(LS_SHOULD_AUTOJOIN, "true");
    // start loop if peer exists
    if (peer) {
      startReconnectLoop(
        onMessageGlobal,
        onPeerListUpdateGlobal,
        peerNames[peer.id]
      );
    }
    console.log(
      "Called window.__PH_resumeReconnect(): left marker cleared, autojoin enabled."
    );
  } catch (e) {
    console.warn("window.__PH_resumeReconnect error", e);
  }
};

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
    const payload = {
      type: type || "system_public",
      text: text || "",
      id: id || `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      origin: peer ? peer.id : null,
    };
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

/**
 * connectToPeer:
 * - respects LS_LEFT_AT (do not initiate outbound connections if user intentionally left)
 * - creates PeerJS DataConnection and calls setupConnection
 */
export const connectToPeer = (
  peerId,
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous"
) => {
  // refuse to initiate outbound connects if user explicitly left
  try {
    if (localStorage.getItem(LS_LEFT_AT)) {
      // mark cooldown for this peer so reconnect loop won't hammer it
      try {
        retryCounts[peerId] = MAX_RETRY_PER_PEER;
        LAST_ATTEMPT[peerId] = Date.now();
      } catch (e) {}
      console.log(
        "PH: connectToPeer aborted because ph_left_at present. peerId:",
        peerId
      );
      return;
    }
  } catch (e) {}

  if (!peer) {
    console.warn("connectToPeer: peer not initialized yet");
    return;
  }
  if (!peerId) return;
  if (peerId === peer.id) return;
  if (connections[peerId]) return; // already connected

  // check per-peer retry count to avoid spamming attempts
  const now = Date.now();
  const last = LAST_ATTEMPT[peerId] || 0;
  const tries = retryCounts[peerId] || 0;

  if (tries >= MAX_RETRY_PER_PEER) {
    // check if cooldown expired
    if (now - last < COOLDOWN_AFTER_MAX) {
      console.log(
        "PH: cooling down retries for",
        peerId,
        "until",
        new Date(last + COOLDOWN_AFTER_MAX).toLocaleTimeString()
      );
      return;
    } else {
      console.log("PH: cooldown expired, resetting retry counter for", peerId);
      retryCounts[peerId] = 0;
    }
  }

  // impose exponential backoff
  const backoff = BACKOFF_BASE_MS * Math.pow(2, tries);
  if (now - last < backoff) {
    // not enough time passed for this peer yet
    return;
  }

  try {
    LAST_ATTEMPT[peerId] = now;
    retryCounts[peerId] = (retryCounts[peerId] || 0) + 1;
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
  // clear any left marker because user is explicitly joining again
  localStorage.removeItem(LS_LEFT_AT);
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(bootstrapPeerId);
};

export const leaveHub = () => {
  // stop reconnect loop immediately
  stopReconnectLoop();

  // close all active DataConnections
  Object.values(connections).forEach((conn) => {
    try {
      conn.close && conn.close();
    } catch (e) {
      console.warn("error closing conn on leaveHub", e);
    }
  });

  // try to broadcast a public leave notice so others can reduce attempts sooner
  try {
    const myId = getLocalPeerId();
    const myName = peerNames[myId] || localStorage.getItem(LS_LOCAL_NAME) || "Unknown";
    broadcastSystem(
      "system_leave",
      `${myName} left the hub`,
      `sys-leave-${myId || "unknown"}`
    );
  } catch (e) {
    console.warn("PH: failed to broadcast leave", e);
  }

  // clear in-memory connection state
  connections = {};
  peersList = [];
  peerNames = {};

  // clear all persistence: bootstrap, autojoin, known peers
  try {
    localStorage.removeItem(LS_HUB_BOOTSTRAP);
    localStorage.removeItem(LS_SHOULD_AUTOJOIN);
    localStorage.removeItem(LS_KNOWN_PEERS);
    // mark left time so no auto-join will happen accidentally
    localStorage.setItem(LS_LEFT_AT, Date.now().toString());
  } catch (e) {
    console.warn("Error clearing leaveHub storage keys", e);
  }

  // notify UI callbacks
  if (onPeerListUpdateGlobal) {
    try {
      onPeerListUpdateGlobal([...peersList]);
    } catch (e) {}
  }
  if (onBootstrapChangedGlobal) {
    try {
      onBootstrapChangedGlobal(null);
    } catch (e) {}
  }

  console.log(
    "PH: leaveHub() strict -> cleared bootstrap, autojoin, known peers and set left marker"
  );
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
  // defensive: if user intentionally left, refuse incoming connections early
  try {
    const leftAt = localStorage.getItem(LS_LEFT_AT);
    if (leftAt) {
      console.log(
        "PH: refusing setupConnection for incoming conn because ph_left_at present:",
        leftAt,
        "from:",
        conn.peer
      );
      try {
        conn.close && conn.close();
      } catch (e) {}
      return;
    }
  } catch (e) {
    console.warn("PH: error checking left marker before setupConnection:", e);
  }

  conn.on("open", () => {
    // safety: check left marker again at open time (covers race conditions)
    try {
      const leftAt = localStorage.getItem(LS_LEFT_AT);
      if (leftAt) {
        console.log(
          "PH: setupConnection closing conn on open because ph_left_at present:",
          leftAt,
          "peer:",
          conn.peer
        );
        try {
          conn.close && conn.close();
        } catch (e) {}
        return;
      }
    } catch (e) {
      console.warn(
        "PH: error reading ph_left_at in setupConnection open handler",
        e
      );
    }

    // store connection and update peer list
    connections[conn.peer] = conn;
    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    if (onPeerListUpdate) {
      try {
        onPeerListUpdate([...peersList]);
      } catch (e) {
        console.warn(e);
      }
    }

    // reset retry bookkeeping on success
    retryCounts[conn.peer] = 0;
    LAST_ATTEMPT[conn.peer] = 0;

    // tell remote who we are + known peers
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

    // special: handle public leave signal so we reduce retries for that origin
    if (data.type === "system_leave") {
      // origin may be present in payload.origin (we set it in broadcastSystem)
      const origin = data.origin || null;
      console.log("PH: received leave notice from", origin, "-", data.text);
      if (origin) {
        retryCounts[origin] = MAX_RETRY_PER_PEER;
        LAST_ATTEMPT[origin] = Date.now();
      }
      if (onMessage) onMessage("__system_leave__", data);
      return;
    }

    // routing: if 'to' present and not for me, ignore
    if (data.to && data.to !== peer.id) return;

    if (data.type === "intro") {
      // record name + peers
      if (data.id && data.name) peerNames[data.id] = data.name;
      if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

      // add known peers to persisted set and try to connect to them
      (data.peers || []).forEach((p) => {
        if (!p || p === peer.id) return;

        // always persist known peer (useful for reconnect attempts)
        addKnownPeer(p);

        // do not try to actively connect if user intentionally left
        try {
          const leftAt = localStorage.getItem(LS_LEFT_AT);
          if (leftAt) {
            // user left — do not initiate outbound connects
            console.log(
              "PH: skipping connectToPeer for known peer because ph_left_at present:",
              leftAt,
              "peer:",
              p
            );
            return;
          }
        } catch (e) {
          console.warn(
            "PH: error checking ph_left_at before connecting to known peer",
            e
          );
        }

        if (!connections[p]) {
          // try connect after a tiny delay to avoid thundering herd
          setTimeout(() => {
            try {
              connectToPeer(
                p,
                onMessageGlobal,
                onPeerListUpdateGlobal,
                peerNames[peer.id] || localName
              );
            } catch (e) {
              console.warn("PH: connectToPeer failed for known peer", p, e);
            }
          }, 100);
        }
      });

      if (onPeerListUpdate) {
        try {
          onPeerListUpdate([...peersList]);
        } catch (e) {
          console.warn(e);
        }
      }
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

      // ack delivery back to origin (route directly where possible)
      const origin = data.origin || data.from;
      if (origin && origin !== peer.id) {
        try {
          sendAckDeliver(origin, data.id);
        } catch (e) {
          // fallback: broadcast ack so the origin sees it via the mesh
          try {
            broadcastRaw({
              type: "ack_deliver",
              id: data.id,
              from: peer.id,
              to: origin,
            });
          } catch (err) {
            console.warn("PH: sendAckDeliver fallback failed", err);
          }
        }
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

    // fallback: pass other payloads to UI
    if (onMessage) onMessage(data.from || conn.peer, data);
  });

  conn.on("close", () => {
    try {
      delete connections[conn.peer];
    } catch (e) {}
    peersList = peersList.filter((p) => p !== conn.peer);
    delete peerNames[conn.peer];
    if (onPeerListUpdate) {
      try {
        onPeerListUpdate([...peersList]);
      } catch (e) {
        console.warn(e);
      }
    }

    // persist this peer so we can attempt reconnects later (unless user left)
    try {
      addKnownPeer(conn.peer);
    } catch (e) {}

    // start reconnect loop to re-establish dropped connections (respecting autojoin / left markers inside startReconnectLoop)
    startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id]);
  });

  conn.on("error", (err) => {
    console.warn("Connection error with", conn.peer, err);

    // schedule reconnect attempts (persist the peer)
    try {
      addKnownPeer(conn.peer);
    } catch (e) {}

    startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id]);
  });
};

/* ---------- reconnect loop ---------- */

const startReconnectLoop = (onMessage, onPeerListUpdate, localName) => {
  // if the user intentionally left recently, don't auto reconnect
  const leftAt = parseInt(localStorage.getItem(LS_LEFT_AT) || "0", 10);
  if (leftAt && !isNaN(leftAt)) {
    // optional: treat leave as permanent until explicit join — so block reconnect
    console.log(
      "PH: startReconnectLoop blocked because ph_left_at present:",
      leftAt
    );
    return;
  }

  // gate by explicit autojoin flag
  const shouldAutoNow = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
  if (!shouldAutoNow) {
    console.log(
      "PH: startReconnectLoop skipped because autojoin flag is false"
    );
    return;
  }

  stopReconnectLoop();
  console.log("PH: startReconnectLoop -> starting reconnect interval");
  reconnectInterval = setInterval(() => {
    // check flag every tick — stop if user disabled it in the meantime
    const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
    const leftNow = localStorage.getItem(LS_LEFT_AT);
    if (!shouldAuto || leftNow) {
      console.log(
        "PH: reconnect loop stopping because autojoin false or left marker present",
        { shouldAuto, leftNow }
      );
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
        console.log(
          "PH: reconnect loop attempting bootstrap connect ->",
          bootstrap
        );
        connectToPeer(bootstrap, onMessage, onPeerListUpdate, localName);
      } catch (e) {
        console.warn("PH: reconnect loop bootstrap connect failed", e);
      }
    }

    // attempt connect to known peers (only when autojoin enabled)
    const known = loadKnownPeers();
    known.forEach((p) => {
      if (!p || p === getLocalPeerId()) return;
      if (!connections[p]) {
        try {
          // respect per-peer retry guard inside connectToPeer
          console.log("PH: reconnect loop attempting known peer connect ->", p);
          connectToPeer(p, onMessage, onPeerListUpdate, localName);
        } catch (e) {
          console.warn("PH: reconnect loop known peer connect failed", e);
        }
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
          startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, localName);
        } else {
          // user has explicitly disabled auto-join -> ensure no reconnect loop runs
          stopReconnectLoop();
        }
      });

      peer.on("connection", (conn) => {
        try {
          const leftAt = localStorage.getItem(LS_LEFT_AT);
          if (leftAt) {
            // user intentionally left — refuse inbound connection politely
            console.log(
              "PH: refusing inbound connection because user left at",
              leftAt,
              "-> closing conn to",
              conn.peer
            );
            try {
              conn.close && conn.close();
            } catch (e) {}
            return;
          }
        } catch (e) {
          console.warn(
            "PH: error checking left marker for inbound connection",
            e
          );
        }

        // otherwise proceed as usual
        setupConnection(conn, onMessageGlobal, onPeerListUpdateGlobal, localName);
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










// New visitor logic
































































































// // src/webrtc.js
// import Peer from "peerjs";
// import { nanoid } from "nanoid";

// /**
//  * Robust webrtc helpers for PeersHub
//  * - persists local peer id
//  * - keeps a persisted known-peers list so clients retry connects after refresh
//  * - robust reconnect loop to bootstrap + known peers
//  * - intro message propagates known peers
//  * - stronger stop logic + per-peer retry/backoff + window control hooks
//  *
//  * File transfer additions:
//  * - sendFile(toPeerId, file, {chunkSize})
//  * - acceptFileOffer(fileId, fromPeerId)
//  * - declineFileOffer(fileId, fromPeerId, opts) // opts.reason === 'timeout' -> broadcast file_expired
//  *
//  * UI receives file events via onMessage callback (same as earlier conversation):
//  * "__system_file_offer__"  -> { id, name, size, mime, from }
//  * "__system_file_progress__" -> { id, from, sentBytes/receivedBytes, totalBytes, direction: 'send'|'recv', name }
//  * "__system_file_complete__" -> { id, from, blob, name, mime }
//  * "__system_file_declined__" -> { id, from }
//  * "__system_file_expired__" -> { id, from }
//  */

// let peer = null;
// let connections = {}; // peerId -> DataConnection
// let peersList = []; // currently connected peer IDs (in-memory)
// let peerNames = {}; // id -> name

// // persistent store keys
// const LS_PEER_ID = "ph_peer_id";
// const LS_HUB_BOOTSTRAP = "ph_hub_bootstrap";
// const LS_KNOWN_PEERS = "ph_known_peers";
// const LS_LOCAL_NAME = "ph_name";
// // NEW: control whether client should auto-join stored hub after refresh
// const LS_SHOULD_AUTOJOIN = "ph_should_autojoin";
// // NEW: timestamp marker that user intentionally left (prevents auto-rejoin)
// const LS_LEFT_AT = "ph_left_at";

// let reconnectInterval = null;
// const RECONNECT_INTERVAL_MS = 3000;

// // per-peer retry bookkeeping to reduce thundering reconnects
// const retryCounts = {}; // peerId -> number
// const LAST_ATTEMPT = {}; // peerId -> timestamp
// const MAX_RETRY_PER_PEER = 6; // after this many attempts, skip until next interval
// const BACKOFF_BASE_MS = 2000; // additional exponential backoff per retry
// const COOLDOWN_AFTER_MAX = 5 * 60 * 1000; // 5 minutes cooldown once max reached

// // global callbacks (set in initPeer)
// let onMessageGlobal = null;
// let onPeerListUpdateGlobal = null;
// let onBootstrapChangedGlobal = null;

// /* ---------- FILE TRANSFER STATE ---------- */
// // outgoingTransfers[fileId] = { conn, file, offset, chunkSize, sentBytes, totalBytes, seq, stopped, fileId }
// const outgoingTransfers = {};
// // incomingTransfers[fileId] = { from, name, mime, totalBytes, receivedBytes, chunks: [{seq, buf}], lastSeq }
// const incomingTransfers = {};
// const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB

// // debug / control hooks for console
// window.__PH_debug = () => ({
//   peerId: peer ? peer.id : null,
//   connections: Object.keys(connections || {}),
//   peersList,
//   localStorageKeys: {
//     ph_hub_bootstrap: localStorage.getItem("ph_hub_bootstrap"),
//     ph_should_autojoin: localStorage.getItem("ph_should_autojoin"),
//     ph_known_peers: localStorage.getItem("ph_known_peers"),
//     ph_left_at: localStorage.getItem("ph_left_at"),
//   },
//   reconnectIntervalActive: !!reconnectInterval,
//   retryCounts: { ...retryCounts },
//   lastAttempt: { ...LAST_ATTEMPT },
//   outgoing: Object.keys(outgoingTransfers),
//   incoming: Object.keys(incomingTransfers),
// });

// // allow force-stop reconnect loop & disable autojoin
// window.__PH_stopReconnect = () => {
//   try {
//     stopReconnectLoop();
//     localStorage.setItem(LS_SHOULD_AUTOJOIN, "false");
//     console.log(
//       "Called window.__PH_stopReconnect(): reconnect loop stopped and autojoin disabled."
//     );
//   } catch (e) {
//     console.warn("window.__PH_stopReconnect error", e);
//   }
// };

// // allow resume (clears left marker and enable autojoin & starts reconnect loop)
// window.__PH_resumeReconnect = () => {
//   try {
//     localStorage.removeItem(LS_LEFT_AT);
//     localStorage.setItem(LS_SHOULD_AUTOJOIN, "true");
//     // start loop if peer exists
//     if (peer) {
//       startReconnectLoop(
//         onMessageGlobal,
//         onPeerListUpdateGlobal,
//         (peer && peer.id && peerNames[peer.id]) || null
//       );
//     }
//     console.log(
//       "Called window.__PH_resumeReconnect(): left marker cleared, autojoin enabled."
//     );
//   } catch (e) {
//     console.warn("window.__PH_resumeReconnect error", e);
//   }
// };

// /* ---------- util for knownPeers persistence ---------- */
// const loadKnownPeers = () => {
//   try {
//     const raw = localStorage.getItem(LS_KNOWN_PEERS);
//     if (!raw) return new Set();
//     const arr = JSON.parse(raw);
//     if (!Array.isArray(arr)) return new Set();
//     return new Set(arr);
//   } catch (e) {
//     return new Set();
//   }
// };

// const saveKnownPeers = (set) => {
//   try {
//     localStorage.setItem(LS_KNOWN_PEERS, JSON.stringify(Array.from(set)));
//   } catch (e) {}
// };

// const addKnownPeer = (id) => {
//   if (!id || id === getLocalPeerId()) return;
//   const s = loadKnownPeers();
//   s.add(id);
//   saveKnownPeers(s);
// };

// /* ---------- low-level send helpers ---------- */
// const sendToConn = (conn, payload) => {
//   try {
//     if (!conn || conn.open === false) return;
//     if (typeof payload === "string") conn.send(payload);
//     else conn.send(JSON.stringify(payload));
//   } catch (e) {
//     console.warn("Send failed", e);
//   }
// };

// // send structured cloneable payloads (binary chunks) — do not JSON.stringify
// const sendRawToConn = (conn, payload) => {
//   try {
//     if (!conn || conn.open === false) return;
//     conn.send(payload);
//   } catch (e) {
//     console.warn("sendRawToConn failed", e);
//   }
// };

// const broadcastRaw = (payload) => {
//   Object.values(connections).forEach((conn) => {
//     try {
//       sendToConn(conn, payload);
//     } catch (e) {}
//   });
// };

// /* ---------- public API: chat + typing + ack ---------- */
// export const sendChat = (msgObj) => {
//   // msgObj should include id, from, fromName, text, ts, replyTo, etc.
//   const payload = { type: "chat", ...msgObj };
//   broadcastRaw(payload);
// };

// export const sendTyping = (fromName, isTyping) => {
//   const payload = { type: "typing", fromName, isTyping };
//   broadcastRaw(payload);
// };

// const sendAckDeliver = (toPeerId, msgId) => {
//   if (!msgId) return;
//   const conn = connections[toPeerId];
//   if (conn) {
//     sendToConn(conn, { type: "ack_deliver", id: msgId, from: peer ? peer.id : null });
//   } else {
//     // route fallback — include to so only the origin processes it
//     broadcastRaw({
//       type: "ack_deliver",
//       id: msgId,
//       from: peer ? peer.id : null,
//       to: toPeerId,
//     });
//   }
// };

// // exported clean helper for UI to call when user reads a message
// export const sendAckRead = (msgId, originPeerId) => {
//   if (!msgId) return;
//   try {
//     if (originPeerId && connections[originPeerId]) {
//       sendToConn(connections[originPeerId], {
//         type: "ack_read",
//         id: msgId,
//         from: peer ? peer.id : null,
//       });
//       return;
//     }
//     // fallback route
//     broadcastRaw({
//       type: "ack_read",
//       id: msgId,
//       from: peer ? peer.id : null,
//       to: originPeerId || null,
//     });
//   } catch (e) {
//     console.warn("sendAckRead failed", e);
//   }
// };

// // broadcast a system-type message to all connected peers
// export const broadcastSystem = (type, text, id = null) => {
//   try {
//     const payload = {
//       type: type || "system_public",
//       text: text || "",
//       id: id || `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
//       origin: peer ? peer.id : null,
//     };
//     // reuse existing raw broadcast helper which serializes for us
//     broadcastRaw(payload);
//   } catch (e) {
//     console.warn("broadcastSystem failed", e);
//   }
// };

// /* ---------- helper getters ---------- */
// export const getPeers = () => [...peersList];
// export const getPeerNames = () => ({ ...peerNames });
// export const getLocalPeerId = () =>
//   peer ? peer.id : localStorage.getItem(LS_PEER_ID) || null;
// export const getKnownPeers = () => Array.from(loadKnownPeers());

// /* ---------- File transfer API ---------- */

// /**
//  * sendFile(toPeerId, file)
//  * - sends file_offer metadata and stores outgoingTransfers[fileId]
//  * - returns fileId
//  */
// export const sendFile = async (toPeerId, file, { chunkSize = DEFAULT_CHUNK_SIZE } = {}) => {
//   if (!toPeerId) throw new Error("toPeerId required");
//   if (!file) throw new Error("file required");
//   if (!connections[toPeerId]) throw new Error("not connected to target peer");

//   const conn = connections[toPeerId];
//   const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

//   outgoingTransfers[fileId] = {
//     conn,
//     file,
//     offset: 0,
//     chunkSize,
//     sentBytes: 0,
//     totalBytes: file.size,
//     seq: 0,
//     stopped: false,
//     fileId, // important so streaming knows which id it's for
//   };

//   // send offer
//   const offer = {
//     type: "file_offer",
//     id: fileId,
//     name: file.name,
//     size: file.size,
//     mime: file.type || "application/octet-stream",
//     from: peer ? peer.id : null,
//   };
//   try {
//     sendToConn(conn, offer);
//   } catch (e) {
//     console.warn("sendFile: failed to send offer", e);
//     delete outgoingTransfers[fileId];
//     throw e;
//   }

//   return fileId;
// };

// /**
//  * acceptFileOffer(fileId, fromPeerId)
//  * - sends file_accept and the sender will start streaming
//  */
// export const acceptFileOffer = (fileId, fromPeerId) => {
//   if (!fileId || !fromPeerId) return;
//   const conn = connections[fromPeerId];
//   if (!conn) return;
//   sendToConn(conn, { type: "file_accept", id: fileId, from: peer ? peer.id : null });
// };

// /**
//  * declineFileOffer(fileId, fromPeerId, opts)
//  * - sends file_decline; if opts.reason === 'timeout' also broadcast file_expired
//  */
// export const declineFileOffer = (fileId, fromPeerId, opts = {}) => {
//   if (!fileId || !fromPeerId) return;
//   const conn = connections[fromPeerId];
//   if (conn) {
//     sendToConn(conn, { type: "file_decline", id: fileId, from: peer ? peer.id : null });
//   }

//   if (opts && opts.reason === "timeout") {
//     try {
//       broadcastRaw({
//         type: "file_expired",
//         id: fileId,
//         from: peer ? peer.id : null,
//       });
//     } catch (e) {
//       console.warn("file_expired broadcast failed", e);
//     }
//   }
// };

// /* ---------- connection management & handlers ---------- */

// export const connectToPeer = (
//   peerId,
//   onMessage,
//   onPeerListUpdate,
//   localName = "Anonymous"
// ) => {
//   // refuse to initiate outbound connects if user explicitly left
//   try {
//     if (localStorage.getItem(LS_LEFT_AT)) {
//       // mark cooldown for this peer so reconnect loop won't hammer it
//       try {
//         retryCounts[peerId] = MAX_RETRY_PER_PEER;
//         LAST_ATTEMPT[peerId] = Date.now();
//       } catch (e) {}
//       console.log(
//         "PH: connectToPeer aborted because ph_left_at present. peerId:",
//         peerId
//       );
//       return;
//     }
//   } catch (e) {}

//   if (!peer) {
//     console.warn("connectToPeer: peer not initialized yet");
//     return;
//   }
//   if (!peerId) return;
//   if (peerId === peer.id) return;
//   if (connections[peerId]) return; // already connected

//   // check per-peer retry count to avoid spamming attempts
//   const now = Date.now();
//   const last = LAST_ATTEMPT[peerId] || 0;
//   const tries = retryCounts[peerId] || 0;

//   if (tries >= MAX_RETRY_PER_PEER) {
//     // check if cooldown expired
//     if (now - last < COOLDOWN_AFTER_MAX) {
//       console.log(
//         "PH: cooling down retries for",
//         peerId,
//         "until",
//         new Date(last + COOLDOWN_AFTER_MAX).toLocaleTimeString()
//       );
//       return;
//     } else {
//       console.log("PH: cooldown expired, resetting retry counter for", peerId);
//       retryCounts[peerId] = 0;
//     }
//   }

//   // impose exponential backoff
//   const backoff = BACKOFF_BASE_MS * Math.pow(2, tries);
//   if (now - last < backoff) {
//     // not enough time passed for this peer yet
//     return;
//   }

//   try {
//     LAST_ATTEMPT[peerId] = now;
//     retryCounts[peerId] = (retryCounts[peerId] || 0) + 1;
//     const conn = peer.connect(peerId, { reliable: true });
//     setupConnection(conn, onMessage, onPeerListUpdate, localName);
//   } catch (e) {
//     console.warn("connectToPeer error", e);
//   }
// };

// export const joinHub = (bootstrapPeerId) => {
//   if (!bootstrapPeerId) return;
//   localStorage.setItem(LS_HUB_BOOTSTRAP, bootstrapPeerId);
//   // set the explicit autojoin flag so refresh will reconnect
//   localStorage.setItem(LS_SHOULD_AUTOJOIN, "true");
//   // clear any left marker because user is explicitly joining again
//   localStorage.removeItem(LS_LEFT_AT);
//   if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(bootstrapPeerId);
// };

// export const leaveHub = () => {
//   // stop reconnect loop immediately
//   stopReconnectLoop();

//   // close all active DataConnections
//   Object.values(connections).forEach((conn) => {
//     try {
//       conn.close && conn.close();
//     } catch (e) {
//       console.warn("error closing conn on leaveHub", e);
//     }
//   });

//   // try to broadcast a public leave notice so others can reduce attempts sooner
//   try {
//     const myId = getLocalPeerId();
//     const myName = peerNames[myId] || localStorage.getItem(LS_LOCAL_NAME) || "Unknown";
//     broadcastSystem(
//       "system_leave",
//       `${myName} left the hub`,
//       `sys-leave-${myId || "unknown"}`
//     );
//   } catch (e) {
//     console.warn("PH: failed to broadcast leave", e);
//   }

//   // clear in-memory connection state
//   connections = {};
//   peersList = [];
//   peerNames = {};

//   // destroy peer instance to avoid stale sockets
//   try {
//     if (peer && typeof peer.destroy === "function") {
//       try {
//         peer.destroy();
//       } catch (err) {}
//     }
//   } catch (e) {}
//   peer = null;

//   // clear all persistence: bootstrap, autojoin, known peers
//   try {
//     localStorage.removeItem(LS_HUB_BOOTSTRAP);
//     localStorage.removeItem(LS_SHOULD_AUTOJOIN);
//     localStorage.removeItem(LS_KNOWN_PEERS);
//     // mark left time so no auto-join will happen accidentally
//     localStorage.setItem(LS_LEFT_AT, Date.now().toString());
//   } catch (e) {
//     console.warn("Error clearing leaveHub storage keys", e);
//   }

//   // notify UI callbacks
//   if (onPeerListUpdateGlobal) {
//     try {
//       onPeerListUpdateGlobal([...peersList]);
//     } catch (e) {}
//   }
//   if (onBootstrapChangedGlobal) {
//     try {
//       onBootstrapChangedGlobal(null);
//     } catch (e) {}
//   }

//   console.log(
//     "PH: leaveHub() strict -> cleared bootstrap, autojoin, known peers and set left marker"
//   );
// };

// /* ---------- parse incoming raw data ---------- */
// const parseMessage = (raw) => {
//   if (typeof raw === "string") {
//     try {
//       return JSON.parse(raw);
//     } catch (e) {
//       return { type: "chat", text: raw };
//     }
//   }
//   if (typeof raw === "object" && raw !== null) return raw;
//   return { type: "chat", text: String(raw) };
// };

// /* ---------- setup per-connection handlers ---------- */
// const setupConnection = (
//   conn,
//   onMessage,
//   onPeerListUpdate,
//   localName = "Anonymous"
// ) => {
//   // defensive: if user intentionally left, refuse incoming connections early
//   try {
//     const leftAt = localStorage.getItem(LS_LEFT_AT);
//     if (leftAt) {
//       console.log(
//         "PH: refusing setupConnection for incoming conn because ph_left_at present:",
//         leftAt,
//         "from:",
//         conn.peer
//       );
//       try {
//         conn.close && conn.close();
//       } catch (e) {}
//       return;
//     }
//   } catch (e) {
//     console.warn("PH: error checking left marker before setupConnection:", e);
//   }

//   conn.on("open", () => {
//     // safety: check left marker again at open time (covers race conditions)
//     try {
//       const leftAt = localStorage.getItem(LS_LEFT_AT);
//       if (leftAt) {
//         console.log(
//           "PH: setupConnection closing conn on open because ph_left_at present:",
//           leftAt,
//           "peer:",
//           conn.peer
//         );
//         try {
//           conn.close && conn.close();
//         } catch (e) {}
//         return;
//       }
//     } catch (e) {
//       console.warn(
//         "PH: error reading ph_left_at in setupConnection open handler",
//         e
//       );
//     }

//     // store connection and update peer list
//     connections[conn.peer] = conn;
//     if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
//     if (onPeerListUpdate) {
//       try {
//         onPeerListUpdate([...peersList]);
//       } catch (e) {
//         console.warn(e);
//       }
//     }

//     // reset retry bookkeeping on success
//     retryCounts[conn.peer] = 0;
//     LAST_ATTEMPT[conn.peer] = 0;

//     // tell remote who we are + known peers
//     sendToConn(conn, {
//       type: "intro",
//       id: peer ? peer.id : null,
//       name: (peer && peer.id && peerNames[peer.id]) || localName,
//       peers: [...peersList],
//     });
//   });

//   conn.on("data", async (raw) => {
//     const data = parseMessage(raw);
//     if (!data || typeof data !== "object") return;

//     /* ---------- FILE handling ---------- */
//     if (data.type === "file_offer") {
//       // inform UI about incoming offer
//       if (onMessage) onMessage("__system_file_offer__", {
//         id: data.id,
//         name: data.name,
//         size: data.size,
//         mime: data.mime,
//         from: data.from || conn.peer,
//       });
//       return;
//     }

//     if (data.type === "file_accept") {
//       // sender should start streaming
//       const id = data.id;
//       if (!id || !outgoingTransfers[id]) return;
//       try {
//         streamFileChunks(outgoingTransfers[id]).catch((err) => {
//           console.warn("streamFileChunks failed", err);
//         });
//       } catch (e) {
//         console.warn("failed to start streaming on file_accept", e);
//       }
//       return;
//     }

//     if (data.type === "file_decline") {
//       // notify UI that a peer declined your offer (optional)
//       const id = data.id;
//       if (onMessage) onMessage("__system_file_declined__", { id, from: data.from || conn.peer });
//       if (id && outgoingTransfers[id]) {
//         outgoingTransfers[id].stopped = true;
//         delete outgoingTransfers[id];
//       }
//       return;
//     }

//     if (data.type === "file_expired") {
//       // broadcast expiry — UI should silently remove offers/transfers (we follow your rule: no system message push)
//       const id = data.id;
//       if (onMessage) onMessage("__system_file_expired__", { id, from: data.from || conn.peer });
//       try {
//         if (incomingTransfers && incomingTransfers[id]) delete incomingTransfers[id];
//         if (outgoingTransfers && outgoingTransfers[id]) {
//           outgoingTransfers[id].stopped = true;
//           delete outgoingTransfers[id];
//         }
//       } catch (e) {}
//       return;
//     }

//     // file_chunk — may be binary (ArrayBuffer/TypedArray) or blob-like depending on PeerJS transport
//     if (data.type === "file_chunk") {
//       const id = data.id;
//       const seq = Number.isFinite(data.seq) ? data.seq : (incomingTransfers[id] ? incomingTransfers[id].lastSeq + 1 : 0);
//       const chunkBuf = data.chunk;
//       const total = data.totalBytes || (incomingTransfers[id] && incomingTransfers[id].totalBytes) || null;
//       const name = data.name || (incomingTransfers[id] && incomingTransfers[id].name) || "file";
//       const mime = data.mime || (incomingTransfers[id] && incomingTransfers[id].mime) || "application/octet-stream";
//       const from = data.from || conn.peer;

//       if (!incomingTransfers[id]) {
//         incomingTransfers[id] = {
//           from,
//           name,
//           mime,
//           totalBytes: total || null,
//           receivedBytes: 0,
//           chunks: [],
//           lastSeq: -1,
//         };
//       }

//       // Normalize chunk to ArrayBuffer if necessary
//       let arrBuf = null;
//       if (chunkBuf instanceof ArrayBuffer) arrBuf = chunkBuf;
//       else if (ArrayBuffer.isView(chunkBuf)) arrBuf = chunkBuf.buffer.slice(chunkBuf.byteOffset, chunkBuf.byteOffset + chunkBuf.byteLength);
//       else if (chunkBuf && typeof chunkBuf.arrayBuffer === "function") {
//         try { arrBuf = await chunkBuf.arrayBuffer(); } catch (e) { console.warn("Unable to convert chunk blob to ArrayBuffer", e); return; }
//       } else {
//         console.warn("Received file_chunk with unknown chunk type", chunkBuf);
//         return;
//       }

//       incomingTransfers[id].chunks.push({ seq, buf: arrBuf });
//       incomingTransfers[id].receivedBytes += arrBuf.byteLength;
//       incomingTransfers[id].lastSeq = seq;
//       incomingTransfers[id].totalBytes = incomingTransfers[id].totalBytes || total;
//       incomingTransfers[id].name = incomingTransfers[id].name || name;
//       incomingTransfers[id].mime = incomingTransfers[id].mime || mime;

//       if (onMessage) {
//         onMessage("__system_file_progress__", {
//           id,
//           from,
//           receivedBytes: incomingTransfers[id].receivedBytes,
//           totalBytes: incomingTransfers[id].totalBytes,
//           direction: "recv",
//           name: incomingTransfers[id].name,
//         });
//       }

//       // if total known and we've got enough bytes, finalize
//       if (incomingTransfers[id].totalBytes && incomingTransfers[id].receivedBytes >= incomingTransfers[id].totalBytes) {
//         const ordered = incomingTransfers[id].chunks.sort((a, b) => a.seq - b.seq);
//         const blobParts = ordered.map((c) => c.buf instanceof ArrayBuffer ? new Uint8Array(c.buf) : c.buf);
//         const blob = new Blob(blobParts, { type: incomingTransfers[id].mime || "application/octet-stream" });
//         const fromPeer = incomingTransfers[id].from;
//         const nameFile = incomingTransfers[id].name;
//         delete incomingTransfers[id];

//         if (onMessage) {
//           onMessage("__system_file_complete__", {
//             id,
//             from: fromPeer,
//             blob,
//             name: nameFile,
//             mime: blob.type,
//           });
//         }
//       }
//       return;
//     }

//     // file_end - fallback finalization if sender indicates end
//     if (data.type === "file_end") {
//       const id = data.id;
//       if (!id || !incomingTransfers[id]) return;
//       const ordered = incomingTransfers[id].chunks.sort((a, b) => a.seq - b.seq);
//       const blobParts = ordered.map((c) => c.buf instanceof ArrayBuffer ? new Uint8Array(c.buf) : c.buf);
//       const blob = new Blob(blobParts, { type: incomingTransfers[id].mime || "application/octet-stream" });
//       const fromPeer = incomingTransfers[id].from;
//       const nameFile = incomingTransfers[id].name;
//       delete incomingTransfers[id];
//       if (onMessage) {
//         onMessage("__system_file_complete__", {
//           id,
//           from: fromPeer,
//           blob,
//           name: nameFile,
//           mime: blob.type,
//         });
//       }
//       return;
//     }

//     /* ---------- END file handling ---------- */

//     // special: handle public leave signal so we reduce retries for that origin
//     if (data.type === "system_leave") {
//       // origin may be present in payload.origin (we set it in broadcastSystem)
//       const origin = data.origin || null;
//       console.log("PH: received leave notice from", origin, "-", data.text);
//       if (origin) {
//         retryCounts[origin] = MAX_RETRY_PER_PEER;
//         LAST_ATTEMPT[origin] = Date.now();
//       }
//       if (onMessage) onMessage("__system_leave__", data);
//       return;
//     }

//     // routing: if 'to' present and not for me, ignore
//     if (data.to && peer && data.to !== (peer.id || null) && data.to !== null) return;

//     if (data.type === "intro") {
//       // record name + peers
//       if (data.id && data.name) peerNames[data.id] = data.name;
//       if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

//       // add known peers to persisted set and try to connect to them
//       (data.peers || []).forEach((p) => {
//         if (!p || (peer && p === peer.id)) return;

//         // always persist known peer (useful for reconnect attempts)
//         addKnownPeer(p);

//         // do not try to actively connect if user intentionally left
//         try {
//           const leftAt = localStorage.getItem(LS_LEFT_AT);
//           if (leftAt) {
//             // user left — do not initiate outbound connects
//             console.log(
//               "PH: skipping connectToPeer for known peer because ph_left_at present:",
//               leftAt,
//               "peer:",
//               p
//             );
//             return;
//           }
//         } catch (e) {
//           console.warn(
//             "PH: error checking ph_left_at before connecting to known peer",
//             e
//           );
//         }

//         if (!connections[p]) {
//           // try connect after a tiny delay to avoid thundering herd
//           setTimeout(() => {
//             try {
//               connectToPeer(
//                 p,
//                 onMessageGlobal,
//                 onPeerListUpdateGlobal,
//                 (peer && peer.id && peerNames[peer.id]) || localName
//               );
//             } catch (e) {
//               console.warn("PH: connectToPeer failed for known peer", p, e);
//             }
//           }, 100);
//         }
//       });

//       if (onPeerListUpdate) {
//         try {
//           onPeerListUpdate([...peersList]);
//         } catch (e) {
//           console.warn(e);
//         }
//       }
//       return;
//     }

//     if (data.type === "typing") {
//       if (onMessage)
//         onMessage("__system_typing__", {
//           fromName: data.fromName,
//           isTyping: data.isTyping,
//         });
//       return;
//     }

//     if (data.type === "chat") {
//       // forward full payload to UI
//       if (onMessage) onMessage(data.from, data);

//       // ack delivery back to origin (route directly where possible)
//       const origin = data.origin || data.from;
//       if (origin && peer && origin !== peer.id) {
//         try {
//           sendAckDeliver(origin, data.id);
//         } catch (e) {
//           // fallback: broadcast ack so the origin sees it via the mesh
//           try {
//             broadcastRaw({
//               type: "ack_deliver",
//               id: data.id,
//               from: peer ? peer.id : null,
//               to: origin,
//             });
//           } catch (err) {
//             console.warn("PH: sendAckDeliver fallback failed", err);
//           }
//         }
//       }
//       return;
//     }

//     if (data.type === "ack_deliver") {
//       if (onMessage)
//         onMessage("__system_ack_deliver__", {
//           fromPeer: data.from,
//           id: data.id,
//         });
//       return;
//     }

//     if (data.type === "ack_read") {
//       if (onMessage)
//         onMessage("__system_ack_read__", { fromPeer: data.from, id: data.id });
//       return;
//     }

//     // fallback: pass other payloads to UI
//     if (onMessage) onMessage(data.from || conn.peer, data);
//   });

//   conn.on("close", () => {
//     try {
//       delete connections[conn.peer];
//     } catch (e) {}
//     peersList = peersList.filter((p) => p !== conn.peer);
//     delete peerNames[conn.peer];
//     if (onPeerListUpdate) {
//       try {
//         onPeerListUpdate([...peersList]);
//       } catch (e) {
//         console.warn(e);
//       }
//     }

//     // persist this peer so we can attempt reconnects later (unless user left)
//     try {
//       addKnownPeer(conn.peer);
//     } catch (e) {}

//     // start reconnect loop to re-establish dropped connections (respecting autojoin / left markers inside startReconnectLoop)
//     startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, (peer && peer.id && peerNames[peer.id]) || null);
//   });

//   conn.on("error", (err) => {
//     console.warn("Connection error with", conn.peer, err);

//     // schedule reconnect attempts (persist the peer)
//     try {
//       addKnownPeer(conn.peer);
//     } catch (e) {}

//     startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, (peer && peer.id && peerNames[peer.id]) || null);
//   });
// };

// /* ---------- stream file chunks (internal sender) ---------- */
// const streamFileChunks = async (transferState) => {
//   if (!transferState) throw new Error("no transfer state");
//   const { conn, file, chunkSize } = transferState;
//   if (!conn || conn.open === false) {
//     throw new Error("connection not open for file transfer");
//   }
//   let offset = transferState.offset || 0;
//   let seq = transferState.seq || 0;
//   const fileId = transferState.fileId;

//   while (offset < file.size && !transferState.stopped) {
//     const end = Math.min(offset + (chunkSize || DEFAULT_CHUNK_SIZE), file.size);
//     const slice = file.slice(offset, end);
//     const arrayBuf = await slice.arrayBuffer();

//     const chunkMsg = {
//       type: "file_chunk",
//       id: fileId,
//       seq,
//       chunk: arrayBuf,
//       totalBytes: file.size,
//       name: file.name,
//       mime: file.type || "application/octet-stream",
//       from: peer ? peer.id : null,
//     };

//     try {
//       sendRawToConn(conn, chunkMsg);
//     } catch (e) {
//       console.warn("streamFileChunks: failed to send chunk", e);
//       transferState.stopped = true;
//       break;
//     }

//     offset = end;
//     seq += 1;
//     transferState.sentBytes = offset;
//     transferState.seq = seq;
//     transferState.offset = offset;

//     if (onMessageGlobal) {
//       onMessageGlobal("__system_file_progress__", {
//         id: fileId,
//         from: peer ? peer.id : null,
//         sentBytes: transferState.sentBytes,
//         totalBytes: transferState.totalBytes || file.size,
//         direction: "send",
//         name: file.name,
//       });
//     }

//     // tiny yield
//     await new Promise((r) => setTimeout(r, 0));
//   }

//   try {
//     sendToConn(conn, { type: "file_end", id: fileId, from: peer ? peer.id : null });
//   } catch (e) {}

//   if (fileId && outgoingTransfers[fileId]) {
//     delete outgoingTransfers[fileId];
//   }
// };

// /* ---------- reconnect loop ---------- */

// const startReconnectLoop = (onMessage, onPeerListUpdate, localName) => {
//   // if the user intentionally left recently, don't auto reconnect
//   const leftAt = parseInt(localStorage.getItem(LS_LEFT_AT) || "0", 10);
//   if (leftAt && !isNaN(leftAt)) {
//     // optional: treat leave as permanent until explicit join — so block reconnect
//     console.log(
//       "PH: startReconnectLoop blocked because ph_left_at present:",
//       leftAt
//     );
//     return;
//   }

//   // gate by explicit autojoin flag
//   const shouldAutoNow = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
//   if (!shouldAutoNow) {
//     console.log(
//       "PH: startReconnectLoop skipped because autojoin flag is false"
//     );
//     return;
//   }

//   stopReconnectLoop();
//   console.log("PH: startReconnectLoop -> starting reconnect interval");
//   reconnectInterval = setInterval(() => {
//     // check flag every tick — stop if user disabled it in the meantime
//     const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
//     const leftNow = localStorage.getItem(LS_LEFT_AT);
//     if (!shouldAuto || leftNow) {
//       console.log(
//         "PH: reconnect loop stopping because autojoin false or left marker present",
//         { shouldAuto, leftNow }
//       );
//       stopReconnectLoop();
//       return;
//     }

//     // attempt connect to bootstrap
//     const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
//     if (
//       bootstrap &&
//       bootstrap !== getLocalPeerId() &&
//       !connections[bootstrap]
//     ) {
//       try {
//         console.log(
//           "PH: reconnect loop attempting bootstrap connect ->",
//           bootstrap
//         );
//         connectToPeer(bootstrap, onMessage, onPeerListUpdate, localName);
//       } catch (e) {
//         console.warn("PH: reconnect loop bootstrap connect failed", e);
//       }
//     }

//     // attempt connect to known peers (only when autojoin enabled)
//     const known = loadKnownPeers();
//     known.forEach((p) => {
//       if (!p || p === getLocalPeerId()) return;
//       if (!connections[p]) {
//         try {
//           // respect per-peer retry guard inside connectToPeer
//           console.log("PH: reconnect loop attempting known peer connect ->", p);
//           connectToPeer(p, onMessage, onPeerListUpdate, localName);
//         } catch (e) {
//           console.warn("PH: reconnect loop known peer connect failed", e);
//         }
//       }
//     });
//   }, RECONNECT_INTERVAL_MS);
// };

// const stopReconnectLoop = () => {
//   if (reconnectInterval) {
//     clearInterval(reconnectInterval);
//     reconnectInterval = null;
//   }
// };

// /* ---------- initPeer: create Peer & set handlers ---------- */
// export const initPeer = (
//   onMessage,
//   onPeerListUpdate,
//   localName = "Anonymous",
//   onBootstrapChange = null
// ) => {
//   onMessageGlobal = onMessage || null;
//   onPeerListUpdateGlobal = onPeerListUpdate || null;
//   onBootstrapChangedGlobal = onBootstrapChange || null;

//   // try stored id or generate one
//   let storedId = localStorage.getItem(LS_PEER_ID);
//   if (!storedId) {
//     storedId = nanoid(6);
//     localStorage.setItem(LS_PEER_ID, storedId);
//   }

//   const createPeerWithId = (id) => {
//     try {
//       peer = new Peer(id);

//       peer.on("open", (idOpen) => {
//         // ensure we persist the id used
//         localStorage.setItem(LS_PEER_ID, idOpen);
//         peerNames[idOpen] = localName;

//         // only auto-connect if user previously opted to autojoin
//         const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
//         if (shouldAuto) {
//           // attempt immediate connect to bootstrap (if set)
//           const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
//           if (bootstrap && bootstrap !== idOpen) {
//             try {
//               connectToPeer(
//                 bootstrap,
//                 onMessageGlobal,
//                 onPeerListUpdateGlobal,
//                 localName
//               );
//             } catch (e) {}
//           }

//           // try known peers quickly
//           const known = loadKnownPeers();
//           known.forEach((p) => {
//             if (!p || p === idOpen) return;
//             if (!connections[p]) {
//               try {
//                 connectToPeer(
//                   p,
//                   onMessageGlobal,
//                   onPeerListUpdateGlobal,
//                   localName
//                 );
//               } catch (e) {}
//             }
//           });

//           // start reconnect loop to be resilient
//           startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, localName);
//         } else {
//           // user has explicitly disabled auto-join -> ensure no reconnect loop runs
//           stopReconnectLoop();
//         }
//       });

//       // handle graceful reconnect hints
//       peer.on("disconnected", () => {
//         console.warn("Peer disconnected — will rely on reconnect loop to recover.");
//         startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, (peer && peer.id && peerNames[peer.id]) || null);
//       });

//       peer.on("close", () => {
//         console.warn("Peer closed");
//         peer = null;
//       });

//       peer.on("connection", (conn) => {
//         try {
//           const leftAt = localStorage.getItem(LS_LEFT_AT);
//           if (leftAt) {
//             // user intentionally left — refuse inbound connection politely
//             console.log(
//               "PH: refusing inbound connection because user left at",
//               leftAt,
//               "-> closing conn to",
//               conn.peer
//             );
//             try {
//               conn.close && conn.close();
//             } catch (e) {}
//             return;
//           }
//         } catch (e) {
//           console.warn(
//             "PH: error checking left marker for inbound connection",
//             e
//           );
//         }

//         // otherwise proceed as usual
//         setupConnection(conn, onMessageGlobal, onPeerListUpdateGlobal, localName);
//       });

//       peer.on("error", (err) => {
//         console.warn("Peer error", err);
//         // if id taken / unavailable, create a new one
//         // PeerJS may emit an error like 'ID is taken' — handle by recreating with new id
//         try {
//           const msg = err && (err.type || err.message || String(err));
//           if (err && (err.type === "unavailable-id" || (typeof msg === "string" && msg.toLowerCase().includes("taken")))) {
//             const newId = nanoid(6);
//             localStorage.setItem(LS_PEER_ID, newId);
//             // destroy old peer then recreate
//             try {
//               peer.destroy && peer.destroy();
//             } catch (e) {}
//             return createPeerWithId(newId);
//           }
//         } catch (e) {}
//       });

//       // return peer instance
//       return peer;
//     } catch (e) {
//       console.warn("createPeerWithId failed", e);
//       // try again with random id
//       const newId = nanoid(6);
//       localStorage.setItem(LS_PEER_ID, newId);
//       return createPeerWithId(newId);
//     }
//   };

//   return createPeerWithId(storedId);
// };



