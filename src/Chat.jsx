import "./App.css";

// import React, { useEffect, useState, useRef } from "react";
// import { initPeer, connectToPeer, broadcastMessage, getPeers, getPeerNames } from "./webrtc";

// /**
//  * Chat.jsx
//  * - Keeps your styling/colors
//  * - Shows names (not IDs) for messages & connected peers
//  * - Expects initPeer(handleIncoming, handlePeerListUpdate, username)
//  */

// export default function Chat() {
//   const [myId, setMyId] = useState("");
//   const [peers, setPeers] = useState([]); // array of peer ids
//   const [peerNamesMap, setPeerNamesMap] = useState({}); // id -> name
//   const [messages, setMessages] = useState([]); // {from (name), text, ts}
//   const [text, setText] = useState("");
//   const [username, setUsername] = useState(() => localStorage.getItem("ph_name") || "");
//   const [showNamePrompt, setShowNamePrompt] = useState(() => !localStorage.getItem("ph_name"));
//   const peerRef = useRef(null);

//   // incoming messages (fromName, text)
//   const handleIncoming = (fromName, msgText) => {
//     const safeText = typeof msgText === "string" ? msgText : JSON.stringify(msgText);
//     const fromDisplay = fromName || "peer";
//     setMessages((m) => [{ from: fromDisplay, text: safeText, ts: Date.now() }, ...m]);
//   };

//   // peer list updated: receives array of peer IDs
//   const handlePeerListUpdate = (list) => {
//     setPeers(list || []);
//     // refresh peer names map from webrtc helper (exported)
//     try {
//       const names = getPeerNames();
//       setPeerNamesMap(names || {});
//     } catch (e) {
//       // ignore if not available
//     }
//   };

//   useEffect(() => {
//     if (!username) return; // wait until username set
//     const p = initPeer(handleIncoming, handlePeerListUpdate, username);
//     peerRef.current = p;

//     // PeerJS open event
//     p.on && p.on("open", (id) => setMyId(id));

//     return () => {
//       try {
//         p && p.destroy && p.destroy();
//       } catch (e) {
//         console.warn("peer destroy err", e);
//       }
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [username]);

//   // manual connect (optional)
//   const manualConnect = async () => {
//     const id = prompt("Enter peer ID to connect:");
//     if (!id) return;
//     connectToPeer(id.trim(), handleIncoming, handlePeerListUpdate, username);
//   };

//   const send = () => {
//     if (!text.trim()) return;
//     const msgObj = { from: username, text: text.trim(), ts: Date.now() };
//     setMessages((m) => [msgObj, ...m]);
//     broadcastMessage(username, text.trim());
//     setText("");
//   };

//   // render message (keeps your colors)
//   const renderMessage = (m) => {
//     const from = m.from ?? "peer";
//     const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
//     const time = new Date(m.ts).toLocaleTimeString();
//     const isMe = from === username;

//     return (
//       <div
//         key={m.ts + from}
//         className={`p-2 rounded-lg max-w-[80%] mb-2 ${
//           isMe
//             ? "ml-auto bg-gradient-to-br from-purple-500 to-purple-700 text-white"
//             : "bg-white/20 text-white"
//         }`}
//       >
//         <div className="text-xs font-bold">
//           {isMe ? "You" : from} <span className="text-[10px] text-white/70 ml-2">{time}</span>
//         </div>
//         <div className="break-words">{txt}</div>
//       </div>
//     );
//   };

//   // Store username first-time UI
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

//   // Build friendly names for connected peers
//   const connectedNames = peers.length
//     ? peers.map((id) => peerNamesMap[id] || id)
//     : [];

//   return (
//     <div className="h-screen md:h-[80vh] bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600 p-6 flex flex-col rounded-4xl">
//       <header className="flex items-center justify-between mb-4">
//         <div>
//           <div className="text-sm text-purple-600">Your ID</div>
//           <div className="font-mono">{myId || "..."}</div>
//           <div className="text-sm text-purple-600">Name: {username}</div>
//         </div>

//         <div className="flex items-center gap-3">
//           <button
//             onClick={manualConnect}
//             className="px-3 py-2 bg-gradient-to-br from-green-500 to-green-700 text-white rounded text-sm"
//           >
//             Connect to Peer
//           </button>
//         </div>
//       </header>

//       <div className="w-full text-white h-0.5 bg-white" />
//       <br />

//       <main className="flex-1 overflow-auto mb-4">
//         <div className="flex flex-col-reverse">
//           {messages.length === 0 && (
//             <div className="text-sm text-white/60">No messages yet</div>
//           )}
//           {messages.map((m) => renderMessage(m))}
//         </div>
//       </main>

//       <div className="w-full text-white h-0.5 bg-white" />

//       <footer className="mt-auto">
//         <div className="mb-3 text-sm text-white/80">
//           Connected peers:{" "}
//           {connectedNames.length === 0 ? (
//             <span className="text-white/60">none</span>
//           ) : (
//             connectedNames.join(", ")
//           )}
//         </div>

//         <div className="flex gap-2">
//           <input
//             value={text}
//             onChange={(e) => setText(e.target.value)}
//             placeholder="Type a message..."
//             className="flex-1 p-3  bg-white/10 placeholder-white/60 rounded-2xl"
//             onKeyDown={(e) => {
//               if (e.key === "Enter") send();
//             }}
//           />
//           <button
//             onClick={send}
//             className="px-4 py-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white font-semibold"
//           >
//             Send
//           </button>
//         </div>
//       </footer>
//     </div>
//   );
// }

// new testing



// src/components/Chat.jsx
import "./App.css";
import React, { useEffect, useState, useRef } from "react";
import { Send, Users, Plus, UserPlus, LogOut, MessageCircle, Hash, Wifi } from "lucide-react";

// Mock webrtc functions for demo
const mockWebRTC = {
  initPeer: (handleIncoming, handlePeerListUpdate, username, handleBootstrapChange) => ({
    on: (event, callback) => {
      if (event === "open") setTimeout(() => callback("peer_" + Math.random().toString(36).substr(2, 8)), 100);
    },
    destroy: () => {}
  }),
  broadcastMessage: (username, text) => console.log("Broadcasting:", username, text),
  getPeerNames: () => ({}),
  joinHub: (id) => console.log("Joining hub:", id),
  leaveHub: () => console.log("Leaving hub"),
  getLocalPeerId: () => "peer_" + Math.random().toString(36).substr(2, 8),
  connectToPeer: (id, handleIncoming, handlePeerListUpdate, username) => console.log("Connecting to:", id)
};

const {
  initPeer,
  broadcastMessage,
  getPeerNames,
  joinHub,
  leaveHub,
  getLocalPeerId,
  connectToPeer,
} = mockWebRTC;

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
  const [username, setUsername] = useState(() => localStorage.getItem("ph_name") || "");
  const [showNamePrompt, setShowNamePrompt] = useState(() => !localStorage.getItem("ph_name"));
  const [joinedBootstrap, setJoinedBootstrap] = useState(() => localStorage.getItem("ph_hub_bootstrap") || "");
  const messagesEndRef = useRef(null);
  const seenSystemIdsRef = useRef(new Set());
  const peerRef = useRef(null);

  const persistMessages = (arr) => {
    try {
      const tail = arr.slice(-MAX_MSGS);
      localStorage.setItem(LS_MSGS, JSON.stringify(tail));
    } catch (e) {}
  };

  const handleIncoming = (from, payloadOrText) => {
    if (payloadOrText && typeof payloadOrText === "object" && payloadOrText.type && payloadOrText.id) {
      const { type, text: txt, id } = payloadOrText;
      if (seenSystemIdsRef.current.has(id)) {
        return;
      }
      seenSystemIdsRef.current.add(id);
      const msg = {
        from: "System",
        text: txt,
        ts: Date.now(),
        type: type,
        id,
      };
      setMessages((m) => {
        const next = [...m, msg];
        persistMessages(next);
        return next;
      });
      return;
    }

    const safeText = typeof payloadOrText === "string" ? payloadOrText : JSON.stringify(payloadOrText);
    const fromDisplay = from || "peer";
    const msg = { from: fromDisplay, text: safeText, ts: Date.now(), type: "chat" };
    setMessages((m) => {
      const next = [...m, msg];
      persistMessages(next);
      return next;
    });
  };

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
  }, [username]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch (e) {}
  }, [messages]);

  const handleCreateHub = () => {
    const id = getLocalPeerId() || myId;
    if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
    joinHub(id);
    setJoinedBootstrap(id);

    const sysPlain = { from: "System", text: `You created the hub. Share this ID: ${id}`, ts: Date.now(), type: "system" };
    setMessages((m) => {
      const next = [...m, sysPlain];
      persistMessages(next);
      return next;
    });
  };

  const handleJoinHub = async () => {
    const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
    if (!id) return;
    const trimmed = id.trim();
    joinHub(trimmed);
    setJoinedBootstrap(trimmed);

    try {
      connectToPeer(trimmed, handleIncoming, handlePeerListUpdate, username);
    } catch (e) {}
    const friendly = (getPeerNames()[trimmed] || trimmed);
    const sys = { from: "System", text: `Join requested for hub: ${friendly}`, ts: Date.now(), type: "system" };
    setMessages((m) => {
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });
  };

  const handleLeaveHub = () => {
    leaveHub();
    setJoinedBootstrap("");
    const sys = { from: "System", text: "You left the hub. Auto-join cleared.", ts: Date.now(), type: "system" };
    setMessages((m) => {
      const next = [...m, sys];
      persistMessages(next);
      return next;
    });
  };

  const send = () => {
    if (!text.trim()) return;
    const msgObj = { from: username, text: text.trim(), ts: Date.now(), type: "chat" };
    setMessages((m) => {
      const next = [...m, msgObj];
      persistMessages(next);
      return next;
    });
    broadcastMessage(username, text.trim());
    setText("");
  };

  const renderMessage = (m, idx) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isSystem = m.type && m.type.toString().startsWith("system");
    const isMe = from === username;

    if (isSystem) {
      return (
        <div key={`${m.id ?? m.ts}-${idx}`} className="flex justify-center my-4">
          <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2 rounded-full text-sm text-slate-600 dark:text-slate-300 max-w-xs text-center">
            {txt}
          </div>
        </div>
      );
    }

    return (
      <div
        key={`${m.ts}-${idx}`}
        className={`flex mb-4 ${isMe ? "justify-end" : "justify-start"} px-4`}
      >
        <div className={`max-w-[75%] sm:max-w-[60%] ${isMe ? "order-2" : "order-1"}`}>
          {!isMe && (
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 ml-3">
              {from}
            </div>
          )}
          <div
            className={`px-4 py-3 rounded-2xl shadow-sm ${
              isMe
                ? "bg-blue-500 text-white ml-auto rounded-br-md"
                : "bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-bl-md"
            }`}
          >
            <div className="break-words text-sm leading-relaxed">{txt}</div>
            <div className={`text-xs mt-1 ${isMe ? "text-blue-100" : "text-slate-500 dark:text-slate-400"}`}>
              {time}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (showNamePrompt) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 w-full max-w-md border border-slate-200 dark:border-slate-700">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <MessageCircle className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Welcome to PeersHub</h1>
            <p className="text-slate-600 dark:text-slate-400">Enter your name to start chatting</p>
          </div>
          
          <div className="space-y-4">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-4 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && username.trim()) {
                  localStorage.setItem("ph_name", username.trim());
                  setUsername(username.trim());
                  setShowNamePrompt(false);
                }
              }}
            />
            
            <button
              onClick={() => {
                if (!username.trim()) return;
                localStorage.setItem("ph_name", username.trim());
                setUsername(username.trim());
                setShowNamePrompt(false);
              }}
              disabled={!username.trim()}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  const connectedNames = peers.length ? peers.map((id) => peerNamesMap[id] || id) : [];

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-white">PeersHub</h1>
              <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
                <Wifi className="w-3 h-3" />
                <span>{username}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-1">
            <button
              onClick={handleCreateHub}
              className="p-2 rounded-lg bg-green-500 hover:bg-green-600 text-green-500 transition-colors duration-200"
              title="Create Hub"
            >
              <Plus className="w-4 h-4" />
            </button>
            
            <button
              onClick={handleJoinHub}
              className="p-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-blue-500 transition-colors duration-200"
              title="Join Hub"
            >
              <UserPlus className="w-4 h-4" />
            </button>
            
            <button
              onClick={handleLeaveHub}
              className="p-2 rounded-lg bg-red-500 hover:bg-red-600 text-red-500 transition-colors duration-200"
              title="Leave Hub"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Connection Status */}
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Hash className="w-3 h-3 text-slate-400" />
              <span className="text-slate-600 dark:text-slate-400 font-mono">{myId}</span>
            </div>
            
            {joinedBootstrap && (
              <div className="flex items-center space-x-1 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-1 rounded-full">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>Connected to hub</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">No messages yet</h3>
            <p className="text-slate-500 dark:text-slate-400 max-w-sm">
              Start a conversation by sending your first message or create/join a hub to connect with others.
            </p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((m, i) => renderMessage(m, i))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Connected Peers Status */}
      {connectedNames.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-t border-blue-200 dark:border-blue-800 px-4 py-2">
          <div className="flex items-center space-x-2 text-sm">
            <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-700 dark:text-blue-300">
              Connected: {connectedNames.join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-end space-x-3">
          <div className="flex-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              rows={1}
              className="w-full px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 border-0 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-all duration-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              style={{
                minHeight: '48px',
                maxHeight: '120px',
                height: 'auto'
              }}
            />
          </div>
          
          <button
            onClick={send}
            disabled={!text.trim()}
            className="p-3 rounded-2xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-blue-500 transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}