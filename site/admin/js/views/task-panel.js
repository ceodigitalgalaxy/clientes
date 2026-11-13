/* Painel lateral da demanda (Gestão de demandas).
   - Nova demanda: só o essencial (título, cliente, responsáveis, entrega,
     descrição, etiquetas). O resto se completa depois.
   - Demanda aberta: tudo editável ali mesmo; cada mudança salva sozinha
     ("Salvo ✓"). Se outra pessoa salvou antes, avisa e recarrega (version).
   O banco confere quem pode ver, criar, editar, delegar e arquivar. */

import { $, esc, on } from "../../../js/lib/dom.js?v=8083d4a8ab";
import { icon } from "../../../js/lib/icons.js?v=8083d4a8ab";
import { stampLabel } from "../../../js/lib/dates.js?v=8083d4a8ab";
import { TASK_STATUS, TASK_PRIORITIES, dueParts, dueState } from "../domain/tasks.js?v=8083d4a8ab";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=8083d4a8ab";
import { kebab } from "../ui/menu.js?v=8083d4a8ab";
import { seesClient, personName, clientDotClass } from "./contents.js?v=8083d4a8ab";

const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const options = (entries, selected = "") => entries.map(([v, l]) => `<option value="${esc(v)}"${v === (selected ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("");

const EVENT_TEXT = {
  criada: () => "Demanda criada",
  status: (e) => `Etapa: ${TASK_STATUS[e.to_value]?.label || e.to_value}`,
  responsavel_adicionado: (e) => `${e.metadata?.name || "Alguém"} virou responsável`,
  responsavel_removido: (e) => `${e.metadata?.name || "Alguém"} saiu da demanda`,
  prazo: (e) => (e.to_value ? `Entrega: ${new Date(e.to_value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Prazo removido"),
  prioridade: (e) => `Prioridade: ${TASK_PRIORITIES[e.to_value]?.label || e.to_value}`,
  titulo: (e) => `Título: "${e.to_value}"`,
  cliente: () => "Cliente alterado",
  conteudo: (e) => (e.to_value ? "Ligada a um conteúdo do calendário" : "Desligada do conteúdo"),
  arquivada: () => "Arquivada",
  restaurada: () => "Restaurada"
};

/**
 * board: { tasks(), columns(), labels(), projects(), upsert(task), remove(id), reload() }
 * openContent(id): abre o conteúdo do calendário
 */
export function setupTaskPanel({ api, state, toast, confirm, board, openContent }) {
  const drawer = $("#task-drawer");
  const body = $("#task-body");
  const tools = $("#task-tools");
  const badges = $("#task-badges");
  let current = null;        // tarefa aberta
  let saving = false;
  let lastFlash = null;      // "Salvo ✓" continua à vista quando o painel se redesenha
  wireDialog(drawer, { canClose: () => !saving });

  const clientName = (id) => (id ? state.clients.find((c) => c.id === id)?.name || "Cliente removido" : "Interno da agência");
  const canTake = (m, clientId) => m.active !== false && (!clientId || seesClient(m, clientId));
  const people = (clientId) => state.team.filter((m) => canTake(m, clientId));
  const visibleClients = () => state.clients.filter((c) => c.active);

  function peoplePicker(clientId, chosen) {
    const list = people(clientId);
    if (!list.length) return '<p class="field__hint">Ninguém da equipe enxerga este cliente.</p>';
    return `<div class="pick-people">${list.map((m) => `
      <label class="pick-person"><input type="checkbox" name="assignee" value="${esc(m.user_id)}" ${chosen.includes(m.user_id) ? "checked" : ""}>
        <span class="avatar">${esc(initials(m.name || m.username))}</span><span>${esc(m.name || m.username)}${m.user_id === state.me?.user_id ? " (você)" : ""}</span></label>`).join("")}</div>`;
  }
  function labelPicker(chosen) {
    const list = board.labels().filter((l) => !l.archived_at);
    return `<div class="pick-labels">${list.map((l) => `
      <label class="pick-label"><input type="checkbox" name="label" value="${esc(l.id)}" ${chosen.includes(l.id) ? "checked" : ""}><span class="label-chip label-chip--${esc(l.color)}">${esc(l.name)}</span></label>`).join("")}</div>`;
  }

  /* ---------------- Nova demanda (criação rápida) ---------------- */
  function openNew(preset = {}) {
    current = null;
    badges.innerHTML = `<span class="appr-chip appr-chip--neutral">${icon("sparkle")}Nova demanda</span>`;
    tools.innerHTML = "";
    const clientId = preset.client_id ?? "";
    body.innerHTML = `
      <form class="task-new" data-task-new novalidate>
        <label class="field"><span class="visually-hidden">Título</span>
          <input class="task-new__title" name="title" maxlength="200" placeholder="O que precisa ser feito?" autocomplete="off" required></label>
        <div class="form-grid">
          <label class="field"><span class="field__label">Cliente</span>
            <select class="field__input" name="client_id"><option value="">Interno da agência</option>${options(visibleClients().map((c) => [c.id, c.name]), clientId)}</select></label>
          <div class="field"><span class="field__label">Entrega</span>
            <span class="input-row"><input class="field__input" type="date" name="due_date" value="${esc(preset.due_date || "")}"><input class="field__input task-time" type="time" name="due_time" value="${esc(preset.due_time || "")}"></span></div>
        </div>
        <fieldset class="field"><legend class="field__label">Responsáveis</legend><div data-new-people>${peoplePicker(clientId, preset.assignees || [state.me?.user_id].filter(Boolean))}</div></fieldset>
        <label class="field"><span class="field__label">Descrição <span class="field__optional">(opcional)</span></span>
          <textarea class="field__input" name="description" rows="3" maxlength="10000" placeholder="Detalhes, referências, o que é esperado…"></textarea></label>
        <fieldset class="field"><legend class="field__label">Etiquetas <span class="field__optional">(opcional)</span></legend>${labelPicker(preset.labels || [])}</fieldset>
        <p class="form-error" role="alert" hidden></p>
        <div class="task-new__actions">
          <span class="field__hint">Enter cria. Prioridade, projeto e o resto você completa depois.</span>
          <button class="btn btn--ghost" type="submit" value="open" data-open-after>Criar e abrir</button>
          <button class="btn btn--primary" type="submit" value="close">${icon("check")}<span>Criar demanda</span></button>
        </div>
        <input type="hidden" name="column_id" value="${esc(preset.column_id || "")}">
        <input type="hidden" name="parent_id" value="${esc(preset.parent_id || "")}">
        <input type="hidden" name="content_id" value="${esc(preset.content_id || "")}">
      </form>`;
    if (!drawer.open) drawer.showModal();
    body.querySelector("[name=title]").focus();
  }
  on(body, "change", "[data-task-new] [name=client_id]", (event, select) => {
    const chosen = [...body.querySelectorAll("[data-task-new] [name=assignee]:checked")].map((b) => b.value);
    body.querySelector("[data-new-people]").innerHTML = peoplePicker(select.value, chosen);
  });
  on(body, "submit", "[data-task-new]", async (event, form) => {
    event.preventDefault();
    const openAfter = event.submitter?.value === "open";
    const data = Object.fromEntries(new FormData(form));
    const assignees = [...form.querySelectorAll("[name=assignee]:checked")].map((b) => b.value);
    const labels = [...form.querySelectorAll("[name=label]:checked")].map((b) => b.value);
    const submit = event.submitter || form.querySelector("[type=submit]");
    saving = true;
    setBusy(submit, true);
    try {
      const created = await api.createTask({
        title: data.title, client_id: data.client_id, description: data.description, due_date: data.due_date, due_time: data.due_time,
        column_id: data.column_id || undefined, parent_id: data.parent_id || undefined, content_id: data.content_id || undefined
      }, { assignees, labels });
      board.upsert(created);
      toast("Demanda criada");
      if (openAfter) await open(created.id); else closeDialog(drawer);
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.message);
    } finally { saving = false; setBusy(submit, false); }
  });

  /* ---------------- Demanda aberta ---------------- */
  const assigneesOf = (t) => (t.task_assignees || []).map((a) => a.user_id);
  const labelsOf = (t) => (t.task_labels || []).map((l) => l.label_id);

  function render() {
    const t = current;
    const cols = board.columns().filter((c) => !c.hidden || c.id === t.column_id);
    const col = board.columns().find((c) => c.id === t.column_id) || cols.find((c) => c.status === t.status);
    const parent = t.parent_id ? board.tasks().find((x) => x.id === t.parent_id) : null;
    const subtasks = board.tasks().filter((x) => x.parent_id === t.id);
    const { date, time } = dueParts(t.due_at);
    const due = dueState(t.due_at, t.status);
    const projects = board.projects().filter((p) => p.client_id === t.client_id && !p.archived_at);
    const assigned = assigneesOf(t);
    badges.innerHTML = `<span class="col-chip col-chip--${esc(col?.color || TASK_STATUS[t.status].color)}">${esc(col?.name || TASK_STATUS[t.status].label)}</span>${t.archived_at ? `<span class="appr-chip appr-chip--neutral">${icon("box")}Arquivada</span>` : ""}<span class="save-state${lastFlash ? ` save-state--${lastFlash.tone}` : ""}" data-save-state aria-live="polite">${lastFlash ? esc(lastFlash.text) : ""}</span>`;
    tools.innerHTML = kebab([
      { label: "Duplicar", icon: "copy", attrs: 'data-task-act="duplicate"' },
      t.archived_at ? { label: "Restaurar", icon: "refresh", attrs: 'data-task-act="restore"' } : { label: "Arquivar", icon: "box", attrs: 'data-task-act="archive"' },
      state.can.admin && { label: "Excluir de vez", icon: "trash", attrs: 'data-task-act="delete"', danger: true }
    ], "Mais ações da demanda");
    body.innerHTML = `
      <p class="task-crumbs">${parent ? `<button class="link-btn" type="button" data-task-open="${esc(parent.id)}">${icon("chevronLeft")}${esc(parent.title)}</button><span>·</span>` : ""}<span class="cli-dot ${clientDotClass(state.clients, t.client_id)}" aria-hidden="true"></span>${esc(clientName(t.client_id))}</p>
      <label class="field"><span class="visually-hidden">Título</span>
        <textarea class="task-title" data-task-field="title" rows="1" maxlength="200">${esc(t.title)}</textarea></label>
      <dl class="task-props">
        <div class="task-prop"><dt>${icon("layers")}Etapa</dt><dd><select class="field__input field__input--sm" data-task-field="column_id">${options(cols.map((c) => [c.id, c.name]), col?.id)}</select></dd></div>
        <div class="task-prop"><dt>${icon("user")}Responsáveis</dt><dd>
          <div class="task-people">${assigned.length ? assigned.map((id) => `<span class="person-chip"><span class="avatar">${esc(initials(personName(state.team, id)))}</span>${esc(personName(state.team, id))}</span>`).join("") : '<span class="field__optional">Ninguém ainda</span>'}
          <button class="link-btn" type="button" data-task-people-edit aria-expanded="false">${icon("edit")}<span>Alterar</span></button></div>
          <div class="task-people-edit" data-task-people-box hidden>${peoplePicker(t.client_id, assigned)}<button class="btn btn--primary btn--sm" type="button" data-task-people-save>Salvar responsáveis</button></div>
        </dd></div>
        <div class="task-prop"><dt>${icon("clock")}Entrega</dt><dd><span class="input-row"><input class="field__input field__input--sm" type="date" data-task-due="date" value="${esc(date)}"><input class="field__input field__input--sm task-time" type="time" data-task-due="time" value="${esc(time)}"></span>${due ? `<span class="due-pill due-pill--${esc(due.tone)}">${esc(due.label)}</span>` : ""}</dd></div>
        <div class="task-prop"><dt>${icon("target")}Prioridade</dt><dd><select class="field__input field__input--sm" data-task-field="priority">${options(Object.entries(TASK_PRIORITIES).map(([k, v]) => [k, v.label]), t.priority)}</select></dd></div>
        <div class="task-prop"><dt>${icon("tag")}Etiquetas</dt><dd>${labelPicker(labelsOf(t))}</dd></div>
        ${t.parent_id ? "" : `<div class="task-prop"><dt>${icon("users")}Cliente</dt><dd><select class="field__input field__input--sm" data-task-field="client_id"><option value="">Interno da agência</option>${options(visibleClients().concat(state.clients.filter((c) => !c.active && c.id === t.client_id)).map((c) => [c.id, c.name]), t.client_id || "")}</select></dd></div>`}
        ${t.client_id ? `<div class="task-prop"><dt>${icon("box")}Projeto</dt><dd><span class="input-row"><select class="field__input field__input--sm" data-task-field="project_id"><option value="">Sem projeto</option>${options(projects.map((p) => [p.id, p.name]), t.project_id || "")}</select>${state.can.edit ? `<button class="btn btn--ghost btn--sm" type="button" data-task-new-project>${icon("sparkle")}<span>Novo</span></button>` : ""}</span></dd></div>` : ""}
        ${t.content_id ? `<div class="task-prop"><dt>${icon("calendar")}Conteúdo</dt><dd><button class="link-btn" type="button" data-task-content="${esc(t.content_id)}">${icon("arrowRight")}<span>Abrir o conteúdo do calendário</span></button></dd></div>` : ""}
      </dl>
      <section class="detail"><h3 class="detail__title">Descrição</h3>
        <textarea class="field__input task-desc" data-task-field="description" rows="5" maxlength="10000" placeholder="Detalhes, referências, o que é esperado…">${esc(t.description || "")}</textarea></section>
      ${subtasks.length ? `<section class="detail"><h3 class="detail__title">Subtarefas (${subtasks.filter((s) => s.status === "concluido").length}/${subtasks.length})</h3>
        <ul class="subtask-list">${subtasks.map((s) => `<li><button class="subtask-row${s.status === "concluido" ? " is-done" : ""}" type="button" data-task-open="${esc(s.id)}">${icon(s.status === "concluido" ? "check" : "dot")}<span>${esc(s.title)}</span><span class="subtask-row__who">${(s.task_assignees || []).map((a) => esc(personName(state.team, a.user_id))).join(", ")}</span></button></li>`).join("")}</ul></section>` : ""}
      <section class="detail"><h3 class="detail__title">Histórico</h3><div data-task-history><p class="field__hint">Carregando…</p></div></section>`;
    autosize(body.querySelector(".task-title"));
    loadHistory(t.id);
  }
  function autosize(area) { if (!area) return; area.style.height = "auto"; area.style.height = `${area.scrollHeight}px`; }

  async function loadHistory(id) {
    const box = body.querySelector("[data-task-history]");
    try {
      const events = await api.taskEvents(id);
      if (!box.isConnected || current?.id !== id) return;
      box.innerHTML = events.length ? `<ul class="history">${events.map((e) => `<li class="history__item">${icon("dot")}<div><p class="history__title">${esc((EVENT_TEXT[e.event_type] || (() => e.event_type))(e))} <span class="history__meta">· ${esc(e.actor_name || "")} · ${esc(stampLabel(e.created_at))}</span></p></div></li>`).join("")}</ul>` : '<p class="field__hint">Sem registros.</p>';
    } catch { if (box.isConnected) box.innerHTML = '<p class="field__hint">Não foi possível carregar o histórico.</p>'; }
  }

  async function open(id) {
    if (current?.id !== id) lastFlash = null;
    try {
      const task = await api.getTask(id);
      current = task;
      board.upsert(task);
      render();
      if (!drawer.open) drawer.showModal();
      autosize(body.querySelector(".task-title"));   // com o painel aberto a altura é a de verdade
    } catch (error) { toast(error.message, "error"); }
  }

  /** Salva um pedaço da demanda; outra pessoa salvou antes → recarrega e avisa */
  function flash(text, tone = "ok") {
    lastFlash = { text, tone };
    const el = badges.querySelector("[data-save-state]");
    if (!el) return;
    el.className = `save-state save-state--${tone}`;
    el.textContent = text;
  }
  async function save(patch) {
    if (!current) return;
    const id = current.id;
    flash("Salvando…", "busy");
    try {
      const saved = await api.updateTask(id, current.version, patch);
      current = { ...current, ...saved };
      board.upsert(current);
      flash("Salvo ✓");
      return true;
    } catch (error) {
      if (error.status === 409) {
        toast(error.message, "info");
        await open(id);
      } else {
        flash("Não salvou", "error");
        toast(error.message, "error");
        render();
      }
      return false;
    }
  }

  on(body, "change", "[data-task-field]", async (event, el) => {
    const field = el.dataset.taskField;
    const value = el.value;
    if (field === "title" && !value.trim()) { el.value = current.title; return; }
    if ((current[field] ?? "") === value) return;
    const ok = await save({ [field]: value });
    if (ok && ["column_id", "client_id", "priority"].includes(field)) render();
  });
  on(body, "input", ".task-title", (event, el) => autosize(el));
  on(body, "keydown", ".task-title", (event, el) => { if (event.key === "Enter") { event.preventDefault(); el.blur(); } });
  on(body, "change", "[data-task-due]", async () => {
    const date = body.querySelector('[data-task-due="date"]').value;
    const time = body.querySelector('[data-task-due="time"]').value;
    if (await save({ due_date: date, due_time: time })) render();
  });
  on(body, "change", "[name=label]", async () => {
    if (!current) return;
    const next = [...body.querySelectorAll("[name=label]:checked")].map((b) => b.value);
    flash("Salvando…", "busy");
    try {
      await api.setTaskLabels(current.id, next, labelsOf(current));
      current = { ...current, task_labels: next.map((label_id) => ({ label_id })) };
      board.upsert(current);
      flash("Salvo ✓");
    } catch (error) { flash("Não salvou", "error"); toast(error.message, "error"); render(); }
  });
  on(body, "click", "[data-task-people-edit]", (event, b) => {
    const box = body.querySelector("[data-task-people-box]");
    box.hidden = !box.hidden;
    b.setAttribute("aria-expanded", String(!box.hidden));
  });
  on(body, "click", "[data-task-people-save]", async (event, b) => {
    const next = [...body.querySelectorAll("[data-task-people-box] [name=assignee]:checked")].map((x) => x.value);
    setBusy(b, true);
    try {
      await api.setTaskAssignees(current.id, next, assigneesOf(current));
      current = { ...current, task_assignees: next.map((user_id) => ({ user_id })) };
      board.upsert(current);
      toast(next.length ? "Responsáveis atualizados" : "Demanda sem responsável");
      render();
    } catch (error) { toast(error.message, "error"); setBusy(b, false); }
  });
  on(body, "click", "[data-task-new-project]", async () => {
    const name = window.prompt("Nome do novo projeto deste cliente:");
    if (!name) return;
    try {
      const project = await api.createProject(current.client_id, name);
      board.addProject(project);
      if (await save({ project_id: project.id })) render();
    } catch (error) { toast(error.message, "error"); }
  });
  on(body, "click", "[data-task-open]", (event, b) => open(b.dataset.taskOpen));
  on(body, "click", "[data-task-content]", (event, b) => { closeDialog(drawer); openContent(b.dataset.taskContent); });

  on(tools, "click", "[data-task-act]", async (event, b) => {
    const act = b.dataset.taskAct;
    const t = current;
    if (!t) return;
    if (act === "duplicate") {
      try {
        const copy = await api.createTask({ title: `${t.title} (cópia)`, client_id: t.client_id || "", description: t.description || "", priority: t.priority, project_id: t.project_id || undefined, due_at: t.due_at, parent_id: t.parent_id || undefined, column_id: t.column_id || undefined }, { assignees: assigneesOf(t), labels: labelsOf(t) });
        board.upsert(copy);
        toast("Demanda duplicada");
        await open(copy.id);
      } catch (error) { toast(error.message, "error"); }
    }
    if (act === "archive" || act === "restore") {
      if (await save({ archived_at: act === "archive" ? new Date().toISOString() : null })) {
        toast(act === "archive" ? "Demanda arquivada (dá para restaurar)" : "Demanda restaurada");
        if (act === "archive") { board.remove(t.id); closeDialog(drawer); } else render();
      }
    }
    if (act === "delete") {
      const subs = board.tasks().filter((x) => x.parent_id === t.id).length;
      const ok = await confirm({ title: `Excluir "${t.title}" de vez?`, text: `Some para toda a equipe junto com ${subs ? `${subs} ${subs === 1 ? "subtarefa" : "subtarefas"}, ` : ""}responsáveis, etiquetas e histórico. Prefira arquivar se puder precisar depois. Não dá para desfazer.`, confirmLabel: "Excluir de vez" });
      if (!ok) return;
      try { await api.deleteTask(t.id); board.remove(t.id); closeDialog(drawer); toast("Demanda excluída"); } catch (error) { toast(error.message, "error"); }
    }
  });
  drawer.addEventListener("close", () => { current = null; });

  return { openNew, open, current: () => current };
}
