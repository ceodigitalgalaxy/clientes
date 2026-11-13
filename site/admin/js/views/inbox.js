/* Avisos do painel (sininho no topo): atribuição, menção, comentário numa
   demanda sua e pedido de ajuste do cliente. Os avisos nascem no banco
   (gatilhos); aqui só lemos os da própria pessoa e marcamos como lidos.
   Abrir um aviso abre o conteúdo e marca aquele aviso como lido. */

import { $, esc, on } from "../../../js/lib/dom.js?v=75a584518a";
import { icon } from "../../../js/lib/icons.js?v=75a584518a";
import { stampLabel } from "../../../js/lib/dates.js?v=75a584518a";

const KINDS = {
  atribuicao: { icon: "user", text: (n) => `${n.actor_name} te colocou como responsável` },
  mencao: { icon: "message", text: (n) => `${n.actor_name} te mencionou` },
  comentario: { icon: "message", text: (n) => `${n.actor_name} comentou numa demanda sua` },
  ajuste: { icon: "refresh", text: (n) => (n.actor_name === "Cliente (pelo link)" ? "O cliente pediu ajuste" : `${n.actor_name} marcou ajuste`) }
};

export function setupInbox({ api, state, openContent }) {
  const toggle = document.querySelector('[data-action="toggle-inbox"]');
  const badge = toggle.querySelector("[data-inbox-count]");
  const panel = $("#inbox");
  let items = [];
  let timer = null;

  const unread = () => items.filter((n) => !n.read_at).length;
  function syncBadge() {
    const n = unread();
    badge.hidden = !n;
    badge.textContent = n > 9 ? "9+" : String(n);
    toggle.setAttribute("aria-label", n ? `Avisos: ${n} ${n === 1 ? "novo" : "novos"}` : "Avisos");
  }
  function render() {
    panel.innerHTML = `
      <div class="inbox__head">
        <h2 class="inbox__title">Avisos</h2>
        ${unread() ? '<button class="link-btn" type="button" data-inbox-all>Marcar todos como lidos</button>' : ""}
      </div>
      ${items.length ? `<ul class="inbox__list">${items.map((n) => {
        const k = KINDS[n.kind] || KINDS.comentario;
        return `
          <li><button class="inbox__item${n.read_at ? "" : " is-unread"}" type="button" data-inbox-open="${esc(n.id)}" data-content="${esc(n.content_id || "")}">
            <span class="inbox__icon inbox__icon--${esc(n.kind)}">${icon(k.icon)}</span>
            <span class="inbox__body">
              <span class="inbox__text">${esc(k.text(n))}</span>
              ${n.body ? `<span class="inbox__quote">${esc(n.body)}</span>` : ""}
              <span class="inbox__time">${esc(stampLabel(n.created_at))}</span>
            </span>
          </button></li>`;
      }).join("")}</ul>` : '<p class="inbox__empty">Nenhum aviso por enquanto. Quando alguém te atribuir uma demanda, te mencionar ou o cliente pedir ajuste, aparece aqui.</p>'}`;
  }
  async function refresh() {
    if (!state.signedIn) return;
    try { items = await api.listNotifications(30); syncBadge(); if (!panel.hidden) render(); } catch { /* o sininho é só um lembrete */ }
  }
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) { render(); panel.querySelector("button")?.focus(); }
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("click", (event) => { if (!panel.hidden && !event.target.closest?.("#inbox, [data-action='toggle-inbox']")) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) { setOpen(false); toggle.focus(); } });
  on(panel, "click", "[data-inbox-all]", async () => {
    try { await api.markNotificationsRead(); items.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); }); syncBadge(); render(); } catch { /* tenta de novo depois */ }
  });
  on(panel, "click", "[data-inbox-open]", async (event, b) => {
    const n = items.find((x) => x.id === b.dataset.inboxOpen);
    setOpen(false);
    if (n && !n.read_at) { n.read_at = new Date().toISOString(); syncBadge(); api.markNotificationsRead([n.id]).catch(() => {}); }
    if (b.dataset.content) openContent(b.dataset.content);
  });

  return {
    start() { refresh(); clearInterval(timer); timer = setInterval(refresh, 60_000); },
    stop() { clearInterval(timer); timer = null; items = []; syncBadge(); setOpen(false); },
    refresh
  };
}
