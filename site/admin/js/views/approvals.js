/* ==========================================================================
   Aprovações de Conteúdo (painel da agência)
   --------------------------------------------------------------------------
   - Lista de lotes (planejamento do mês ou arte final) por cliente, com
     contagens, status geral, datas de envio e da última interação, filtros e
     destaque de quem ainda precisa aprovar.
   - Gerenciar o lote: conteúdos (incluir, ordenar, retirar, reenviar nova
     versão), link (gerar, copiar, abrir, regenerar, desativar), mensagem
     pronta para o WhatsApp, pré-visualização como cliente, relatório em PDF e
     histórico.
   - Avisos internos: decisões do cliente (aprovado, ajuste, lote aprovado,
     link expirado), atualizados a cada 30 s.
   O banco confere tudo de novo (funções approval_* e RLS).
   ========================================================================== */

import { $, esc, on } from "../../../js/lib/dom.js?v=b28509c2bb";
import { icon } from "../../../js/lib/icons.js?v=b28509c2bb";
import { monthLabel, timeLabel, stampLabel, todayISO, longDayLabel } from "../../../js/lib/dates.js?v=b28509c2bb";
import { typeBadge } from "../../../js/ui/badges.js?v=b28509c2bb";
import { APPROVAL_STATUS, APPROVAL_MODES, BATCH_STATUS, APPROVAL_EVENTS, isPending, approvalUrl, whatsappMessage } from "../../../js/domain/approvals.js?v=b28509c2bb";
import { NETWORKS, validateBatch } from "../domain/rules.js?v=b28509c2bb";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=b28509c2bb";
import { stateBlock, loadingCards, button } from "../ui/states.js?v=b28509c2bb";
import { buildApprovalReport, reportFileName } from "../ui/approval-report.js?v=b28509c2bb";

const POLL_MS = 30000;
const options = (entries, placeholder) => `${placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : ""}${entries.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}`;
const dateTime = (iso) => (iso ? stampLabel(iso) : "—");
const apprBadge = (status) => { const s = APPROVAL_STATUS[status] || APPROVAL_STATUS.rascunho; return `<span class="appr-chip appr-chip--${esc(s.tone)}">${icon(s.icon)}${esc(s.label)}</span>`; };
const batchBadge = (status) => { const s = BATCH_STATUS[status] || BATCH_STATUS.rascunho; return `<span class="appr-chip appr-chip--${esc(s.tone)}">${esc(s.label)}</span>`; };
const origin = () => `${location.origin}${location.pathname.replace(/\/admin\/.*$/, "").replace(/\/admin$/, "")}`;

export function setupApprovals({ api, state, toast, confirm, navigate, openContentForm }) {
  const view = $("#view-aprovacoes");
  const list = $("#batches-list");
  const count = $("#batches-count");
  const overview = view.querySelector("[data-appr-overview]");
  const filtersForm = $("#batch-filters");
  const notifPanel = $("#approval-notifications");
  const notifCount = view.querySelector("[data-notif-count]");
  const navBadge = document.querySelector("[data-approvals-attention]");
  const batchModal = $("#batch-modal");
  const batchForm = batchModal.querySelector("form");
  const drawer = $("#batch-drawer");
  const drawerBody = drawer.querySelector("[data-batch-body]");
  const pickModal = $("#pick-modal");
  const pickForm = pickModal.querySelector("form");
  const publishModal = $("#publish-modal");
  const publishForm = publishModal.querySelector("form");
  [batchModal, pickModal, publishModal].forEach((d) => wireDialog(d));
  wireDialog(drawer);

  let batches = [];
  let loaded = false;
  let editingBatch = null;
  let current = null;        // { batch, detail, contents, token }
  let unread = [];
  let seenEvents = null;     // ids já vistos (para avisar só o que é novo)
  let poll = null;

  filtersForm.elements.status.insertAdjacentHTML("beforeend", options(Object.entries(BATCH_STATUS).map(([k, v]) => [k, v.label])));
  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente removido";
  const readFilters = () => {
    const f = Object.fromEntries(new FormData(filtersForm));
    return { client_id: f.client_id || "", month: f.month || "", status: f.status || "", sent_from: f.sent_from || "" };
  };
  const filtered = () => {
    const f = readFilters();
    return batches.filter((b) => (!f.client_id || b.client_id === f.client_id) && (!f.month || b.month.startsWith(f.month))
      && (!f.status || b.overall_status === f.status) && (!f.sent_from || (b.sent_at && b.sent_at.slice(0, 10) >= f.sent_from))
      && (f.status === "arquivado" || !b.archived_at));
  };

  /* ---------- Lista ---------- */
  function renderLoading() { list.setAttribute("aria-busy", "true"); list.innerHTML = loadingCards(3); }

  function linkLine(b) {
    if (!b.link_id) return `${icon("link")}Sem link ativo`;
    const expired = b.link_expires_at && b.link_expires_at <= new Date().toISOString();
    if (expired) return `${icon("clock")}Link expirou em ${esc(dateTime(b.link_expires_at))}`;
    return `${icon("link")}Link ativo desde ${esc(dateTime(b.link_created_at))}${b.link_expires_at ? ` · expira ${esc(dateTime(b.link_expires_at))}` : ""}`;
  }

  function batchCard(b) {
    const mode = APPROVAL_MODES[b.approval_mode];
    const reviewed = Number(b.aprovados) + Number(b.ajustes);
    const sent = Number(b.total) - Number(b.rascunhos);
    return `
      <article class="batch-card batch-card--${esc(b.overall_status)}" data-batch="${esc(b.id)}">
        <div class="batch-card__head">
          <div class="batch-card__who">
            <p class="batch-card__client">${esc(clientName(b.client_id))}</p>
            <h3 class="batch-card__title">${esc(b.title)}</h3>
            <p class="batch-card__meta">${icon("calendar")}${esc(monthLabel(b.month.slice(0, 7)))} · ${icon(mode.icon)}${esc(mode.short)}</p>
          </div>
          ${batchBadge(b.overall_status)}
        </div>
        <ul class="batch-counts" aria-label="Contagem dos conteúdos">
          <li><b>${esc(b.total)}</b><span>conteúdos</span></li>
          <li class="is-ok"><b>${esc(b.aprovados)}</b><span>aprovados</span></li>
          <li class="is-wait"><b>${esc(b.aguardando)}</b><span>aguardando</span></li>
          <li class="is-adjust"><b>${esc(b.ajustes)}</b><span>ajustes</span></li>
        </ul>
        <progress class="batch-progress" max="${Math.max(1, sent)}" value="${reviewed}" aria-label="${reviewed} de ${sent} revisados"></progress>
        <dl class="batch-dates">
          <div><dt>Enviado</dt><dd>${esc(dateTime(b.sent_at))}</dd></div>
          <div><dt>Última interação do cliente</dt><dd>${esc(dateTime(b.last_client_action_at))}</dd></div>
        </dl>
        <p class="batch-link">${linkLine(b)}</p>
        <div class="batch-card__actions">
          <button class="btn btn--primary btn--sm" type="button" data-batch-open="${esc(b.id)}">${icon("layers")}<span>Gerenciar conteúdos</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-batch-preview="${esc(b.id)}">${icon("eye")}<span>Visualizar como cliente</span></button>
          ${b.archived_at ? "" : b.link_id ? `
            <button class="btn btn--ghost btn--sm" type="button" data-batch-copy="${esc(b.id)}">${icon("copy")}<span>Copiar link</span></button>
            <button class="btn btn--ghost btn--sm" type="button" data-batch-whatsapp="${esc(b.id)}">${icon("message")}<span>Mensagem WhatsApp</span></button>
            <button class="btn btn--ghost btn--sm btn--danger-text" type="button" data-batch-revoke="${esc(b.id)}">${icon("lock")}<span>Desativar link</span></button>`
            : `<button class="btn btn--ghost btn--sm" type="button" data-batch-publish="${esc(b.id)}">${icon("link")}<span>Gerar link</span></button>`}
          <button class="btn btn--ghost btn--sm btn--danger-text" type="button" data-batch-delete="${esc(b.id)}">${icon("trash")}<span>Excluir</span></button>
        </div>
      </article>`;
  }

  function renderOverview() {
    const active = batches.filter((b) => !b.archived_at);
    const waiting = active.filter((b) => Number(b.aguardando) > 0);
    const adjust = active.filter((b) => Number(b.ajustes) > 0);
    if (!waiting.length && !adjust.length) { overview.innerHTML = ""; return; }
    const line = (b, n, word) => `<li><button type="button" class="link-btn" data-batch-open="${esc(b.id)}"><b>${esc(clientName(b.client_id))}</b> · ${esc(b.title)}</button> <span>${n} ${word}</span></li>`;
    overview.innerHTML = `
      <div class="appr-overview__box appr-overview__box--wait">
        <p class="appr-overview__title">${icon("clock")}${waiting.length} ${waiting.length === 1 ? "lote aguardando o cliente" : "lotes aguardando o cliente"}</p>
        <ul>${waiting.slice(0, 6).map((b) => line(b, b.aguardando, Number(b.aguardando) === 1 ? "para aprovar" : "para aprovar")).join("")}</ul>
      </div>
      ${adjust.length ? `<div class="appr-overview__box appr-overview__box--adjust">
        <p class="appr-overview__title">${icon("message")}${adjust.length} ${adjust.length === 1 ? "lote com ajustes pedidos" : "lotes com ajustes pedidos"}</p>
        <ul>${adjust.slice(0, 6).map((b) => line(b, b.ajustes, Number(b.ajustes) === 1 ? "ajuste" : "ajustes")).join("")}</ul>
      </div>` : ""}`;
  }

  function render() {
    list.setAttribute("aria-busy", "false");
    renderOverview();
    const rows = filtered();
    const any = Object.values(readFilters()).some(Boolean);
    count.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "lote" : "lotes"}${any ? " com esses filtros" : ""}` : "";
    if (!rows.length) {
      list.innerHTML = batches.length
        ? stateBlock({ iconName: "check", title: "Nenhum lote com esses filtros", text: "Ajuste o cliente, o mês ou o status.", actions: button("clear-batch-filters", "Limpar filtros", { iconName: "refresh" }) })
        : stateBlock({ iconName: "check", title: "Nenhum lote de aprovação ainda", text: "Crie o lote do mês, escolha os conteúdos e gere o link para o cliente aprovar sem login.", actions: button("new-batch", "Criar o primeiro lote", { primary: true, iconName: "sparkle" }) });
      return;
    }
    list.innerHTML = rows.map(batchCard).join("");
  }

  async function load(params = {}) {
    filtersForm.elements.client_id.innerHTML = `<option value="">Todos os clientes</option>${options(state.clients.map((c) => [c.id, c.name]))}`;
    ["client_id", "month", "status", "sent_from"].forEach((k) => { if (params[k] !== undefined) filtersForm.elements[k].value = params[k]; });
    if (!loaded) renderLoading();
    try {
      batches = await api.listBatches();
      loaded = true;
      render();
    } catch (error) {
      list.setAttribute("aria-busy", "false");
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar os lotes", text: error.message, actions: button("reload-batches", "Tentar de novo", { iconName: "refresh" }) });
    }
    refreshAttention();
    if (params.batch) openBatch(params.batch);
    if (params.enviar) {
      history.replaceState(null, "", "#/aprovacoes");
      sendToStage(params.enviar, params.etapa === "final" ? "final" : "planejamento");
    }
  }

  /** "Enviar para aprovação da ideia/final" a partir do conteúdo: entra no lote
      aberto daquele cliente, mês e etapa (ou num lote novo) e abre o envio */
  async function sendToStage(contentId, mode) {
    try {
      const content = await api.getContent(contentId);
      const month = content.scheduled_date.slice(0, 7);
      let batch = batches.find((b) => !b.archived_at && b.client_id === content.client_id && b.month.startsWith(month) && b.approval_mode === mode);
      if (!batch) {
        const name = monthLabel(month).split(" ")[0].toLowerCase();
        const created = await api.createBatch({ client_id: content.client_id, title: `${mode === "final" ? "Conteúdo final" : "Planejamento"} de ${name}`, month: `${month}-01`, approval_mode: mode });
        batches = await api.listBatches();
        batch = summaryOf(created.id);
      }
      const detail = await api.batchDetail(batch.id);
      const inBatch = detail.items.filter((i) => !i.removed_at).map((i) => i.content_id).filter(Boolean);
      if (!inBatch.includes(content.id)) await api.setBatchItems(batch.id, [...inBatch, content.id]);
      batches = await api.listBatches();
      render();
      await openPublish(batch.id);
      toast(`"${content.title}" está no lote "${batch.title}". Confira e envie.`);
    } catch (error) {
      toast(error.message, "error");
    }
  }
  on(filtersForm, "change", "input, select", () => render());
  filtersForm.addEventListener("reset", () => setTimeout(render));
  on(document, "click", '[data-action="clear-batch-filters"]', () => { filtersForm.reset(); render(); });
  on(document, "click", '[data-action="reload-batches"]', () => load());

  /* ---------- Avisos internos ---------- */
  const eventText = (e) => {
    const b = batches.find((x) => x.id === e.batch_id);
    const where = b ? `${clientName(b.client_id)} · ${b.title}` : "Lote";
    const who = e.actor_reference && e.actor_type === "cliente" ? e.actor_reference : "";
    const final = (e.metadata?.stage || b?.approval_mode) === "final";
    const title = e.event_type === "aprovado" ? `${who || "Cliente"} aprovou ${final ? "um conteúdo final" : "uma ideia"}`
      : e.event_type === "ajustes" ? `${who || "Cliente"} pediu ajuste ${final ? "no conteúdo final" : "na ideia"}`
      : e.event_type === "lote_aprovado" ? (final ? "Conteúdo final totalmente aprovado" : "Planejamento totalmente aprovado")
      : e.event_type === "link_expirado" ? "Link expirado"
      : APPROVAL_EVENTS[e.event_type] || e.event_type;
    return { where, title, comment: e.metadata?.comment || "" };
  };
  function renderNotifications() {
    notifCount.hidden = !unread.length;
    notifCount.textContent = unread.length > 99 ? "99+" : String(unread.length);
    navBadge.hidden = !unread.length;
    navBadge.textContent = notifCount.textContent;
    navBadge.setAttribute("aria-label", `${unread.length} ${unread.length === 1 ? "aviso novo" : "avisos novos"} de aprovação`);
    if (notifPanel.hidden) return;
    notifPanel.innerHTML = unread.length
      ? `<div class="notif-panel__head"><p class="notif-panel__title">${icon("bell")}Avisos de aprovação</p><button class="link-btn" type="button" data-notif-read-all>Marcar todos como lidos</button></div>
         <ul class="notif-list">${unread.slice(0, 30).map((e) => { const t = eventText(e); return `
           <li class="notif notif--${esc(e.event_type)}">
             <button type="button" class="notif__open" data-notif-open="${esc(e.id)}" data-batch="${esc(e.batch_id)}">
               <span class="notif__title">${esc(t.title)}</span>
               <span class="notif__where">${esc(t.where)} · ${esc(dateTime(e.created_at))}</span>
               ${t.comment ? `<span class="notif__comment">“${esc(t.comment)}”</span>` : ""}
             </button>
           </li>`; }).join("")}</ul>`
      : `<p class="notif-panel__empty">${icon("check")}Nenhum aviso novo. As decisões dos clientes aparecem aqui.</p>`;
  }
  async function refreshAttention({ notify = false } = {}) {
    try {
      unread = await api.unreadEvents();
    } catch { return; }
    const ids = new Set(unread.map((e) => e.id));
    if (notify && seenEvents) {
      const fresh = unread.filter((e) => !seenEvents.has(e.id));
      if (fresh.length) {
        const t = eventText(fresh[0]);
        toast(fresh.length === 1 ? `${t.title} · ${t.where}` : `${fresh.length} novas respostas de clientes nas aprovações`, "info");
        if (state.route === "aprovacoes") { batches = await api.listBatches().catch(() => batches); render(); if (current && drawer.open) openBatch(current.batch.id, { keepScroll: true }); }
      }
    }
    seenEvents = ids;
    renderNotifications();
  }
  function startPolling() {
    stopPolling();
    poll = setInterval(() => { if (!document.hidden) refreshAttention({ notify: true }); }, POLL_MS);
  }
  function stopPolling() { if (poll) clearInterval(poll); poll = null; }
  on(view, "click", '[data-action="toggle-notifications"]', (e, b) => {
    notifPanel.hidden = !notifPanel.hidden;
    b.setAttribute("aria-expanded", String(!notifPanel.hidden));
    renderNotifications();
  });
  on(notifPanel, "click", "[data-notif-read-all]", async () => {
    try { await api.markRead(null); unread = []; renderNotifications(); toast("Avisos marcados como lidos"); } catch (error) { toast(error.message, "error"); }
  });
  on(notifPanel, "click", "[data-notif-open]", async (e, b) => {
    api.markRead([b.dataset.notifOpen]).then(() => refreshAttention()).catch(() => {});
    openBatch(b.dataset.batch);
  });

  /* ---------- Criar / editar lote ---------- */
  function openBatchForm(batch = null, preset = {}) {
    const active = state.clients.filter((c) => c.active || c.id === batch?.client_id);
    if (!active.length) { toast("Cadastre um cliente antes de criar um lote.", "info"); navigate("clientes"); return; }
    editingBatch = batch;
    batchForm.reset();
    showFieldErrors(batchForm, {});
    batchModal.querySelector("#batch-modal-title").textContent = batch ? "Editar lote" : "Novo lote de aprovação";
    batchForm.querySelector("[type=submit] span").textContent = batch ? "Salvar" : "Criar lote";
    batchForm.elements.client_id.innerHTML = `<option value="">Escolha o cliente</option>${options(active.map((c) => [c.id, c.name]))}`;
    const next = new Date(); next.setMonth(next.getMonth() + 1);
    const values = batch || { client_id: preset.client_id || readFilters().client_id || (active.length === 1 ? active[0].id : ""), month: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`, approval_mode: "planejamento", title: "", intro_message: "" };
    batchForm.elements.client_id.value = values.client_id || "";
    batchForm.elements.client_id.disabled = Boolean(batch);
    batchForm.elements.title.value = values.title || "";
    batchForm.elements.month.value = values.month ? values.month.slice(0, 7) : "";
    batchForm.elements.intro_message.value = values.intro_message || "";
    batchForm.querySelector(`[name=approval_mode][value="${values.approval_mode || "planejamento"}"]`).checked = true;
    const sent = Boolean(batch?.sent_at);
    batchForm.querySelectorAll("[name=approval_mode]").forEach((r) => { r.disabled = sent; });
    batchForm.querySelector("[data-mode-locked]").hidden = !sent;
    if (!batch && !batchForm.elements.title.value && batchForm.elements.month.value) batchForm.elements.title.value = autoTitle();
    batchModal.showModal();
    (batchForm.elements.client_id.value ? batchForm.elements.title : batchForm.elements.client_id).focus();
  }
  // Título automático: "Planejamento de dezembro" ou "Conteúdo final de dezembro"
  function autoTitle() {
    const month = batchForm.elements.month.value ? monthLabel(batchForm.elements.month.value).split(" ")[0].toLowerCase() : "";
    const final = batchForm.querySelector("[name=approval_mode]:checked")?.value === "final";
    return month ? `${final ? "Conteúdo final" : "Planejamento"} de ${month}` : "";
  }
  const syncAutoTitle = () => {
    if (editingBatch) return;
    const t = batchForm.elements.title;
    if (!t.value || /^(Planejamento|Conteúdo final) de \S+$/.test(t.value)) t.value = autoTitle();
  };
  batchForm.elements.month.addEventListener("change", syncAutoTitle);
  batchForm.querySelectorAll("[name=approval_mode]").forEach((r) => r.addEventListener("change", syncAutoTitle));
  batchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(batchForm));
    if (editingBatch) { data.client_id = editingBatch.client_id; data.approval_mode ||= editingBatch.approval_mode; }
    const { errors } = validateBatch(data);
    if (Object.keys(errors).length) { showFieldErrors(batchForm, errors); return; }
    const submit = batchForm.querySelector("[type=submit]");
    setBusy(submit, true);
    try {
      const saved = editingBatch ? await api.updateBatch(editingBatch.id, data) : await api.createBatch(data);
      closeDialog(batchModal);
      toast(editingBatch ? "Lote atualizado" : "Lote criado. Agora escolha os conteúdos.");
      batches = await api.listBatches();
      render();
      await openBatch(saved.id);
      if (!editingBatch) openPicker();
    } catch (error) {
      showFieldErrors(batchForm, error.fields || {}, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
  on(document, "click", '[data-action="new-batch"]', () => openBatchForm());

  /* ---------- Gerenciar o lote ---------- */
  const summaryOf = (id) => batches.find((b) => b.id === id);
  const activeItems = () => (current?.detail.items || []).filter((i) => !i.removed_at);
  const versionOf = (item) => current.detail.versions.find((v) => v.id === item.version_id);
  const contentOf = (item) => current.contents.find((c) => c.id === item.content_id);
  // Mudou depois do envio, só nos campos que o cliente vê nesta etapa (banco: approval_stale)
  const isStale = (item) => Boolean(current?.detail.stale?.has(item.id));
  const itemTitle = (item) => versionOf(item)?.snapshot?.title || contentOf(item)?.title || "Conteúdo removido";

  async function openBatch(id, { keepScroll = false } = {}) {
    const summary = summaryOf(id) || (await api.listBatches().then((rows) => { batches = rows; return summaryOf(id); }));
    if (!summary) { toast("Lote não encontrado.", "error"); return; }
    const scroll = keepScroll ? drawerBody.scrollTop : 0;
    if (!drawer.open) { drawerBody.innerHTML = `<div class="state"><span class="skeleton final-art__loading"></span></div>`; drawer.showModal(); }
    try {
      const [detail, contents] = await Promise.all([api.batchDetail(id), api.listContents({ client_id: summary.client_id })]);
      current = { batch: summary, detail, contents, token: current?.batch.id === id ? current.token : null };
      renderDrawer();
      drawerBody.scrollTop = scroll;
    } catch (error) {
      drawerBody.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível abrir o lote", text: error.message });
    }
  }

  function itemRow(item, index, total) {
    const v = versionOf(item);
    const c = v?.snapshot || contentOf(item) || {};
    const lastDecision = current.detail.decisions.find((d) => d.item_id === item.id);
    const stale = isStale(item);
    const canResend = item.status === "ajustes" || stale;
    return `
      <li class="batch-item batch-item--${esc(item.status)}" data-item="${esc(item.id)}">
        <div class="batch-item__order">
          <button class="icon-btn" type="button" data-item-move="-1" ${index === 0 ? "disabled" : ""} aria-label="Mover para cima">${icon("chevronLeft", "icon icon--up")}</button>
          <span>${index + 1}</span>
          <button class="icon-btn" type="button" data-item-move="1" ${index === total - 1 ? "disabled" : ""} aria-label="Mover para baixo">${icon("chevronRight", "icon icon--down")}</button>
        </div>
        <div class="batch-item__main">
          <p class="batch-item__date">${c.scheduled_date ? esc(longDayLabel(c.scheduled_date)) : ""}${c.scheduled_time ? ` · ${esc(timeLabel(String(c.scheduled_time).slice(0, 5)))}` : ""}</p>
          <p class="batch-item__title">${esc(itemTitle(item))}</p>
          <p class="batch-item__tags">${c.format ? typeBadge(c.format) : ""}<span class="prod-chip">${esc(NETWORKS[c.network] || c.network || "")}</span>${v ? `<span class="prod-chip">Versão ${esc(v.version_number)}</span>` : ""}</p>
          ${stale ? `<p class="approval-box__warn">${icon("refresh")}Alterado depois do envio. O cliente ainda vê a versão ${esc(v.version_number)}.</p>` : ""}
          ${lastDecision ? `<p class="batch-item__decision batch-item__decision--${esc(lastDecision.action)}">${icon(lastDecision.action === "aprovado" ? "check" : "message")}${lastDecision.action === "aprovado" ? "Aprovado" : "Ajuste pedido"}${lastDecision.reviewer_name ? ` por ${esc(lastDecision.reviewer_name)}` : ""} · ${esc(dateTime(lastDecision.created_at))}${lastDecision.comment ? `<span class="batch-item__comment">“${esc(lastDecision.comment)}”</span>` : ""}</p>` : ""}
        </div>
        <div class="batch-item__side">
          ${apprBadge(item.status)}
          <div class="batch-item__buttons">
            ${canResend && !current.batch.archived_at ? `<button class="btn btn--primary btn--sm" type="button" data-item-resend="${esc(item.id)}">${icon("send")}<span>Reenviar nova versão</span></button>` : ""}
            ${contentOf(item) ? `<button class="btn btn--ghost btn--sm" type="button" data-item-edit="${esc(item.content_id)}">${icon("edit")}<span>Editar conteúdo</span></button>` : ""}
            ${current.batch.archived_at ? "" : `<button class="icon-btn icon-btn--danger" type="button" data-item-remove="${esc(item.id)}" aria-label="Retirar do lote" title="Retirar do lote">${icon("trash")}</button>`}
          </div>
        </div>
      </li>`;
  }

  function linkBox() {
    const b = current.batch;
    if (b.archived_at) return `<p class="field__hint">${icon("box")}Lote arquivado: o link não funciona. Reative para gerar um novo.</p>`;
    if (!b.link_id) {
      return `
        <div class="link-box link-box--empty">
          <p>${icon("link")}<b>Sem link ativo.</b> Gere o link para o cliente abrir sem login.</p>
          <button class="btn btn--primary" type="button" data-batch-publish="${esc(b.id)}">${icon("link")}<span>Gerar link para aprovação</span></button>
        </div>`;
    }
    const url = current.token ? approvalUrl(origin(), current.token) : "";
    return `
      <div class="link-box">
        <p class="link-box__state">${linkLine(b)}${b.link_last_used_at ? ` · aberto pela última vez ${esc(dateTime(b.link_last_used_at))}` : ""}</p>
        <label class="field"><span class="visually-hidden">Link de aprovação</span>
          <input class="field__input link-box__url" readonly value="${esc(url)}" placeholder="Clique em Copiar link para buscar o endereço" data-link-url>
        </label>
        <div class="link-box__buttons">
          <button class="btn btn--primary btn--sm" type="button" data-batch-copy="${esc(b.id)}">${icon("copy")}<span>Copiar link</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-batch-whatsapp="${esc(b.id)}">${icon("message")}<span>Copiar mensagem WhatsApp</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-batch-open-link="${esc(b.id)}">${icon("arrowRight")}<span>Abrir link</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-batch-publish="${esc(b.id)}">${icon("send")}<span>Enviar novos conteúdos</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-batch-regenerate="${esc(b.id)}">${icon("refresh")}<span>Regenerar link</span></button>
          <button class="btn btn--ghost btn--sm btn--danger-text" type="button" data-batch-revoke="${esc(b.id)}">${icon("lock")}<span>Desativar link</span></button>
        </div>
      </div>`;
  }

  function historyList() {
    const events = current.detail.events;
    if (!events.length) return '<p class="field__hint">Sem histórico ainda.</p>';
    const titleById = new Map(current.detail.items.map((i) => [i.id, itemTitle(i)]));
    return `<ul class="history">${events.slice(0, 80).map((e) => `
      <li class="history__item history__item--${esc(e.event_type === "aprovado" || e.event_type === "lote_aprovado" ? "aprovado" : e.event_type === "ajustes" ? "ajustes" : "neutro")}">
        ${icon(e.event_type === "aprovado" || e.event_type === "lote_aprovado" ? "check" : e.event_type === "ajustes" ? "message" : e.event_type.startsWith("link") ? "link" : "dot")}
        <div>
          <p class="history__title">${esc(APPROVAL_EVENTS[e.event_type] || e.event_type)}${e.item_id && titleById.get(e.item_id) ? ` · ${esc(titleById.get(e.item_id))}` : ""} <span class="history__meta">· ${esc(dateTime(e.created_at))}${e.actor_reference ? ` · ${esc(e.actor_type === "cliente" ? `${e.actor_reference} (pelo link)` : e.actor_reference)}` : ""}${e.metadata?.version_number ? ` · versão ${esc(e.metadata.version_number)}` : ""}${e.metadata?.bulk ? " · em lote" : ""}</span></p>
          ${e.metadata?.comment ? `<p class="history__text">${esc(e.metadata.comment)}</p>` : ""}
        </div>
      </li>`).join("")}</ul>
      <p class="field__hint">O nome vem do que a pessoa informou ao abrir o link: identifica a sessão, não comprova a identidade.</p>`;
  }

  function renderDrawer() {
    const b = current.batch;
    const mode = APPROVAL_MODES[b.approval_mode];
    const items = activeItems();
    drawer.querySelector("[data-batch-badges]").innerHTML = `${batchBadge(b.overall_status)}<span class="appr-chip appr-chip--neutral">${icon(mode.icon)}${esc(mode.label)}</span>`;
    drawerBody.innerHTML = `
      <h2 class="drawer__title" id="batch-drawer-title">${esc(b.title)}</h2>
      <dl class="facts">
        <div class="facts__row"><dt>${icon("user")}Cliente</dt><dd>${esc(clientName(b.client_id))}</dd></div>
        <div class="facts__row"><dt>${icon("calendar")}Mês</dt><dd>${esc(monthLabel(b.month.slice(0, 7)))}</dd></div>
        <div class="facts__row"><dt>${icon("send")}Enviado</dt><dd>${esc(dateTime(b.sent_at))}</dd></div>
        <div class="facts__row"><dt>${icon("clock")}Última interação</dt><dd>${esc(dateTime(b.last_client_action_at))}</dd></div>
      </dl>
      ${b.intro_message ? `<p class="batch-intro">${esc(b.intro_message)}</p>` : ""}
      <div class="drawer__actions batch-actions">
        <button class="btn btn--ghost btn--sm" type="button" data-batch-edit="${esc(b.id)}">${icon("edit")}<span>Editar dados</span></button>
        <button class="btn btn--ghost btn--sm" type="button" data-batch-preview="${esc(b.id)}">${icon("eye")}<span>Visualizar como cliente</span></button>
        <button class="btn btn--ghost btn--sm" type="button" data-batch-report="${esc(b.id)}">${icon("download")}<span>Relatório PDF</span></button>
        <button class="btn btn--ghost btn--sm" type="button" data-batch-archive="${esc(b.id)}">${icon("box")}<span>${b.archived_at ? "Reativar lote" : "Arquivar lote"}</span></button>
        <button class="btn btn--ghost btn--sm btn--danger-text" type="button" data-batch-delete="${esc(b.id)}">${icon("trash")}<span>Excluir lote</span></button>
      </div>
      <section class="detail"><div class="detail__head"><h3 class="detail__title">Link de aprovação</h3></div>${linkBox()}</section>
      <section class="detail">
        <div class="detail__head"><h3 class="detail__title">Conteúdos (${items.length})</h3>
          ${b.archived_at ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-action="pick-contents">${icon("sparkle")}<span>Adicionar conteúdo</span></button>`}</div>
        ${items.length ? `<ol class="batch-items">${items.map((i, n) => itemRow(i, n, items.length)).join("")}</ol>` : `<p class="field__hint">Nenhum conteúdo ainda. Clique em "Adicionar conteúdo" para escolher do calendário do cliente ou criar um novo.</p>`}
      </section>
      <section class="detail"><div class="detail__head"><h3 class="detail__title">Histórico</h3></div>${historyList()}</section>`;
  }

  async function reloadCurrent(message) {
    batches = await api.listBatches();
    render();
    if (current) await openBatch(current.batch.id, { keepScroll: true });
    if (message) toast(message);
  }

  /* ---------- Conteúdos do lote ---------- */
  // Na escolha: status da etapa do lote; no final, também a ideia e o que falta
  function pickStage(c) {
    if (current.batch.approval_mode !== "final") return apprBadge(c.approval_status);
    const ready = Number(c.assets_count) > 0 || Boolean(String(c.caption || "").trim());
    const idea = APPROVAL_STATUS[c.approval_status];
    return `<span class="pick-item__stages">
      ${apprBadge(c.final_status || "rascunho")}
      <span class="prod-chip">Ideia: ${esc((idea?.short || "Rascunho").toLowerCase())}</span>
      ${ready ? "" : `<span class="prod-chip prod-chip--warn">${icon("message")}Sem arte nem legenda</span>`}
    </span>`;
  }
  function pickRows() {
    const scope = pickModal.querySelector("[data-pick-scope]").value;
    const month = current.batch.month.slice(0, 7);
    const inBatch = new Set(activeItems().map((i) => i.content_id));
    const rows = current.contents.filter((c) => scope === "all" || c.scheduled_date.startsWith(month) || inBatch.has(c.id));
    pickModal.querySelector("[data-pick-list]").innerHTML = rows.length
      ? `<ul class="pick-items">${rows.map((c) => `
          <li><label class="check pick-item">
            <input type="checkbox" name="content" value="${esc(c.id)}" ${inBatch.has(c.id) ? "checked" : ""}>
            <span class="pick-item__body">
              <span class="pick-item__title">${esc(c.title)}</span>
              <span class="pick-item__meta">${esc(longDayLabel(c.scheduled_date))}${c.scheduled_time ? ` · ${esc(timeLabel(c.scheduled_time.slice(0, 5)))}` : ""} · ${esc(NETWORKS[c.network] || c.network)} ${typeBadge(c.format)}</span>
            </span>
            ${pickStage(c)}
          </label></li>`).join("")}</ul>`
      : `<p class="field__hint">Nenhum conteúdo de ${esc(clientName(current.batch.client_id))} ${scope === "all" ? "" : `em ${esc(monthLabel(month))}`}. Crie um novo ou mostre todos.</p>`;
  }
  function openPicker() {
    if (!current) return;
    showFieldErrors(pickForm, {});
    pickModal.querySelector("[data-pick-scope]").value = "month";
    pickRows();
    pickModal.showModal();
  }
  pickModal.querySelector("[data-pick-scope]").addEventListener("change", pickRows);
  on(drawer, "click", '[data-action="pick-contents"]', () => openPicker());
  on(pickModal, "click", '[data-action="pick-new-content"]', () => {
    const batch = current.batch;
    closeDialog(pickModal);
    closeDialog(drawer);
    openContentForm(null, {
      client_id: batch.client_id,
      scheduled_date: todayISO().startsWith(batch.month.slice(0, 7)) ? todayISO() : batch.month,
      onSaved: async (saved) => {
        try {
          await api.setBatchItems(batch.id, [...activeItems().map((i) => i.content_id).filter(Boolean), saved.id]);
          toast("Conteúdo criado e incluído no lote");
        } catch (error) { toast(error.message, "error"); }
        navigate("aprovacoes", { batch: batch.id });
      }
    });
  });
  pickForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const checked = [...pickForm.querySelectorAll("[name=content]:checked")].map((i) => i.value);
    // Mantém a ordem atual e põe os novos no fim, por data
    const kept = activeItems().map((i) => i.content_id).filter((id) => checked.includes(id));
    const added = checked.filter((id) => !kept.includes(id)).sort((a, b) => {
      const ca = current.contents.find((c) => c.id === a); const cb = current.contents.find((c) => c.id === b);
      return `${ca?.scheduled_date}${ca?.scheduled_time || ""}`.localeCompare(`${cb?.scheduled_date}${cb?.scheduled_time || ""}`);
    });
    const removing = activeItems().filter((i) => !checked.includes(i.content_id)).length;
    if (removing && current.batch.sent_at) {
      const ok = await confirm({ title: `Retirar ${removing} ${removing === 1 ? "conteúdo" : "conteúdos"} do lote?`, text: "Eles somem do link do cliente. As decisões e versões já registradas continuam no histórico.", confirmLabel: "Retirar", tone: "danger" });
      if (!ok) return;
    }
    const submit = pickForm.querySelector("[type=submit]");
    setBusy(submit, true);
    try {
      await api.setBatchItems(current.batch.id, [...kept, ...added]);
      closeDialog(pickModal);
      await reloadCurrent(added.length ? `${added.length} ${added.length === 1 ? "conteúdo incluído" : "conteúdos incluídos"}. Gere o link (ou envie os novos) quando estiver pronto.` : "Conteúdos do lote atualizados");
    } catch (error) {
      showFieldErrors(pickForm, {}, error.message);
    } finally {
      setBusy(submit, false);
    }
  });
  on(drawer, "click", "[data-item-move]", async (event, b) => {
    const items = activeItems();
    const index = items.findIndex((i) => i.id === b.closest("[data-item]").dataset.item);
    const other = index + Number(b.dataset.itemMove);
    if (index < 0 || other < 0 || other >= items.length) return;
    const order = items.map((i) => i.content_id);
    [order[index], order[other]] = [order[other], order[index]];
    b.disabled = true;
    try { await api.setBatchItems(current.batch.id, order.filter(Boolean)); await reloadCurrent(); } catch (error) { toast(error.message, "error"); }
  });
  on(drawer, "click", "[data-item-remove]", async (event, b) => {
    const item = activeItems().find((i) => i.id === b.dataset.itemRemove);
    if (!item) return;
    const ok = await confirm({ title: "Retirar este conteúdo do lote?", text: `"${itemTitle(item)}" sai do link do cliente. O histórico continua registrado.`, confirmLabel: "Retirar" });
    if (!ok) return;
    try { await api.setBatchItems(current.batch.id, activeItems().filter((i) => i.id !== item.id).map((i) => i.content_id).filter(Boolean)); await reloadCurrent("Conteúdo retirado do lote"); } catch (error) { toast(error.message, "error"); }
  });
  on(drawer, "click", "[data-item-resend]", async (event, b) => {
    const item = activeItems().find((i) => i.id === b.dataset.itemResend);
    if (!item) return;
    const ok = await confirm({ title: "Enviar a nova versão para aprovação?", text: `O cliente passa a ver a versão atual de "${itemTitle(item)}", marcada como "Revisado e reenviado". A versão anterior e o pedido de ajuste ficam no histórico.`, confirmLabel: "Reenviar", tone: "primary" });
    if (!ok) return;
    setBusy(b, true);
    try {
      const n = await api.resendItems(current.batch.id, [item.id]);
      await reloadCurrent(n ? "Nova versão enviada. O cliente vê pelo mesmo link." : "Nada mudou desde o último envio.");
    } catch (error) { toast(error.message, "error"); setBusy(b, false); }
  });
  on(drawer, "click", "[data-item-edit]", (event, b) => {
    const content = current.contents.find((c) => c.id === b.dataset.itemEdit);
    if (!content) return;
    const batchId = current.batch.id;
    closeDialog(drawer);
    openContentForm(content, { onSaved: async () => { toast("Se a mudança for para o cliente ver, use \"Reenviar nova versão\".", "info"); navigate("aprovacoes", { batch: batchId }); } });
  });

  /* ---------- Link ---------- */
  async function tokenFor(batchId) {
    if (current?.batch.id === batchId && current.token) return current.token;
    const data = await api.linkToken(batchId);
    if (!data?.token) throw new Error("Este lote não tem link ativo. Gere um novo link.");
    if (current?.batch.id === batchId) current.token = data.token;
    return data.token;
  }
  async function copy(text, okMessage) {
    try { await navigator.clipboard.writeText(text); toast(okMessage); }
    catch { window.prompt("Copie o texto abaixo:", text); }
  }
  on(document, "click", "[data-batch-copy]", async (event, b) => {
    try { const url = approvalUrl(origin(), await tokenFor(b.dataset.batchCopy)); await copy(url, "Link copiado"); const input = drawer.querySelector("[data-link-url]"); if (input && current?.batch.id === b.dataset.batchCopy) input.value = url; }
    catch (error) { toast(error.message, "error"); }
  });
  on(document, "click", "[data-batch-whatsapp]", async (event, b) => {
    const batch = summaryOf(b.dataset.batchWhatsapp);
    try {
      const url = approvalUrl(origin(), await tokenFor(batch.id));
      await copy(whatsappMessage(url, { month: monthLabel(batch.month.slice(0, 7)).split(" ")[0].toLowerCase() }), "Mensagem para o WhatsApp copiada");
    } catch (error) { toast(error.message, "error"); }
  });
  on(document, "click", "[data-batch-open-link]", async (event, b) => {
    try { window.open(approvalUrl(origin(), await tokenFor(b.dataset.batchOpenLink)), "_blank", "noopener"); } catch (error) { toast(error.message, "error"); }
  });
  on(document, "click", "[data-batch-preview]", (event, b) => { window.open(`${origin()}/aprovacao/#previa=${encodeURIComponent(b.dataset.batchPreview)}`, "_blank", "noopener"); });
  on(document, "click", "[data-batch-revoke]", async (event, b) => {
    const ok = await confirm({ title: "Desativar o link?", text: "Quem tiver o link deixa de ver e aprovar na hora (inclusive os arquivos). O histórico continua. Para voltar, gere um novo link.", confirmLabel: "Desativar link" });
    if (!ok) return;
    try { await api.revokeLink(b.dataset.batchRevoke); if (current?.batch.id === b.dataset.batchRevoke) current.token = null; await reloadCurrent("Link desativado"); } catch (error) { toast(error.message, "error"); }
  });
  on(document, "click", "[data-batch-regenerate]", async (event, b) => {
    const ok = await confirm({ title: "Gerar um novo link?", text: "O link atual para de funcionar na hora. Envie o novo link ao cliente.", confirmLabel: "Gerar novo link", tone: "primary" });
    if (!ok) return;
    try {
      const { token } = await api.regenerateLink(b.dataset.batchRegenerate, summaryOf(b.dataset.batchRegenerate)?.link_expires_at?.slice(0, 10) || null);
      if (current?.batch.id === b.dataset.batchRegenerate) current.token = token;
      await reloadCurrent("Novo link gerado. O anterior não funciona mais.");
      await copy(approvalUrl(origin(), token), "Novo link copiado");
    } catch (error) { toast(error.message, "error"); }
  });

  /* ---------- Gerar link para aprovação ---------- */
  async function openPublish(batchId) {
    if (!current || current.batch.id !== batchId) await openBatch(batchId);
    if (!current) return;
    const items = activeItems();
    if (!items.length) { toast("Adicione pelo menos um conteúdo ao lote antes de gerar o link.", "info"); openPicker(); return; }
    const b = current.batch;
    showFieldErrors(publishForm, {});
    publishForm.querySelector("[data-publish-list]").innerHTML = `<ul class="pick-items">${items.map((i) => {
      const fresh = i.status === "rascunho" || i.status === "ajustes" || isStale(i);
      const locked = !fresh && isPending(i.status);
      return `<li><label class="check pick-item">
        <input type="checkbox" name="item" value="${esc(i.id)}" ${fresh || locked ? "checked" : ""} ${locked ? "data-locked" : ""}>
        <span class="pick-item__body"><span class="pick-item__title">${esc(itemTitle(i))}</span>
        <span class="pick-item__meta">${fresh ? (i.status === "rascunho" ? "Vai pela primeira vez" : "Vai como nova versão") : locked ? "Já está com o cliente" : "Já aprovado (não muda)"}</span></span>
        ${apprBadge(i.status)}
      </label></li>`; }).join("")}</ul>`;
    publishForm.elements.title.value = b.title;
    publishForm.elements.intro.value = b.intro_message || "";
    publishForm.querySelector(`[name=mode][value="${b.approval_mode}"]`).checked = true;
    // Depois do primeiro envio, a etapa do lote fica travada (as decisões são daquela etapa)
    publishForm.querySelectorAll("[name=mode]").forEach((r) => { r.disabled = Boolean(b.sent_at); });
    publishForm.elements.expires_on.value = b.link_expires_at ? b.link_expires_at.slice(0, 10) : "";
    publishForm.elements.expires_on.min = todayISO();
    publishForm.elements.allow_individual.checked = b.allow_individual !== false;
    publishForm.elements.allow_bulk.checked = b.allow_bulk !== false;
    publishForm.querySelector("[type=submit] span").textContent = b.link_id ? "Enviar e manter o link" : "Gerar link";
    publishModal.showModal();
  }
  on(document, "click", "[data-batch-publish]", (event, b) => openPublish(b.dataset.batchPublish));
  publishForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(publishForm);
    const chosen = data.getAll("item");
    const submit = publishForm.querySelector("[type=submit]");
    setBusy(submit, true);
    try {
      const result = await api.publishBatch(current.batch.id, {
        items: chosen, title: data.get("title"), intro: data.get("intro"), mode: data.get("mode") || current.batch.approval_mode, expiresOn: data.get("expires_on") || null,
        allowIndividual: publishForm.elements.allow_individual.checked, allowBulk: publishForm.elements.allow_bulk.checked
      });
      current.token = result.token;
      closeDialog(publishModal);
      await reloadCurrent(result.sent ? `${result.sent} ${result.sent === 1 ? "conteúdo enviado" : "conteúdos enviados"}. Link pronto!` : "Link pronto!");
      await copy(approvalUrl(origin(), result.token), "Link copiado. Cole no WhatsApp do cliente.");
    } catch (error) {
      const fields = { ...(error.fields || {}) };
      if (fields.items) { publishForm.querySelector(".form-error").textContent = fields.items; delete fields.items; }
      showFieldErrors(publishForm, fields, error.message);
    } finally {
      setBusy(submit, false);
    }
  });

  /* ---------- Outras ações do lote ---------- */
  on(document, "click", "[data-batch-open]", (event, b) => openBatch(b.dataset.batchOpen));
  on(drawer, "click", "[data-batch-edit]", () => openBatchForm(current.batch));
  on(drawer, "click", "[data-batch-archive]", async () => {
    const archived = !current.batch.archived_at;
    if (archived) {
      const ok = await confirm({ title: "Arquivar este lote?", text: "O link para de funcionar e o lote sai da lista principal. O histórico continua.", confirmLabel: "Arquivar" });
      if (!ok) return;
    }
    try { await api.archiveBatch(current.batch.id, archived); await reloadCurrent(archived ? "Lote arquivado" : "Lote reativado"); } catch (error) { toast(error.message, "error"); }
  });
  on(document, "click", "[data-batch-delete]", async (event, button) => {
    const b = batches.find((x) => x.id === button.dataset.batchDelete) || (current?.batch.id === button.dataset.batchDelete ? current.batch : null);
    if (!b) return;
    const text = b.sent_at
      ? `"${b.title}" (${clientName(b.client_id)}) já foi enviado. O link para de funcionar na hora e o histórico de decisões deste lote é apagado. Os conteúdos continuam no calendário; os que ainda aguardavam aprovação voltam para rascunho. Não dá para desfazer.`
      : `"${b.title}" (${clientName(b.client_id)}) nunca foi enviado ao cliente. Os conteúdos continuam no calendário.`;
    const ok = await confirm({ title: "Excluir este lote?", text, confirmLabel: "Excluir lote" });
    if (!ok) return;
    button.disabled = true;
    try {
      await api.deleteBatch(b.id);
      if (current?.batch.id === b.id) { closeDialog(drawer); current = null; }
      batches = await api.listBatches();
      render();
      refreshAttention();
      toast("Lote excluído");
    } catch (error) { button.disabled = false; toast(error.message, "error"); }
  });
  on(drawer, "click", "[data-batch-report]", () => {
    const b = current.batch;
    const rows = activeItems().map((i) => ({ contentId: i.content_id, status: i.status, version: versionOf(i)?.version_number || 1, content: versionOf(i)?.snapshot || contentOf(i) || {} }));
    try {
      const bytes = buildApprovalReport({ client: clientName(b.client_id), batch: b, rows, decisions: current.detail.decisions, events: current.detail.events });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      link.download = reportFileName(clientName(b.client_id), b);
      document.body.append(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
      toast("Relatório gerado");
    } catch (error) { toast("Não foi possível gerar o relatório.", "error"); }
  });

  return {
    load,
    renderLoading,
    refreshAttention,
    startPolling,
    stopPolling,
    reset() { batches = []; loaded = false; current = null; unread = []; seenEvents = null; list.innerHTML = ""; overview.innerHTML = ""; navBadge.hidden = true; notifPanel.hidden = true; }
  };
}
