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
import React, { useEffect, useRef, useState } from "react";
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
} from "./webrtc";
import { requestNotificationPermission, showNotification } from "./notify";
import { nanoid } from "nanoid";

/*
  Chat.jsx
  - long-press clip -> record video (3s threshold). live circular thumbnail while recording.
  - recordings sent inline to everyone (via sendChat with Blob attached).
  - file offers flow preserved for arbitrary files (offer/accept).
  - floating progress bars on top for active transfers (sender & receiver).
*/

const LS_MSGS = "ph_msgs_v1";
const MAX_MSGS = 100;
const RECORD_PRESS_MS = 3000;
const MAX_RECORD_SECONDS = 30;

export default function Chat() {
  // identity / peers
  const [myId, setMyId] = useState(() => getLocalPeerId() || "...");
  const [peers, setPeers] = useState([]);
  const [peerNamesMap, setPeerNamesMap] = useState({});

  // messages
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_MSGS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  });

  // UI / input
  const [text, setText] = useState("");
  const [username, setUsername] = useState(
    () => localStorage.getItem("ph_name") || ""
  );
  const [showNamePrompt, setShowNamePrompt] = useState(
    () => !localStorage.getItem("ph_name")
  );

  // hub join state
  const [joinedBootstrap, setJoinedBootstrap] = useState(() => {
    const id = localStorage.getItem("ph_hub_bootstrap") || "";
    const should = localStorage.getItem("ph_should_autojoin") === "true";
    return should ? id : "";
  });

  // UI elements
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  // typing & reply
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo] = useState(null);

  // file offers and save handles
  const [incomingFileOffers, setIncomingFileOffers] = useState({});
  const saveHandlesRef = useRef({});
  const fileWriteStatusRef = useRef({}); // offerId -> bytesReceived
  const outgoingPendingOffers = useRef({}); // offerId -> { file, acceptingPeers:Set }

  // transfers map for progress UI (both sender & receiver)
  // shape: { [offerIdOrMsgId]: { label, name, transferred, total, ts } }
  const [transfers, setTransfers] = useState({});

  // refs & timers
  const messagesEndRef = useRef(null);
  const seenSystemIdsRef = useRef(new Set());
  const peerRef = useRef(null);
  const menuRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // recording refs/state
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordPressTimerRef = useRef(null);
  const recordTimerRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordRemaining, setRecordRemaining] = useState(MAX_RECORD_SECONDS);
  const previewVideoRef = useRef(null); // live preview element

  // helper: format bytes adaptively (KB / MB)
  const formatBytesAdaptive = (bytes, decimals = 2) => {
    if (bytes == null || isNaN(bytes)) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(decimals)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(decimals)} MB`;
  };

  // request notification permission once username set
  useEffect(() => {
    if (!username) return;
    requestNotificationPermission();
  }, [username]);

  // persist messages
  const persistMessages = (arr) => {
    try {
      const tail = arr.slice(-MAX_MSGS);
      localStorage.setItem(LS_MSGS, JSON.stringify(tail));
    } catch (e) {}
  };

  // add/merge chat message
  const upsertIncomingChat = (incoming) => {
    setMessages((m) => {
      const exists = m.find((x) => x.id === incoming.id);
      if (exists) {
        const next = m.map((x) => (x.id === incoming.id ? { ...x, ...incoming } : x));
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
        media: incoming.media || null,
      };
      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });
  };

  // add unique id to deliveries/reads
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

  // transfers helpers
  const setTransfer = (id, patchOrFn) => {
    setTransfers((prev) => {
      const copy = { ...prev };
      const cur = copy[id] || {};
      const next = typeof patchOrFn === "function" ? patchOrFn(cur) : { ...cur, ...patchOrFn };
      copy[id] = { ...cur, ...next };
      return copy;
    });
  };

  const removeTransfer = (id) => {
    setTransfers((t) => {
      const copy = { ...t };
      delete copy[id];
      return copy;
    });
  };

  // handle incoming file chunk and write to disk using saved handle
  const handleIncomingFileChunk = async (data) => {
    // defensive unwraps for PeerJS wrapper variants
    let { id: offerId, seq, chunk, final } = data || {};
    try {
      // some runtimes wrap chunk under .data
      if (chunk && chunk.data && (chunk.data instanceof ArrayBuffer || ArrayBuffer.isView(chunk.data) || chunk.data instanceof Blob)) {
        chunk = chunk.data;
      }

      const writer = saveHandlesRef.current[offerId];
      if (!writer) {
        console.warn("No writable for offer", offerId, "— ignoring chunk", seq);
        return;
      }

      // chunk may be Blob, ArrayBuffer, or TypedArray
      if (chunk instanceof Blob) {
        await writer.write(chunk);
        fileWriteStatusRef.current[offerId] = (fileWriteStatusRef.current[offerId] || 0) + (chunk.size || 0);
      } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
        const buf = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : new Uint8Array(chunk.buffer || chunk);
        await writer.write(buf);
        fileWriteStatusRef.current[offerId] = (fileWriteStatusRef.current[offerId] || 0) + buf.byteLength;
      } else {
        console.warn("Unknown chunk type for offer", offerId, seq, chunk);
      }

      // update receiver progress UI if we have total known
      const meta = incomingFileOffers[offerId] && incomingFileOffers[offerId].offer;
      if (meta && meta.size) {
        setTransfer(offerId, (prev) => ({
          name: meta.name,
          label: "Receiving",
          transferred: fileWriteStatusRef.current[offerId] || 0,
          total: meta.size,
          ts: Date.now(),
        }));
      }

      if (final) {
        try {
          await writer.close();
        } catch (e) {
          console.warn("Error closing writer for offer", offerId, e);
        }

        // finalize receiver transfer UI -> 100%
        try {
          setTransfer(offerId, (prev) => ({
            ...(prev || {}),
            transferred: (prev && prev.total) || fileWriteStatusRef.current[offerId] || 0,
          }));
          setTimeout(() => removeTransfer(offerId), 1500);
        } catch (e) {}

        // cleanup
        delete saveHandlesRef.current[offerId];
        delete fileWriteStatusRef.current[offerId];
        setIncomingFileOffers((s) => {
          const cp = { ...s };
          delete cp[offerId];
          return cp;
        });

        // notify user in UI (append system message)
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

      // cleanup UI record & handle
      try { removeTransfer(offerId); } catch (_) {}
      try {
        if (saveHandlesRef.current[offerId]) {
          try { await saveHandlesRef.current[offerId].close(); } catch (_) {}
          delete saveHandlesRef.current[offerId];
        }
      } catch (_) {}
    }
  };

  // incoming message handler
  const handleIncoming = async (from, payloadOrText) => {
    // typing
    if (from === "__system_typing__" && payloadOrText && payloadOrText.fromName) {
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
    if (from === "__system_ack_deliver__" && payloadOrText && payloadOrText.id) {
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

    // file offer (receiver)
    if (from === "__system_file_offer__" && payloadOrText) {
      const offer = payloadOrText;
      const offerId = offer.id || `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setIncomingFileOffers((s) => {
        const copy = { ...s };
        copy[offerId] = { offer, expiresAt: Date.now() + 10000, origin: offer.from };
        return copy;
      });

      // add transfer placeholder (receiver) with known total if present
      setTransfer(offerId, { name: offer.name, label: "Offered", transferred: 0, total: offer.size || null, ts: Date.now() });

      // auto-expire after 10s (ignore)
      setTimeout(() => {
        setIncomingFileOffers((s) => {
          const copy = { ...s };
          if (!copy[offerId]) return s;
          try { respondToFileOffer(offerId, offer.from, false); } catch (e) {}
          delete copy[offerId];
          removeTransfer(offerId);
          return copy;
        });
      }, 10000);

      maybeNotify(peerNamesMap[offer.from] || offer.from, `File offer: ${offer.name}`);
      return;
    }

    // file offer response (sender receives who accepted)
    if (from === "__system_file_offer_response__" && payloadOrText) {
      const { id: offerId, from: responder, accept } = payloadOrText;
      try {
        const pending = outgoingPendingOffers.current[offerId];
        if (!pending) return;
        if (accept) {
          pending.acceptingPeers.add(responder);
          // create/update sender transfer UI
          setTransfer(offerId, (prev) => ({
            ...(prev || {}),
            name: pending.file.name,
            label: "Sending",
            transferred: prev?.transferred || 0,
            total: pending.file.size || 0,
            ts: Date.now(),
          }));
          // trigger sending to that peer only (webrtc handles stream)
          try {
            startSendingFile(pending.file, offerId, [responder]);
          } catch (e) {
            console.warn("startSendingFile failed", e);
          }
        } else {
          // if nobody accepted after some time, we will cleanup elsewhere
        }
      } catch (e) {
        console.warn("file_offer_response handling failed", e);
      }
      return;
    }

    // file chunk (receiver)
    if (from === "__system_file_chunk__" && payloadOrText) {
      await handleIncomingFileChunk(payloadOrText);
      return;
    }

    // file transfer done/cancel
    if (from === "__system_file_transfer_done__" && payloadOrText) {
      const { id: offerId } = payloadOrText;
      // mark sender-side transfer complete (someone reported done)
      setTransfer(offerId, (prev) => ({ ...(prev || {}), transferred: prev?.total || prev?.transferred || 0 }));
      setTimeout(() => removeTransfer(offerId), 1500);

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

    // chat object (including media/blobs)
    if (payloadOrText && typeof payloadOrText === "object" && payloadOrText.type === "chat" && payloadOrText.id) {
      // If media Blob present, ensure it has url property (create objectURL for blob for playback)
      if (payloadOrText.media && payloadOrText.media.blob && !payloadOrText.media.url) {
        try {
          payloadOrText.media.url = URL.createObjectURL(payloadOrText.media.blob);
        } catch (e) {
          console.warn("createObjectURL for received blob failed", e);
        }
      }
      upsertIncomingChat(payloadOrText);
      maybeNotify(payloadOrText.fromName || payloadOrText.from, payloadOrText.text);

      // auto-ack read if visible
      try {
        const origin = payloadOrText.from || payloadOrText.origin || null;
        const localId = getLocalPeerId() || myId;
        if (origin && origin !== localId && document.visibilityState === "visible") {
          try {
            sendAckRead(payloadOrText.id, origin);
          } catch (e) { console.warn("sendAckRead error (auto on receive):", e); }
          addUniqueToMsgArray(payloadOrText.id, "reads", localId);
        }
      } catch (e) { console.warn("auto ack_read failed", e); }

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

  // helper to show notifications
  const maybeNotify = (fromDisplay, text) => {
    try {
      if (!fromDisplay || fromDisplay === username) return;
      if (!document.hidden && document.hasFocus()) return;
      const title = `${fromDisplay}`;
      const body = typeof text === "string" ? (text.length > 120 ? text.slice(0, 117) + "..." : text) : JSON.stringify(text);
      showNotification(title, { body, tag: `peershub-${fromDisplay}`, data: { from: fromDisplay } });
    } catch (e) { console.warn("maybeNotify error", e); }
  };

  // peer list update
  const handlePeerListUpdate = (list) => {
    setPeers(list || []);
    try {
      const names = getPeerNames();
      setPeerNamesMap(names || {});
    } catch (e) {}
  };

  // bootstrap change
  const handleBootstrapChange = (newBootstrapId) => {
    setJoinedBootstrap(newBootstrapId || "");
  };

  // init peer when username available
  useEffect(() => {
    if (!username) return;
    const p = initPeer(handleIncoming, handlePeerListUpdate, username, handleBootstrapChange);
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
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // typing broadcast (debounced)
  useEffect(() => {
    if (!username) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    try { if (typeof sendTyping === "function") sendTyping(username, true); } catch (e) {}
    typingTimeoutRef.current = setTimeout(() => {
      try { if (typeof sendTyping === "function") sendTyping(username, false); } catch (e) {}
    }, 1200);
    return () => clearTimeout(typingTimeoutRef.current);
  }, [text, username]);

  // send chat text (non-media)
  const send = () => {
    if (!text.trim()) return;
    const id = nanoid();
    const msgObj = {
      id,
      from: getLocalPeerId() || myId,
      fromName: username,
      text: text.trim(),
      ts: Date.now(),
      replyTo: replyTo ? { id: replyTo.id, from: replyTo.from, text: replyTo.text } : null,
      deliveries: [],
      reads: [getLocalPeerId() || myId],
    };
    setMessages((m) => {
      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });
    try { sendChat(msgObj); } catch (e) { console.warn("sendChat failed", e); }
    setText("");
    setReplyTo(null);
  };

  // file input (regular attachments)
  const handleFileInputClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) onFileSelected(f);
    };
    input.click();
  };

  const onFileSelected = (file) => {
    if (!file) return;
    const offerId = `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    outgoingPendingOffers.current[offerId] = { file, acceptingPeers: new Set() };
    const meta = { id: offerId, name: file.name, size: file.size, mime: file.type, from: getLocalPeerId() || myId };
    try { offerFileToPeers(meta); } catch (e) { console.warn("offerFileToPeers failed", e); }

    // local system message
    setMessages((m) => {
      const sys = { id: `sys-offer-${offerId}`, from: "System", text: `Offered file: ${file.name} (${formatBytesAdaptive(file.size)})`, ts: Date.now(), type: "system" };
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });

    // create sender transfer entry (waiting)
    setTransfer(offerId, { name: file.name, label: "Offered", transferred: 0, total: file.size, ts: Date.now() });

    // cleanup after 10s if nobody accepted
    setTimeout(() => {
      try {
        const pending = outgoingPendingOffers.current[offerId];
        if (!pending) return;
        if (pending.acceptingPeers.size === 0) {
          setMessages((m) => {
            const sys = { id: `sys-offer-expire-${offerId}`, from: "System", text: `No one accepted the file: ${file.name}`, ts: Date.now(), type: "system" };
            const next = [...m, sys];
            persistMessages(next);
            return next;
          });
          removeTransfer(offerId);
          delete outgoingPendingOffers.current[offerId];
        }
      } catch (e) { console.warn("post-offer cleanup failed", e); }
    }, 10000);
  };

  // accept incoming file offer: prompt save location then respond
  const acceptFileOffer = async (offerId) => {
    const entry = incomingFileOffers[offerId];
    if (!entry) return;
    const { offer } = entry;
    try {
      if (supportsNativeFileSystem()) {
        const opts = {
          suggestedName: offer.name,
          types: [{
            description: offer.mime || "file",
            accept: { [offer.mime || "application/octet-stream"]: [ "." + (offer.name.split(".").pop() || "") ] }
          }]
        };
        const handle = await (window.showSaveFilePicker ? window.showSaveFilePicker(opts) : (window.chooseFileSystemEntries ? window.chooseFileSystemEntries({ type: "save-file", accepts: opts.types }) : null));
        if (!handle) {
          respondToFileOffer(offerId, offer.from, false);
          setIncomingFileOffers((s) => { const c = { ...s }; delete c[offerId]; return c; });
          removeTransfer(offerId);
          return;
        }
        const writable = await handle.createWritable();
        saveHandlesRef.current[offerId] = writable;
        fileWriteStatusRef.current[offerId] = 0;
        respondToFileOffer(offerId, offer.from, true);
        setIncomingFileOffers((s) => { const c = { ...s }; delete c[offerId]; return c; });
        setMessages((m) => {
          const sys = { id: `sys-accept-${offerId}`, from: "System", text: `Accepted file: ${offer.name}`, ts: Date.now(), type: "system" };
          const next = [...m, sys];
          persistMessages(next);
          return next;
        });
        // progress UI already set by earlier offer handler
        setTransfer(offerId, (prev) => ({ ...(prev || {}), label: "Receiving", transferred: 0, total: offer.size || null }));
      } else {
        respondToFileOffer(offerId, offer.from, true);
        setIncomingFileOffers((s) => { const c = { ...s }; delete c[offerId]; return c; });
        setMessages((m) => {
          const sys = { id: `sys-accept-${offerId}`, from: "System", text: `Accepted file: ${offer.name} — browser may not support direct disk writes.`, ts: Date.now(), type: "system" };
          const next = [...m, sys];
          persistMessages(next);
          return next;
        });
      }
    } catch (e) {
      console.warn("acceptFileOffer failed", e);
      try { respondToFileOffer(offerId, offer.from, false); } catch (er) {}
      setIncomingFileOffers((s) => { const c = { ...s }; delete c[offerId]; return c; });
      removeTransfer(offerId);
    }
  };

  const ignoreFileOffer = (offerId) => {
    const entry = incomingFileOffers[offerId];
    if (!entry) return;
    try { respondToFileOffer(offerId, entry.offer.from, false); } catch (e) { console.warn("ignoreFileOffer failed", e); }
    setIncomingFileOffers((s) => { const copy = { ...s }; delete copy[offerId]; return copy; });
    removeTransfer(offerId);
  };

  // join/create/leave hub helpers
  const handleCreateHub = () => {
    const id = getLocalPeerId() || myId;
    if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
    joinHub(id);
    setJoinedBootstrap(id);
    localStorage.setItem("ph_hub_bootstrap", id);
    localStorage.setItem("ph_should_autojoin", "true");
    const sysPlain = { id: `sys-create-${Date.now()}`, from: "System", text: `You created the hub. Share this ID: ${id}`, ts: Date.now(), type: "system" };
    setMessages((m) => { const next = [...m, sysPlain]; persistMessages(next); return next; });
    try { broadcastSystem("system_public", `[${username || "Host"}] is the host`, `sys-host-${id}`); } catch (e) {}
    setMenuOpen(false);
  };

  const handleJoinHub = async () => {
    const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
    if (!id) { setMenuOpen(false); return; }
    const trimmed = id.trim();
    joinHub(trimmed);
    setJoinedBootstrap(trimmed);
    localStorage.setItem("ph_hub_bootstrap", trimmed);
    localStorage.setItem("ph_should_autojoin", "true");
    try { connectToPeer(trimmed, handleIncoming, handlePeerListUpdate, username); } catch (e) {}
    const friendly = getPeerNames()[trimmed] || trimmed;
    const sys = { id: `sys-join-${Date.now()}`, from: "System", text: `Join requested for hub: ${friendly}`, ts: Date.now(), type: "system" };
    setMessages((m) => { const next = [...m, sys]; persistMessages(next); return next; });
    setMenuOpen(false);
  };

  const handleLeaveClick = () => { setMenuOpen(false); setConfirmLeaveOpen(true); };

  const handleConfirmLeave = () => {
    try { leaveHub(); } catch (e) {}
    setJoinedBootstrap("");
    localStorage.removeItem("ph_hub_bootstrap");
    localStorage.removeItem("ph_should_autojoin");
    try { localStorage.removeItem(LS_MSGS); } catch (e) {}
    seenSystemIdsRef.current.clear();
    setMessages([]);
    const sys = { id: `sys-left-${Date.now()}`, from: "System", text: "You left the hub. Auto-join cleared.", ts: Date.now(), type: "system" };
    setMessages((m) => { const next = [...m, sys]; persistMessages(next); return next; });
    setConfirmLeaveOpen(false);
  };

  const handleCancelLeave = () => setConfirmLeaveOpen(false);

  // reply to message / ack read on tap
  const handleTapMessage = (m) => {
    if (m.type && m.type.toString().startsWith("system")) return;
    setReplyTo({ id: m.id, from: m.from, text: m.text });
    const input = document.querySelector('input[placeholder="Type a message..."]');
    if (input) input.focus();
    const originPeerId = m.fromId || m.from;
    if (m.id && originPeerId) {
      try { sendAckRead(m.id, originPeerId); addUniqueToMsgArray(m.id, "reads", getLocalPeerId() || myId); } catch (e) { console.warn("sendAckRead error", e); }
    }
  };

  // recording: long-press logic on clip button (press & hold 3s to start)
  const onClipPointerDown = (e) => {
    // start a timer; if pointer still down after RECORD_PRESS_MS -> begin recording
    if (recordPressTimerRef.current) clearTimeout(recordPressTimerRef.current);
    recordPressTimerRef.current = setTimeout(() => {
      // start recording
      startRecording();
    }, RECORD_PRESS_MS);
  };

  const onClipPointerUp = (e) => {
    // cancel pending press -> if recording, stop recording
    if (recordPressTimerRef.current) {
      clearTimeout(recordPressTimerRef.current);
      recordPressTimerRef.current = null;
    }
    if (isRecording) {
      stopRecording();
    } else {
      // short press: open file picker (default attach)
      handleFileInputClick();
    }
  };

  // start recording (MediaRecorder)
  const startRecording = async () => {
    if (isRecording) return;
    try {
      recordedChunksRef.current = [];
      const constraints = { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      // show live preview via srcObject (safe)
      try {
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
          previewVideoRef.current.muted = true;
          previewVideoRef.current.playsInline = true;
          previewVideoRef.current.play().catch(() => {});
        }
      } catch (e) { console.warn("preview play failed", e); }

      let options = { mimeType: "video/webm; codecs=vp8,opus" };
      let recorder;
      try { recorder = new MediaRecorder(stream, options); } catch (_) { recorder = new MediaRecorder(stream); }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev && ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        // stop media tracks
        try { mediaStreamRef.current && mediaStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) {}

        // blob from chunks
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        const size = blob.size || 0;
        const name = `recording-${Date.now()}.webm`;
        const localUrl = URL.createObjectURL(blob);

        // add local message (sender)
        const id = nanoid();
        const msgObj = {
          id,
          from: getLocalPeerId() || myId,
          fromName: username,
          text: "",
          ts: Date.now(),
          deliveries: [],
          reads: [getLocalPeerId() || myId],
          media: { blob, mime: blob.type, size, name, url: localUrl },
        };
        setMessages((m) => { const next = [...m, msgObj]; persistMessages(next); return next; });

        // sender progress UI
        setTransfer(id, { name, label: "Sending", transferred: 0, total: size, ts: Date.now() });

        // send chat (structured clone of object with blob)
        try {
          sendChat(msgObj);
          // without fine-grained sender progress we mark done after we receive a file_transfer_done or simply mark as sent
          setTransfer(id, (prev) => ({ ...(prev || {}), transferred: size }));
          setTimeout(() => removeTransfer(id), 1500);
        } catch (e) {
          console.warn("send recorded media failed", e);
          removeTransfer(id);
        }

        // cleanup preview element srcObject & revoke URL later
        try { if (previewVideoRef.current) previewVideoRef.current.srcObject = null; } catch (_) {}
        setTimeout(() => { try { URL.revokeObjectURL(localUrl); } catch (er) {} }, 30000);
      };

      recorder.start(1000); // ondataevery
      setIsRecording(true);
      setRecordRemaining(MAX_RECORD_SECONDS);
      recordTimerRef.current = setInterval(() => {
        setRecordRemaining((s) => {
          if (s <= 1) {
            // time's up -> stop
            stopRecording();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (e) {
      console.warn("startRecording failed", e);
      try { if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop()); } catch (er) {}
      setIsRecording(false);
    }
  };

  // stop recording
  const stopRecording = async () => {
    if (!isRecording) return;
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch (e) { console.warn("stopRecording failed", e); }
    try { if (recordTimerRef.current) clearInterval(recordTimerRef.current); recordTimerRef.current = null; } catch (e) {}
    setIsRecording(false);
    setRecordRemaining(MAX_RECORD_SECONDS);
  };

  // render progress bars floating at top
  const renderProgressBars = () => {
    const ids = Object.keys(transfers);
    if (!ids.length) return null;
    // show newest first
    const sorted = ids.sort((a, b) => (transfers[b].ts || 0) - (transfers[a].ts || 0));
    return (
      <div className="fixed left-1/2 -translate-x-1/2 top-4 z-60 pointer-events-none">
        <div className="space-y-2 pointer-events-auto">
          {sorted.map((id) => {
            const t = transfers[id];
            const pct = t.total ? Math.min(100, Math.round((t.transferred || 0) / t.total * 100)) : 0;
            return (
              <div key={id} className="w-[560px] max-w-[calc(100vw-40px)] bg-black/80 text-white p-3 rounded-md shadow-lg">
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="truncate" style={{ maxWidth: "80%" }}>{t.label || "Transfer"}: {t.name}</div>
                  <div className="text-xs opacity-80">{t.total ? `${formatBytesAdaptive(t.transferred)}/${formatBytesAdaptive(t.total)}` : `${formatBytesAdaptive(t.transferred)}`}</div>
                </div>
                <div className="w-full h-2 bg-white/20 rounded overflow-hidden">
                  <div style={{ width: `${pct}%` }} className="h-full bg-blue-500 transition-all" />
                </div>
                <div className="text-right text-[11px] opacity-80 mt-1">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // render incoming file offers UI
  const renderIncomingFileOffers = () => {
    const keys = Object.keys(incomingFileOffers);
    if (!keys.length) return null;
    return keys.map((k) => {
      const entry = incomingFileOffers[k];
      const offer = entry.offer;
      const remaining = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
      return (
        <div key={k} className="mb-2 p-2 rounded bg-white/10 text-sm text-black">
          <div className="font-semibold">File offer: {offer.name} ({formatBytesAdaptive(offer.size)})</div>
          <div className="text-xs text-gray-600">From: {peerNamesMap[offer.from] || offer.from} — Expires in {remaining}s</div>
          <div className="mt-2 flex justify-center gap-2">
            <button onClick={() => acceptFileOffer(k)} className="px-3 py-1 rounded bg-gradient-to-br from-green-500 to-green-600 text-white">Accept</button>
            <button onClick={() => ignoreFileOffer(k)} className="px-3 py-1 rounded bg-gradient-to-br from-red-500 to-red-600 text-white">Ignore</button>
          </div>
        </div>
      );
    });
  };

  // render a single message (chat / media / system)
  const renderMessage = (m, idx) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const isSystem = m.type && m.type.toString().startsWith("system");
    const isMe = (m.fromId || m.from) === (getLocalPeerId() || myId) || from === username;

    if (isSystem) {
      return (
        <div key={`${m.id ?? m.ts}-${idx}`} className="w-full text-center my-2">
          <div className="inline-block px-3 py-1 rounded bg-white/20 text-blue-500 text-sm">{m.text}</div>
        </div>
      );
    }

    // media handling: if message has media (blob or url) show circular preview for videos
    if (m.media && (m.media.mime || "").startsWith("video")) {
      // media.url expected to be objectURL or created earlier
      return (
        <div key={`${m.id ?? m.ts}-${idx}`} onClick={() => handleTapMessage(m)} className={`p-3 rounded-2xl max-w-[60%] mb-2 cursor-pointer ${isMe ? "ml-auto bg-blue-500 text-white" : "bg-white/100 text-black"}`}>
          <div className="text-xs font-bold flex items-center">
            <div className="flex-1">{isMe ? "You" : from}</div>
            <div className="text-[10px] text-gray-700 /70 ml-2">{time}</div>
          </div>

          <div className="mt-2 flex items-center justify-center">
            {/* circular video preview */}
            <div style={{ width: 120, height: 120 }} className="rounded-full overflow-hidden bg-black relative">
              {/* video tag for playback (use src or url) */}
              <video
                src={m.media.url}
                controls
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "9999px" }}
              />
              {/* download overlay center */}
              <a
                href={m.media.url}
                download={m.media.name}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/50 p-2 rounded-full text-white"
                title="Download"
              >
                ⤓
              </a>
            </div>
          </div>
        </div>
      );
    }

    // default chat bubble
    return (
      <div onClick={() => handleTapMessage(m)} key={`${m.id ?? m.ts}-${idx}`} className={`p-2 rounded-2xl max-w-[50%] mb-2 cursor-pointer ${isMe ? "ml-auto bg-blue-500 text-white" : "bg-white/100 text-black"}`}>
        <div className="text-xs font-bold flex items-center">
          <div className="flex-1">{isMe ? "You" : from}</div>
          <div className="text-[10px] text-gray-700 /70 ml-2">{time}</div>
        </div>
        {m.replyTo && (
          <div className="mt-2 mb-2 p-2 rounded border border-white/5 text-xs text-gray-600 bg-gray-300">
            <strong className="text-xs text-blue-400">Reply to {m.replyTo.from}:</strong> {m.replyTo.text}
          </div>
        )}
        <div className="break-words">{txt}</div>
      </div>
    );
  };

  // typing summary
  const typingSummary = () => {
    const names = Object.keys(typingUsers);
    if (!names.length) return null;
    const shown = names.slice(0, 2).join(", ");
    return <div className="text-sm text-blue-500 mb-2">{shown} typing...</div>;
  };

  // connected peer names
  const connectedNames = peers.length ? peers.map((id) => peerNamesMap[id] || id) : [];

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

  // visibility -> ack read
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        const localId = getLocalPeerId() || myId;
        messages.forEach((m) => {
          if (!m || m.type !== "chat") return;
          const origin = m.fromId || m.from;
          if (!origin || origin === localId) return;
          const alreadyRead = Array.isArray(m.reads) && m.reads.includes(localId);
          if (!alreadyRead) {
            try { sendAckRead(m.id, origin); } catch (e) { console.warn("sendAckRead error (on visibility):", e); }
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

  // send typing on input
  useEffect(() => {
    if (!username) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    try { if (typeof sendTyping === "function") sendTyping(username, true); } catch (e) {}
    typingTimeoutRef.current = setTimeout(() => {
      try { if (typeof sendTyping === "function") sendTyping(username, false); } catch (e) {}
    }, 1200);
    return () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // render
  return (
    <>
      {/* floating progress bars */}
      {renderProgressBars()}

      <div className="h-[92vh] md:h-[92vh] max-w-[410px] w-full mx-auto bg-gray-50 text-purple-600 p-6 flex flex-col rounded-4xl relative">
        <header className="flex items-center justify-between mb-4">
          <div className="flex gap-2.5">
            <div className="text-sm text-blue-600">YourID</div>
            <div className="font-mono">{myId || "..."}</div>
            <div className="text-sm text-blue-600">Name: {username}</div>
            <div className="text-xs text-purple-500 mt-1">Auto-join: {joinedBootstrap || "none"}</div>
          </div>

          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((s) => !s)} className="p-2 rounded-full bg-white/10 text-white" aria-label="Menu">
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
          <div className="mb-3 text-sm text-blue-600">Connected peers: {connectedNames.length === 0 ? <span className="text-red-500">none</span> : connectedNames.join(", ")}</div>

          {renderIncomingFileOffers()}

          {replyTo && (
            <div className="mb-2 p-3 bg-white/10 text-gray-500 rounded-lg">
              Replying to <strong>{replyTo.from}</strong>: <span className="text-sm text-blue-400">{replyTo.text}</span>
              <button onClick={() => setReplyTo(null)} className="ml-4 text-xs text-red-500">x</button>
            </div>
          )}

          {/* Input row with clip long-press and send */}
          <div className="relative w-full flex items-center">
  {/* clip icon inside input (left) */}
  <svg
    onClick={handleFileInputClick}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700"
    title="Attach File"
    style={{ display: "block", color: "#2563EB", fill: "none" }}
    aria-hidden="true"
  >
    <path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 015 5l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.49" />
  </svg>

  <input
    value={text}
    onChange={(e) => setText(e.target.value)}
    placeholder="Type a message..."
    className="flex-1 p-3 pl-10 pr-10 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
    onKeyDown={(e) => {
      if (e.key === "Enter") send();
    }}
    aria-label="Type a message"
  />

  {/* send icon inside input (right) - outlined paper plane */}
  <svg
    onClick={send}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 text-blue-500 cursor-pointer hover:text-blue-700"
    title="Send"
    style={{ display: "block", color: "#2563EB", fill: "none" }}
    aria-hidden="true"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
</div>



          {/* recording info row */}
          {isRecording && (
            <div className="mt-2 flex items-center justify-between text-sm text-red-500">
              <div>Recording — remaining: {recordRemaining}s</div>
              <div>
                <button onClick={stopRecording} className="px-3 py-1 rounded bg-red-600 text-white">Stop</button>
              </div>
            </div>
          )}
        </footer>
      </div>

      {/* Leave confirmation modal */}
      {confirmLeaveOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={handleCancelLeave} />
          <div className="relative bg-white/10 p-6 rounded-lg backdrop-blur text-white w-80 z-70">
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

