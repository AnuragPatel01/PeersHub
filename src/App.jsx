
import './App.css'
import React, { useEffect, useRef, useState } from "react";

// ===== Utility functions: encode/decode codes for manual exchange =====
const encodeCode = (obj) => {
  try {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    return null;
  }
};
const decodeCode = (str) => {
  try {
    const json = decodeURIComponent(escape(atob(str)));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
};

// Generate a small random ID for peers
const makeId = () => Math.random().toString(36).slice(2, 9);

// STUN servers
const DEFAULT_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function App() {
  const [localId] = useState(() => makeId());
  const [peers, setPeers] = useState({});
  const peersRef = useRef({});
  const [log, setLog] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [offerCode, setOfferCode] = useState("");
  const [pasteCode, setPasteCode] = useState("");
  const [permission, setPermission] = useState(Notification.permission);

  const addLog = (t) => {
    setLog((l) => [
      { ts: new Date().toLocaleTimeString(), text: t },
      ...l,
    ]);
  };

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  // Service worker registration
  useEffect(() => {
    (async () => {
      try {
        if ("serviceWorker" in navigator) {
          await navigator.serviceWorker.register("/sw.js");
          addLog("Service worker registered.");
        }
      } catch (e) {
        addLog("SW reg failed: " + e.message);
      }
    })();
  }, []);

  const requestNotification = async () => {
    const perm = await Notification.requestPermission();
    setPermission(perm);
    addLog("Notification permission: " + perm);
  };

  const setupDataChannel = (peerId, dc) => {
    peersRef.current[peerId].dc = dc;
    dc.onopen = () => {
      addLog(`Connected to ${peerId}`);
      setPeers((prev) => ({
        ...prev,
        [peerId]: { ...(prev[peerId] || {}), status: "connected" },
      }));
    };
    dc.onclose = () => {
      addLog(`Connection closed with ${peerId}`);
    };
    dc.onmessage = (ev) => {
      const msg = ev.data;
      addLog(`${peerId}: ${msg}`);
      if (permission === "granted") {
        new Notification("New Message", { body: msg });
      }
    };
  };

  const waitForIce = (pc) =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const check = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", check);
    });

  const createOfferFor = async (peerId) => {
    const pc = new RTCPeerConnection(DEFAULT_CONFIG);
    const dc = pc.createDataChannel("chat");
    peersRef.current[peerId] = { pc, dc };
    setupDataChannel(peerId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);

    const code = encodeCode({ type: "offer", from: localId, sdp: pc.localDescription });
    setPeers((p) => ({ ...p, [peerId]: { id: peerId, status: "offer created" } }));
    setOfferCode(code);
  };

  const handlePasteOffer = async (encoded) => {
    const decoded = decodeCode(encoded);
    if (!decoded || decoded.type !== "offer") return addLog("Invalid offer");

    const peerId = decoded.from || makeId();
    const pc = new RTCPeerConnection(DEFAULT_CONFIG);
    peersRef.current[peerId] = { pc };

    pc.ondatachannel = (ev) => setupDataChannel(peerId, ev.channel);
    await pc.setRemoteDescription(decoded.sdp);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);

    const code = encodeCode({ type: "answer", from: localId, to: peerId, sdp: pc.localDescription });
    navigator.clipboard?.writeText(code);
    alert("Answer generated. Copied to clipboard!");
    addLog("Answer created for " + peerId);
  };

  const handlePasteAnswer = async (encoded) => {
    const decoded = decodeCode(encoded);
    if (!decoded || decoded.type !== "answer") return addLog("Invalid answer");
    const peerId = decoded.from;
    const entry = peersRef.current[peerId];
    if (entry?.pc) {
      await entry.pc.setRemoteDescription(decoded.sdp);
      addLog("Answer applied from " + peerId);
    }
  };

  const processCode = async () => {
    if (!pasteCode.trim()) return;
    const decoded = decodeCode(pasteCode.trim());
    if (decoded.type === "offer") {
      await handlePasteOffer(pasteCode.trim());
    } else if (decoded.type === "answer") {
      await handlePasteAnswer(pasteCode.trim());
    }
    setPasteCode("");
  };

  const broadcastMessage = (msg) => {
    addLog(`You: ${msg}`);
    Object.values(peersRef.current).forEach(({ dc }) => {
      if (dc?.readyState === "open") dc.send(msg);
    });
    setInputMessage("");
  };

  return (
    <div className="min-h-screen p-4 bg-gradient-to-b from-purple-500 to-purple-600 text-white flex flex-col">
      <div className="max-w-4xl mx-auto w-full">
        <header className="flex items-center justify-between py-4">
          <h1 className="text-2xl font-bold">PeersHub</h1>
          <div className="text-sm">Your ID: <span className="font-mono">{localId}</span></div>
        </header>

        <main className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Controls */}
          <section className="bg-white/10 p-4 rounded-2xl">
            <button
              onClick={() => createOfferFor(prompt("Peer name/ID") || makeId())}
              className="w-full py-2 mb-3 rounded-lg bg-green-500 text-green-500 font-semibold"
            >
              Create Offer
            </button>

            <textarea
              value={offerCode}
              readOnly
              className="w-full h-28 p-2 mb-2 rounded bg-white/20 text-sm font-mono"
            />
            <button
              onClick={() => navigator.clipboard.writeText(offerCode)}
              className="px-3 py-1 rounded bg-white/20 mb-4"
            >
              Copy Offer
            </button>

            <textarea
              value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
              placeholder="Paste Offer/Answer here..."
              className="w-full h-28 p-2 mb-2 rounded bg-white/20 text-sm font-mono"
            />
            <button
              onClick={processCode}
              className="w-full py-2 rounded bg-green-500 text-green-500 font-semibold"
            >
              Process Code
            </button>

            <div className="mt-4">
              <button
                onClick={requestNotification}
                className="w-full py-2 rounded text-purple-600"
              >
                Request Notifications
              </button>
              <p className="text-xs mt-1">Permission: {permission}</p>
            </div>
          </section>

          {/* Chat */}
          <section className="md:col-span-2 bg-white/10 p-4 rounded-2xl flex flex-col">
            <div className="flex-1 overflow-auto mb-3">
              <div className="space-y-2">
                {log.map((item, i) => (
                  <div key={i} className="text-sm font-mono">
                    [{item.ts}] {item.text}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type message..."
                className="flex-1 p-2 rounded bg-white/20"
              />
              <button
                onClick={() => inputMessage && broadcastMessage(inputMessage)}
                className="px-4 py-2 rounded bg-green-500 text-green-500 font-semibold"
              >
                Send
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
