/* Seção Conteúdos: filtros, lista, detalhes, cadastro, edição e exclusão */

import { $, esc, on } from "../../../js/lib/dom.js?v=424169d0b1";
import { icon } from "../../../js/lib/icons.js?v=424169d0b1";
import { longDayLabel, timeLabel, todayISO, stampLabel, addDays } from "../../../js/lib/dates.js?v=424169d0b1";
import { typeBadge } from "../../../js/ui/badges.js?v=424169d0b1";
import { renderMedia, wireMediaFallbacks } from "../../../js/ui/media.js?v=424169d0b1";
import { PRIORITIES } from "../domain/rules.js?v=424169d0b1";
import { CONTENT_STATUS, CLIENT_VISIBLE_STATUS, APPROVAL_STATUS, PRODUCTION_STATUS, NETWORKS, FORMATS, LIMITS, validateContent, validateContentFilters } from "../domain/rules.js?v=424169d0b1";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=424169d0b1";
import { stateBlock, loadingRows, button } from "../ui/states.js?v=424169d0b1";
import { reviewSections, mountReview } from "./content-review.js?v=424169d0b1";
import { describeMedia, mediaCover, coverHtml } from "../../../js/ui/media.js?v=424169d0b1";
import { CAL_MODES, BOARD_COLUMNS, renderCalendar, calendarRange, stepCursor, calendarTitle, attentionItems, renderAttention } from "./contents-calendar.js?v=424169d0b1";

const shortDate = (iso) => iso.split("-").reverse().join("/");
const statusChip = (status) => `<span class="content-status cs--${esc(status)}">${esc(CONTENT_STATUS[status]?.label || status)}</span>`;
/** Miniatura da referência na lista: imagem pequena ou ícone do tipo de link */
function refThumb(content) {
  if (!content.media_url) return `<span class="row__thumb row__thumb--empty" title="Sem referência">${icon("image")}</span>`;
  const kind = content.media_kind || "image";
  const media = describeMedia(content.media_url, kind);
  const cover = mediaCover(content.media_url, kind);
  const video = kind === "video" || media.type !== "image";
  // Capa (imagem, capa do YouTube/Drive ou 1º quadro do arquivo); sem capa, o ícone de play
  if (cover) return `<span class="row__thumb${video ? " row__thumb--has-video" : ""}" title="${esc(media.provider || (video ? "Vídeo de referência" : "Imagem de referência"))}">${coverHtml(cover, "data-thumb")}${video ? `<span class="row__play">${icon("play")}</span>` : ""}</span>`;
  return `<span class="row__thumb row__thumb--video" title="${esc(media.provider || "Vídeo de referência")}">${icon("play")}</span>`;
}

/** Ideia e final lado a lado (status independentes) + produção */
const stageChip = (label, status) => {
  const s = APPROVAL_STATUS[status] || APPROVAL_STATUS.rascunho;
  return `<span class="appr-chip appr-chip--${esc(s.tone)} appr-chip--sm" title="${esc(`${label}: ${s.label}`)}">${icon(s.icon)}${esc(label)}: ${esc(s.short.toLowerCase())}</span>`;
};
export const stageChips = (c) => `${stageChip("Ideia", c.approval_status)}${c.final_status && c.final_status !== "rascunho" ? stageChip("Final", c.final_status) : ""}${c.production_status ? `<span class="prod-chip">${esc(PRODUCTION_STATUS[c.production_status]?.label || "")}</span>` : ""}`;

/* ---------- Tarefa: responsáveis, prazo e prioridade ---------- */
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const personName = (team, id) => { const p = team.find((m) => m.user_id === id); return p ? (p.name || p.username || "Sem nome") : "Pessoa removida"; };
/** Quem da equipe enxerga o cliente (só essas pessoas podem ser responsáveis) */
export const seesClient = (member, clientId) => member.active !== false && (member.role === "admin" || member.all_clients || (member.client_ids || []).includes(clientId));
/** Dias até a data (negativo = atrasado) */
export const daysUntil = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
};
export function dueChip(content) {
  if (!content.due_date || content.production_status === "publicado") return "";
  const n = daysUntil(content.due_date);
  const done = ["pronto_para_agendar", "agendado"].includes(content.production_status);
  const tone = done ? "ok" : n < 0 ? "late" : n <= 1 ? "urgent" : n <= 3 ? "soon" : "ok";
  const text = n < 0 ? `Atrasado ${-n} ${-n === 1 ? "dia" : "dias"}` : n === 0 ? "Entrega hoje" : n === 1 ? "Entrega amanhã" : `Entrega ${content.due_date.split("-").reverse().slice(0, 2).join("/")}`;
  return `<span class="due-chip due-chip--${tone}" title="Prazo interno">${icon("clock")}${esc(done ? `Pronto · ${text.toLowerCase()}` : text)}</span>`;
}
export const priorityChip = (priority) => (priority && priority !== "media" ? `<span class="prio-chip prio-chip--${esc(priority)}">${esc(PRIORITIES[priority]?.label || priority)}</span>` : "");
export const avatars = (team, ids = []) => ids.length
  ? `<span class="avatars" title="${esc(ids.map((id) => personName(team, id)).join(", "))}">${ids.slice(0, 3).map((id) => `<span class="avatar">${esc(initials(personName(team, id)))}</span>`).join("")}${ids.length > 3 ? `<span class="avatar avatar--more">+${ids.length - 3}</span>` : ""}</span>`
  : `<span class="avatars avatars--none">Sem responsável</span>`;

const options = (entries, selected = "") => entries.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");

export function setupContents({ api, state, toast, confirm, navigate }) {
  const list = $("#contents-list");
  const count = $("#contents-count");
  const filtersForm = $("#filters");
  const dialog = $("#content-modal");
  const form = dialog.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  const drawer = $("#content-drawer");
  wireMediaFallbacks(drawer);
  // Miniatura que não carrega vira o ícone
  list.addEventListener("error", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !el.matches("[data-thumb]")) return;
    const box = el.closest(".row__thumb");
    const video = box.classList.contains("row__thumb--has-video");
    box.className = video ? "row__thumb row__thumb--video" : "row__thumb row__thumb--empty";
    box.innerHTML = icon(video ? "play" : "image");
  }, true);
  const mediaKind = form.querySelector("[data-media-kind]");
  const captionCount = $("#caption-count");
  let contents = [];
  const picked = new Set();     // conteúdos marcados para a troca de status em massa
  const bulk = $("#bulk-bar");
  const bulkAll = document.querySelector("[data-bulk-all]");
  const bulkStatus = bulk.querySelector("[data-bulk-status]");
  let bulkBusy = false;
  let editing = null;
  let saving = false;
  let loadToken = 0;

  /* Calendário (padrão) ou lista; a escolha fica guardada neste navegador */
  const view = $("#view-conteudos");
  const calendar = $("#contents-calendar");
  const calTitle = $("#cal-title");
  const MODE_KEY = "dg-painel-conteudos-modo";
  let mode = (() => { try { const m = localStorage.getItem(MODE_KEY); return CAL_MODES[m] ? m : "mes"; } catch { return "mes"; } })();
  let cursor = todayISO();
  let selected = todayISO();
  const phone = matchMedia("(max-width: 768px)");
  const box = () => (mode === "lista" ? list : calendar);
  // Cor do cliente: sempre a mesma para o mesmo cliente (não muda quando entra um cliente novo)
  const clientIndex = (id) => [...String(id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

  wireDialog(dialog, { canClose: () => !saving });
  wireDialog(drawer);

  // Opções fixas dos selects
  bulkStatus.innerHTML = options(Object.entries(CONTENT_STATUS).map(([k, v]) => [k, v.label]), "aguardando_aprovacao");
  filtersForm.elements.status.insertAdjacentHTML("beforeend", options(Object.entries(CONTENT_STATUS).map(([k, v]) => [k, v.label])));
  form.elements.network.innerHTML = `<option value="">Escolha a rede</option>${options(Object.entries(NETWORKS))}`;
  form.elements.format.innerHTML = `<option value="">Escolha o formato</option>${options(Object.entries(FORMATS).map(([k, v]) => [k, v.label]))}`;
  form.elements.approval_status.innerHTML = options(Object.entries(APPROVAL_STATUS).map(([k, v]) => [k, v.label]));
  form.elements.final_status.innerHTML = options(Object.entries(APPROVAL_STATUS).map(([k, v]) => [k, v.label]));
  form.elements.production_status.innerHTML = `<option value="">Ainda não começou</option>${options(Object.entries(PRODUCTION_STATUS).map(([k, v]) => [k, v.label]))}`;

  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente removido";
  // Mesmas regras do banco: edita tudo (perfil) ou só o que é seu
  const canEdit = (c) => state.can.edit || (c.assignees || []).includes(state.me?.user_id);

  /** Filtros vêm do endereço (#/conteudos?client_id=...), para voltar e recarregar sem perder */
  function syncFiltersForm() {
    const select = filtersForm.elements.client_id;
    const current = state.filters.client_id || "";
    select.innerHTML = `<option value="">Todos os clientes</option>${options(state.clients.map((c) => [c.id, c.active ? c.name : `${c.name} (inativo)`]), current)}`;
    filtersForm.elements.from.value = state.filters.from || "";
    filtersForm.elements.to.value = state.filters.to || "";
    filtersForm.elements.status.value = state.filters.status || "";
    filtersForm.elements.assignee.innerHTML = `<option value="">Todos</option><option value="ninguem">Sem responsável</option>${options(state.team.filter((m) => m.active !== false).map((m) => [m.user_id, m.name || m.username]), state.filters.assignee || "")}`;
    filtersForm.elements.assignee.value = state.filters.assignee || "";
  }

  const readFilters = () => validateContentFilters(Object.fromEntries(new FormData(filtersForm)));

  filtersForm.addEventListener("change", () => navigate("conteudos", readFilters(), { replace: true }));
  filtersForm.addEventListener("reset", (event) => { event.preventDefault(); navigate("conteudos", {}, { replace: true }); });

  /* ---------- Lista ---------- */
  function syncMode() {
    const isList = mode === "lista";
    view.classList.toggle("is-calendar", !isList);
    view.querySelectorAll("[data-cal-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.calMode === mode)));
    view.querySelector("[data-cal-nav]").hidden = isList;
    view.querySelectorAll("[data-list-only]").forEach((el) => { el.hidden = !isList; });
    calendar.hidden = isList;
    calTitle.textContent = isList ? "" : calendarTitle(mode, cursor);
  }
  function setMode(next) {
    if (!CAL_MODES[next]) return;
    mode = next;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* só não lembra */ }
    if (mode === "dia" || mode === "semana") cursor = selected || cursor;
    picked.clear();
    load();
  }
  /** No calendário, busca só o período que aparece (as datas do filtro valem para a lista) */
  function queryFilters() {
    if (mode === "lista") return state.filters;
    const { from, to, ...rest } = state.filters;
    return { ...rest, ...calendarRange(mode, cursor) };
  }

  function renderLoading() {
    syncMode();
    box().setAttribute("aria-busy", "true");
    count.textContent = "Carregando…";
    box().innerHTML = loadingRows();
  }

  async function load() {
    syncFiltersForm();
    const token = ++loadToken;
    renderLoading();
    if (!state.clients.length) {
      count.textContent = "";
      box().setAttribute("aria-busy", "false");
      box().innerHTML = stateBlock({
        iconName: "users",
        title: "Cadastre um cliente primeiro",
        text: "Cada conteúdo pertence a um cliente. Depois do primeiro cadastro, os conteúdos dele aparecem aqui.",
        actions: button("go-clients", "Ir para Clientes", { primary: true, iconName: "arrowRight" })
      });
      return;
    }
    try {
      const result = await api.listContents(queryFilters());
      if (token !== loadToken) return;      // um filtro mais novo já está carregando
      // Responsável: filtro na tela (os conteúdos já vêm só dos clientes liberados)
      const who = state.filters.assignee;
      contents = !who ? result : result.filter((c) => (who === "ninguem" ? !(c.assignees || []).length : (c.assignees || []).includes(who)));
      // A seleção vale só para o que continua na lista
      [...picked].forEach((id) => { if (!contents.some((c) => c.id === id)) picked.delete(id); });
      render();
      loadAttention();   // depois da lista principal (ela tem prioridade)
    } catch (error) {
      if (token !== loadToken) return;
      box().setAttribute("aria-busy", "false");
      count.textContent = "";
      box().innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar os conteúdos", text: error.message, actions: button("reload-contents", "Tentar de novo", { iconName: "refresh" }) });
    }
  }

  /** Barra de ações em massa e botão "Selecionar todos" */
  function syncBulk() {
    const n = picked.size;
    bulk.hidden = n === 0 || mode !== "lista";
    bulk.querySelector("[data-bulk-count]").textContent = n;
    bulk.querySelector("[data-bulk-word]").textContent = n === 1 ? "selecionado" : "selecionados";
    bulkAll.hidden = contents.length < 2 || !state.can.send || mode !== "lista";
    const all = contents.length > 0 && contents.every((c) => picked.has(c.id));
    bulkAll.textContent = all ? "Desmarcar todos" : `Selecionar todos (${contents.length})`;
    list.querySelectorAll("[data-pick]").forEach((box) => {
      box.checked = picked.has(box.dataset.pick);
      box.closest(".row").classList.toggle("is-picked", box.checked);
    });
  }

  const calCtx = () => ({
    contents, mode, cursor, today: todayISO(), limits: state.alerts,
    selected: mode === "mes" && phone.matches ? selected : null,
    clientIndex, clientName, canEdit, canCreate: Boolean(state.can.edit), canConfigure: Boolean(state.can.admin),
    people: (c) => ((c.assignees || []).length ? avatars(state.team, c.assignees) : ""),
    stages: stageChips
  });
  function renderCal() {
    calendar.setAttribute("aria-busy", "false");
    calendar.innerHTML = renderCalendar(calCtx());
  }

  /* "Precisam de atenção": atrasados e com prazo perto, de todo o período (não só do mês aberto) */
  const attention = $("#attention");
  const ATT_KEY = "dg-painel-atencao-aberta";
  let attentionOpen = (() => { try { return localStorage.getItem(ATT_KEY) === "1"; } catch { return false; } })();
  let attentionList = [];
  function renderAttentionBox() { attention.innerHTML = renderAttention(calCtx(), attentionList, attentionOpen); }
  async function loadAttention() {
    const today = todayISO();
    try {
      // Cliente e responsável do filtro valem aqui; período e status, não (é sempre "de hoje para trás e o que vence logo")
      const rest = { client_id: state.filters.client_id };
      let rows = await api.listContents({ ...rest, from: addDays(today, -90), to: addDays(today, Number(state.alerts.soon)) });
      const who = state.filters.assignee;
      if (who) rows = rows.filter((c) => (who === "ninguem" ? !(c.assignees || []).length : (c.assignees || []).includes(who)));
      attentionList = attentionItems(rows, today, state.alerts);
    } catch { attentionList = []; }
    renderAttentionBox();
  }
  on(attention, "click", '[data-action="toggle-attention"]', () => {
    attentionOpen = !attentionOpen;
    try { localStorage.setItem(ATT_KEY, attentionOpen ? "1" : "0"); } catch { /* só não lembra */ }
    renderAttentionBox();
  });

  function render() {
    if (mode !== "lista") { queueMicrotask(syncBulk); renderCal(); return; }
    list.setAttribute("aria-busy", "false");
    queueMicrotask(syncBulk);
    const filtered = Object.keys(state.filters).length > 0;
    count.textContent = contents.length ? `${contents.length} ${contents.length === 1 ? "conteúdo" : "conteúdos"}${filtered ? " com esses filtros" : ""}` : "";
    if (!contents.length) {
      list.innerHTML = filtered
        ? stateBlock({ iconName: "calendar", title: "Nenhum conteúdo encontrado", text: "Não há conteúdos com esses filtros. Ajuste o período, o cliente ou o status.", actions: button("clear-filters", "Limpar filtros", { iconName: "refresh" }) })
        : stateBlock({ iconName: "calendar", title: "Nenhum conteúdo cadastrado ainda", text: "Cadastre o primeiro conteúdo. Ele vai para o calendário do cliente quando estiver aguardando aprovação.", actions: button("new-content", "Cadastrar conteúdo", { primary: true, iconName: "sparkle" }) });
      return;
    }
    list.innerHTML = `
      <div class="row row--head" aria-hidden="true"><span></span><span>Data</span><span>Cliente</span><span>Título</span><span>Rede</span><span>Formato</span><span>Status</span><span></span></div>
      ${contents.map((c) => `
        <div class="row${picked.has(c.id) ? " is-picked" : ""}" data-row="${esc(c.id)}">
          <span class="row__pick"><input type="checkbox" data-pick="${esc(c.id)}" aria-label="Selecionar ${esc(c.title)}" ${picked.has(c.id) ? "checked" : ""}></span>
          <span class="row__date">${esc(shortDate(c.scheduled_date))}<span class="row__time">${esc(c.scheduled_time ? timeLabel(c.scheduled_time.slice(0, 5)) : "Sem horário")}</span></span>
          <span class="row__client">${esc(clientName(c.client_id))}</span>
          <span class="row__titlecell">${refThumb(c)}<span class="row__titlebox"><button class="row__title" type="button" data-view-content="${esc(c.id)}">${esc(c.title)}</button><span class="row__task">${avatars(state.team, c.assignees)}${dueChip(c)}${priorityChip(c.priority)}</span></span>${c.assets_count ? `<span class="row__art" title="Itens na arte final">${icon("layers")}${esc(c.assets_count)}</span>` : ""}</span>
          <span class="row__network">${esc(NETWORKS[c.network] || c.network)}</span>
          <span class="row__format">${typeBadge(c.format)}</span>
          <span class="row__status">${stageChips(c)}</span>
          <span class="row__actions">
            ${canEdit(c) ? `<button class="icon-btn" type="button" data-edit-content="${esc(c.id)}" aria-label="Editar ${esc(c.title)}" title="Editar">${icon("edit")}</button>` : ""}
            ${state.can.admin ? `<button class="icon-btn icon-btn--danger" type="button" data-delete-content="${esc(c.id)}" aria-label="Excluir ${esc(c.title)}" title="Excluir">${icon("trash")}</button>` : ""}
          </span>
        </div>`).join("")}`;
  }

  /* ---------- Detalhes ---------- */
  const versionLine = (c) => `${CLIENT_VISIBLE_STATUS.includes(c.status) ? "Visível no calendário do cliente" : "Ainda não aparece para o cliente"} · versão ${c.version}`;
  let openId = null;
  let lastOpened = null;
  function openDetails(content, { keepScroll = false } = {}) {
    lastOpened = content;
    const body = $("#drawer-body");
    const scroll = keepScroll ? body.scrollTop : 0;
    openId = content.id;
    requestAnimationFrame(() => { body.scrollTop = scroll; });
    $("#drawer-badges").innerHTML = `${typeBadge(content.format, true)}${statusChip(content.status)}`;
    // Referência: só a equipe vê (o portal do cliente não recebe este link)
    const block = (rows) => rows.filter(([, text]) => text).map(([label, text]) => `<div class="detail"><h3 class="detail__title">${label}</h3><p class="caption-text">${esc(text)}</p></div>`).join("");
    const plan = block([["A ideia", content.idea], ["Roteiro / como vai ser", content.content_plan], ["Observações do planejamento", content.planning_notes], ["Objetivo <span class=\"field__optional\">· só a equipe vê</span>", content.objective], ["Pilar editorial <span class=\"field__optional\">· só a equipe vê</span>", content.pillar]])
      || '<p class="caption-text"><span class="field__optional">Sem ideia ainda. Use “Editar” para preencher a ideia e como vai ser.</span></p>';
    const production = block([["Texto na arte", content.art_text], ["Legenda", content.caption], ["Hashtags", content.hashtags], ["Chamada para ação", content.cta], ["Observações para o cliente", content.client_notes]])
      || '<p class="caption-text"><span class="field__optional">Sem legenda ainda.</span></p>';
    const guided = `
      <section class="stage-block stage-block--plan"><p class="stage-block__label">${icon("lightbulb")}Planejamento <span>· vai no link da ideia</span></p>${plan}</section>
      <section class="stage-block stage-block--final"><p class="stage-block__label">${icon("image")}Produção <span>· só vai ao cliente na aprovação final</span></p>${production}</section>`;
    const media = content.media_url
      ? `<div class="detail"><h3 class="detail__title">Referência <span class="field__optional">· só a equipe vê</span></h3><div class="media-ref">${renderMedia({ url: content.media_url, kind: content.media_kind || "image", title: content.title })}</div></div>`
      : "";
    $("#drawer-body").innerHTML = `
      <h2 class="drawer__title" id="drawer-title">${esc(content.title)}</h2>
      <dl class="facts">
        <div class="facts__row"><dt>${icon("user")}Cliente</dt><dd>${esc(clientName(content.client_id))}</dd></div>
        <div class="facts__row"><dt>${icon("calendar")}Data</dt><dd>${esc(longDayLabel(content.scheduled_date))}${content.scheduled_time ? ` às ${esc(timeLabel(content.scheduled_time.slice(0, 5)))}` : ""}</dd></div>
        <div class="facts__row"><dt>${icon("send")}Rede</dt><dd>${esc(NETWORKS[content.network] || content.network)}</dd></div>
        <div class="facts__row"><dt>${icon("image")}Formato</dt><dd>${esc(FORMATS[content.format]?.label || content.format)}</dd></div>
      </dl>
      <section class="task-box" aria-label="Tarefa">
        <div class="task-box__row"><span class="task-box__label">Responsáveis</span><span>${(content.assignees || []).length ? content.assignees.map((id) => `<span class="person-chip"><span class="avatar">${esc(initials(personName(state.team, id)))}</span>${esc(personName(state.team, id))}</span>`).join("") : '<span class="field__optional">Ninguém ainda</span>'}</span></div>
        <div class="task-box__row"><span class="task-box__label">Prazo interno</span><span>${content.due_date ? `${esc(longDayLabel(content.due_date))} ${dueChip(content)}` : '<span class="field__optional">Sem prazo</span>'}</span></div>
        <div class="task-box__row"><span class="task-box__label">Prioridade</span><span class="prio-chip prio-chip--${esc(content.priority || "media")}">${esc(PRIORITIES[content.priority || "media"].label)}</span></div>
      </section>
      ${guided}
      ${media}
      ${content.internal_notes ? `<div class="internal"><p class="internal__label">${icon("lock")}Observações internas · só a agência vê</p><p class="internal__text">${esc(content.internal_notes)}</p></div>` : ""}
      <p class="drawer__version">${esc(versionLine(content))}</p>
      <div class="drawer__actions">
        ${canEdit(content) ? `<button class="btn btn--primary btn--sm" type="button" data-edit-content="${esc(content.id)}">${icon("edit")}<span>Editar</span></button>` : ""}
        ${state.can.admin ? `<button class="btn btn--ghost btn--sm" type="button" data-delete-content="${esc(content.id)}">${icon("trash")}<span>Excluir</span></button>` : ""}
      </div>
      <section class="detail task-history"><h3 class="detail__title">Histórico da demanda</h3><div data-task-history><p class="field__hint">Carregando…</p></div></section>`;
    loadTaskHistory(content.id);
    // Arte final e aprovação: um bloco novo a cada abertura (os eventos ficam presos a ele)
    const review = document.createElement("div");
    review.className = "review";
    review.innerHTML = reviewSections();
    $("#drawer-body").querySelector(".drawer__version").before(review);
    const reviewer = mountReview({
      root: review, content, api, toast, confirm, canSend: state.can.send,
      onChanged: async (updated) => {
        const fresh = updated || await api.getContent(content.id).catch(() => null);
        await load();
        if (fresh && drawer.open && openId === content.id && review.isConnected) {
          // Atualiza só status e versão; a seção de arte final continua como está
          $("#drawer-badges").innerHTML = `${typeBadge(fresh.format, true)}${statusChip(fresh.status)}`;
          $("#drawer-body .drawer__version").textContent = versionLine(fresh);
          reviewer.update(fresh);
        }
      }
    });
    if (!drawer.open) drawer.showModal();
  }

  /* ---------- Formulário ---------- */
  function syncMediaKind() {
    const hasUrl = Boolean(form.elements.media_url.value.trim());
    mediaKind.hidden = !hasUrl;
    if (hasUrl && !form.elements.media_kind.value) form.elements.media_kind.value = FORMATS[form.elements.format.value]?.media || "image";
  }
  const syncCaption = () => { captionCount.textContent = `${form.elements.caption.value.length.toLocaleString("pt-BR")} de ${LIMITS.caption.toLocaleString("pt-BR")} caracteres`; };

  let afterSave = null;   // quem abriu o formulário quer saber do conteúdo salvo (ex.: lote de aprovação)
  function openForm(content = null, preset = null) {
    afterSave = preset?.onSaved || null;
    const active = state.clients.filter((c) => c.active || c.id === content?.client_id);
    if (!active.length) { toast("Cadastre um cliente antes de criar conteúdos.", "info"); navigate("clientes"); return; }
    editing = content;
    form.reset();
    showFieldErrors(form, {});
    dialog.querySelector(".modal__title").textContent = content ? "Editar conteúdo" : "Novo conteúdo";
    submit.querySelector("span").textContent = content ? "Salvar alterações" : "Cadastrar conteúdo";
    form.elements.client_id.innerHTML = `<option value="">Escolha o cliente</option>${options(active.map((c) => [c.id, c.name]))}`;
    if (content) {
      ["client_id", "title", "scheduled_date", "network", "format", "media_url", "pillar", "idea", "content_plan", "art_text", "objective", "caption", "hashtags", "cta", "client_notes", "planning_notes", "internal_notes", "approval_status", "final_status", "production_status", "due_date"].forEach((name) => { form.elements[name].value = content[name] || ""; });
      form.elements.priority.value = content.priority || "media";
      form.elements.scheduled_time.value = content.scheduled_time ? content.scheduled_time.slice(0, 5) : "";
      form.elements.media_kind.value = content.media_kind || "";
    } else {
      form.elements.client_id.value = state.filters.client_id || (active.length === 1 ? active[0].id : "");
      form.elements.scheduled_date.value = todayISO();
      form.elements.client_id.value = preset?.client_id || form.elements.client_id.value;
      if (preset?.scheduled_date) form.elements.scheduled_date.value = preset.scheduled_date;
      form.elements.approval_status.value = "rascunho";
      form.elements.final_status.value = "rascunho";
      form.elements.production_status.value = "";
      form.elements.priority.value = "media";
    }
    // Status de aprovação: só quem pode enviar para aprovação muda (o banco confere)
    form.elements.approval_status.disabled = !state.can.send;
    form.elements.final_status.disabled = !state.can.send;
    // Só quem edita tudo escolhe cliente e responsáveis
    form.elements.client_id.disabled = Boolean(content) && !state.can.edit;
    pickedAssignees = new Set(content ? content.assignees || [] : (!state.can.edit && state.me ? [state.me.user_id] : []));
    renderAssigneePicks();
    syncMediaKind();
    syncCaption();
    if (drawer.open) closeDialog(drawer);
    dialog.showModal();
    (content ? form.elements.title : form.elements.client_id.value ? form.elements.title : form.elements.client_id).focus();
  }

  let pickedAssignees = new Set();
  const assigneeBox = form.querySelector("[data-assignees]");
  function renderAssigneePicks() {
    const clientId = form.elements.client_id.value;
    const people = state.team.filter((m) => m.active !== false && (!clientId || seesClient(m, clientId) || pickedAssignees.has(m.user_id)));
    form.querySelector("[data-assignees-field]").disabled = !state.can.edit;
    assigneeBox.innerHTML = people.length
      ? people.map((m) => `<label class="check assignee-pick"><input type="checkbox" name="assignee" value="${esc(m.user_id)}" ${pickedAssignees.has(m.user_id) ? "checked" : ""}><span><b>${esc(m.name || m.username)}</b>${m.job_title ? ` <span class="field__optional">· ${esc(m.job_title)}</span>` : ""}</span></label>`).join("")
      : '<p class="field__hint">Ninguém da equipe vê este cliente ainda. Libere o cliente para alguém em Equipe.</p>';
  }
  form.elements.client_id.addEventListener("change", () => {
    pickedAssignees = new Set([...form.querySelectorAll("[name=assignee]:checked")].map((b) => b.value));
    renderAssigneePicks();
  });
  form.elements.media_url.addEventListener("input", syncMediaKind);
  form.elements.format.addEventListener("change", () => { if (!editing?.media_kind) { form.elements.media_kind.value = ""; syncMediaKind(); } });
  form.elements.caption.addEventListener("input", syncCaption);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const chosen = [...form.querySelectorAll("[name=assignee]:checked")].map((b) => b.value);
    delete data.assignee;
    // Campos travados não vão no formulário: mantém o que já estava
    if (form.elements.client_id.disabled) data.client_id = editing.client_id;
    if (!state.can.send) { data.approval_status = editing?.approval_status || "rascunho"; data.final_status = editing?.final_status || "rascunho"; }
    const { errors } = validateContent(data);
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    saving = true;
    setBusy(submit, true);
    try {
      const saved = editing ? await api.updateContent(editing.id, data) : await api.createContent(data);
      if (state.can.edit) saved.assignees = await api.setAssignees(saved.id, chosen, editing?.assignees || []);
      closeDialog(dialog);
      toast(editing ? "Conteúdo atualizado" : "Conteúdo cadastrado");
      document.dispatchEvent(new CustomEvent("content-saved", { detail: saved }));
      const callback = afterSave; afterSave = null;
      if (callback) await callback(saved); else await load();
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.message);
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  /* ---------- Exclusão ---------- */
  async function remove(content) {
    const ok = await confirm({ title: "Excluir este conteúdo?", text: `"${content.title}" será apagado do calendário de ${clientName(content.client_id)}. Esta ação não pode ser desfeita.` });
    if (!ok) return;
    try {
      await api.deleteContent(content.id);
      if (drawer.open) closeDialog(drawer);
      toast("Conteúdo excluído");
      await load();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ---------- Eventos ---------- */
  const find = (id) => contents.find((c) => c.id === id);
  on(document, "click", '[data-action="new-content"]', () => openForm());
  on(document, "click", '[data-action="go-clients"]', () => navigate("clientes"));
  on(document, "click", '[data-action="clear-filters"]', () => navigate("conteudos", {}, { replace: true }));
  on(document, "click", '[data-action="reload-contents"]', () => load());
  on(document, "click", "[data-view-content]", (event, btn) => { const c = find(btn.dataset.viewContent); if (c) openDetails(c); });

  /* ---------- Calendário: modos, navegação, dia, criar e arrastar ---------- */
  on(view, "click", "[data-cal-mode]", (event, b) => setMode(b.dataset.calMode));
  on(view, "click", "[data-cal-step]", (event, b) => {
    cursor = stepCursor(mode, cursor, Number(b.dataset.calStep));
    if (mode === "mes") {
      const today = todayISO();
      selected = today.slice(0, 7) === cursor.slice(0, 7) ? today : `${cursor.slice(0, 7)}-01`;
    } else selected = cursor;
    load();
  });
  on(view, "click", "[data-cal-today]", () => { cursor = selected = todayISO(); load(); });
  const openDay = (iso) => { cursor = selected = iso; setMode("dia"); };
  on(calendar, "click", "[data-cal-select]", (event, b) => {
    // Celular, no mês: tocar no dia mostra a agenda dele embaixo; no computador, abre o dia
    if (mode === "mes" && phone.matches) { selected = b.dataset.calSelect; renderCal(); calendar.querySelector(".agenda--picked")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    if (mode !== "dia") openDay(b.dataset.calSelect);
  });
  on(calendar, "click", "[data-cal-day-open]", (event, b) => openDay(b.dataset.calDayOpen));
  on(calendar, "click", "[data-cal-new]", (event, b) => openForm(null, { scheduled_date: b.dataset.calNew, client_id: state.filters.client_id }));
  phone.addEventListener("change", () => { if (mode !== "lista" && state.route === "conteudos" && contents) renderCal(); });

  // Arrastar uma etiqueta para outro dia muda a data (só o que a pessoa pode editar; o banco confere de novo)
  // Arrastar: etiqueta do calendário → outro dia (data); cartão do quadro → outra coluna (etapa)
  let drag = null;   // { id, kind: "day" | "stage" }
  const DROP = { day: "[data-cal-day]", stage: "[data-kcol]" };
  calendar.addEventListener("dragstart", (event) => {
    const el = event.target.closest?.("[data-drag], [data-kdrag]");
    if (!el) return;
    drag = el.dataset.drag ? { id: el.dataset.drag, kind: "day" } : { id: el.dataset.kdrag, kind: "stage" };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", drag.id);
    el.classList.add("is-dragging");
  });
  const clearDrag = () => calendar.querySelectorAll(".is-dragging, .is-drop").forEach((n) => n.classList.remove("is-dragging", "is-drop"));
  calendar.addEventListener("dragend", () => { drag = null; clearDrag(); });
  calendar.addEventListener("dragover", (event) => {
    const target = drag && event.target.closest?.(DROP[drag.kind]);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!target.classList.contains("is-drop")) { calendar.querySelectorAll(".is-drop").forEach((n) => n.classList.remove("is-drop")); target.classList.add("is-drop"); }
  });
  calendar.addEventListener("drop", (event) => {
    const current = drag;
    const target = current && event.target.closest?.(DROP[current.kind]);
    drag = null;
    clearDrag();
    if (!target) return;
    event.preventDefault();
    if (current.kind === "day") moveTo(current.id, target.dataset.calDay);
    else moveStage(current.id, target.dataset.kcol);
  });
  on(calendar, "change", "[data-kmove]", (event, select) => moveStage(select.dataset.kmove, select.value));
  async function moveStage(id, stage) {
    const c = find(id);
    const next = stage || null;
    if (!c || (c.production_status || null) === next || !canEdit(c)) return;
    const before = c.production_status || null;
    c.production_status = next;
    renderCal();
    try {
      const saved = await api.setContentProduction(id, next);
      Object.assign(c, saved, { assignees: c.assignees });
      renderCal();
      toast(`"${c.title}": ${BOARD_COLUMNS.find(([k]) => k === (stage || ""))[1]}`);
      document.dispatchEvent(new CustomEvent("content-saved", { detail: { id } }));
      loadAttention();
    } catch (error) {
      c.production_status = before;
      renderCal();
      toast(error.message, "error");
    }
  }
  async function moveTo(id, date) {
    const c = find(id);
    if (!c || c.scheduled_date === date || !canEdit(c)) return;
    const before = c.scheduled_date;
    c.scheduled_date = date;
    renderCal();
    try {
      const saved = await api.moveContent(id, date);
      Object.assign(c, saved, { assignees: c.assignees });
      toast(`"${c.title}" foi para ${shortDate(date)}`);
      document.dispatchEvent(new CustomEvent("content-saved", { detail: { id } }));
      loadAttention();
    } catch (error) {
      c.scheduled_date = before;
      renderCal();
      toast(error.message, "error");
    }
  }

  /* ---------- Prazos das cores (só administrador; o banco também confere) ---------- */
  const alertModal = $("#alert-modal");
  const alertForm = alertModal.querySelector("form");
  wireDialog(alertModal);
  on(document, "click", '[data-action="alert-settings"]', () => {
    if (!state.can.admin) return;
    showFieldErrors(alertForm, {});
    alertForm.elements.soon.value = state.alerts.soon;
    alertForm.elements.urgent.value = state.alerts.urgent;
    alertModal.showModal();
    alertForm.elements.soon.focus();
  });
  alertForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = alertForm.querySelector("[type=submit]");
    setBusy(button, true);
    try {
      state.alerts = await api.saveAlertSettings({ soon: alertForm.elements.soon.value, urgent: alertForm.elements.urgent.value });
      closeDialog(alertModal);
      toast("Prazos das cores atualizados para toda a equipe");
      if (mode !== "lista") renderCal();
      loadAttention();
    } catch (error) {
      showFieldErrors(alertForm, error.fields || {}, Object.keys(error.fields || {}).length ? "" : error.message);
    } finally { setBusy(button, false); }
  });

  /* ---------- Status em massa ---------- */
  on(list, "change", "[data-pick]", (event, box) => {
    if (box.checked) picked.add(box.dataset.pick); else picked.delete(box.dataset.pick);
    syncBulk();
  });
  bulkAll.addEventListener("click", () => {
    const all = contents.every((c) => picked.has(c.id));
    contents.forEach((c) => (all ? picked.delete(c.id) : picked.add(c.id)));
    syncBulk();
  });
  bulk.querySelector("[data-bulk-clear]").addEventListener("click", () => { picked.clear(); syncBulk(); });
  bulk.querySelector("[data-bulk-apply]").addEventListener("click", async (event) => {
    if (bulkBusy || !picked.size) return;
    const button = event.currentTarget;
    const status = bulkStatus.value;
    const chosen = contents.filter((c) => picked.has(c.id));
    const changing = chosen.filter((c) => c.status !== status);
    const label = CONTENT_STATUS[status].label;
    if (!changing.length) { toast(`Os conteúdos marcados já estão como "${label}".`); return; }
    const visibleNow = CLIENT_VISIBLE_STATUS.includes(status);
    const appear = changing.filter((c) => visibleNow && !CLIENT_VISIBLE_STATUS.includes(c.status)).length;
    const vanish = changing.filter((c) => !visibleNow && CLIENT_VISIBLE_STATUS.includes(c.status)).length;
    const n = changing.length;
    const parts = [];
    if (appear) parts.push(`${appear} ${appear === 1 ? "passa" : "passam"} a aparecer no calendário do cliente.`);
    if (vanish) parts.push(`${vanish} ${vanish === 1 ? "sai" : "saem"} do calendário do cliente.`);
    const ok = await confirm({
      title: `Mudar ${n} ${n === 1 ? "conteúdo" : "conteúdos"} para "${label}"?`,
      text: parts.join(" ") || "O calendário do cliente é atualizado na hora.",
      confirmLabel: "Mudar status",
      tone: "primary"
    });
    if (!ok) return;
    bulkBusy = true;
    setBusy(button, true);
    try {
      const updated = await api.setContentsStatus(changing.map((c) => c.id), status);
      toast(`${updated.length} ${updated.length === 1 ? "conteúdo atualizado" : "conteúdos atualizados"} para "${label}"`);
      picked.clear();
      await load();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      bulkBusy = false;
      setBusy(button, false);
      syncBulk();
    }
  });
  const findAny = (id) => find(id) || (lastOpened?.id === id ? lastOpened : null);
  on(document, "click", "[data-edit-content]", (event, btn) => { const c = findAny(btn.dataset.editContent); if (c) openForm(c); });
  on(document, "click", "[data-delete-content]", (event, btn) => { const c = find(btn.dataset.deleteContent); if (c) remove(c); });

  /** Histórico da demanda (quem criou, atribuiu, mudou prazo, produção e aprovação) */
  const EVENT_TEXT = {
    criado: () => "Demanda criada",
    responsavel_adicionado: (e) => `${e.metadata?.name || "Alguém"} virou responsável`,
    responsavel_removido: (e) => `${e.metadata?.name || "Alguém"} saiu da demanda`,
    producao: (e) => `Produção: ${PRODUCTION_STATUS[e.to_value]?.label || "não iniciada"}`,
    prazo: (e) => (e.to_value ? `Prazo interno: ${e.to_value.split("-").reverse().join("/")}` : "Prazo interno removido"),
    prioridade: (e) => `Prioridade: ${PRIORITIES[e.to_value]?.label || e.to_value}`,
    ideia: (e) => `Aprovação da ideia: ${APPROVAL_STATUS[e.to_value]?.label || e.to_value}`,
    final: (e) => `Aprovação final: ${APPROVAL_STATUS[e.to_value]?.label || e.to_value}`
  };
  async function loadTaskHistory(contentId) {
    const box = drawer.querySelector("[data-task-history]");
    try {
      const events = await api.contentEvents(contentId);
      if (!box.isConnected || openId !== contentId) return;
      box.innerHTML = events.length
        ? `<ul class="history">${events.map((e) => `<li class="history__item">${icon("dot")}<div><p class="history__title">${esc((EVENT_TEXT[e.event_type] || (() => e.event_type))(e))} <span class="history__meta">· ${esc(e.actor_name || "")} · ${esc(stampLabel(e.created_at))}</span></p></div></li>`).join("")}</ul>`
        : '<p class="field__hint">Sem registros ainda.</p>';
    } catch {
      if (box.isConnected) box.innerHTML = '<p class="field__hint">Não foi possível carregar o histórico.</p>';
    }
  }

  /** Abrir um conteúdo pelo id (ex.: a partir de Minhas demandas) */
  async function openById(id) {
    try {
      const [content, assignees] = await Promise.all([api.getContent(id), api.listAssignees(id)]);
      openDetails({ ...content, assignees });
    } catch (error) { toast(error.message, "error"); }
  }

  return { load, renderLoading, openForm, openById };
}
