import React, { useState } from "react";
import Welcome from "./Welcome";
import CreateHub from "./CreateHub";
import JoinHub from "./JoinHub";
import Chat from "./Chat";

export default function PeersHub() {
  const [screen, setScreen] = useState("welcome"); // welcome | create | join | chat
  const [user, setUser] = useState(() => localStorage.getItem("ph_name") || "");
  const [hubId, setHubId] = useState("");
  const [peers, setPeers] = useState({}); // peerId -> {pc, dc, status}
  const [messages, setMessages] = useState([]);

  return (
    <>
      {screen === "welcome" && (
        <Welcome
          user={user}
          setUser={(u) => {
            setUser(u);
            localStorage.setItem("ph_name", u);
          }}
          onNext={() => setScreen("create")}
          onJoin={() => setScreen("join")}
        />
      )}

      {screen === "create" && (
        <CreateHub
          user={user}
          setHubId={setHubId}
          setScreen={setScreen}
          peers={peers}
          setPeers={setPeers}
        />
      )}

      {screen === "join" && (
        <JoinHub
          user={user}
          setHubId={setHubId}
          setScreen={setScreen}
          peers={peers}
          setPeers={setPeers}
        />
      )}

      {screen === "chat" && (
        <Chat
          user={user}
          hubId={hubId}
          peers={peers}
          messages={messages}
          setMessages={setMessages}
          setScreen={setScreen}
        />
      )}
    </>
  );
}
