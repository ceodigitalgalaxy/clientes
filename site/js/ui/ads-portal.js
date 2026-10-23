/* ==========================================================================
   Portal do cliente · Aprovação de anúncios
   --------------------------------------------------------------------------
   Aba separada do calendário. Mostra só os anúncios já enviados pela equipe
   (o banco nunca entrega rascunhos nem anúncios de outro cliente).
   - Abas por status com contagem e aviso de quantos esperam aprovação.
   - Cards com a prévia; "Ver e aprovar" abre os detalhes.
   - Detalhes: o anúncio como post patrocinado, todos os textos, link de
     destino, observações e histórico. Botões presos embaixo:
       Aprovar anúncio → confirmação → registrado.
       Solicitar alterações → comentário obrigatório → registrado.
   ========================================================================== */

import { esc, on, reduceMotion } from "../lib/dom.js?v=98478e305b";
import { icon } from "../lib/icons.js?v=98478e305b";
import { renderAdMock, renderAdTexts, renderAdHistory, adStatusBadge } from "./ad-preview.js?v=98478e305b";
import { coverHtml, mediaCover, wireMediaFallbacks } from "./media.js?v=98478e305b";
import { wireCarousel } from "./preview.js?v=98478e305b";
import { AD_STATUS, AD_FORMATS, AD_LIMITS, platformLabel } from "../domain/ads.js?v=98478e305b";

const TABS = [
  ["", "Todos"],
  ["aguardando_aprovacao", "Aguardando aprovação"],
  ["alteracoes_solicitadas", "Alterações solicitadas"],
  ["aprovado", "Aprovados"],
  ["arquivado", "Arquivados"]
];
const EMPTY = {
  "": ["Nenhum anúncio por aqui ainda", "Quando a nossa equipe enviar um anúncio para você aprovar, ele aparece aqui."],
  aguardando_aprovacao: ["Nada esperando a sua aprovação", "Tudo em dia! Quando chegar um anúncio novo, ele aparece aqui."],
  alteracoes_solicitadas: ["Nenhum pedido de alteração em aberto", "Os anúncios em que você pedir mudanças aparecem aqui até a nova versão chegar."],
  aprovado: ["Nenhum anúncio aprovado ainda", "Os anúncios que você aprovar ficam guardados aqui."],
  arquivado: ["Nenhum anúncio arquivado", "Anúncios retirados da campanha aparecem aqui."]
};
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
const stamp = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " às") : "");

function cardCover(ad) {
  const first = ad.assets[0];
  const fmt = AD_FORMATS[ad.format] || AD_FORMATS.imagem;
  const cover = !first?.src ? null
    : first.file ? { kind: first.kind, src: first.kind === "video" ? `${first.src}#t=0.5` : first.src }
    : mediaCover(first.src, first.kind);
  return `
    <span class="ad-card__media">
      <span class="ad-card__placeholder">${icon(fmt.icon)}</span>
      ${coverHtml(cover, "data-ad-thumb")}
      ${first?.kind === "video" ? `<span class="play-badge play-badge--sm">${icon("play")}</span>` : ""}
      ${ad.assets.length > 1 ? `<span class="ad-card__count">${icon("layers")}${ad.assets.length}</span>` : ""}
    </span>`;
}

/**
 * @param {object} options
 * @param {HTMLElement} options.section  área da aba (#anuncios)
 * @param {HTMLDialogElement} options.dialog  painel de detalhes
 * @param {ReturnType<import("../data/supabase-repository.js").createSupabaseRepository>} options.repo
 * @param {() => {name: string, initials: string, logoUrl: string|null}} options.getClient
 * @param {(message: string, tone?: string) => void} options.toast
 * @param {(pending: number) => void} options.onCount  quantos esperam aprovação (para o selo da aba)
 */
export function createAdsView({ section, dialog, repo, getClient, toast, onCount }) {
  const tabsBox = section.querySelector("[data-ads-tabs]");
  const grid = section.querySelector("[data-ads-grid]");
  const callout = section.querySelector("[data-ads-callout]");
  let ads = [];
  let status = "";
  let loaded = false;
  let openId = null;
  let mode = "idle";        // idle | confirm | request
  let sending = false;
  let draft = "";            // comentário digitado (não se perde ao atualizar)

  wireMediaFallbacks(dialog);
  wireCarousel(dialog);
  grid.addEventListener("error", (event) => { if (event.target.matches?.("[data-ad-thumb]")) event.target.remove(); }, true);

  const pendingCount = () => ads.filter((a) => a.status === "aguardando_aprovacao").length;

  function renderTabs() {
    tabsBox.innerHTML = TABS.map(([key, label]) => {
      const n = key ? ads.filter((a) => a.status === key).length : ads.length;
      return `<button class="status-tab${key ? ` status-tab--${AD_STATUS[key].tone}` : ""}" type="button" role="tab" data-ads-tab="${key}" aria-selected="${status === key}">${esc(label)} <span class="status-tab__n">${n}</span></button>`;
    }).join("");
  }

  function renderGrid() {
    const pending = pendingCount();
    callout.hidden = pending === 0;
    callout.innerHTML = pending ? `${icon("clock")}<span><b>${pending} ${pending === 1 ? "anúncio espera" : "anúncios esperam"} a sua aprovação.</b> Abra, confira e responda: aprovar ou pedir alterações.</span>` : "";
    const shown = status ? ads.filter((a) => a.status === status) : ads;
    grid.setAttribute("aria-busy", "false");
    if (!shown.length) {
      const [title, text] = EMPTY[status];
      grid.innerHTML = `<div class="ads-empty"><span class="ads-empty__icon">${icon("megaphone")}</span><p class="ads-empty__title">${esc(title)}</p><p class="ads-empty__text">${esc(text)}</p></div>`;
      return;
    }
    grid.innerHTML = shown.map((ad) => {
      const pend = ad.status === "aguardando_aprovacao";
      return `
      <article class="ad-card${pend ? " needs-attention" : ""}">
        <button class="ad-card__open" type="button" data-open-ad="${esc(ad.id)}" aria-label="${esc(`${pend ? "Ver e aprovar" : "Ver detalhes"}: ${ad.title}`)}">
          ${cardCover(ad)}
          <span class="ad-card__body">
            <span class="ad-card__top">${adStatusBadge(ad.status)}${pend ? '<span class="attention-dot" title="Precisa da sua aprovação"></span>' : ""}</span>
            <span class="ad-card__title">${esc(ad.title)}</span>
            <span class="ad-card__meta">${esc(platformLabel(ad))} · ${esc(AD_FORMATS[ad.format]?.label || "")}</span>
            ${ad.campaign_context ? `<span class="ad-card__text">${esc(ad.campaign_context)}</span>` : ""}
            <span class="ad-card__date">Enviado em ${esc(dateLabel(ad.submitted_at))}${ad.version > 1 ? ` · versão ${esc(ad.version)}` : ""}</span>
            <span class="btn btn--sm ${pend ? "btn--primary" : "btn--ghost"} ad-card__cta" aria-hidden="true">${pend ? "Ver e aprovar" : "Ver detalhes"}${icon("arrowRight")}</span>
          </span>
        </button>
      </article>`;
    }).join("");
  }

  function renderError(error) {
    grid.setAttribute("aria-busy", "false");
    grid.innerHTML = `<div class="load-error" role="alert"><p>${esc(error?.message || "Não conseguimos carregar os anúncios agora.")}</p><button class="btn btn--ghost btn--sm" type="button" data-ads-retry>${icon("refresh")}Tentar de novo</button></div>`;
  }

  /* ---------- Detalhes ---------- */
  function statusBlock(ad) {
    const last = [...ad.history].reverse().find((e) => e.event === ad.status);
    if (ad.status === "aprovado") {
      return `<div class="decision decision--aprovado"><span class="decision__icon">${icon("check")}</span><div><p class="decision__title">Anúncio aprovado</p><p class="decision__text">${last ? `Você aprovou em ${esc(stamp(last.created_at))}. ` : ""}A equipe já pode colocar no ar.</p></div></div>`;
    }
    if (ad.status === "alteracoes_solicitadas") {
      return `<div class="decision decision--ajustes"><span class="decision__icon">${icon("message")}</span><div><p class="decision__title">Alterações solicitadas</p>
        ${last?.message ? `<p class="decision__text">Seu pedido em ${esc(stamp(last.created_at))}:</p><blockquote class="decision__quote">${esc(last.message)}</blockquote>` : ""}
        <p class="decision__text">A equipe vai preparar uma nova versão, e ela aparece aqui para você aprovar.</p></div></div>`;
    }
    if (ad.status === "arquivado") return `<div class="decision decision--info">${icon("box")}<div><p class="decision__title">Anúncio arquivado</p><p class="decision__text">Este anúncio saiu do fluxo ativo e não precisa de resposta.</p></div></div>`;
    const resent = ad.version > 1 ? `<p class="decision__note">${icon("refresh")}Nova versão (versão ${esc(ad.version)}) preparada depois do seu pedido.</p>` : "";
    return `<div class="decision decision--aguardando"><span class="decision__icon">${icon("clock")}</span><div><p class="decision__title">Este anúncio espera a sua aprovação</p><p class="decision__text">Confira a prévia, os textos e o link. Se estiver tudo certo, aprove. Se não, peça alterações.</p>${resent}</div></div>`;
  }

  function footer(ad) {
    if (ad.status !== "aguardando_aprovacao") return "";
    if (mode === "confirm") {
      return `<footer class="ad-decide ad-decide--confirm" role="group" aria-label="Confirmar aprovação">
        <p class="ad-decide__text"><b>Aprovar este anúncio?</b> A decisão fica registrada e a equipe pode colocar no ar.</p>
        <div class="ad-decide__buttons">
          <button class="btn btn--ghost" type="button" data-ad-do="cancel">Voltar</button>
          <button class="btn btn--success" type="button" data-ad-do="approve">${icon("check")}Sim, aprovar</button>
        </div></footer>`;
    }
    if (mode === "request") {
      return `<footer class="ad-decide ad-decide--request">
        <form data-ad-request novalidate>
          <label class="field"><span class="field__label">O que precisa ser alterado?</span>
            <textarea class="field__input field__input--area" name="message" rows="3" maxlength="${AD_LIMITS.message}" required placeholder="Ex.: trocar a foto, mudar o preço no texto, usar outro botão...">${esc(draft)}</textarea></label>
          <div class="ad-decide__buttons">
            <button class="btn btn--ghost" type="button" data-ad-do="cancel">Cancelar</button>
            <button class="btn btn--primary" type="submit">${icon("send")}Enviar pedido</button>
          </div>
        </form></footer>`;
    }
    return `<footer class="ad-decide">
      <div class="ad-decide__buttons">
        <button class="btn btn--ghost" type="button" data-ad-do="request">${icon("edit")}Solicitar alterações</button>
        <button class="btn btn--primary" type="button" data-ad-do="confirm">${icon("check")}Aprovar anúncio</button>
      </div></footer>`;
  }

  function renderDetail(keepScroll = false) {
    const ad = ads.find((a) => a.id === openId);
    if (!ad) return;
    const body = dialog.querySelector(".drawer__body");
    const scroll = keepScroll && body ? body.scrollTop : 0;
    const client = getClient();
    const toasts = dialog.querySelector(":scope > .toasts");   // avisos abertos continuam visíveis
    dialog.innerHTML = `
      <div class="drawer__panel">
        <header class="drawer__header">
          <div class="drawer__badges">${adStatusBadge(ad.status)}<span class="type-badge">${icon(AD_FORMATS[ad.format]?.icon || "image")}${esc(AD_FORMATS[ad.format]?.label || "")}</span></div>
          <button class="icon-btn" type="button" data-ad-do="close" aria-label="Fechar detalhes">${icon("close")}</button>
        </header>
        <div class="drawer__body">
          <h2 class="drawer__title" id="ad-detail-title">${esc(ad.title)}</h2>
          <dl class="facts">
            <div class="facts__row"><dt>${icon("target")}Plataforma</dt><dd>${esc(platformLabel(ad, false))}</dd></div>
            <div class="facts__row"><dt>${icon("send")}Enviado em</dt><dd>${esc(stamp(ad.submitted_at))}</dd></div>
            <div class="facts__row"><dt>${icon("layers")}Versão</dt><dd>${esc(ad.version)}</dd></div>
            <div class="facts__row"><dt>${icon(AD_FORMATS[ad.format]?.icon || "image")}Formato</dt><dd>${esc(AD_FORMATS[ad.format]?.label || "")}</dd></div>
          </dl>
          <section class="detail" aria-live="polite">${statusBlock(ad)}</section>
          ${ad.campaign_context ? `<section class="detail"><div class="detail__head"><h3 class="detail__title">Sobre a campanha</h3></div><p class="detail__text">${esc(ad.campaign_context)}</p></section>` : ""}
          <section class="detail"><div class="detail__head"><h3 class="detail__title">Como o anúncio vai aparecer</h3></div>
            ${renderAdMock(ad, { brandName: client.name, logoUrl: client.logoUrl, initials: client.initials })}</section>
          <section class="detail"><div class="detail__head"><h3 class="detail__title">Textos do anúncio</h3></div>${renderAdTexts(ad, { showContext: false })}</section>
          ${ad.client_notes ? `<section class="detail"><div class="detail__head"><h3 class="detail__title">Observações da Digital Galaxy</h3></div>
            <div class="note note--agencia note--shared"><span class="avatar avatar--xs avatar--brand">DG</span><div class="note__body"><p class="note__text">${esc(ad.client_notes)}</p></div></div></section>` : ""}
          <section class="detail"><div class="detail__head"><h3 class="detail__title">Histórico</h3></div>${renderAdHistory(ad.history, { viewer: "cliente", teamLabel: "Digital Galaxy" })}</section>
        </div>
        ${footer(ad)}
      </div>`;
    if (toasts) dialog.append(toasts);
    if (keepScroll) dialog.querySelector(".drawer__body").scrollTop = scroll;
  }

  function open(id) {
    openId = id;
    mode = "idle";
    draft = "";
    renderDetail();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-ad-do="close"]').focus();
  }

  function close() {
    if (!dialog.open) return;
    openId = null;
    if (reduceMotion()) { dialog.close(); return; }
    dialog.classList.add("is-closing");
    setTimeout(() => { dialog.classList.remove("is-closing"); dialog.close(); }, 260);
  }

  async function decide(decision, message = "") {
    if (sending) return;
    const ad = ads.find((a) => a.id === openId);
    if (!ad) return;
    sending = true;
    dialog.querySelectorAll(".ad-decide button").forEach((b) => { b.disabled = true; });
    try {
      await repo.decideAd({ id: ad.id, version: ad.version, decision, message });
      mode = "idle";
      draft = "";
      toast(decision === "aprovado" ? "Anúncio aprovado. Obrigado!" : "Pedido de alteração enviado para a equipe");
      await reload();
    } catch (error) {
      toast(error.message || "Não foi possível enviar agora. Tente de novo.", "info");
      if (error.status === 409) { mode = "idle"; await reload(); } else renderDetail(true);
    } finally {
      sending = false;
    }
  }

  /* ---------- Eventos ---------- */
  on(tabsBox, "click", "[data-ads-tab]", (event, tab) => { status = tab.dataset.adsTab; renderTabs(); renderGrid(); });
  on(grid, "click", "[data-open-ad]", (event, b) => open(b.dataset.openAd));
  on(grid, "click", "[data-ads-retry]", () => load());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) { if (!sending) close(); return; }
    const b = event.target.closest("[data-ad-do]");
    if (!b) return;
    const action = b.dataset.adDo;
    if (action === "close") { close(); return; }
    if (action === "cancel") { mode = "idle"; renderDetail(true); return; }
    if (action === "confirm") { mode = "confirm"; renderDetail(true); dialog.querySelector('[data-ad-do="approve"]')?.focus(); return; }
    if (action === "request") { mode = "request"; renderDetail(true); dialog.querySelector('textarea[name="message"]')?.focus(); return; }
    if (action === "approve") decide("aprovado");
  });
  dialog.addEventListener("input", (event) => { if (event.target.name === "message") draft = event.target.value; });
  dialog.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-ad-request]")) return;
    event.preventDefault();
    const field = event.target.elements.message;
    field.closest(".field").querySelector(".field__error")?.remove();
    if (!field.value.trim()) {
      field.setAttribute("aria-invalid", "true");
      field.closest(".field").insertAdjacentHTML("beforeend", '<span class="field__error">Conte o que precisa ser alterado. Assim a equipe acerta de primeira.</span>');
      field.focus();
      return;
    }
    decide("alteracoes_solicitadas", field.value.trim());
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!sending) close(); });
  dialog.addEventListener("click", async (event) => {
    const b = event.target.closest("[data-copy-ad]");
    if (!b) return;
    const ad = ads.find((a) => a.id === openId);
    try { await navigator.clipboard.writeText(ad?.[b.dataset.copyAd] || ""); toast("Texto copiado", "info"); } catch { toast("Não foi possível copiar.", "info"); }
  });

  /** Busca de novo; devolve true se algo mudou */
  async function reload() {
    const before = JSON.stringify(ads.map((a) => [a.id, a.status, a.version, a.history.length]));
    ads = await repo.listAds();
    loaded = true;
    onCount(pendingCount());
    const changed = before !== JSON.stringify(ads.map((a) => [a.id, a.status, a.version, a.history.length]));
    if (changed || !grid.querySelector(".ad-card, .ads-empty")) { renderTabs(); renderGrid(); }
    if (dialog.open && openId) {
      if (!ads.some((a) => a.id === openId)) { close(); toast("Este anúncio foi recolhido pela equipe para ajustes.", "info"); }
      else if (changed) renderDetail(true);
    }
    return changed;
  }

  async function load({ quiet = false } = {}) {
    if (!quiet && !loaded) {
      grid.setAttribute("aria-busy", "true");
      grid.innerHTML = '<span class="skeleton skeleton-card" aria-hidden="true"></span><span class="skeleton skeleton-card" aria-hidden="true"></span>';
      renderTabs();
    }
    try {
      return await reload();
    } catch (error) {
      if (!quiet) renderError(error);
      throw error;
    }
  }

  return {
    load,
    reset() { ads = []; loaded = false; status = ""; openId = null; grid.innerHTML = ""; tabsBox.innerHTML = ""; callout.hidden = true; if (dialog.open) dialog.close(); onCount(0); },
    get loaded() { return loaded; }
  };
}
