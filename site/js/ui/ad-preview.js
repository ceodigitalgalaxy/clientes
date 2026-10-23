/* ==========================================================================
   Prévia de anúncio (portal do cliente e painel da agência)
   --------------------------------------------------------------------------
   - renderAdMock: o criativo dentro de um "post patrocinado" (marca,
     texto principal, mídia/carrossel, título, descrição e botão), para o
     cliente ver como o anúncio vai aparecer. É uma simulação visual: cada
     plataforma pode cortar textos de um jeito diferente.
   - renderAdTexts: todos os textos, um embaixo do outro, para conferir.
   - adStatusBadge / adHistory: selo de status e linha do tempo.
   A mídia passa pelas regras de ui/media.js (players oficiais, aviso + link).
   ========================================================================== */

import { esc } from "../lib/dom.js?v=98478e305b";
import { icon } from "../lib/icons.js?v=98478e305b";
import { stampLabel } from "../lib/dates.js?v=98478e305b";
import { renderFinal } from "./preview.js?v=98478e305b";
import { AD_STATUS, AD_OBJECTIVES, AD_EVENTS, platformLabel } from "../domain/ads.js?v=98478e305b";

export const adStatusBadge = (status) => {
  const s = AD_STATUS[status];
  return s ? `<span class="status-badge status--${esc(s.tone)}">${icon(s.icon)}${esc(s.label)}</span>` : "";
};

const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** O criativo como um post patrocinado */
export function renderAdMock(ad, { brandName = "", logoUrl = null, initials = "" } = {}) {
  const items = (ad.assets || []).map((a) => ({ kind: a.kind, src: a.src }));
  const media = items.length
    ? renderFinal({ title: ad.title, final: items })
    : `<div class="art-empty"><span class="art-empty__icon">${icon("image")}</span><p class="art-empty__title">Sem criativo ainda</p></div>`;
  const avatar = logoUrl ? `<img class="admock__avatar" src="${esc(logoUrl)}" alt="">` : `<span class="admock__avatar" aria-hidden="true">${esc(initials || "·")}</span>`;
  const domain = domainOf(ad.destination_url);
  const hasFoot = ad.headline || ad.description || ad.cta || domain;
  return `
    <figure class="admock" aria-label="Prévia do anúncio">
      <div class="admock__head">
        ${avatar}
        <div class="admock__who"><b>${esc(brandName || "Sua marca")}</b><span>Patrocinado · ${esc(platformLabel(ad))}</span></div>
      </div>
      ${ad.primary_text ? `<p class="admock__text">${esc(ad.primary_text)}</p>` : ""}
      <div class="admock__media">${media}</div>
      ${hasFoot ? `
        <div class="admock__foot">
          <div class="admock__copy">
            ${domain ? `<span class="admock__domain">${esc(domain)}</span>` : ""}
            ${ad.headline ? `<b class="admock__headline">${esc(ad.headline)}</b>` : ""}
            ${ad.description ? `<span class="admock__desc">${esc(ad.description)}</span>` : ""}
          </div>
          ${ad.cta ? `<span class="admock__cta">${esc(ad.cta)}</span>` : ""}
        </div>` : ""}
      <figcaption class="admock__note">Simulação. Cada plataforma pode cortar os textos de um jeito diferente.</figcaption>
    </figure>`;
}

/** Todos os textos do anúncio, para conferir */
export function renderAdTexts(ad, { showContext = true } = {}) {
  const row = (label, value, extra = "") => value ? `<div class="ad-text"><dt>${esc(label)}${extra}</dt><dd>${value}</dd></div>` : "";
  const copy = (field) => `<button class="link-btn ad-text__copy" type="button" data-copy-ad="${esc(field)}">${icon("copy")}Copiar</button>`;
  const link = ad.destination_url
    ? `<a href="${esc(ad.destination_url)}" target="_blank" rel="noopener noreferrer">${esc(ad.destination_url)}</a>`
    : "";
  return `
    <dl class="ad-texts">
      ${showContext ? row("Campanha", ad.campaign_context ? esc(ad.campaign_context) : "") : ""}
      ${row("Objetivo", ad.objective ? esc(AD_OBJECTIVES[ad.objective] || ad.objective) : "")}
      ${row("Texto principal", ad.primary_text ? esc(ad.primary_text) : "", copy("primary_text"))}
      ${row("Título (headline)", ad.headline ? esc(ad.headline) : "", copy("headline"))}
      ${row("Descrição", ad.description ? esc(ad.description) : "")}
      ${row("Botão (CTA)", ad.cta ? esc(ad.cta) : "")}
      ${row("Link de destino", link)}
    </dl>`;
}

/** Linha do tempo: quem fez o quê e quando (mais recente primeiro) */
export function renderAdHistory(events, { viewer = "cliente", teamLabel = "Digital Galaxy" } = {}) {
  if (!events?.length) return '<p class="field__hint">Ainda não há histórico.</p>';
  const who = (e) => {
    if (e.actor_role === "cliente") return viewer === "cliente" ? `Você${e.actor_username ? ` (${e.actor_username})` : ""}` : `Cliente${e.actor_username ? ` (${e.actor_username})` : ""}`;
    return `${teamLabel}${e.actor_username ? ` (${e.actor_username})` : ""}`;
  };
  const tone = { aprovado: "aprovado", alteracoes_solicitadas: "ajustes", enviado: "aguardando", arquivado: "arquivado" };
  return `<ol class="ad-history">${[...events].reverse().map((e) => `
    <li class="ad-history__item ad-history__item--${esc(tone[e.event] || "neutral")}">
      <span class="ad-history__dot" aria-hidden="true"></span>
      <div>
        <p class="ad-history__title">${esc(AD_EVENTS[e.event] || e.event)} <span class="ad-history__meta">· versão ${esc(e.version)}</span></p>
        <p class="ad-history__meta">${esc(who(e))} · ${esc(stampLabel(e.created_at))}</p>
        ${e.message ? `<blockquote class="ad-history__quote">${esc(e.message)}</blockquote>` : ""}
      </div>
    </li>`).join("")}</ol>`;
}
