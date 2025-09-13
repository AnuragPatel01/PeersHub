// src/notify.js
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  try {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const perm = await Notification.requestPermission();
    return perm === "granted";
  } catch (e) {
    return false;
  }
}

export async function showNotification(title, { body = "", tag = "peershub", icon = "/icons/icon-192.png", data = {} } = {}) {
  try {
    // Prefer service worker registration (works if app is backgrounded or PWA)
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        return reg.showNotification(title, { body, tag, icon, data, renotify: true });
      }
    }

    // Fallback to page Notification
    if ("Notification" in window && Notification.permission === "granted") {
      return new Notification(title, { body, icon, tag, data });
    }
  } catch (e) {
    console.warn("showNotification failed", e);
  }
}
