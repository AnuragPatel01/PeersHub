import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Chat from "./Chat";


// src/registerServiceWorker.js (optional helper) or inline in main.jsx
if ("serviceWorker" in navigator) {
  // register the SW file that lives in `public/service-worker.js`
  navigator.serviceWorker
    .register("/service-worker.js", { scope: "/" })
    .then((reg) => {
      console.log("SW registered:", reg);
    })
    .catch((err) => {
      console.error("SW register failed:", err);
    });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Chat />
  </StrictMode>
);
