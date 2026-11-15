/* Service worker do painel: só recebe os avisos (push) e abre o painel ao tocar.
   Não guarda páginas nem dados (nada de cache): o painel continua exigindo
   login e sempre busca a versão nova. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Só endereços do próprio painel (nunca abrir um link que veio de fora) */
function panelUrl(raw) {
  try {
    const url = new URL(raw || "./", self.registration.scope);
    return url.origin === self.location.origin && url.href.startsWith(self.registration.scope) ? url.href : self.registration.scope;
  } catch { return self.registration.scope; }
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = String(data.title || "Painel Digital Galaxy").slice(0, 80);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || "").slice(0, 180),
    tag: String(data.tag || "aviso"),
    icon: "../images/logo/icon-192.png",
    badge: "../images/logo/badge-96.png",
    lang: "pt-BR",
    data: { url: panelUrl(data.url) }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = panelUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      open.postMessage({ type: "abrir-aviso", url });
      return open.focus();
    }
    return self.clients.openWindow(url);
  })());
});
