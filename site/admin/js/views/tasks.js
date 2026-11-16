/* Minhas demandas: tudo o que está com a pessoa, num lugar só, do prazo mais
   apertado para o mais folgado:
   - demandas e subtarefas do quadro (Gestão de demandas) em que ela é responsável;
   - conteúdos do calendário em que ela é responsável (prazo interno; sem ele,
     a data de publicação).
   Demanda que acabou de chegar aparece marcada como "Nova" até ser aberta.
   O administrador (e quem edita tudo) pode ver as demandas de outra pessoa.
   Dá para mudar a etapa ali mesmo e abrir o item. */

import { $, esc, on } from "../../../js/lib/dom.js?v=8bfb16b6bd";
import { icon } from "../../../js/lib/icons.js?v=8bfb16b6bd";
import { typeBadge } from "../../../js/ui/badges.js?v=8bfb16b6bd";
import { PRODUCTION_STATUS, PRIORITIES } from "../domain/rules.js?v=8bfb16b6bd";
import { TASK_STATUS, TASK_PRIORITIES, dueParts, dueState } from "../domain/tasks.js?v=8bfb16b6bd";
import { stateBlock, loadingRows } from "../ui/states.js?v=8bfb16b6bd";
import { stageChips, dueChip, priorityChip, daysUntil, personName } from "./contents.js?v=8bfb16b6bd";

const shortDate = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "—");
const GROUPS = [
  { key: "atrasadas", title: "Atrasadas", tone: "late", test: (n) => n !== null && n < 0 },
  { key: "agora", title: "Hoje e amanhã", tone: "urgent", test: (n) => n !== null && n <= 1 },
  { key: "semana", title: "Próximos 7 dias", tone: "soon", test: (n) => n !== null && n <= 7 },
  { key: "depois", title: "Mais adiante", tone: "ok", test: (n) => n !== null },
  { key: "sem", title: "Sem data", tone: "ok", test: () => true }
];
const NEW_KINDS = ["tarefa_atribuida"];

/** Prazo que vale para a urgência: o interno; sem ele, a publicação */
export const deadlineOf = (c) => c.due_date || c.scheduled_date || null;
export const isOpenTask = (c) => c.production_status !== "publicado";

export function setupTasks({ api, state, toast, openContent, openTask, unreadFor }) {
  const list = $("#task-list");
  const summary = $("#task-summary");
  const navBadge = document.querySelector("[data-my-tasks]");
  let contents = [];
  let boardTasks = [];
  let person = null;     // de quem são as demandas mostradas (padrão: eu)

  const clientName = (id) => (id ? state.clients.find((c) => c.id === id)?.name || "Cliente" : "Interno da agência");
  const assignedTo = (t, who) => (t.task_assignees || []).some((a) => a.user_id === who);
  const isLate = (t) => Boolean(t.due_at) && new Date(t.due_at) < new Date();

  /** Conteúdos e demandas da pessoa, no mesmo formato: { kind, item, date (AAAA-MM-DD), rank, done } */
  function itemsOf(who) {
    // Conteúdo que já tem demanda de produção com a pessoa aparece uma vez só: como a demanda (que leva ao conteúdo)
    const linked = new Set(boardTasks.filter((t) => t.content_id && !t.parent_id && !t.archived_at && assignedTo(t, who)).map((t) => t.content_id));
    const fromContents = contents.filter((c) => (c.assignees || []).includes(who) && isOpenTask(c) && !linked.has(c.id)).map((c) => ({
      kind: "conteudo", item: c, date: deadlineOf(c), at: "", rank: PRIORITIES[c.priority]?.rank ?? 2,
      done: ["pronto_para_agendar", "agendado"].includes(c.production_status)
    }));
    const fromBoard = boardTasks.filter((t) => assignedTo(t, who) && t.status !== "concluido" && !t.archived_at).map((t) => ({
      kind: "demanda", item: t, date: t.due_at ? dueParts(t.due_at).date : null, at: t.due_at || "",
      rank: TASK_PRIORITIES[t.priority]?.rank ?? 2, done: false
    }));
    return [...fromBoard, ...fromContents].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")
      || (a.at || "99").localeCompare(b.at || "99") || a.rank - b.rank || a.item.title.localeCompare(b.item.title));
  }

  function contentCard(c) {
    const prod = c.production_status || "";
    return `
      <article class="task-card task-card--${esc(c.priority || "media")}" data-task="${esc(c.id)}">
        <div class="task-card__main">
          <p class="task-card__client"><span class="task-card__kind">${icon("calendar")}Conteúdo</span> · ${esc(clientName(c.client_id))}</p>
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

  function boardCard(t, fresh, who) {
    const due = dueState(t.due_at, t.status);
    const parent = t.parent_id ? boardTasks.find((x) => x.id === t.parent_id) : null;
    const others = (t.task_assignees || []).map((a) => a.user_id).filter((id) => id !== who);
    return `
      <article class="task-card task-card--${esc(t.priority || "media")} task-card--demanda${fresh ? " is-new" : ""}" data-board-task="${esc(t.id)}">
        <div class="task-card__main">
          <p class="task-card__client"><span class="task-card__kind">${icon("layers")}${t.parent_id ? "Subtarefa" : "Demanda"}</span> · ${esc(clientName(t.client_id))}${fresh ? ' <span class="new-chip">Nova</span>' : ""}</p>
          <button class="task-card__title" type="button" data-open-board-task="${esc(t.id)}">${esc(t.title)}</button>
          <p class="task-card__meta">
            ${due ? `<span class="due-pill due-pill--${esc(due.tone)}">${icon("clock")}${esc(due.label)} · ${esc(dueParts(t.due_at).time)}</span>` : '<span class="task-card__date">Sem prazo</span>'}
            ${t.priority === "alta" || t.priority === "urgente" ? `<span class="prio-chip prio-chip--${esc(t.priority)}">${esc(TASK_PRIORITIES[t.priority].label)}</span>` : ""}
            ${parent ? `<span class="task-card__date">${icon("arrowRight")}em "${esc(parent.title)}"</span>` : ""}
            ${t.content_id ? `<button class="link-btn task-card__link" type="button" data-open-task="${esc(t.content_id)}">${icon("calendar")}Ver o conteúdo</button>` : ""}
            ${others.length ? `<span class="task-card__date">${icon("users")}com ${esc(others.map((id) => personName(state.team, id).split(" ")[0]).join(", "))}</span>` : ""}
          </p>
        </div>
        <label class="task-card__prod">
          <span class="field__label">Etapa</span>
          <select class="field__input" data-task-status="${esc(t.id)}">
            ${Object.entries(TASK_STATUS).map(([k, v]) => `<option value="${esc(k)}" ${k === t.status ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
          </select>
        </label>
      </article>`;
  }

  function render() {
    list.setAttribute("aria-busy", "false");
    const who = person || state.me?.user_id;
    const own = who === state.me?.user_id;
    const rows = itemsOf(who);
    const fresh = own ? unreadFor(NEW_KINDS) : new Set();
    const counts = { atrasadas: 0, agora: 0 };
    const groups = GROUPS.map((g) => ({ ...g, items: [] }));
    rows.forEach((r) => {
      const n = daysUntil(r.date);
      const group = r.done ? groups.find((g) => g.key === "depois")
        : r.kind === "demanda" && isLate(r.item) ? groups[0] : groups.find((g) => g.test(n));
      group.items.push(r);
      if (!r.done && group.key in counts) counts[group.key] += 1;
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
      list.innerHTML = stateBlock({ iconName: "check", title: own ? "Nenhuma demanda com você" : `Nenhuma demanda com ${personName(state.team, who)}`, text: own ? "Quando alguém te passar uma demanda ou um conteúdo, aparece aqui na hora." : "Passe demandas pelo quadro (Demandas) ou pelos conteúdos (Responsáveis)." });
      return;
    }
    list.innerHTML = groups.filter((g) => g.items.length).map((g) => `
      <section class="task-group task-group--${esc(g.tone)}" aria-label="${esc(g.title)}">
        <h2 class="task-group__title">${esc(g.title)} <span>${g.items.length}</span></h2>
        <div class="task-group__items">${g.items.map((r) => (r.kind === "demanda" ? boardCard(r.item, fresh.has(r.item.id), who) : contentCard(r.item))).join("")}</div>
      </section>`).join("");
  }

  async function fetchAll() {
    [contents, boardTasks] = await Promise.all([api.listContents({}), api.listTasks().catch(() => [])]);
  }
  let first = true;
  async function load() {
    list.setAttribute("aria-busy", "true");
    if (first) list.innerHTML = loadingRows();
    try {
      await fetchAll();
      first = false;
      render();
      syncBadge();
    } catch (error) {
      list.setAttribute("aria-busy", "false");
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar as demandas", text: error.message });
    }
  }

  /** Contador do menu: as minhas atrasadas ou para hoje/amanhã, mais as que acabaram de chegar */
  function syncBadge() {
    const me = state.me?.user_id;
    const mine = itemsOf(me);
    const urgent = mine.filter((r) => !r.done && ((r.kind === "demanda" && isLate(r.item)) || (daysUntil(r.date) !== null && daysUntil(r.date) <= 1))).map((r) => r.item.id);
    const fresh = [...unreadFor(NEW_KINDS)].filter((id) => mine.some((r) => r.item.id === id));
    const n = new Set([...urgent, ...fresh]).size;
    navBadge.hidden = !n;
    navBadge.textContent = String(n);
    navBadge.setAttribute("aria-label", `${n} ${n === 1 ? "demanda nova, atrasada ou para hoje/amanhã" : "demandas novas, atrasadas ou para hoje/amanhã"}`);
  }
  async function refreshCount() {
    try { await fetchAll(); syncBadge(); } catch { /* o contador é só um lembrete */ }
  }
  /** Chegou algo novo: atualiza a lista à vista ou só o contador */
  async function refresh() {
    if (state.route === "demandas") { await load(); return; }
    await refreshCount();
  }

  on(summary, "change", "[data-task-person]", (event, select) => { person = select.value; render(); });
  on(list, "click", "[data-open-task]", (event, button) => openContent(button.dataset.openTask));
  on(list, "click", "[data-open-board-task]", (event, button) => openTask(button.dataset.openBoardTask));
  on(list, "change", "[data-task-prod]", async (event, select) => {
    const id = select.dataset.taskProd;
    select.disabled = true;
    try {
      const saved = await api.setContentProduction(id, select.value || null);
      contents = contents.map((c) => (c.id === id ? { ...c, ...saved, assignees: c.assignees } : c));
      toast(`Produção: ${PRODUCTION_STATUS[select.value]?.label || "não iniciada"}`);
      render();
      syncBadge();
    } catch (error) {
      toast(error.message, "error");
      select.disabled = false;
    }
  });
  on(list, "change", "[data-task-status]", async (event, select) => {
    const t = boardTasks.find((x) => x.id === select.dataset.taskStatus);
    if (!t) return;
    select.disabled = true;
    try {
      const saved = await api.updateTask(t.id, t.version, { status: select.value });
      boardTasks = boardTasks.map((x) => (x.id === t.id ? { ...x, ...saved } : x));
      toast(select.value === "concluido" ? `"${t.title}" concluída` : `Etapa: ${TASK_STATUS[select.value].label}`);
      render();
      syncBadge();
    } catch (error) {
      toast(error.message, error.status === 409 ? "info" : "error");
      await load();
    }
  });
  document.addEventListener("content-saved", () => refresh());
  // Demanda salva no painel lateral (etapa, responsáveis, prazo…): a lista acompanha sem buscar tudo de novo
  document.addEventListener("task-saved", (event) => {
    const t = event.detail;
    if (!t?.id || first) return;
    const i = boardTasks.findIndex((x) => x.id === t.id);
    if (i >= 0) boardTasks[i] = { ...boardTasks[i], ...t };
    else boardTasks.push(t);
    if (state.route === "demandas") render();
    syncBadge();
  });

  return {
    load, refresh, refreshCount,
    /** Os avisos mudaram (ex.: abriu uma demanda nova): redesenha sem buscar de novo */
    repaint() { if (!first && state.route === "demandas") render(); syncBadge(); },
    reset() { contents = []; boardTasks = []; person = null; first = true; navBadge.hidden = true; }
  };
}
