// public/service-worker.js  (or public/sw.js) — replace the existing file with this

/* eslint-disable no-restricted-globals */
self.addEventListener("install", (evt) => {
  // activate immediately for dev - remove in production if you want controlled updates
  self.skipWaiting();
});

self.addEventListener("activate", (evt) => {
  // claim clients so the SW starts controlling pages immediately
  evt.waitUntil(self.clients.claim());
});

// Push handler (if your server sends JSON payload)
self.addEventListener("push", (event) => {
  try {
    const payload = event.data ? event.data.json() : { title: "PeersHub", body: "New message" };
    const title = payload.title || "PeersHub";
    const options = {
      body: payload.body || "",
      icon: payload.icon || "/icons/icon-192x192.png",
      badge: payload.badge || "/icons/badge-72.png",
      data: {
        url: payload.url || "/", // used on notificationclick
        // you can include any other metadata here
        payload,
      },
      // Example actions (optional)
      // actions: [{ action: 'open', title: 'Open App' }]
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error("push handler error", err);
  }
});

// notificationclick - robust, safe, and logs errors instead of throwing
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification && event.notification.data && event.notification.data.url) || "/";
  let urlToOpen;
  try {
    // Make absolute URL relative to SW origin to avoid invalid relative URLs
    urlToOpen = new URL(rawUrl, self.location.origin).href;
  } catch (err) {
    // fallback to root if URL invalid
    console.warn("notificationclick: invalid url provided, falling back to '/'", rawUrl, err);
    urlToOpen = self.location.origin + "/";
  }

  event.waitUntil(
    (async () => {
      try {
        // Try to focus an existing client that matches our origin.
        const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of allClients) {
          // If a window/tab already has the app open, focus it and navigate if needed
          // client.url can be absolute; compare origins to be safe
          try {
            const sameOrigin = new URL(client.url).origin === new URL(self.location.origin).origin;
            if (sameOrigin) {
              if ("focus" in client) {
                await client.focus();
              }
              // try to navigate existing client (not all browsers support navigate())
              if (client.url !== urlToOpen && "navigate" in client) {
                try {
                  // client.navigate may fail on some browsers - swallow the error
                  await client.navigate(urlToOpen);
                } catch (navErr) {
                  console.warn("notificationclick: client.navigate failed", navErr);
                }
              } else if (client.url !== urlToOpen && "postMessage" in client) {
                // fallback: send a message so the page can handle internal navigation
                try {
                  client.postMessage({ type: "notification-click", url: urlToOpen });
                } catch (msgErr) {
                  // ignore
                }
              }
              return;
            }
          } catch (clientCheckErr) {
            // malformed client.url — ignore and continue
            console.warn("notificationclick: error checking client", client, clientCheckErr);
          }
        }

        // No existing client matched — open a new one
        try {
          const opened = await clients.openWindow(urlToOpen);
          if (!opened) {
            console.warn("notificationclick: clients.openWindow returned null/undefined for", urlToOpen);
          }
        } catch (openErr) {
          // openWindow may be blocked or fail for some reasons — log it but don't rethrow
          console.error("notificationclick: clients.openWindow failed", openErr);
        }
      } catch (e) {
        console.error("notificationclick: unexpected error", e);
      }
    })()
  );
});

// Optional: listen for messages from pages (for debug or navigation)
self.addEventListener("message", (event) => {
  // For example, page can send {type: 'PING'} or receive notification-click message
  // console.log("SW received message", event.data);
});
