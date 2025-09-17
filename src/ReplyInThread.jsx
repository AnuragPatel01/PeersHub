// src/components/ReplyInThread.jsx
import React, { useState, useRef, useEffect } from "react";
import {
  sendChat,
  getLocalPeerId,
  sendTyping,
  sendAckRead,
  offerFileToPeers,
} from "./webrtc";
import { nanoid } from "nanoid";

/**
 * ReplyInThread
 * - rootMessage: the root message object
 * - onClose: close thread overlay
 * - username, myId
 * - peers: array of connected peer ids (optional, used for delivery logic)
 * - threadMessages: array of replies for this root message (persisted by Chat)
 * - onSendThreadReply: callback to add & broadcast a thread message (should call sendChat in Chat)
 * - peerNamesMap, threadTypingUsers: optional UI bits
 */
const ReplyInThread = ({
  rootMessage,
  onClose,
  username,
  myId,
  peers = [],
  threadMessages = [],
  onSendThreadReply,
  peerNamesMap = {},
  threadTypingUsers = {},
}) => {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // reply target within thread
  const [pendingPhotos, setPendingPhotos] = useState([]); // [{ file, dataUrl, name }]
  const [viewer, setViewer] = useState({ open: false, images: [], index: 0 });
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      try {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (typeof sendTyping === "function") {
          sendTyping(username, false, rootMessage.id);
        }
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autoscroll when threadMessages change
  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    } catch (e) {}
  }, [threadMessages]);

  // mark thread replies as read and ack to origins on open/update
  useEffect(() => {
    try {
      const localId = getLocalPeerId() || myId;
      (threadMessages || []).forEach((m) => {
        const origin = m.fromId || m.from;
        const alreadyRead = Array.isArray(m.reads) && m.reads.includes(localId);
        if (!alreadyRead) {
          try {
            sendAckRead(m.id, origin, true, rootMessage.id);
          } catch (e) {}
        }
      });
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMessage?.id, threadMessages]);

  // typing names for this thread
  const typingBucket =
    (threadTypingUsers && threadTypingUsers[rootMessage.id]) || {};
  const typingNames = Object.keys(typingBucket || {}).filter((n) => {
    const t = typingBucket[n];
    return t && Date.now() - t < 3000;
  });

  // helper: open viewer modal for images
  const openViewer = (images = [], startIndex = 0) => {
    setViewer({ open: true, images: images || [], index: startIndex || 0 });
  };

  const closeViewer = () => setViewer({ ...viewer, open: false });

  // handle user tapping a message in the thread (set reply-to + ack)
  const handleTapThreadMessage = (m) => {
    if (!m || (m.type && m.type.toString().startsWith("system"))) return;
    setReplyTo({ id: m.id, from: m.from, text: m.text });
    try {
      if (inputRef.current) inputRef.current.focus();
    } catch (e) {}
    try {
      const originPeerId = m.fromId || m.from;
      if (m.id && originPeerId) {
        sendAckRead(m.id, originPeerId, true, rootMessage.id);
      }
    } catch (e) {}
  };

  // send a thread reply (text or images)
  const handleSend = async () => {
    const trimmed = (text || "").trim();
    if (!trimmed && pendingPhotos.length === 0) return;

    const id = nanoid();
    const msgObj = {
      id,
      from: getLocalPeerId() || myId,
      fromName: username || myId,
      text: trimmed || "",
      ts: Date.now(),
      type: "thread",
      threadRootId: rootMessage.id,
      deliveries: [],
      reads: [getLocalPeerId() || myId],
      replyTo: replyTo
        ? { id: replyTo.id, from: replyTo.from, text: replyTo.text }
        : null,
    };

    // if photos are attached, convert them to data URLs (already available in pendingPhotos)
    if (pendingPhotos.length) {
      msgObj.imageGroup = pendingPhotos.map((p) => p.dataUrl);
      msgObj.imageMeta = pendingPhotos.map((p) => ({
        name: p.name || p.file?.name || "photo",
      }));
    }

    try {
      // 1) locally add + persist via parent handler
      if (typeof onSendThreadReply === "function") {
        onSendThreadReply(msgObj);
      } else {
        // fallback: broadcast directly
        try {
          sendChat(msgObj);
        } catch (e) {}
      }

      // 2) if there are files to offer to peers (we still use your offer model)
      if (pendingPhotos.length) {
        // we will create a single offer meta per file and call offerFileToPeers for each file
        // (the actual transfer is triggered when the remote accepts)
        pendingPhotos.forEach((p) => {
          try {
            const offerId = `offer-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 7)}`;
            const meta = {
              id: offerId,
              name: p.name || p.file?.name || "photo.jpg",
              size: p.file?.size || 0,
              mime: p.file?.type || "image/jpeg",
              from: getLocalPeerId() || myId,
              // include thread context so receivers know this file belongs to this thread message
              thread: true,
              threadRootId: rootMessage.id,
              originMsgId: id,
            };
            try {
              offerFileToPeers(meta);
            } catch (e) {
              console.warn("offerFileToPeers (thread) failed", e);
            }
          } catch (e) {}
        });
      }
    } catch (e) {
      console.warn("handleSend thread failed", e);
    } finally {
      // clear composer
      setText("");
      setReplyTo(null);
      setPendingPhotos([]);
    }
  };

  // file selection (multiple images)
  const onFilesSelected = (filesList) => {
    if (!filesList || !filesList.length) return;
    const arr = Array.from(filesList).slice(0, 8); // cap to 8 photos at once
    const readers = arr.map((f) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({ file: f, dataUrl: e.target.result, name: f.name });
        };
        reader.readAsDataURL(f);
      });
    });
    Promise.all(readers).then((items) => {
      setPendingPhotos((prev) => [...prev, ...items]);
    });
  };

  const handleAttachClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  // remove a pending photo before send
  const removePendingPhoto = (index) => {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // render delivery/read status dot (keeps parity with Chat.jsx)
  const renderStatusDot = (m) => {
    const localId = getLocalPeerId() || myId;

    const recipientIds = (Array.isArray(peers) ? peers.slice() : []).filter(
      (p) => p && p !== localId
    );

    const totalPeers =
      recipientIds.length ||
      (() => {
        const fromDeliveries = (m.deliveries || []).filter(
          (id) => id && id !== localId
        );
        const fromReads = (m.reads || []).filter((id) => id && id !== localId);
        const set = new Set([...fromDeliveries, ...fromReads]);
        return set.size;
      })();

    const deliveries = (m.deliveries || []).filter(
      (id) => id && id !== localId
    ).length;
    const reads = (m.reads || []).filter((id) => id && id !== localId).length;

    if (totalPeers === 0) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2"
          title="No recipients (offline)"
        />
      );
    }
    if (deliveries < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
          title={`Delivered to ${deliveries}/${totalPeers}`}
        />
      );
    }
    if (deliveries === totalPeers && reads < totalPeers) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-yellow-400 ml-2"
          title={`Delivered to all (${totalPeers}), reads ${reads}/${totalPeers}`}
        />
      );
    }
    if (reads === totalPeers && totalPeers > 0) {
      return (
        <span
          className="inline-block w-2 h-2 rounded-full bg-green-500 ml-2"
          title="Read by everyone"
        />
      );
    }
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-gray-400 ml-2" />
    );
  };

  // render a single thread message (used both for root and replies)
  const renderMessage = (m, isRoot = false) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isMe =
      (m.fromId || m.from) === (getLocalPeerId() || myId) || from === username;

    // image group rendering
    const isImageGroup = Array.isArray(m.imageGroup) && m.imageGroup.length > 0;
    const bubbleBase = isRoot
      ? "bg-blue-100 border-2 border-blue-300"
      : isMe
      ? "ml-auto bg-blue-500 text-white"
      : "bg-white/100 text-black";

    return (
      <div
        key={`${m.id ?? m.ts}`}
        onClick={() => handleTapThreadMessage(m)}
        className={`p-2 rounded-2xl max-w-[40%] mb-4 ${bubbleBase}`}
      >
        <div className="text-xs font-bold flex items-center">
          <div className="flex-1">{isMe ? "You" : from}</div>
          <div className="text-[10px] text-gray-600 ml-2">{time}</div>
          {isRoot && (
            <div className="text-[10px] text-blue-600 ml-2 font-bold">ROOT</div>
          )}
          {isMe && renderStatusDot(m)}
        </div>

        {m.replyTo && (
          <div className="mt-2 mb-2 p-2 rounded border border-white/10 text-xs text-gray-700 bg-gray-100">
            <strong className="text-xs text-blue-500">
              Reply to {m.replyTo.from}:
            </strong>{" "}
            <span className="text-xs text-gray-800 break-words">
              {m.replyTo.text}
            </span>
          </div>
        )}

        {/* text */}
        {m.text && (
          <div className="break-words mt-1 whitespace-pre-wrap">{txt}</div>
        )}

        {/* images group */}
        {isImageGroup && (
          <div className="mt-3">
            {/* grid 2x2 — each tile is square using aspect-ratio or padding trick */}
            <div className="grid grid-cols-2 gap-2">
              {m.imageGroup.slice(0, 4).map((src, i) => (
                <div
                  key={i}
                  className="relative rounded-lg overflow-hidden"
                  style={{ paddingTop: "100%" }} // square container
                  onClick={(e) => {
                    e.stopPropagation();
                    openViewer(m.imageGroup, i);
                  }}
                >
                  <img
                    src={src}
                    alt={`img-${i}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              ))}
            </div>

            {/* +N more indicator */}
            {m.imageGroup.length > 4 && (
              <div
                className="mt-2 text-xs text-white font-bold text-center cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  openViewer(m.imageGroup, 4);
                }}
              >
                +{m.imageGroup.length - 4} more
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-white border-b border-gray-200">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Close thread"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-blue-500">Nest</h1>
        <div className="w-10 h-10" /> {/* spacer */}
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-auto p-4">
        <div className="mb-4">
          <div className="text-sm text-gray-600 mb-2 font-medium">
            Original message:
          </div>
          {renderMessage(rootMessage, true)}
        </div>

        <div className="flex items-center my-4">
          <div className="flex-1 h-px bg-gray-300" />
          <div className="px-4 text-sm text-gray-500 bg-gray-50">
            {threadMessages.length}{" "}
            {threadMessages.length === 1 ? "reply" : "replies"}
          </div>
          <div className="flex-1 h-px bg-gray-300" />
        </div>

        <div className="space-y-2">
          {threadMessages.length === 0 && (
            <div className="text-center text-gray-500 text-sm py-8">
              No replies yet. Start the conversation!
            </div>
          )}
          {threadMessages.map((m) => renderMessage(m))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input / composer */}
      {/* Input / composer */}
      <footer className="p-4 bg-white border-t border-gray-200">
        {typingNames.length > 0 && (
          <div className="px-4 text-sm text-blue-500 mb-2">
            {typingNames.slice(0, 3).join(", ")}{" "}
            {typingNames.length === 1 ? "is" : "are"} typing...
          </div>
        )}

        {replyTo && (
          <div className="mb-2 p-3 bg-white/10 text-gray-600 rounded-lg flex items-start justify-between">
            <div>
              Replying to <strong>{replyTo.from}</strong>:{" "}
              <div className="text-sm text-blue-400">{replyTo.text}</div>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="ml-4 text-xs text-red-500"
              aria-label="Cancel reply"
            >
              x
            </button>
          </div>
        )}

        {/* pending photos preview (before sending) */}
        {pendingPhotos.length > 0 && (
          <div className="mb-3">
            <div className="grid grid-cols-4 gap-2">
              {pendingPhotos.map((p, i) => (
                <div
                  key={i}
                  className="relative rounded overflow-hidden"
                  style={{ paddingTop: "100%" }}
                >
                  <img
                    src={p.dataUrl}
                    alt={p.name}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                  <button
                    onClick={() => removePendingPhoto(i)}
                    className="absolute top-1 right-1 bg-black/50 text-red-500 p-1 rounded-full text-xs"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative w-full flex items-center">
          {/* clip icon inside input */}
          <svg
            onClick={handleAttachClick}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => onFilesSelected(e.target.files)}
          />

          {/* message input */}
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply in nest..."
            className="flex-1 p-3 pl-10 pr-10 bg-white/10 placeholder-blue-300 text-blue-500 font-mono rounded-3xl border-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />

          {/* send icon */}
          <svg
            onClick={handleSend}
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
    </div>
  );
};

export default ReplyInThread;
