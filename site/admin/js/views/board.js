/* Gestão de demandas: o quadro Kanban da agência.
   - Colunas personalizáveis (nome, cor, ordem, esconder), cada uma ligada a um
     status oficial; arrastar o card grava a coluna e o status.
   - Cards compactos: etiquetas, título, cliente, prazo, prioridade, subtarefas
     e responsáveis. Clicar abre o painel lateral.
   - Filtros: cliente (ou interno), pessoa, projeto, etiqueta e busca; ficam
     guardados neste navegador.
   - "+ Adicionar" no pé de cada coluna cria na hora, já naquela coluna.
   Mostra só as demandas principais; as subtarefas contam no card. */

import { $, esc, on } from "../../../js/lib/dom.js?v=8083d4a8ab";
import { icon } from "../../../js/lib/icons.js?v=8083d4a8ab";
import { TASK_STATUS, TASK_PRIORITIES, COLORS, dueState } from "../domain/tasks.js?v=8083d4a8ab";
import { closeDialog, wireDialog } from "../ui/dialogs.js?v=8083d4a8ab";
import { stateBlock } from "../ui/states.js?v=8083d4a8ab";
import { avatars, clientDotClass } from "./contents.js?v=8083d4a8ab";
import { setupTaskPanel } from "./task-panel.js?v=8083d4a8ab";

const FILTER_KEY = "dg-painel-quadro-filtros";
const options = (entries, selected = "") => entries.map(([v, l]) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(l)}</option>`).join("");
const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function setupBoard({ api, state, toast, confirm, openContent }) {
  const view = $("#view-gestao");
  const root = $("#tboard");
  const bar = $("#board-bar");
  let tasks = [];
  let columns = [];
  let labels = [];
  let projects = [];
  let loaded = false;
  let filters = (() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") || {}; } catch { return {}; } })();

  const board = {
    tasks: () => tasks, columns: () => columns, labels: () => labels, projects: () => projects,
    upsert(task) {
      const i = tasks.findIndex((t) => t.id === task.id);
      if (task.archived_at) { if (i >= 0) tasks.splice(i, 1); }
      else if (i >= 0) tasks[i] = { ...tasks[i], ...task };
      else tasks.push(task);
      if (state.route === "gestao") render();
    },
    remove(id) { tasks = tasks.filter((t) => t.id !== id && t.parent_id !== id); if (state.route === "gestao") render(); },
    addProject(p) { projects.push(p); }
  };
  const panel = setupTaskPanel({ api, state, toast, confirm, board, openContent });

  const clientDot = (id) => clientDotClass(state.clients, id);
  const clientName = (id) => (id ? state.clients.find((c) => c.id === id)?.name || "Cliente" : "Interno");
  const labelById = (id) => labels.find((l) => l.id === id);

  /* ---------------- Filtros ---------------- */
  function renderBar() {
    const people = state.team.filter((m) => m.active !== false);
    bar.innerHTML = `
      <label class="board-search">${icon("eye")}<span class="visually-hidden">Buscar</span><input class="field__input" type="search" name="q" placeholder="Buscar demanda" value="${esc(filters.q || "")}"></label>
      <select class="field__input" name="client" aria-label="Cliente"><option value="">Toda a agência</option><option value="interno"${filters.client === "interno" ? " selected" : ""}>Interno da agência</option>${options(state.clients.filter((c) => c.active).map((c) => [c.id, c.name]), filters.client)}</select>
      <select class="field__input" name="person" aria-label="Pessoa"><option value="">Todas as pessoas</option><option value="me"${filters.person === "me" ? " selected" : ""}>Só as minhas</option>${options(people.map((m) => [m.user_id, m.name || m.username]), filters.person)}</select>
      <select class="field__input" name="project" aria-label="Projeto"><option value="">Todos os projetos</option>${options(projects.filter((p) => !p.archived_at && (!filters.client || filters.client === p.client_id)).map((p) => [p.id, `${p.name} · ${clientName(p.client_id)}`]), filters.project)}</select>
      <select class="field__input" name="label" aria-label="Etiqueta"><option value="">Todas as etiquetas</option>${options(labels.filter((l) => !l.archived_at).map((l) => [l.id, l.name]), filters.label)}</select>
      ${Object.values(filters).some(Boolean) ? '<button class="link-btn" type="button" data-board-clear>Limpar</button>' : ""}`;
  }
  function saveFilters() { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* só não lembra */ } }
  on(bar, "change", "select", (event, el) => { filters[el.name] = el.value; if (el.name === "client") filters.project = ""; saveFilters(); renderBar(); render(); });
  let typing = null;
  on(bar, "input", "[name=q]", (event, el) => { clearTimeout(typing); typing = setTimeout(() => { filters.q = el.value; saveFilters(); render(); }, 150); });
  on(bar, "click", "[data-board-clear]", () => { filters = {}; saveFilters(); renderBar(); render(); });

  function matches(t) {
    const me = state.me?.user_id;
    const who = filters.person === "me" ? me : filters.person;
    const subs = tasks.filter((s) => s.parent_id === t.id);
    const hasPerson = (x) => (x.task_assignees || []).some((a) => a.user_id === who);
    if (filters.client === "interno" ? t.client_id : filters.client && t.client_id !== filters.client) return false;
    if (filters.project && t.project_id !== filters.project) return false;
    if (filters.label && !(t.task_labels || []).some((l) => l.label_id === filters.label)) return false;
    if (who && !hasPerson(t) && !subs.some(hasPerson)) return false;
    if (filters.q && !fold(t.title).includes(fold(filters.q))) return false;
    return true;
  }

  /* ---------------- Quadro ---------------- */
  const columnOf = (t) => columns.find((c) => c.id === t.column_id && !c.hidden) || columns.find((c) => !c.hidden && c.status === t.status);
  function card(t) {
    const subs = tasks.filter((s) => s.parent_id === t.id);
    const done = subs.filter((s) => s.status === "concluido").length;
    const due = dueState(t.due_at, t.status);
    const tLabels = (t.task_labels || []).map((l) => labelById(l.label_id)).filter(Boolean);
    const ids = (t.task_assignees || []).map((a) => a.user_id);
    return `
      <article class="tcard${t.status === "concluido" ? " is-done" : ""}" draggable="true" data-tcard="${esc(t.id)}">
        <button class="tcard__open" type="button" data-task-open-card="${esc(t.id)}" aria-label="Abrir ${esc(t.title)}"></button>
        ${tLabels.length ? `<p class="tcard__labels">${tLabels.map((l) => `<span class="label-chip label-chip--${esc(l.color)}">${esc(l.name)}</span>`).join("")}</p>` : ""}
        <p class="tcard__title">${esc(t.title)}</p>
        <p class="tcard__client"><span class="cli-dot ${clientDot(t.client_id)}" aria-hidden="true"></span>${esc(clientName(t.client_id))}${t.content_id ? ` <span class="tcard__flag" title="Ligada a um conteúdo do calendário">${icon("calendar")}</span>` : ""}</p>
        <div class="tcard__foot">
          <span class="tcard__meta">
            ${due ? `<span class="due-pill due-pill--${esc(due.tone)}" title="Entrega">${icon("clock")}${esc(due.label)}</span>` : ""}
            ${t.priority === "alta" || t.priority === "urgente" ? `<span class="prio-flag prio-flag--${esc(t.priority)}" title="Prioridade ${esc(TASK_PRIORITIES[t.priority].label.toLowerCase())}">${icon("target")}${esc(TASK_PRIORITIES[t.priority].label)}</span>` : ""}
            ${subs.length ? `<span class="tcard__count${done === subs.length ? " is-done" : ""}" title="Subtarefas concluídas">${icon("check")}${done}/${subs.length}</span>` : ""}
          </span>
          ${ids.length ? avatars(state.team, ids) : ""}
        </div>
      </article>`;
  }
  function render() {
    root.setAttribute("aria-busy", "false");
    if (!loaded) return;
    const visible = columns.filter((c) => !c.hidden);
    const top = tasks.filter((t) => !t.parent_id && !t.archived_at && matches(t));
    const any = Object.values(filters).some(Boolean);
    view.querySelector("[data-board-count]").textContent = `${top.length} ${top.length === 1 ? "demanda" : "demandas"}${any ? " com esses filtros" : ""}`;
    root.innerHTML = visible.map((c) => {
      const items = top.filter((t) => columnOf(t)?.id === c.id).sort((a, b) => a.position - b.position);
      return `
        <section class="tcol tcol--${esc(c.color)}" data-tcol="${esc(c.id)}" aria-label="${esc(c.name)}">
          <header class="tcol__head"><span class="tcol__dot" aria-hidden="true"></span><h2 class="tcol__name">${esc(c.name)}</h2><span class="tcol__count">${items.length}</span></header>
          <div class="tcol__items" data-tcol-items="${esc(c.id)}">${items.map(card).join("")}</div>
          <form class="tcol__add" data-quick-add="${esc(c.id)}" novalidate>
            <input class="field__input" name="title" maxlength="200" placeholder="+ Adicionar demanda" aria-label="Nova demanda em ${esc(c.name)}" autocomplete="off">
          </form>
        </section>`;
    }).join("");
  }

  async function load() {
    renderBar();
    if (!loaded) { root.setAttribute("aria-busy", "true"); root.innerHTML = `<div class="tcol tcol--loading skeleton"></div>`.repeat(4); }
    try {
      [tasks, columns, labels, projects] = await Promise.all([api.listTasks(), api.listColumns(), api.listLabels(), api.listProjects()]);
      loaded = true;
      renderBar();
      render();
    } catch (error) {
      root.setAttribute("aria-busy", "false");
      root.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar as demandas", text: error.message });
    }
  }

  /* ---------------- Criar ---------------- */
  // Herda o que estiver filtrado (cliente e pessoa): quem filtrou "Cliente X" já cria para o Cliente X
  const presetFromFilters = () => ({
    client_id: filters.client && filters.client !== "interno" ? filters.client : "",
    assignees: filters.person ? [filters.person === "me" ? state.me?.user_id : filters.person].filter(Boolean) : undefined
  });
  on(document, "click", '[data-action="new-task"]', () => panel.openNew(presetFromFilters()));
  on(root, "submit", "[data-quick-add]", async (event, form) => {
    event.preventDefault();
    const input = form.elements.title;
    const title = input.value.trim();
    if (!title) return;
    input.disabled = true;
    const preset = presetFromFilters();
    try {
      const created = await api.createTask({ title, client_id: preset.client_id, column_id: form.dataset.quickAdd }, { assignees: preset.assignees || [state.me?.user_id].filter(Boolean) });
      board.upsert(created);
      toast("Demanda criada");
      root.querySelector(`[data-quick-add="${form.dataset.quickAdd}"] [name=title]`)?.focus();
    } catch (error) { toast(error.message, "error"); input.disabled = false; }
  });
  on(root, "click", "[data-task-open-card]", (event, b) => panel.open(b.dataset.taskOpenCard));

  /* ---------------- Arrastar entre colunas (e reordenar) ---------------- */
  let dragId = null;
  root.addEventListener("dragstart", (event) => {
    const el = event.target.closest?.("[data-tcard]");
    if (!el) return;
    dragId = el.dataset.tcard;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragId);
    requestAnimationFrame(() => el.classList.add("is-dragging"));
  });
  const marker = document.createElement("div");
  marker.className = "tcard-drop";
  const clear = () => { marker.remove(); root.querySelectorAll(".is-dragging, .is-drop").forEach((n) => n.classList.remove("is-dragging", "is-drop")); };
  root.addEventListener("dragend", () => { dragId = null; clear(); });
  /** Card antes do qual o arrastado vai entrar (pela altura do mouse) */
  function beforeCard(list, y) {
    return [...list.querySelectorAll("[data-tcard]:not(.is-dragging)")].find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
  }
  root.addEventListener("dragover", (event) => {
    const col = dragId && event.target.closest?.("[data-tcol]");
    if (!col) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    root.querySelectorAll(".is-drop").forEach((n) => n !== col && n.classList.remove("is-drop"));
    col.classList.add("is-drop");
    const list = col.querySelector("[data-tcol-items]");
    const before = beforeCard(list, event.clientY);
    if (before) list.insertBefore(marker, before); else list.appendChild(marker);
  });
  root.addEventListener("drop", async (event) => {
    const col = dragId && event.target.closest?.("[data-tcol]");
    const id = dragId;
    if (!col || !id) { clear(); return; }
    event.preventDefault();
    // Vizinhos do marcador (ignorando o próprio card): a posição nova fica entre eles
    const isCard = (n) => n?.dataset?.tcard && n.dataset.tcard !== id;
    let p = marker.previousElementSibling; while (p && !isCard(p)) p = p.previousElementSibling;
    let n = marker.nextElementSibling; while (n && !isCard(n)) n = n.nextElementSibling;
    const prev = p ? tasks.find((t) => t.id === p.dataset.tcard) : null;
    const next = n ? tasks.find((t) => t.id === n.dataset.tcard) : null;
    clear();
    dragId = null;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : t.position;
    const target = columns.find((c) => c.id === col.dataset.tcol);
    if (t.column_id === target.id && position === t.position) return;
    await move(t, target, position);
  });
  /** Move com resposta imediata; se o banco recusar, volta como estava */
  async function move(t, target, position) {
    const before = { ...t };
    Object.assign(t, { column_id: target.id, status: target.status, position });
    render();
    try {
      const saved = await api.updateTask(t.id, before.version, { column_id: target.id, position });
      Object.assign(t, saved);
      render();
      if (before.column_id !== target.id) toast(`"${t.title}" → ${target.name}`);
    } catch (error) {
      Object.assign(t, before);
      render();
      toast(error.message, error.status === 409 ? "info" : "error");
      if (error.status === 409) load();
    }
  }

  /* ---------------- Colunas (só administrador) ---------------- */
  const colModal = $("#columns-modal");
  const colList = colModal.querySelector("[data-columns]");
  wireDialog(colModal);
  function renderColumns() {
    const sorted = [...columns].sort((a, b) => a.position - b.position);
    colList.innerHTML = sorted.map((c, i) => `
      <li class="colrow" data-colrow="${esc(c.id)}">
        <span class="tcol__dot tcol--${esc(c.color)}" aria-hidden="true"></span>
        <input class="field__input" data-col-field="name" value="${esc(c.name)}" maxlength="40" aria-label="Nome da coluna">
        <select class="field__input" data-col-field="status" aria-label="Etapa oficial" title="Etapa oficial (vale nos relatórios e nas regras)">${options(Object.entries(TASK_STATUS).map(([k, v]) => [k, v.label]), c.status)}</select>
        <select class="field__input" data-col-field="color" aria-label="Cor">${options(Object.entries(COLORS), c.color)}</select>
        <label class="check"><input type="checkbox" data-col-field="hidden" ${c.hidden ? "checked" : ""}><span>Esconder</span></label>
        <span class="colrow__move">
          <button class="icon-btn" type="button" data-col-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">${icon("chevronLeft")}</button>
          <button class="icon-btn" type="button" data-col-move="1" ${i === sorted.length - 1 ? "disabled" : ""} aria-label="Descer">${icon("chevronRight")}</button>
          <button class="icon-btn icon-btn--danger" type="button" data-col-delete aria-label="Apagar coluna">${icon("trash")}</button>
        </span>
      </li>`).join("");
  }
  on(document, "click", '[data-action="board-columns"]', () => { renderColumns(); colModal.showModal(); });
  on(colList, "change", "[data-col-field]", async (event, el) => {
    const id = el.closest("[data-colrow]").dataset.colrow;
    const field = el.dataset.colField;
    const value = field === "hidden" ? el.checked : el.value;
    if (field === "hidden" && value && columns.filter((c) => !c.hidden && c.id !== id).length === 0) { el.checked = false; toast("Deixe pelo menos uma coluna à vista.", "info"); return; }
    try {
      const saved = await api.saveColumn(id, { [field]: value });
      columns = columns.map((c) => (c.id === id ? saved : c));
      renderColumns();
      render();
      toast("Coluna salva");
    } catch (error) { toast(error.message, "error"); renderColumns(); }
  });
  on(colList, "click", "[data-col-move]", async (event, b) => {
    const sorted = [...columns].sort((a, c) => a.position - c.position);
    const i = sorted.findIndex((c) => c.id === b.closest("[data-colrow]").dataset.colrow);
    const j = i + Number(b.dataset.colMove);
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    try {
      const saved = await Promise.all(sorted.map((c, k) => (c.position === k + 1 ? c : api.saveColumn(c.id, { position: k + 1 }))));
      columns = saved;
      renderColumns();
      render();
    } catch (error) { toast(error.message, "error"); }
  });
  on(colList, "click", "[data-col-delete]", async (event, b) => {
    const id = b.closest("[data-colrow]").dataset.colrow;
    const col = columns.find((c) => c.id === id);
    const n = tasks.filter((t) => !t.parent_id && columnOf(t)?.id === id).length;
    const same = columns.filter((c) => c.status === col.status && c.id !== id);
    if (!same.length) { toast(`Precisa existir ao menos uma coluna com a etapa "${TASK_STATUS[col.status].label}". Mude a etapa de outra coluna antes.`, "info"); return; }
    const ok = await confirm({ title: `Apagar a coluna "${col.name}"?`, text: n ? `As ${n} demandas dela vão para "${same[0].name}" (mesma etapa). Nenhuma demanda é apagada.` : "Nenhuma demanda está nela.", confirmLabel: "Apagar coluna" });
    if (!ok) return;
    try {
      await api.deleteColumn(id);
      columns = columns.filter((c) => c.id !== id);
      tasks.forEach((t) => { if (t.column_id === id) t.column_id = null; });
      renderColumns();
      render();
      toast("Coluna apagada");
    } catch (error) { toast(error.message, "error"); }
  });
  colModal.querySelector("[data-col-add]").addEventListener("click", async () => {
    try {
      const saved = await api.saveColumn(null, { name: "Nova coluna", status: "em_andamento", color: "azul", position: columns.length + 1 });
      columns.push(saved);
      renderColumns();
      render();
      colList.querySelector(`[data-colrow="${saved.id}"] [data-col-field="name"]`)?.select();
    } catch (error) { toast(error.message, "error"); }
  });

  // Atalho: N cria demanda (fora de campos de texto)
  document.addEventListener("keydown", (event) => {
    if (state.route !== "gestao" || event.key.toLowerCase() !== "n" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
    event.preventDefault();
    panel.openNew(presetFromFilters());
  });

  return { load, openTask: (id) => panel.open(id), openNew: (preset) => panel.openNew(preset), reset() { tasks = []; loaded = false; } };
}
