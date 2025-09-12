self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => self.clients.claim());

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.text() : "New message";
  event.waitUntil(
    self.registration.showNotification("PeersHub", {
      body: data,
      icon: "/vite.svg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientsArr) => {
      if (clientsArr.length > 0) return clientsArr[0].focus();
      return clients.openWindow("/");
    })
  );
});
