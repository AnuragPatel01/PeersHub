import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Chat from './Chat'

// src/registerServiceWorker.js (optional helper) or inline in main.jsx
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    console.log("SW registered:", reg.scope);
  }).catch((err) => console.warn("SW reg failed", err));
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
)
