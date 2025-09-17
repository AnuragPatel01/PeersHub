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

const LS_MSGS = "ph_msgs_v1";
const LS_THREADS = "ph_threads_v1";
const MAX_MSGS = 100;

/* -------------------- Simple IndexedDB helpers -------------------- */
/* Usage:
     await idbSet(key, value)
     const v = await idbGet(key)
*/
const DB_NAME = "peershub_v1";
const DB_VERSION = 1;
const STORE_NAME = "kv";

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = (e) => {
      console.warn("IDB open error", e);
      resolve(null);
    };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
  });

const idbGet = async (key) => {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn("idbGet failed", e);
    return null;
  }
};

const idbSet = async (key, value) => {
  try {
    const db = await openDb();
    if (!db) return false;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const r = store.put(value, key);
      r.onsuccess = () => resolve(true);
      r.onerror = () => {
        console.warn("idbSet error", r.error);
        resolve(false);
      };
    });
  } catch (e) {
    console.warn("idbSet failed", e);
    return false;
  }
};

/* -------------------- Chat component -------------------- */
export default function Chat() {
  // core state
  const [myId, setMyId] = useState(() => getLocalPeerId() || "...");
  const [peers, setPeers] = useState([]);
  const [peerNamesMap, setPeerNamesMap] = useState({});
  const [messages, setMessages] = useState([]); // loaded from IDB in effect
  const [threadMessages, setThreadMessages] = useState({}); // loaded from IDB in effect

  // Thread state
  const [activeThread, setActiveThread] = useState(null);
  const [threadTypingUsers, setThreadTypingUsers] = useState({});

  // file transfer
  const [incomingFileOffers, setIncomingFileOffers] = useState({});
  const [transfers, setTransfers] = useState({});

  const saveHandlesRef = useRef({});
  const fileWriteStatusRef = useRef({});
  const outgoingPendingOffers = useRef({});

  // UI / other state
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState([]); // { file, dataUrl, name, offerId }
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

  /* -------------------- Persistence helpers (IDB + fallback) -------------------- */
  const persistMessages = async (arr) => {
    try {
      const tail = arr.slice(-MAX_MSGS);
      // attempt IDB write first
      const ok = await idbSet(LS_MSGS, tail);
      if (!ok) localStorage.setItem(LS_MSGS, JSON.stringify(tail));
    } catch (e) {
      try {
        localStorage.setItem(LS_MSGS, JSON.stringify(arr.slice(-MAX_MSGS)));
      } catch (er) {}
    }
  };

  const persistThreadMessages = async (threads) => {
    try {
      const ok = await idbSet(LS_THREADS, threads);
      if (!ok) localStorage.setItem(LS_THREADS, JSON.stringify(threads));
    } catch (e) {
      try {
        localStorage.setItem(LS_THREADS, JSON.stringify(threads));
      } catch (er) {}
    }
  };

  // On mount, load persisted messages & threads (IDB -> fallback localStorage)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idbMsgs = await idbGet(LS_MSGS);
        const idbThreads = await idbGet(LS_THREADS);
        if (!cancelled) {
          if (Array.isArray(idbMsgs)) setMessages(idbMsgs);
          else {
            try {
              const raw = localStorage.getItem(LS_MSGS);
              if (raw) setMessages(JSON.parse(raw));
            } catch (e) {}
          }
          if (idbThreads && typeof idbThreads === "object")
            setThreadMessages(idbThreads);
          else {
            try {
              const rawT = localStorage.getItem(LS_THREADS);
              if (rawT) setThreadMessages(JSON.parse(rawT));
            } catch (e) {}
          }
        }
      } catch (e) {
        console.warn("load persisted messages failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------------------- Messages helpers -------------------- */
  const upsertIncomingChat = (incoming) => {
    if (incoming.type === "thread" && incoming.threadRootId) {
      setThreadMessages((threads) => {
        const rootId = incoming.threadRootId;
        const existing = threads[rootId] || [];
        const existingMsg = existing.find((x) => x.id === incoming.id);

        let updated;
        if (existingMsg) {
          updated = {
            ...threads,
            [rootId]: existing.map((x) =>
              x.id === incoming.id ? { ...x, ...incoming } : x
            ),
          };
        } else {
          const msgObj = {
            id: incoming.id,
            from: incoming.fromName || incoming.from || "peer",
            fromId: incoming.from,
            text: incoming.text,
            ts: incoming.ts || Date.now(),
            type: "thread",
            threadRootId: incoming.threadRootId,
            deliveries: incoming.deliveries || [],
            reads: incoming.reads || [],
            replyTo: incoming.replyTo || null,
            imageGroup: incoming.imageGroup || undefined,
            imagePreview: incoming.imagePreview || undefined,
            imageMeta: incoming.imageMeta || undefined,
          };
          updated = {
            ...threads,
            [rootId]: [...existing, msgObj],
          };
        }

        persistThreadMessages(updated);
        return updated;
      });
      return;
    }

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
        type: incoming.type || "chat",
        replyTo: incoming.replyTo || null,
        deliveries: incoming.deliveries || [],
        reads: incoming.reads || [],
        imageGroup: incoming.imageGroup || undefined,
        imagePreview: incoming.imagePreview || undefined,
        imageMeta: incoming.imageMeta || undefined,
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

  // mark all messages in a thread as read (and send ack)
  const markThreadAsRead = (rootId) => {
    try {
      const localId = getLocalPeerId() || myId;
      const msgs = threadMessages[rootId] || [];
      msgs.forEach((m) => {
        const origin = m.fromId || m.from;
        const alreadyRead = Array.isArray(m.reads) && m.reads.includes(localId);
        if (!alreadyRead) {
          try {
            // sendAckRead signature in your code is sendAckRead(id, origin, isThread?, threadRootId?)
            sendAckRead(m.id, origin, true, rootId);
          } catch (e) {}
          addUniqueToMsgArray(m.id, "reads", localId, true, rootId);
        }
      });
    } catch (e) {
      console.warn("markThreadAsRead failed", e);
    }
  };

  /* -------------------- Transfer helpers (unchanged) -------------------- */
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

  /* -------------------- Incoming message handler (wire-in) -------------------- */
  const handleIncoming = async (from, payloadOrText) => {
    console.debug("handleIncoming:", { from, payloadOrText });
    try {
      // typing
      if (from === "__system_typing__" && payloadOrText) {
        try {
          const fromName =
            payloadOrText.fromName || payloadOrText.from || payloadOrText.name;
          const isTyping =
            payloadOrText.isTyping ??
            payloadOrText.typing ??
            payloadOrText.is_typing ??
            false;
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
            return;
          }

          setThreadTypingUsers((t) => {
            const copy = { ...t };
            const root = threadRootId;
            const bucket = { ...(copy[root] || {}) };
            if (isTyping) bucket[fromName] = Date.now();
            else delete bucket[fromName];
            if (Object.keys(bucket).length) copy[root] = bucket;
            else delete copy[root];
            return copy;
          });
          return;
        } catch (e) {
          console.warn("handleIncoming: typing handling failed", e, payloadOrText);
          return;
        }
      }

      // ack deliver
      if (
        from === "__system_ack_deliver__" &&
        payloadOrText &&
        payloadOrText.id
      ) {
        try {
          const fromPeer =
            payloadOrText.fromPeer || payloadOrText.from || payloadOrText.peer;
          const id = payloadOrText.id;
          const isThread =
            payloadOrText.isThread || payloadOrText.thread || false;
          const threadRootId =
            payloadOrText.threadRootId ||
            payloadOrText.rootId ||
            payloadOrText.threadId ||
            null;

          addUniqueToMsgArray(
            id,
            "deliveries",
            fromPeer,
            !!isThread,
            threadRootId
          );
        } catch (e) {
          console.warn("handleIncoming: ack_deliver failed", e, payloadOrText);
        }
        return;
      }

      // ack read
      if (from === "__system_ack_read__" && payloadOrText && payloadOrText.id) {
        try {
          const fromPeer =
            payloadOrText.fromPeer || payloadOrText.from || payloadOrText.peer;
          const id = payloadOrText.id;
          const isThread =
            payloadOrText.isThread || payloadOrText.thread || false;
          const threadRootId =
            payloadOrText.threadRootId ||
            payloadOrText.rootId ||
            payloadOrText.threadId ||
            null;

          addUniqueToMsgArray(id, "reads", fromPeer, !!isThread, threadRootId);
        } catch (e) {
          console.warn("handleIncoming: ack_read failed", e, payloadOrText);
        }
        return;
      }

      // system messages
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
          console.warn("handleIncoming: system msg failed", e, payloadOrText);
        }
        return;
      }

      // file offer
      if (from === "__system_file_offer__" && payloadOrText) {
        try {
          const offer = payloadOrText;
          const offerId =
            offer.id ||
            `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          setIncomingFileOffers((s) => {
            const copy = { ...s };
            copy[offerId] = {
              offer,
              expiresAt: Date.now() + 20000,
              origin: offer.from,
            };
            return copy;
          });

          setTimeout(() => {
            setIncomingFileOffers((s) => {
              const copy = { ...s };
              if (!copy[offerId]) return s;
              try {
                respondToFileOffer(offerId, offer.from, false);
              } catch (e) {}
              delete copy[offerId];
              return copy;
            });
          }, 20000);

          maybeNotify(
            peerNamesMap[offer.from] || offer.from,
            `File offer: ${offer.name}`
          );
        } catch (e) {
          console.warn("handleIncoming: file offer failed", e, payloadOrText);
        }
        return;
      }

      // file offer response
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

      // file chunk
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

      // file transfer done
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

      // chat or thread object
      if (
        payloadOrText &&
        typeof payloadOrText === "object" &&
        (payloadOrText.type === "chat" || payloadOrText.type === "thread") &&
        payloadOrText.id
      ) {
        try {
          upsertIncomingChat(payloadOrText);
          maybeNotify(
            payloadOrText.fromName || payloadOrText.from,
            payloadOrText.text || (payloadOrText.imageGroup ? "Photo(s)" : "")
          );

          // auto ack read if visible
          try {
            const origin = payloadOrText.from || payloadOrText.origin || null;
            const localId = getLocalPeerId() || myId;
            if (
              origin &&
              origin !== localId &&
              document.visibilityState === "visible"
            ) {
              try {
                if (payloadOrText.type === "thread") {
                  sendAckRead(
                    payloadOrText.id,
                    origin,
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
                  sendAckRead(payloadOrText.id, origin);
                  addUniqueToMsgArray(payloadOrText.id, "reads", localId);
                }
              } catch (e) {
                console.warn("sendAckRead failed (auto visibility):", e);
              }
            }
          } catch (e) {}
        } catch (e) {
          console.warn(
            "handleIncoming: upsertIncomingChat failed",
            e,
            payloadOrText
          );
        }
        return;
      }

      // string fallback
      if (typeof payloadOrText === "string") {
        try {
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
        } catch (e) {
          console.warn(
            "handleIncoming: string fallback failed",
            e,
            payloadOrText
          );
        }
        return;
      }
    } catch (outerErr) {
      console.warn("handleIncoming: unexpected error", outerErr, {
        from,
        payloadOrText,
      });
    }
  };

  /* -------------------- Peer list + bootstrap handlers -------------------- */
  const handlePeerListUpdate = (list) => {
    setPeers(list || []);
    try {
      const names = getPeerNames();
      setPeerNamesMap(names || {});
    } catch (e) {}
  };

  const handleBootstrapChange = (newBootstrapId) => {
    setJoinedBootstrap(newBootstrapId || "");
  };

  /* -------------------- Initialize peer -------------------- */
  useEffect(() => {
    if (!username) return;
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

  /* -------------------- Auto-scroll -------------------- */
  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    } catch (e) {}
  }, [messages]);

  /* -------------------- Visibility ack_read -------------------- */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        const localId = getLocalPeerId() || myId;
        messages.forEach((m) => {
          if (!m || m.type !== "chat") return;
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
    if (document.visibilityState === "visible") onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, myId]);

  /* -------------------- Outside click for menu -------------------- */
  useEffect(() => {
    const onDocClick = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    else document.removeEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  /* -------------------- Typing broadcast -------------------- */
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

  /* -------------------- Long press handlers -------------------- */
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
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
      }
    };
  }, []);

  /* -------------------- Thread helpers -------------------- */
  const showThread = (message) => {
    setActiveThread(message);
    if (message && message.id) markThreadAsRead(message.id);
  };
  const closeThread = () => {
    setActiveThread(null);
    setLongPressMessage(null);
  };

  // Send thread reply (update state & broadcast)
  const handleSendThreadReply = (threadMessage) => {
    try {
      setThreadMessages((threads) => {
        const rootId = threadMessage.threadRootId;
        const existing = Array.isArray(threads[rootId]) ? threads[rootId] : [];

        const msgObj = {
          id: threadMessage.id,
          from: threadMessage.fromName || threadMessage.from || "peer",
          fromId: threadMessage.from || null,
          text: threadMessage.text,
          ts: threadMessage.ts || Date.now(),
          type: "thread",
          threadRootId: rootId,
          deliveries: threadMessage.deliveries || [],
          reads: threadMessage.reads || [],
          replyTo: threadMessage.replyTo || null,
          imageGroup: threadMessage.imageGroup || undefined,
          imagePreview: threadMessage.imagePreview || undefined,
          imageMeta: threadMessage.imageMeta || undefined,
        };

        const updated = {
          ...threads,
          [rootId]: [...existing, msgObj],
        };
        persistThreadMessages(updated);
        return updated;
      });

      // broadcast
      sendChat(threadMessage);
    } catch (e) {
      console.warn("sendChat (thread) failed", e);
    }
  };

  const getThreadCount = (messageId) => {
    const threads = threadMessages[messageId] || [];
    return threads.length;
  };

  /* -------------------- LongPressDialog component -------------------- */
  const LongPressDialog = ({ message, onClose, onOpenThread }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 m-4 max-w-sm w-full">
        <h3 className="text-lg font-semibold mb-4">Reply Options</h3>
        <div className="space-y-3">
          <button
            onClick={() => {
              handleTapMessage(message);
              onClose();
            }}
            className="w-full p-3 text-left rounded-lg bg-gray-100 hover:bg-gray-200"
          >
            <div className="font-medium">Reply in Chat</div>
            <div className="text-sm text-gray-600">Quick reply in main conversation</div>
          </button>
          <button
            onClick={() => {
              onOpenThread();
              onClose();
            }}
            className="w-full p-3 text-left rounded-lg bg-blue-100 hover:bg-blue-200"
          >
            <div className="font-medium">Reply in Nest</div>
            <div className="text-sm text-gray-600">Start or continue a focused discussion</div>
          </button>
        </div>
        <button onClick={onClose} className="w-full mt-4 p-2 text-gray-600 hover:text-gray-800">
          Cancel
        </button>
      </div>
    </div>
  );

  /* -------------------- Hub handlers -------------------- */
  const handleCreateHub = () => {
    const id = getLocalPeerId() || myId;
    if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
    joinHub(id);
    setJoinedBootstrap(id);

    localStorage.setItem("ph_hub_bootstrap", id);
    localStorage.setItem("ph_should_autojoin", "true");

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

    try {
      const publicText = `[${username || "Host"}] is the host`;
      broadcastSystem("system_public", publicText, `sys-host-${id}`);
    } catch (e) {
      console.warn("broadcastSystem failed", e);
    }

    setMenuOpen(false);
  };

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

  const handleLeaveClick = () => {
    setMenuOpen(false);
    setConfirmLeaveOpen(true);
  };

  const handleConfirmLeave = () => {
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
  };

  const handleCancelLeave = () => setConfirmLeaveOpen(false);

  /* -------------------- Send (text or grouped images) -------------------- */
  const send = async () => {
    // image group send
    if (pendingPhotos.length > 0) {
      // we already have dataUrl previews in pendingPhotos
      const offerId = `img-group-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

      const msgObj = {
        id: offerId,
        from: username || "You",
        fromId: getLocalPeerId() || myId,
        ts: Date.now(),
        type: "chat",
        imageGroup: pendingPhotos.map((p) => p.dataUrl),
        imageMeta: pendingPhotos.map((p) => ({ name: p.name })),
        text: caption || "",
        deliveries: [],
        reads: [getLocalPeerId() || myId],
      };

      setMessages((m) => {
        const next = [...m, msgObj];
        persistMessages(next);
        return next;
      });

      try {
        sendChat(msgObj);
      } catch (e) {
        console.warn("sendChat failed for image group", e);
      }

      setPendingPhotos([]);
      setCaption("");
      setText("");
      return;
    }

    // normal text send
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const msg = {
      id,
      from: username || "You",
      fromId: getLocalPeerId() || myId,
      text: trimmed,
      ts: Date.now(),
      type: "chat",
      deliveries: [],
      reads: [getLocalPeerId() || myId],
      replyTo: replyTo || null,
    };
    setMessages((m) => {
      const next = [...m, msg];
      persistMessages(next);
      return next;
    });

    try {
      sendChat(msg);
    } catch (e) {
      console.warn("sendChat failed", e);
    }

    setText("");
    setReplyTo(null);
  };

  // reply + send ack_read on tap
  const handleTapMessage = (m) => {
    if (m.type && m.type.startsWith("system")) return;
    setReplyTo({ id: m.id, from: m.from, text: m.text });
    const input = document.querySelector('input[placeholder="Type a message..."]');
    if (input) input.focus();

    const originPeerId = m.fromId || m.from;
    if (m.id && originPeerId) {
      try {
        sendAckRead(m.id, originPeerId);
        addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId);
      } catch (e) {
        console.warn("sendAckRead error", e);
      }
    }
  };

  /* -------------------- Status dot renderer -------------------- */
  const renderStatusDot = (m) => {
    const totalPeers = peers?.length || 0;
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

    if (deliveries < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
          title={`Single tick — delivered to ${deliveries}/${totalPeers}`}
        />
      );
    }

    if (deliveries === totalPeers && reads < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
          title={`Double tick — delivered to all (${totalPeers}), reads ${reads}/${totalPeers}`}
        />
      );
    }

    if (reads === totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-green-500 ml-2"
          title="Double-blue — read by everyone"
        />
      );
    }

    return <span className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2" />;
  };

  /* -------------------- Message renderer (with image groups) -------------------- */
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

    const threadCount = getThreadCount(m.id);

    // image flags
    const isImagePreview = !!m.imagePreview;
    const isImageGroup = Array.isArray(m.imageGroup) && m.imageGroup.length > 0;
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
    const bubbleBgClass = isMe ? "ml-auto bg-blue-500 text-white" : "bg-white/100 text-black";

    const openPreview = (src) => {
      const win = window.open("", "_blank");
      if (!win) return;
      win.document.write(
        `<html><head><title>Photo</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><img src="${src}" style="max-width:100%;max-height:100vh;object-fit:contain"/></body></html>`
      );
      win.document.close();
    };

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
        className={`p-2 rounded-2xl mb-2 cursor-pointer select-none relative ${bubbleWidthClass} ${bubbleBgClass}`}
        style={{ wordBreak: "break-word" }}
      >
        <div className="text-xs font-bold flex items-center">
          <div className="flex-1">{isMe ? "You" : from}</div>
          <div className="text-[10px] text-gray-700/70 ml-2">{time}</div>
          {isMe && renderStatusDot(m)}
        </div>

        {m.replyTo && (
          <div className="mt-2 mb-2 p-2 rounded border border-white/5 text-xs text-gray-600 bg-gray-300">
            <strong className="text-xs text-blue-400">Reply to {m.replyTo.from}:</strong>{" "}
            <span className="inline-block ml-1 truncate" style={{ maxWidth: "100%" }}>
              {m.replyTo.text}
            </span>
          </div>
        )}

        {/* IMAGE GROUP */}
        {isImageGroup ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {m.imageGroup.slice(0, 4).map((src, i) => (
              <div
                key={i}
                className="w-36 h-36 rounded-lg overflow-hidden bg-black/5"
                onClick={(e) => {
                  e.stopPropagation();
                  openPreview(src);
                }}
              >
                <img src={src} alt={`photo-${i}`} className="w-full h-full object-cover" />
              </div>
            ))}
            {m.imageGroup.length > 4 && (
              <div className="col-span-2 text-xs text-gray-500 mt-1">+{m.imageGroup.length - 4} more</div>
            )}
            {m.text && <div className="col-span-2 mt-2 text-sm whitespace-pre-wrap">{m.text}</div>}
          </div>
        ) : isImagePreview ? (
          <div className="mt-2 flex items-center">
            <div
              className="w-40 h-40 rounded-lg overflow-hidden bg-black/5"
              onClick={(e) => {
                e.stopPropagation();
                openPreview(m.imagePreview);
              }}
            >
              <img src={m.imagePreview} alt={m.imageMeta?.name || "photo"} className="w-full h-full object-cover" />
            </div>
            {m.text && <div className="ml-3 break-words whitespace-pre-wrap">{txt}</div>}
          </div>
        ) : (
          <div className="break-words whitespace-pre-wrap mt-1">{txt}</div>
        )}

        {threadCount > 0 && (
          <div
            className="mt-2 flex items-center justify-between text-xs bg-blue-50 text-blue-600 rounded px-2 py-1 cursor-pointer hover:bg-blue-100"
            onClick={(e) => {
              e.stopPropagation();
              showThread(m);
            }}
          >
            <div className="flex items-center space-x-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

  /* -------------------- File selection + previews (multi select) -------------------- */
  const handleFileInputClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,application/*";
    input.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      onFileSelected(files);
    };
    input.click();
  };

  // Accept array of files
  const onFileSelected = async (fileOrFiles) => {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    if (!files.length) return;

    const previews = await Promise.all(
      files.map(
        (file) =>
          new Promise((resolve) => {
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

            if (file.type && file.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = (ev) =>
                resolve({
                  file,
                  dataUrl: ev.target.result,
                  name: file.name,
                  offerId,
                });
              reader.readAsDataURL(file);
            } else {
              resolve({
                file,
                dataUrl: null,
                name: file.name,
                offerId,
              });
            }

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
          })
      )
    );

    const imagePreviews = previews
      .filter((p) => p && p.dataUrl)
      .map((p) => ({ file: p.file, dataUrl: p.dataUrl, name: p.name, offerId: p.offerId }));

    // Append to pendingPhotos
    setPendingPhotos((prev) => [...prev, ...imagePreviews]);
  };

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

  /* -------------------- File progress wiring -------------------- */
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

  /* -------------------- Connected peer names + typing summary -------------------- */
  const connectedNames = peers.length ? peers.map((id) => peerNamesMap[id] || id) : [];

  const typingSummary = () => {
    const names = Object.keys(typingUsers);
    if (!names.length) return null;
    const shown = names.slice(0, 2).join(", ");
    return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
  };

  /* -------------------- Incoming file offers UI -------------------- */
  const renderIncomingFileOffers = () => {
    const keys = Object.keys(incomingFileOffers);
    if (!keys.length) return null;
    return keys.map((k) => {
      const entry = incomingFileOffers[k];
      const offer = entry.offer;
      const remaining = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
      return (
        <div key={k} className="mb-2 p-2 rounded bg-white/10 text-sm text-black">
          <div className="font-semibold">
            <span className="inline-block max-w-[260px] whitespace-normal break-words">
              File offer:&nbsp;
              <strong className="break-words">{offer.name}</strong>
            </span>
            <span className="ml-2 text-xs text-gray-500">({Math.round((offer.size || 0) / 1024)} KB)</span>
          </div>
          <div className="text-xs text-gray-600">
            From: {peerNamesMap[offer.from] || offer.from} — Expires in {remaining}s
          </div>
          <div className="mt-2 flex justify-center gap-2">
            <button onClick={() => acceptFileOffer(k)} className="px-3 py-1 rounded bg-gradient-to-br from-green-500 to-green-600 text-white">
              Accept
            </button>
            <button onClick={() => ignoreFileOffer(k)} className="px-3 py-1 rounded bg-gradient-to-br from-red-500 to-red-600 text-white">
              Ignore
            </button>
          </div>
        </div>
      );
    });
  };

  const maybeNotify = (fromDisplay, textVal) => {
    try {
      if (!fromDisplay || fromDisplay === username) return;
      if (!document.hidden && document.hasFocus()) return;

      const title = `${fromDisplay}`;
      const body =
        typeof textVal === "string"
          ? textVal.length > 120
            ? textVal.slice(0, 117) + "..."
            : textVal
          : JSON.stringify(textVal);
      showNotification(title, {
        body,
        tag: `peershub-${fromDisplay}`,
        data: { from: fromDisplay },
      });
    } catch (e) {
      console.warn("maybeNotify error", e);
    }
  };

  /* -------------------- Render component -------------------- */
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

      {/* Floating progress panel */}
      {Object.keys(transfers).length > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 top-4 z-50">
          <div className="bg-black/80 text-white rounded-lg p-3 shadow-lg w-[min(720px,calc(100%-40px))]">
            {Object.entries(transfers).map(([id, t]) => {
              const pct = t.total ? Math.min(100, Math.round((t.transferred / t.total) * 100)) : 0;
              const label = t.label || id;
              const directionText = t.direction === "sending" ? "Sending" : "Receiving";
              const humanTransferred = `${Math.round((t.transferred || 0) / 1024)} KB`;
              const humanTotal = `${Math.round((t.total || 0) / 1024)} KB`;
              return (
                <div key={id} className="mb-3 last:mb-0">
                  <div className="flex justify-between items-center text-sm mb-1">
                    <div className="font-semibold max-w-[70%] break-words whitespace-normal">{directionText}: {label}</div>
                    <div className="text-xs">{pct}%</div>
                  </div>
                  <div className="w-full bg-white/10 rounded h-2 overflow-hidden mb-1">
                    <div style={{ width: `${pct}%` }} className="h-2 bg-blue-500 transition-all" />
                  </div>
                  <div className="text-xs text-white/60">{humanTransferred} / {humanTotal}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Chat Container */}
      <div className="fixed inset-0 z-10 bg-gray-50 text-purple-600 p-6 flex flex-col">
        <header className="flex items-center justify-between mb-4">
          <div className="flex gap-2.5">
            <div className="text-sm text-blue-600">YourID</div>
            <div className="font-mono">{myId || "..."}</div>
            <div className="text-sm text-blue-600">Name: {username}</div>
            <div className="text-xs text-purple-500 mt-1">Auto-join: {joinedBootstrap || "none"}</div>
          </div>

          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((s) => !s)} className="p-2 rounded-full bg-gradient-to-br from-gray-50 to-gray-50 text-white" aria-label="Menu">
              <svg width="18" height="18" viewBox="0 0 24 24" className="inline-block">
                <circle cx="12" cy="5" r="2" fill="blue" />
                <circle cx="12" cy="12" r="2" fill="blue" />
                <circle cx="12" cy="19" r="2" fill="blue" />
              </svg>
            </button>

            <div className={`absolute right-0 mt-2 w-44 bg-white/10 backdrop-blur rounded-lg shadow-lg z-50 transform origin-top-right transition-all duration-200 ${menuOpen ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}>
              <button onClick={handleCreateHub} className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-green-500">
                <span className="font-semibold">Create Hub</span>
                <div className="text-xs text-gray-400">Make this device the host</div>
              </button>

              <button onClick={handleJoinHub} className="w-full text-left px-4 py-3 hover:bg-white/20 border-b border-white/5 text-blue-500">
                <span className="font-semibold">Join Hub</span>
                <div className="text-xs text-gray-400">Enter a host ID to join</div>
              </button>

              <button onClick={handleLeaveClick} className="w-full text-left px-4 py-3 hover:bg-white/20 text-red-500 rounded-b-lg">
                <span className="font-semibold">Leave</span>
                <div className="text-xs text-gray-400">Leave and clear local history</div>
              </button>
            </div>
          </div>
        </header>

        <div className="w-full text-white h-0.5 bg-white" />
        <br />

        <main className="flex-1 overflow-auto mb-4 min-h-0">
          <div style={{ paddingBottom: 8 }}>
            {messages.length === 0 && <div className="text-sm text-white/60">No messages yet</div>}
            {messages.map((m, i) => renderMessage(m, i))}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="w-full text-white h-0.5 bg-white" />
        <br />

        <footer className="mt-auto">
          {typingSummary()}
          <div className="mb-3 text-sm text-blue-600">
            Connected peers: {connectedNames.length === 0 ? <span className="text-red-500">none</span> : connectedNames.join(", ")}
          </div>

          {renderIncomingFileOffers()}

          {replyTo && (
            <div className="mb-2 p-3 bg-white/10 text-gray-500 rounded-lg">
              Replying to <strong>{replyTo.from}</strong>: <span className="text-sm text-blue-400">{replyTo.text}</span>
              <button onClick={() => setReplyTo(null)} className="ml-4 text-xs text-red-500">x</button>
            </div>
          )}

          {/* When photos selected show preview grid + caption */}
          {pendingPhotos.length > 0 ? (
            <div className="mb-3 p-3 bg-white/5 rounded-lg">
              <div className="grid grid-cols-4 gap-2 mb-2">
                {pendingPhotos.map((p, i) => (
                  <div key={i} className="w-16 h-16 rounded-md overflow-hidden bg-black/5">
                    <img src={p.dataUrl} alt={p.name} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>

              <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption (optional)..." className="w-full p-2 rounded border border-gray-200 mb-2 text-black" />

              <div className="flex gap-2">
                <button onClick={() => { setPendingPhotos([]); setCaption(""); }} className="px-3 py-1 rounded bg-white/10 text-sm text-red-500">Cancel</button>
                <button onClick={() => send()} className="ml-auto px-4 py-1 rounded bg-blue-500 text-blue-500">Send {pendingPhotos.length > 1 ? `(${pendingPhotos.length})` : ""}</button>
              </div>
            </div>
          ) : (
            <div className="relative w-full flex items-center">
              <svg onClick={handleFileInputClick} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700" title="Attach File">
                <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 015 5l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.49" />
              </svg>

              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." className="flex-1 p-3 pl-10 pr-10 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2" onKeyDown={(e) => { if (e.key === "Enter") send(); }} />

              <svg onClick={send} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 text-blue-500 cursor-pointer hover:text-blue-700" title="Send">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </div>
          )}
        </footer>
      </div>

      {/* Leave confirmation modal */}
      {confirmLeaveOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={handleCancelLeave} />
          <div className="relative bg-white/10 p-6 rounded-lg backdrop-blur text-white w-80">
            <h3 className="text-lg font-bold mb-2">Leave Hub?</h3>
            <p className="text-sm text-white/80 mb-4">Leaving will clear your local chat history. Are you sure?</p>
            <div className="flex justify-center gap-2">
              <button onClick={handleCancelLeave} className="px-3 py-2 rounded bg-gradient-to-br from-green-500 to-green-600 text-white">Cancel</button>
              <button onClick={handleConfirmLeave} className="px-3 py-2 rounded bg-gradient-to-br from-red-500 to-red-600 text-white">Leave & Clear</button>
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
