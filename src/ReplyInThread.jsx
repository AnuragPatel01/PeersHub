// src/components/ReplyInThread.jsx
import React, { useState, useRef, useEffect } from "react";
import { sendChat, getLocalPeerId, sendTyping, sendAckRead } from "./webrtc";

import { nanoid } from "nanoid";

const ReplyInThread = ({
  rootMessage,
  onClose,
  username,
  myId,
  threadMessages,
  onSendThreadReply,
  peerNamesMap = {},
  threadTypingUsers = {},
}) => {
  const [text, setText] = useState("");
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!messagesEndRef.current) return;
    try {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    } catch (e) {}
  }, [threadMessages]);

  useEffect(() => {
    // mark thread replies as read locally + send ack to origins
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

  const typingBucket =
    (threadTypingUsers && threadTypingUsers[rootMessage.id]) || {};
  const typingNames = Object.keys(typingBucket || {}).filter((n) => {
    // expire very old timestamps (3s)
    const t = typingBucket[n];
    return t && Date.now() - t < 3000;
  });

  const handleSend = () => {
    if (!text.trim()) return;

    const id = nanoid();
    const msgObj = {
      id,
      from: getLocalPeerId() || myId,
      fromName: username,
      text: text.trim(),
      ts: Date.now(),
      type: "thread",
      threadRootId: rootMessage.id,
      deliveries: [],
      reads: [getLocalPeerId() || myId],
    };

    onSendThreadReply(msgObj);
    setText("");
  };

  const renderMessage = (m, isRoot = false) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isMe =
      (m.fromId || m.from) === (getLocalPeerId() || myId) || from === username;

    return (
      <div
        key={`${m.id ?? m.ts}`}
        className={`p-2 rounded-2xl max-w-[40%] md:max-w-[10%] mb-2 ${
          isRoot
            ? "bg-blue-100 border-2 border-blue-300"
            : isMe
            ? "ml-auto bg-blue-500 text-white"
            : "bg-white/100 text-black"
        }`}
      >
        <div className="text-xs font-bold flex items-center">
          <div className="flex-1">{isMe ? "You" : from}</div>
          <div className="text-[10px] text-gray-600 ml-2">{time}</div>
          {isRoot && (
            <div className="text-[10px] text-blue-600 ml-2 font-bold">ROOT</div>
          )}
        </div>
        <div className="break-words mt-1">{txt}</div>
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
        <h1 className="text-lg font-semibold text-blue-500">Thread</h1>
        <div className="w-10 h-10" /> {/* Spacer for centering */}
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-auto p-4 bg-gray-50">
        {/* Root message */}
        <div className="mb-4">
          <div className="text-sm text-gray-600 mb-2 font-medium">
            Original message:
          </div>
          {renderMessage(rootMessage, true)}
        </div>

        {/* Thread divider */}
        <div className="flex items-center my-4">
          <div className="flex-1 h-px bg-gray-300"></div>
          <div className="px-4 text-sm text-gray-500 bg-gray-50">
            {threadMessages.length}{" "}
            {threadMessages.length === 1 ? "reply" : "replies"}
          </div>
          <div className="flex-1 h-px bg-gray-300"></div>
        </div>

        {/* Thread messages */}
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

      {/* Input */}
      <footer className="p-4 bg-white border-t border-gray-200">
        {typingNames.length > 0 && (
          <div className="px-4 text-sm text-blue-500 mb-2">
            {typingNames.slice(0, 3).join(", ")}{" "}
            {typingNames.length === 1 ? "is" : "are"} typing...
          </div>
        )}
        <div className="relative flex items-center">
          <input
            value={text}
            onChange={(e) => {
              const val = e.target.value;
              setText(val);

              try {
                // notify peers that we're typing in this thread
                if (typeof sendTyping === "function") {
                  // DEBUG: show that we're about to call sendTyping
                  console.debug("sending typing:", {
                    username,
                    rootId: rootMessage.id,
                  });
                  sendTyping(username, true, rootMessage.id);
                }
              } catch (err) {
                console.warn("sendTyping failed:", err);
              }

              // debounce turning off typing after 1200ms of inactivity
              if (typingTimeoutRef.current)
                clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = setTimeout(() => {
                try {
                  if (typeof sendTyping === "function") {
                    console.debug("sending typing false:", {
                      username,
                      rootId: rootMessage.id,
                    });
                    sendTyping(username, false, rootMessage.id);
                  }
                } catch (err) {
                  console.warn("sendTyping(false) failed:", err);
                }
              }, 1200);
            }}
            placeholder="Reply in thread..."
            className="flex-1 p-3 pr-12 bg-gray-100 placeholder-gray-500 text-gray-800 rounded-full border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button
            onClick={handleSend}
            className="absolute right-2 p-2 text-blue-500 hover:text-blue-700 disabled:text-gray-400"
            disabled={!text.trim()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default ReplyInThread;
