/* Minhas demandas: os conteúdos em que a pessoa é responsável, do prazo mais
   apertado para o mais folgado (prazo interno; sem ele, a data de publicação).
   O administrador (e quem edita tudo) pode ver as demandas de outra pessoa.
   Dá para mudar a etapa de produção ali mesmo e abrir o conteúdo. */

import { $, esc, on } from "../../../js/lib/dom.js?v=8083d4a8ab";
import { icon } from "../../../js/lib/icons.js?v=8083d4a8ab";
import { typeBadge } from "../../../js/ui/badges.js?v=8083d4a8ab";
import { PRODUCTION_STATUS, PRIORITIES } from "../domain/rules.js?v=8083d4a8ab";
import { stateBlock, loadingRows } from "../ui/states.js?v=8083d4a8ab";
import { stageChips, dueChip, priorityChip, daysUntil, personName } from "./contents.js?v=8083d4a8ab";

const shortDate = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "—");
const GROUPS = [
  { key: "atrasadas", title: "Atrasadas", tone: "late", test: (n) => n !== null && n < 0 },
  { key: "agora", title: "Hoje e amanhã", tone: "urgent", test: (n) => n !== null && n <= 1 },
  { key: "semana", title: "Próximos 7 dias", tone: "soon", test: (n) => n !== null && n <= 7 },
  { key: "depois", title: "Mais adiante", tone: "ok", test: (n) => n !== null },
  { key: "sem", title: "Sem data", tone: "ok", test: () => true }
];

/** Prazo que vale para a urgência: o interno; sem ele, a publicação */
export const deadlineOf = (c) => c.due_date || c.scheduled_date || null;
export const isOpenTask = (c) => c.production_status !== "publicado";

export function setupTasks({ api, state, toast, navigate, openContent }) {
  const list = $("#task-list");
  const summary = $("#task-summary");
  const navBadge = document.querySelector("[data-my-tasks]");
  let tasks = [];
  let person = null;     // de quem são as demandas mostradas (padrão: eu)

  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente";
  const mine = (rows, who) => rows.filter((c) => (c.assignees || []).includes(who) && isOpenTask(c));
  const sortTasks = (rows) => rows.sort((a, b) => {
    const da = deadlineOf(a) || "9999"; const db = deadlineOf(b) || "9999";
    return da.localeCompare(db) || (PRIORITIES[a.priority]?.rank ?? 2) - (PRIORITIES[b.priority]?.rank ?? 2) || a.title.localeCompare(b.title);
  });

  function card(c) {
    const prod = c.production_status || "";
    return `
      <article class="task-card task-card--${esc(c.priority || "media")}" data-task="${esc(c.id)}">
        <div class="task-card__main">
          <p class="task-card__client">${esc(clientName(c.client_id))}</p>
          <button class="task-card__title" type="button" data-open-task="${esc(c.id)}">${esc(c.title)}</button>
          <p class="task-card__meta">${typeBadge(c.format)}${dueChip(c)}${priorityChip(c.priority)}<span class="task-card__date">${icon("calendar")}Publica ${esc(shortDate(c.scheduled_date))}</span></p>
          <p class="task-card__stages">${stageChips(c)}</p>
        </div>
        <label class="task-card__prod">
          <span class="field__label">Produção</span>
          <select class="field__input" data-task-prod="${esc(c.id)}">
            <option value="" ${!prod ? "selected" : ""}>Não iniciada</option>
            ${Object.entries(PRODUCTION_STATUS).map(([k, v]) => `<option value="${esc(k)}" ${k === prod ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
          </select>
        </label>
      </article>`;
  }

  function render() {
    list.setAttribute("aria-busy", "false");
    const who = person || state.me?.user_id;
    const rows = sortTasks(mine(tasks, who));
    const own = who === state.me?.user_id;
    const counts = { atrasadas: 0, agora: 0 };
    const groups = GROUPS.map((g) => ({ ...g, items: [] }));
    rows.forEach((c) => {
      const n = daysUntil(deadlineOf(c));
      const done = ["pronto_para_agendar", "agendado"].includes(c.production_status);
      const group = done ? groups.find((g) => g.key === "depois") : groups.find((g) => g.test(n));
      group.items.push(c);
      if (!done && group.key in counts) counts[group.key] += 1;
    });
    const picker = state.can.edit && state.team.length > 1
      ? `<label class="field task-summary__who"><span class="field__label">Demandas de</span><select class="field__input" data-task-person>
          ${state.team.filter((m) => m.active !== false).map((m) => `<option value="${esc(m.user_id)}" ${m.user_id === who ? "selected" : ""}>${esc(m.user_id === state.me?.user_id ? `${m.name || m.username} (você)` : m.name || m.username)}</option>`).join("")}
        </select></label>`
      : "";
    summary.innerHTML = `
      <ul class="task-stats">
        <li><b>${rows.length}</b><span>em aberto</span></li>
        <li class="is-late"><b>${counts.atrasadas}</b><span>atrasadas</span></li>
        <li class="is-urgent"><b>${counts.agora}</b><span>para hoje e amanhã</span></li>
      </ul>${picker}`;
    if (!rows.length) {
      list.innerHTML = stateBlock({ iconName: "check", title: own ? "Nenhuma demanda com você" : `Nenhuma demanda com ${personName(state.team, who)}`, text: own ? "Quando alguém atribuir um conteúdo a você, ele aparece aqui." : "Atribua conteúdos pelo formulário do conteúdo (Responsáveis)." });
      return;
    }
    list.innerHTML = groups.filter((g) => g.items.length).map((g) => `
      <section class="task-group task-group--${esc(g.tone)}" aria-label="${esc(g.title)}">
        <h2 class="task-group__title">${esc(g.title)} <span>${g.items.length}</span></h2>
        <div class="task-group__items">${g.items.map(card).join("")}</div>
      </section>`).join("");
  }

  async function load() {
    list.setAttribute("aria-busy", "true");
    list.innerHTML = loadingRows();
    try {
      tasks = await api.listContents({});
      render();
      syncBadge();
    } catch (error) {
      list.setAttribute("aria-busy", "false");
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar as demandas", text: error.message });
    }
  }

  /** Contador do menu: as minhas atrasadas ou para hoje/amanhã */
  function syncBadge() {
    const urgent = mine(tasks, state.me?.user_id).filter((c) => {
      if (["pronto_para_agendar", "agendado"].includes(c.production_status)) return false;
      const n = daysUntil(deadlineOf(c));
      return n !== null && n <= 1;
    }).length;
    navBadge.hidden = !urgent;
    navBadge.textContent = String(urgent);
    navBadge.setAttribute("aria-label", `${urgent} ${urgent === 1 ? "demanda atrasada ou para hoje/amanhã" : "demandas atrasadas ou para hoje/amanhã"}`);
  }
  async function refreshCount() {
    try { tasks = await api.listContents({}); syncBadge(); } catch { /* o contador é só um lembrete */ }
  }

  on(summary, "change", "[data-task-person]", (event, select) => { person = select.value; render(); });
  on(list, "click", "[data-open-task]", (event, button) => openContent(button.dataset.openTask));
  on(list, "change", "[data-task-prod]", async (event, select) => {
    const id = select.dataset.taskProd;
    select.disabled = true;
    try {
      const saved = await api.setContentProduction(id, select.value || null);
      tasks = tasks.map((c) => (c.id === id ? { ...c, ...saved, assignees: c.assignees } : c));
      toast(`Produção: ${PRODUCTION_STATUS[select.value]?.label || "não iniciada"}`);
      render();
      syncBadge();
    } catch (error) {
      toast(error.message, "error");
      select.disabled = false;
    }
  });
  document.addEventListener("content-saved", () => { if (state.route === "demandas") load(); else refreshCount(); });

  return { load, refreshCount, reset() { tasks = []; person = null; navBadge.hidden = true; } };
}
