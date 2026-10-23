/* Seção Conteúdos: filtros, lista, detalhes, cadastro, edição e exclusão */

import { $, esc, on } from "../../../js/lib/dom.js?v=e96162d7e7";
import { icon } from "../../../js/lib/icons.js?v=e96162d7e7";
import { longDayLabel, timeLabel, todayISO } from "../../../js/lib/dates.js?v=e96162d7e7";
import { typeBadge } from "../../../js/ui/badges.js?v=e96162d7e7";
import { renderMedia, wireMediaFallbacks } from "../../../js/ui/media.js?v=e96162d7e7";
import { CONTENT_STATUS, CLIENT_VISIBLE_STATUS, NETWORKS, FORMATS, LIMITS, validateContent, validateContentFilters } from "../domain/rules.js?v=e96162d7e7";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=e96162d7e7";
import { stateBlock, loadingRows, button } from "../ui/states.js?v=e96162d7e7";
import { reviewSections, mountReview } from "./content-review.js?v=e96162d7e7";
import { describeMedia, mediaCover, coverHtml } from "../../../js/ui/media.js?v=e96162d7e7";

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

  wireDialog(dialog, { canClose: () => !saving });
  wireDialog(drawer);

  // Opções fixas dos selects
  bulkStatus.innerHTML = options(Object.entries(CONTENT_STATUS).map(([k, v]) => [k, v.label]), "aguardando_aprovacao");
  filtersForm.elements.status.insertAdjacentHTML("beforeend", options(Object.entries(CONTENT_STATUS).map(([k, v]) => [k, v.label])));
  form.elements.network.innerHTML = `<option value="">Escolha a rede</option>${options(Object.entries(NETWORKS))}`;
  form.elements.format.innerHTML = `<option value="">Escolha o formato</option>${options(Object.entries(FORMATS).map(([k, v]) => [k, v.label]))}`;
  form.elements.status.innerHTML = options(Object.entries(CONTENT_STATUS).map(([k, v]) => [k, v.label]));

  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente removido";

  /** Filtros vêm do endereço (#/conteudos?client_id=...), para voltar e recarregar sem perder */
  function syncFiltersForm() {
    const select = filtersForm.elements.client_id;
    const current = state.filters.client_id || "";
    select.innerHTML = `<option value="">Todos os clientes</option>${options(state.clients.map((c) => [c.id, c.active ? c.name : `${c.name} (inativo)`]), current)}`;
    filtersForm.elements.from.value = state.filters.from || "";
    filtersForm.elements.to.value = state.filters.to || "";
    filtersForm.elements.status.value = state.filters.status || "";
  }

  const readFilters = () => validateContentFilters(Object.fromEntries(new FormData(filtersForm)));

  filtersForm.addEventListener("change", () => navigate("conteudos", readFilters(), { replace: true }));
  filtersForm.addEventListener("reset", (event) => { event.preventDefault(); navigate("conteudos", {}, { replace: true }); });

  /* ---------- Lista ---------- */
  function renderLoading() {
    list.setAttribute("aria-busy", "true");
    count.textContent = "Carregando…";
    list.innerHTML = loadingRows();
  }

  async function load() {
    syncFiltersForm();
    const token = ++loadToken;
    renderLoading();
    if (!state.clients.length) {
      count.textContent = "";
      list.setAttribute("aria-busy", "false");
      list.innerHTML = stateBlock({
        iconName: "users",
        title: "Cadastre um cliente primeiro",
        text: "Cada conteúdo pertence a um cliente. Depois do primeiro cadastro, os conteúdos dele aparecem aqui.",
        actions: button("go-clients", "Ir para Clientes", { primary: true, iconName: "arrowRight" })
      });
      return;
    }
    try {
      const result = await api.listContents(state.filters);
      if (token !== loadToken) return;      // um filtro mais novo já está carregando
      contents = result;
      // A seleção vale só para o que continua na lista
      [...picked].forEach((id) => { if (!contents.some((c) => c.id === id)) picked.delete(id); });
      render();
    } catch (error) {
      if (token !== loadToken) return;
      list.setAttribute("aria-busy", "false");
      count.textContent = "";
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar os conteúdos", text: error.message, actions: button("reload-contents", "Tentar de novo", { iconName: "refresh" }) });
    }
  }

  /** Barra de ações em massa e botão "Selecionar todos" */
  function syncBulk() {
    const n = picked.size;
    bulk.hidden = n === 0;
    bulk.querySelector("[data-bulk-count]").textContent = n;
    bulk.querySelector("[data-bulk-word]").textContent = n === 1 ? "selecionado" : "selecionados";
    bulkAll.hidden = contents.length < 2;
    const all = contents.length > 0 && contents.every((c) => picked.has(c.id));
    bulkAll.textContent = all ? "Desmarcar todos" : `Selecionar todos (${contents.length})`;
    list.querySelectorAll("[data-pick]").forEach((box) => {
      box.checked = picked.has(box.dataset.pick);
      box.closest(".row").classList.toggle("is-picked", box.checked);
    });
  }

  function render() {
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
          <span class="row__titlecell">${refThumb(c)}<button class="row__title" type="button" data-view-content="${esc(c.id)}">${esc(c.title)}</button>${c.assets_count ? `<span class="row__art" title="Itens na arte final">${icon("layers")}${esc(c.assets_count)}</span>` : ""}</span>
          <span class="row__network">${esc(NETWORKS[c.network] || c.network)}</span>
          <span class="row__format">${typeBadge(c.format)}</span>
          <span class="row__status">${statusChip(c.status)}</span>
          <span class="row__actions">
            <button class="icon-btn" type="button" data-edit-content="${esc(c.id)}" aria-label="Editar ${esc(c.title)}" title="Editar">${icon("edit")}</button>
            <button class="icon-btn icon-btn--danger" type="button" data-delete-content="${esc(c.id)}" aria-label="Excluir ${esc(c.title)}" title="Excluir">${icon("trash")}</button>
          </span>
        </div>`).join("")}`;
  }

  /* ---------- Detalhes ---------- */
  const versionLine = (c) => `${CLIENT_VISIBLE_STATUS.includes(c.status) ? "Visível no calendário do cliente" : "Ainda não aparece para o cliente"} · versão ${c.version}`;
  let openId = null;
  function openDetails(content, { keepScroll = false } = {}) {
    const body = $("#drawer-body");
    const scroll = keepScroll ? body.scrollTop : 0;
    openId = content.id;
    requestAnimationFrame(() => { body.scrollTop = scroll; });
    $("#drawer-badges").innerHTML = `${typeBadge(content.format, true)}${statusChip(content.status)}`;
    // A mesma prévia que o cliente vê no calendário
    const media = content.media_url
      ? `<div class="detail"><h3 class="detail__title">Referência</h3><div class="media-ref">${renderMedia({ url: content.media_url, kind: content.media_kind || "image", title: content.title })}</div></div>`
      : "";
    $("#drawer-body").innerHTML = `
      <h2 class="drawer__title" id="drawer-title">${esc(content.title)}</h2>
      <dl class="facts">
        <div class="facts__row"><dt>${icon("user")}Cliente</dt><dd>${esc(clientName(content.client_id))}</dd></div>
        <div class="facts__row"><dt>${icon("calendar")}Data</dt><dd>${esc(longDayLabel(content.scheduled_date))}${content.scheduled_time ? ` às ${esc(timeLabel(content.scheduled_time.slice(0, 5)))}` : ""}</dd></div>
        <div class="facts__row"><dt>${icon("send")}Rede</dt><dd>${esc(NETWORKS[content.network] || content.network)}</dd></div>
        <div class="facts__row"><dt>${icon("image")}Formato</dt><dd>${esc(FORMATS[content.format]?.label || content.format)}</dd></div>
      </dl>
      ${media}
      <div class="detail"><h3 class="detail__title">Legenda</h3><p class="caption-text">${content.caption ? esc(content.caption) : '<span class="field__optional">Sem legenda ainda.</span>'}</p></div>
      ${content.client_notes ? `<div class="detail"><h3 class="detail__title">Observação para o cliente</h3><p class="caption-text">${esc(content.client_notes)}</p></div>` : ""}
      ${content.internal_notes ? `<div class="internal"><p class="internal__label">${icon("lock")}Observações internas · só a agência vê</p><p class="internal__text">${esc(content.internal_notes)}</p></div>` : ""}
      <p class="drawer__version">${esc(versionLine(content))}</p>
      <div class="drawer__actions">
        <button class="btn btn--primary btn--sm" type="button" data-edit-content="${esc(content.id)}">${icon("edit")}<span>Editar</span></button>
        <button class="btn btn--ghost btn--sm" type="button" data-delete-content="${esc(content.id)}">${icon("trash")}<span>Excluir</span></button>
      </div>`;
    // Arte final e aprovação: um bloco novo a cada abertura (os eventos ficam presos a ele)
    const review = document.createElement("div");
    review.className = "review";
    review.innerHTML = reviewSections();
    $("#drawer-body").querySelector(".drawer__version").before(review);
    const reviewer = mountReview({
      root: review, content, api, toast, confirm,
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

  function openForm(content = null) {
    const active = state.clients.filter((c) => c.active || c.id === content?.client_id);
    if (!active.length) { toast("Cadastre um cliente antes de criar conteúdos.", "info"); navigate("clientes"); return; }
    editing = content;
    form.reset();
    showFieldErrors(form, {});
    dialog.querySelector(".modal__title").textContent = content ? "Editar conteúdo" : "Novo conteúdo";
    submit.querySelector("span").textContent = content ? "Salvar alterações" : "Cadastrar conteúdo";
    form.elements.client_id.innerHTML = `<option value="">Escolha o cliente</option>${options(active.map((c) => [c.id, c.name]))}`;
    if (content) {
      ["client_id", "title", "scheduled_date", "network", "format", "media_url", "caption", "client_notes", "internal_notes", "status"].forEach((name) => { form.elements[name].value = content[name] || ""; });
      form.elements.scheduled_time.value = content.scheduled_time ? content.scheduled_time.slice(0, 5) : "";
      form.elements.media_kind.value = content.media_kind || "";
    } else {
      form.elements.client_id.value = state.filters.client_id || (active.length === 1 ? active[0].id : "");
      form.elements.scheduled_date.value = todayISO();
      form.elements.status.value = "planejado";
    }
    syncMediaKind();
    syncCaption();
    if (drawer.open) closeDialog(drawer);
    dialog.showModal();
    (content ? form.elements.title : form.elements.client_id.value ? form.elements.title : form.elements.client_id).focus();
  }

  form.elements.media_url.addEventListener("input", syncMediaKind);
  form.elements.format.addEventListener("change", () => { if (!editing?.media_kind) { form.elements.media_kind.value = ""; syncMediaKind(); } });
  form.elements.caption.addEventListener("input", syncCaption);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const { errors } = validateContent(data);
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    saving = true;
    setBusy(submit, true);
    try {
      if (editing) await api.updateContent(editing.id, data);
      else await api.createContent(data);
      closeDialog(dialog);
      toast(editing ? "Conteúdo atualizado" : "Conteúdo cadastrado");
      await load();
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
  on(document, "click", "[data-edit-content]", (event, btn) => { const c = find(btn.dataset.editContent); if (c) openForm(c); });
  on(document, "click", "[data-delete-content]", (event, btn) => { const c = find(btn.dataset.deleteContent); if (c) remove(c); });

  return { load, renderLoading };
}
