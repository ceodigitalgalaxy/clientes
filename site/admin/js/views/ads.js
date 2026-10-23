/* ==========================================================================
   Painel · Aprovação de anúncios
   --------------------------------------------------------------------------
   Lista (abas por status + cliente) → detalhes do anúncio:
   - Rascunho / Alterações solicitadas: editar textos, enviar criativo
     (arquivos ou links, em ordem), "Enviar para aprovação".
   - Aguardando: "Recolher para editar" (sai da tela do cliente).
   - Aprovado: "Reabrir para editar". Qualquer um: arquivar / reativar.
   O banco confere cada passo (ad_transition) e grava o histórico; a tela só
   mostra os botões que fazem sentido para o status atual.
   Endereço: #/anuncios?status=...&client_id=...
   ========================================================================== */

import { $, esc, on } from "../../../js/lib/dom.js?v=a5be30320a";
import { icon } from "../../../js/lib/icons.js?v=a5be30320a";
import { stampLabel } from "../../../js/lib/dates.js?v=a5be30320a";
import { renderMedia, mediaFallback, mediaCover, coverHtml, wireMediaFallbacks } from "../../../js/ui/media.js?v=a5be30320a";
import { wireCarousel } from "../../../js/ui/preview.js?v=a5be30320a";
import { renderAdMock, renderAdTexts, renderAdHistory, adStatusBadge } from "../../../js/ui/ad-preview.js?v=a5be30320a";
import { UPLOAD_LIMITS } from "../../../js/lib/storage.js?v=a5be30320a";
import { AD_STATUS, AD_PLATFORMS, AD_OBJECTIVES, AD_FORMATS, AD_CTAS, platformLabel, validateAdFilters } from "../domain/rules.js?v=a5be30320a";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=a5be30320a";
import { stateBlock, loadingCards, button } from "../ui/states.js?v=a5be30320a";

const ACCEPT = UPLOAD_LIMITS.mediaTypes.join(",");
const EDITABLE = ["rascunho", "alteracoes_solicitadas"];
const TABS = [
  ["", "Todos"],
  ["rascunho", "Rascunhos"],
  ["aguardando_aprovacao", "Aguardando"],
  ["alteracoes_solicitadas", "Alterações"],
  ["aprovado", "Aprovados"],
  ["arquivado", "Arquivados"]
];
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
const options = (entries, placeholder) => `${placeholder ? `<option value="">${esc(placeholder)}</option>` : ""}${entries.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}`;

/** Capa do card: primeiro item do criativo */
function cardCover(ad) {
  const first = ad.assets[0];
  const fmt = AD_FORMATS[ad.format] || AD_FORMATS.imagem;
  const cover = first ? (first.storage_path ? (first.src ? { kind: first.kind, src: first.src + (first.kind === "video" ? "#t=0.5" : "") } : null) : mediaCover(first.url, first.kind)) : null;
  return `
    <span class="ad-card__media">
      <span class="ad-card__placeholder">${icon(fmt.icon)}</span>
      ${coverHtml(cover, "data-ad-thumb")}
      ${first?.kind === "video" ? `<span class="play-badge play-badge--sm">${icon("play")}</span>` : ""}
      ${ad.assets.length > 1 ? `<span class="ad-card__count">${icon("layers")}${ad.assets.length}</span>` : ""}
    </span>`;
}

export function setupAds({ api, state, toast, confirm, navigate }) {
  const view = $("#view-anuncios");
  const list = $("#ads-list");
  const count = $("#ads-count");
  const tabs = view.querySelector("[data-ad-tabs]");
  const clientFilter = view.querySelector("[data-ad-client]");
  const modal = $("#ad-modal");
  const form = modal.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  const drawer = $("#ad-drawer");
  const drawerBody = drawer.querySelector("[data-ad-body]");
  const drawerBadges = drawer.querySelector("[data-ad-badges]");
  const attention = document.querySelector("[data-ads-attention]");

  let ads = [];
  let filters = {};
  let editing = null;      // anúncio sendo editado no formulário (null = novo)
  let saving = false;
  let current = null;      // anúncio aberto nos detalhes
  let busy = false;
  let loadToken = 0;
  let changeNote = { id: null, text: "" };   // "O que mudou nesta versão" (não se perde ao redesenhar)

  wireDialog(modal, { canClose: () => !saving });
  wireDialog(drawer, { canClose: () => !busy });
  wireMediaFallbacks(drawer);
  wireCarousel(drawer);

  // Opções fixas
  form.elements.objective.innerHTML = options(Object.entries(AD_OBJECTIVES), "Escolha (opcional)");
  form.elements.platform.innerHTML = options(Object.entries(AD_PLATFORMS), "Escolha a plataforma");
  form.elements.format.innerHTML = options(Object.entries(AD_FORMATS).map(([k, v]) => [k, v.label]), "Escolha o formato");
  modal.querySelector("#ad-cta-list").innerHTML = AD_CTAS.map((c) => `<option value="${esc(c)}"></option>`).join("");
  const syncPlatform = () => { modal.querySelector("[data-platform-other]").hidden = form.elements.platform.value !== "outra"; };
  form.elements.platform.addEventListener("change", syncPlatform);
  const primaryCount = modal.querySelector('[data-count-for="primary_text"]');
  const syncCount = () => { primaryCount.textContent = `${form.elements.primary_text.value.length.toLocaleString("pt-BR")} de 3.000 caracteres`; };
  form.elements.primary_text.addEventListener("input", syncCount);

  // Miniatura que não carrega vira o ícone
  list.addEventListener("error", (event) => { if (event.target.matches?.("[data-ad-thumb]")) event.target.remove(); }, true);

  const clientOf = (id) => state.clients.find((c) => c.id === id);
  const clientName = (id) => clientOf(id)?.name || "Cliente removido";

  /* ---------- Lista ---------- */
  function syncFilters() {
    const active = state.clients.filter((c) => c.active || c.id === filters.client_id);
    clientFilter.innerHTML = options(active.map((c) => [c.id, c.name]), "Todos os clientes");
    clientFilter.value = filters.client_id || "";
  }

  function renderTabs() {
    const counts = Object.fromEntries(TABS.map(([key]) => [key, key ? ads.filter((a) => a.status === key).length : ads.length]));
    tabs.innerHTML = TABS.map(([key, label]) => `
      <button class="status-tab${key ? ` status-tab--${AD_STATUS[key].tone}` : ""}" type="button" role="tab" data-ad-tab="${key}" aria-selected="${(filters.status || "") === key}">
        ${esc(label)} <span class="status-tab__n">${counts[key]}</span>
      </button>`).join("");
  }

  function render() {
    list.setAttribute("aria-busy", "false");
    renderTabs();
    const shown = filters.status ? ads.filter((a) => a.status === filters.status) : ads;
    count.textContent = shown.length ? `${shown.length} ${shown.length === 1 ? "anúncio" : "anúncios"}` : "";
    if (!state.clients.length) {
      list.innerHTML = stateBlock({ iconName: "users", title: "Cadastre um cliente primeiro", text: "Cada anúncio pertence a um cliente.", actions: button("go-clients", "Ir para Clientes", { iconName: "arrowRight" }) });
      return;
    }
    if (!shown.length) {
      list.innerHTML = ads.length
        ? stateBlock({ iconName: "megaphone", title: "Nenhum anúncio com este status", text: "Escolha outra aba para ver os demais." })
        : stateBlock({ iconName: "megaphone", title: "Nenhum anúncio cadastrado ainda", text: "Cadastre um anúncio, envie o criativo e mande para o cliente aprovar.", actions: button("new-ad", "Novo anúncio", { primary: true, iconName: "sparkle" }) });
      return;
    }
    list.innerHTML = shown.map((ad) => `
      <article class="ad-card${ad.status === "alteracoes_solicitadas" ? " needs-attention" : ""}">
        <button class="ad-card__open" type="button" data-open-ad="${esc(ad.id)}" aria-label="Abrir ${esc(ad.title)}">
          ${cardCover(ad)}
          <span class="ad-card__body">
            <span class="ad-card__top">${adStatusBadge(ad.status)}${ad.status === "alteracoes_solicitadas" ? `<span class="attention-dot" title="Precisa de atenção"></span>` : ""}</span>
            <span class="ad-card__title">${esc(ad.title)}</span>
            <span class="ad-card__meta">${esc(clientName(ad.client_id))}</span>
            <span class="ad-card__meta">${esc(platformLabel(ad))} · ${esc(AD_FORMATS[ad.format]?.label || "")}${ad.version > 1 ? ` · versão ${esc(ad.version)}` : ""}</span>
            <span class="ad-card__date">${ad.submitted_at ? `Enviado em ${esc(dateLabel(ad.submitted_at))}` : `Criado em ${esc(dateLabel(ad.created_at))}`}</span>
          </span>
        </button>
      </article>`).join("");
  }

  function renderAttention(all = ads) {
    if (filters.client_id) return;   // o contador do menu considera todos os clientes
    const n = all.filter((a) => a.status === "alteracoes_solicitadas").length;
    attention.hidden = n === 0;
    attention.textContent = n;
    attention.setAttribute("aria-label", `${n} ${n === 1 ? "anúncio precisa" : "anúncios precisam"} de ajuste`);
  }

  async function load(params = {}) {
    filters = validateAdFilters(params);
    syncFilters();
    const token = ++loadToken;
    list.setAttribute("aria-busy", "true");
    list.innerHTML = loadingCards(4);
    try {
      // Status filtra na tela (as abas mostram as contagens de todos)
      const result = await api.listAds({ client_id: filters.client_id });
      if (token !== loadToken) return;
      ads = result;
      render();
      renderAttention();
    } catch (error) {
      if (token !== loadToken) return;
      list.setAttribute("aria-busy", "false");
      count.textContent = "";
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar os anúncios", text: error.message, actions: button("reload-ads", "Tentar de novo", { iconName: "refresh" }) });
    }
  }

  /** Só o contador do menu (ao entrar no painel) */
  async function refreshAttention() {
    try { renderAttention(await api.listAds({})); } catch { /* o contador some até a próxima vez */ }
  }

  const go = (changes) => navigate("anuncios", { ...filters, ...changes });
  on(tabs, "click", "[data-ad-tab]", (event, tab) => go({ status: tab.dataset.adTab || undefined }));
  clientFilter.addEventListener("change", () => go({ client_id: clientFilter.value || undefined }));
  on(view, "click", '[data-action="reload-ads"]', () => load(filters));
  on(view, "click", '[data-action="go-clients"]', () => navigate("clientes"));
  on(document, "click", '[data-action="new-ad"]', () => openForm());
  on(list, "click", "[data-open-ad]", (event, b) => openDetails(b.dataset.openAd));

  /* ---------- Formulário ---------- */
  function openForm(ad = null) {
    editing = ad;
    form.reset();
    showFieldErrors(form, {});
    const active = state.clients.filter((c) => c.active || c.id === ad?.client_id);
    form.elements.client_id.innerHTML = options(active.map((c) => [c.id, c.name]), "Escolha o cliente");
    modal.querySelector("#ad-modal-title").textContent = ad ? "Editar anúncio" : "Novo anúncio";
    submit.querySelector("span").textContent = ad ? "Salvar alterações" : "Salvar rascunho";
    const values = ad || { client_id: filters.client_id || (active.length === 1 ? active[0].id : ""), platform: "meta", format: "imagem" };
    ["client_id", "title", "campaign_context", "objective", "platform", "platform_other", "format", "primary_text", "headline", "description", "cta", "destination_url", "client_notes", "internal_notes"]
      .forEach((name) => { form.elements[name].value = values[name] ?? ""; });
    // Depois do primeiro envio, o anúncio fica com o mesmo cliente (o banco também confere)
    form.elements.client_id.disabled = Boolean(ad?.first_submitted_at);
    syncPlatform();
    syncCount();
    modal.showModal();
    (ad ? form.elements.title : form.elements.client_id.value ? form.elements.title : form.elements.client_id).focus();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = Object.fromEntries(new FormData(form));
    if (editing?.first_submitted_at) data.client_id = editing.client_id;
    saving = true;
    setBusy(submit, true);
    try {
      const saved = editing ? await api.updateAd(editing.id, data) : await api.createAd(data);
      closeDialog(modal);
      toast(editing ? "Anúncio atualizado" : "Rascunho salvo. Agora envie o criativo e mande para aprovação.");
      await load(filters);
      await openDetails(saved.id);
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.fields ? "Revise os campos destacados." : error.message);
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  /* ---------- Detalhes ---------- */
  const ACTIONS = {
    enviar: { label: "Enviar para aprovação", icon: "send", primary: true },
    recolher: { label: "Recolher para editar", icon: "edit" },
    reabrir: { label: "Reabrir para editar", icon: "edit" },
    arquivar: { label: "Arquivar", icon: "box" },
    reativar: { label: "Reativar como rascunho", icon: "refresh", primary: true }
  };
  const actionsFor = (ad) => ({
    rascunho: ["enviar", "arquivar"],
    aguardando_aprovacao: ["recolher", "arquivar"],
    alteracoes_solicitadas: ["enviar", "arquivar"],
    aprovado: ["reabrir", "arquivar"],
    arquivado: ["reativar"]
  })[ad.status] || [];

  function statusNote(ad, events) {
    const lastChange = [...events].reverse().find((e) => e.event === "alteracoes_solicitadas");
    if (ad.status === "alteracoes_solicitadas") {
      return `<div class="decision decision--ajustes"><span class="decision__icon">${icon("message")}</span><div>
        <p class="decision__title">O cliente pediu alterações na versão ${esc(lastChange?.version ?? ad.version)}</p>
        ${lastChange?.message ? `<blockquote class="decision__quote">${esc(lastChange.message)}</blockquote>` : ""}
        <p class="decision__text">Ajuste os textos ou o criativo e envie a nova versão. O histórico anterior continua guardado.</p></div></div>`;
    }
    if (ad.status === "aguardando_aprovacao") return `<div class="decision decision--aguardando"><span class="decision__icon">${icon("clock")}</span><div><p class="decision__title">Com o cliente desde ${esc(stampLabel(ad.submitted_at))}</p><p class="decision__text">Para mudar algo, recolha o anúncio (ele sai da tela do cliente até você enviar de novo).</p></div></div>`;
    if (ad.status === "aprovado") return `<div class="decision decision--aprovado"><span class="decision__icon">${icon("check")}</span><div><p class="decision__title">Aprovado pelo cliente (versão ${esc(ad.version)})</p><p class="decision__text">Pronto para subir na plataforma.</p></div></div>`;
    if (ad.status === "arquivado") return `<div class="decision decision--info">${icon("box")}<div><p class="decision__title">Arquivado</p><p class="decision__text">Fora do fluxo ativo. O cliente ainda vê na aba "Arquivados" se o anúncio já tinha sido enviado.</p></div></div>`;
    return `<div class="decision decision--info">${icon("edit")}<div><p class="decision__title">Rascunho: só a equipe vê</p><p class="decision__text">Envie o criativo abaixo e clique em "Enviar para aprovação".</p></div></div>`;
  }

  function creativeSection(ad) {
    const editable = EDITABLE.includes(ad.status);
    const items = ad.assets.map((asset, i) => `
      <li class="final-item" data-ad-asset="${esc(asset.id)}">
        <span class="final-item__n" aria-hidden="true">${i + 1}</span>
        <div class="final-item__media">${asset.src
          ? renderMedia({ url: asset.src, kind: asset.kind, title: `${ad.title} (${i + 1})` })
          : mediaFallback({ reason: "Não foi possível abrir este arquivo agora." })}</div>
        ${editable ? `<div class="final-item__actions">
          <button class="icon-btn" type="button" data-ad-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Mover para antes">${icon("chevronLeft")}</button>
          <button class="icon-btn" type="button" data-ad-move="1" ${i === ad.assets.length - 1 ? "disabled" : ""} aria-label="Mover para depois">${icon("chevronRight")}</button>
          <button class="icon-btn icon-btn--danger" type="button" data-ad-asset-delete aria-label="Remover do criativo">${icon("trash")}</button>
        </div>` : ""}
      </li>`).join("");
    return `
      <section class="detail final-art">
        <div class="detail__head"><h3 class="detail__title">Criativo</h3><span class="field__hint">${ad.format === "carrossel" ? "Os itens na ordem do carrossel" : AD_FORMATS[ad.format]?.label || ""}</span></div>
        ${ad.assets.length ? `<ol class="final-list">${items}</ol>` : '<p class="final-art__empty">Nenhum arquivo ainda. Envie a imagem, o vídeo ou os itens do carrossel.</p>'}
        ${editable ? `
          <div class="final-art__add">
            <label class="btn btn--ghost btn--sm final-art__choose">
              <input class="visually-hidden" type="file" multiple accept="${ACCEPT}" data-ad-files>
              <span>${icon("image")}Enviar arquivos</span>
            </label>
            <form class="final-art__link" data-ad-link novalidate>
              <label class="field"><span class="visually-hidden">Link do criativo</span>
                <input class="field__input" name="asset_url" type="url" inputmode="url" placeholder="Ou cole um link (Drive, YouTube, Vimeo, Instagram...)" autocomplete="off" spellcheck="false"></label>
              <select class="field__input final-art__kind" name="kind" aria-label="Tipo do link"><option value="video">Vídeo</option><option value="image">Imagem</option></select>
              <button class="btn btn--ghost btn--sm" type="submit">Adicionar link</button>
            </form>
            <p class="field__hint">Arquivos de até 50 MB (JPG, PNG, WebP, GIF, MP4, WebM, MOV). Vídeos maiores: use um link.</p>
          </div>
          <div class="uploads" data-ad-uploads aria-live="polite"></div>` : `<p class="field__hint">Para mudar o criativo, ${ad.status === "aguardando_aprovacao" ? "recolha" : ad.status === "aprovado" ? "reabra" : "reative"} o anúncio.</p>`}
      </section>`;
  }

  function versionsSection(versions, ad) {
    if (!versions.length) return "";
    return `
      <section class="detail">
        <div class="detail__head"><h3 class="detail__title">Versões enviadas</h3><span class="field__hint">${versions.length} ${versions.length === 1 ? "versão" : "versões"}</span></div>
        <div class="ad-versions">${versions.map((v) => `
          <details class="ad-version" data-version="${esc(v.version)}">
            <summary><b>Versão ${esc(v.version)}</b> · enviada em ${esc(stampLabel(v.submitted_at))}${v.version === ad.version && ad.status !== "rascunho" ? " · atual" : ""}</summary>
            <div class="ad-version__body" data-version-body></div>
          </details>`).join("")}</div>
      </section>`;
  }

  let history = { events: [], versions: [] };

  function renderDetails() {
    const ad = current;
    const client = clientOf(ad.client_id);
    drawerBadges.innerHTML = `${adStatusBadge(ad.status)}<span class="type-badge">${icon(AD_FORMATS[ad.format]?.icon || "image")}${esc(AD_FORMATS[ad.format]?.label || "")}</span>`;
    const scroll = drawerBody.scrollTop;
    const buttons = actionsFor(ad).map((key) => {
      const a = ACTIONS[key];
      const label = key === "enviar" && ad.first_submitted_at ? "Enviar nova versão" : a.label;
      return `<button class="btn btn--sm ${a.primary ? "btn--primary" : "btn--ghost"}" type="button" data-ad-action="${key}">${icon(a.icon)}<span>${esc(label)}</span></button>`;
    }).join("");
    const editable = EDITABLE.includes(ad.status);
    drawerBody.innerHTML = `
      <h2 class="drawer__title" id="ad-drawer-title">${esc(ad.title)}</h2>
      <dl class="facts">
        <div class="facts__row"><dt>${icon("user")}Cliente</dt><dd>${esc(client?.name || "")}</dd></div>
        <div class="facts__row"><dt>${icon("target")}Plataforma</dt><dd>${esc(platformLabel(ad, false))}</dd></div>
        <div class="facts__row"><dt>${icon("send")}Envio</dt><dd>${ad.submitted_at ? esc(stampLabel(ad.submitted_at)) : "Ainda não enviado"}</dd></div>
        <div class="facts__row"><dt>${icon("layers")}Versão</dt><dd>${esc(ad.version)}</dd></div>
      </dl>
      <div class="ad-status-note">${statusNote(ad, history.events)}</div>
      ${ad.status === "alteracoes_solicitadas" ? `<label class="field ad-change-note"><span class="field__label">O que mudou nesta versão <span class="field__optional">(opcional, o cliente vê no histórico)</span></span><textarea class="field__input field__input--area" rows="2" maxlength="1000" data-ad-message>${esc(changeNote.id === ad.id ? changeNote.text : "")}</textarea></label>` : ""}
      <div class="ad-actions">
        ${editable ? `<button class="btn btn--sm btn--ghost" type="button" data-ad-edit>${icon("edit")}<span>Editar textos</span></button>` : ""}
        ${buttons}
        ${!ad.first_submitted_at ? `<button class="link-btn link-btn--danger" type="button" data-ad-delete>Excluir rascunho</button>` : ""}
      </div>
      ${creativeSection(ad)}
      <section class="detail"><div class="detail__head"><h3 class="detail__title">Como o cliente vai ver</h3></div>
        ${renderAdMock(ad, { brandName: client?.name, logoUrl: api.logoUrl(client?.logo_path), initials: (client?.name || "").slice(0, 2).toUpperCase() })}
      </section>
      <section class="detail"><div class="detail__head"><h3 class="detail__title">Textos do anúncio</h3></div>${renderAdTexts(ad)}</section>
      ${ad.client_notes ? `<section class="detail"><div class="detail__head"><h3 class="detail__title">Observações para o cliente</h3></div><p class="detail__text">${esc(ad.client_notes)}</p></section>` : ""}
      ${ad.internal_notes ? `<div class="internal"><p class="internal__label">${icon("lock")}Observações internas · só a agência vê</p><p class="internal__text">${esc(ad.internal_notes)}</p></div>` : ""}
      <section class="detail"><div class="detail__head"><h3 class="detail__title">Histórico</h3></div>${renderAdHistory(history.events, { viewer: "equipe", teamLabel: "Equipe" })}</section>
      ${versionsSection(history.versions, ad)}`;
    drawerBody.scrollTop = scroll;
  }

  async function openDetails(id, { keepOpen = false } = {}) {
    try {
      const [ad, hist] = await Promise.all([api.getAd(id), api.adHistory(id)]);
      current = ad;
      history = hist;
      renderDetails();
      if (!drawer.open) { drawerBody.scrollTop = 0; drawer.showModal(); }
    } catch (error) {
      toast(error.message, "error");
      if (!keepOpen && drawer.open) closeDialog(drawer);
    }
  }
  const refreshDetails = async () => { await Promise.all([openDetails(current.id, { keepOpen: true }), load(filters)]); };

  on(drawer, "click", "[data-ad-edit]", () => openForm(current));
  drawer.addEventListener("input", (event) => { if (event.target.matches?.("[data-ad-message]")) changeNote = { id: current.id, text: event.target.value }; });

  on(drawer, "click", "[data-ad-delete]", async () => {
    const ok = await confirm({ title: "Excluir este rascunho?", text: "O anúncio e os arquivos do criativo serão apagados. Isso não pode ser desfeito.", confirmLabel: "Excluir" });
    if (!ok) return;
    try {
      await api.deleteAd(current);
      closeDialog(drawer);
      toast("Rascunho excluído");
      await load(filters);
    } catch (error) { toast(error.message, "error"); }
  });

  const CONFIRMS = {
    enviar: (ad) => ({ title: ad.first_submitted_at ? `Enviar a versão ${ad.version + 1} para aprovação?` : "Enviar para o cliente aprovar?", text: `${clientName(ad.client_id)} passa a ver o anúncio na aba "Anúncios" do portal e pode aprovar ou pedir alterações.`, confirmLabel: "Enviar" }),
    recolher: () => ({ title: "Recolher para editar?", text: "O anúncio sai da tela do cliente e volta a ser rascunho até você enviar de novo (como nova versão).", confirmLabel: "Recolher" }),
    reabrir: () => ({ title: "Reabrir um anúncio aprovado?", text: "Ele volta a ser rascunho. A aprovação anterior fica no histórico; para valer de novo, envie uma nova versão.", confirmLabel: "Reabrir" }),
    arquivar: () => ({ title: "Arquivar este anúncio?", text: "Ele sai do fluxo ativo. Dá para reativar depois.", confirmLabel: "Arquivar" }),
    reativar: () => ({ title: "Reativar como rascunho?", text: "O anúncio volta para a equipe editar e enviar de novo.", confirmLabel: "Reativar" })
  };
  const DONE = { enviar: "Enviado! O cliente já vê o anúncio no portal.", recolher: "Anúncio recolhido. Agora você pode editar.", reabrir: "Anúncio reaberto para edição.", arquivar: "Anúncio arquivado", reativar: "Anúncio reativado como rascunho" };

  on(drawer, "click", "[data-ad-action]", async (event, b) => {
    if (busy) return;
    const action = b.dataset.adAction;
    if (action === "enviar" && !current.assets.length) { toast("Envie pelo menos um arquivo ou link do criativo antes.", "error"); return; }
    const message = drawer.querySelector("[data-ad-message]")?.value || (changeNote.id === current.id ? changeNote.text : "");
    const ok = await confirm({ ...CONFIRMS[action](current), tone: action === "arquivar" ? "danger" : "primary" });
    if (!ok) return;
    busy = true;
    setBusy(b, true);
    try {
      await api.adTransition(current.id, action, action === "enviar" ? message : "");
      if (action === "enviar") changeNote = { id: null, text: "" };
      toast(DONE[action]);
      await refreshDetails();
    } catch (error) {
      toast(error.message, "error");
      await refreshDetails().catch(() => {});
    } finally {
      busy = false;
    }
  });

  /* Criativo: arquivos, links, ordem */
  on(drawer, "change", "[data-ad-files]", async (event, input) => {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length || busy) return;
    busy = true;
    const uploads = drawer.querySelector("[data-ad-uploads]");
    let position = current.assets.length ? Math.max(...current.assets.map((a) => a.position)) + 1 : 0;
    let sent = 0;
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "upload";
      row.innerHTML = '<span class="upload__name"></span><progress class="upload__bar" max="1" value="0"></progress><span class="upload__state">Enviando…</span>';
      row.querySelector(".upload__name").textContent = file.name;
      uploads.append(row);
      try {
        await api.addAdAssetFile(current, file, { position, onProgress: (p) => { row.querySelector("progress").value = p; } });
        row.classList.add("is-done");
        row.querySelector(".upload__state").textContent = "Enviado";
        position += 1;
        sent += 1;
      } catch (error) {
        row.classList.add("is-error");
        row.querySelector(".upload__state").textContent = error.message;
      }
    }
    busy = false;
    if (sent) {
      toast(sent === 1 ? "Arquivo enviado" : `${sent} arquivos enviados`);
      const errors = [...uploads.querySelectorAll(".upload.is-error")].map((n) => n.cloneNode(true));
      await refreshDetails();
      drawer.querySelector("[data-ad-uploads]")?.append(...errors);
    }
  });

  on(drawer, "submit", "[data-ad-link]", async (event, linkForm) => {
    event.preventDefault();
    const input = linkForm.elements.asset_url;
    linkForm.querySelectorAll(".field__error").forEach((n) => n.remove());
    try {
      const position = current.assets.length ? Math.max(...current.assets.map((a) => a.position)) + 1 : 0;
      await api.addAdAssetLink(current, { url: input.value, kind: linkForm.elements.kind.value, position });
      toast("Link adicionado");
      await refreshDetails();
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      input.closest(".field").insertAdjacentHTML("beforeend", `<span class="field__error">${esc(error.fields?.asset_url || error.message)}</span>`);
    }
  });

  on(drawer, "click", "[data-ad-move]", async (event, b) => {
    if (busy) return;
    const index = current.assets.findIndex((a) => a.id === b.closest("[data-ad-asset]").dataset.adAsset);
    const other = index + Number(b.dataset.adMove);
    if (index < 0 || other < 0 || other >= current.assets.length) return;
    busy = true;
    try {
      const a = { ...current.assets[index], position: current.assets[index].position === current.assets[other].position ? index : current.assets[index].position };
      const c = { ...current.assets[other], position: a.position === current.assets[other].position ? other : current.assets[other].position };
      await api.swapAdAssets(a, c);
      await refreshDetails();
    } catch (error) { toast(error.message, "error"); }
    finally { busy = false; }
  });

  on(drawer, "click", "[data-ad-asset-delete]", async (event, b) => {
    const asset = current.assets.find((a) => a.id === b.closest("[data-ad-asset]").dataset.adAsset);
    if (!asset || busy) return;
    const ok = await confirm({ title: "Remover este item do criativo?", text: current.first_submitted_at ? "Ele sai da próxima versão. As versões já enviadas continuam no histórico." : "O arquivo será apagado.", confirmLabel: "Remover" });
    if (!ok) return;
    busy = true;
    try {
      await api.deleteAdAsset(current, asset);
      toast("Item removido");
      await refreshDetails();
    } catch (error) { toast(error.message, "error"); }
    finally { busy = false; }
  });

  /* Versões: a prévia de cada uma só é montada ao abrir */
  drawer.addEventListener("toggle", (event) => {
    const box = event.target;
    if (!(box instanceof HTMLDetailsElement) || !box.open || !box.matches(".ad-version")) return;
    const body = box.querySelector("[data-version-body]");
    if (body.childElementCount) return;
    const v = history.versions.find((x) => String(x.version) === box.dataset.version);
    if (!v) return;
    const client = clientOf(current.client_id);
    body.innerHTML = `${renderAdMock({ ...v.snapshot, assets: v.snapshot.assets }, { brandName: client?.name, logoUrl: api.logoUrl(client?.logo_path), initials: (client?.name || "").slice(0, 2).toUpperCase() })}${renderAdTexts(v.snapshot)}`;
  }, true);

  /* Copiar textos */
  on(drawer, "click", "[data-copy-ad]", async (event, b) => {
    const text = current?.[b.dataset.copyAd] || "";
    try { await navigator.clipboard.writeText(text); toast("Texto copiado"); } catch { toast("Não foi possível copiar. Selecione o texto e copie.", "error"); }
  });

  return {
    load,
    refreshAttention,
    renderLoading() { list.setAttribute("aria-busy", "true"); list.innerHTML = loadingCards(4); }
  };
}
