import React, { useState, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { sendChat, sendTyping, sendAckRead, getLocalPeerId } from "./webrtc";

const ReplyInThread = ({
  rootMessage,
  onClose,
  username,
  myId,
  peers,
  peerNamesMap,
  threadMessages = [],
  onSendThreadReply,
  onTypingInThread,
}) => {
  const [text, setText] = useState("");
  const [typingUsers, setTypingUsers] = useState({});
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadMessages]);

  // Handle typing indicator
  useEffect(() => {
    if (!username || !text) return;

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    if (typeof onTypingInThread === "function") {
      onTypingInThread(username, true, rootMessage.id);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (typeof onTypingInThread === "function") {
        onTypingInThread(username, false, rootMessage.id);
      }
    }, 1200);

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [text, username, rootMessage.id, onTypingInThread]);

  const handleSend = () => {
    if (!text.trim()) return;

    const threadReply = {
      id: nanoid(),
      from: getLocalPeerId() || myId,
      fromName: username,
      text: text.trim(),
      ts: Date.now(),
      type: "thread_reply",
      threadId: rootMessage.id,
      deliveries: [],
      reads: [getLocalPeerId() || myId],
    };

    if (typeof onSendThreadReply === "function") {
      onSendThreadReply(threadReply);
    }

    setText("");
  };

  const renderTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderThreadMessage = (msg) => {
    const isMe = (msg.fromId || msg.from) === (getLocalPeerId() || myId);
    const from = msg.fromName || msg.from || "peer";

    return (
      <div
        key={msg.id}
        className={`p-3 rounded-2xl max-w-[85%] mb-3 ${
          isMe ? "ml-auto bg-blue-500 text-white" : "bg-white text-black"
        }`}
      >
        <div className="text-xs font-bold flex items-center mb-1">
          <span className="flex-1">{isMe ? "You" : from}</span>
          <span className="text-[10px] opacity-70 ml-2">
            {renderTime(msg.ts)}
          </span>
        </div>
        <div className="break-words text-sm">{msg.text}</div>
      </div>
    );
  };

  const renderRootMessage = () => {
    const isMe = (rootMessage.fromId || rootMessage.from) === (getLocalPeerId() || myId);
    const from = rootMessage.fromName || rootMessage.from || "peer";

    return (
      <div className="bg-gray-100 border-l-4 border-blue-500 p-3 mb-4 rounded-r-lg">
        <div className="text-xs font-bold text-gray-600 mb-1 flex items-center">
          <span className="flex-1">Thread started by {isMe ? "You" : from}</span>
          <span className="text-[10px] opacity-70 ml-2">
            {renderTime(rootMessage.ts)}
          </span>
        </div>
        <div className="text-sm text-gray-800 break-words">
          {rootMessage.text}
        </div>
      </div>
    );
  };

  const typingSummary = () => {
    const names = Object.keys(typingUsers).filter(name => name !== username);
    if (!names.length) return null;
    const shown = names.slice(0, 2).join(", ");
    return (
      <div className="text-xs text-blue-500 mb-2 px-3">
        {shown} typing...
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm p-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close thread"
          >
            <svg
              className="w-5 h-5 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h2 className="font-semibold text-gray-800">Thread</h2>
            <p className="text-xs text-gray-500">
              {threadMessages.length} {threadMessages.length === 1 ? 'reply' : 'replies'}
            </p>
          </div>
        </div>
        <div className="text-xs text-gray-500">
          {peers.length} connected
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Root message */}
        {renderRootMessage()}

        {/* Thread replies */}
        <div className="space-y-1">
          {threadMessages.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              No replies yet. Start the conversation!
            </div>
          ) : (
            threadMessages.map(renderThreadMessage)
          )}
        </div>

        {/* Typing indicator */}
        {typingSummary()}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Reply in thread..."
              className="w-full p-3 pr-12 bg-gray-50 text-gray-800 rounded-full border border-gray-200 focus:border-blue-400 focus:outline-none transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              autoFocus
            />
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-blue-500 text-white disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              aria-label="Send reply"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReplyInThread;