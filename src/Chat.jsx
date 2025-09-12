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

// import "./App.css";

// Chat.jsx
import "./App.css";
import React, { useEffect, useState, useRef } from "react";
import {
  initPeer,
  broadcastMessage,
  getPeerNames,
  joinHub,
  leaveHub,
  getLocalPeerId,
  connectToPeer,
} from "./webrtc";

/**
 * Updated Chat.jsx
 * - No manual "Connect to Peer" UI anymore (only Create Hub / Join Hub / Leave)
 * - Uses latest webrtc.js (auto-elect bootstrap, system messages)
 * - Username prompt stored in localStorage
 * - Auto-scrolls on new messages
 * - Shows friendly names (uses getPeerNames())
 * - Displays system messages centered
 */

export default function Chat() {
  const [myId, setMyId] = useState(() => getLocalPeerId() || "...");
  const [peers, setPeers] = useState([]); // array of peer ids
  const [peerNamesMap, setPeerNamesMap] = useState({}); // id -> name
  const [messages, setMessages] = useState([]); // {from (name), text, ts, type?}
  const [text, setText] = useState("");
  const [username, setUsername] = useState(() => localStorage.getItem("ph_name") || "");
  const [showNamePrompt, setShowNamePrompt] = useState(() => !localStorage.getItem("ph_name"));
  const [joinedBootstrap, setJoinedBootstrap] = useState(() => localStorage.getItem("ph_hub_bootstrap") || "");
  const messagesEndRef = useRef(null);
  const peerRef = useRef(null);

  // Incoming messages handler (called by webrtc)
  const handleIncoming = (fromName, msgText) => {
    const safeText = typeof msgText === "string" ? msgText : JSON.stringify(msgText);
    // if system message, mark its type
    const isSystem = fromName === "System";
    const fromDisplay = isSystem ? "System" : fromName || "peer";
    const msg = {
      from: fromDisplay,
      text: safeText,
      ts: Date.now(),
      type: isSystem ? "system" : "chat",
    };
    setMessages((m) => [msg, ...m]);
  };

  // Peer list update: update peers array and refresh names map
  const handlePeerListUpdate = (list) => {
    setPeers(list || []);
    try {
      const names = getPeerNames();
      setPeerNamesMap(names || {});
    } catch (e) {
      // ignore
    }
  };

  // Bootstrap changed callback (called by webrtc when election or broadcast happens)
  const handleBootstrapChange = (newBootstrapId) => {
    setJoinedBootstrap(newBootstrapId || "");
    // announce to UI as a system message (but skip if it's this client — webrtc will already send "You're the host now")
    const myLocalId = getLocalPeerId() || myId;
    if (!newBootstrapId) return;
    if (newBootstrapId === myLocalId) return; // skip: webrtc will send the personal system message
    const friendly = (getPeerNames()[newBootstrapId] || newBootstrapId);
    const sysMsg = { from: "System", text: `${friendly} is now the host`, ts: Date.now(), type: "system" };
    setMessages((m) => [sysMsg, ...m]);
  };

  // init PeerJS once username is available
  useEffect(() => {
    if (!username) return;
    const p = initPeer(handleIncoming, handlePeerListUpdate, username, handleBootstrapChange);
    peerRef.current = p;
    p.on && p.on("open", (id) => setMyId(id));

    // refresh persisted bootstrap state
    const bootstrap = localStorage.getItem("ph_hub_bootstrap");
    setJoinedBootstrap(bootstrap || "");

    return () => {
      try {
        p && p.destroy && p.destroy();
      } catch (e) {
        console.warn("peer destroy err", e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Auto-scroll when messages update (messages are newest-first and we render reversed)
  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    } catch (e) {}
  }, [messages]);

  // Create Hub (make me host / bootstrap = my id)
  const handleCreateHub = () => {
    const id = getLocalPeerId() || myId;
    if (!id) return alert("Peer not ready yet. Wait a moment and try again.");
    joinHub(id);
    setJoinedBootstrap(id);
    // show system note locally
    const sys = { from: "System", text: `You created the hub. Share this ID: ${id}`, ts: Date.now(), type: "system" };
    setMessages((m) => [sys, ...m]);
  };

  // Join hub by entering bootstrap id (persisted). Try immediate connect as well.
  const handleJoinHub = async () => {
    const id = prompt("Enter Hub bootstrap peer ID (the host's ID):");
    if (!id) return;
    const trimmed = id.trim();
    joinHub(trimmed);
    setJoinedBootstrap(trimmed);

    // attempt immediate connection (we still don't expose a manual connect button)
    try {
      connectToPeer(trimmed, handleIncoming, handlePeerListUpdate, username);
    } catch (e) {
      // would retry automatically per webrtc reconnect loop
    }

    const friendly = (getPeerNames()[trimmed] || trimmed);
    const sys = { from: "System", text: `Join requested for hub: ${friendly}`, ts: Date.now(), type: "system" };
    setMessages((m) => [sys, ...m]);
  };

  // Leave current hub (stop auto-join)
  const handleLeaveHub = () => {
    leaveHub();
    setJoinedBootstrap("");
    const sys = { from: "System", text: "You left the hub. Auto-join cleared.", ts: Date.now(), type: "system" };
    setMessages((m) => [sys, ...m]);
  };

  // send chat message
  const send = () => {
    if (!text.trim()) return;
    const msgObj = { from: username, text: text.trim(), ts: Date.now(), type: "chat" };
    setMessages((m) => [msgObj, ...m]);
    broadcastMessage(username, text.trim());
    setText("");
  };

  // rendering each message (system messages centered)
  const renderMessage = (m) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString();
    const isSystem = m.type === "system" || from === "System";
    const isMe = from === username;

    if (isSystem) {
      return (
        <div key={m.ts + from} className="w-full text-center my-2">
          <div className="inline-block px-3 py-1 rounded bg-white/20 text-white text-sm">
            {txt}
          </div>
        </div>
      );
    }

    return (
      <div
        key={m.ts + from}
        className={`p-2 rounded-lg max-w-[80%] mb-2 ${
          isMe
            ? "ml-auto bg-gradient-to-br from-purple-500 to-purple-700 text-white"
            : "bg-white/20 text-white"
        }`}
      >
        <div className="text-xs font-bold">
          {isMe ? "You" : from} <span className="text-[10px] text-white/70 ml-2">{time}</span>
        </div>
        <div className="break-words">{txt}</div>
      </div>
    );
  };

  // first-time name prompt
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

  // friendly names for connected peers
  const connectedNames = peers.length ? peers.map((id) => peerNamesMap[id] || id) : [];

  return (
    <div className="h-screen md:h-[80vh] bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600 p-6 flex flex-col rounded-4xl">
      <header className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm text-purple-600">Your ID</div>
          <div className="font-mono">{myId || "..."}</div>
          <div className="text-sm text-purple-600">Name: {username}</div>
          <div className="text-xs text-purple-500 mt-1">Auto-join: {joinedBootstrap || "none"}</div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateHub}
            className="px-3 py-2 bg-gradient-to-br from-green-500 to-green-700 text-white rounded text-sm"
          >
            Create Hub (Host)
          </button>

          <button
            onClick={handleJoinHub}
            className="px-3 py-2 bg-white/10 text-white rounded text-sm"
          >
            Join Hub
          </button>

          <button
            onClick={handleLeaveHub}
            className="px-3 py-2 bg-red-600 text-white rounded text-sm"
          >
            Leave
          </button>
        </div>
      </header>

      <div className="w-full text-white h-0.5 bg-white" />
      <br />

      <main className="flex-1 overflow-auto mb-4">
        <div className="flex flex-col-reverse" style={{ paddingBottom: 8 }}>
          {messages.length === 0 && (
            <div className="text-sm text-white/60">No messages yet</div>
          )}
          {messages.map((m) => renderMessage(m))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <div className="w-full text-white h-0.5 bg-white" />

      <footer className="mt-auto">
        <div className="mb-3 text-sm text-white/80">
          Connected peers:{" "}
          {connectedNames.length === 0 ? (
            <span className="text-white/60">none</span>
          ) : (
            connectedNames.join(", ")
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 p-3  bg-white/10 placeholder-white/60 rounded-2xl"
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button
            onClick={send}
            className="px-4 py-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white font-semibold"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
