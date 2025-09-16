// // ReplyInThread.jsx
// import React, { useEffect, useState, useRef } from "react";

// /**
//  * ReplyInThread
//  *
//  * Props:
//  * - parentMsg: the parent message object (id, from, text, ts, etc.)
//  * - threadMessages: array of thread messages [{id, from, fromName, text, ts, ...}]
//  * - participants: array of peerIds
//  * - onSend(text) => send thread message
//  * - onClose() => close panel
//  * - onMarkRead() => mark as read
//  * - myId, peerNamesMap (optional)
//  *
//  * This is a scaffold with a tidy UI and basic accessibility.
//  */
// export default function ReplyInThread({
//   parentMsg,
//   threadMessages = [],
//   participants = [],
//   onSend,
//   onClose,
//   onMarkRead,
//   myId,
//   peerNamesMap = {},
// }) {
//   const [replyText, setReplyText] = useState("");
//   const messagesEndRef = useRef(null);

//   useEffect(() => {
//     // scroll to bottom when thread changes
//     try {
//       messagesEndRef.current && messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
//     } catch (e) {}
//   }, [threadMessages]);

//   const handleSend = () => {
//     const t = replyText.trim();
//     if (!t) return;
//     onSend && onSend(t);
//     setReplyText("");
//   };

//   const formatTime = (ts) => {
//     try {
//       return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
//     } catch (e) {
//       return "";
//     }
//   };

//   const renderParticipant = (pid) => {
//     const name = peerNamesMap[pid] || pid;
//     return (
//       <div key={pid} className="inline-block bg-gray-100 text-sm text-gray-700 px-2 py-1 rounded mr-1">
//         {name === myId ? "You" : name}
//       </div>
//     );
//   };

//   return (
//     <div className="h-full flex flex-col">
//       <div className="p-4 border-b border-gray-200 flex items-center justify-between">
//         <div>
//           <div className="text-sm text-gray-600">Thread</div>
//           <div className="text-lg font-semibold">{parentMsg ? (parentMsg.from || "peer") : "Thread"}</div>
//           <div className="text-xs text-gray-500 mt-1">{parentMsg ? parentMsg.text : ""}</div>
//         </div>
//         <div className="flex items-center gap-2">
//           <button onClick={() => { onMarkRead && onMarkRead(); }} className="px-3 py-1 rounded bg-gray-100 text-sm">Mark read</button>
//           <button onClick={() => onClose && onClose()} aria-label="Close thread" className="px-3 py-1 rounded bg-red-500 text-white">Close</button>
//         </div>
//       </div>

//       <div className="flex-1 overflow-auto p-4 bg-white">
//         {threadMessages.length === 0 ? (
//           <div className="text-sm text-gray-400">No replies yet. Be the first to reply.</div>
//         ) : (
//           threadMessages.map((t) => (
//             <div key={t.id} className="mb-3">
//               <div className="text-xs text-gray-500">{t.fromName || t.from} · {formatTime(t.ts)}</div>
//               <div className="mt-1 p-2 rounded bg-gray-100 text-gray-800">{t.text}</div>
//             </div>
//           ))
//         )}
//         <div ref={messagesEndRef} />
//       </div>

//       <div className="p-4 border-t border-gray-200 bg-gray-50">
//         <div className="mb-2 text-xs text-gray-600">Participants</div>
//         <div className="mb-3">
//           {participants && participants.length ? participants.map(renderParticipant) : <div className="text-xs text-gray-400">No subscribers yet</div>}
//         </div>

//         <div className="flex gap-2">
//           <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply in thread..." className="flex-1 p-2 rounded border border-gray-200" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }} />
//           <button onClick={handleSend} className="px-4 py-2 rounded bg-blue-600 text-white">Reply</button>
//         </div>
//       </div>
//     </div>
//   );
// }
