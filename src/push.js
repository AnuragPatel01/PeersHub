// src/push.js - force server on localhost:4000 for dev
export const VAPID_PUBLIC_KEY =
  "BLjfWTbV2jpZkHM-AetFzvIB80Cq2J8Em8zUn66U_Yqp3RRvW4JIUb8k-iAfmonjWhOtf_i6fVq29dx-ggQ8Bhs";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(serverSaveUrl = "http://localhost:4000/api/save-subscription", extra = {}) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push not supported");
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permission denied");

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();

  console.debug("ServiceWorker registration:", reg);
  console.debug("Existing push subscription (if any):", existing);

  let sub = existing;
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  try {
    console.group("Push subscription (client)");
    console.log("endpoint:", sub.endpoint);
    console.log("expirationTime:", sub.expirationTime);
    const raw = sub.toJSON ? sub.toJSON() : sub;
    console.log("subscription (toJSON):", JSON.stringify(raw, null, 2));
    console.groupEnd();
  } catch (e) {
    console.warn("Failed to stringify subscription", e, sub);
  }

  // POST subscription to the push server (port 4000)
  await fetch(serverSaveUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, ...extra }),
  });

  return sub;
}
