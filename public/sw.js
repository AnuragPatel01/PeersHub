// public/sw.js
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  self.clients.claim();
});

// Receive push events from a push server (optional)
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "PeersHub", body: event.data?.text || "New message" };
  }

  const title = payload.title || "PeersHub";
  const opts = {
    body: payload.body || "New message",
    tag: payload.tag || "peershub-msg",
    renotify: true,
    data: payload.data || {},
    // badge: "/icons/icon-192.png", // optional: add an icon to public/icons
  };

  event.waitUntil(self.registration.showNotification(title, opts));
});

// Page can postMessage a show-notification command here
self.addEventListener("message", (ev) => {
  try {
    const data = ev.data || {};
    if (data && data.type === "show-notification") {
      const { title, options } = data;
      self.registration.showNotification(title || "PeersHub", options || {});
    }
  } catch (e) {
    // ignore
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const urlToOpen = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes(urlToOpen) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
    })
  );
});
