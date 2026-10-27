// Hourlark service worker: shows Web Push notifications and opens the app when one is clicked.
// It does not cache anything; static assets keep their normal HTTP caching.

self.addEventListener("push", (event) => {
  let message = { title: "Hourlark", body: "", tag: "hourlark" };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // An empty or malformed payload still shows a generic notification.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: "/brand/hourlark-original/icon-192.png",
      badge: "/brand/hourlark-original/icon-48.png",
      data: { url: "/time" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/time", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === target.origin);
      // Focus an open Hourlark tab as is; navigating it could discard an unsaved edit.
      if (open) return open.focus();
      return self.clients.openWindow(target.href);
    }),
  );
});
