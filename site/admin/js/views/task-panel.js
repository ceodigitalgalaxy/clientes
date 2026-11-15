/* Painel lateral da demanda (Gestão de demandas).
   - Nova demanda: só o essencial (título, cliente, responsáveis, entrega,
     descrição, etiquetas). O resto se completa depois.
   - Demanda aberta: tudo editável ali mesmo; cada mudança salva sozinha
     ("Salvo ✓"). Se outra pessoa salvou antes, avisa e recarrega (version).
   O banco confere quem pode ver, criar, editar, delegar e arquivar. */

import { $, esc, on } from "../../../js/lib/dom.js?v=37b1301fd1";
import { icon } from "../../../js/lib/icons.js?v=37b1301fd1";
import { stampLabel } from "../../../js/lib/dates.js?v=37b1301fd1";
import { TASK_STATUS, TASK_PRIORITIES, dueParts, dueState } from "../domain/tasks.js?v=37b1301fd1";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=37b1301fd1";
import { kebab } from "../ui/menu.js?v=37b1301fd1";
import { attachMentions, mentionHtml } from "../ui/mentions.js?v=37b1301fd1";
import { seesClient, personName, clientDotClass } from "./contents.js?v=37b1301fd1";

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
  function labelPicker(chosen, { canAdd = false } = {}) {
    const list = board.labels().filter((l) => !l.archived_at);
    return `<div class="pick-labels">${list.map((l) => `
      <label class="pick-label"><input type="checkbox" name="label" value="${esc(l.id)}" ${chosen.includes(l.id) ? "checked" : ""}><span class="label-chip label-chip--${esc(l.color)}">${esc(l.name)}</span></label>`).join("")}${canAdd ? `<button class="label-add" type="button" data-label-new>${icon("sparkle")}Nova etiqueta</button>` : ""}</div>`;
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

  /* ---------------- Subtarefas, checklist e comentários ---------------- */
  let activity = { taskId: null, comments: null, checklist: null };   // o que já veio do banco para a demanda aberta
  let labelsOpen = false;    // a lista completa de etiquetas só abre em "Alterar"
  const labelsNow = (t) => {
    const chosen = labelsOf(t).map((id) => board.labels().find((l) => l.id === id)).filter(Boolean);
    return chosen.length ? chosen.map((l) => `<span class="label-chip label-chip--${esc(l.color)}">${esc(l.name)}</span>`).join("") : '<span class="field__optional">Nenhuma</span>';
  };
  let historyOpen = false;   // o histórico fica fechado até a pessoa abrir (e assim continua ao trocar de demanda)
  let draft = "";            // comentário sendo escrito (sobrevive ao redesenho do painel)
  let composer = null;       // @menção do campo de comentário
  const me = () => state.me?.user_id;
  /** Quem pode ser mencionado: quem enxerga a demanda (o banco confere de novo) */
  function mentionable(t) {
    if (!t) return [];
    const involved = new Set([t.created_by, ...assigneesOf(t)]);
    board.tasks().filter((x) => x.parent_id === t.id || x.id === t.parent_id).forEach((x) => assigneesOf(x).forEach((id) => involved.add(id)));
    return state.team.filter((m) => m.active !== false && m.user_id !== me()
      && (t.client_id ? seesClient(m, t.client_id) : (m.role === "admin" || involved.has(m.user_id))));
  }
  const avatarsOf = (ids) => ids.map((id) => `<span class="avatar avatar--xs" title="${esc(personName(state.team, id))}">${esc(initials(personName(state.team, id)))}</span>`).join("");

  function subtasksHtml(t, subtasks) {
    const done = subtasks.filter((x) => x.status === "concluido").length;
    const team = people(t.client_id);
    return `
      <section class="detail"><h3 class="detail__title">Subtarefas ${subtasks.length ? `<span class="detail__count">${done}/${subtasks.length}</span>` : ""}</h3>
        ${subtasks.length ? `<ul class="subtasks">${subtasks.map((x) => {
          const due = dueState(x.due_at, x.status);
          const ids = assigneesOf(x);
          return `<li class="subtask${x.status === "concluido" ? " is-done" : ""}">
            <label class="subtask__check"><input type="checkbox" data-subtask-done="${esc(x.id)}" ${x.status === "concluido" ? "checked" : ""}><span class="visually-hidden">Concluir ${esc(x.title)}</span></label>
            <button class="subtask__title" type="button" data-task-open="${esc(x.id)}">${esc(x.title)}</button>
            <span class="subtask__meta">${due ? `<span class="due-pill due-pill--${esc(due.tone)}">${esc(due.label)}</span>` : ""}${ids.length ? avatarsOf(ids) : '<span class="field__optional">sem responsável</span>'}</span>
          </li>`;
        }).join("")}</ul>` : '<p class="field__hint">Quebre a demanda em partes e entregue cada uma para alguém (o responsável da demanda continua o mesmo).</p>'}
        <form class="subtask-add" data-subtask-add novalidate>
          <input class="field__input field__input--sm" name="title" maxlength="200" placeholder="+ Nova subtarefa" aria-label="Título da subtarefa" autocomplete="off">
          <select class="field__input field__input--sm" name="assignee" aria-label="Responsável da subtarefa"><option value="">Responsável…</option>${options(team.map((m) => [m.user_id, `${m.name || m.username}${m.user_id === me() ? " (você)" : ""}`]))}</select>
          <input class="field__input field__input--sm" type="date" name="due_date" aria-label="Entrega da subtarefa">
          <button class="btn btn--ghost btn--sm" type="submit">Adicionar</button>
        </form>
      </section>`;
  }

  function checklistHtml() {
    const items = activity.taskId === current?.id ? activity.checklist : null;
    if (!items) return '<p class="field__hint">Carregando…</p>';
    if (!items.length) return "";
    return `<ul class="checklist">${items.map((i) => `
      <li class="check-item${i.done ? " is-done" : ""}">
        <label class="check"><input type="checkbox" data-check-done="${esc(i.id)}" ${i.done ? "checked" : ""}><span>${esc(i.body)}</span></label>
        <button class="icon-btn icon-btn--sm" type="button" data-check-delete="${esc(i.id)}" aria-label="Apagar item ${esc(i.body)}">${icon("close")}</button>
      </li>`).join("")}</ul>`;
  }

  function commentHtml(c, replies = []) {
    const mine = c.author_id === me();
    const gone = Boolean(c.deleted_at);
    const actions = gone ? "" : [
      `<button class="link-btn" type="button" data-comment-reply="${esc(c.parent_id || c.id)}">Responder</button>`,
      mine ? `<button class="link-btn" type="button" data-comment-edit="${esc(c.id)}">Editar</button>` : "",
      mine || state.can.admin ? `<button class="link-btn link-btn--danger" type="button" data-comment-delete="${esc(c.id)}">Apagar</button>` : ""
    ].join("");
    return `
      <li class="tcomment${mine ? " tcomment--mine" : ""}${gone ? " is-deleted" : ""}" data-comment="${esc(c.id)}">
        <span class="avatar">${esc(initials(c.author_name || "?"))}</span>
        <div class="tcomment__main">
          <p class="tcomment__meta"><b>${esc(c.author_name || "Alguém")}</b> · ${esc(stampLabel(c.created_at))}${c.edited_at && !gone ? ` · <button class="link-btn tcomment__edited" type="button" data-comment-versions="${esc(c.id)}" title="Ver o texto anterior">editado</button>` : ""}</p>
          ${gone ? '<p class="tcomment__body tcomment__body--gone">Comentário apagado</p>' : `<p class="tcomment__body">${mentionHtml(c.body, c.mentions, (id) => personName(state.team, id))}</p>`}
          <div class="tcomment__versions" data-versions-of="${esc(c.id)}" hidden></div>
          ${actions ? `<p class="tcomment__actions">${actions}</p>` : ""}
          ${replies.length ? `<ul class="tcomments tcomments--replies">${replies.map((r) => commentHtml(r)).join("")}</ul>` : ""}
        </div>
      </li>`;
  }
  function commentsHtml() {
    const list = activity.taskId === current?.id ? activity.comments : null;
    if (!list) return '<p class="field__hint">Carregando…</p>';
    const top = list.filter((c) => !c.parent_id);
    if (!top.length) return '<p class="field__hint">Nenhum comentário ainda. Combine aqui os detalhes com a equipe.</p>';
    return `<ul class="tcomments">${top.map((c) => commentHtml(c, list.filter((r) => r.parent_id === c.id))).join("")}</ul>`;
  }
  function paintCounts() {
    const comments = (activity.taskId === current?.id && activity.comments) || null;
    const items = (activity.taskId === current?.id && activity.checklist) || null;
    const cc = body.querySelector("[data-comment-count]");
    if (cc) cc.textContent = comments ? `(${comments.filter((c) => !c.deleted_at).length})` : "";
    const ck = body.querySelector("[data-check-count]");
    if (ck) ck.textContent = items && items.length ? `${items.filter((i) => i.done).length}/${items.length}` : "";
  }
  function paintActivity() {
    const cl = body.querySelector("[data-checklist]");
    if (cl) cl.innerHTML = checklistHtml();
    const cm = body.querySelector("[data-task-comments]");
    if (cm) cm.innerHTML = commentsHtml();
    paintCounts();
  }
  /** Card do quadro acompanha a contagem (comentários e checklist) sem recarregar tudo */
  function syncCardCounts() {
    if (!current || activity.taskId !== current.id) return;
    current = { ...current, task_comments: [{ count: (activity.comments || []).filter((c) => !c.deleted_at).length }], task_checklist: (activity.checklist || []).map((i) => ({ done: i.done })) };
    board.upsert(current);
  }
  async function loadActivity(id) {
    if (activity.taskId !== id) activity = { taskId: id, comments: null, checklist: null };
    const [comments, checklist] = await Promise.all([api.listTaskComments(id).catch(() => []), api.listChecklist(id).catch(() => [])]);
    if (current?.id !== id) return;
    activity = { taskId: id, comments, checklist };
    paintActivity();
  }

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
        <div class="task-prop"><dt>${icon("tag")}Etiquetas</dt><dd>
          <div class="task-people"><span data-labels-now>${labelsNow(t)}</span>
          <button class="link-btn" type="button" data-task-labels-edit aria-expanded="${labelsOpen}">${icon("edit")}<span>${labelsOpen ? "Fechar" : "Alterar"}</span></button></div>
          <div class="task-labels-edit" data-task-labels-box ${labelsOpen ? "" : "hidden"}>${labelPicker(labelsOf(t), { canAdd: true })}</div>
        </dd></div>
        ${t.parent_id ? "" : `<div class="task-prop"><dt>${icon("users")}Cliente</dt><dd><select class="field__input field__input--sm" data-task-field="client_id"><option value="">Interno da agência</option>${options(visibleClients().concat(state.clients.filter((c) => !c.active && c.id === t.client_id)).map((c) => [c.id, c.name]), t.client_id || "")}</select></dd></div>`}
        ${t.client_id ? `<div class="task-prop"><dt>${icon("box")}Projeto</dt><dd><span class="input-row"><select class="field__input field__input--sm" data-task-field="project_id"><option value="">Sem projeto</option>${options(projects.map((p) => [p.id, p.name]), t.project_id || "")}</select>${state.can.edit ? `<button class="btn btn--ghost btn--sm" type="button" data-task-new-project>${icon("sparkle")}<span>Novo</span></button>` : ""}</span></dd></div>` : ""}
        ${t.content_id ? `<div class="task-prop"><dt>${icon("calendar")}Conteúdo</dt><dd><button class="link-btn" type="button" data-task-content="${esc(t.content_id)}">${icon("arrowRight")}<span>Abrir o conteúdo do calendário</span></button></dd></div>` : ""}
      </dl>
      <section class="detail"><h3 class="detail__title">Descrição</h3>
        <textarea class="field__input task-desc" data-task-field="description" rows="5" maxlength="10000" placeholder="Detalhes, referências, o que é esperado…">${esc(t.description || "")}</textarea></section>
      ${t.parent_id ? "" : subtasksHtml(t, subtasks)}
      <section class="detail"><h3 class="detail__title">Checklist <span class="detail__count" data-check-count></span></h3>
        <div data-checklist>${checklistHtml()}</div>
        <form class="inline-add" data-check-add novalidate><input class="field__input field__input--sm" name="body" maxlength="300" placeholder="+ Adicionar item" aria-label="Novo item do checklist" autocomplete="off"></form></section>
      <section class="detail task-activity">
        <h3 class="detail__title">Comentários <span class="detail__count" data-comment-count></span></h3>
        <div data-task-comments>${commentsHtml()}</div>
        <form class="comment-form" data-task-comment-form novalidate>
          <textarea class="field__input" name="body" rows="2" maxlength="5000" placeholder="Escreva um comentário. Use @ para chamar alguém da equipe." aria-label="Novo comentário"></textarea>
          <p class="form-error" role="alert" hidden></p>
          <div class="comment-form__actions"><span class="field__hint">${icon("lock")}Só a equipe vê · Ctrl+Enter envia</span><button class="btn btn--primary btn--sm" type="submit">${icon("send")}<span>Comentar</span></button></div>
        </form>
      </section>
      <details class="detail history-toggle" data-history-toggle="demanda" ${historyOpen ? "open" : ""}>
        <summary class="history-toggle__summary">${icon("clock")}<span>Histórico</span><span class="history-toggle__hint">o que mudou e quem mudou</span></summary>
        <div data-task-history><p class="field__hint">Carregando…</p></div>
      </details>`;
    autosize(body.querySelector(".task-title"));
    const area = body.querySelector("[data-task-comment-form] textarea");
    area.value = draft;
    area.addEventListener("input", () => { draft = area.value; });
    composer = attachMentions(area, () => mentionable(current));
    paintCounts();
    if (historyOpen) loadHistory(t.id);   // fechado: só busca quando a pessoa abrir
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
    if (current?.id !== id) { lastFlash = null; draft = ""; activity = { taskId: id, comments: null, checklist: null }; }
    try {
      const task = await api.getTask(id);
      current = task;
      board.upsert(task);
      render();
      loadActivity(id);
      document.dispatchEvent(new CustomEvent("task-opened", { detail: id }));
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
  on(body, "click", "[data-task-labels-edit]", (event, b) => {
    labelsOpen = !labelsOpen;
    body.querySelector("[data-task-labels-box]").hidden = !labelsOpen;
    b.setAttribute("aria-expanded", String(labelsOpen));
    b.querySelector("span").textContent = labelsOpen ? "Fechar" : "Alterar";
  });
  on(body, "change", "[name=label]", async () => {
    if (!current) return;
    const next = [...body.querySelectorAll("[name=label]:checked")].map((b) => b.value);
    flash("Salvando…", "busy");
    try {
      await api.setTaskLabels(current.id, next, labelsOf(current));
      current = { ...current, task_labels: next.map((label_id) => ({ label_id })) };
      board.upsert(current);
      const now = body.querySelector("[data-labels-now]");
      if (now) now.innerHTML = labelsNow(current);
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
  /* ---------- Subtarefas ---------- */
  on(body, "change", "[data-subtask-done]", async (event, box) => {
    const sub = board.tasks().find((x) => x.id === box.dataset.subtaskDone);
    if (!sub) return;
    box.disabled = true;
    try {
      const saved = await api.updateTask(sub.id, sub.version, { status: box.checked ? "concluido" : "a_fazer" });
      board.upsert({ ...sub, ...saved });
      toast(box.checked ? `Subtarefa concluída: "${sub.title}"` : "Subtarefa reaberta");
      render();
    } catch (error) {
      box.checked = !box.checked;
      box.disabled = false;
      toast(error.message, error.status === 409 ? "info" : "error");
      if (error.status === 409) open(current.id);
    }
  });
  on(body, "submit", "[data-subtask-add]", async (event, form) => {
    event.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) { form.elements.title.focus(); return; }
    const button = form.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      const who = form.elements.assignee.value;
      const created = await api.createTask({ title, parent_id: current.id, due_date: form.elements.due_date.value, due_time: form.elements.due_date.value ? "18:00" : "" }, { assignees: who ? [who] : [] });
      board.upsert(created);
      toast(who && who !== me() ? `Subtarefa criada e entregue para ${personName(state.team, who)}` : "Subtarefa criada");
      render();
      body.querySelector("[data-subtask-add] [name=title]")?.focus();
    } catch (error) { toast(error.message, "error"); setBusy(button, false); }
  });

  /* ---------- Checklist ---------- */
  on(body, "submit", "[data-check-add]", async (event, form) => {
    event.preventDefault();
    const input = form.elements.body;
    const text = input.value.trim();
    if (!text || !current) return;
    input.disabled = true;
    try {
      const item = await api.addChecklist(current.id, text);
      activity.checklist = [...(activity.checklist || []), item];
      input.value = "";
      paintActivity();
      syncCardCounts();
    } catch (error) { toast(error.message, "error"); }
    finally { input.disabled = false; input.focus(); }
  });
  on(body, "change", "[data-check-done]", async (event, box) => {
    const id = box.dataset.checkDone;
    try {
      const saved = await api.updateChecklist(id, { done: box.checked });
      activity.checklist = activity.checklist.map((i) => (i.id === id ? saved : i));
      paintActivity();
      syncCardCounts();
    } catch (error) { box.checked = !box.checked; toast(error.message, "error"); }
  });
  on(body, "click", "[data-check-delete]", async (event, b) => {
    const id = b.dataset.checkDelete;
    try {
      await api.deleteChecklist(id);
      activity.checklist = activity.checklist.filter((i) => i.id !== id);
      paintActivity();
      syncCardCounts();
    } catch (error) { toast(error.message, "error"); }
  });

  /* ---------- Comentários e histórico ---------- */
  body.addEventListener("toggle", (event) => {
    if (!event.target.matches?.("[data-history-toggle]")) return;
    historyOpen = event.target.open;
    if (historyOpen && current) loadHistory(current.id);
  }, true);
  const sentLabel = (n) => (n ? ` · ${n === 1 ? "1 pessoa avisada" : `${n} pessoas avisadas`}` : "");
  on(body, "submit", "[data-task-comment-form]", async (event, form) => {
    event.preventDefault();
    const area = form.elements.body;
    const errorBox = form.querySelector(".form-error");
    errorBox.hidden = true;
    const text = area.value.trim();
    if (!text) { errorBox.textContent = "Escreva o comentário."; errorBox.hidden = false; area.focus(); return; }
    const mentions = composer.mentions(text);
    const button = form.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      const saved = await api.addTaskComment(current.id, text, { mentions });
      activity.comments = [...(activity.comments || []), saved];
      area.value = ""; draft = "";
      composer.clear();
      paintActivity();
      syncCardCounts();
      toast(`Comentário enviado${sentLabel(saved.mentions?.length)}`);
    } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
    finally { setBusy(button, false); }
  });
  /** Formulário pequeno dentro do comentário (responder ou editar) */
  function inlineForm(host, { value = "", label, mentions = [], onSubmit }) {
    host.querySelector("[data-inline-comment]")?.remove();
    host.insertAdjacentHTML("beforeend", `
      <form class="comment-form comment-form--inline" data-inline-comment novalidate>
        <textarea class="field__input" name="body" rows="2" maxlength="5000" aria-label="${esc(label)}">${esc(value)}</textarea>
        <p class="form-error" role="alert" hidden></p>
        <div class="comment-form__actions"><button class="btn btn--ghost btn--sm" type="button" data-inline-cancel>Cancelar</button><button class="btn btn--primary btn--sm" type="submit">${esc(label)}</button></div>
      </form>`);
    const form = host.querySelector("[data-inline-comment]");
    const area = form.elements.body;
    const helper = attachMentions(area, () => mentionable(current));
    helper.preset(mentions.map((id) => [personName(state.team, id), id]));
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = area.value.trim();
      const errorBox = form.querySelector(".form-error");
      if (!text) { errorBox.textContent = "Escreva o comentário."; errorBox.hidden = false; return; }
      const button = form.querySelector("[type=submit]");
      setBusy(button, true);
      try { await onSubmit(text, helper.mentions(text)); } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; setBusy(button, false); }
    });
    form.querySelector("[data-inline-cancel]").addEventListener("click", () => form.remove());
  }
  on(body, "click", "[data-comment-reply]", (event, b) => {
    const thread = body.querySelector(`[data-comment="${b.dataset.commentReply}"] > .tcomment__main`);
    if (!thread) return;
    inlineForm(thread, { label: "Responder", onSubmit: async (text, mentions) => {
      const saved = await api.addTaskComment(current.id, text, { mentions, parentId: b.dataset.commentReply });
      activity.comments = [...activity.comments, saved];
      paintActivity();
      syncCardCounts();
      toast(`Resposta enviada${sentLabel(saved.mentions?.length)}`);
    } });
  });
  on(body, "click", "[data-comment-edit]", (event, b) => {
    const c = activity.comments.find((x) => x.id === b.dataset.commentEdit);
    const main = body.querySelector(`[data-comment="${c?.id}"] > .tcomment__main`);
    if (!c || !main) return;
    inlineForm(main, { value: c.body, label: "Salvar", mentions: c.mentions || [], onSubmit: async (text, mentions) => {
      const saved = await api.editTaskComment(c.id, text, mentions);
      activity.comments = activity.comments.map((x) => (x.id === c.id ? saved : x));
      paintActivity();
      toast("Comentário editado (o texto anterior fica guardado)");
    } });
  });
  on(body, "click", "[data-comment-delete]", async (event, b) => {
    const c = activity.comments.find((x) => x.id === b.dataset.commentDelete);
    if (!c) return;
    const ok = await confirm({ title: "Apagar este comentário?", text: c.author_id === me() ? "O texto some para a equipe; fica só o registro de que houve um comentário apagado." : `Você vai apagar o comentário de ${c.author_name || "outra pessoa"}. O texto some para a equipe; fica o registro.`, confirmLabel: "Apagar comentário" });
    if (!ok) return;
    try {
      const saved = await api.deleteTaskComment(c.id);
      activity.comments = activity.comments.map((x) => (x.id === c.id ? saved : x));
      paintActivity();
      syncCardCounts();
      toast("Comentário apagado");
    } catch (error) { toast(error.message, "error"); }
  });
  on(body, "click", "[data-comment-versions]", async (event, b) => {
    const box = body.querySelector(`[data-versions-of="${b.dataset.commentVersions}"]`);
    if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    try {
      const edits = await api.commentEdits(b.dataset.commentVersions);
      box.innerHTML = edits.length ? `<p class="field__hint">Antes:</p><ul>${edits.map((e) => `<li><span class="tcomment__old">${esc(e.body)}</span> <span class="field__optional">· trocado em ${esc(stampLabel(e.edited_at))}</span></li>`).join("")}</ul>` : '<p class="field__hint">Sem versões anteriores.</p>';
      box.hidden = false;
    } catch (error) { toast(error.message, "error"); }
  });

  /* ---------- Etiqueta nova (qualquer pessoa da equipe) ---------- */
  on(body, "click", "[data-label-new]", async () => {
    const name = window.prompt("Nome da nova etiqueta (até 30 caracteres):");
    if (!name || !current) return;
    try {
      const label = await api.createLabel({ name, color: "roxo" });
      board.addLabel(label);
      const next = [...labelsOf(current), label.id];
      await api.setTaskLabels(current.id, next, labelsOf(current));
      current = { ...current, task_labels: next.map((label_id) => ({ label_id })) };
      board.upsert(current);
      toast(`Etiqueta "${label.name}" criada`);
      render();
    } catch (error) { toast(error.status === 409 ? "Já existe uma etiqueta com esse nome." : error.message, "error"); }
  });

  drawer.addEventListener("close", () => { current = null; });

  return { openNew, open, current: () => current };
}
