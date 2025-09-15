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

// src/components/Chat.jsx
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
//           expiresAt: Date.now() + 10000,
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
//     }, 10000);
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

// Round Video Streaming

// src/components/Chat.jsx
import "./App.css";
import React, { useEffect, useState, useRef } from "react";
import CircularStream from "./CircularStream"; // adjust path if your CircularStream is in same folder use "./CircularStream"
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

const LS_MSGS = "ph_msgs_v1";
const MAX_MSGS = 100;

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

  // file transfer
  const [incomingFileOffers, setIncomingFileOffers] = useState({});
  const [transfers, setTransfers] = useState({}); // offerId -> { direction, label, total, transferred, peers }
  const saveHandlesRef = useRef({});
  const fileWriteStatusRef = useRef({});
  const outgoingPendingOffers = useRef({}); // kept for compatibility

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

  // typing
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const typingTimeoutRef = useRef(null);

  // refs
  const messagesEndRef = useRef(null);
  const seenSystemIdsRef = useRef(new Set());
  const peerRef = useRef(null);
  const menuRef = useRef(null);
  const createdUrlsRef = useRef(new Set());
  const incomingBuffersRef = useRef({}); // offerId -> { chunks: [], bytes: number }

  // center preview modal
  const [centerPreviewOpen, setCenterPreviewOpen] = useState(false);
  const [centerPreviewUrl, setCenterPreviewUrl] = useState(null);

  // notifications permission on username set
  useEffect(() => {
    if (!username) return;
    requestNotificationPermission();
  }, [username]);

  // persist messages helper — remove transient fileUrl before saving
  const persistMessages = (arr) => {
    try {
      const tail = arr.slice(-MAX_MSGS).map((m) => {
        const copy = { ...m };
        if (copy.fileUrl) delete copy.fileUrl;
        return copy;
      });
      localStorage.setItem(LS_MSGS, JSON.stringify(tail));
    } catch (e) {}
  };

  // add/update chat
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

  // transfer helpers (same as before)
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

  // IndexedDB helpers for persisting files
  const saveBlob = (id, blob) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("peershub_files_v1", 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore("files");
        } catch (e) {}
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target?.error || e);
      };
      req.onerror = (e) => reject(e.target?.error || e);
    });
  };

  const getBlob = (id) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("peershub_files_v1", 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore("files");
        } catch (e) {}
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("files", "readonly");
        const get = tx.objectStore("files").get(id);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = (e) => reject(e.target?.error || e);
      };
      req.onerror = (e) => reject(e.target?.error || e);
    });
  };

  // hydrate persisted file blobs (run once on mount) — improved: create objectURLs on demand for messages with fileId
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // iterate over file messages and ensure fileUrl present in state when we have the blob
        const fileMsgs = messages.filter((x) => x.type === "file" && x.fileId);
        for (const fm of fileMsgs) {
          if (!mounted) return;
          // if a runtime fileUrl already exists in state, skip
          if (fm.fileUrl) continue;
          try {
            const blob = await getBlob(fm.fileId);
            if (!mounted) return;
            if (blob) {
              const url = URL.createObjectURL(blob);
              createdUrlsRef.current.add(url);
              setMessages((prev) => {
                const next = prev.map((m) =>
                  m.id === fm.id ? { ...m, fileUrl: url } : m
                );
                // persistMessages strips fileUrl for storage so no change to persisted data
                persistMessages(next);
                return next;
              });
            }
          } catch (e) {
            // ignore missing blobs (they may not have been persisted)
            // console.warn("hydrate blob failed for", fm.fileId, e);
          }
        }
      } catch (e) {
        console.warn("Hydration error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // handle incoming file chunk and write to disk using saved handle
  // handle incoming file chunk and write to disk using saved handle
  const handleIncomingFileChunk = async (data) => {
    // defensive: some runtimes wrap chunk under .data (PeerJS / structured clone variants)
    let { id: offerId, seq, chunk, final } = data || {};
    try {
      // unwrap wrapper if necessary (common PeerJS quirk)
      if (
        chunk &&
        chunk.data &&
        (chunk.data instanceof ArrayBuffer ||
          ArrayBuffer.isView(chunk.data) ||
          chunk.data instanceof Blob)
      ) {
        chunk = chunk.data;
      }

      // If we have a FileSystem writable for this offer => write directly (preferred)
      const writer = saveHandlesRef.current[offerId];
      if (writer) {
        // chunk may be Blob, ArrayBuffer, or TypedArray
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
        } else if (chunk == null && final) {
          // some senders send a final marker with null chunk — ignore here (closing handled below)
        } else {
          console.warn("Unknown chunk type for offer", offerId, seq, chunk);
        }

        // update receiver progress entry
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
          // mark 100% and schedule clean
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
          // cleanup
          delete saveHandlesRef.current[offerId];
          delete fileWriteStatusRef.current[offerId];

          // notify UI + persist nothing more (file is on disk)
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
        return;
      }

      // ------- Fallback buffering path (no writable) -------
      // Buffer chunks in-memory for this offerId
      if (!incomingBuffersRef.current[offerId]) {
        incomingBuffersRef.current[offerId] = { chunks: [], bytes: 0 };
      }
      const bufEntry = incomingBuffersRef.current[offerId];

      if (chunk instanceof Blob) {
        bufEntry.chunks.push(chunk);
        bufEntry.bytes += chunk.size || 0;
      } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
        const blobPart =
          chunk instanceof ArrayBuffer
            ? new Blob([chunk])
            : new Blob([chunk.buffer || chunk]);
        bufEntry.chunks.push(blobPart);
        bufEntry.bytes += blobPart.size || 0;
      } else if (chunk == null && !final) {
        // ignore unexpected nulls
      } else {
        // unknown chunk type — log and skip
        console.warn(
          "Unknown chunk type (buffer fallback) for offer",
          offerId,
          seq,
          chunk
        );
      }

      // update progress UI based on buffered bytes
      setTransfer(offerId, (prev) => {
        const total = prev?.total || 0;
        const transferred = bufEntry.bytes || prev?.transferred || 0;
        return {
          ...prev,
          total,
          transferred,
          direction: prev?.direction || "receiving",
        };
      });

      // when final chunk arrives, assemble Blob, persist, and create message
      if (final) {
        try {
          const assembled = new Blob(bufEntry.chunks, {
            type: bufEntry.chunks[0]?.type || "application/octet-stream",
          });
          // persist into IndexedDB using your saveBlob helper so it survives refresh
          try {
            await saveBlob(offerId, assembled);
          } catch (e) {
            console.warn("saveBlob (fallback) failed for", offerId, e);
          }

          // create a preview URL and message for UI
          try {
            const previewUrl = URL.createObjectURL(assembled);
            // register created URL so we can revoke it later
            createdUrlsRef.current.add(previewUrl);

            setMessages((m) => {
              // avoid duplicating message if already present
              const exists = m.find((x) => x.id === offerId);
              if (exists) {
                // update fileUrl if missing
                const next = m.map((x) =>
                  x.id === offerId ? { ...x, fileUrl: previewUrl } : x
                );
                persistMessages(next);
                return next;
              }
              const sysMsg = {
                id: offerId,
                type: "file",
                from: "peer",
                fromId: null,
                fromName: "peer",
                fileName: `file-${offerId}`,
                fileSize: assembled.size || 0,
                fileType: assembled.type || "video/webm",
                fileId: offerId,
                fileUrl: previewUrl,
                ts: Date.now(),
                deliveries: [],
                reads: [],
              };
              const next = [...m, sysMsg];
              persistMessages(next);
              return next;
            });

            // final transfer UI update
            setTransfer(offerId, (prev) => ({
              ...prev,
              transferred: bufEntry.bytes || prev?.transferred || 0,
            }));
            setTimeout(() => removeTransfer(offerId), 1200);
          } catch (e) {
            console.warn("preview creation after assembly failed", e);
          }
        } catch (e) {
          console.warn(
            "Error assembling buffered chunks for offer",
            offerId,
            e
          );
          setMessages((m) => {
            const sys = {
              id: `sys-file-error-${offerId}-${Date.now()}`,
              from: "System",
              text: `Error assembling received file: ${e.message || e}`,
              ts: Date.now(),
              type: "system",
            };
            const next = [...m, sys];
            persistMessages(next);
            return next;
          });
        } finally {
          // cleanup buffer entry
          try {
            delete incomingBuffersRef.current[offerId];
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn("handleIncomingFileChunk error (outer)", e);
      setMessages((m) => {
        const sys = {
          id: `sys-file-error-${Date.now()}`,
          from: "System",
          text: `Error processing incoming file chunk: ${e.message || e}`,
          ts: Date.now(),
          type: "system",
        };
        const next = [...m, sys];
        persistMessages(next);
        return next;
      });
      // best-effort cleanup
      try {
        delete incomingBuffersRef.current[offerId];
      } catch (er) {}
      try {
        delete fileWriteStatusRef.current[offerId];
      } catch (er) {}
      try {
        delete saveHandlesRef.current[offerId];
      } catch (er) {}
    }
  };

  // incoming messages callback from webrtc
  const handleIncoming = async (from, payloadOrText) => {
    // typing
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

    // system messages
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

    // file offer received -> UI prompt (we still support offers from others)
    if (from === "__system_file_offer__" && payloadOrText) {
      const offer = payloadOrText;
      const offerId =
        offer.id ||
        `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setIncomingFileOffers((s) => {
        const copy = { ...s };
        copy[offerId] = {
          offer,
          expiresAt: Date.now() + 10000,
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
      }, 10000);

      maybeNotify(
        peerNamesMap[offer.from] || offer.from,
        `File offer: ${offer.name}`
      );
      return;
    }

    // file offer response (sender receives accepts)
    if (from === "__system_file_offer_response__" && payloadOrText) {
      const { id: offerId, from: responder, accept } = payloadOrText;
      try {
        if (!outgoingPendingOffers.current[offerId]) return;
        if (accept) {
          outgoingPendingOffers.current[offerId].acceptingPeers.add(responder);
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
        console.warn("file_offer_response handling failed", e);
      }
      return;
    }

    // file chunk
    if (from === "__system_file_chunk__" && payloadOrText) {
      await handleIncomingFileChunk(payloadOrText);
      return;
    }

    // file transfer done/cancel
    if (from === "__system_file_transfer_done__" && payloadOrText) {
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

      try {
        const origin = payloadOrText.from || payloadOrText.origin || null;
        const localId = getLocalPeerId() || myId;
        if (
          origin &&
          origin !== localId &&
          document.visibilityState === "visible"
        ) {
          try {
            sendAckRead(payloadOrText.id, origin);
          } catch (e) {}
          addUniqueToMsgArray(payloadOrText.id, "reads", localId);
        }
      } catch (e) {}
      return;
    }

    // string fallback
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

  // peer list update
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

  // init peer
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

  // hydrate persisted file blobs (run once on mount)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const fileMsgs = messages.filter(
          (x) => x.type === "file" && x.fileId && !x.fileUrl
        );
        for (const fm of fileMsgs) {
          try {
            const blob = await getBlob(fm.fileId);
            if (!mounted) return;
            if (blob) {
              const url = URL.createObjectURL(blob);
              createdUrlsRef.current.add(url);
              setMessages((prev) => {
                const next = prev.map((m) =>
                  m.id === fm.id ? { ...m, fileUrl: url } : m
                );
                return next;
              });
            }
          } catch (e) {
            // ignore missing blobs
          }
        }
      } catch (e) {}
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      try {
        // copy to array to avoid surprises if something mutates the Set during iteration
        const urls = Array.from(createdUrlsRef.current || []);
        for (const u of urls) {
          try {
            URL.revokeObjectURL(u);
          } catch (e) {
            // ignore
          }
        }
        // clear the set
        createdUrlsRef.current && createdUrlsRef.current.clear();
      } catch (e) {
        // ignore
      }
    };
  }, []);

  // visibility ack_read
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

  // typing broadcast
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

  // create hub
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
      console.warn("sendChat failed", e);
    }
    setText("");
    setReplyTo(null);
  };

  // reply + send ack_read
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
        addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId);
      } catch (e) {
        console.warn("sendAckRead error", e);
      }
    }
  };

  // render status dot
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

    return (
      <span className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2" />
    );
  };

  // message renderer with click opening center preview for files
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
          <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm max-w-[80%] whitespace-normal break-words">
            {m.text}
          </div>
        </div>
      );
    }

    if (m.type === "file") {
      const fileType = m.fileType || "application/octet-stream";
      const isVideo = fileType.startsWith("video/");
      const url = m.fileUrl || null;

      // fixed pixel size avoids tailwind/responsive quirks; change to match your UI
      const thumbPx = 96;

      return (
        <div
          onClick={() => openCenterPreview(m)}
          key={`${m.id ?? m.ts}-${idx}`}
          className={`group p-2 rounded-2xl max-w-[50%] mb-2 cursor-pointer ${
            isMe ? "ml-auto bg-blue-500 text-white" : "bg-white/100 text-black"
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openCenterPreview(m);
            }
          }}
          aria-label={
            isVideo
              ? `Open video ${m.fileName || ""}`
              : `Open file ${m.fileName || ""}`
          }
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          <div className="text-xs font-bold flex items-center">
            <div className="flex-1">{isMe ? "You" : from}</div>
            <div className="text-[10px] text-gray-700/70 ml-2">{time}</div>
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

          <div className="mt-2 flex items-center">
            {isVideo ? (
              <div
                // inline style is deliberate: beats global overrides and ensures exact shape/size
                style={{
                  borderRadius: "9999px",
                  overflow: "hidden",
                  width: thumbPx,
                  height: thumbPx,
                  minWidth: thumbPx,
                  minHeight: thumbPx,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.08)",
                  flexShrink: 0,
                  position: "relative",
                }}
                className="flex-shrink-0"
              >
                {url ? (
                  <video
                    controls
                    playsInline
                    src={url}
                    // force cover and ensure the element doesn't show square corners
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      borderRadius: "0", // wrapper handles clipping
                    }}
                    className="block"
                    aria-label={m.fileName || "video message"}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-black/20 text-xs text-white/80">
                    Loading…
                  </div>
                )}

                {/* subtle play overlay — pointer-events none so click goes through to openCenterPreview */}
                <div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  aria-hidden="true"
                >
                  <div
                    style={{ width: 40, height: 40, borderRadius: 9999 }}
                    className="bg-black/30 transition-opacity duration-200 opacity-60 group-hover:opacity-80"
                  />
                  <svg
                    style={{ width: 20, height: 20 }}
                    className="absolute text-white drop-shadow-md transition-transform duration-200 transform scale-95 group-hover:scale-100"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="break-words">{m.fileName || m.text}</div>
            )}

            <div className="ml-3 text-xs text-gray-500">
              <div>{m.fileName || ""}</div>
              <div>
                {m.fileSize ? `${Math.round(m.fileSize / 1024)} KB` : ""}
              </div>
            </div>
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

  // ---------- NEW: onFileSelected that supports directSend=true to stream immediately ----------
  // - If directSend=true: stream to ALL connected peers immediately using startSendingFile()
  // - If directSend=false: fallback to original offer flow (offerFileToPeers)
  const onFileSelected = async (file, opts = { directSend: false }) => {
    if (!file) return;
    const offerId = `offer-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    // store in outgoing pending map for backward compatibility / debug
    outgoingPendingOffers.current[offerId] = {
      file,
      acceptingPeers: new Set(),
    };

    // init sender UI entry
    setTransfer(offerId, {
      direction: "sending",
      label: file.name,
      total: file.size || 0,
      transferred: 0,
      peers: [],
    });

    // persist to IDB (so video stays after refresh)
    try {
      await saveBlob(offerId, file);
    } catch (e) {
      console.warn("saveBlob failed", e);
    }

    // create local preview URL and add file message immediately
    try {
      const previewUrl = URL.createObjectURL(file);
      createdUrlsRef.current.add(previewUrl);

      const msg = {
        id: offerId,
        type: "file",
        from: getLocalPeerId() || myId,
        fromName: username,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || "application/octet-stream",
        fileId: offerId,
        fileUrl: previewUrl,
        ts: Date.now(),
        deliveries: [],
        reads: [getLocalPeerId() || myId],
      };
      setMessages((m) => {
        const next = [...m, msg];
        persistMessages(next);
        return next;
      });
    } catch (e) {
      console.warn("preview creation failed", e);
    }

    if (opts.directSend) {
      // Direct-send path: stream immediately to all connected peers
      try {
        const targetPeers = Array.isArray(peers) ? [...peers] : [];
        if (targetPeers.length === 0) {
          setMessages((m) => {
            const sys = {
              id: `sys-offer-local-${offerId}`,
              from: "System",
              text: `No connected peers — saved locally: ${file.name}`,
              ts: Date.now(),
              type: "system",
            };
            const next = [...m, sys];
            persistMessages(next);
            return next;
          });
          return;
        }

        try {
          // start sending file to each peer
          startSendingFile(file, offerId, targetPeers);
        } catch (e) {
          console.warn("startSendingFile failed", e);
        }

        // optional system message for UI
        setMessages((m) => {
          const sys = {
            id: `sys-send-${offerId}`,
            from: "System",
            text: `Sending video to ${targetPeers.length} peer(s): ${file.name}`,
            ts: Date.now(),
            type: "system",
          };
          const next = [...m, sys];
          persistMessages(next);
          return next;
        });
      } catch (e) {
        console.warn("direct send failed", e);
      }
      return;
    }

    // Fallback: original offer flow (if directSend not requested)
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
        text: `Offered file: ${file.name} (${Math.round(file.size / 1024)} KB)`,
        ts: Date.now(),
        type: "system",
      };
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });

    // cleanup if nobody accepts after 10s (keeps compatibility)
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
    }, 10000);
  };

  // helper to open center preview for a message (file message)
  // helper to open center preview for a message (file message)
  const openCenterPreview = async (msg) => {
    try {
      // If message references an ID in IDB, prefer to load the blob fresh (this avoids using a revoked URL)
      if (msg.fileId) {
        try {
          const blob = await getBlob(msg.fileId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            createdUrlsRef.current.add(url);

            // update message in-memory to carry the runtime fileUrl (persistMessages will strip fileUrl)
            setMessages((m) => {
              const next = m.map((x) =>
                x.id === msg.id ? { ...x, fileUrl: url } : x
              );
              persistMessages(next);
              return next;
            });

            setCenterPreviewUrl(url);
            setCenterPreviewOpen(true);
            return;
          }
        } catch (e) {
          console.warn("openCenterPreview: failed to load blob from IDB", e);
          // fallthrough to try existing fileUrl
        }
      }

      // fallback: if a runtime fileUrl is present on the message, use it
      if (msg.fileUrl) {
        setCenterPreviewUrl(msg.fileUrl);
        setCenterPreviewOpen(true);
        return;
      }

      // No file available: show helpful system message
      setMessages((m) => {
        const sys = {
          id: `sys-missing-${msg.id}-${Date.now()}`,
          from: "System",
          text: "Preview not available (file not stored locally).",
          ts: Date.now(),
          type: "system",
        };
        const next = [...m, sys];
        persistMessages(next);
        return next;
      });
    } catch (e) {
      console.warn("openCenterPreview error", e);
    }
  };

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

  // wire up progress/completion callbacks exported by webrtc.js
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

  // connected peer names
  const connectedNames = peers.length
    ? peers.map((id) => peerNamesMap[id] || id)
    : [];

  const typingSummary = () => {
    const names = Object.keys(typingUsers);
    if (!names.length) return null;
    const shown = names.slice(0, 2).join(", ");
    return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
  };

  const renderIncomingFileOffers = () => {
    const keys = Object.keys(incomingFileOffers);
    if (!keys.length) return null;
    return keys.map((k) => {
      const entry = incomingFileOffers[k];
      const offer = entry.offer;
      const remaining = Math.max(
        0,
        Math.ceil((entry.expiresAt - Date.now()) / 1000)
      );
      return (
        <div
          key={k}
          className="mb-2 p-2 rounded bg-white/10 text-sm text-black"
        >
          <div className="font-semibold">
            <span className="inline-block max-w-[260px] whitespace-normal break-words">
              File offer:&nbsp;{" "}
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

  // accept incoming offer -> ask where to save and respond true
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

  // show centered preview modal
  const closeCenterPreview = () => {
    // Do NOT revoke the URL here. We will revoke all created URLs on unmount cleanup.
    setCenterPreviewOpen(false);
    setCenterPreviewUrl(null);
  };

  // wire up progress/completion callbacks (already done above)

  // UI rendering
  // This should be inside your Chat component function
  return (
    <>
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

      <div className="h-[92vh] md:h-[92vh] max-w-[420px] w-full mx-auto bg-gray-50 text-purple-600 p-6 flex flex-col rounded-4xl">
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

          {/* Improved input container layout */}
          <div className="relative w-full flex items-center gap-2">
            {/* Left side controls container */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Circular video-record button */}
              <div className="relative">
                <CircularStream
                  onFileRecorded={(file) =>
                    onFileSelected(file, { directSend: true })
                  }
                  buttonClassName="w-10 h-10 flex items-center justify-center flex-shrink-0"
                />
              </div>

              {/* File attachment button */}
              <button
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.onchange = (e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) onFileSelected(f, { directSend: false });
                  };
                  input.click();
                }}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-blue-500 hover:text-blue-600 transition-all duration-200 flex-shrink-0"
                title="Attach File"
                aria-label="Attach File"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5"
                >
                  <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 015 5l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.49" />
                </svg>
              </button>
            </div>

            {/* Text input - flex-1 takes remaining space */}
            <div className="relative flex-1">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message..."
                className="w-full p-3 pr-12 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2 border-white/20 focus:border-blue-400 focus:outline-none transition-colors duration-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
              />

              {/* Send button inside input */}
              <button
                onClick={send}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-blue-500 hover:text-blue-600 hover:bg-white/10 transition-all duration-200"
                title="Send"
                aria-label="Send message"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
        </footer>
      </div>

      {/* Enhanced video preview modal */}
      {centerPreviewOpen && centerPreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-4xl mx-auto">
            {/* Close button */}
            <button
              onClick={closeCenterPreview}
              aria-label="Close preview"
              className="absolute -top-12 right-0 z-10 text-white hover:text-gray-300 bg-black/50 hover:bg-black/70 p-3 rounded-full transition-all duration-200 backdrop-blur-sm"
              title="Close preview"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* Video container */}
            <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl">
              <video
                src={centerPreviewUrl}
                controls
                autoPlay
                playsInline
                className="w-full h-auto max-h-[80vh] object-contain"
                onLoadedMetadata={(e) => {
                  // Auto-focus the video for better UX
                  e.target.focus();
                }}
              />
            </div>
          </div>

          {/* Click outside to close */}
          <div
            className="absolute inset-0 -z-10"
            onClick={closeCenterPreview}
            aria-label="Click to close preview"
          />
        </div>
      )}

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
