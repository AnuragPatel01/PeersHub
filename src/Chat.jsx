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
//     const id = getLocalPeerId() || myId;
//     if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
//     joinHub(id);
//     setJoinedBootstrap(id);

//     // persist hub + autojoin flag
//     localStorage.setItem("ph_hub_bootstrap", id);
//     localStorage.setItem("ph_should_autojoin", "true");

//     // local system message for the creator
//     const sysPlain = {
//       id: `sys-create-${Date.now()}`,
//       from: "System",
//       text: `You created the hub. Share this ID: ${id}`,
//       ts: Date.now(),
//       type: "system",
//     };
//     setMessages((m) => {
//       const next = [...m, sysPlain];
//       persistMessages(next);
//       return next;
//     });

//     // BROADCAST public system announcement so others know who the host is
//     try {
//       const publicText = `[${username || "Host"}] is the host`;
//       broadcastSystem("system_public", publicText, `sys-host-${id}`);
//     } catch (e) {
//       console.warn("broadcastSystem failed", e);
//     }

//     setMenuOpen(false);
//   };

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
//       <div className="h-[92vh] md:h-[92vh] max-w-[400px] w-full mx-auto bg-gray-50 text-purple-600 p-6 flex flex-col rounded-4xl">
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

//         <main className="flex-1 overflow-auto mb-4 min-h-0">
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
//           <div className="relative w-full">
//             {/* message input */}
//             <input
//               value={text}
//               onChange={(e) => setText(e.target.value)}
//               placeholder="Type a message..."
//               className="w-full p-3 pl-10 pr-10 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
//               onKeyDown={(e) => {
//                 if (e.key === "Enter") send();
//               }}
//             />
//             {/* send icon inside input (right) */}
//             <svg
//               onClick={send}
//               xmlns="http://www.w3.org/2000/svg"
//               fill="currentColor"
//               viewBox="0 0 24 24"
//               className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700"
//               title="Send"
//             >
//               <path d="M3.4 20.6L21 12 3.4 3.4 3 10l11 2-11 2z" />
//             </svg>{" "}
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

// Stable File Sharing

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
//   offerFileToPeers,
//   respondToFileOffer,
//   startSendingFile,
//   supportsNativeFileSystem,
//   // these two must be implemented in your webrtc.js and will be used to receive progress events
//   setOnFileProgress,
//   setOnFileComplete,
// } from "./webrtc";
// import { requestNotificationPermission, showNotification } from "./notify";
// import { nanoid } from "nanoid";

// const LS_MSGS = "ph_msgs_v1";
// const MAX_MSGS = 100;

// export default function Chat() {
//   // core state
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

//   // file transfer
//   const [incomingFileOffers, setIncomingFileOffers] = useState({});
//   // transfers: offerId -> { direction, label, total, transferred, peers }
//   const [transfers, setTransfers] = useState({});

//   const saveHandlesRef = useRef({}); // offerId -> writable
//   const fileWriteStatusRef = useRef({}); // offerId -> bytesReceived
//   const outgoingPendingOffers = useRef({}); // offerId -> { file, acceptingPeers:Set }

//   // UI / other state
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

//   // ticking for timers
//   const [now, setNow] = useState(Date.now());

//   // typing
//   const [typingUsers, setTypingUsers] = useState({});
//   const [replyTo, setReplyTo] = useState(null);
//   const typingTimeoutRef = useRef(null);

//   // refs
//   const messagesEndRef = useRef(null);
//   const seenSystemIdsRef = useRef(new Set());
//   const peerRef = useRef(null);
//   const menuRef = useRef(null);

//   // notifications permission on username set
//   useEffect(() => {
//     if (!username) return;
//     requestNotificationPermission();
//   }, [username]);

//   // re-render every second if there are incoming offers (countdown)
//   useEffect(() => {
//     if (!Object.keys(incomingFileOffers).length) return;
//     const id = setInterval(() => setNow(Date.now()), 1000);
//     return () => clearInterval(id);
//   }, [incomingFileOffers]);

//   // persist messages helper
//   const persistMessages = (arr) => {
//     try {
//       const tail = arr.slice(-MAX_MSGS);
//       localStorage.setItem(LS_MSGS, JSON.stringify(tail));
//     } catch (e) {}
//   };

//   // messages helpers
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

//   // transfer UI helpers
//   const setTransfer = (offerId, updaterOrObj) => {
//     setTransfers((t) => {
//       const prev = t[offerId] || {};
//       const nextEntry =
//         typeof updaterOrObj === "function"
//           ? updaterOrObj(prev)
//           : { ...prev, ...updaterOrObj };
//       return { ...t, [offerId]: nextEntry };
//     });
//   };
//   const removeTransfer = (offerId) => {
//     setTransfers((t) => {
//       const copy = { ...t };
//       delete copy[offerId];
//       return copy;
//     });
//   };

//   // handle incoming file chunk and write to disk using saved handle
//   const handleIncomingFileChunk = async (data) => {
//     // defensive: some runtimes wrap chunk under .data (PeerJS / structured clone variants)
//     let { id: offerId, seq, chunk, final } = data || {};
//     try {
//       // unwrap wrapper if necessary (common PeerJS quirk)
//       if (
//         chunk &&
//         chunk.data &&
//         (chunk.data instanceof ArrayBuffer ||
//           ArrayBuffer.isView(chunk.data) ||
//           chunk.data instanceof Blob)
//       ) {
//         chunk = chunk.data;
//       }

//       const writer = saveHandlesRef.current[offerId];
//       if (!writer) {
//         console.warn("No writable for offer", offerId, "— ignoring chunk", seq);
//         return;
//       }

//       // chunk may be Blob, ArrayBuffer, or TypedArray
//       if (chunk instanceof Blob) {
//         await writer.write(chunk);
//         fileWriteStatusRef.current[offerId] =
//           (fileWriteStatusRef.current[offerId] || 0) + (chunk.size || 0);
//       } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
//         const buf =
//           chunk instanceof ArrayBuffer
//             ? new Uint8Array(chunk)
//             : new Uint8Array(chunk.buffer || chunk);
//         await writer.write(buf);
//         fileWriteStatusRef.current[offerId] =
//           (fileWriteStatusRef.current[offerId] || 0) + buf.byteLength;
//       } else {
//         console.warn("Unknown chunk type for offer", offerId, seq, chunk);
//       }

//       // update receiver progress entry
//       setTransfer(offerId, (prev) => {
//         const total = prev?.total || 0;
//         const transferred =
//           fileWriteStatusRef.current[offerId] || prev?.transferred || 0;
//         return {
//           ...prev,
//           total,
//           transferred,
//           direction: prev?.direction || "receiving",
//         };
//       });

//       if (final) {
//         try {
//           await writer.close();
//         } catch (e) {
//           console.warn("Error closing writer for offer", offerId, e);
//         }

//         // mark 100% and schedule clean
//         try {
//           setTransfer(offerId, (prev) => ({
//             ...prev,
//             transferred:
//               prev?.total ??
//               fileWriteStatusRef.current[offerId] ??
//               prev?.transferred ??
//               0,
//           }));
//           setTimeout(() => removeTransfer(offerId), 1200);
//         } catch (e) {}

//         // cleanup
//         delete saveHandlesRef.current[offerId];
//         delete fileWriteStatusRef.current[offerId];

//         // notify UI
//         setMessages((m) => {
//           const sys = {
//             id: `sys-file-done-${offerId}`,
//             from: "System",
//             text: "File received and saved to disk",
//             ts: Date.now(),
//             type: "system",
//           };
//           const next = [...m, sys];
//           persistMessages(next);
//           return next;
//         });
//       }
//     } catch (e) {
//       console.warn("handleIncomingFileChunk error", e);
//       setMessages((m) => {
//         const sys = {
//           id: `sys-file-error-${offerId}-${Date.now()}`,
//           from: "System",
//           text: `Error writing received file chunk: ${e.message || e}`,
//           ts: Date.now(),
//           type: "system",
//         };
//         const next = [...m, sys];
//         persistMessages(next);
//         return next;
//       });

//       // cleanup UI record
//       try {
//         removeTransfer(offerId);
//       } catch (er) {}
//       // try close writer if present
//       try {
//         const w = saveHandlesRef.current[offerId];
//         if (w) {
//           try {
//             await w.close();
//           } catch (er) {}
//           delete saveHandlesRef.current[offerId];
//         }
//       } catch (er) {}
//       try {
//         delete fileWriteStatusRef.current[offerId];
//       } catch (er) {}
//     }
//   };

//   // incoming messages callback from webrtc
//   const handleIncoming = async (from, payloadOrText) => {
//     // typing
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

//     // file offer received -> UI prompt for 10s
//     if (from === "__system_file_offer__" && payloadOrText) {
//       const offer = payloadOrText;
//       const offerId =
//         offer.id ||
//         `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
//       setIncomingFileOffers((s) => {
//         const copy = { ...s };
//         copy[offerId] = {
//           offer,
//           expiresAt: Date.now() + 20000,
//           origin: offer.from,
//         };
//         return copy;
//       });

//       // auto ignore after 10s
//       setTimeout(() => {
//         setIncomingFileOffers((s) => {
//           const copy = { ...s };
//           if (!copy[offerId]) return s;
//           try {
//             respondToFileOffer(offerId, offer.from, false);
//           } catch (e) {}
//           delete copy[offerId];
//           return copy;
//         });
//       }, 20000);

//       maybeNotify(
//         peerNamesMap[offer.from] || offer.from,
//         `File offer: ${offer.name}`
//       );
//       return;
//     }

//     // file offer response (sender receives accepts)
//     if (from === "__system_file_offer_response__" && payloadOrText) {
//       const { id: offerId, from: responder, accept } = payloadOrText;
//       try {
//         if (!outgoingPendingOffers.current[offerId]) return;
//         if (accept) {
//           outgoingPendingOffers.current[offerId].acceptingPeers.add(responder);
//           const file = outgoingPendingOffers.current[offerId].file;
//           if (file) {
//             // ensure sender transfer UI exists
//             setTransfer(offerId, (prev) => ({
//               direction: "sending",
//               label: file.name,
//               total: file.size || prev?.total || 0,
//               transferred: prev?.transferred || 0,
//               peers: Array.from(new Set([...(prev?.peers || []), responder])),
//             }));
//             try {
//               startSendingFile(file, offerId, [responder]);
//             } catch (e) {
//               console.warn("startSendingFile failed", e);
//             }
//           }
//         }
//       } catch (e) {
//         console.warn("file_offer_response handling failed", e);
//       }
//       return;
//     }

//     // file chunk
//     if (from === "__system_file_chunk__" && payloadOrText) {
//       await handleIncomingFileChunk(payloadOrText);
//       return;
//     }

//     // file transfer done/cancel
//     if (from === "__system_file_transfer_done__" && payloadOrText) {
//       const { id: offerId } = payloadOrText;
//       try {
//         setTransfer(offerId, (prev) => ({
//           ...prev,
//           transferred: prev?.total ?? prev?.transferred ?? 0,
//         }));
//         setTimeout(() => removeTransfer(offerId), 1200);
//       } catch (e) {}
//       setMessages((m) => {
//         const sys = {
//           id: `sys-file-complete-${offerId}`,
//           from: "System",
//           text: "File transfer completed",
//           ts: Date.now(),
//           type: "system",
//         };
//         const next = [...m, sys];
//         persistMessages(next);
//         return next;
//       });
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

//       // auto ack_read now if visible & not from self
//       try {
//         const origin = payloadOrText.from || payloadOrText.origin || null;
//         const localId = getLocalPeerId() || myId;
//         if (
//           origin &&
//           origin !== localId &&
//           document.visibilityState === "visible"
//         ) {
//           try {
//             sendAckRead(payloadOrText.id, origin);
//           } catch (e) {}
//           addUniqueToMsgArray(payloadOrText.id, "reads", localId);
//         }
//       } catch (e) {}
//       return;
//     }

//     // string fallback
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

//   // peer list update
//   const handlePeerListUpdate = (list) => {
//     setPeers(list || []);
//     try {
//       const names = getPeerNames();
//       setPeerNamesMap(names || {});
//     } catch (e) {}
//   };

//   const handleBootstrapChange = (newBootstrapId) => {
//     setJoinedBootstrap(newBootstrapId || "");
//   };

//   // init peer
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

//   // autoscroll
//   useEffect(() => {
//     if (!messagesEndRef.current) return;
//     try {
//       messagesEndRef.current.scrollIntoView({
//         behavior: "smooth",
//         block: "end",
//       });
//     } catch (e) {}
//   }, [messages]);

//   // visibility ack_read
//   useEffect(() => {
//     const onVisibility = () => {
//       if (document.visibilityState === "visible") {
//         const localId = getLocalPeerId() || myId;
//         messages.forEach((m) => {
//           if (!m || m.type !== "chat") return;
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
//     if (document.visibilityState === "visible") onVisibility();
//     return () => document.removeEventListener("visibilitychange", onVisibility);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [messages, myId]);

//   // outside click for menu
//   useEffect(() => {
//     const onDocClick = (e) => {
//       if (!menuRef.current) return;
//       if (!menuRef.current.contains(e.target)) setMenuOpen(false);
//     };
//     if (menuOpen) document.addEventListener("mousedown", onDocClick);
//     else document.removeEventListener("mousedown", onDocClick);
//     return () => document.removeEventListener("mousedown", onDocClick);
//   }, [menuOpen]);

//   // typing broadcast
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

//   // create hub
//   const handleCreateHub = () => {
//     const id = getLocalPeerId() || myId;
//     if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
//     joinHub(id);
//     setJoinedBootstrap(id);

//     localStorage.setItem("ph_hub_bootstrap", id);
//     localStorage.setItem("ph_should_autojoin", "true");

//     const sysPlain = {
//       id: `sys-create-${Date.now()}`,
//       from: "System",
//       text: `You created the hub. Share this ID: ${id}`,
//       ts: Date.now(),
//       type: "system",
//     };
//     setMessages((m) => {
//       const next = [...m, sysPlain];
//       persistMessages(next);
//       return next;
//     });

//     try {
//       const publicText = `[${username || "Host"}] is the host`;
//       broadcastSystem("system_public", publicText, `sys-host-${id}`);
//     } catch (e) {
//       console.warn("broadcastSystem failed", e);
//     }

//     setMenuOpen(false);
//   };

//   // join hub
//   const handleJoinHub = async () => {
//     const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
//     if (!id) {
//       setMenuOpen(false);
//       return;
//     }
//     const trimmed = id.trim();
//     joinHub(trimmed);
//     setJoinedBootstrap(trimmed);

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

//   // leave hub
//   const handleLeaveClick = () => {
//     setMenuOpen(false);
//     setConfirmLeaveOpen(true);
//   };

//   const handleConfirmLeave = () => {
//     try {
//       leaveHub();
//     } catch (e) {}
//     setJoinedBootstrap("");

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
//       deliveries: [],
//       reads: [getLocalPeerId() || myId],
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

//   // reply + send ack_read
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
//         addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId);
//       } catch (e) {
//         console.warn("sendAckRead error", e);
//       }
//     }
//   };

//   // render status dot
//   const renderStatusDot = (m) => {
//     const totalPeers = peers?.length || 0;
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

//     if (deliveries < totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
//           title={`Single tick — delivered to ${deliveries}/${totalPeers}`}
//         />
//       );
//     }

//     if (deliveries === totalPeers && reads < totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
//           title={`Double tick — delivered to all (${totalPeers}), reads ${reads}/${totalPeers}`}
//         />
//       );
//     }

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

//   // message renderer
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
//           <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm max-w-[80%] whitespace-normal break-words">
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

//   // file input (sender) - file picker
//   const onFileSelected = async (file) => {
//     if (!file) return;
//     const offerId = `offer-${Date.now()}-${Math.random()
//       .toString(36)
//       .slice(2, 7)}`;
//     outgoingPendingOffers.current[offerId] = {
//       file,
//       acceptingPeers: new Set(),
//     };

//     // init sender UI entry
//     setTransfer(offerId, {
//       direction: "sending",
//       label: file.name,
//       total: file.size || 0,
//       transferred: 0,
//       peers: [],
//     });

//     const meta = {
//       id: offerId,
//       name: file.name,
//       size: file.size,
//       mime: file.type,
//       from: getLocalPeerId() || myId,
//     };
//     try {
//       offerFileToPeers(meta);
//     } catch (e) {
//       console.warn("offerFileToPeers failed", e);
//     }

//     setMessages((m) => {
//       const sys = {
//         id: `sys-offer-${offerId}`,
//         from: "System",
//         text: `Offered file: ${file.name} (${Math.round(file.size / 1024)} KB)`,
//         ts: Date.now(),
//         type: "system",
//       };
//       const next = [...m, sys];
//       persistMessages(next);
//       return next;
//     });

//     // cleanup if nobody accepts after 10s
//     setTimeout(() => {
//       try {
//         const pending = outgoingPendingOffers.current[offerId];
//         if (!pending) return;
//         if (pending.acceptingPeers.size === 0) {
//           setMessages((m) => {
//             const sys = {
//               id: `sys-offer-expire-${offerId}`,
//               from: "System",
//               text: `No one accepted the file offer: ${file.name}`,
//               ts: Date.now(),
//               type: "system",
//             };
//             const next = [...m, sys];
//             persistMessages(next);
//             return next;
//           });
//           setTimeout(() => removeTransfer(offerId), 800);
//         }
//       } catch (e) {
//         console.warn("post-offer cleanup failed", e);
//       }
//     }, 20000);
//   };

//   const handleFileInputClick = () => {
//     const input = document.createElement("input");
//     input.type = "file";
//     input.onchange = (e) => {
//       const f = e.target.files && e.target.files[0];
//       if (f) onFileSelected(f);
//     };
//     input.click();
//   };

//   // accept incoming offer -> ask where to save and respond true
//   const acceptFileOffer = async (offerId) => {
//     const entry = incomingFileOffers[offerId];
//     if (!entry) return;
//     const { offer } = entry;
//     try {
//       if (supportsNativeFileSystem()) {
//         const opts = {
//           suggestedName: offer.name,
//           types: [
//             {
//               description: offer.mime || "file",
//               accept: {
//                 [offer.mime || "application/octet-stream"]: [
//                   "." + (offer.name.split(".").pop() || ""),
//                 ],
//               },
//             },
//           ],
//         };
//         const handle = await (window.showSaveFilePicker
//           ? window.showSaveFilePicker(opts)
//           : window.chooseFileSystemEntries
//           ? window.chooseFileSystemEntries({
//               type: "save-file",
//               accepts: opts.types,
//             })
//           : null);
//         if (!handle) {
//           respondToFileOffer(offerId, offer.from, false);
//           setIncomingFileOffers((s) => {
//             const copy = { ...s };
//             delete copy[offerId];
//             return copy;
//           });
//           return;
//         }
//         const writable = await handle.createWritable();
//         saveHandlesRef.current[offerId] = writable;
//         fileWriteStatusRef.current[offerId] = 0;

//         // set receiver UI progress entry
//         setTransfer(offerId, {
//           direction: "receiving",
//           label: offer.name,
//           total: offer.size || 0,
//           transferred: 0,
//           peers: [offer.from],
//         });

//         respondToFileOffer(offerId, offer.from, true);
//         setIncomingFileOffers((s) => {
//           const copy = { ...s };
//           delete copy[offerId];
//           return copy;
//         });
//         setMessages((m) => {
//           const sys = {
//             id: `sys-accept-${offerId}`,
//             from: "System",
//             text: `Accepted file: ${offer.name}`,
//             ts: Date.now(),
//             type: "system",
//           };
//           const next = [...m, sys];
//           persistMessages(next);
//           return next;
//         });
//       } else {
//         // fallback: accept but warn
//         respondToFileOffer(offerId, offer.from, true);
//         setIncomingFileOffers((s) => {
//           const copy = { ...s };
//           delete copy[offerId];
//           return copy;
//         });
//         setMessages((m) => {
//           const sys = {
//             id: `sys-accept-${offerId}`,
//             from: "System",
//             text: `Accepted file: ${offer.name} — browser may not support direct disk writes.`,
//             ts: Date.now(),
//             type: "system",
//           };
//           const next = [...m, sys];
//           persistMessages(next);
//           return next;
//         });
//         setTransfer(offerId, {
//           direction: "receiving",
//           label: offer.name,
//           total: offer.size || 0,
//           transferred: 0,
//           peers: [offer.from],
//         });
//       }
//     } catch (e) {
//       console.warn("acceptFileOffer failed", e);
//       try {
//         respondToFileOffer(offerId, offer.from, false);
//       } catch (er) {}
//       setIncomingFileOffers((s) => {
//         const copy = { ...s };
//         delete copy[offerId];
//         return copy;
//       });
//     }
//   };

//   const ignoreFileOffer = (offerId) => {
//     const entry = incomingFileOffers[offerId];
//     if (!entry) return;
//     try {
//       respondToFileOffer(offerId, entry.offer.from, false);
//     } catch (e) {
//       console.warn("ignoreFileOffer failed", e);
//     }
//     setIncomingFileOffers((s) => {
//       const copy = { ...s };
//       delete copy[offerId];
//       return copy;
//     });
//   };

//   // wire up progress/completion callbacks exported by webrtc.js
//   useEffect(() => {
//     const progressCb = (offerId, peerId, bytes, totalBytes) => {
//       setTransfer(offerId, (prev) => ({
//         direction: prev?.direction || "sending",
//         label: prev?.label || `Transfer ${offerId}`,
//         total: totalBytes || prev?.total || 0,
//         transferred: bytes || prev?.transferred || 0,
//         peers: Array.from(new Set([...(prev?.peers || []), peerId])),
//       }));
//     };
//     const completeCb = (offerId, peerId) => {
//       setTransfer(offerId, (prev) => ({
//         ...prev,
//         transferred: prev?.total ?? prev?.transferred ?? 0,
//         peers: Array.from(new Set([...(prev?.peers || []), peerId])),
//       }));
//       setTimeout(() => removeTransfer(offerId), 1200);
//     };

//     try {
//       setOnFileProgress(progressCb);
//       setOnFileComplete(completeCb);
//     } catch (e) {
//       // if exports not present, ignore gracefully
//       // console.warn("Failed to register progress callbacks", e);
//     }

//     return () => {
//       try {
//         setOnFileProgress(null);
//         setOnFileComplete(null);
//       } catch (e) {}
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // connected peer names
//   const connectedNames = peers.length
//     ? peers.map((id) => peerNamesMap[id] || id)
//     : [];

//   const typingSummary = () => {
//     const names = Object.keys(typingUsers);
//     if (!names.length) return null;
//     const shown = names.slice(0, 2).join(", ");
//     return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
//   };

//   const renderIncomingFileOffers = () => {
//     const keys = Object.keys(incomingFileOffers);
//     if (!keys.length) return null;
//     return keys.map((k) => {
//       const entry = incomingFileOffers[k];
//       const offer = entry.offer;
//       const remaining = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
//       return (
//         <div
//           key={k}
//           className="mb-2 p-2 rounded bg-white/10 text-sm text-black"
//         >
//           <div className="font-semibold">
//             <span className="inline-block max-w-[260px] whitespace-normal break-words">
//               File offer:&nbsp;
//               <strong className="break-words">{offer.name}</strong>
//             </span>
//             <span className="ml-2 text-xs text-gray-500">
//               ({Math.round((offer.size || 0) / 1024)} KB)
//             </span>
//           </div>

//           <div className="text-xs text-gray-600">
//             From: {peerNamesMap[offer.from] || offer.from} — Expires in{" "}
//             {remaining}s
//           </div>
//           <div className="mt-2 flex justify-center gap-2">
//             <button
//               onClick={() => acceptFileOffer(k)}
//               className="px-3 py-1 rounded bg-gradient-to-br from-green-500 to-green-600 text-white"
//             >
//               Accept
//             </button>
//             <button
//               onClick={() => ignoreFileOffer(k)}
//               className="px-3 py-1 rounded bg-gradient-to-br from-red-500 to-red-600 text-white"
//             >
//               Ignore
//             </button>
//           </div>
//         </div>
//       );
//     });
//   };

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

//   // UI rendering
//   return (
//     <>
//       {/* Floating progress panel */}
//       {Object.keys(transfers).length > 0 && (
//         <div className="fixed left-1/2 -translate-x-1/2 top-4 z-50">
//           <div className="bg-black/80 text-white rounded-lg p-3 shadow-lg w-[min(720px,calc(100%-40px))]">
//             {Object.entries(transfers).map(([id, t]) => {
//               const pct = t.total
//                 ? Math.min(100, Math.round((t.transferred / t.total) * 100))
//                 : 0;
//               const label = t.label || id;
//               const directionText =
//                 t.direction === "sending" ? "Sending" : "Receiving";
//               const humanTransferred = `${Math.round(
//                 (t.transferred || 0) / 1024
//               )} KB`;
//               const humanTotal = `${Math.round((t.total || 0) / 1024)} KB`;
//               return (
//                 <div key={id} className="mb-3 last:mb-0">
//                   <div className="flex justify-between items-center text-sm mb-1">
//                     <div className="font-semibold max-w-[70%] break-words whitespace-normal">
//                       {directionText}: {label}
//                     </div>

//                     <div className="text-xs">{pct}%</div>
//                   </div>
//                   <div className="w-full bg-white/10 rounded h-2 overflow-hidden mb-1">
//                     <div
//                       style={{ width: `${pct}%` }}
//                       className="h-2 bg-blue-500 transition-all"
//                     />
//                   </div>
//                   <div className="text-xs text-white/60">
//                     {humanTransferred} / {humanTotal}
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         </div>
//       )}

//       <div className="h-[92vh] md:h-[92vh] max-w-[420px] w-full mx-auto bg-gray-50 text-purple-600 p-6 flex flex-col rounded-4xl">
//         <header className="flex items-center justify-between mb-4">
//           <div className="flex gap-2.5">
//             <div className="text-sm text-blue-600">YourID</div>
//             <div className="font-mono">{myId || "..."}</div>
//             <div className="text-sm text-blue-600">Name: {username}</div>
//             <div className="text-xs text-purple-500 mt-1">
//               Auto-join: {joinedBootstrap || "none"}
//             </div>
//           </div>

//           <div className="relative" ref={menuRef}>
//             <button
//               onClick={() => setMenuOpen((s) => !s)}
//               className="p-2 rounded-full bg-gradient-to-br from-gray-50 to-gray-50 text-white"
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

//         <main className="flex-1 overflow-auto mb-4 min-h-0">
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

//           {renderIncomingFileOffers()}

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
//           <div className="relative w-full flex items-center">
//             {/* clip icon inside input (left) */}
//             <svg
//               onClick={handleFileInputClick}
//               xmlns="http://www.w3.org/2000/svg"
//               viewBox="0 0 24 24"
//               fill="none"
//               stroke="currentColor"
//               strokeWidth="2"
//               strokeLinecap="round"
//               strokeLinejoin="round"
//               className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700"
//               title="Attach File"
//             >
//               <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 015 5l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.49" />
//             </svg>

//             <input
//               value={text}
//               onChange={(e) => setText(e.target.value)}
//               placeholder="Type a message..."
//               className="flex-1 p-3 pl-10 pr-10 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
//               onKeyDown={(e) => {
//                 if (e.key === "Enter") send();
//               }}
//             />

//             {/* send icon inside input (right) */}
//             <svg
//               onClick={send}
//               xmlns="http://www.w3.org/2000/svg"
//               viewBox="0 0 24 24"
//               fill="currentColor"
//               className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 text-blue-500 cursor-pointer hover:text-blue-700"
//               title="Send"
//             >
//               <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
//             </svg>
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

// Reply in Thread

// src/components/Chat.jsx
import "./App.css";
import React, { useEffect, useState, useRef } from "react";
import {
  initPeer,
  sendChat,
  sendTyping,
  sendAckRead,
  sendAckDeliver,
  getPeerNames,
  joinHub,
  leaveHub,
  getLocalPeerId,
  connectToPeer,
  broadcastSystem,
  offerFileToPeers,
  respondToFileOffer,
  startSendingFile,
  supportsNativeFileSystem,
  setOnFileProgress,
  setOnFileComplete,
} from "./webrtc";
import { requestNotificationPermission, showNotification } from "./notify";
import { nanoid } from "nanoid";
import ReplyInThread from "./ReplyInThread";
import HubInfo from "./HubInfo";

const LS_MSGS = "ph_msgs_v1";
const LS_THREADS = "ph_threads_v1";
const MAX_MSGS = 100;

// === tiny IndexedDB helper (paste near top of file) ===
const IMG_DB_NAME = "peershub_images_v1";
const IMG_STORE = "images";

function openImgDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMG_STORE)) {
        db.createObjectStore(IMG_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteImgDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IMG_DB_NAME);
    req.onsuccess = () => resolve(true);
    req.onblocked = () => resolve(true); // treat blocked as success (best-effort)
    req.onerror = (e) => reject(e.target?.error || e);
  });
}

async function idbPut(key, value) {
  const db = await openImgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readwrite");
    const store = tx.objectStore(IMG_STORE);
    const r = store.put(value, key);
    r.onsuccess = () => {
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}

async function idbGet(key) {
  const db = await openImgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readonly");
    const store = tx.objectStore(IMG_STORE);
    const r = store.get(key);
    r.onsuccess = () => {
      db.close();
      resolve(r.result);
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}

async function idbDelete(key) {
  const db = await openImgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readwrite");
    const r = tx.objectStore(IMG_STORE).delete(key);
    r.onsuccess = () => {
      db.close();
      resolve(true);
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}

export default function Chat() {
  // core state
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

  // const [peers, setPeers] = useState([]); // list of {id, name, isHost}
  const [isHubInfoOpen, setIsHubInfoOpen] = useState(false);

  const [localId, setLocalId] = useState(null);
  const [localIsHost, setLocalIsHost] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(
    Notification.permission === "granted"
  );

  // Threading state
  const [threadMessages, setThreadMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_THREADS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
  });

  // --- Hydration: initial messages from localStorage -> state (rehydrate imageGroup from IndexedDB) ---
  useEffect(() => {
    let cancelled = false;

    const hydrateMessages = async () => {
      try {
        const raw = localStorage.getItem(LS_MSGS);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const rehydrated = await Promise.all(
          parsed.map(async (m) => {
            const copy = { ...m };

            // hydrate imageGroup from imageRefs (if refs exist)
            if (Array.isArray(copy.imageRefs) && copy.imageRefs.length) {
              const imgs = [];
              for (const key of copy.imageRefs) {
                try {
                  const dataUrl = await idbGet(key);
                  if (dataUrl && typeof dataUrl === "string")
                    imgs.push(dataUrl);
                } catch (e) {
                  // ignore individual failures
                }
              }
              if (imgs.length) copy.imageGroup = imgs;
            }

            // hydrate preview
            if (copy.imageRef && !copy.imagePreview) {
              try {
                const d = await idbGet(copy.imageRef);
                if (d && typeof d === "string") copy.imagePreview = d;
              } catch (e) {}
            }

            return copy;
          })
        );

        if (!cancelled) setMessages(rehydrated);
      } catch (e) {
        console.warn("Initial message hydration failed:", e);
      }
    };

    hydrateMessages();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Thread hydration (rehydrate imageGroup / imagePreview from refs) ---
  useEffect(() => {
    let cancelled = false;
    const hydrateThreads = async () => {
      try {
        if (!threadMessages || !Object.keys(threadMessages).length) return;

        const updates = {}; // rootId -> { msgId: {imageGroup, imagePreview} }
        await Promise.all(
          Object.keys(threadMessages).map(async (rootId) => {
            const msgs = threadMessages[rootId] || [];
            await Promise.all(
              msgs.map(async (m) => {
                try {
                  let imageGroup = null;
                  let imagePreview = null;

                  if (
                    Array.isArray(m.imageRefs) &&
                    m.imageRefs.length &&
                    !Array.isArray(m.imageGroup)
                  ) {
                    const imgs = [];
                    for (const key of m.imageRefs) {
                      try {
                        const d = await idbGet(key);
                        if (d && typeof d === "string") imgs.push(d);
                      } catch (e) {}
                    }
                    if (imgs.length) imageGroup = imgs;
                  }

                  if (m.imageRef && !m.imagePreview) {
                    try {
                      const d = await idbGet(m.imageRef);
                      if (d && typeof d === "string") imagePreview = d;
                    } catch (e) {}
                  }

                  if (imageGroup || imagePreview) {
                    updates[rootId] = updates[rootId] || {};
                    updates[rootId][m.id] = { imageGroup, imagePreview };
                  }
                } catch (e) {
                  console.warn("Thread hydration failed for msg:", m.id, e);
                }
              })
            );
          })
        );

        if (cancelled) return;

        if (Object.keys(updates).length) {
          setThreadMessages((prev) => {
            const copy = { ...prev };
            Object.keys(updates).forEach((rootId) => {
              copy[rootId] = (copy[rootId] || []).map((msg) =>
                updates[rootId][msg.id]
                  ? { ...msg, ...updates[rootId][msg.id] }
                  : msg
              );
            });
            // persist after hydration so localStorage remains consistent
            persistThreadMessages(copy);
            return copy;
          });
        }
      } catch (e) {
        console.warn("hydrateThreads failed:", e);
      }
    };

    hydrateThreads();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(threadMessages || {}).join(",")]);

  // UI: attach menu + file input refs
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const fileInputImageRef = useRef(null);
  const fileInputOfferRef = useRef(null);

  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [caption, setCaption] = useState("");

  const [activeThread, setActiveThread] = useState(null);

  const [threadTypingUsers, setThreadTypingUsers] = useState({});

  // file transfer
  const [incomingFileOffers, setIncomingFileOffers] = useState({});
  const [transfers, setTransfers] = useState({});

  const saveHandlesRef = useRef({});
  const fileWriteStatusRef = useRef({});
  const outgoingPendingOffers = useRef({});

  const fileInputRef = useRef(null);

  // UI / other state
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
  const [now, setNow] = useState(Date.now());

  // typing
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const typingTimeoutRef = useRef(null);

  // Long press handling for thread replies
  const longPressTimeoutRef = useRef(null);
  const [longPressMessage, setLongPressMessage] = useState(null);

  // refs
  const messagesEndRef = useRef(null);
  const seenSystemIdsRef = useRef(new Set());
  const peerRef = useRef(null);
  const menuRef = useRef(null);

  const attachMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setAttachMenuOpen(false);
      }
    };

    if (attachMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [attachMenuOpen]);

  // notifications permission on username set
  useEffect(() => {
    if (!username) return;
    requestNotificationPermission();
  }, [username]);

  // re-render every second if there are incoming offers (countdown)
  useEffect(() => {
    if (!Object.keys(incomingFileOffers).length) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [incomingFileOffers]);

  // persist messages helper
  const persistMessages = (arr) => {
    try {
      // store only lightweight info to avoid localStorage quota issues
      const tail = arr.slice(-MAX_MSGS).map((msg) => {
        const m = { ...msg };

        // if message holds big image data, prefer imageRefs and drop raw data
        if (Array.isArray(m.imageGroup)) {
          if (Array.isArray(m.imageRefs) && m.imageRefs.length) {
            // we have refs -> remove heavy inline base64 prior to saving
            delete m.imageGroup;
          } else {
            // fallback: keep only short strings (rare)
            m.imageGroup = m.imageGroup
              .map((it) =>
                typeof it === "string" && it.length < 200 ? it : null
              )
              .filter(Boolean);
          }
        }

        // single preview
        if (m.imagePreview && typeof m.imagePreview === "string") {
          if (m.imageRef && m.imagePreview.length > 200) {
            delete m.imagePreview;
          } else if (m.imagePreview.length > 1000) {
            // too big and no ref -> strip it to avoid quota errors
            delete m.imagePreview;
          }
        }

        return m;
      });

      try {
        localStorage.setItem(LS_MSGS, JSON.stringify(tail));
      } catch (e) {
        // fallback: aggressive cleanup if quota exceeded
        console.warn("persistMessages failed", e);
        if (
          e &&
          (e.name === "QuotaExceededError" ||
            (e.message || "").includes("quota"))
        ) {
          try {
            const aggressiveTail = arr
              .slice(-Math.min(50, MAX_MSGS))
              .map((msg) => {
                const m = { ...msg };
                if (Array.isArray(m.imageGroup)) {
                  // remove all but tiny placeholders
                  m.imageGroup = m.imageGroup
                    .map((it) =>
                      typeof it === "string" && it.length < 500 ? it : null
                    )
                    .filter(Boolean);
                  if (!m.imageGroup.length) delete m.imageGroup;
                }
                if (
                  m.imagePreview &&
                  typeof m.imagePreview === "string" &&
                  m.imagePreview.length > 500
                ) {
                  delete m.imagePreview;
                }
                return m;
              });
            localStorage.setItem(LS_MSGS, JSON.stringify(aggressiveTail));
          } catch (e2) {
            console.warn("Aggressive persist also failed", e2);
          }
        }
      }
    } catch (e) {
      console.warn("persistMessages top-level failed", e);
    }
  };

  const handleToggleNotifications = async () => {
    try {
      if (Notification.permission === "granted") {
        // can't programmatically revoke; just reflect state
        alert("Notifications already granted in browser settings.");
        setNotificationsEnabled(true);
        return;
      }

      const result = await requestNotificationPermission();
      setNotificationsEnabled(result === "granted");
      if (result !== "granted") {
        alert(
          "You blocked notifications. To enable, allow them in your browser settings."
        );
      }
    } catch (e) {
      console.warn("handleToggleNotifications failed:", e);
    }
  };

  const handleSetName = () => {
    const newName = prompt("Enter your new display name:", username);
    if (!newName) return;
    setUsername(newName);
    localStorage.setItem("ph_name", newName);

    const sys = {
      id: `sys-namechange-${Date.now()}`,
      from: "System",
      text: `You are now known as ${newName}`,
      ts: Date.now(),
      type: "system",
    };
    setMessages((m) => {
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });
  };

  // persist thread messages helper — keep imageGroup alongside imageRefs where possible
  const persistThreadMessages = (threads) => {
    try {
      const safe = {};
      Object.keys(threads).forEach((rootId) => {
        safe[rootId] = (threads[rootId] || []).map((msg) => {
          const m = { ...msg };

          // If imageGroup exists, preserve it for immediate display.
          // If we have imageRefs, we may drop very large inline data URLs to avoid LS bloat,
          // but we DO NOT unconditionally delete imageGroup.
          if (Array.isArray(m.imageGroup) && m.imageGroup.length) {
            if (!Array.isArray(m.imageRefs)) {
              // no refs — keep only small inline items
              m.imageGroup = m.imageGroup
                .map((it) =>
                  typeof it === "string" && it.length < 1000 ? it : null
                )
                .filter(Boolean);
              if (!m.imageGroup.length) delete m.imageGroup;
            } else {
              // we have refs — keep imageGroup but strip extremely large data URLs
              m.imageGroup = m.imageGroup.filter((it, i) => {
                if (typeof it !== "string") return false;
                // if there is a corresponding ref and the data is huge, drop it
                if (m.imageRefs[i] && it.length > 100000) return false;
                return true;
              });
              if (!m.imageGroup.length) delete m.imageGroup;
            }
          }

          // single preview handling: same idea
          if (m.imagePreview && typeof m.imagePreview === "string") {
            if (m.imageRef && m.imagePreview.length > 100000) {
              delete m.imagePreview;
            } else if (m.imagePreview.length > 200000) {
              // extremely large - drop it
              delete m.imagePreview;
            }
          }

          return m;
        });
      });
      localStorage.setItem(LS_THREADS, JSON.stringify(safe));
    } catch (e) {
      console.warn("persistThreadMessages failed", e);
    }
  };

  // messages helpers
  const upsertIncomingChat = (incoming) => {
    // If this is a thread reply
    if (incoming.type === "thread" && incoming.threadRootId) {
      setThreadMessages((threads) => {
        const rootId = incoming.threadRootId;
        const existing = threads[rootId] || [];
        const existingMsg = existing.find((x) => x.id === incoming.id);

        // Build normalized stored object that preserves imageGroup for immediate render,
        // while keeping imageRefs if present for persistence.
        const makeMsgObj = (src) => {
          return {
            id: src.id,
            from: src.fromName || src.from || "peer",
            fromId: src.from,
            text: src.text || "",
            ts: src.ts || Date.now(),
            type: "thread",
            threadRootId: src.threadRootId,
            deliveries: src.deliveries || [],
            reads: src.reads || [],
            replyTo: src.replyTo || null,
            // Keep inline group if present (for immediate display). Persisting will trim if needed.
            imageGroup: Array.isArray(src.imageGroup)
              ? src.imageGroup
              : undefined,
            // single preview (if present)
            imagePreview: src.imagePreview || undefined,
            // keep metadata
            imageMeta: src.imageMeta || undefined,
            // merge any refs if sender provided them
            imageRefs: Array.isArray(src.imageRefs) ? src.imageRefs : undefined,
          };
        };

        let updated;
        if (existingMsg) {
          updated = {
            ...threads,
            [rootId]: existing.map((x) =>
              x.id === incoming.id ? { ...x, ...makeMsgObj(incoming) } : x
            ),
          };
        } else {
          const msgObj = makeMsgObj(incoming);
          updated = {
            ...threads,
            [rootId]: [...existing, msgObj],
          };
        }

        // persist the thread messages (persistThreadMessages will trim very large inline data but won't drop imageGroup)
        persistThreadMessages(updated);
        return updated;
      });
      return;
    }

    // Normal chat (non-thread) message
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
        text: incoming.text || "",
        ts: incoming.ts || Date.now(),
        type: "chat",
        replyTo: incoming.replyTo || null,
        deliveries: incoming.deliveries || [],
        reads: incoming.reads || [],
        imageGroup: Array.isArray(incoming.imageGroup)
          ? incoming.imageGroup
          : undefined,
        imagePreview: incoming.imagePreview || undefined,
        imageMeta: incoming.imageMeta || undefined,
        imageRefs: Array.isArray(incoming.imageRefs)
          ? incoming.imageRefs
          : undefined,
        imageRef: incoming.imageRef || undefined,
      };

      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });
  };

  const addUniqueToMsgArray = (
    msgId,
    field,
    peerId,
    isThread = false,
    threadRootId = null
  ) => {
    if (isThread && threadRootId) {
      setThreadMessages((threads) => {
        const existing = threads[threadRootId] || [];
        const updated = {
          ...threads,
          [threadRootId]: existing.map((msg) => {
            if (msg.id !== msgId) return msg;
            const arr = Array.isArray(msg[field]) ? [...msg[field]] : [];
            if (!arr.includes(peerId)) arr.push(peerId);
            return { ...msg, [field]: arr };
          }),
        };
        persistThreadMessages(updated);
        return updated;
      });
    } else {
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
    }
  };

  const markThreadAsRead = (rootId) => {
    try {
      const localId = getLocalPeerId() || myId;
      const msgs = threadMessages[rootId] || [];
      msgs.forEach((m) => {
        const origin = m.fromId || m.from;
        const alreadyRead = Array.isArray(m.reads) && m.reads.includes(localId);
        if (!origin || origin === localId || alreadyRead) return;

        try {
          // messageId, peerId, isThread, threadRootId
          sendAckRead(m.id, origin, true, m.threadRootId);
          addUniqueToMsgArray(m.id, "reads", localId, true, rootId);
        } catch (e) {
          console.warn("markThreadAsRead: sendAckRead failed", e);
        }
      });
    } catch (e) {
      console.warn("markThreadAsRead failed", e);
    }
  };

  // transfer UI helpers
  const setTransfer = (offerId, updaterOrObj) => {
    setTransfers((t) => {
      const prev = t[offerId] || {};
      const nextEntry =
        typeof updaterOrObj === "function"
          ? updaterOrObj(prev)
          : { ...prev, ...updaterOrObj };
      return { ...t, [offerId]: nextEntry };
    });
  };

  const removeTransfer = (offerId) => {
    setTransfers((t) => {
      const copy = { ...t };
      delete copy[offerId];
      return copy;
    });
  };

  // handle incoming file chunk and write to disk using saved handle
  const handleIncomingFileChunk = async (data) => {
    let { id: offerId, seq, chunk, final } = data || {};
    try {
      if (
        chunk &&
        chunk.data &&
        (chunk.data instanceof ArrayBuffer ||
          ArrayBuffer.isView(chunk.data) ||
          chunk.data instanceof Blob)
      ) {
        chunk = chunk.data;
      }

      const writer = saveHandlesRef.current[offerId];
      if (!writer) {
        console.warn("No writable for offer", offerId, "— ignoring chunk", seq);
        return;
      }

      if (chunk instanceof Blob) {
        await writer.write(chunk);
        fileWriteStatusRef.current[offerId] =
          (fileWriteStatusRef.current[offerId] || 0) + (chunk.size || 0);
      } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
        const buf =
          chunk instanceof ArrayBuffer
            ? new Uint8Array(chunk)
            : new Uint8Array(chunk.buffer || chunk);
        await writer.write(buf);
        fileWriteStatusRef.current[offerId] =
          (fileWriteStatusRef.current[offerId] || 0) + buf.byteLength;
      } else {
        console.warn("Unknown chunk type for offer", offerId, seq, chunk);
      }

      setTransfer(offerId, (prev) => {
        const total = prev?.total || 0;
        const transferred =
          fileWriteStatusRef.current[offerId] || prev?.transferred || 0;
        return {
          ...prev,
          total,
          transferred,
          direction: prev?.direction || "receiving",
        };
      });

      if (final) {
        try {
          await writer.close();
        } catch (e) {
          console.warn("Error closing writer for offer", offerId, e);
        }

        try {
          setTransfer(offerId, (prev) => ({
            ...prev,
            transferred:
              prev?.total ??
              fileWriteStatusRef.current[offerId] ??
              prev?.transferred ??
              0,
          }));
          setTimeout(() => removeTransfer(offerId), 1200);
        } catch (e) {}

        delete saveHandlesRef.current[offerId];
        delete fileWriteStatusRef.current[offerId];

        setMessages((m) => {
          const sys = {
            id: `sys-file-done-${offerId}`,
            from: "System",
            text: "File received and saved to disk",
            ts: Date.now(),
            type: "system",
          };
          const next = [...m, sys];
          persistMessages(next);
          return next;
        });
      }
    } catch (e) {
      console.warn("handleIncomingFileChunk error", e);
      setMessages((m) => {
        const sys = {
          id: `sys-file-error-${offerId}-${Date.now()}`,
          from: "System",
          text: `Error writing received file chunk: ${e.message || e}`,
          ts: Date.now(),
          type: "system",
        };
        const next = [...m, sys];
        persistMessages(next);
        return next;
      });

      try {
        removeTransfer(offerId);
      } catch (er) {}
      try {
        const w = saveHandlesRef.current[offerId];
        if (w) {
          try {
            await w.close();
          } catch (er) {}
          delete saveHandlesRef.current[offerId];
        }
      } catch (er) {}
      try {
        delete fileWriteStatusRef.current[offerId];
      } catch (er) {}
    }
  };
  const handleIncoming = async (from, payloadOrText) => {
    console.debug("handleIncoming:", { from, payloadOrText });

    try {
      // Normalize message object so we can check fields consistently.
      // If payloadOrText is a string, convert to a simple chat-like object.
      const msg =
        payloadOrText && typeof payloadOrText === "object"
          ? payloadOrText
          : {
              type: "chat",
              text: typeof payloadOrText === "string" ? payloadOrText : "",
            };

      // ---- Robust system-force / force-leave handler ----
      // Two possible shapes:
      // 1) Direct system object: { type: 'system', action: 'force-leave', ... }
      // 2) Broadcast system message where payload.text is JSON: { type: 'system_force', text: '{"action":"force-leave","target":"peerId"}' }
      try {
        // Case A: direct action field on normalized msg
        if (
          msg &&
          msg.type === "system" &&
          (msg.action === "force-leave" || msg.action === "forceLeave")
        ) {
          const sys = {
            id: `sys-forced-left-${Date.now()}`,
            from: "System",
            text: "You were removed from the hub by the host.",
            ts: Date.now(),
            type: "system",
          };
          setMessages((m) => {
            const next = [...m, sys];
            persistMessages(next);
            return next;
          });

          try {
            await deleteImgDB().catch(() => {});
          } catch (e) {
            console.warn("deleteImgDB during force-leave failed:", e);
          }
          try {
            leaveHub();
          } catch (e) {
            console.warn("leaveHub during force-leave failed:", e);
          }
          localStorage.removeItem("ph_hub_bootstrap");
          localStorage.removeItem("ph_should_autojoin");
          return;
        }

        // Case B: broadcast JSON inside system text or a special system type
        if (
          payloadOrText &&
          typeof payloadOrText === "object" &&
          payloadOrText.type &&
          payloadOrText.type.toString().startsWith("system")
        ) {
          // Attempt to extract JSON payload from .text (or payloadOrText itself may be the object)
          let maybeObj = null;
          if (typeof payloadOrText.text === "string") {
            try {
              maybeObj = JSON.parse(payloadOrText.text);
            } catch (e) {
              maybeObj = null;
            }
          }
          // If the system payload itself carries action fields directly, use it
          if (!maybeObj && typeof payloadOrText.action === "string") {
            maybeObj = payloadOrText;
          }

          if (
            maybeObj &&
            (maybeObj.action === "force-leave" ||
              maybeObj.action === "forceLeave")
          ) {
            const target = maybeObj.target || maybeObj.to || maybeObj.peer;
            const local = getLocalPeerId() || myId;
            if (target === local) {
              const sys = {
                id: `sys-forced-left-${Date.now()}`,
                from: "System",
                text: "You were removed from the hub by the host.",
                ts: Date.now(),
                type: "system",
              };
              setMessages((m) => {
                const next = [...m, sys];
                persistMessages(next);
                return next;
              });

              try {
                await deleteImgDB().catch(() => {});
              } catch (e) {}
              try {
                leaveHub();
              } catch (e) {}
              localStorage.removeItem("ph_hub_bootstrap");
              localStorage.removeItem("ph_should_autojoin");
              return;
            }
            // If target doesn't match, ignore
          }
          // continue - non-force system messages handled later down
        }
      } catch (sysErr) {
        console.warn("force-leave handler error:", sysErr, payloadOrText);
      }

      // --- Enhanced Image Processing for Incoming Messages ---
      // Only run the heavy preprocessing for chat/thread objects that have an id
      if (
        payloadOrText &&
        typeof payloadOrText === "object" &&
        (payloadOrText.type === "chat" || payloadOrText.type === "thread") &&
        payloadOrText.id
      ) {
        try {
          const incomingCopy = { ...payloadOrText };
          const isDataUrl = (s) =>
            typeof s === "string" && s.startsWith("data:");

          // Process imageGroup (array of images)
          if (
            Array.isArray(incomingCopy.imageGroup) &&
            incomingCopy.imageGroup.length
          ) {
            const validImages = [];
            const imageRefs = [];

            await Promise.all(
              incomingCopy.imageGroup.map(async (item, i) => {
                try {
                  if (isDataUrl(item)) {
                    // Create unique key for this image (use id + index)
                    const key = `img-${incomingCopy.id}-${i}`;

                    try {
                      // Store to IndexedDB
                      await idbPut(key, item);
                      imageRefs.push(key);
                      validImages.push(item); // Keep for immediate display
                      console.debug(
                        `Stored incoming image to IndexedDB: ${key}`
                      );
                    } catch (e) {
                      console.warn(`Failed to store incoming image ${key}:`, e);
                      // Still keep the data URL for immediate display
                      validImages.push(item);
                    }
                  } else if (typeof item === "string" && item.length > 0) {
                    // URL or ref
                    validImages.push(item);
                  }
                } catch (e) {
                  console.warn("Failed processing imageGroup item:", e, item);
                }
              })
            );

            if (validImages.length > 0) {
              incomingCopy.imageGroup = validImages;
              if (imageRefs.length) incomingCopy.imageRefs = imageRefs;
            }
          }

          // Process single imagePreview
          if (incomingCopy.imagePreview) {
            const previewData =
              typeof incomingCopy.imagePreview === "string"
                ? incomingCopy.imagePreview
                : incomingCopy.imagePreview?.dataUrl ||
                  incomingCopy.imagePreview?.src ||
                  null;

            if (previewData && isDataUrl(previewData)) {
              const key = `img-${incomingCopy.id}-preview`;
              try {
                await idbPut(key, previewData);
                incomingCopy.imageRef = key;
                incomingCopy.imagePreview = previewData;
                console.debug(`Stored incoming preview to IndexedDB: ${key}`);
              } catch (e) {
                console.warn(`Failed to store incoming preview ${key}:`, e);
                incomingCopy.imagePreview = previewData;
              }
            } else if (previewData) {
              incomingCopy.imagePreview = previewData;
            }
          }

          // replace the payload with the processed copy so downstream logic sees the refs
          payloadOrText = incomingCopy;
        } catch (preErr) {
          console.warn("Image preprocessing failed:", preErr, payloadOrText);
        }
      }

      // --- Handle different message types (existing logic) ---

      const handleAutoAcknowledgment = async (payloadOrText) => {
        try {
          const origin = payloadOrText.from || payloadOrText.origin;
          const localId = getLocalPeerId() || myId;

          if (!origin || origin === localId) return;

          // Always send delivery acknowledgment immediately
          if (payloadOrText.type === "thread") {
            sendAckDeliver(
              origin,
              payloadOrText.id,
              true,
              payloadOrText.threadRootId
            );
            addUniqueToMsgArray(
              payloadOrText.id,
              "deliveries",
              localId,
              true,
              payloadOrText.threadRootId
            );
          } else {
            sendAckDeliver(origin, payloadOrText.id);
            addUniqueToMsgArray(payloadOrText.id, "deliveries", localId);
          }

          // Send read acknowledgment based on visibility and focus
          const shouldAutoRead =
            document.visibilityState === "visible" &&
            (document.hasFocus() || !document.hidden);

          if (shouldAutoRead) {
            // Small delay to ensure delivery ack is processed first
            // Small delay to ensure delivery ack is processed first
            // Small delay to ensure delivery ack is processed first
            setTimeout(() => {
              try {
                const toPeer =
                  payloadOrText.fromId ||
                  payloadOrText.from ||
                  payloadOrText.origin ||
                  null;
                const localId = getLocalPeerId() || myId;

                console.debug(
                  "auto-ack: will send read -> to:",
                  toPeer,
                  "msg:",
                  payloadOrText.id,
                  "isThread:",
                  payloadOrText.type === "thread",
                  "threadRootId:",
                  payloadOrText.threadRootId
                );

                if (!toPeer) return;

                if (payloadOrText.type === "thread") {
                  sendAckRead(
                    payloadOrText.id,
                    toPeer,
                    true,
                    payloadOrText.threadRootId
                  );
                  addUniqueToMsgArray(
                    payloadOrText.id,
                    "reads",
                    localId,
                    true,
                    payloadOrText.threadRootId
                  );
                } else {
                  // sendAckRead(toPeerId, messageId)
                  addUniqueToMsgArray(payloadOrText.id, "reads", localId);
                }
              } catch (e) {
                console.warn("auto-ack timeout block error", e);
              }
            }, 100);
          }
        } catch (e) {
          console.warn("Auto-acknowledgment failed:", e);
        }
      };

      // 1) Typing indicators
      if (from === "__system_typing__" && payloadOrText) {
        try {
          const fromName =
            payloadOrText.fromName || payloadOrText.from || payloadOrText.name;
          const isTyping = Boolean(
            payloadOrText.isTyping ??
              payloadOrText.typing ??
              payloadOrText.is_typing ??
              false
          );
          const threadRootId =
            payloadOrText.threadRootId ||
            payloadOrText.rootId ||
            payloadOrText.threadId ||
            null;

          if (!fromName) return;

          if (!threadRootId) {
            setTypingUsers((t) => {
              const copy = { ...t };
              if (isTyping) copy[fromName] = Date.now();
              else delete copy[fromName];
              return copy;
            });
          } else {
            setThreadTypingUsers((t) => {
              const copy = { ...t };
              const bucket = { ...(copy[threadRootId] || {}) };
              if (isTyping) bucket[fromName] = Date.now();
              else delete bucket[fromName];
              if (Object.keys(bucket).length) copy[threadRootId] = bucket;
              else delete copy[threadRootId];
              return copy;
            });
          }
          return;
        } catch (e) {
          console.warn("Typing handler failed:", e);
          return;
        }
      }

      // 2) Delivery acknowledgments
      if (
        from === "__system_ack_deliver__" &&
        payloadOrText &&
        payloadOrText.id
      ) {
        try {
          // debug so you can inspect incoming ack payload shape
          console.debug("Incoming delivery ack payload:", payloadOrText);

          const id = payloadOrText.id;
          // try all possible sender fields; fallback to 'from' envelope if present
          const fromPeer =
            payloadOrText.fromPeer ||
            payloadOrText.from ||
            payloadOrText.peer ||
            null;

          // normalize thread flags (support both naming variants)
          const isThread =
            !!payloadOrText.isThread || !!payloadOrText.thread || false;
          const threadRootId =
            payloadOrText.threadRootId ||
            payloadOrText.rootId ||
            payloadOrText.threadId ||
            null;

          if (!id) {
            console.warn("Ack deliver missing id:", payloadOrText);
            return;
          }

          // If ack carries a 'to' field we can optionally use it to target updates,
          // but addUniqueToMsgArray expects the peerId who acked, so prefer fromPeer.
          if (!fromPeer) {
            console.warn(
              "Ack deliver missing fromPeer; payload:",
              payloadOrText
            );
            // still attempt to add with null peer to avoid silent failure
            addUniqueToMsgArray(
              id,
              "deliveries",
              null,
              !!isThread,
              threadRootId
            );
            return;
          }

          addUniqueToMsgArray(
            id,
            "deliveries",
            fromPeer,
            !!isThread,
            threadRootId
          );
        } catch (e) {
          console.warn("Delivery ack handler failed:", e);
        }
        return;
      }

      // 3) Read acknowledgments
      if (from === "__system_ack_read__" && payloadOrText && payloadOrText.id) {
        try {
          // debug so you can inspect incoming ack shape
          console.debug("Incoming read ack payload:", payloadOrText);

          const id = payloadOrText.id;
          const fromPeer =
            payloadOrText.fromPeer ||
            payloadOrText.from ||
            payloadOrText.peer ||
            null;
          const isThread =
            !!payloadOrText.isThread || !!payloadOrText.thread || false;
          const threadRootId =
            payloadOrText.threadRootId ||
            payloadOrText.rootId ||
            payloadOrText.threadId ||
            null;

          if (!id) {
            console.warn("Ack read missing id:", payloadOrText);
            return;
          }

          if (!fromPeer) {
            console.warn("Ack read missing fromPeer; payload:", payloadOrText);
            addUniqueToMsgArray(id, "reads", null, !!isThread, threadRootId);
            return;
          }

          addUniqueToMsgArray(id, "reads", fromPeer, !!isThread, threadRootId);
        } catch (e) {
          console.warn("Read ack handler failed:", e);
        }
        return;
      }

      // 4) System messages
      if (
        payloadOrText &&
        typeof payloadOrText === "object" &&
        payloadOrText.type &&
        payloadOrText.id &&
        payloadOrText.type.toString().startsWith("system")
      ) {
        try {
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
        } catch (e) {
          console.warn("System message handler failed:", e);
        }
        return;
      }

      // 5) File offers
      if (from === "__system_file_offer__" && payloadOrText) {
        try {
          const offer = payloadOrText;
          const offerId =
            offer.id ||
            `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

          setIncomingFileOffers((s) => ({
            ...s,
            [offerId]: {
              offer,
              expiresAt: Date.now() + 20000,
              origin: offer.from,
            },
          }));

          setTimeout(() => {
            setIncomingFileOffers((s) => {
              const copy = { ...s };
              if (copy[offerId]) {
                try {
                  respondToFileOffer(offerId, offer.from, false);
                } catch (e) {}
                delete copy[offerId];
              }
              return copy;
            });
          }, 20000);

          maybeNotify(
            peerNamesMap[offer.from] || offer.from,
            `File offer: ${offer.name}`
          );
        } catch (e) {
          console.warn("File offer handler failed:", e);
        }
        return;
      }

      // 6) file offer response
      if (from === "__system_file_offer_response__" && payloadOrText) {
        try {
          const { id: offerId, from: responder, accept } = payloadOrText;
          if (!outgoingPendingOffers.current[offerId]) return;
          if (accept) {
            outgoingPendingOffers.current[offerId].acceptingPeers.add(
              responder
            );
            const file = outgoingPendingOffers.current[offerId].file;
            if (file) {
              setTransfer(offerId, (prev) => ({
                direction: "sending",
                label: file.name,
                total: file.size || prev?.total || 0,
                transferred: prev?.transferred || 0,
                peers: Array.from(new Set([...(prev?.peers || []), responder])),
              }));
              try {
                startSendingFile(file, offerId, [responder]);
              } catch (e) {
                console.warn("startSendingFile failed", e);
              }
            }
          }
        } catch (e) {
          console.warn(
            "handleIncoming: file offer response failed",
            e,
            payloadOrText
          );
        }
        return;
      }

      // 7) file chunk
      if (from === "__system_file_chunk__" && payloadOrText) {
        try {
          await handleIncomingFileChunk(payloadOrText);
        } catch (e) {
          console.warn(
            "handleIncoming: file chunk handler error",
            e,
            payloadOrText
          );
        }
        return;
      }

      // 8) file transfer done
      if (from === "__system_file_transfer_done__" && payloadOrText) {
        try {
          const { id: offerId } = payloadOrText;
          try {
            setTransfer(offerId, (prev) => ({
              ...prev,
              transferred: prev?.total ?? prev?.transferred ?? 0,
            }));
            setTimeout(() => removeTransfer(offerId), 1200);
          } catch (e) {}
          setMessages((m) => {
            const sys = {
              id: `sys-file-complete-${offerId}`,
              from: "System",
              text: "File transfer completed",
              ts: Date.now(),
              type: "system",
            };
            const next = [...m, sys];
            persistMessages(next);
            return next;
          });
        } catch (e) {
          console.warn(
            "handleIncoming: file transfer done failed",
            e,
            payloadOrText
          );
        }
        return;
      }

      // 9) Chat/Thread messages - ENHANCED
      if (
        payloadOrText &&
        typeof payloadOrText === "object" &&
        (payloadOrText.type === "chat" || payloadOrText.type === "thread") &&
        payloadOrText.id
      ) {
        try {
          // Normalize sender fields so we always have payloadOrText.fromId and payloadOrText.from
          const canonicalFromId =
            payloadOrText.fromId ||
            payloadOrText.from ||
            payloadOrText.origin ||
            payloadOrText.peer ||
            payloadOrText.sender ||
            null;
          const canonicalFromName =
            payloadOrText.fromName || payloadOrText.name || null;

          if (!payloadOrText.fromId && canonicalFromId)
            payloadOrText.fromId = canonicalFromId;
          if (!payloadOrText.from && (canonicalFromName || canonicalFromId)) {
            payloadOrText.from = canonicalFromName || canonicalFromId;
          }

          console.debug("Chat/thread incoming normalized:", {
            id: payloadOrText.id,
            raw: {
              from: payloadOrText.from,
              fromId: payloadOrText.fromId,
              fromName: payloadOrText.fromName,
            },
            envelopeFrom: from,
          });

          // store message and UI update
          upsertIncomingChat(payloadOrText);
          maybeNotify(
            payloadOrText.fromName || payloadOrText.from,
            payloadOrText.text
          );

          // acknowledgments: always send delivery first, then read (if visible)
          try {
            await handleAutoAcknowledgment(payloadOrText);
          } catch (e) {
            console.warn(
              "handleAutoAcknowledgment failed for chat/thread:",
              e,
              payloadOrText
            );
          }

          // done handling this chat/thread object
          return;
        } catch (err) {
          console.warn(
            "Chat/thread message handler failed:",
            err,
            payloadOrText
          );
          return;
        }
      }

      // 10) String fallback
      if (typeof payloadOrText === "string") {
        try {
          const newMsg = {
            id: nanoid(),
            from: from || "peer",
            fromId: null,
            text: payloadOrText,
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

          maybeNotify(from, payloadOrText);
        } catch (e) {
          console.warn("String message handler failed:", e);
        }
        return;
      }
    } catch (outerErr) {
      console.warn("handleIncoming: Unexpected error:", outerErr, {
        from,
        payloadOrText,
      });
    }
  };

  // normalize various incoming list shapes into [{id, name, isHost}, ...]
  const handlePeerListUpdate = (list) => {
    try {
      if (!list) {
        setPeers([]);
        return;
      }

      // If list is an object keyed by id, convert to array
      let arr = Array.isArray(list)
        ? list
        : Object.keys(list).map((k) => list[k]);

      // Normalize: if items are strings treat as id-only; if objects, read fields
      const norm = arr
        .map((it) => {
          if (!it) return null;
          if (typeof it === "string") {
            // const id = it;
            // return { id, name: getPeerNames()[id] || id, isHost: false };
          }
          // if it already is { id, name, isHost } but name might be missing:
          const id = it.id || it.peer || it.from || JSON.stringify(it);
          const name = it.name || it.fromName || getPeerNames()[id] || id;
          const isHost = Boolean(it.isHost || it.host || it.role === "host");
          return { id, name, isHost };
        })
        .filter(Boolean);

      setPeers(norm);
      // keep peerNamesMap in sync
      try {
        setPeerNamesMap(getPeerNames() || {});
      } catch (e) {}
    } catch (e) {
      console.warn("handlePeerListUpdate normalization failed:", e, list);
      setPeers([]);
    }
  };

  const handleBootstrapChange = (newBootstrapId) => {
    setJoinedBootstrap(newBootstrapId || "");
  };

  // init peer — always init even if username is not yet set
  useEffect(() => {
    // don't block peer creation on username — pass username or null
    const p = initPeer(
      handleIncoming,
      handlePeerListUpdate,
      username || "", // allow empty display name
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
  }, []); // run once on mount

  // autoscroll
  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    } catch (e) {}
  }, [messages]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const localId = getLocalPeerId() || myId;

      // chat messages
      messages.forEach((m) => {
        if (!m || m.type !== "chat") return;
        const origin = m.fromId || m.from;
        if (!origin || origin === localId) return;

        const alreadyRead = Array.isArray(m.reads) && m.reads.includes(localId);
        if (!alreadyRead) {
          setTimeout(() => {
            try {
              console.debug(
                "visibility -> send read (chat) to:",
                origin,
                "msg:",
                m.id
              );
              // messageId, peerId
              sendAckRead(m.id, origin);
              addUniqueToMsgArray(m.id, "reads", localId);
            } catch (e) {
              console.warn("sendAckRead error (on visibility):", e);
            }
          }, Math.random() * 500 + 100);
        }
      });

      // thread messages — IMPORTANT: rootId is declared here
      Object.keys(threadMessages || {}).forEach((rootId) => {
        (threadMessages[rootId] || []).forEach((m) => {
          if (!m || m.type !== "thread") return;
          const origin = m.fromId || m.from;
          if (!origin || origin === localId) return;

          const alreadyRead =
            Array.isArray(m.reads) && m.reads.includes(localId);
          if (!alreadyRead) {
            setTimeout(() => {
              try {
                console.debug(
                  "visibility -> send read (thread) to:",
                  origin,
                  "msg:",
                  m.id,
                  "rootId:",
                  rootId
                );
                // messageId, peerId, isThread, threadRootId
                sendAckRead(m.id, origin, true, rootId);
                addUniqueToMsgArray(m.id, "reads", localId, true, rootId);
              } catch (e) {
                console.warn("sendAckRead (thread) failed:", e);
              }
            }, Math.random() * 500 + 200);
          }
        });
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    // run immediately if visible now
    if (document.visibilityState === "visible") onVisibility();

    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [messages, threadMessages, myId]);

  // outside click for menu
  useEffect(() => {
    const onDocClick = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    else document.removeEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  // typing broadcast (includes thread context if replying in a thread)
  useEffect(() => {
    if (!username) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    // If there's an active thread open, include the threadRootId as the third param.
    try {
      if (typeof sendTyping === "function")
        sendTyping(username, true, activeThread?.id || null);
    } catch (e) {
      // best-effort, ignore
    }

    typingTimeoutRef.current = setTimeout(() => {
      try {
        if (typeof sendTyping === "function")
          sendTyping(username, false, activeThread?.id || null);
      } catch (e) {}
    }, 1200);
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, activeThread]);

  // Long press handlers
  const handleMouseDown = (e, message) => {
    e.preventDefault();
    longPressTimeoutRef.current = setTimeout(() => {
      setLongPressMessage(message);
    }, 500);
  };

  const handleMouseUp = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  const handleTouchStart = (e, message) => {
    longPressTimeoutRef.current = setTimeout(() => {
      setLongPressMessage(message);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  // Cleanup long press timeout
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
      }
    };
  }, []);

  // Show thread for a message and mark its replies read
  const showThread = (message) => {
    setActiveThread(message);
    if (message && message.id) markThreadAsRead(message.id);
  };

  // Close thread view
  const closeThread = () => {
    setActiveThread(null);
    setLongPressMessage(null);
  };
  const handleSendThreadReply = async (threadMessage) => {
    try {
      const id =
        threadMessage.id ||
        `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const fromId =
        threadMessage.from || threadMessage.fromId || getLocalPeerId() || myId;

      const msgObjBase = {
        id,
        from:
          threadMessage.fromName || threadMessage.from || username || "peer",
        fromId,
        fromName: threadMessage.fromName || username,
        text: threadMessage.text || "",
        ts: threadMessage.ts || Date.now(),
        type: "thread",
        threadRootId: threadMessage.threadRootId || null,
        deliveries: threadMessage.deliveries || [],
        reads: threadMessage.reads || [getLocalPeerId() || myId],
        replyTo: threadMessage.replyTo || null,
        imageMeta: threadMessage.imageMeta || undefined,
      };

      // If threadMessage contains inline images (data URLs), persist them to idb
      const imageRefs = [];
      if (
        Array.isArray(threadMessage.imageGroup) &&
        threadMessage.imageGroup.length
      ) {
        await Promise.all(
          threadMessage.imageGroup.map(async (it, i) => {
            try {
              const key = `img-thread-${msgObjBase.threadRootId || "root"}-${
                msgObjBase.id
              }-${i}`;
              await idbPut(key, it);
              imageRefs.push(key);
            } catch (e) {
              console.warn("idbPut (thread image) failed", e);
            }
          })
        );
      } else if (
        threadMessage.imagePreview &&
        typeof threadMessage.imagePreview === "string"
      ) {
        try {
          const key = `img-thread-${msgObjBase.threadRootId || "root"}-${
            msgObjBase.id
          }-0`;
          await idbPut(key, threadMessage.imagePreview);
          imageRefs.push(key);
        } catch (e) {
          console.warn("idbPut (thread preview) failed", e);
        }
      }

      const msgObj = {
        ...msgObjBase,
        // store imageRefs (if any) rather than heavy inline data
        imageRefs: imageRefs.length ? imageRefs : undefined,
        // keep inline imageGroup for immediate display (sender) and for sending to peers
        imageGroup:
          Array.isArray(threadMessage.imageGroup) &&
          threadMessage.imageGroup.length
            ? threadMessage.imageGroup
            : undefined,
        imagePreview:
          threadMessage.imagePreview &&
          typeof threadMessage.imagePreview === "string"
            ? threadMessage.imagePreview
            : undefined,
      };

      // 1) locally add to threadMessages and persist
      setThreadMessages((threads) => {
        const rootId = msgObj.threadRootId;
        const existing = Array.isArray(threads[rootId]) ? threads[rootId] : [];
        const updated = {
          ...threads,
          [rootId]: [...existing, msgObj],
        };
        // persistThreadMessages will trim very large inline data but keep imageGroup where possible
        persistThreadMessages(updated);
        return updated;
      });

      // 2) broadcast to peers using the same object INCLUDING inline imageGroup
      try {
        sendChat(msgObj);
      } catch (e) {
        console.warn("sendChat (thread) failed", e);
      }
    } catch (e) {
      console.warn("handleSendThreadReply failed", e);
    }
  };

  // Get thread replies count for a message
  const getThreadCount = (messageId) => {
    const threads = threadMessages[messageId] || [];
    return threads.length;
  };

  // Long press confirmation dialog
  const LongPressDialog = ({ message, onClose, onOpenThread }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-white/10  rounded-lg backdrop-blur  p-6 m-4 max-w-sm w-full">
        <h3 className="text-lg font-semibold mb-4 text-blue-600">
          Reply Options
        </h3>
        <div className="space-y-3">
          <button
            onClick={() => {
              handleTapMessage(message);
              onClose();
            }}
            className="w-full p-3 text-left rounded-lg bg-gradient-to-br from-white to-white hover:bg-gray-200 text-blue-500"
          >
            <div className="font-bold">Reply in Chat</div>
            <div className="text-sm text-gray-600">
              Quick reply in main conversation
            </div>
          </button>
          <button
            onClick={() => {
              onOpenThread();
              onClose();
            }}
            className="w-full p-3 text-left rounded-lg bg-gradient-to-br from-white to-white hover:bg-blue-200 text-blue-500"
          >
            <div className="font-bold">Reply in Nest</div>
            <div className="text-sm text-gray-600">
              Start or continue a focused discussion
            </div>
          </button>
        </div>
        <button
          onClick={onClose}
          className="w-full mt-4 p-2 bg-gradient-to-br from-red-500 to-red-500 text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // create hub (updated)
  const handleCreateHub = async () => {
    const id = getLocalPeerId() || myId;
    if (!id) return alert("Peer not ready yet. Wait a moment and try again.");

    // join the hub (existing behavior)
    joinHub(id);
    setJoinedBootstrap(id);

    // persist for auto-join
    localStorage.setItem("ph_hub_bootstrap", id);
    localStorage.setItem("ph_should_autojoin", "true");

    // set local host metadata
    setLocalId(id);
    setLocalIsHost(true);

    // set peers list with yourself as host entry
    const hostEntry = { id, name: username || "Host", isHost: true };
    setPeers([hostEntry]);

    // optional: announce to UI messages
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

    // broadcast public host info (your existing code)
    try {
      const publicText = `[${username || "Host"}] is the host`;
      broadcastSystem("system_public", publicText, `sys-host-${id}`);
    } catch (e) {
      console.warn("broadcastSystem failed", e);
    }

    // If you have a mechanism to respond to peer list requests, you can broadcast current peers
    // (useful if peers connect right after host creation).
    try {
      // broadcastSystemToAll is a placeholder - use whatever system broadcast you have
      // so that new joiners may request or receive the peer list.
      broadcastSystem(
        "system_peers_list",
        JSON.stringify([hostEntry]),
        `sys-peers-${id}`
      );
    } catch (e) {
      // ignore if not supported
    }

    setMenuOpen(false);
  };

  // Host removes a peer from hub
  const handleRemovePeer = async (peerId) => {
    if (!localIsHost) return;
    const peerMeta = peers.find((p) => p.id === peerId);
    const nameOrId = (peerMeta && (peerMeta.name || peerMeta.id)) || peerId;
    if (!window.confirm(`Remove ${nameOrId} from the hub?`)) return;

    try {
      // send a system broadcast containing the removal action and the target id
      // other peers will ignore unless target matches their peer id
      const payload = {
        action: "force-leave",
        target: peerId,
        reason: "Removed by host",
      };
      try {
        broadcastSystem(
          "system_force",
          JSON.stringify(payload),
          `sys-force-${peerId}`
        );
      } catch (e) {
        // fallback: broadcast plain text with JSON string if signature differs
        try {
          broadcastSystem(
            "system_force",
            JSON.stringify(payload),
            `sys-force-${peerId}`
          );
        } catch (er) {
          console.warn("broadcastSystem (force-leave) failed:", er);
        }
      }

      // remove them locally from the host's view
      setPeers((prev) => prev.filter((p) => p.id !== peerId));

      const sys = {
        id: `sys-remove-${Date.now()}`,
        from: "System",
        text: `${nameOrId} was removed from the hub.`,
        ts: Date.now(),
        type: "system",
      };
      setMessages((m) => {
        const next = [...m, sys];
        persistMessages(next);
        return next;
      });

      // broadcast an updated peers list to everyone (optional)
      try {
        broadcastSystem(
          "system_peers_list",
          JSON.stringify(peers.filter((p) => p.id !== peerId)),
          `sys-peers-${localId}`
        );
      } catch (e) {}
    } catch (e) {
      console.warn("handleRemovePeer failed:", e);
    }
  };

  // join hub
  const handleJoinHub = async () => {
    const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
    if (!id) {
      setMenuOpen(false);
      return;
    }
    const trimmed = id.trim();
    joinHub(trimmed);
    setJoinedBootstrap(trimmed);

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

  // leave hub
  const handleLeaveClick = () => {
    setMenuOpen(false);
    setConfirmLeaveOpen(true);
  };
  const handleConfirmLeave = async () => {
    try {
      // delete stored images from IndexedDB (best-effort)
      try {
        await deleteImgDB();
      } catch (e) {
        console.warn("deleteImgDB failed:", e);
      }

      // leave hub networking
      try {
        leaveHub();
      } catch (e) {}

      setJoinedBootstrap("");

      localStorage.removeItem("ph_hub_bootstrap");
      localStorage.removeItem("ph_should_autojoin");

      try {
        localStorage.removeItem(LS_MSGS);
      } catch (e) {}
      try {
        localStorage.removeItem(LS_THREADS);
      } catch (e) {}
      seenSystemIdsRef.current.clear();
      setMessages([]);
      setThreadMessages({});
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
    } catch (e) {
      console.warn("handleConfirmLeave failed:", e);
      setConfirmLeaveOpen(false);
    }
  };

  // clear all stored images (IndexedDB + message refs)
  const handleClearAllImages = async () => {
    try {
      const ok = window.confirm(
        "Clear all stored images? This will remove locally cached images but keep chat text. Proceed?"
      );
      if (!ok) return;

      // delete the IndexedDB (best-effort)
      try {
        await deleteImgDB();
      } catch (e) {
        console.warn("deleteImgDB failed:", e);
      }

      // remove image fields from messages in state + persist lightweight messages
      setMessages((prev) => {
        const cleaned = prev.map((m) => {
          const copy = { ...m };
          delete copy.imageGroup;
          delete copy.imagePreview;
          delete copy.imageRefs;
          delete copy.imageRef;
          delete copy.imageMeta;
          return copy;
        });
        try {
          persistMessages(cleaned);
        } catch (e) {
          console.warn("persistMessages after clear images failed", e);
        }
        return cleaned;
      });

      // Also clear thread messages if you stored images there
      setThreadMessages((threads) => {
        const cleaned = {};
        for (const rootId of Object.keys(threads || {})) {
          cleaned[rootId] = (threads[rootId] || []).map((m) => {
            const copy = { ...m };
            delete copy.imageGroup;
            delete copy.imagePreview;
            delete copy.imageRefs;
            delete copy.imageRef;
            delete copy.imageMeta;
            return copy;
          });
        }
        try {
          persistThreadMessages(cleaned);
        } catch (e) {
          console.warn("persistThreadMessages after clear images failed", e);
        }
        return cleaned;
      });

      // small feedback to user
      const sys = {
        id: `sys-clear-images-${Date.now()}`,
        from: "System",
        text: "Cleared all locally cached images.",
        ts: Date.now(),
        type: "system",
      };
      setMessages((m) => {
        const next = [...m, sys];
        persistMessages(next);
        return next;
      });
    } catch (e) {
      console.warn("handleClearAllImages failed", e);
    }
  };

  const handleCancelLeave = () => setConfirmLeaveOpen(false);

  // send chat
  const send = async () => {
    // 1) Inline image path
    if (pendingPhotos.length > 0) {
      // read previews as data URLs
      const previews = await Promise.all(
        pendingPhotos.map(
          (p) =>
            new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) =>
                resolve({ dataUrl: e.target.result, name: p.file.name });
              reader.readAsDataURL(p.file);
            })
        )
      );

      const msgId = `img-group-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const localId = getLocalPeerId() || myId;

      // Save images to IndexedDB and produce imageRefs for persistence
      const imageRefs = [];
      await Promise.all(
        previews.map(async (p, i) => {
          const key = `img-${msgId}-${i}`;
          try {
            await idbPut(key, p.dataUrl);
            imageRefs.push(key);
          } catch (e) {
            console.warn("idbPut failed", e);
          }
        })
      );

      // Local message object (lightweight - uses refs so localStorage isn't huge)
      const localMsgObj = {
        id: msgId,
        from: username || "You",
        fromId: localId,
        fromName: username || undefined,
        ts: Date.now(),
        type: "chat",
        imageRefs,
        imageMeta: previews.map((p) => ({ name: p.name })),
        text: caption || text || "",
        deliveries: [],
        reads: [localId],
        replyTo: replyTo ? { ...replyTo } : undefined,
        // keep imageGroup for immediate UI rendering (it will be removed by persistMessages before saving to localStorage)
        imageGroup: previews.map((p) => p.dataUrl),
      };

      // Show + persist locally (persistMessages will strip imageGroup before writing to LS)
      setMessages((m) => {
        const next = [...m, localMsgObj];
        persistMessages(next);
        return next;
      });

      // Message to send to peers — include inline data URLs so they can render immediately.
      const outgoingMsg = {
        ...localMsgObj,
        // to avoid sending the same large blob twice, keep same shape but it's fine to include imageGroup
        // peers will store image data on their side
      };

      console.debug("Sending image message", {
        id: outgoingMsg.id,
        imageCount: outgoingMsg.imageGroup?.length || 0,
      });

      try {
        sendChat(outgoingMsg);
      } catch (e) {
        console.warn("sendChat (inline images) failed", e);
      }

      // clear composer
      setPendingPhotos([]);
      setCaption("");
      setReplyTo(null);
      setText("");
      return;
    }

    // 2) Plain text message
    const trimmed = (text || "").trim();
    if (!trimmed) return;

    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const localId = getLocalPeerId() || myId;

    const msgObj = {
      id,
      from: username || "You",
      fromId: localId,
      fromName: username || undefined,
      text: trimmed,
      ts: Date.now(),
      type: "chat",
      deliveries: [],
      reads: [localId],
      replyTo: replyTo ? { ...replyTo } : undefined,
    };

    // persist + show locally
    setMessages((m) => {
      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });

    // broadcast to peers
    try {
      sendChat(msgObj);
    } catch (e) {
      console.warn("sendChat failed", e);
    }

    setText("");
    setReplyTo(null);

    // optionally refocus
    try {
      const input = document.querySelector(
        'input[placeholder="Type a message..."]'
      );
      if (input) input.focus();
    } catch (e) {}
  };

  // reply + send ack_read
  const handleTapMessage = (m) => {
    if (m.type && m.type.startsWith("system")) return;
    setReplyTo({ id: m.id, from: m.from, text: m.text });
    const input = document.querySelector(
      'input[placeholder="Type a message..."]'
    );
    if (input) input.focus();

    const originPeerId = m.fromId || m.from || null;
    if (m.id && originPeerId) {
      try {
        const localId = getLocalPeerId() || myId;
        console.debug(
          "tapMessage -> send read to:",
          originPeerId,
          "msg:",
          m.id,
          "isThread:",
          m.type === "thread",
          "root:",
          m.threadRootId
        );
        if (m.type === "thread" && m.threadRootId) {
          sendAckRead(m.id, originPeerId, true, m.threadRootId);
          addUniqueToMsgArray(m.id, "reads", localId, true, m.threadRootId);
        } else {
          sendAckRead(m.id, originPeerId);
          addUniqueToMsgArray(m.id, "reads", localId);
        }
      } catch (e) {
        console.warn("sendAckRead error", e);
      }
    }
  };

  // Fixed render status dot function
  const renderStatusDot = (m) => {
    const localId = getLocalPeerId() || myId;
    const isMyMessage = (m.fromId || m.from) === localId;

    // Only show status for messages I sent
    if (!isMyMessage) return null;

    // Count peers who should receive this message (exclude sender)
    const relevantPeers = peers.filter((id) => id !== localId);
    const totalPeers = relevantPeers.length;

    if (totalPeers === 0) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
          title="No recipients (offline)"
        />
      );
    }

    // Count deliveries and reads from relevant peers only
    const deliveries = (m.deliveries || []).filter((id) =>
      relevantPeers.includes(id)
    ).length;

    const reads = (m.reads || []).filter((id) =>
      relevantPeers.includes(id)
    ).length;

    // Status logic
    if (deliveries < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-green-500 ml-2"
          title={`Sending — delivered to ${deliveries}/${totalPeers}`}
        />
      );
    }

    if (deliveries === totalPeers && reads < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
          title={`Delivered to all (${totalPeers}), read by ${reads}/${totalPeers}`}
        />
      );
    }

    if (reads === totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-purple-500 ml-2"
          title="Read by everyone"
        />
      );
    }

    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
        title={`Status unclear: ${deliveries}/${totalPeers} delivered, ${reads}/${totalPeers} read`}
      />
    );
  };

  // message renderer
  const renderMessage = (m, idx) => {
    const from = m.from ?? "peer";
    const txt =
      m.text == null
        ? ""
        : typeof m.text === "string"
        ? m.text
        : JSON.stringify(m.text);

    const time = new Date(m.ts || Date.now()).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isSystem = m.type && m.type.toString().startsWith("system");
    const isMe =
      (m.fromId || m.from) === (getLocalPeerId() || myId) || from === username;
    const threadCount = getThreadCount(m.id);

    // normalize imageGroup
    let imageGroup = null;
    if (Array.isArray(m.imageGroup) && m.imageGroup.length) {
      imageGroup = [...m.imageGroup];
    } else if (typeof m.imageGroup === "string") {
      try {
        const parsed = JSON.parse(m.imageGroup);
        if (Array.isArray(parsed) && parsed.length) imageGroup = parsed;
      } catch (err) {}
    }

    if (Array.isArray(imageGroup)) {
      imageGroup = imageGroup
        .map((it) =>
          typeof it === "string" ? it : it?.dataUrl || it?.src || ""
        )
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s && s !== "photo")
        .filter((v, i, a) => a.indexOf(v) === i);
    }

    const imagePreviewRaw =
      typeof m.imagePreview === "string"
        ? m.imagePreview
        : m.imagePreview?.dataUrl || m.imagePreview?.src || null;

    const normalizedImagePreview = imagePreviewRaw || null;

    const isImagePreview = !!normalizedImagePreview;
    const isImageGroup = Array.isArray(imageGroup) && imageGroup.length > 0;
    const isImageMessage = isImagePreview || isImageGroup;

    if (isSystem) {
      return (
        <div key={`${m.id ?? m.ts}-${idx}`} className="w-full text-center my-2">
          <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm max-w-[80%] whitespace-normal break-words">
            {m.text}
          </div>
        </div>
      );
    }

    const bubbleWidthClass = isImageMessage ? "max-w-[80%]" : "max-w-[50%]";
    const bubbleFitClass = isImageMessage ? "w-fit" : "w-full";
    const bubbleBgClass = isMe
      ? "ml-auto bg-blue-500 text-white"
      : "bg-white/100 text-black";

    return (
      <div
        onClick={() => !longPressTimeoutRef.current && handleTapMessage(m)}
        onMouseDown={(e) => handleMouseDown(e, m)}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={(e) => handleTouchStart(e, m)}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        key={`${m.id ?? m.ts}-${idx}`}
        className={`p-2 rounded-2xl mb-2 cursor-pointer select-none relative ${bubbleWidthClass} ${bubbleFitClass} ${bubbleBgClass}`}
        style={{ wordBreak: "break-word", overflow: "hidden" }}
      >
        {/* header */}
        <div className="text-xs font-bold flex items-center">
          <div className="flex-1">{isMe ? "You" : from}</div>
          <div className="text-[10px] text-gray-700/70 ml-2">{time}</div>
          {isMe && renderStatusDot(m)}
        </div>

        {/* reply-to context */}
        {m.replyTo && (
          <div className="mt-2 mb-2 p-2 rounded border border-white/5 text-xs text-gray-600 bg-gray-300">
            <strong className="text-xs text-blue-400">
              Reply to {m.replyTo.from}:
            </strong>{" "}
            <span
              className="inline-block ml-1 truncate"
              style={{ maxWidth: "100%" }}
            >
              {m.replyTo.text}
            </span>
          </div>
        )}

        {/* IMAGE GROUP */}
        {isImageGroup && imageGroup && imageGroup.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {imageGroup.slice(0, 4).map((src, i) => (
              <div
                key={i}
                className="relative rounded-lg overflow-hidden bg-black/5"
                onClick={(e) => {
                  e.stopPropagation();
                  if (typeof openViewer === "function") openViewer(m, i);
                }}
                style={{ paddingBottom: "100%", minWidth: "120px" }}
              >
                <img
                  src={src}
                  alt={`photo-${i}`}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
            ))}

            {imageGroup.length > 4 && (
              <div className="col-span-2 text-xs text-gray-500  font-bold mt-1">
                +{imageGroup.length - 4} more
              </div>
            )}

            {m.text && (
              <div className="col-span-2 mt-2 text-sm whitespace-pre-wrap">
                {m.text}
              </div>
            )}
          </div>
        )}

        {/* SINGLE IMAGE */}
        {isImagePreview && normalizedImagePreview && !isImageGroup && (
          <div className="mt-2 flex flex-col items-center justify-center">
            <div
              className="rounded-lg overflow-hidden bg-black/5"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof openViewer === "function") openViewer(m, 0);
              }}
              style={{ width: 320, maxWidth: "80vw", aspectRatio: "1 / 1" }}
            >
              <img
                src={normalizedImagePreview}
                alt={m.imageMeta?.name || "photo"}
                className="w-full h-full object-cover"
              />
            </div>

            {m.text && (
              <div className="mt-2 text-sm whitespace-pre-wrap">{m.text}</div>
            )}
          </div>
        )}

        {/* normal text */}
        {!isImageMessage && txt && (
          <div className="break-words whitespace-pre-wrap mt-1">{txt}</div>
        )}

        {/* thread indicator */}
        {threadCount > 0 && (
          <div
            className="mt-2 flex items-center justify-between text-xs bg-blue-50 text-blue-600 rounded px-2 py-1 cursor-pointer hover:bg-blue-100"
            onClick={(e) => {
              e.stopPropagation();
              showThread(m);
            }}
          >
            <div className="flex items-center space-x-1">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>
                {threadCount} {threadCount === 1 ? "reply" : "replies"}
              </span>
            </div>
            <span className="text-blue-400">View thread →</span>
          </div>
        )}
      </div>
    );
  };

  // Unified file selection handler — supports multi-file and two modes
  const onFileSelected = async (fileOrFiles, mode = "offer") => {
    if (!fileOrFiles) return;

    const files = Array.isArray(fileOrFiles)
      ? fileOrFiles
      : fileOrFiles instanceof FileList
      ? Array.from(fileOrFiles)
      : [fileOrFiles];

    if (mode === "inline") {
      const imageFiles = files.filter(
        (f) => f && f.type && f.type.startsWith("image/")
      );
      if (!imageFiles.length) return;

      const previews = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) =>
                resolve({ dataUrl: e.target.result, name: file.name });
              reader.readAsDataURL(file);
            })
        )
      );

      const offerId = `img-group-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

      const imageRefs = [];
      await Promise.all(
        previews.map(async (p, i) => {
          const key = `img-${offerId}-${i}`;
          try {
            await idbPut(key, p.dataUrl);
            imageRefs.push(key);
          } catch (err) {
            console.warn("idbPut (onFileSelected inline) failed", key, err);
          }
        })
      );

      const msgObj = {
        id: offerId,
        from: username || "You",
        fromId: getLocalPeerId() || myId,
        ts: Date.now(),
        type: "chat",
        imageRefs,
        imageMeta: previews.map((p) => ({ name: p.name })),
        text: caption || text || "",
        deliveries: [],
        reads: [getLocalPeerId() || myId],
        imageGroup: previews.map((p) => p.dataUrl),
      };

      setMessages((m) => {
        const next = [...m, msgObj];
        persistMessages(next);
        return next;
      });

      const sendMsgObj = { ...msgObj };
      try {
        sendChat(sendMsgObj);
      } catch (e) {
        console.warn("sendChat (inline images from onFileSelected) failed", e);
      }

      setPendingPhotos([]);
      setCaption("");
      setText("");
      setAttachMenuOpen(false);
      return;
    }

    // mode === 'offer' (unchanged)
    files.forEach((file) => {
      const offerId = `offer-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

      outgoingPendingOffers.current[offerId] = {
        file,
        acceptingPeers: new Set(),
      };

      setTransfer(offerId, {
        direction: "sending",
        label: file.name,
        total: file.size || 0,
        transferred: 0,
        peers: [],
      });

      const meta = {
        id: offerId,
        name: file.name,
        size: file.size,
        mime: file.type,
        from: getLocalPeerId() || myId,
      };
      try {
        offerFileToPeers(meta);
      } catch (e) {
        console.warn("offerFileToPeers failed", e);
      }

      setMessages((m) => {
        const sys = {
          id: `sys-offer-${offerId}`,
          from: "System",
          text: `Offered file: ${file.name} (${Math.round(
            (file.size || 0) / 1024
          )} KB)`,
          ts: Date.now(),
          type: "system",
        };
        const next = [...m, sys];
        persistMessages(next);
        return next;
      });

      setTimeout(() => {
        try {
          const pending = outgoingPendingOffers.current[offerId];
          if (!pending) return;
          if (pending.acceptingPeers.size === 0) {
            setMessages((m) => {
              const sys = {
                id: `sys-offer-expire-${offerId}`,
                from: "System",
                text: `No one accepted the file offer: ${file.name}`,
                ts: Date.now(),
                type: "system",
              };
              const next = [...m, sys];
              persistMessages(next);
              return next;
            });
            setTimeout(() => removeTransfer(offerId), 800);
          }
        } catch (e) {
          console.warn("post-offer cleanup failed", e);
        }
      }, 20000);
    });

    setAttachMenuOpen(false);
  };

  const handleFileInputClick = () => {
    setAttachMenuOpen((s) => !s);
  };

  // accept incoming offer
  const acceptFileOffer = async (offerId) => {
    const entry = incomingFileOffers[offerId];
    if (!entry) return;
    const { offer } = entry;
    try {
      if (supportsNativeFileSystem()) {
        const opts = {
          suggestedName: offer.name,
          types: [
            {
              description: offer.mime || "file",
              accept: {
                [offer.mime || "application/octet-stream"]: [
                  "." + (offer.name.split(".").pop() || ""),
                ],
              },
            },
          ],
        };
        const handle = await (window.showSaveFilePicker
          ? window.showSaveFilePicker(opts)
          : window.chooseFileSystemEntries
          ? window.chooseFileSystemEntries({
              type: "save-file",
              accepts: opts.types,
            })
          : null);
        if (!handle) {
          respondToFileOffer(offerId, offer.from, false);
          setIncomingFileOffers((s) => {
            const copy = { ...s };
            delete copy[offerId];
            return copy;
          });
          return;
        }
        const writable = await handle.createWritable();
        saveHandlesRef.current[offerId] = writable;
        fileWriteStatusRef.current[offerId] = 0;

        setTransfer(offerId, {
          direction: "receiving",
          label: offer.name,
          total: offer.size || 0,
          transferred: 0,
          peers: [offer.from],
        });

        respondToFileOffer(offerId, offer.from, true);
        setIncomingFileOffers((s) => {
          const copy = { ...s };
          delete copy[offerId];
          return copy;
        });
        setMessages((m) => {
          const sys = {
            id: `sys-accept-${offerId}`,
            from: "System",
            text: `Accepted file: ${offer.name}`,
            ts: Date.now(),
            type: "system",
          };
          const next = [...m, sys];
          persistMessages(next);
          return next;
        });
      } else {
        respondToFileOffer(offerId, offer.from, true);
        setIncomingFileOffers((s) => {
          const copy = { ...s };
          delete copy[offerId];
          return copy;
        });
        setMessages((m) => {
          const sys = {
            id: `sys-accept-${offerId}`,
            from: "System",
            text: `Accepted file: ${offer.name} — browser may not support direct disk writes.`,
            ts: Date.now(),
            type: "system",
          };
          const next = [...m, sys];
          persistMessages(next);
          return next;
        });
        setTransfer(offerId, {
          direction: "receiving",
          label: offer.name,
          total: offer.size || 0,
          transferred: 0,
          peers: [offer.from],
        });
      }
    } catch (e) {
      console.warn("acceptFileOffer failed", e);
      try {
        respondToFileOffer(offerId, offer.from, false);
      } catch (er) {}
      setIncomingFileOffers((s) => {
        const copy = { ...s };
        delete copy[offerId];
        return copy;
      });
    }
  };

  const ignoreFileOffer = (offerId) => {
    const entry = incomingFileOffers[offerId];
    if (!entry) return;
    try {
      respondToFileOffer(offerId, entry.offer.from, false);
    } catch (e) {
      console.warn("ignoreFileOffer failed", e);
    }
    setIncomingFileOffers((s) => {
      const copy = { ...s };
      delete copy[offerId];
      return copy;
    });
  };

  // wire up progress/completion callbacks
  useEffect(() => {
    const progressCb = (offerId, peerId, bytes, totalBytes) => {
      setTransfer(offerId, (prev) => ({
        direction: prev?.direction || "sending",
        label: prev?.label || `Transfer ${offerId}`,
        total: totalBytes || prev?.total || 0,
        transferred: bytes || prev?.transferred || 0,
        peers: Array.from(new Set([...(prev?.peers || []), peerId])),
      }));
    };
    const completeCb = (offerId, peerId) => {
      setTransfer(offerId, (prev) => ({
        ...prev,
        transferred: prev?.total ?? prev?.transferred ?? 0,
        peers: Array.from(new Set([...(prev?.peers || []), peerId])),
      }));
      setTimeout(() => removeTransfer(offerId), 1200);
    };

    try {
      setOnFileProgress(progressCb);
      setOnFileComplete(completeCb);
    } catch (e) {}

    return () => {
      try {
        setOnFileProgress(null);
        setOnFileComplete(null);
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedNames = (peers || []).length
    ? peers.map((p) => {
        if (!p) return "unknown";
        if (typeof p === "string") return peerNamesMap[p] || p;
        // p is object
        return p.name || peerNamesMap[p.id] || p.id || "unknown";
      })
    : [];

  const typingSummary = () => {
    const names = Object.keys(typingUsers);
    if (!names.length) return null;
    const shown = names.slice(0, 2).join(", ");
    return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
  };

  // Replace your existing renderIncomingFileOffers with this
  const renderIncomingFileOffers = () => {
    const keys = Object.keys(incomingFileOffers);
    if (!keys.length) return null;

    // Only show offers that are NOT thread-scoped in the main chat UI.
    const chatOfferKeys = keys.filter((k) => {
      const entry = incomingFileOffers[k];
      const offer = entry?.offer || {};
      return !(
        offer.threadRootId ||
        offer.threadId ||
        offer.rootId ||
        offer.isThread ||
        offer.type === "thread"
      );
    });

    if (!chatOfferKeys.length) return null;

    return chatOfferKeys.map((k) => {
      const entry = incomingFileOffers[k];
      const offer = entry.offer;
      const remaining = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
      return (
        <div
          key={k}
          className="mb-2 p-2 rounded bg-white/10 text-sm text-black"
        >
          <div className="font-semibold">
            <span className="inline-block max-w-[260px] whitespace-normal break-words">
              File offer:&nbsp;
              <strong className="break-words">{offer.name}</strong>
            </span>
            <span className="ml-2 text-xs text-gray-500">
              ({Math.round((offer.size || 0) / 1024)} KB)
            </span>
          </div>

          <div className="text-xs text-gray-600">
            From: {peerNamesMap[offer.from] || offer.from} — Expires in{" "}
            {remaining}s
          </div>
          <div className="mt-2 flex justify-center gap-2">
            <button
              onClick={() => acceptFileOffer(k)}
              className="px-3 py-1 rounded bg-gradient-to-br from-green-500 to-green-600 text-white"
            >
              Accept
            </button>
            <button
              onClick={() => ignoreFileOffer(k)}
              className="px-3 py-1 rounded bg-gradient-to-br from-red-500 to-red-600 text-white"
            >
              Ignore
            </button>
          </div>
        </div>
      );
    });
  };

  // Photo viewer state (in-app viewer that also shows thread)
  const [photoViewer, setPhotoViewer] = useState({
    open: false,
    message: null,
    index: 0,
  });

  const [viewer, setViewer] = useState({
    open: false,
    images: [],
    index: 0,
  });

  const openViewer = (message, idx = 0) => {
    const imgs =
      Array.isArray(message?.imageGroup) && message.imageGroup.length
        ? message.imageGroup
        : message?.imagePreview
        ? [message.imagePreview]
        : [];

    if (!imgs.length) return;
    setViewer({ open: true, images: imgs, index: idx || 0 });
  };

  const closeViewer = () => setViewer({ open: false, images: [], index: 0 });

  // keyboard navigation for viewer
  useEffect(() => {
    if (!viewer.open) return;
    const onKey = (e) => {
      if (e.key === "Escape") return closeViewer();
      if (e.key === "ArrowRight" && viewer.index < viewer.images.length - 1) {
        setViewer((v) => ({ ...v, index: v.index + 1 }));
      }
      if (e.key === "ArrowLeft" && viewer.index > 0) {
        setViewer((v) => ({ ...v, index: v.index - 1 }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer.open, viewer.index, viewer.images.length]);

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

  return (
    <>
      {/* Thread View (overlay) */}
      {activeThread && (
        <div className="fixed inset-0 z-60">
          <ReplyInThread
            rootMessage={activeThread}
            onClose={closeThread}
            username={username}
            myId={myId}
            peers={peers}
            threadMessages={threadMessages[activeThread.id] || []}
            onSendThreadReply={handleSendThreadReply}
            peerNamesMap={peerNamesMap}
            threadTypingUsers={threadTypingUsers}
          />
        </div>
      )}

      {/* Long Press Dialog */}
      {longPressMessage && !activeThread && (
        <LongPressDialog
          message={longPressMessage}
          onClose={() => setLongPressMessage(null)}
          onOpenThread={() => showThread(longPressMessage)}
        />
      )}

      {/* Built-in photo viewer modal */}
      {viewer.open && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/90">
          <button
            onClick={closeViewer}
            className="absolute top-4 right-4 text-red-500 text-2xl p-2 rounded-full bg-black/40"
          >
            ✕
          </button>

          {viewer.index > 0 && (
            <button
              onClick={() => setViewer((v) => ({ ...v, index: v.index - 1 }))}
              className="absolute left-4 text-blue-500 text-4xl"
            >
              ‹
            </button>
          )}

          <img
            src={viewer.images[viewer.index]}
            alt={`view-${viewer.index}`}
            className="max-w-full max-h-full object-contain"
          />

          {viewer.index < viewer.images.length - 1 && (
            <button
              onClick={() => setViewer((v) => ({ ...v, index: v.index + 1 }))}
              className="absolute right-4 text-blue-500 text-4xl"
            >
              ›
            </button>
          )}
        </div>
      )}

      {/* Floating progress panel */}
      {Object.keys(transfers).length > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 top-4 z-50">
          <div className="bg-black/80 text-white rounded-lg p-3 shadow-lg w-[min(720px,calc(100%-40px))]">
            {Object.entries(transfers).map(([id, t]) => {
              const pct = t.total
                ? Math.min(100, Math.round((t.transferred / t.total) * 100))
                : 0;
              const label = t.label || id;
              const directionText =
                t.direction === "sending" ? "Sending" : "Receiving";
              const humanTransferred = `${Math.round(
                (t.transferred || 0) / 1024
              )} KB`;
              const humanTotal = `${Math.round((t.total || 0) / 1024)} KB`;
              return (
                <div key={id} className="mb-3 last:mb-0">
                  <div className="flex justify-between items-center text-sm mb-1">
                    <div className="font-semibold max-w-[70%] break-words whitespace-normal">
                      {directionText}: {label}
                    </div>
                    <div className="text-xs">{pct}%</div>
                  </div>
                  <div className="w-full bg-white/10 rounded h-2 overflow-hidden mb-1">
                    <div
                      style={{ width: `${pct}%` }}
                      className="h-2 bg-blue-500 transition-all"
                    />
                  </div>
                  <div className="text-xs text-white/60">
                    {humanTransferred} / {humanTotal}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Chat Container (background layer, lower z-index) */}
      <div className="fixed inset-0 z-10 bg-gray-50 text-purple-600 p-6 flex flex-col">
        <header className="flex items-center justify-between mb-4">
          <div className="flex gap-2.5">
            <div className="text-sm text-blue-600">YourID</div>
            <div className="font-mono">{myId || "..."}</div>
            <div className="text-sm text-blue-600">Name: {username}</div>
            <div className="text-xs text-purple-500 mt-1">
              Auto-join: {joinedBootstrap || "none"}
            </div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((s) => !s)}
              className="p-2 rounded-full bg-gradient-to-br from-gray-50 to-gray-50 text-white"
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
                onClick={async () => {
                  setMenuOpen(false);
                  await handleClearAllImages();
                }}
                className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-yellow-500"
              >
                <span className="font-semibold">Clear all images</span>
                <div className="text-xs text-gray-400">
                  Remove cached images (local)
                </div>
              </button>

              {/* <button
                onClick={handleSetName}
                className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-purple-500"
              >
                <span className="font-semibold">Set Name</span>
                <div className="text-xs text-gray-400">
                  Update your display name
                </div>
              </button> */}

              <button
                onClick={handleToggleNotifications}
                className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-blue-500"
              >
                <span className="font-semibold">Notifications</span>
                <div className="text-xs text-gray-400">
                  {notificationsEnabled ? "Enabled" : "Try enabling again"}
                </div>
              </button>

              <button
                onClick={() => setIsHubInfoOpen(true)}
                className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-purple-500"
              >
                <span className="font-semibold">Hub Info</span>
                <div className="text-xs text-gray-400">
                  View connected peers, host, and IDs
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

        {isHubInfoOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <HubInfo
              peers={peers}
              localId={localId}
              localIsHost={localIsHost}
              onRemove={handleRemovePeer}
              onClose={() => setIsHubInfoOpen(false)}
            />
          </div>
        )}

        <div className="w-full text-white h-0.5 bg-white" />
        <br />

        <main className="flex-1 overflow-auto mb-4 min-h-0">
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

          {renderIncomingFileOffers()}

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

          {/* Pending photo previews + caption */}
          {pendingPhotos.length > 0 && (
            <div className="mb-2 p-3 bg-white/10 rounded-lg">
              <div className="flex flex-wrap gap-2 mb-2">
                {pendingPhotos.map((p, i) => (
                  <div key={i} className="relative">
                    <img
                      src={p.preview}
                      alt={p.name}
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                    <button
                      className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                      onClick={() =>
                        setPendingPhotos((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption..."
                className="w-full p-2 rounded bg-white/20 text-sm text-white"
              />
            </div>
          )}

          {/* Input row */}
          <div className="relative w-full flex items-center">
            {/* Clip icon */}
            <svg
              onClick={handleFileInputClick}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700"
              title="Attach File"
            >
              <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 015 5l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.49" />
            </svg>

            {/* Attach menu */}
            {attachMenuOpen && (
              <div
                ref={attachMenuRef}
                className="absolute left-0 -top-24 bg-white/10  rounded-lg backdrop-blur shadow-lg p-6 z-50 min-w-[80px]"
              >
                <button
                  className="w-fit text-left px-3 py-2 bg-gradient-to-br from-purple-500 to-blue-600 text-white rounded m-1"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    if (fileInputImageRef.current)
                      fileInputImageRef.current.click();
                  }}
                >
                  Send image in chat
                </button>
                <button
                  className="w-fit text-left px-3 py-2 bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded mt-1"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    if (fileInputOfferRef.current)
                      fileInputOfferRef.current.click();
                  }}
                >
                  Send file as offer
                </button>
              </div>
            )}

            {/* Hidden inputs */}
            <input
              ref={fileInputImageRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) onFileSelected(files, "inline");
                e.target.value = null;
              }}
            />
            <input
              ref={fileInputOfferRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) onFileSelected(files, "offer");
                e.target.value = null;
              }}
            />

            {/* Text input */}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 p-3 pl-10 pr-10 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
              onKeyDown={(e) => e.key === "Enter" && send()}
            />

            {/* Send button */}
            <svg
              onClick={send}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 text-blue-500 cursor-pointer hover:text-blue-700"
              title="Send"
            >
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </div>
        </footer>
      </div>

      {/* Leave confirmation modal */}
      {confirmLeaveOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleCancelLeave}
          />
          <div className="relative bg-white/10 p-6 rounded-lg backdrop-blur text-white w-80">
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
// Round Video Streaming
// src/components/Chat.jsx// Chat.jsx

// import "./App.css";
// import React, { useEffect, useState, useRef } from "react";
// import CircularStream from "./CircularStream"; // adjust path if your CircularStream is in same folder use "./CircularStream"
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
//   offerFileToPeers,
//   respondToFileOffer,
//   startSendingFile,
//   supportsNativeFileSystem,
//   setOnFileProgress,
//   setOnFileComplete,
// } from "./webrtc";
// import { requestNotificationPermission, showNotification } from "./notify";
// import { nanoid } from "nanoid";

// const LS_MSGS = "ph_msgs_v1";
// const MAX_MSGS = 100;

// export default function Chat() {
//   // core state
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

//   // DEBUG: expose to console
//   if (typeof window !== "undefined") {
//     window.__msgs = messages;
//   }

//   // MirroredVideoCanvas — minimal, with audio enabled and autoplay fallback
//   function MirroredVideoCanvas({
//   src,
//   autoPlay = true,
//   mirror = true,       // keep the canvas mirrored horizontally when true
//   cover = true,        // use center-crop cover mode (prevents stretching inside fixed containers)
//   className = "",
//   onClose,
// }) {
//   const canvasRef = React.useRef(null);
//   const hiddenVideoRef = React.useRef(null);
//   const rafRef = React.useRef(null);
//   const [needPlayButton, setNeedPlayButton] = React.useState(false);
//   const [playing, setPlaying] = React.useState(Boolean(autoPlay));
//   const mutedRef = React.useRef(true); // start muted to allow autoplay, restored later

//   // Helper: attach src (MediaStream or URL)
//   React.useEffect(() => {
//     const vid = hiddenVideoRef.current;
//     if (!vid) return;
//     try {
//       if (src && typeof src === "object" && typeof src.getTracks === "function") {
//         // MediaStream
//         if (vid.srcObject !== src) {
//           vid.srcObject = src;
//         }
//       } else {
//         // URL or empty
//         if (vid.srcObject) vid.srcObject = null;
//         if (vid.src !== (src || "")) vid.src = src || "";
//       }
//     } catch (e) {
//       console.warn("MirroredVideoCanvas: failed to attach src", e);
//     }
//   }, [src]);

//   // Main setup + draw loop
//   React.useEffect(() => {
//     const vid = hiddenVideoRef.current;
//     const canvas = canvasRef.current;
//     if (!vid || !canvas) return;

//     let mounted = true;
//     let ctx = canvas.getContext("2d");

//     const safePauseAndClear = () => {
//       try {
//         vid.pause();
//       } catch (e) {}
//       try {
//         if (vid.srcObject) vid.srcObject = null;
//         else vid.removeAttribute("src");
//       } catch (e) {}
//     };

//     // draw function that supports cover center-crop and mirror
//     const drawFrame = () => {
//       if (!mounted) return;
//       try {
//         const vw = vid.videoWidth || canvas.width || 640;
//         const vh = vid.videoHeight || canvas.height || 480;
//         // ensure canvas pixel size equals video natural size for best quality
//         if (canvas.width !== vw || canvas.height !== vh) {
//           canvas.width = vw;
//           canvas.height = vh;
//         }

//         // compute draw source rectangle (cover/crop) so final display won't look stretched
//         let sx = 0,
//           sy = 0,
//           sw = vw,
//           sh = vh;

//         if (cover) {
//           // Desired aspect is canvas display aspect (CSS container might differ, but we can aim to maintain video natural aspect)
//           // Compute target aspect from canvas CSS size (clientWidth/clientHeight) if available
//           const cw = canvas.clientWidth || canvas.width;
//           const ch = canvas.clientHeight || canvas.height;
//           const tgtAspect = cw / (ch || 1) || canvas.width / canvas.height;
//           const vidAspect = vw / (vh || 1);

//           if (vidAspect > tgtAspect) {
//             // video is wider than target -> crop sides
//             const neededW = Math.round(vh * tgtAspect);
//             sx = Math.round((vw - neededW) / 2);
//             sw = neededW;
//             sy = 0;
//             sh = vh;
//           } else {
//             // video is taller -> crop top/bottom
//             const neededH = Math.round(vw / tgtAspect);
//             sy = Math.round((vh - neededH) / 2);
//             sh = neededH;
//             sx = 0;
//             sw = vw;
//           }
//         }

//         ctx.save();
//         ctx.clearRect(0, 0, canvas.width, canvas.height);
//         if (mirror) {
//           ctx.translate(canvas.width, 0);
//           ctx.scale(-1, 1);
//           ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
//         } else {
//           ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
//         }
//         ctx.restore();
//       } catch (e) {
//         // ignore transient draw errors
//       }
//       rafRef.current = requestAnimationFrame(drawFrame);
//     };

//     const setup = async () => {
//       // try muted autoplay first — browsers allow muted autoplay more reliably
//       try {
//         mutedRef.current = true;
//         vid.muted = true;
//         // ensure playsInline to avoid fullscreen on iOS
//         vid.playsInline = true;
//         await vid.play();
//         setNeedPlayButton(false);
//         setPlaying(true);
//       } catch (e) {
//         // autoplay failed (likely due to audio policy) -> show play button
//         setNeedPlayButton(true);
//         setPlaying(false);
//       } finally {
//         // Start draw loop anyway so a poster/thumbnail appears even if not playing
//         rafRef.current = requestAnimationFrame(drawFrame);
//       }
//     };

//     // Wait briefly for metadata (dimensions) so canvas can size properly
//     const waitMeta = () =>
//       new Promise((resolve) => {
//         if (vid.readyState >= 1) return resolve();
//         const onLoaded = () => {
//           cleanupListeners();
//           resolve();
//         };
//         const onError = () => {
//           cleanupListeners();
//           resolve();
//         };
//         const cleanupListeners = () => {
//           vid.removeEventListener("loadedmetadata", onLoaded);
//           vid.removeEventListener("error", onError);
//         };
//         vid.addEventListener("loadedmetadata", onLoaded);
//         vid.addEventListener("error", onError);
//         // fallback resolve after 700ms
//         setTimeout(() => {
//           cleanupListeners();
//           resolve();
//         }, 700);
//       });

//     let mountedSetup = true;
//     (async () => {
//       await waitMeta();
//       if (!mountedSetup) return;
//       setup();
//     })();

//     return () => {
//       mounted = false;
//       mountedSetup = false;
//       try {
//         if (rafRef.current) cancelAnimationFrame(rafRef.current);
//       } catch (e) {}
//       try {
//         // pause and clear video references to free decoder
//         safePauseAndClear();
//       } catch (e) {}
//     };
//   }, [src, autoPlay, mirror, cover]);

//   // play button to recover when autoplay blocked — also un-mute so audio will play
//   const handlePlayClick = async () => {
//     const vid = hiddenVideoRef.current;
//     if (!vid) return;
//     try {
//       vid.muted = false;
//       mutedRef.current = false;
//       await vid.play();
//       setNeedPlayButton(false);
//       setPlaying(true);
//     } catch (e) {
//       console.warn("MirroredVideoCanvas: user play failed", e);
//     }
//   };

//   // Request fullscreen of canvas
//   const goFullscreen = async () => {
//     const el = canvasRef.current;
//     if (!el) return;
//     try {
//       if (el.requestFullscreen) await el.requestFullscreen();
//       else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
//       else if (el.msRequestFullscreen) el.msRequestFullscreen();
//     } catch (e) {
//       console.warn("requestFullscreen failed", e);
//     }
//   };

//   return (
//     <div className={`w-full h-auto ${className} relative`}>
//       <video
//         ref={hiddenVideoRef}
//         playsInline
//         // start muted so autoplay attempts are allowed; we un-mute if user interacts
//         muted={true}
//         style={{ display: "none" }}
//         preload="metadata"
//         aria-hidden="true"
//       />
//       <div className="relative w-full bg-black">
//         <canvas
//           ref={canvasRef}
//           className="w-full h-auto block object-contain"
//           aria-label="Mirrored video preview"
//         />
//         {/* play overlay if autoplay blocked */}
//         {needPlayButton && (
//           <button
//             onClick={handlePlayClick}
//             aria-label="Play video"
//             className="absolute inset-0 m-auto w-12 h-12 flex items-center justify-center rounded-full bg-black/50 text-white"
//             style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
//           >
//             <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
//               <path d="M8 5v14l11-7z" />
//             </svg>
//           </button>
//         )}

//         {/* controls */}
//         <div className="absolute left-3 bottom-3 flex gap-2 items-center">
//           <button
//             onClick={() => {
//               const vid = hiddenVideoRef.current;
//               if (!vid) return;
//               if (playing) {
//                 vid.pause();
//                 setPlaying(false);
//               } else {
//                 vid.muted = false;
//                 vid.play().catch(() => {});
//                 setPlaying(true);
//               }
//             }}
//             className="px-3 py-1 rounded bg-black/40 text-white text-sm"
//             aria-label={playing ? "Pause" : "Play"}
//           >
//             {playing ? "Pause" : "Play"}
//           </button>

//           <button
//             onClick={goFullscreen}
//             className="px-3 py-1 rounded bg-black/40 text-white text-sm"
//             aria-label="Fullscreen"
//           >
//             Fullscreen
//           </button>

//           {onClose && (
//             <button
//               onClick={onClose}
//               className="px-3 py-1 rounded bg-black/40 text-white text-sm"
//             >
//               Close
//             </button>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// }

//   // file transfer
//   const [incomingFileOffers, setIncomingFileOffers] = useState({});
//   const [transfers, setTransfers] = useState({}); // offerId -> { direction, label, total, transferred, peers }
//   const saveHandlesRef = useRef({});
//   const fileWriteStatusRef = useRef({});
//   const outgoingPendingOffers = useRef({}); // kept for compatibility

//   // UI / other state
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

//   // typing
//   const [typingUsers, setTypingUsers] = useState({});
//   const [replyTo, setReplyTo] = useState(null);
//   const typingTimeoutRef = useRef(null);

//   // refs
//   const messagesEndRef = useRef(null);
//   const seenSystemIdsRef = useRef(new Set());
//   const peerRef = useRef(null);
//   const menuRef = useRef(null);
//   const createdUrlsRef = useRef(new Set());
//   const incomingBuffersRef = useRef({}); // offerId -> { chunks: [], bytes: number }

//   // center preview modal
//   const [centerPreviewOpen, setCenterPreviewOpen] = useState(false);
//   const [centerPreviewUrl, setCenterPreviewUrl] = useState(null);
//   const [centerPreviewIsMirrored, setCenterPreviewIsMirrored] = useState(false);

//   // inside Chat() component, before renderMessage (or at top of function)
//   function VideoThumb({ url, size = 96, className = "" }) {
//     const vRef = useRef(null);
//     const mountedRef = useRef(true);
//     const [poster, setPoster] = useState(null);
//     const [loading, setLoading] = useState(Boolean(url && !poster));

//     useEffect(() => {
//       mountedRef.current = true;
//       return () => {
//         mountedRef.current = false;
//       };
//     }, []);

//     useEffect(() => {
//       if (!url) {
//         setPoster(null);
//         setLoading(false);
//         return;
//       }
//       setLoading(true);
//       setPoster(null);

//       const videoEl = document.createElement("video");
//       videoEl.muted = true;
//       videoEl.playsInline = true;
//       videoEl.preload = "metadata";
//       videoEl.src = url;

//       const onLoadedData = async () => {
//         try {
//           // draw a small canvas snapshot (first frame) as poster
//           const w = videoEl.videoWidth || size;
//           const h = videoEl.videoHeight || size;
//           const canvas = document.createElement("canvas");
//           // keep canvas square and crop by center if needed
//           const outSize = Math.max(1, size);
//           canvas.width = outSize;
//           canvas.height = outSize;
//           const ctx = canvas.getContext("2d");

//           // compute cropping to center-crop cover
//           const scale = Math.max(outSize / w, outSize / h);
//           const sw = Math.round(outSize / scale);
//           const sh = Math.round(outSize / scale);
//           const sx = Math.max(0, Math.floor((w - sw) / 2));
//           const sy = Math.max(0, Math.floor((h - sh) / 2));

//           ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, outSize, outSize);
//           const data = canvas.toDataURL("image/jpeg", 0.7);
//           if (!mountedRef.current) return;
//           setPoster(data);
//         } catch (e) {
//           console.warn("VideoThumb: poster capture failed", e);
//         } finally {
//           if (!mountedRef.current) return;
//           setLoading(false);
//         }
//       };

//       const onError = (e) => {
//         console.warn("VideoThumb load error", e);
//         if (!mountedRef.current) return;
//         setLoading(false);
//       };

//       videoEl.addEventListener("loadeddata", onLoadedData, { once: true });
//       videoEl.addEventListener("error", onError, { once: true });
//       // start loading
//       videoEl.load();

//       return () => {
//         try {
//           videoEl.removeEventListener("loadeddata", onLoadedData);
//           videoEl.removeEventListener("error", onError);
//           // revoke only the temporary video src if needed (we don't create objectURL here)
//         } catch (e) {}
//       };
//       // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [url, size]);

//     // render: if we have poster image, use <img> (reliably circular).
//     // if still loading, show spinner; fallback: render <video> as last resort.
//     if (poster) {
//       return (
//         <img
//           src={poster}
//           alt="video thumbnail"
//           width={size}
//           height={size}
//           style={{
//             width: size,
//             height: size,
//             objectFit: "cover",
//             borderRadius: "50%",
//           }}
//           className={className}
//         />
//       );
//     }

//     if (loading) {
//       return (
//         <div
//           style={{
//             width: size,
//             height: size,
//             borderRadius: "50%",
//             display: "flex",
//             alignItems: "center",
//             justifyContent: "center",
//             background: "rgba(0,0,0,0.06)",
//           }}
//           className={className}
//           aria-hidden="true"
//         >
//           <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
//         </div>
//       );
//     }

//     // Place this above your Chat component or inside it (but before usage)

//     // final fallback: show the video element clipped to circle (may show black frame)
//     return (
//       <video
//         ref={vRef}
//         src={url}
//         muted
//         playsInline
//         preload="metadata"
//         style={{
//           width: size,
//           height: size,
//           objectFit: "cover",
//           borderRadius: "50%",
//           display: "block",
//         }}
//         className={className}
//         aria-hidden="true"
//       />
//     );
//   }

//   // notifications permission on username set
//   useEffect(() => {
//     if (!username) return;
//     requestNotificationPermission();
//   }, [username]);

//   // persist messages helper — remove transient fileUrl before saving
//   const persistMessages = (arr) => {
//     try {
//       const tail = arr.slice(-MAX_MSGS).map((m) => {
//         const copy = { ...m };
//         if (copy.fileUrl) delete copy.fileUrl;
//         return copy;
//       });
//       localStorage.setItem(LS_MSGS, JSON.stringify(tail));
//     } catch (e) {}
//   };

//   // add/update chat
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

//   // transfer helpers (same as before)
//   const setTransfer = (offerId, updaterOrObj) => {
//     setTransfers((t) => {
//       const prev = t[offerId] || {};
//       const nextEntry =
//         typeof updaterOrObj === "function"
//           ? updaterOrObj(prev)
//           : { ...prev, ...updaterOrObj };
//       return { ...t, [offerId]: nextEntry };
//     });
//   };
//   const removeTransfer = (offerId) => {
//     setTransfers((t) => {
//       const copy = { ...t };
//       delete copy[offerId];
//       return copy;
//     });
//   };

//   // IndexedDB helpers for persisting files
//   const saveBlob = (id, blob) => {
//     return new Promise((resolve, reject) => {
//       const req = indexedDB.open("peershub_files_v1", 1);
//       req.onupgradeneeded = () => {
//         try {
//           req.result.createObjectStore("files");
//         } catch (e) {}
//       };
//       req.onsuccess = () => {
//         const db = req.result;
//         const tx = db.transaction("files", "readwrite");
//         tx.objectStore("files").put(blob, id);
//         tx.oncomplete = () => resolve();
//         tx.onerror = (e) => reject(e.target?.error || e);
//       };
//       req.onerror = (e) => reject(e.target?.error || e);
//     });
//   };

//   const getBlob = (id) => {
//     return new Promise((resolve, reject) => {
//       const req = indexedDB.open("peershub_files_v1", 1);
//       req.onupgradeneeded = () => {
//         try {
//           req.result.createObjectStore("files");
//         } catch (e) {}
//       };
//       req.onsuccess = () => {
//         const db = req.result;
//         const tx = db.transaction("files", "readonly");
//         const get = tx.objectStore("files").get(id);
//         get.onsuccess = () => resolve(get.result || null);
//         get.onerror = (e) => reject(e.target?.error || e);
//       };
//       req.onerror = (e) => reject(e.target?.error || e);
//     });
//   };

//   // hydrate persisted file blobs (run once on mount) — improved: create objectURLs on demand for messages with fileId
//   useEffect(() => {
//     let mounted = true;
//     (async () => {
//       try {
//         // iterate over file messages and ensure fileUrl present in state when we have the blob
//         const fileMsgs = messages.filter((x) => x.type === "file" && x.fileId);
//         for (const fm of fileMsgs) {
//           if (!mounted) return;
//           // if a runtime fileUrl already exists in state, skip
//           if (fm.fileUrl) continue;
//           try {
//             const blob = await getBlob(fm.fileId);
//             if (!mounted) return;
//             if (blob) {
//               const url = URL.createObjectURL(blob);
//               createdUrlsRef.current.add(url);
//               setMessages((prev) => {
//                 const next = prev.map((m) =>
//                   m.id === fm.id ? { ...m, fileUrl: url } : m
//                 );
//                 // persistMessages strips fileUrl for storage so no change to persisted data
//                 persistMessages(next);
//                 return next;
//               });
//             }
//           } catch (e) {
//             // ignore missing blobs (they may not have been persisted)
//             // console.warn("hydrate blob failed for", fm.fileId, e);
//           }
//         }
//       } catch (e) {
//         console.warn("Hydration error:", e);
//       }
//     })();
//     return () => {
//       mounted = false;
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []); // run once on mount

//   // handle incoming file chunk and write to disk using saved handle
//   // handle incoming file chunk and write to disk using saved handle
//   const handleIncomingFileChunk = async (data) => {
//     // defensive: some runtimes wrap chunk under .data (PeerJS / structured clone variants)
//     let { id: offerId, seq, chunk, final } = data || {};
//     try {
//       // unwrap wrapper if necessary (common PeerJS quirk)
//       if (
//         chunk &&
//         chunk.data &&
//         (chunk.data instanceof ArrayBuffer ||
//           ArrayBuffer.isView(chunk.data) ||
//           chunk.data instanceof Blob)
//       ) {
//         chunk = chunk.data;
//       }
//       // If we have a FileSystem writable for this offer => write directly (preferred)
//       const writer = saveHandlesRef.current[offerId];
//       if (writer) {
//         // chunk may be Blob, ArrayBuffer, or TypedArray
//         if (chunk instanceof Blob) {
//           try {
//             await writer.write(chunk);
//             fileWriteStatusRef.current[offerId] =
//               (fileWriteStatusRef.current[offerId] || 0) + (chunk.size || 0);
//           } catch (e) {
//             console.warn(
//               "Error writing blob chunk to writer for offer",
//               offerId,
//               e
//             );
//           }
//         } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
//           try {
//             const buf =
//               chunk instanceof ArrayBuffer
//                 ? new Uint8Array(chunk)
//                 : new Uint8Array(chunk.buffer || chunk);
//             await writer.write(buf);
//             fileWriteStatusRef.current[offerId] =
//               (fileWriteStatusRef.current[offerId] || 0) + buf.byteLength;
//           } catch (e) {
//             console.warn(
//               "Error writing ArrayBuffer/TypedArray chunk to writer for offer",
//               offerId,
//               e
//             );
//           }
//         } else if (chunk == null && final) {
//           // some senders send a final marker with null chunk — ignore here (closing handled below)
//         } else {
//           console.warn("Unknown chunk type for offer", offerId, seq, chunk);
//         }

//         // update receiver progress entry
//         setTransfer(offerId, (prev) => {
//           const total = prev?.total || 0;
//           const transferred =
//             fileWriteStatusRef.current[offerId] || prev?.transferred || 0;
//           return {
//             ...prev,
//             total,
//             transferred,
//             direction: prev?.direction || "receiving",
//           };
//         });

//         // If this is the final chunk, close writer and create a chat-like file message (no system msg)
//         if (final) {
//           try {
//             // close the file writer (best-effort)
//             try {
//               await writer.close();
//             } catch (e) {
//               console.warn("Error closing writer for offer", offerId, e);
//             }

//             // prepare metadata for the message from any stored meta (populated when offer arrived)
//             const meta = incomingBuffersRef.current[offerId]?.meta || {};
//             const fromPeerId = meta.from || null;
//             const fromName = fromPeerId
//               ? peerNamesMap[fromPeerId] || fromPeerId
//               : meta.fromName || "peer";

//             // Build a chat-style file message. NOTE: we do NOT set fileUrl here
//             // because the file was written to disk; the hydrate code or reading
//             // back from the file handle / IDB should produce a preview later.
//             const fileMsg = {
//               id: offerId,
//               type: "file",
//               from: fromName,
//               fromId: fromPeerId,
//               fromName,
//               fileName: meta.name || meta.filename || `file-${offerId}`,
//               fileSize:
//                 meta.size ||
//                 fileWriteStatusRef.current[offerId] ||
//                 incomingBuffersRef.current[offerId]?.bytes ||
//                 0 ||
//                 0,
//               fileType: meta.mime || "application/octet-stream",
//               fileId: offerId,
//               // intentionally no fileUrl
//               ts: Date.now(),
//               deliveries: [],
//               reads: [],
//             };

//             // Remove writer handle and write status (we already closed)
//             try {
//               delete saveHandlesRef.current[offerId];
//             } catch (e) {}
//             try {
//               delete fileWriteStatusRef.current[offerId];
//             } catch (e) {}

//             // Insert the file message into chat (treat as normal message, not a system message)
//             setMessages((m) => {
//               const exists = m.find((x) => x.id === offerId);
//               if (exists) {
//                 // update existing entry (e.g. if offer message was inserted earlier)
//                 const next = m.map((x) =>
//                   x.id === offerId ? { ...x, ...fileMsg } : x
//                 );
//                 persistMessages(next);
//                 return next;
//               }
//               const next = [...m, fileMsg];
//               persistMessages(next);
//               return next;
//             });

//             // Update transfer UI and schedule cleanup
//             setTransfer(offerId, (prev) => ({
//               ...prev,
//               transferred:
//                 prev?.total ?? prev?.transferred ?? fileMsg.fileSize ?? 0,
//               direction: "receiving",
//             }));
//             setTimeout(() => removeTransfer(offerId), 1200);
//           } catch (e) {
//             console.warn(
//               "Error handling final chunk with FileSystem writer for offer",
//               offerId,
//               e
//             );
//             setMessages((m) => {
//               const sys = {
//                 id: `sys-file-error-${offerId}-${Date.now()}`,
//                 from: "System",
//                 text: `Error processing received file: ${e.message || e}`,
//                 ts: Date.now(),
//                 type: "system",
//               };
//               const next = [...m, sys];
//               persistMessages(next);
//               return next;
//             });
//           } finally {
//             // cleanup any temporary buffer/meta we stored
//             try {
//               delete incomingBuffersRef.current[offerId];
//             } catch (e) {}
//           }
//         }

//         return;
//       }

//       // ------- Fallback buffering path (no writable) -------
//       // Buffer chunks in-memory for this offerId
//       if (!incomingBuffersRef.current[offerId]) {
//         incomingBuffersRef.current[offerId] = { chunks: [], bytes: 0 };
//       }
//       const bufEntry = incomingBuffersRef.current[offerId];

//       if (chunk instanceof Blob) {
//         bufEntry.chunks.push(chunk);
//         bufEntry.bytes += chunk.size || 0;
//       } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
//         const blobPart =
//           chunk instanceof ArrayBuffer
//             ? new Blob([chunk])
//             : new Blob([chunk.buffer || chunk]);
//         bufEntry.chunks.push(blobPart);
//         bufEntry.bytes += blobPart.size || 0;
//       } else if (chunk == null && !final) {
//         // ignore unexpected nulls
//       } else {
//         // unknown chunk type — log and skip
//         console.warn(
//           "Unknown chunk type (buffer fallback) for offer",
//           offerId,
//           seq,
//           chunk
//         );
//       }

//       // update progress UI based on buffered bytes
//       setTransfer(offerId, (prev) => {
//         const total = prev?.total || 0;
//         const transferred = bufEntry.bytes || prev?.transferred || 0;
//         return {
//           ...prev,
//           total,
//           transferred,
//           direction: prev?.direction || "receiving",
//         };
//       });

//       // when final chunk arrives, assemble Blob, persist, and create message
//       if (final) {
//         try {
//           const bufEntry = incomingBuffersRef.current[offerId] || {
//             chunks: [],
//             bytes: 0,
//           };
//           // Prefer metadata from buffer.offer (populated when offer arrived) if present
//           const meta = bufEntry.meta || {};

//           // Choose mime: prefer meta.mime -> first chunk type -> guess from name -> fallback to video/webm or octet-stream
//           let mime =
//             meta.mime ||
//             bufEntry.chunks[0]?.type ||
//             (meta.name && meta.name.toLowerCase().endsWith(".webm")
//               ? "video/webm"
//               : null) ||
//             null;

//           // If it's still unknown, and chunks appear to be video-like, fall back to video/webm
//           if (!mime) {
//             mime = "video/webm";
//           }

//           // Assemble blob with chosen mime
//           const assembled = new Blob(bufEntry.chunks, { type: mime });

//           // Persist into IndexedDB (best-effort)
//           try {
//             await saveBlob(offerId, assembled);
//           } catch (e) {
//             console.warn("saveBlob (fallback) failed for", offerId, e);
//           }

//           // create preview URL and message for UI
//           try {
//             const previewUrl = URL.createObjectURL(assembled);
//             createdUrlsRef.current.add(previewUrl);

//             // update or insert message
//             setMessages((m) => {
//               // avoid duplicating message if already present
//               const exists = m.find((x) => x.id === offerId);
//               if (exists) {
//                 const next = m.map((x) =>
//                   x.id === offerId
//                     ? {
//                         ...x,
//                         fileUrl: previewUrl,
//                         fileType: mime,
//                         fileName: x.fileName || meta.name || `file-${offerId}`,
//                         fileSize:
//                           x.fileSize || assembled.size || meta.size || 0,
//                       }
//                     : x
//                 );
//                 persistMessages(next);
//                 return next;
//               }

//               const sysMsg = {
//                 id: offerId,
//                 type: "file",
//                 from: "peer",
//                 fromId: meta.from || null,
//                 fromName: meta.fromName || meta.from || "peer",
//                 fileName: meta.name || `file-${offerId}`,
//                 fileSize: assembled.size || meta.size || 0,
//                 fileType: mime || "video/webm",
//                 fileId: offerId,
//                 fileUrl: previewUrl,
//                 // New: preserve isMirrored if remote provided it in meta
//                 isMirrored: meta.isMirrored || false,
//                 ts: Date.now(),
//                 deliveries: [],
//                 reads: [],
//               };
//               const next = [...m, sysMsg];
//               persistMessages(next);
//               return next;
//             });

//             // final transfer UI update
//             setTransfer(offerId, (prev) => ({
//               ...prev,
//               transferred: bufEntry.bytes || prev?.transferred || 0,
//             }));
//             setTimeout(() => removeTransfer(offerId), 1200);
//           } catch (e) {
//             console.warn("preview creation after assembly failed", e);
//           }
//         } catch (e) {
//           console.warn(
//             "Error assembling buffered chunks for offer",
//             offerId,
//             e
//           );
//           setMessages((m) => {
//             const sys = {
//               id: `sys-file-error-${offerId}-${Date.now()}`,
//               from: "System",
//               text: `Error assembling received file: ${e.message || e}`,
//               ts: Date.now(),
//               type: "system",
//             };
//             const next = [...m, sys];
//             persistMessages(next);
//             return next;
//           });
//         } finally {
//           // cleanup buffer entry
//           try {
//             delete incomingBuffersRef.current[offerId];
//           } catch (e) {}
//         }
//       }
//     } catch (e) {
//       console.warn("handleIncomingFileChunk error (outer)", e);
//       setMessages((m) => {
//         const sys = {
//           id: `sys-file-error-${Date.now()}`,
//           from: "System",
//           text: `Error processing incoming file chunk: ${e.message || e}`,
//           ts: Date.now(),
//           type: "system",
//         };
//         const next = [...m, sys];
//         persistMessages(next);
//         return next;
//       });
//       // best-effort cleanup
//       try {
//         delete incomingBuffersRef.current[offerId];
//       } catch (er) {}
//       try {
//         delete fileWriteStatusRef.current[offerId];
//       } catch (er) {}
//       try {
//         delete saveHandlesRef.current[offerId];
//       } catch (er) {}
//     }
//   };

//   // incoming messages callback from webrtc
//   const handleIncoming = async (from, payloadOrText) => {
//     // typing
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

//     // file message delivered as a chat-like payload
//     if (
//       payloadOrText &&
//       typeof payloadOrText === "object" &&
//       payloadOrText.type === "file" &&
//       payloadOrText.id
//     ) {
//       // treat like a message (persist fileUrl if present in payload)
//       setMessages((m) => {
//         const exists = m.find((x) => x.id === payloadOrText.id);
//         if (exists) {
//           const next = m.map((x) =>
//             x.id === payloadOrText.id ? { ...x, ...payloadOrText } : x
//           );
//           persistMessages(next);
//           return next;
//         }
//         const msgObj = {
//           ...payloadOrText,
//           // ensure fields exist
//           from: payloadOrText.fromName || payloadOrText.from || "peer",
//           deliveries: payloadOrText.deliveries || [],
//           reads: payloadOrText.reads || [],
//         };
//         const next = [...m, msgObj];
//         persistMessages(next);
//         return next;
//       });

//       // notify user (same as chat)
//       maybeNotify(
//         payloadOrText.fromName || payloadOrText.from,
//         payloadOrText.fileName || "Video"
//       );

//       // auto-send ack_read if visible (same as chat)
//       try {
//         const origin = payloadOrText.from || payloadOrText.fromId || null;
//         const localId = getLocalPeerId() || myId;
//         if (
//           origin &&
//           origin !== localId &&
//           document.visibilityState === "visible"
//         ) {
//           try {
//             sendAckRead(payloadOrText.id, origin);
//           } catch (e) {}
//           addUniqueToMsgArray(payloadOrText.id, "reads", localId);
//         }
//       } catch (e) {}

//       return;
//     }

//     // file offer received -> UI prompt (we still support offers from others)
//     if (from === "__system_file_offer__" && payloadOrText) {
//       const offer = payloadOrText;
//       const offerId =
//         offer.id ||
//         `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

//       setIncomingFileOffers((s) => {
//         const copy = { ...s };
//         copy[offerId] = {
//           offer,
//           expiresAt: Date.now() + 10000,
//           origin: offer.from,
//         };

//         // 🔑 Ensure we have a buffer entry with metadata
//         incomingBuffersRef.current[offerId] = incomingBuffersRef.current[
//           offerId
//         ] || {
//           chunks: [],
//           bytes: 0,
//           meta: offer, // <-- attach original offer metadata
//         };

//         return copy;
//       });

//       // cleanup expired offer after 10s
//       setTimeout(() => {
//         setIncomingFileOffers((s) => {
//           const copy = { ...s };
//           if (copy[offerId] && copy[offerId].expiresAt <= Date.now()) {
//             try {
//               respondToFileOffer(offerId, offer.from, false);
//             } catch (e) {}
//             delete copy[offerId];
//           }
//           return copy;
//         });
//       }, 10000);

//       maybeNotify(
//         peerNamesMap[offer.from] || offer.from,
//         `File offer: ${offer.name}`
//       );
//       return;
//     }

//     // file offer response (sender receives accepts)
//     if (from === "__system_file_offer_response__" && payloadOrText) {
//       const { id: offerId, from: responder, accept } = payloadOrText;
//       try {
//         if (!outgoingPendingOffers.current[offerId]) return;
//         if (accept) {
//           outgoingPendingOffers.current[offerId].acceptingPeers.add(responder);
//           const file = outgoingPendingOffers.current[offerId].file;
//           if (file) {
//             setTransfer(offerId, (prev) => ({
//               direction: "sending",
//               label: file.name,
//               total: file.size || prev?.total || 0,
//               transferred: prev?.transferred || 0,
//               peers: Array.from(new Set([...(prev?.peers || []), responder])),
//             }));
//             try {
//               startSendingFile(file, offerId, [responder]);
//             } catch (e) {
//               console.warn("startSendingFile failed", e);
//             }
//           }
//         }
//       } catch (e) {
//         console.warn("file_offer_response handling failed", e);
//       }
//       return;
//     }

//     // file chunk
//     if (from === "__system_file_chunk__" && payloadOrText) {
//       await handleIncomingFileChunk(payloadOrText);
//       return;
//     }

//     // file transfer done/cancel
//     if (from === "__system_file_transfer_done__" && payloadOrText) {
//       const { id: offerId } = payloadOrText;
//       try {
//         setTransfer(offerId, (prev) => ({
//           ...prev,
//           transferred: prev?.total ?? prev?.transferred ?? 0,
//         }));
//         setTimeout(() => removeTransfer(offerId), 1200);
//       } catch (e) {}
//       // optionally update or mark file message transferred, but don't create a system message
//       setMessages((m) => {
//         const next = m.map((msg) =>
//           msg.id === offerId && msg.type === "file"
//             ? { ...msg, transferredAt: Date.now() }
//             : msg
//         );
//         persistMessages(next);
//         return next;
//       });

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

//       try {
//         const origin = payloadOrText.from || payloadOrText.origin || null;
//         const localId = getLocalPeerId() || myId;
//         if (
//           origin &&
//           origin !== localId &&
//           document.visibilityState === "visible"
//         ) {
//           try {
//             sendAckRead(payloadOrText.id, origin);
//           } catch (e) {}
//           addUniqueToMsgArray(payloadOrText.id, "reads", localId);
//         }
//       } catch (e) {}
//       return;
//     }

//     // string fallback
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

//   // peer list update
//   const handlePeerListUpdate = (list) => {
//     setPeers(list || []);
//     try {
//       const names = getPeerNames();
//       setPeerNamesMap(names || {});
//     } catch (e) {}
//   };

//   const handleBootstrapChange = (newBootstrapId) => {
//     setJoinedBootstrap(newBootstrapId || "");
//   };

//   // init peer
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

//   // autoscroll
//   useEffect(() => {
//     if (!messagesEndRef.current) return;
//     try {
//       messagesEndRef.current.scrollIntoView({
//         behavior: "smooth",
//         block: "end",
//       });
//     } catch (e) {}
//   }, [messages]);

//   // hydrate persisted file blobs (run once on mount)
//   useEffect(() => {
//     let mounted = true;
//     (async () => {
//       try {
//         const fileMsgs = messages.filter(
//           (x) => x.type === "file" && x.fileId && !x.fileUrl
//         );
//         for (const fm of fileMsgs) {
//           try {
//             const blob = await getBlob(fm.fileId);
//             if (!mounted) return;
//             if (blob) {
//               const url = URL.createObjectURL(blob);
//               createdUrlsRef.current.add(url);
//               setMessages((prev) => {
//                 const next = prev.map((m) =>
//                   m.id === fm.id ? { ...m, fileUrl: url } : m
//                 );
//                 return next;
//               });
//             }
//           } catch (e) {
//             // ignore missing blobs
//           }
//         }
//       } catch (e) {}
//     })();
//     return () => {
//       mounted = false;
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // cleanup object URLs on unmount
//   useEffect(() => {
//     return () => {
//       try {
//         // copy to array to avoid surprises if something mutates the Set during iteration
//         const urls = Array.from(createdUrlsRef.current || []);
//         for (const u of urls) {
//           try {
//             URL.revokeObjectURL(u);
//           } catch (e) {
//             // ignore
//           }
//         }
//         // clear the set
//         createdUrlsRef.current && createdUrlsRef.current.clear();
//       } catch (e) {
//         // ignore
//       }
//     };
//   }, []);

//   // visibility ack_read
//   useEffect(() => {
//     const onVisibility = () => {
//       if (document.visibilityState === "visible") {
//         const localId = getLocalPeerId() || myId;
//         messages.forEach((m) => {
//           if (!m || m.type !== "chat") return;
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
//     if (document.visibilityState === "visible") onVisibility();
//     return () => document.removeEventListener("visibilitychange", onVisibility);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [messages, myId]);

//   // outside click for menu
//   useEffect(() => {
//     const onDocClick = (e) => {
//       if (!menuRef.current) return;
//       if (!menuRef.current.contains(e.target)) setMenuOpen(false);
//     };
//     if (menuOpen) document.addEventListener("mousedown", onDocClick);
//     else document.removeEventListener("mousedown", onDocClick);
//     return () => document.removeEventListener("mousedown", onDocClick);
//   }, [menuOpen]);

//   // typing broadcast
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

//   // create hub
//   const handleCreateHub = () => {
//     const id = getLocalPeerId() || myId;
//     if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
//     joinHub(id);
//     setJoinedBootstrap(id);

//     localStorage.setItem("ph_hub_bootstrap", id);
//     localStorage.setItem("ph_should_autojoin", "true");

//     const sysPlain = {
//       id: `sys-create-${Date.now()}`,
//       from: "System",
//       text: `You created the hub. Share this ID: ${id}`,
//       ts: Date.now(),
//       type: "system",
//     };
//     setMessages((m) => {
//       const next = [...m, sysPlain];
//       persistMessages(next);
//       return next;
//     });

//     try {
//       const publicText = `[${username || "Host"}] is the host`;
//       broadcastSystem("system_public", publicText, `sys-host-${id}`);
//     } catch (e) {
//       console.warn("broadcastSystem failed", e);
//     }

//     setMenuOpen(false);
//   };

//   // join hub
//   const handleJoinHub = async () => {
//     const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
//     if (!id) {
//       setMenuOpen(false);
//       return;
//     }
//     const trimmed = id.trim();
//     joinHub(trimmed);
//     setJoinedBootstrap(trimmed);

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

//   // leave hub
//   const handleLeaveClick = () => {
//     setMenuOpen(false);
//     setConfirmLeaveOpen(true);
//   };

//   const handleConfirmLeave = () => {
//     try {
//       leaveHub();
//     } catch (e) {}
//     setJoinedBootstrap("");

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
//       deliveries: [],
//       reads: [getLocalPeerId() || myId],
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

//   // reply + send ack_read
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
//         addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId);
//       } catch (e) {
//         console.warn("sendAckRead error", e);
//       }
//     }
//   };

//   // render status dot
//   const renderStatusDot = (m) => {
//     const totalPeers = peers?.length || 0;
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

//     if (deliveries < totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
//           title={`Single tick — delivered to ${deliveries}/${totalPeers}`}
//         />
//       );
//     }

//     if (deliveries === totalPeers && reads < totalPeers) {
//       return (
//         <span
//           className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
//           title={`Double tick — delivered to all (${totalPeers}), reads ${reads}/${totalPeers}`}
//         />
//       );
//     }

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

//   // message renderer with click opening center preview for files
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
//           <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm max-w-[80%] whitespace-normal break-words">
//             {m.text}
//           </div>
//         </div>
//       );
//     }
//     if (m.type === "file") {
//       const fileType = m.fileType || "application/octet-stream";
//       const isVideo = fileType.startsWith("video/");
//       const url = m.fileUrl || null;
//       const time = new Date(m.ts).toLocaleTimeString([], {
//         hour: "2-digit",
//         minute: "2-digit",
//       });

//       // Use explicit isMirrored flag if present; fallback to false
//       const isMirrored = Boolean(m.isMirrored);

//       return (
//         <div
//           onClick={() => openCenterPreview(m)}
//           key={`${m.id ?? m.ts}-${idx}`}
//           className={`group p-2 rounded-2xl max-w-[50%] mb-5 cursor-pointer ${
//             isMe ? "ml-auto text-blue-500" : " text-black"
//           }`}
//           role="button"
//           tabIndex={0}
//           onKeyDown={(e) => {
//             if (e.key === "Enter" || e.key === " ") {
//               e.preventDefault();
//               openCenterPreview(m);
//             }
//           }}
//           aria-label={isVideo ? "Open video message" : "Open file"}
//         >
//           <div className="text-xs font-bold flex items-center">
//             <div className="flex-1">{isMe ? "You" : m.from}</div>
//             <div className="text-[10px] text-gray-700/70 ml-2">{time}</div>
//             {isMe && renderStatusDot(m)}
//           </div>

//           {m.replyTo && (
//             <div className="mt-2 mb-2 p-2 rounded border border-white/5 text-xs text-gray-600 bg-gray-300">
//               <strong className="text-xs text-blue-400">
//                 Reply to {m.replyTo.from}:
//               </strong>{" "}
//               {m.replyTo.text}
//             </div>
//           )}

//           <div className="mt-2 flex items-center justify-center">
//             {isVideo && url ? (
//               <div
//                 className="relative rounded-full overflow-hidden w-24 h-24 sm:w-32 sm:h-32 flex-shrink-0 bg-black/10 flex items-center justify-center"
//                 style={{
//                   borderRadius: "50%",
//                   width: 150,
//                   height: 150,
//                   minWidth: 150,
//                   minHeight: 150,
//                 }}
//               >
//                 <video
//                   src={url}
//                   muted
//                   autoPlay
//                   loop
//                   playsInline
//                   controls={false}
//                   preload="metadata"
//                   style={{
//                     width: "100%",
//                     height: "100%",
//                     objectFit: "cover",
//                     borderRadius: "50%",
//                     display: "block",
//                   }}
//                   className={`block pointer-events-none ${
//                     isMirrored ? "transform scale-x-[-1]" : ""
//                   }`}
//                   onLoadedMetadata={(e) => {
//                     try {
//                       if (e.target && e.target.currentTime === 0) {
//                         e.target.currentTime = 0.001;
//                       }
//                     } catch (err) {}
//                   }}
//                 />

//                 {/* subtle play overlay */}
//                 <div
//                   className="absolute inset-0 flex items-center justify-center pointer-events-none"
//                   aria-hidden="true"
//                 >
//                   <div className="rounded-full w-10 h-10 sm:w-12 sm:h-12 bg-black/30 transition-opacity duration-200 opacity-60 group-hover:opacity-80" />
//                   <svg
//                     className="absolute w-5 h-5 sm:w-6 sm:h-6 text-white drop-shadow-md transition-transform duration-200 transform scale-95 group-hover:scale-100"
//                     viewBox="0 0 24 24"
//                     fill="none"
//                     stroke="currentColor"
//                     strokeWidth="1.2"
//                     strokeLinecap="round"
//                     strokeLinejoin="round"
//                     aria-hidden="true"
//                   >
//                     <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
//                   </svg>
//                 </div>
//               </div>
//             ) : (
//               <div className="text-xs text-gray-500">Unsupported file</div>
//             )}
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
//               Reply to {m.replyTo.from}
//             </strong>{" "}
//             {m.replyTo.text}
//           </div>
//         )}
//         <div className="break-words">{txt}</div>
//       </div>
//     );
//   };

//   // ---------- NEW: onFileSelected that supports directSend=true to stream immediately ----------
//   // - If directSend=true: stream to ALL connected peers immediately using startSendingFile()
//   // - If directSend=false: fallback to original offer flow (offerFileToPeers)
//   const onFileSelected = async (file, opts = { directSend: false }) => {
//     if (!file) return;
//     const offerId = `offer-${Date.now()}-${Math.random()
//       .toString(36)
//       .slice(2, 7)}`;

//     // store in outgoing pending map for backward compatibility / debug
//     outgoingPendingOffers.current[offerId] = {
//       file,
//       acceptingPeers: new Set(),
//     };

//     // init sender UI entry
//     setTransfer(offerId, {
//       direction: "sending",
//       label: file.name,
//       total: file.size || 0,
//       transferred: 0,
//       peers: [],
//     });

//     // persist to IDB (so video stays after refresh)
//     try {
//       await saveBlob(offerId, file);
//     } catch (e) {
//       console.warn("saveBlob failed", e);
//     }

//     // create local preview URL and add file message immediately
//     // inside onFileSelected, after you create previewUrl and msg
//     try {
//       const previewUrl = URL.createObjectURL(file);
//       createdUrlsRef.current.add(previewUrl);

//       // Determine mirrored flag explicitly from filename (set by recorder) — this is reliable now
//       const isMirrored = Boolean(
//         file.name && file.name.toLowerCase().endsWith(".mirrored.webm")
//       );

//       const msg = {
//         id: offerId,
//         type: "file", // keep as file so UI renders it as video bubble
//         from: getLocalPeerId() || myId,
//         fromName: username,
//         fileName: file.name,
//         fileSize: file.size,
//         fileType: file.type || "application/octet-stream",
//         fileId: offerId,
//         fileUrl: previewUrl,
//         isMirrored, // NEW: explicit mirror flag
//         ts: Date.now(),
//         deliveries: [],
//         reads: [getLocalPeerId() || myId],
//       };

//       // add to local UI
//       setMessages((m) => {
//         const next = [...m, msg];
//         persistMessages(next);
//         return next;
//       });

//       // send the message to peers as a chat-like message so they get notifications/read receipts
//       try {
//         // sendChat expects the same message shape as chat messages in your app
//         sendChat(msg);
//       } catch (e) {
//         console.warn("sendChat (file msg) failed", e);
//       }
//     } catch (e) {
//       console.warn("preview creation failed", e);
//     }

//     if (opts.directSend) {
//       try {
//         const targetPeers = Array.isArray(peers) ? [...peers] : [];
//         if (targetPeers.length === 0) {
//           // nothing to send to — just keep local message (no system msg)
//           return;
//         }

//         try {
//           startSendingFile(file, offerId, targetPeers);
//         } catch (e) {
//           console.warn("startSendingFile failed", e);
//         }

//         // no system message — the file chat msg already exists and was sent via sendChat(msg)
//       } catch (e) {
//         console.warn("direct send failed", e);
//       }
//       return;
//     }

//     // Fallback: original offer flow (if directSend not requested)
//     const meta = {
//       id: offerId,
//       name: file.name,
//       size: file.size,
//       mime: file.type,
//       from: getLocalPeerId() || myId,
//       // include isMirrored in offer metadata so remote clients can preserve mirror flag
//       isMirrored: Boolean(
//         file.name && file.name.toLowerCase().endsWith(".mirrored.webm")
//       ),
//     };
//     try {
//       offerFileToPeers(meta);
//     } catch (e) {
//       console.warn("offerFileToPeers failed", e);
//     }

//     // cleanup if nobody accepts after 10s (keeps compatibility)
//     setTimeout(() => {
//       try {
//         const pending = outgoingPendingOffers.current[offerId];
//         if (!pending) return;
//         if (pending.acceptingPeers.size === 0) {
//           // silently expire the offer (don't create a system message).
//           setTimeout(() => removeTransfer(offerId), 800);
//         }
//       } catch (e) {
//         console.warn("post-offer cleanup failed", e);
//       }
//     }, 10000);
//   };

//   // helper to open center preview for a message (file message)
//   const openCenterPreview = async (msg) => {
//     try {
//       // If message references an ID in IDB, prefer to load the blob fresh (this avoids using a revoked URL)
//       if (msg.fileId) {
//         try {
//           const blob = await getBlob(msg.fileId);
//           if (blob) {
//             const url = URL.createObjectURL(blob);
//             createdUrlsRef.current.add(url);

//             // update message in-memory to carry the runtime fileUrl (persistMessages will strip fileUrl)
//             setMessages((m) => {
//               const next = m.map((x) =>
//                 x.id === msg.id ? { ...x, fileUrl: url } : x
//               );
//               persistMessages(next);
//               return next;
//             });

//             setCenterPreviewUrl(url);
//             setCenterPreviewIsMirrored(Boolean(msg.isMirrored));
//             setCenterPreviewOpen(true);
//             return;
//           }
//         } catch (e) {
//           console.warn("openCenterPreview: failed to load blob from IDB", e);
//           // fallthrough to try existing fileUrl
//         }
//       }

//       // fallback: if a runtime fileUrl is present on the message, use it
//       if (msg.fileUrl) {
//         setCenterPreviewUrl(msg.fileUrl);
//         setCenterPreviewIsMirrored(Boolean(msg.isMirrored));
//         setCenterPreviewOpen(true);
//         return;
//       }

//       // No file available: show helpful system message
//       setMessages((m) => {
//         const sys = {
//           id: `sys-missing-${msg.id}-${Date.now()}`,
//           from: "System",
//           text: "Preview not available (file not stored locally).",
//           ts: Date.now(),
//           type: "system",
//         };
//         const next = [...m, sys];
//         persistMessages(next);
//         return next;
//       });
//     } catch (e) {
//       console.warn("openCenterPreview error", e);
//     }
//   };

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

//   // wire up progress/completion callbacks exported by webrtc.js
//   useEffect(() => {
//     const progressCb = (offerId, peerId, bytes, totalBytes) => {
//       setTransfer(offerId, (prev) => ({
//         direction: prev?.direction || "sending",
//         label: prev?.label || `Transfer ${offerId}`,
//         total: totalBytes || prev?.total || 0,
//         transferred: bytes || prev?.transferred || 0,
//         peers: Array.from(new Set([...(prev?.peers || []), peerId])),
//       }));
//     };
//     const completeCb = (offerId, peerId) => {
//       setTransfer(offerId, (prev) => ({
//         ...prev,
//         transferred: prev?.total ?? prev?.transferred ?? 0,
//         peers: Array.from(new Set([...(prev?.peers || []), peerId])),
//       }));
//       setTimeout(() => removeTransfer(offerId), 1200);
//     };

//     try {
//       setOnFileProgress(progressCb);
//       setOnFileComplete(completeCb);
//     } catch (e) {}

//     return () => {
//       try {
//         setOnFileProgress(null);
//         setOnFileComplete(null);
//       } catch (e) {}
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // connected peer names
//   const connectedNames = peers.length
//     ? peers.map((id) => peerNamesMap[id] || id)
//     : [];

//   const typingSummary = () => {
//     const names = Object.keys(typingUsers);
//     if (!names.length) return null;
//     const shown = names.slice(0, 2).join(", ");
//     return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
//   };

//   const renderIncomingFileOffers = () => {
//     const keys = Object.keys(incomingFileOffers);
//     if (!keys.length) return null;
//     return keys.map((k) => {
//       const entry = incomingFileOffers[k];
//       const offer = entry.offer;
//       const remaining = Math.max(
//         0,
//         Math.ceil((entry.expiresAt - Date.now()) / 1000)
//       );
//       return (
//         <div
//           key={k}
//           className="mb-2 p-2 rounded bg-white/10 text-sm text-black"
//         >
//           <div className="font-semibold">
//             <span className="inline-block max-w-[260px] whitespace-normal break-words">
//               File offer:&nbsp;{" "}
//               <strong className="break-words">{offer.name}</strong>
//             </span>
//             <span className="ml-2 text-xs text-gray-500">
//               ({Math.round((offer.size || 0) / 1024)} KB)
//             </span>
//           </div>
//           <div className="text-xs text-gray-600">
//             From: {peerNamesMap[offer.from] || offer.from} — Expires in{" "}
//             {remaining}s
//           </div>
//           <div className="mt-2 flex justify-center gap-2">
//             <button
//               onClick={() => acceptFileOffer(k)}
//               className="px-3 py-1 rounded bg-gradient-to-br from-green-500 to-green-600 text-white"
//             >
//               Accept
//             </button>
//             <button
//               onClick={() => ignoreFileOffer(k)}
//               className="px-3 py-1 rounded bg-gradient-to-br from-red-500 to-red-600 text-white"
//             >
//               Ignore
//             </button>
//           </div>
//         </div>
//       );
//     });
//   };

//   // accept incoming offer -> ask where to save and respond true
//   const acceptFileOffer = async (offerId) => {
//     const entry = incomingFileOffers[offerId];
//     if (!entry) return;
//     const { offer } = entry;
//     try {
//       if (supportsNativeFileSystem()) {
//         const opts = {
//           suggestedName: offer.name,
//           types: [
//             {
//               description: offer.mime || "file",
//               accept: {
//                 [offer.mime || "application/octet-stream"]: [
//                   "." + (offer.name.split(".").pop() || ""),
//                 ],
//               },
//             },
//           ],
//         };
//         const handle = await (window.showSaveFilePicker
//           ? window.showSaveFilePicker(opts)
//           : window.chooseFileSystemEntries
//           ? window.chooseFileSystemEntries({
//               type: "save-file",
//               accepts: opts.types,
//             })
//           : null);
//         if (!handle) {
//           respondToFileOffer(offerId, offer.from, false);
//           setIncomingFileOffers((s) => {
//             const copy = { ...s };
//             delete copy[offerId];
//             return copy;
//           });
//           return;
//         }
//         const writable = await handle.createWritable();
//         saveHandlesRef.current[offerId] = writable;
//         fileWriteStatusRef.current[offerId] = 0;
//         setTransfer(offerId, {
//           direction: "receiving",
//           label: offer.name,
//           total: offer.size || 0,
//           transferred: 0,
//           peers: [offer.from],
//         });
//         respondToFileOffer(offerId, offer.from, true);
//         setIncomingFileOffers((s) => {
//           const copy = { ...s };
//           delete copy[offerId];
//           return copy;
//         });
//       } else {
//         respondToFileOffer(offerId, offer.from, true);
//         setIncomingFileOffers((s) => {
//           const copy = { ...s };
//           delete copy[offerId];
//           return copy;
//         });
//         setMessages((m) => {
//           const sys = {
//             id: `sys-accept-${offerId}`,
//             from: "System",
//             text: `Accepted file: ${offer.name} — browser may not support direct disk writes.`,
//             ts: Date.now(),
//             type: "system",
//           };
//           const next = [...m, sys];
//           persistMessages(next);
//           return next;
//         });
//         setTransfer(offerId, {
//           direction: "receiving",
//           label: offer.name,
//           total: offer.size || 0,
//           transferred: 0,
//           peers: [offer.from],
//         });
//       }
//     } catch (e) {
//       console.warn("acceptFileOffer failed", e);
//       try {
//         respondToFileOffer(offerId, offer.from, false);
//       } catch (er) {}
//       setIncomingFileOffers((s) => {
//         const copy = { ...s };
//         delete copy[offerId];
//         return copy;
//       });
//     }
//   };

//   const ignoreFileOffer = (offerId) => {
//     const entry = incomingFileOffers[offerId];
//     if (!entry) return;
//     try {
//       respondToFileOffer(offerId, entry.offer.from, false);
//     } catch (e) {
//       console.warn("ignoreFileOffer failed", e);
//     }
//     setIncomingFileOffers((s) => {
//       const copy = { ...s };
//       delete copy[offerId];
//       return copy;
//     });
//   };

//   // show centered preview modal
//   const closeCenterPreview = () => {
//     // Do NOT revoke the URL here. We will revoke all created URLs on unmount cleanup.
//     setCenterPreviewOpen(false);
//     setCenterPreviewUrl(null);
//     setCenterPreviewIsMirrored(false);
//   };

//   // wire up progress/completion callbacks (already done above)

//   // UI rendering
//   // This should be inside your Chat component function
//   return (
//     <>
//       {/* Floating progress panel */}
//       {Object.keys(transfers).length > 0 && (
//         <div className="fixed left-1/2 -translate-x-1/2 top-4 z-50">
//           <div className="bg-black/80 text-white rounded-lg p-3 shadow-lg w-[min(720px,calc(100%-40px))]">
//             {Object.entries(transfers).map(([id, t]) => {
//               const pct = t.total
//                 ? Math.min(100, Math.round((t.transferred / t.total) * 100))
//                 : 0;
//               const label = t.label || id;
//               const directionText =
//                 t.direction === "sending" ? "Sending" : "Receiving";
//               const humanTransferred = `${Math.round(
//                 (t.transferred || 0) / 1024
//               )} KB`;
//               const humanTotal = `${Math.round((t.total || 0) / 1024)} KB`;
//               return (
//                 <div key={id} className="mb-3 last:mb-0">
//                   <div className="flex justify-between items-center text-sm mb-1">
//                     <div className="font-semibold max-w-[70%] break-words whitespace-normal">
//                       {directionText}: {label}
//                     </div>
//                     <div className="text-xs">{pct}%</div>
//                   </div>
//                   <div className="w-full bg-white/10 rounded h-2 overflow-hidden mb-1">
//                     <div
//                       style={{ width: `${pct}%` }}
//                       className="h-2 bg-blue-500 transition-all"
//                     />
//                   </div>
//                   <div className="text-xs text-white/60">
//                     {humanTransferred} / {humanTotal}
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         </div>
//       )}

//       <div className="h-[92vh] md:h-[92vh] max-w-[430px] w-full mx-auto bg-black text-green-600 p-6 flex flex-col font-bold text-base rounded-4xl">

//         <header className="flex items-center justify-between mb-4 ">
//           <div className="flex gap-2.5">
//             <div className="text-sm text-purple-500">YourID</div>
//             <div className="font-mono">{myId || "..."}</div>
//             <div className="text-sm text-blue-600">Name: {username}</div>
//             <div className="text-xs text-purple-500 mt-1">
//               Auto-join: {joinedBootstrap || "none"}
//             </div>
//           </div>

//           <div className="relative" ref={menuRef}>
//             <button
//               onClick={() => setMenuOpen((s) => !s)}
//               className="p-2 rounded-full  bg-gradient-to-r from-black to-black text-white"
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
//                 className="w-full text-left px-4 py-3 bg-gradient-to-r from-black to-black  hover:bg-white/20 border-b border-white/5 text-green-500"
//               >
//                 <span className="font-semibold">Create Hub</span>
//                 <div className="text-xs text-gray-400">
//                   Make this device the host
//                 </div>
//               </button>

//               <button
//                 onClick={handleJoinHub}
//                 className="w-full text-left px-4 py-3 bg-gradient-to-r from-black to-black  hover:bg-white/20 border-b border-white/5 text-blue-500"
//               >
//                 <span className="font-semibold">Join Hub</span>
//                 <div className="text-xs text-gray-400">
//                   Enter a host ID to join
//                 </div>
//               </button>

//               <button
//                 onClick={handleLeaveClick}
//                 className="w-full text-left px-4 py-3 bg-gradient-to-r from-black to-black  hover:bg-white/20 text-red-500 rounded-b-lg"
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

//         <main className="flex-1 overflow-auto mb-4 min-h-0">
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

//           {renderIncomingFileOffers()}

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

//           {/* Improved input container layout */}

//           <div className="relative w-full flex items-center gap-2">
//             {/* Left side controls container */}
//             <div className="flex items-center gap-2 flex-shrink-0">
//               {/* Circular video-record button */}
//               <div className="relative ">
//                 <CircularStream
//                   onFileRecorded={(file) =>
//                     onFileSelected(file, { directSend: true })
//                   }
//                   buttonClassName="w-10 h-10 flex items-center justify-center flex-shrink-0"
//                 />
//               </div>
//             </div>

//             {/* Text input - flex-1 takes remaining space */}
//             <div className="relative flex-1">
//               <input
//                 value={text}
//                 onChange={(e) => setText(e.target.value)}
//                 placeholder="Type a message..."
//                 className="w-full p-3 pr-12 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2 border-white/20 focus:border-blue-400 focus:outline-none transition-colors duration-200"
//                 onKeyDown={(e) => {
//                   if (e.key === "Enter") send();
//                 }}
//               />

//               {/* Send button inside input */}
//               <button
//                 onClick={send}
//                 className="absolute right-2 top-1/2 -translate-y-1/2 w-14 h-10 flex items-center  bg-gradient-to-r from-black to-black justify-center rounded-full text-blue-500 "
//                 title="Send"
//                 aria-label="Send message"
//               >
//                 Send
//               </button>
//             </div>
//           </div>
//         </footer>
//       </div>

//       {/* Enhanced video preview modal */}
//       {centerPreviewOpen && centerPreviewUrl && (
//         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
//           <div className="relative w-full max-w-4xl mx-auto">
//             {/* Close button */}
//             <button
//               onClick={closeCenterPreview}
//               aria-label="Close preview"
//               className="absolute -top-12 right-0 z-10 text-white hover:text-gray-300 bg-gradient-to-br from-red-500 to-red-600 hover:bg-black/70 p-3 rounded-full transition-all duration-200 backdrop-blur-sm"
//               title="Close preview"
//             >
//               <svg
//                 className="w-6 h-6"
//                 fill="none"
//                 stroke="currentColor"
//                 viewBox="0 0 24 24"
//               >
//                 <path
//                   strokeLinecap="round"
//                   strokeLinejoin="round"
//                   strokeWidth={2}
//                   d="M6 18L18 6M6 6l12 12"
//                 />
//               </svg>
//             </button>

//             <div className="relative bg-black rounded-2xl overflow-hidden">
//               {centerPreviewIsMirrored ? (
//                 <MirroredVideoCanvas
//                   src={centerPreviewUrl}
//                   autoPlay={true}
//                   className="max-h-[80vh]"
//                   onClose={() => {
//                     setCenterPreviewOpen(false);
//                     setCenterPreviewUrl(null);
//                     setCenterPreviewIsMirrored(false);
//                   }}
//                 />
//               ) : (
//                 <video
//                   src={centerPreviewUrl}
//                   controls
//                   autoPlay
//                   playsInline
//                   className="w-full h-auto max-h-[80vh] object-contain"
//                   onLoadedMetadata={(e) => {
//                     e.target.focus();
//                   }}
//                 />
//               )}
//             </div>
//           </div>

//           {/* Click outside to close */}
//           <div
//             className="absolute inset-0 -z-10"
//             onClick={closeCenterPreview}
//             aria-label="Click to close preview"
//           />
//         </div>
//       )}

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
