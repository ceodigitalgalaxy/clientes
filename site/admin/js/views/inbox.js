/* Avisos do painel (sininho no topo): atribuição, menção, comentário numa
   demanda sua, subtarefa concluída e pedido de ajuste do cliente. Os avisos nascem no banco
   (gatilhos); aqui só lemos os da própria pessoa e marcamos como lidos.
   Abrir um aviso abre o conteúdo e marca aquele aviso como lido.
   Novidade chegando (a cada 20 s, ao voltar para o app ou na hora, quando o
   aviso no celular está ativado) → onNew(novos): as telas se atualizam sozinhas. */

import { $, esc, on } from "../../../js/lib/dom.js?v=852f83f166";
import { icon } from "../../../js/lib/icons.js?v=852f83f166";
import { stampLabel } from "../../../js/lib/dates.js?v=852f83f166";

const KINDS = {
  atribuicao: { icon: "user", text: (n) => `${n.actor_name} te colocou como responsável` },
  mencao: { icon: "message", text: (n) => `${n.actor_name} te mencionou` },
  comentario: { icon: "message", text: (n) => `${n.actor_name} comentou numa demanda sua` },
  ajuste: { icon: "refresh", text: (n) => (n.actor_name === "Cliente (pelo link)" ? "O cliente pediu ajuste" : `${n.actor_name} marcou ajuste`) },
  tarefa_atribuida: { icon: "user", text: (n) => `${n.actor_name} te passou uma demanda` },
  tarefa_mencao: { icon: "message", text: (n) => `${n.actor_name} te mencionou numa demanda` },
  tarefa_comentario: { icon: "message", text: (n) => `${n.actor_name} comentou numa demanda sua` },
  subtarefa_concluida: { icon: "check", text: (n) => `${n.actor_name} concluiu uma subtarefa` },
  edicao_entregue: { icon: "play", text: (n) => `${n.actor_name} entregou a edição` },
  edicao_ajuste: { icon: "refresh", text: (n) => `${n.actor_name} pediu ajuste na edição` },
  edicao_aprovada: { icon: "check", text: (n) => `${n.actor_name} aprovou a edição` },
  prazo_proximo: { icon: "clock", text: () => "Entrega chegando" },
  tarefa_atrasada: { icon: "clock", text: () => "Demanda atrasada" }
};

export function setupInbox({ api, state, push, openContent, openTask, onNew = () => {} }) {
  const toggle = document.querySelector('[data-action="toggle-inbox"]');
  const badge = toggle.querySelector("[data-inbox-count]");
  const panel = $("#inbox");
  let items = [];
  let timer = null;
  let seen = null;           // ids já vistos (a 1ª leitura não conta como novidade)
  let running = null;

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
          <li><button class="inbox__item${n.read_at ? "" : " is-unread"}" type="button" data-inbox-open="${esc(n.id)}" data-content="${esc(n.content_id || "")}" data-task="${esc(n.task_id || "")}">
            <span class="inbox__icon inbox__icon--${esc(n.kind)}">${icon(k.icon)}</span>
            <span class="inbox__body">
              <span class="inbox__text">${esc(k.text(n))}</span>
              ${n.body ? `<span class="inbox__quote">${esc(n.body)}</span>` : ""}
              <span class="inbox__time">${esc(stampLabel(n.created_at))}</span>
            </span>
          </button></li>`;
      }).join("")}</ul>` : '<p class="inbox__empty">Nenhum aviso por enquanto. Quando alguém te passar uma demanda, te mencionar, concluir uma subtarefa sua ou o cliente pedir ajuste, aparece aqui.</p>'}
      <div data-push-box></div>`;
    push?.mount(panel.querySelector("[data-push-box]"));
  }
  async function refresh() {
    if (!state.signedIn) return;
    if (running) return running;   // dois pedidos ao mesmo tempo viram um só
    running = (async () => {
      try {
        items = await api.listNotifications(30);
        const fresh = seen ? items.filter((n) => !n.read_at && !seen.has(n.id)) : [];
        seen = new Set(items.map((n) => n.id));
        syncBadge();
        if (!panel.hidden) render();
        if (fresh.length) onNew(fresh);
      } catch { /* o sininho é só um lembrete */ }
    })();
    try { await running; } finally { running = null; }
  }
  /** Lidos de uma vez todos os avisos daquele item (ex.: a pessoa abriu a demanda por outro caminho) */
  function markItemRead(kind, id) {
    const key = kind === "demanda" ? "task_id" : "content_id";
    const ids = items.filter((n) => !n.read_at && n[key] === id).map((n) => n.id);
    if (!ids.length) return false;
    items.forEach((n) => { if (ids.includes(n.id)) n.read_at = new Date().toISOString(); });
    syncBadge();
    if (!panel.hidden) render();
    api.markNotificationsRead(ids).catch(() => {});
    return true;
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
    if (b.dataset.task) openTask(b.dataset.task);
    else if (b.dataset.content) openContent(b.dataset.content);
  });

  // Voltou para o app (aba ou ícone na tela de início): confere na hora
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && timer) refresh(); });

  return {
    start() { seen = null; refresh(); clearInterval(timer); timer = setInterval(refresh, 20_000); },
    stop() { clearInterval(timer); timer = null; items = []; seen = null; syncBadge(); setOpen(false); },
    refresh,
    markItemRead,
    /** Ids dos itens (demandas) com aviso ainda não lido destes tipos */
    unreadFor(kinds) { return new Set(items.filter((n) => !n.read_at && n.task_id && kinds.includes(n.kind)).map((n) => n.task_id)); }
  };
}
