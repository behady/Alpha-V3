export const dynamic = "force-dynamic";

export async function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };

  // The tap handler is registered BEFORE the Firebase scripts load, on purpose. When a push carries
  // a `notification` block, the Firebase SDK shows it itself and its own click handler swallows
  // the tap (stopImmediatePropagation) and opens nothing, because we send no fcmOptions.link.
  // Listeners run in the order they were added, so going first is how ours gets the tap.
  //
  // Where to go: `data.url` (the alert's page plus ?clinic=, set by clinicPush.js and
  // notificationDelivery.ts). An alert with no page — the desk summon — only brings the app
  // forward, as before, so nobody loses what they were typing.
  const body = `
function alphaTapUrl(notification) {
  const own = notification.data || {};
  // A notification the Firebase SDK drew keeps the whole message under FCM_MSG.
  const fields = (own.FCM_MSG && own.FCM_MSG.data) || own;
  const url = typeof fields.url === 'string' ? fields.url : '';
  return url.charAt(0) === '/' && url.charAt(1) !== '/' ? url : '';
}

self.addEventListener('notificationclick', (event) => {
  if (event.action) return;
  event.stopImmediatePropagation();
  event.notification.close();
  const path = alphaTapUrl(event.notification);
  const target = new URL(path || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ours = list.filter((c) => {
      try { return new URL(c.url).origin === self.location.origin; } catch (e) { return false; }
    });
    const client = ours.find((c) => c.focused) || ours.find((c) => c.visibilityState === 'visible') || ours[0];
    if (client) {
      try { await client.focus(); } catch (e) { /* still try to move it */ }
      if (!path) return;
      try {
        if (await client.navigate(target)) return;
      } catch (e) {
        // A window this worker does not control yet cannot be moved; open the page instead.
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify(config)});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // A push with a notification block has already been shown by the Firebase SDK; drawing it
  // again here is what put two copies of every alert on the phone.
  if (payload.notification) return;
  const data = payload.data || {};
  const title = data.title || 'Alpha Dental';
  const body = data.body || '';
  const tag = data.summonId ? 'summon-' + data.summonId : 'alpha-dental';

  return self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag,
    requireInteraction: true,
    data: { url: data.url || '', summonId: data.summonId || '' },
  });
});
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Service-Worker-Allowed": "/",
    },
  });
}
