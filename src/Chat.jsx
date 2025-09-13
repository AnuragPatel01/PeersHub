

// // src/components/Chat.jsx
// import "./App.css";

// import React, { useEffect, useState, useRef } from "react";
// import {
//   initPeer,
//   sendChat,
//   sendTyping,
//   sendAckRead,
//   getPeerNames,
//   joinHub,
//   leaveHub,
//   getLocalPeerId,
//   connectToPeer,
//   broadcastSystem,

// } from "./webrtc";
// // notification helpers
// import { requestNotificationPermission, showNotification } from "./notify";
// // id generator
// import { nanoid } from "nanoid";

// /**
//  * Chat.jsx (fixed for read-acks)
//  *
//  * - Auto-send ack_read immediately when message arrives and document is visible
//  * - On visibilitychange -> send ack_read for any unread messages
//  * - Keeps tap-to-reply behavior (still sends ack_read)
//  * - Keeps all UI classes/colors intact
//  */

// const LS_MSGS = "ph_msgs_v1";
// const MAX_MSGS = 100;

// export default function Chat() {
//   const [myId, setMyId] = useState(() => getLocalPeerId() || "...");
//   const [peers, setPeers] = useState([]);
//   const [peerNamesMap, setPeerNamesMap] = useState({});
//   const [messages, setMessages] = useState(() => {
//     try {
//       const raw = localStorage.getItem(LS_MSGS);
//       if (raw) return JSON.parse(raw);
//     } catch (e) {}
//     return [];
//   });
//   const [text, setText] = useState("");
//   const [username, setUsername] = useState(
//     () => localStorage.getItem("ph_name") || ""
//   );
//   const [showNamePrompt, setShowNamePrompt] = useState(
//     () => !localStorage.getItem("ph_name")
//   );
//   const [joinedBootstrap, setJoinedBootstrap] = useState(() => {
//     const id = localStorage.getItem("ph_hub_bootstrap") || "";
//     const should = localStorage.getItem("ph_should_autojoin") === "true";
//     return should ? id : "";
//   });
//   const [menuOpen, setMenuOpen] = useState(false);
//   const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

//   useEffect(() => {
//     if (!username) return;
//     requestNotificationPermission().then((granted) => {
//       console.log("Notification permission granted:", granted);
//     });
//   }, [username]);

//   const messagesEndRef = useRef(null);
//   const seenSystemIdsRef = useRef(new Set());
//   const peerRef = useRef(null);
//   const menuRef = useRef(null);

//   // typingUsers: { [name]: timestamp }
//   const [typingUsers, setTypingUsers] = useState({});
//   const [replyTo, setReplyTo] = useState(null);
//   const typingTimeoutRef = useRef(null);

//   // helper to show notification only when appropriate
//   const maybeNotify = (fromDisplay, text) => {
//     try {
//       if (!fromDisplay || fromDisplay === username) return;
//       if (!document.hidden && document.hasFocus()) return;

//       const title = `${fromDisplay}`;
//       const body =
//         typeof text === "string"
//           ? text.length > 120
//             ? text.slice(0, 117) + "..."
//             : text
//           : JSON.stringify(text);
//       showNotification(title, {
//         body,
//         tag: `peershub-${fromDisplay}`,
//         data: { from: fromDisplay },
//       });
//     } catch (e) {
//       console.warn("maybeNotify error", e);
//     }
//   };

//   // persist messages to localStorage (trimmed)
//   const persistMessages = (arr) => {
//     try {
//       const tail = arr.slice(-MAX_MSGS);
//       localStorage.setItem(LS_MSGS, JSON.stringify(tail));
//     } catch (e) {}
//   };

//   // add or merge incoming chat
//   const upsertIncomingChat = (incoming) => {
//     setMessages((m) => {
//       const exists = m.find((x) => x.id === incoming.id);
//       if (exists) {
//         const next = m.map((x) =>
//           x.id === incoming.id ? { ...x, ...incoming } : x
//         );
//         persistMessages(next);
//         return next;
//       }
//       const msgObj = {
//         id: incoming.id,
//         from: incoming.fromName || incoming.from || "peer",
//         fromId: incoming.from,
//         text: incoming.text,
//         ts: incoming.ts || Date.now(),
//         type: "chat",
//         replyTo: incoming.replyTo || null,
//         deliveries: incoming.deliveries || [],
//         reads: incoming.reads || [],
//       };
//       const next = [...m, msgObj];
//       persistMessages(next);
//       return next;
//     });
//   };

//   // utility used by acks to update arrays safely
//   const addUniqueToMsgArray = (msgId, field, peerId) => {
//     setMessages((m) => {
//       const next = m.map((msg) => {
//         if (msg.id !== msgId) return msg;
//         const arr = Array.isArray(msg[field]) ? [...msg[field]] : [];
//         if (!arr.includes(peerId)) arr.push(peerId);
//         return { ...msg, [field]: arr };
//       });
//       persistMessages(next);
//       return next;
//     });
//   };

//   // incoming messages callback from webrtc
//   const handleIncoming = (from, payloadOrText) => {
//     // typing system
//     if (
//       from === "__system_typing__" &&
//       payloadOrText &&
//       payloadOrText.fromName
//     ) {
//       const { fromName, isTyping } = payloadOrText;
//       setTypingUsers((t) => {
//         const copy = { ...t };
//         if (isTyping) copy[fromName] = Date.now();
//         else delete copy[fromName];
//         return copy;
//       });
//       return;
//     }

//     // ack deliver
//     if (
//       from === "__system_ack_deliver__" &&
//       payloadOrText &&
//       payloadOrText.id
//     ) {
//       const { fromPeer, id } = payloadOrText;
//       addUniqueToMsgArray(id, "deliveries", fromPeer);
//       return;
//     }

//     // ack read
//     if (from === "__system_ack_read__" && payloadOrText && payloadOrText.id) {
//       const { fromPeer, id } = payloadOrText;
//       addUniqueToMsgArray(id, "reads", fromPeer);
//       return;
//     }

//     // system messages
//     if (
//       payloadOrText &&
//       typeof payloadOrText === "object" &&
//       payloadOrText.type &&
//       payloadOrText.id &&
//       payloadOrText.type.toString().startsWith("system")
//     ) {
//       const { type, text: txt, id } = payloadOrText;
//       if (seenSystemIdsRef.current.has(id)) return;
//       seenSystemIdsRef.current.add(id);
//       const msg = {
//         id,
//         from: "System",
//         text: txt,
//         ts: Date.now(),
//         type,
//         deliveries: [],
//         reads: [],
//       };
//       setMessages((m) => {
//         const next = [...m, msg];
//         persistMessages(next);
//         return next;
//       });
//       if (type === "system_public") maybeNotify("System", txt);
//       return;
//     }

//     // chat object
//     if (
//       payloadOrText &&
//       typeof payloadOrText === "object" &&
//       payloadOrText.type === "chat" &&
//       payloadOrText.id
//     ) {
//       upsertIncomingChat(payloadOrText);
//       maybeNotify(
//         payloadOrText.fromName || payloadOrText.from,
//         payloadOrText.text
//       );

//       // --- NEW: auto-send ack_read NOW if the app is visible and message not from me ---
//       try {
//         const origin = payloadOrText.from || payloadOrText.origin || null;
//         const localId = getLocalPeerId() || myId;
//         // only send ack_read if origin exists and origin is not me
//         if (
//           origin &&
//           origin !== localId &&
//           document.visibilityState === "visible"
//         ) {
//           // send ack_read to origin
//           try {
//             sendAckRead(payloadOrText.id, origin);
//           } catch (e) {
//             console.warn("sendAckRead error (auto on receive):", e);
//           }
//           // locally record read
//           addUniqueToMsgArray(payloadOrText.id, "reads", localId);
//         }
//       } catch (e) {
//         console.warn("auto ack_read failed", e);
//       }

//       // webrtc.js already sends ack_deliver back to origin when it receives chat
//       return;
//     }

//     // plain string fallback
//     if (typeof payloadOrText === "string") {
//       const safeText = payloadOrText;
//       const newMsg = {
//         id: nanoid(),
//         from: from || "peer",
//         fromId: null,
//         text: safeText,
//         ts: Date.now(),
//         type: "chat",
//         deliveries: [],
//         reads: [],
//       };
//       setMessages((m) => {
//         const next = [...m, newMsg];
//         persistMessages(next);
//         return next;
//       });
//       maybeNotify(from, safeText);
//       return;
//     }
//   };

//   // peer list update callback
//   const handlePeerListUpdate = (list) => {
//     setPeers(list || []);
//     try {
//       const names = getPeerNames();
//       setPeerNamesMap(names || {});
//     } catch (e) {}
//   };

//   // handle bootstrap change
//   const handleBootstrapChange = (newBootstrapId) => {
//     setJoinedBootstrap(newBootstrapId || "");
//   };

//   // init peer when username available
//   useEffect(() => {
//     if (!username) return;
//     const p = initPeer(
//       handleIncoming,
//       handlePeerListUpdate,
//       username,
//       handleBootstrapChange
//     );
//     peerRef.current = p;
//     p.on && p.on("open", (id) => setMyId(id));
//     const bootstrap = localStorage.getItem("ph_hub_bootstrap");
//     setJoinedBootstrap(bootstrap || "");
//     return () => {
//       try {
//         p && p.destroy && p.destroy();
//       } catch (e) {}
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [username]);

//   // autoscroll to bottom when messages change
//   useEffect(() => {
//     if (!messagesEndRef.current) return;
//     try {
//       messagesEndRef.current.scrollIntoView({
//         behavior: "smooth",
//         block: "end",
//       });
//     } catch (e) {}
//   }, [messages]);

//   // when tab becomes visible, send ack_read for any unread messages
//   useEffect(() => {
//     const onVisibility = () => {
//       if (document.visibilityState === "visible") {
//         const localId = getLocalPeerId() || myId;
//         messages.forEach((m) => {
//           if (!m || m.type !== "chat") return;
//           // only for messages from other peers and not already read by me
//           const origin = m.fromId || m.from;
//           if (!origin || origin === localId) return;
//           const alreadyRead =
//             Array.isArray(m.reads) && m.reads.includes(localId);
//           if (!alreadyRead) {
//             try {
//               sendAckRead(m.id, origin);
//             } catch (e) {
//               console.warn("sendAckRead error (on visibility):", e);
//             }
//             addUniqueToMsgArray(m.id, "reads", localId);
//           }
//         });
//       }
//     };
//     document.addEventListener("visibilitychange", onVisibility);
//     // also run once in case the page is already visible when component mounts
//     if (document.visibilityState === "visible") onVisibility();
//     return () => document.removeEventListener("visibilitychange", onVisibility);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [messages, myId]);

//   // menu outside click handler
//   useEffect(() => {
//     const onDocClick = (e) => {
//       if (!menuRef.current) return;
//       if (!menuRef.current.contains(e.target)) setMenuOpen(false);
//     };
//     if (menuOpen) document.addEventListener("mousedown", onDocClick);
//     else document.removeEventListener("mousedown", onDocClick);
//     return () => document.removeEventListener("mousedown", onDocClick);
//   }, [menuOpen]);

//   // typing broadcast: debounce while typing
//   useEffect(() => {
//     if (!username) return;
//     if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
//     try {
//       if (typeof sendTyping === "function") sendTyping(username, true);
//     } catch (e) {}
//     typingTimeoutRef.current = setTimeout(() => {
//       try {
//         if (typeof sendTyping === "function") sendTyping(username, false);
//       } catch (e) {}
//     }, 1200);
//     return () => {
//       if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [text]);

//   // Create Hub
//   const handleCreateHub = () => {
//   const id = getLocalPeerId() || myId;
//   if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
//   joinHub(id);
//   setJoinedBootstrap(id);

//   // persist hub + autojoin flag
//   localStorage.setItem("ph_hub_bootstrap", id);
//   localStorage.setItem("ph_should_autojoin", "true");

//   // local system message for the creator
//   const sysPlain = {
//     id: `sys-create-${Date.now()}`,
//     from: "System",
//     text: `You created the hub. Share this ID: ${id}`,
//     ts: Date.now(),
//     type: "system",
//   };
//   setMessages((m) => {
//     const next = [...m, sysPlain];
//     persistMessages(next);
//     return next;
//   });

//   // BROADCAST public system announcement so others know who the host is
//   try {
//     const publicText = `[${username || "Host"}] is the host`;
//     broadcastSystem("system_public", publicText, `sys-host-${id}`);
//   } catch (e) {
//     console.warn("broadcastSystem failed", e);
//   }

//   setMenuOpen(false);
// };

//   // Join Hub
//   const handleJoinHub = async () => {
//     const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
//     if (!id) {
//       setMenuOpen(false);
//       return;
//     }
//     const trimmed = id.trim();
//     joinHub(trimmed);
//     setJoinedBootstrap(trimmed);

//     // persist hub + autojoin flag
//     localStorage.setItem("ph_hub_bootstrap", trimmed);
//     localStorage.setItem("ph_should_autojoin", "true");

//     try {
//       connectToPeer(trimmed, handleIncoming, handlePeerListUpdate, username);
//     } catch (e) {}
//     const friendly = getPeerNames()[trimmed] || trimmed;
//     const sys = {
//       id: `sys-join-${Date.now()}`,
//       from: "System",
//       text: `Join requested for hub: ${friendly}`,
//       ts: Date.now(),
//       type: "system",
//     };
//     setMessages((m) => {
//       const next = [...m, sys];
//       persistMessages(next);
//       return next;
//     });
//     setMenuOpen(false);
//   };

//   // Leave flow
//   const handleLeaveClick = () => {
//     setMenuOpen(false);
//     setConfirmLeaveOpen(true);
//   };

//   const handleConfirmLeave = () => {
//     try {
//       leaveHub();
//     } catch (e) {}
//     setJoinedBootstrap("");

//     // clear hub + autojoin flag
//     localStorage.removeItem("ph_hub_bootstrap");
//     localStorage.removeItem("ph_should_autojoin");

//     try {
//       localStorage.removeItem(LS_MSGS);
//     } catch (e) {}
//     seenSystemIdsRef.current.clear();
//     setMessages([]);
//     const sys = {
//       id: `sys-left-${Date.now()}`,
//       from: "System",
//       text: "You left the hub. Auto-join cleared.",
//       ts: Date.now(),
//       type: "system",
//     };
//     setMessages((m) => {
//       const next = [...m, sys];
//       persistMessages(next);
//       return next;
//     });
//     setConfirmLeaveOpen(false);
//   };

//   const handleCancelLeave = () => setConfirmLeaveOpen(false);

//   // send chat
//   const send = () => {
//     if (!text.trim()) return;
//     const id = nanoid();
//     const msgObj = {
//       id,
//       from: getLocalPeerId() || myId,
//       fromName: username,
//       text: text.trim(),
//       ts: Date.now(),
//       replyTo: replyTo
//         ? { id: replyTo.id, from: replyTo.from, text: replyTo.text }
//         : null,
//       deliveries: [], // peers who acknowledged delivery
//       reads: [getLocalPeerId() || myId], // mark self as read
//     };
//     setMessages((m) => {
//       const next = [...m, msgObj];
//       persistMessages(next);
//       return next;
//     });
//     try {
//       sendChat(msgObj);
//     } catch (e) {
//       console.warn("sendChat failed", e);
//     }
//     setText("");
//     setReplyTo(null);
//   };

//   // tap message to reply + send ack_read
//   const handleTapMessage = (m) => {
//     if (m.type && m.type.startsWith("system")) return;
//     setReplyTo({ id: m.id, from: m.from, text: m.text });
//     const input = document.querySelector(
//       'input[placeholder="Type a message..."]'
//     );
//     if (input) input.focus();

//     const originPeerId = m.fromId || m.from;
//     if (m.id && originPeerId) {
//       try {
//         sendAckRead(m.id, originPeerId);
//         // locally add read
//         addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId);
//       } catch (e) {
//         console.warn("sendAckRead error", e);
//       }
//     }
//   };

//   // compute status dot for message using WhatsApp-like rules
//   const renderStatusDot = (m) => {
//     const totalPeers = peers?.length || 0; // recipients count (excluding self)
//     if (totalPeers === 0) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2"
//           title="No recipients (offline)"
//         />
//       );
//     }

//     const deliveries = (m.deliveries || []).filter(
//       (id) => id !== (getLocalPeerId() || myId)
//     ).length;
//     const reads = (m.reads || []).filter(
//       (id) => id !== (getLocalPeerId() || myId)
//     ).length;

//     // single tick (red) when not delivered to all recipients
//     if (deliveries < totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
//           title={`Single tick — delivered to ${deliveries}/${totalPeers}`}
//         />
//       );
//     }

//     // double tick (yellow) when delivered to everyone but not read by all
//     if (deliveries === totalPeers && reads < totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
//           title={`Double tick — delivered to all (${totalPeers}), reads ${reads}/${totalPeers}`}
//         />
//       );
//     }

//     // double-blue (green) when read by everyone
//     if (reads === totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-green-500 ml-2"
//           title="Double-blue — read by everyone"
//         />
//       );
//     }

//     return (
//       <span className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2" />
//     );
//   };

//   // render message (preserve UI)
//   const renderMessage = (m, idx) => {
//     const from = m.from ?? "peer";
//     const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
//     const time = new Date(m.ts).toLocaleTimeString([], {
//       hour: "2-digit",
//       minute: "2-digit",
//     });
//     const isSystem = m.type && m.type.toString().startsWith("system");
//     const isMe =
//       (m.fromId || m.from) === (getLocalPeerId() || myId) || from === username;

//     if (isSystem) {
//       return (
//         <div key={`${m.id ?? m.ts}-${idx}`} className="w-full text-center my-2">
//           <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm">
//             {m.text}
//           </div>
//         </div>
//       );
//     }

//     return (
//       <div
//         onClick={() => handleTapMessage(m)}
//         key={`${m.id ?? m.ts}-${idx}`}
//         className={`p-2 rounded-2xl max-w-[50%] mb-2 cursor-pointer ${
//           isMe ? "ml-auto bg-blue-500 text-white" : "bg-white/100  text-black"
//         }`}
//       >
//         <div className="text-xs font-bold flex items-center">
//           <div className="flex-1">{isMe ? "You" : from}</div>
//           <div className="text-[10px] text-gray-700 /70 ml-2">{time}</div>
//           {isMe && renderStatusDot(m)}
//         </div>
//         {m.replyTo && (
//           <div className="mt-2 mb-2 p-2 rounded border border-white/5 text-xs text-gray-600 bg-gray-300">
//             <strong className="text-xs text-blue-400">
//               Reply to {m.replyTo.from}:
//             </strong>{" "}
//             {m.replyTo.text}
//           </div>
//         )}
//         <div className="break-words">{txt}</div>
//       </div>
//     );
//   };

//   // first-time username prompt
//   if (showNamePrompt) {
//     return (
//       <div className="h-screen flex items-center justify-center bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600">
//         <div className="bg-white/20 p-6 rounded-2xl text-center">
//           <h2 className="text-xl font-bold mb-4">Welcome to PeersHub</h2>
//           <input
//             value={username}
//             onChange={(e) => setUsername(e.target.value)}
//             placeholder="Enter your name"
//             className="w-full p-3 rounded-lg bg-white/10 text-purple-600 mb-4"
//           />
//           <button
//             onClick={() => {
//               if (!username.trim()) return;
//               localStorage.setItem("ph_name", username.trim());
//               setUsername(username.trim());
//               setShowNamePrompt(false);
//             }}
//             className="px-4 py-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white font-semibold w-full"
//           >
//             Continue 🚀
//           </button>
//         </div>
//       </div>
//     );
//   }

//   const connectedNames = peers.length
//     ? peers.map((id) => peerNamesMap[id] || id)
//     : [];

//   // show typing summary using keys (names)
//   const typingSummary = () => {
//     const names = Object.keys(typingUsers);
//     if (!names.length) return null;
//     const shown = names.slice(0, 2).join(", ");
//     return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
//   };

//   return (
//     <>
//       <div className="h-screen md:h-[80vh] bg-gray-50 text-purple-600 p-6 flex flex-col rounded-4xl">
//         <header className="flex items-center justify-between mb-4">
//           <div className="flex gap-2.5">
//             <div className="text-sm text-blue-600">YourID</div>
//             <div className="font-mono">{myId || "..."}</div>
//             <div className="text-sm text-blue-600">Name: {username}</div>
//             <div className="text-xs text-purple-500 mt-1">
//               Auto-join: {joinedBootstrap || "none"}
//             </div>
//           </div>

//           {/* three-dots menu */}
//           <div className="relative" ref={menuRef}>
//             <button
//               onClick={() => setMenuOpen((s) => !s)}
//               className="p-2 rounded-full bg-white/10 text-white"
//               aria-label="Menu"
//             >
//               <svg
//                 width="18"
//                 height="18"
//                 viewBox="0 0 24 24"
//                 className="inline-block"
//               >
//                 <circle cx="12" cy="5" r="2" fill="blue" />
//                 <circle cx="12" cy="12" r="2" fill="blue" />
//                 <circle cx="12" cy="19" r="2" fill="blue" />
//               </svg>
//             </button>

//             <div
//               className={`absolute right-0 mt-2 w-44 bg-white/10 backdrop-blur rounded-lg shadow-lg z-50 transform origin-top-right transition-all duration-200 ${
//                 menuOpen
//                   ? "opacity-100 scale-100 pointer-events-auto"
//                   : "opacity-0 scale-95 pointer-events-none"
//               }`}
//             >
//               <button
//                 onClick={handleCreateHub}
//                 className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-green-500"
//               >
//                 <span className="font-semibold">Create Hub</span>
//                 <div className="text-xs text-gray-400">
//                   Make this device the host
//                 </div>
//               </button>

//               <button
//                 onClick={handleJoinHub}
//                 className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-blue-500"
//               >
//                 <span className="font-semibold">Join Hub</span>
//                 <div className="text-xs text-gray-400">
//                   Enter a host ID to join
//                 </div>
//               </button>

//               <button
//                 onClick={handleLeaveClick}
//                 className="w-full text-left px-4 py-3 hover:bg-white/20 text-red-500 rounded-b-lg"
//               >
//                 <span className="font-semibold">Leave</span>
//                 <div className="text-xs text-gray-400">
//                   Leave and clear local history
//                 </div>
//               </button>
//             </div>
//           </div>
//         </header>

//         <div className="w-full text-white h-0.5 bg-white" />
//         <br />

//         <main className="flex-1 overflow-auto mb-4">
//           <div style={{ paddingBottom: 8 }}>
//             {messages.length === 0 && (
//               <div className="text-sm text-white/60">No messages yet</div>
//             )}
//             {messages.map((m, i) => renderMessage(m, i))}
//             <div ref={messagesEndRef} />
//           </div>
//         </main>

//         <div className="w-full text-white h-0.5 bg-white" />
//         <br />

//         <footer className="mt-auto">
//           {typingSummary()}
//           <div className="mb-3 text-sm text-blue-600">
//             Connected peers:{" "}
//             {connectedNames.length === 0 ? (
//               <span className="text-red-500">none</span>
//             ) : (
//               connectedNames.join(", ")
//             )}
//           </div>

//           {replyTo && (
//             <div className="mb-2 p-3 bg-white/10 text-gray-500 rounded-lg">
//               Replying to <strong>{replyTo.from}</strong>:{" "}
//               <span className="text-sm text-blue-400">{replyTo.text}</span>
//               <button
//                 onClick={() => setReplyTo(null)}
//                 className="ml-4 text-xs text-red-500"
//               >
//                 x
//               </button>
//             </div>
//           )}

//           <div className="flex gap-2">
//             <input
//               value={text}
//               onChange={(e) => setText(e.target.value)}
//               placeholder="Type a message..."
//               className="flex-1 p-3  bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
//               onKeyDown={(e) => {
//                 if (e.key === "Enter") send();
//               }}
//             />
//             <button
//               onClick={send}
//               className="px-4 py-3 rounded-lg bg-gradient-to-br from-blue-500 to-blue-500 text-white font-semibold"
//             >
//               Send
//             </button>
//           </div>
//         </footer>
//       </div>

//       {/* Leave confirmation modal */}
//       {confirmLeaveOpen && (
//         <div className="fixed inset-0 z-60 flex items-center justify-center">
//           <div
//             className="absolute inset-0 bg-black/50"
//             onClick={handleCancelLeave}
//           />
//           <div className="relative bg-white/10 p-6 rounded-lg backdrop-blur text-white w-80 z-70">
//             <h3 className="text-lg font-bold mb-2">Leave Hub?</h3>
//             <p className="text-sm text-white/80 mb-4">
//               Leaving will clear your local chat history. Are you sure?
//             </p>
//             <div className="flex justify-center gap-2">
//               <button
//                 onClick={handleCancelLeave}
//                 className="px-3 py-2 rounded bg-gradient-to-br from-green-500 to-green-600 text-white"
//               >
//                 Cancel
//               </button>
//               <button
//                 onClick={handleConfirmLeave}
//                 className="px-3 py-2 rounded bg-gradient-to-br from-red-500 to-red-600 text-white"
//               >
//                 Leave & Clear
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//     </>
//   );
// }





// File Transfer 





// src/components/Chat.jsx
import "./App.css";

import React, { useEffect, useState, useRef } from "react";
import {
  initPeer,
  sendChat,
  sendTyping,
  sendAckRead,
  getPeerNames,
  joinHub,
  leaveHub,
  getLocalPeerId,
  connectToPeer,
  broadcastSystem,
  // new file transfer APIs
  sendFile,
  acceptFileOffer,
  declineFileOffer,
} from "./webrtc";
// notification helpers
import { requestNotificationPermission, showNotification } from "./notify";
// id generator
import { nanoid } from "nanoid";

/**
 * Chat.jsx (fixed for read-acks + file transfer)
 *
 * - Auto-send ack_read immediately when message arrives and document is visible
 * - On visibilitychange -> send ack_read for any unread messages
 * - Keeps tap-to-reply behavior (still sends ack_read)
 * - Keeps all UI classes/colors intact
 * - Adds minimal file-send UI (file picker) and handles incoming offers/progress/completions
 */

const LS_MSGS = "ph_msgs_v1";
const MAX_MSGS = 100;

export default function Chat() {
  const [myId, setMyId] = useState(() => getLocalPeerId() || "...");
  const [peers, setPeers] = useState([]);
  const [peerNamesMap, setPeerNamesMap] = useState({});
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_MSGS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  });
  const [text, setText] = useState("");
  const [username, setUsername] = useState(
    () => localStorage.getItem("ph_name") || ""
  );
  const [showNamePrompt, setShowNamePrompt] = useState(
    () => !localStorage.getItem("ph_name")
  );
  const [joinedBootstrap, setJoinedBootstrap] = useState(() => {
    const id = localStorage.getItem("ph_hub_bootstrap") || "";
    const should = localStorage.getItem("ph_should_autojoin") === "true";
    return should ? id : "";
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  // File transfer UI state
  // pendingOffers: id -> { id, from, name, size, mime }
  const [pendingOffers, setPendingOffers] = useState({});
  // transfers: transferKey -> { id, peer, direction, bytes, total, name }
  // transferKey is `${id}:${peer}:${direction}`
  const [transfers, setTransfers] = useState({});

  useEffect(() => {
    if (!username) return;
    requestNotificationPermission().then((granted) => {
      console.log("Notification permission granted:", granted);
    });
  }, [username]);

  const messagesEndRef = useRef(null);
  const seenSystemIdsRef = useRef(new Set());
  const peerRef = useRef(null);
  const menuRef = useRef(null);

  // typingUsers: { [name]: timestamp }
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const typingTimeoutRef = useRef(null);

  // hidden file input
  const fileInputRef = useRef(null);

  // helper to show notification only when appropriate
  const maybeNotify = (fromDisplay, text) => {
    try {
      if (!fromDisplay || fromDisplay === username) return;
      if (!document.hidden && document.hasFocus()) return;

      const title = `${fromDisplay}`;
      const body =
        typeof text === "string"
          ? text.length > 120
            ? text.slice(0, 117) + "..."
            : text
          : JSON.stringify(text);
      showNotification(title, {
        body,
        tag: `peershub-${fromDisplay}`,
        data: { from: fromDisplay },
      });
    } catch (e) {
      console.warn("maybeNotify error", e);
    }
  };

  // persist messages to localStorage (trimmed)
  const persistMessages = (arr) => {
    try {
      const tail = arr.slice(-MAX_MSGS);
      localStorage.setItem(LS_MSGS, JSON.stringify(tail));
    } catch (e) {}
  };

  // add or merge incoming chat
  const upsertIncomingChat = (incoming) => {
    setMessages((m) => {
      const exists = m.find((x) => x.id === incoming.id);
      if (exists) {
        const next = m.map((x) =>
          x.id === incoming.id ? { ...x, ...incoming } : x
        );
        persistMessages(next);
        return next;
      }
      const msgObj = {
        id: incoming.id,
        from: incoming.fromName || incoming.from || "peer",
        fromId: incoming.from,
        text: incoming.text,
        ts: incoming.ts || Date.now(),
        type: "chat",
        replyTo: incoming.replyTo || null,
        deliveries: incoming.deliveries || [],
        reads: incoming.reads || [],
      };
      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });
  };

  // utility used by acks to update arrays safely
  const addUniqueToMsgArray = (msgId, field, peerId) => {
    setMessages((m) => {
      const next = m.map((msg) => {
        if (msg.id !== msgId) return msg;
        const arr = Array.isArray(msg[field]) ? [...msg[field]] : [];
        if (!arr.includes(peerId)) arr.push(peerId);
        return { ...msg, [field]: arr };
      });
      persistMessages(next);
      return next;
    });
  };

  // helper to add system message locally (keeps existing UI look)
  const pushLocalSystemMessage = (text, type = "system") => {
    const sys = {
      id: `sys-local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: "System",
      text,
      ts: Date.now(),
      type,
    };
    setMessages((m) => {
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });
  };

  // incoming messages callback from webrtc
  const handleIncoming = (from, payloadOrText) => {
    // FILE TRANSFER EVENTS (they come with from === "__system_file_*__")
    if (from === "__system_file_offer__" && payloadOrText && payloadOrText.id) {
      const offer = {
        id: payloadOrText.id,
        name: payloadOrText.name,
        size: payloadOrText.size,
        mime: payloadOrText.mime,
        from: payloadOrText.from || null,
      };
      // store pending offer
      setPendingOffers((p) => ({ ...p, [offer.id]: offer }));
      // also add a system message so user sees it in chat (with accept/decline handled below in UI)
      pushLocalSystemMessage(`File offer: ${offer.name} (${Math.round((offer.size || 0) / 1024)} KB) from ${offer.from}`, "system_file_offer");
      return;
    }

    if (from === "__system_file_progress__" && payloadOrText && payloadOrText.id) {
      const { id, from: fpeer, receivedBytes, sentBytes, totalBytes, direction, name } = payloadOrText;
      const key = `${id}:${fpeer}:${direction}`;
      setTransfers((t) => ({
        ...t,
        [key]: {
          id,
          peer: fpeer,
          direction,
          bytes: direction === "recv" ? (receivedBytes || 0) : (sentBytes || 0),
          total: totalBytes || null,
          name: name || (t[key] && t[key].name),
        },
      }));
      return;
    }

    if (from === "__system_file_complete__" && payloadOrText && payloadOrText.id) {
      const { id, from: fpeer, blob, name } = payloadOrText;
      // clean pendingOffers and transfers that match
      setPendingOffers((p) => {
        const copy = { ...p };
        delete copy[id];
        return copy;
      });
      setTransfers((t) => {
        const copy = { ...t };
        Object.keys(copy).forEach((k) => {
          if (k.startsWith(`${id}:`)) delete copy[k];
        });
        return copy;
      });

      // auto-download the blob
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name || "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        pushLocalSystemMessage(`Received file ${name} from ${fpeer} — downloaded.`, "system_file_complete");
      } catch (e) {
        console.warn("download failed", e);
        pushLocalSystemMessage(`Received file ${name} from ${fpeer} (download failed)`, "system_file_complete");
      }
      return;
    }

    if (from === "__system_file_declined__" && payloadOrText && payloadOrText.id) {
      const { id, from: fpeer } = payloadOrText;
      setPendingOffers((p) => {
        const copy = { ...p };
        delete copy[id];
        return copy;
      });
      setTransfers((t) => {
        const copy = { ...t };
        Object.keys(copy).forEach((k) => {
          if (k.startsWith(`${id}:`)) delete copy[k];
        });
        return copy;
      });
      pushLocalSystemMessage(`File offer ${id} was declined by ${fpeer}.`, "system");
      return;
    }

    // typing system
    if (
      from === "__system_typing__" &&
      payloadOrText &&
      payloadOrText.fromName
    ) {
      const { fromName, isTyping } = payloadOrText;
      setTypingUsers((t) => {
        const copy = { ...t };
        if (isTyping) copy[fromName] = Date.now();
        else delete copy[fromName];
        return copy;
      });
      return;
    }

    // ack deliver
    if (
      from === "__system_ack_deliver__" &&
      payloadOrText &&
      payloadOrText.id
    ) {
      const { fromPeer, id } = payloadOrText;
      addUniqueToMsgArray(id, "deliveries", fromPeer);
      return;
    }

    // ack read
    if (from === "__system_ack_read__" && payloadOrText && payloadOrText.id) {
      const { fromPeer, id } = payloadOrText;
      addUniqueToMsgArray(id, "reads", fromPeer);
      return;
    }

    // system messages (existing pattern)
    if (
      payloadOrText &&
      typeof payloadOrText === "object" &&
      payloadOrText.type &&
      payloadOrText.id &&
      payloadOrText.type.toString().startsWith("system")
    ) {
      const { type, text: txt, id } = payloadOrText;
      if (seenSystemIdsRef.current.has(id)) return;
      seenSystemIdsRef.current.add(id);
      const msg = {
        id,
        from: "System",
        text: txt,
        ts: Date.now(),
        type,
        deliveries: [],
        reads: [],
      };
      setMessages((m) => {
        const next = [...m, msg];
        persistMessages(next);
        return next;
      });
      if (type === "system_public") maybeNotify("System", txt);
      return;
    }

    // chat object
    if (
      payloadOrText &&
      typeof payloadOrText === "object" &&
      payloadOrText.type === "chat" &&
      payloadOrText.id
    ) {
      upsertIncomingChat(payloadOrText);
      maybeNotify(
        payloadOrText.fromName || payloadOrText.from,
        payloadOrText.text
      );

      // --- NEW: auto-send ack_read NOW if the app is visible and message not from me ---
      try {
        const origin = payloadOrText.from || payloadOrText.origin || null;
        const localId = getLocalPeerId() || myId;
        // only send ack_read if origin exists and origin is not me
        if (
          origin &&
          origin !== localId &&
          document.visibilityState === "visible"
        ) {
          // send ack_read to origin
          try {
            sendAckRead(payloadOrText.id, origin);
          } catch (e) {
            console.warn("sendAckRead error (auto on receive):", e);
          }
          // locally record read
          addUniqueToMsgArray(payloadOrText.id, "reads", localId);
        }
      } catch (e) {
        console.warn("auto ack_read failed", e);
      }

      // webrtc.js already sends ack_deliver back to origin when it receives chat
      return;
    }

    // plain string fallback
    if (typeof payloadOrText === "string") {
      const safeText = payloadOrText;
      const newMsg = {
        id: nanoid(),
        from: from || "peer",
        fromId: null,
        text: safeText,
        ts: Date.now(),
        type: "chat",
        deliveries: [],
        reads: [],
      };
      setMessages((m) => {
        const next = [...m, newMsg];
        persistMessages(next);
        return next;
      });
      maybeNotify(from, safeText);
      return;
    }
  };

  // peer list update callback
  const handlePeerListUpdate = (list) => {
    setPeers(list || []);
    try {
      const names = getPeerNames();
      setPeerNamesMap(names || {});
    } catch (e) {}
  };

  // handle bootstrap change
  const handleBootstrapChange = (newBootstrapId) => {
    setJoinedBootstrap(newBootstrapId || "");
  };

  // init peer when username available
  useEffect(() => {
    if (!username) return;

    // register service worker (optional) so notifications can use it
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("ServiceWorker registered", reg);
        })
        .catch((err) => console.warn("SW register failed", err));
    }

    const p = initPeer(
      handleIncoming,
      handlePeerListUpdate,
      username,
      handleBootstrapChange
    );
    peerRef.current = p;
    p.on && p.on("open", (id) => setMyId(id));
    const bootstrap = localStorage.getItem("ph_hub_bootstrap");
    setJoinedBootstrap(bootstrap || "");
    return () => {
      try {
        p && p.destroy && p.destroy();
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // autoscroll to bottom when messages change
  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    } catch (e) {}
  }, [messages]);

  // when tab becomes visible, send ack_read for any unread messages
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        const localId = getLocalPeerId() || myId;
        messages.forEach((m) => {
          if (!m || m.type !== "chat") return;
          // only for messages from other peers and not already read by me
          const origin = m.fromId || m.from;
          if (!origin || origin === localId) return;
          const alreadyRead =
            Array.isArray(m.reads) && m.reads.includes(localId);
          if (!alreadyRead) {
            try {
              sendAckRead(m.id, origin);
            } catch (e) {
              console.warn("sendAckRead error (on visibility):", e);
            }
            addUniqueToMsgArray(m.id, "reads", localId);
          }
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    // also run once in case the page is already visible when component mounts
    if (document.visibilityState === "visible") onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, myId]);

  // menu outside click handler
  useEffect(() => {
    const onDocClick = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    else document.removeEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  // typing broadcast: debounce while typing
  useEffect(() => {
    if (!username) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    try {
      if (typeof sendTyping === "function") sendTyping(username, true);
    } catch (e) {}
    typingTimeoutRef.current = setTimeout(() => {
      try {
        if (typeof sendTyping === "function") sendTyping(username, false);
      } catch (e) {}
    }, 1200);
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Create Hub
  const handleCreateHub = () => {
    const id = getLocalPeerId() || myId;
    if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
    joinHub(id);
    setJoinedBootstrap(id);

    // persist hub + autojoin flag
    localStorage.setItem("ph_hub_bootstrap", id);
    localStorage.setItem("ph_should_autojoin", "true");

    // local system message for the creator
    const sysPlain = {
      id: `sys-create-${Date.now()}`,
      from: "System",
      text: `You created the hub. Share this ID: ${id}`,
      ts: Date.now(),
      type: "system",
    };
    setMessages((m) => {
      const next = [...m, sysPlain];
      persistMessages(next);
      return next;
    });

    // BROADCAST public system announcement so others know who the host is
    try {
      const publicText = `[${username || "Host"}] is the host`;
      broadcastSystem("system_public", publicText, `sys-host-${id}`);
    } catch (e) {
      console.warn("broadcastSystem failed", e);
    }

    setMenuOpen(false);
  };

  // Join Hub
  const handleJoinHub = async () => {
    const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
    if (!id) {
      setMenuOpen(false);
      return;
    }
    const trimmed = id.trim();
    joinHub(trimmed);
    setJoinedBootstrap(trimmed);

    // persist hub + autojoin flag
    localStorage.setItem("ph_hub_bootstrap", trimmed);
    localStorage.setItem("ph_should_autojoin", "true");

    try {
      connectToPeer(trimmed, handleIncoming, handlePeerListUpdate, username);
    } catch (e) {}
    const friendly = getPeerNames()[trimmed] || trimmed;
    const sys = {
      id: `sys-join-${Date.now()}`,
      from: "System",
      text: `Join requested for hub: ${friendly}`,
      ts: Date.now(),
      type: "system",
    };
    setMessages((m) => {
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });
    setMenuOpen(false);
  };

  // Leave flow
  const handleLeaveClick = () => {
    setMenuOpen(false);
    setConfirmLeaveOpen(true);
  };

  const handleConfirmLeave = () => {
    try {
      leaveHub();
    } catch (e) {}
    setJoinedBootstrap("");

    // clear hub + autojoin flag
    localStorage.removeItem("ph_hub_bootstrap");
    localStorage.removeItem("ph_should_autojoin");

    try {
      localStorage.removeItem(LS_MSGS);
    } catch (e) {}
    seenSystemIdsRef.current.clear();
    setMessages([]);
    const sys = {
      id: `sys-left-${Date.now()}`,
      from: "System",
      text: "You left the hub. Auto-join cleared.",
      ts: Date.now(),
      type: "system",
    };
    setMessages((m) => {
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });
    setConfirmLeaveOpen(false);
  };

  const handleCancelLeave = () => setConfirmLeaveOpen(false);

  // send chat
  const send = () => {
    if (!text.trim()) return;
    const id = nanoid();
    const msgObj = {
      id,
      from: getLocalPeerId() || myId,
      fromName: username,
      text: text.trim(),
      ts: Date.now(),
      replyTo: replyTo
        ? { id: replyTo.id, from: replyTo.from, text: replyTo.text }
        : null,
      deliveries: [], // peers who acknowledged delivery
      reads: [getLocalPeerId() || myId], // mark self as read
    };
    setMessages((m) => {
      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });
    try {
      sendChat(msgObj);
    } catch (e) {
      console.warn("sendChat failed", e);
    }
    setText("");
    setReplyTo(null);
  };

  // send a picked file to all connected peers (one transfer per peer)
  const onPickFile = async (file) => {
    if (!file) return;
    if (!peers || peers.length === 0) {
      pushLocalSystemMessage("No connected peers to send file to.", "system");
      return;
    }

    // iterate peers and call sendFile for each peer
    peers.forEach(async (peerId) => {
      try {
        const fileId = await sendFile(peerId, file);
        // register transfer UI entry (send direction)
        const key = `${fileId}:${peerId}:send`;
        setTransfers((t) => ({
          ...t,
          [key]: {
            id: fileId,
            peer: peerId,
            direction: "send",
            bytes: 0,
            total: file.size,
            name: file.name,
          },
        }));
        pushLocalSystemMessage(`Sent file offer for ${file.name} to ${peerNamesMap[peerId] || peerId}`, "system");
      } catch (e) {
        console.warn("sendFile failed for", peerId, e);
        pushLocalSystemMessage(`File send failed to ${peerNamesMap[peerId] || peerId}`, "system");
      }
    });
  };

  // handler for file input change
  const onFileInputChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onPickFile(f);
    // reset so same file can be picked again
    e.target.value = "";
  };

  // tap message to reply + send ack_read
  const handleTapMessage = (m) => {
    if (m.type && m.type.startsWith("system")) return;
    setReplyTo({ id: m.id, from: m.from, text: m.text });
    const input = document.querySelector(
      'input[placeholder="Type a message..."]'
    );
    if (input) input.focus();

    const originPeerId = m.fromId || m.from;
    if (m.id && originPeerId) {
      try {
        sendAckRead(m.id, originPeerId);
        // locally add read
        addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId);
      } catch (e) {
        console.warn("sendAckRead error", e);
      }
    }
  };

  // Accept a pending offer (UI button)
  const handleAcceptOffer = (offerId) => {
    const offer = pendingOffers[offerId];
    if (!offer) return;
    try {
      acceptFileOffer(offerId, offer.from);
      // register transfer UI entry (recv direction)
      const key = `${offerId}:${offer.from}:recv`;
      setTransfers((t) => ({
        ...t,
        [key]: {
          id: offerId,
          peer: offer.from,
          direction: "recv",
          bytes: 0,
          total: offer.size || null,
          name: offer.name,
        },
      }));
      // remove pending offer entry
      setPendingOffers((p) => {
        const copy = { ...p };
        delete copy[offerId];
        return copy;
      });
      pushLocalSystemMessage(`Accepted file offer ${offer.name} from ${offer.from}`, "system");
    } catch (e) {
      console.warn("acceptFileOffer failed", e);
    }
  };

  // Decline a pending offer
  const handleDeclineOffer = (offerId) => {
    const offer = pendingOffers[offerId];
    if (!offer) return;
    try {
      declineFileOffer(offerId, offer.from);
    } catch (e) {
      console.warn("declineFileOffer failed", e);
    }
    setPendingOffers((p) => {
      const copy = { ...p };
      delete copy[offerId];
      return copy;
    });
    pushLocalSystemMessage(`Declined file offer ${offer.name} from ${offer.from}`, "system");
  };

  // compute status dot for message using WhatsApp-like rules
  const renderStatusDot = (m) => {
    const totalPeers = peers?.length || 0; // recipients count (excluding self)
    if (totalPeers === 0) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2"
          title="No recipients (offline)"
        />
      );
    }

    const deliveries = (m.deliveries || []).filter(
      (id) => id !== (getLocalPeerId() || myId)
    ).length;
    const reads = (m.reads || []).filter(
      (id) => id !== (getLocalPeerId() || myId)
    ).length;

    // single tick (red) when not delivered to all recipients
    if (deliveries < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
          title={`Single tick — delivered to ${deliveries}/${totalPeers}`}
        />
      );
    }

    // double tick (yellow) when delivered to everyone but not read by all
    if (deliveries === totalPeers && reads < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
          title={`Double tick — delivered to all (${totalPeers}), reads ${reads}/${totalPeers}`}
        />
      );
    }

    // double-blue (green) when read by everyone
    if (reads === totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-green-500 ml-2"
          title="Double-blue — read by everyone"
        />
      );
    }

    return (
      <span className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2" />
    );
  };

  // render message (preserve UI)
  const renderMessage = (m, idx) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isSystem = m.type && m.type.toString().startsWith("system");
    const isMe =
      (m.fromId || m.from) === (getLocalPeerId() || myId) || from === username;

    if (isSystem) {
      return (
        <div key={`${m.id ?? m.ts}-${idx}`} className="w-full text-center my-2">
          <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm">
            {m.text}
          </div>
        </div>
      );
    }

    return (
      <div
        onClick={() => handleTapMessage(m)}
        key={`${m.id ?? m.ts}-${idx}`}
        className={`p-2 rounded-2xl max-w-[50%] mb-2 cursor-pointer ${
          isMe ? "ml-auto bg-blue-500 text-white" : "bg-white/100  text-black"
        }`}
      >
        <div className="text-xs font-bold flex items-center">
          <div className="flex-1">{isMe ? "You" : from}</div>
          <div className="text-[10px] text-gray-700 /70 ml-2">{time}</div>
          {isMe && renderStatusDot(m)}
        </div>
        {m.replyTo && (
          <div className="mt-2 mb-2 p-2 rounded border border-white/5 text-xs text-gray-600 bg-gray-300">
            <strong className="text-xs text-blue-400">
              Reply to {m.replyTo.from}:
            </strong>{" "}
            {m.replyTo.text}
          </div>
        )}
        <div className="break-words">{txt}</div>
      </div>
    );
  };

  // first-time username prompt
  if (showNamePrompt) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600">
        <div className="bg-white/20 p-6 rounded-2xl text-center">
          <h2 className="text-xl font-bold mb-4">Welcome to PeersHub</h2>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your name"
            className="w-full p-3 rounded-lg bg-white/10 text-purple-600 mb-4"
          />
          <button
            onClick={() => {
              if (!username.trim()) return;
              localStorage.setItem("ph_name", username.trim());
              setUsername(username.trim());
              setShowNamePrompt(false);
            }}
            className="px-4 py-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white font-semibold w-full"
          >
            Continue 🚀
          </button>
        </div>
      </div>
    );
  }

  const connectedNames = peers.length
    ? peers.map((id) => peerNamesMap[id] || id)
    : [];

  // show typing summary using keys (names)
  const typingSummary = () => {
    const names = Object.keys(typingUsers);
    if (!names.length) return null;
    const shown = names.slice(0, 2).join(", ");
    return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
  };

  // Render pending offers UI block
  const renderPendingOffers = () => {
    const keys = Object.keys(pendingOffers);
    if (!keys.length) return null;
    return (
      <div className="mb-3">
        {keys.map((k) => {
          const o = pendingOffers[k];
          return (
            <div key={k} className="mb-2 inline-block px-3 py-2 rounded-lg bg-white/10 text-white">
              <div className="text-sm font-medium">{o.name} ({Math.round((o.size||0)/1024)} KB)</div>
              <div className="text-xs text-gray-300">From: {o.from}</div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => handleAcceptOffer(o.id)}
                  className="px-3 py-1 rounded bg-gradient-to-br from-green-500 to-green-600 text-white text-sm"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleDeclineOffer(o.id)}
                  className="px-3 py-1 rounded bg-gradient-to-br from-red-500 to-red-600 text-white text-sm"
                >
                  Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Render transfer progress block
  const renderTransfers = () => {
    const keys = Object.keys(transfers);
    if (!keys.length) return null;
    return (
      <div className="mb-3">
        {keys.map((k) => {
          const t = transfers[k];
          const percent = t.total ? Math.round((t.bytes / t.total) * 100) : 0;
          return (
            <div key={k} className="mb-2 px-3 py-2 rounded-lg bg-white/5">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  {t.direction === "send" ? "Sending" : "Receiving"} {t.name} to/from {t.peer}
                </div>
                <div className="text-xs text-green-500">{percent}%</div>
              </div>
              <div className="w-full bg-white/10 rounded mt-2 h-2">
                <div
                  style={{ width: `${Math.min(100, percent)}%` }}
                  className="h-2 rounded bg-blue-500"
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="h-screen md:h-[80vh] bg-gray-50 text-purple-600 p-6 flex flex-col rounded-4xl">
        <header className="flex items-center justify-between mb-4">
          <div className="flex gap-2.5">
            <div className="text-sm text-blue-600">YourID</div>
            <div className="font-mono">{myId || "..."}</div>
            <div className="text-sm text-blue-600">Name: {username}</div>
            <div className="text-xs text-purple-500 mt-1">
              Auto-join: {joinedBootstrap || "none"}
            </div>
          </div>

          {/* three-dots menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((s) => !s)}
              className="p-2 rounded-full bg-white/10 text-white"
              aria-label="Menu"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                className="inline-block"
              >
                <circle cx="12" cy="5" r="2" fill="blue" />
                <circle cx="12" cy="12" r="2" fill="blue" />
                <circle cx="12" cy="19" r="2" fill="blue" />
              </svg>
            </button>

            <div
              className={`absolute right-0 mt-2 w-44 bg-white/10 backdrop-blur rounded-lg shadow-lg z-50 transform origin-top-right transition-all duration-200 ${
                menuOpen
                  ? "opacity-100 scale-100 pointer-events-auto"
                  : "opacity-0 scale-95 pointer-events-none"
              }`}
            >
              <button
                onClick={handleCreateHub}
                className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-green-500"
              >
                <span className="font-semibold">Create Hub</span>
                <div className="text-xs text-gray-400">
                  Make this device the host
                </div>
              </button>

              <button
                onClick={handleJoinHub}
                className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-blue-500"
              >
                <span className="font-semibold">Join Hub</span>
                <div className="text-xs text-gray-400">
                  Enter a host ID to join
                </div>
              </button>

              <button
                onClick={handleLeaveClick}
                className="w-full text-left px-4 py-3 hover:bg-white/20 text-red-500 rounded-b-lg"
              >
                <span className="font-semibold">Leave</span>
                <div className="text-xs text-gray-400">
                  Leave and clear local history
                </div>
              </button>
            </div>
          </div>
        </header>

        <div className="w-full text-white h-0.5 bg-white" />
        <br />

        <main className="flex-1 overflow-auto mb-4">
          <div style={{ paddingBottom: 8 }}>
            {messages.length === 0 && (
              <div className="text-sm text-white/60">No messages yet</div>
            )}
            {messages.map((m, i) => renderMessage(m, i))}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="w-full text-white h-0.5 bg-white" />
        <br />

        <footer className="mt-auto">
          {typingSummary()}
          <div className="mb-3 text-sm text-blue-600">
            Connected peers:{" "}
            {connectedNames.length === 0 ? (
              <span className="text-red-500">none</span>
            ) : (
              connectedNames.join(", ")
            )}
          </div>

          {/* pending offers UI */}
          {renderPendingOffers()}

          {/* transfers UI */}
          {renderTransfers()}

          {replyTo && (
            <div className="mb-2 p-3 bg-white/10 text-gray-500 rounded-lg">
              Replying to <strong>{replyTo.from}</strong>:{" "}
              <span className="text-sm text-blue-400">{replyTo.text}</span>
              <button
                onClick={() => setReplyTo(null)}
                className="ml-4 text-xs text-red-500"
              >
                x
              </button>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 p-3  bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            {/* hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={onFileInputChange}
            />
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className="px-3 py-2 rounded-lg bg-gradient-to-br from-white/10 to-white/10 text-blue-500 border border-white/10"
              title="Send file"
            >
              📎
            </button>
            <button
              onClick={send}
              className="px-4 py-3 rounded-lg bg-gradient-to-br from-blue-500 to-blue-500 text-white font-semibold"
            >
              Send
            </button>
          </div>
        </footer>
      </div>

      {/* Leave confirmation modal */}
      {confirmLeaveOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleCancelLeave}
          />
          <div className="relative bg-white/10 p-6 rounded-lg backdrop-blur text-white w-80 z-70">
            <h3 className="text-lg font-bold mb-2">Leave Hub?</h3>
            <p className="text-sm text-white/80 mb-4">
              Leaving will clear your local chat history. Are you sure?
            </p>
            <div className="flex justify-center gap-2">
              <button
                onClick={handleCancelLeave}
                className="px-3 py-2 rounded bg-gradient-to-br from-green-500 to-green-600 text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLeave}
                className="px-3 py-2 rounded bg-gradient-to-br from-red-500 to-red-600 text-white"
              >
                Leave & Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
