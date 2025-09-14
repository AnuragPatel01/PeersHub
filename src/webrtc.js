// // new integration

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
//         peerNames[peer.id]
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
//     sendToConn(conn, { type: "ack_deliver", id: msgId, from: peer.id });
//   } else {
//     // route fallback — include to so only the origin processes it
//     broadcastRaw({
//       type: "ack_deliver",
//       id: msgId,
//       from: peer.id,
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
//         from: peer.id,
//       });
//       return;
//     }
//     // fallback route
//     broadcastRaw({
//       type: "ack_read",
//       id: msgId,
//       from: peer.id,
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

// /* ---------- connection management ---------- */

// /**
//  * connectToPeer:
//  * - respects LS_LEFT_AT (do not initiate outbound connections if user intentionally left)
//  * - creates PeerJS DataConnection and calls setupConnection
//  */
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
//       id: peer.id,
//       name: peerNames[peer.id] || localName,
//       peers: [...peersList],
//     });
//   });

//   conn.on("data", (raw) => {
//     const data = parseMessage(raw);
//     if (!data || typeof data !== "object") return;

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
//     if (data.to && data.to !== peer.id) return;

//     if (data.type === "intro") {
//       // record name + peers
//       if (data.id && data.name) peerNames[data.id] = data.name;
//       if (data.id && !peersList.includes(data.id)) peersList.push(data.id);

//       // add known peers to persisted set and try to connect to them
//       (data.peers || []).forEach((p) => {
//         if (!p || p === peer.id) return;

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
//                 peerNames[peer.id] || localName
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
//       if (origin && origin !== peer.id) {
//         try {
//           sendAckDeliver(origin, data.id);
//         } catch (e) {
//           // fallback: broadcast ack so the origin sees it via the mesh
//           try {
//             broadcastRaw({
//               type: "ack_deliver",
//               id: data.id,
//               from: peer.id,
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
//     startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id]);
//   });

//   conn.on("error", (err) => {
//     console.warn("Connection error with", conn.peer, err);

//     // schedule reconnect attempts (persist the peer)
//     try {
//       addKnownPeer(conn.peer);
//     } catch (e) {}

//     startReconnectLoop(onMessageGlobal, onPeerListUpdateGlobal, peerNames[peer.id]);
//   });
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
//           if (err && err.type === "unavailable-id") {
//             const newId = nanoid(6);
//             localStorage.setItem(LS_PEER_ID, newId);
//             // destroy old peer then recreate
//             try {
//               peer.destroy && peer.destroy();
//             } catch (e) {}
//             createPeerWithId(newId);
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

// ---------- src/webrtc.js (updated: disk-to-disk streaming) ----------

/*
  Changes summary (in-code comments):
  - sendToConn no longer stringifies non-string payloads so we can send binary (ArrayBuffer/Blob) via structured clone.
  - New file transfer message types: file_offer, file_offer_response, file_chunk, file_transfer_done, file_transfer_cancel
  - Sender streams file via File.stream() and sends chunks to accepting peers only (per-accept).
  - Receiver uses File System Access API (showSaveFilePicker / createWritable) to write chunks directly to disk without buffering whole file in memory.
  - 10s accept/ignore timeout is handled in Chat.jsx UI which triggers file_offer_response accordingly.
  - All existing behavior preserved (intro, reconnect, acks, etc.).
*/

import Peer from "peerjs";
import { nanoid } from "nanoid";

let peer = null;
let connections = {}; // peerId -> DataConnection
let peersList = [];
let peerNames = {};

const LS_PEER_ID = "ph_peer_id";
const LS_HUB_BOOTSTRAP = "ph_hub_bootstrap";
const LS_KNOWN_PEERS = "ph_known_peers";
const LS_LOCAL_NAME = "ph_name";
const LS_SHOULD_AUTOJOIN = "ph_should_autojoin";
const LS_LEFT_AT = "ph_left_at";

let reconnectInterval = null;
const RECONNECT_INTERVAL_MS = 3000;

const retryCounts = {};
const LAST_ATTEMPT = {};
const MAX_RETRY_PER_PEER = 6;
const BACKOFF_BASE_MS = 2000;
const COOLDOWN_AFTER_MAX = 5 * 60 * 1000;

let onMessageGlobal = null;
let onPeerListUpdateGlobal = null;
let onBootstrapChangedGlobal = null;

window.__PH_debug = () => ({
  peerId: peer ? peer.id : null,
  connections: Object.keys(connections || {}),
  peersList,
  peerNames,
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

window.__PH_resumeReconnect = () => {
  try {
    localStorage.removeItem(LS_LEFT_AT);
    localStorage.setItem(LS_SHOULD_AUTOJOIN, "true");
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

// Updated: do NOT stringify objects — we rely on structured clone for objects with ArrayBuffer/Blob
const sendToConn = (conn, payload) => {
  try {
    if (!conn || conn.open === false) return;
    if (typeof payload === "string") conn.send(payload);
    else conn.send(payload); // allow structured clone (ArrayBuffer, Blob, objects)
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

export const sendChat = (msgObj) => {
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
    broadcastRaw({
      type: "ack_deliver",
      id: msgId,
      from: peer.id,
      to: toPeerId,
    });
  }
};

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

export const broadcastSystem = (type, text, id = null) => {
  try {
    const payload = {
      type: type || "system_public",
      text: text || "",
      id: id || `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      origin: peer ? peer.id : null,
    };
    broadcastRaw(payload);
  } catch (e) {
    console.warn("broadcastSystem failed", e);
  }
};

export const getPeers = () => [...peersList];
export const getPeerNames = () => ({ ...peerNames });
export const getLocalPeerId = () =>
  peer ? peer.id : localStorage.getItem(LS_PEER_ID) || null;
export const getKnownPeers = () => Array.from(loadKnownPeers());

/* ---------- File transfer helpers ---------- */
// file offer structure: { type: 'file_offer', id: offerId, from: peer.id, name, size, mime }
// file offer response: { type: 'file_offer_response', id: offerId, from: peer.id, accept: true/false }
// file_chunk: { type: 'file_chunk', id: offerId, seq, chunk (ArrayBuffer), final: boolean }
// file_transfer_done: { type: 'file_transfer_done', id: offerId }

// sender: create offer to specific peers (or broadcast)
export const offerFileToPeers = (fileMeta, targetPeerIds = []) => {
  // fileMeta must include: offerId, name, size, mime
  const payload = {
    type: "file_offer",
    ...fileMeta,
    from: peer ? peer.id : null,
  };
  if (!targetPeerIds || targetPeerIds.length === 0) {
    broadcastRaw(payload);
    return;
  }
  targetPeerIds.forEach((pid) => {
    const conn = connections[pid];
    if (conn) sendToConn(conn, payload);
  });
};

// internal: start streaming file to one specific peer connection
const streamFileToConn = async (conn, file, offerId) => {
  try {
    if (!conn || conn.open === false) return;
    // read stream from file and send chunks
    const reader = file.stream().getReader();
    let seq = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // value is a Uint8Array (chunk)
      // send structured object with chunk as ArrayBuffer — structured cloning will transfer it
      sendToConn(conn, {
        type: "file_chunk",
        id: offerId,
        seq: seq++,
        chunk: value.buffer,
        final: false,
      });
      // small throttle to yield - avoid blocking event loop
      await new Promise((r) => setTimeout(r, 0));
    }
    // send final marker
    sendToConn(conn, {
      type: "file_chunk",
      id: offerId,
      seq: seq,
      chunk: null,
      final: true,
    });
    // notify done
    sendToConn(conn, {
      type: "file_transfer_done",
      id: offerId,
      from: peer.id,
    });
  } catch (e) {
    console.warn("streamFileToConn error", e);
    try {
      sendToConn(conn, {
        type: "file_transfer_cancel",
        id: offerId,
        from: peer.id,
        reason: e && e.message,
      });
    } catch (err) {}
  }
};

// public: sender triggers streaming to a set of accepting peers
export const startSendingFile = (file, offerId, acceptingPeerIds = []) => {
  acceptingPeerIds.forEach((pid) => {
    const conn = connections[pid];
    if (conn) streamFileToConn(conn, file, offerId);
  });
};

// receiver: helper to respond to offer
export const respondToFileOffer = (offerId, toPeerId, accept) => {
  const conn = connections[toPeerId];
  if (!conn) {
    // fallback broadcast so origin gets it
    broadcastRaw({
      type: "file_offer_response",
      id: offerId,
      from: peer.id,
      accept,
    });
    return;
  }
  sendToConn(conn, {
    type: "file_offer_response",
    id: offerId,
    from: peer.id,
    accept,
  });
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

/* ---------- setupConnection (updated to route file messages to UI) ---------- */
const setupConnection = (
  conn,
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous"
) => {
  try {
    const leftAt = localStorage.getItem(LS_LEFT_AT);
    if (leftAt) {
      try {
        conn.close && conn.close();
      } catch (e) {}
      return;
    }
  } catch (e) {
    console.warn("PH: error checking left marker before setupConnection:", e);
  }

  conn.on("open", () => {
    connections[conn.peer] = conn;
    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    if (onPeerListUpdate)
      try {
        onPeerListUpdate([...peersList]);
      } catch (e) {
        console.warn(e);
      }
    retryCounts[conn.peer] = 0;
    LAST_ATTEMPT[conn.peer] = 0;
    sendToConn(conn, {
      type: "intro",
      id: peer.id,
      name: peerNames[peer.id] || localName,
      peers: [...peersList],
    });
  });

  conn.on("data", async (raw) => {
    const data = parseMessage(raw);
    if (!data || typeof data !== "object") return;

    if (data.type === "system_leave") {
      const origin = data.origin || null;
      if (origin) {
        retryCounts[origin] = MAX_RETRY_PER_PEER;
        LAST_ATTEMPT[origin] = Date.now();
      }
      if (onMessage) onMessage("__system_leave__", data);
      return;
    }

    if (data.to && data.to !== peer.id) return;

    if (data.type === "intro") {
      if (data.id && data.name) peerNames[data.id] = data.name;
      if (data.id && !peersList.includes(data.id)) peersList.push(data.id);
      (data.peers || []).forEach((p) => {
        if (!p || p === peer.id) return;
        addKnownPeer(p);
        try {
          const leftAt = localStorage.getItem(LS_LEFT_AT);
          if (leftAt) return;
        } catch (e) {}
        if (!connections[p])
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
      });
      if (onPeerListUpdate)
        try {
          onPeerListUpdate([...peersList]);
        } catch (e) {
          console.warn(e);
        }
      return;
    }

    // file transfer signaling/flow
    if (data.type === "file_offer") {
      // forward offer to UI so it can present accept/ignore prompt
      if (onMessage) onMessage("__system_file_offer__", data);
      return;
    }

    if (data.type === "file_offer_response") {
      // forward response to UI (sender will start streaming if accept:true)
      if (onMessage) onMessage("__system_file_offer_response__", data);
      return;
    }

    if (data.type === "file_chunk") {
      // chunks may contain ArrayBuffer in data.chunk (structured)
      if (onMessage) onMessage("__system_file_chunk__", data);
      return;
    }

    if (
      data.type === "file_transfer_done" ||
      data.type === "file_transfer_cancel"
    ) {
      if (onMessage) onMessage("__system_file_transfer_done__", data);
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
      if (onMessage) onMessage(data.from, data);
      const origin = data.origin || data.from;
      if (origin && origin !== peer.id) {
        try {
          sendAckDeliver(origin, data.id);
        } catch (e) {
          broadcastRaw({
            type: "ack_deliver",
            id: data.id,
            from: peer.id,
            to: origin,
          });
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

    if (onMessage) onMessage(data.from || conn.peer, data);
  });

  conn.on("close", () => {
    try {
      delete connections[conn.peer];
    } catch (e) {}
    peersList = peersList.filter((p) => p !== conn.peer);
    delete peerNames[conn.peer];
    if (onPeerListUpdate)
      try {
        onPeerListUpdate([...peersList]);
      } catch (e) {
        console.warn(e);
      }
    try {
      addKnownPeer(conn.peer);
    } catch (e) {}
    startReconnectLoop(
      onMessageGlobal,
      onPeerListUpdateGlobal,
      peerNames[peer.id]
    );
  });

  conn.on("error", (err) => {
    console.warn("Connection error with", conn.peer, err);
    try {
      addKnownPeer(conn.peer);
    } catch (e) {}
    startReconnectLoop(
      onMessageGlobal,
      onPeerListUpdateGlobal,
      peerNames[peer.id]
    );
  });
};

const startReconnectLoop = (onMessage, onPeerListUpdate, localName) => {
  const leftAt = parseInt(localStorage.getItem(LS_LEFT_AT) || "0", 10);
  if (leftAt && !isNaN(leftAt)) {
    console.log(
      "PH: startReconnectLoop blocked because ph_left_at present:",
      leftAt
    );
    return;
  }
  const shouldAutoNow = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
  if (!shouldAutoNow) {
    console.log(
      "PH: startReconnectLoop skipped because autojoin flag is false"
    );
    return;
  }
  stopReconnectLoop();
  reconnectInterval = setInterval(() => {
    const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
    const leftNow = localStorage.getItem(LS_LEFT_AT);
    if (!shouldAuto || leftNow) {
      stopReconnectLoop();
      return;
    }
    const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
    if (
      bootstrap &&
      bootstrap !== getLocalPeerId() &&
      !connections[bootstrap]
    ) {
      try {
        connectToPeer(bootstrap, onMessage, onPeerListUpdate, localName);
      } catch (e) {
        console.warn("PH: reconnect loop bootstrap connect failed", e);
      }
    }
    const known = loadKnownPeers();
    known.forEach((p) => {
      if (!p || p === getLocalPeerId()) return;
      if (!connections[p]) {
        try {
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

export const connectToPeer = (
  peerId,
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous"
) => {
  try {
    if (localStorage.getItem(LS_LEFT_AT)) {
      retryCounts[peerId] = MAX_RETRY_PER_PEER;
      LAST_ATTEMPT[peerId] = Date.now();
      return;
    }
  } catch (e) {}
  if (!peer) return;
  if (!peerId) return;
  if (peerId === peer.id) return;
  if (connections[peerId]) return;
  const now = Date.now();
  const last = LAST_ATTEMPT[peerId] || 0;
  const tries = retryCounts[peerId] || 0;
  if (tries >= MAX_RETRY_PER_PEER) {
    if (now - last < COOLDOWN_AFTER_MAX) return;
    else retryCounts[peerId] = 0;
  }
  const backoff = BACKOFF_BASE_MS * Math.pow(2, tries);
  if (now - last < backoff) return;
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
  localStorage.setItem(LS_SHOULD_AUTOJOIN, "true");
  localStorage.removeItem(LS_LEFT_AT);
  if (onBootstrapChangedGlobal) onBootstrapChangedGlobal(bootstrapPeerId);
};

export const leaveHub = () => {
  // stop reconnect loop immediately
  try {
    stopReconnectLoop();
  } catch (e) {
    console.warn("leaveHub: stopReconnectLoop failed", e);
  }

  // set left marker FIRST to prevent any reconnect racing
  try {
    localStorage.setItem(LS_LEFT_AT, Date.now().toString());
    // also proactively disable autojoin flag
    localStorage.setItem(LS_SHOULD_AUTOJOIN, "false");
  } catch (e) {
    console.warn("leaveHub: failed to set left marker / disable autojoin", e);
  }

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
    const myName =
      peerNames[myId] || localStorage.getItem(LS_LOCAL_NAME) || "Unknown";
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

  // clear persistence keys — do each call so one failure doesn't abort the rest
  try {
    localStorage.removeItem(LS_HUB_BOOTSTRAP);
  } catch (e) {
    console.warn("leaveHub: remove ph_hub_bootstrap failed", e);
  }
  try {
    localStorage.removeItem(LS_SHOULD_AUTOJOIN);
  } catch (e) {
    console.warn("leaveHub: remove ph_should_autojoin failed", e);
  }
  try {
    localStorage.removeItem(LS_KNOWN_PEERS);
  } catch (e) {
    console.warn("leaveHub: remove ph_known_peers failed", e);
  }
  // Note: we already set LS_LEFT_AT above; don't overwrite it here.

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
    "PH: leaveHub() -> cleared bootstrap, autojoin, known peers and set left marker"
  );
};

export const initPeer = (
  onMessage,
  onPeerListUpdate,
  localName = "Anonymous",
  onBootstrapChange = null
) => {
  onMessageGlobal = onMessage || null;
  onPeerListUpdateGlobal = onPeerListUpdate || null;
  onBootstrapChangedGlobal = onBootstrapChange || null;
  let storedId = localStorage.getItem(LS_PEER_ID);
  if (!storedId) {
    storedId = nanoid(6);
    localStorage.setItem(LS_PEER_ID, storedId);
  }
  const createPeerWithId = (id) => {
    try {
      peer = new Peer(id);
      peer.on("open", (idOpen) => {
        localStorage.setItem(LS_PEER_ID, idOpen);
        peerNames[idOpen] = localName;
        const shouldAuto = localStorage.getItem(LS_SHOULD_AUTOJOIN) === "true";
        if (shouldAuto) {
          const bootstrap = localStorage.getItem(LS_HUB_BOOTSTRAP);
          if (bootstrap && bootstrap !== idOpen)
            try {
              connectToPeer(
                bootstrap,
                onMessageGlobal,
                onPeerListUpdateGlobal,
                localName
              );
            } catch (e) {}
          const known = loadKnownPeers();
          known.forEach((p) => {
            if (!p || p === idOpen) return;
            if (!connections[p])
              try {
                connectToPeer(
                  p,
                  onMessageGlobal,
                  onPeerListUpdateGlobal,
                  localName
                );
              } catch (e) {}
          });
          startReconnectLoop(
            onMessageGlobal,
            onPeerListUpdateGlobal,
            localName
          );
        } else stopReconnectLoop();
      });
      peer.on("connection", (conn) => {
        try {
          const leftAt = localStorage.getItem(LS_LEFT_AT);
          if (leftAt) {
            conn.close && conn.close();
            return;
          }
        } catch (e) {}
        setupConnection(
          conn,
          onMessageGlobal,
          onPeerListUpdateGlobal,
          localName
        );
      });
      peer.on("error", (err) => {
        console.warn("Peer error", err);
        try {
          if (err && err.type === "unavailable-id") {
            const newId = nanoid(6);
            localStorage.setItem(LS_PEER_ID, newId);
            try {
              peer.destroy && peer.destroy();
            } catch (e) {}
            createPeerWithId(newId);
          }
        } catch (e) {}
      });
      return peer;
    } catch (e) {
      console.warn("createPeerWithId failed", e);
      const newId = nanoid(6);
      localStorage.setItem(LS_PEER_ID, newId);
      return createPeerWithId(newId);
    }
  };
  return createPeerWithId(storedId);
};

// expose a helper to request file save permission from outside if needed
export const supportsNativeFileSystem = () => {
  return (
    typeof window.showSaveFilePicker === "function" ||
    typeof window.chooseFileSystemEntries === "function"
  );
};

// respondToFileOffer, offerFileToPeers, startSendingFile exported earlier

// ---------- end of webrtc.js ----------
