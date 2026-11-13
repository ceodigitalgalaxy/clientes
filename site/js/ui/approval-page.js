/* ==========================================================================
   Página de aprovação (o que o cliente vê pelo link)
   --------------------------------------------------------------------------
   Usada pela página pública (aprovacao/index.html) e pela pré-visualização
   da equipe ("Visualizar como cliente", só leitura).
   - Cabeçalho curto: cliente, mês, tipo de aprovação e progresso.
   - Lista (principal) em cartões compactos: capa, data, formato, título e
     status. O cartão inteiro abre o detalhe (um só ponto de clique).
   - Calendário do mês (no celular vira agenda por dia).
   - Detalhe: prévia, título, data e formato, ideia, roteiro, texto na arte,
     legenda e informações extras (seções que abrem), e as ações Aprovar /
     Solicitar ajuste (comentário obrigatório). Anterior e próximo sem
     fechar ("Conteúdo 2 de 6"), setas do teclado e Esc.
   - Aprovar todos os pendentes, com confirmação. Na primeira ação, pede um
     nome para o histórico.
   Tudo o que vem do banco passa por esc(): nada vira HTML.
   ========================================================================== */

import { esc, on } from "../lib/dom.js?v=d8b3be61ca";
import { icon, brandMark } from "../lib/icons.js?v=d8b3be61ca";
import { monthLabel, monthName, longDayLabel, timeLabel, monthGrid, WEEKDAYS_SHORT, stampLabel, fromISO } from "../lib/dates.js?v=d8b3be61ca";
import { ACTIVITY_TYPES, PLATFORMS } from "../domain/model.js?v=d8b3be61ca";
import { APPROVAL_STATUS, APPROVAL_MODES, isPending } from "../domain/approvals.js?v=d8b3be61ca";
import { renderFinal, wireCarousel } from "./preview.js?v=d8b3be61ca";
import { wireMediaFallbacks } from "./media.js?v=d8b3be61ca";
import { toast } from "./toast.js?v=d8b3be61ca";

const NAME_KEY = "dg-aprovacao-nome";
const SESSION_KEY = "dg-aprovacao-sessao";
const LONG_TEXT = 280;   // ideia maior que isso abre com "Ver descrição completa"
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const safe = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };

/** Identificador da sessão de aprovação (não identifica a pessoa) */
function sessionId() {
  let id = safe.get(SESSION_KEY);
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = (globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
    safe.set(SESSION_KEY, id);
  }
  return id;
}

const statusOf = (status) => APPROVAL_STATUS[status] || APPROVAL_STATUS.aguardando_aprovacao;
const statusBadge = (status) => {
  const s = statusOf(status);
  return `<span class="ap-badge ap-badge--${esc(s.tone)}">${icon(s.icon)}${esc(s.label)}</span>`;
};
const typeOf = (format) => ACTIVITY_TYPES[format] || ACTIVITY_TYPES.outro;
const networkOf = (network) => PLATFORMS[network] || "Outra rede";
const dateLine = (c) => `${longDayLabel(c.scheduled_date)}${c.scheduled_time ? ` · ${timeLabel(c.scheduled_time)}` : ""}`;
const shortDate = (c) => {
  const d = fromISO(c.scheduled_date);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${c.scheduled_time ? ` · ${timeLabel(c.scheduled_time)}` : ""}`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Arquivos visuais em ordem: capa primeiro; thumbnail só serve de capa do vídeo */
function visualAssets(item) {
  const assets = item.content?.assets || [];
  const visual = assets.filter((a) => a.kind !== "pdf" && a.role !== "thumbnail");
  const cover = visual.find((a) => a.role === "capa");
  return cover ? [cover, ...visual.filter((a) => a !== cover)] : visual;
}

/** Miniatura do cartão: capa, thumbnail do vídeo ou o vídeo parado. Sem arte, sem miniatura. */
function thumb(item) {
  const c = item.content;
  const visual = visualAssets(item).filter((a) => a.src);
  const poster = (c.assets || []).find((a) => a.role === "thumbnail" && a.src);
  const first = visual[0];
  const extra = visual.length > 1 ? `<span class="ap-thumb__count">${icon("layers")}${visual.length}</span>` : "";
  if (first?.kind === "image") return `<span class="ap-thumb">${extra}<img src="${esc(first.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  if (poster) return `<span class="ap-thumb">${extra}<img src="${esc(poster.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="ap-thumb__play">${icon("play")}</span></span>`;
  if (first?.kind === "video") return `<span class="ap-thumb">${extra}<video src="${esc(first.src)}#t=0.1" muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video><span class="ap-thumb__play">${icon("play")}</span></span>`;
  return "";
}

/** Prévia no detalhe: galeria/vídeo e PDFs */
function mediaBlock(item, mode) {
  const ordered = visualAssets(item);
  const pdfs = (item.content?.assets || []).filter((a) => a.kind === "pdf" && a.src);
  const parts = [];
  if (ordered.length) {
    parts.push(`<div class="ap-media${mode === "planejamento" ? " ap-media--draft" : ""}">
      ${mode === "planejamento" ? `<span class="ap-media__tag">${icon("lightbulb")}Prévia: não é a arte final</span>` : ""}
      ${renderFinal({ title: item.content.title, final: ordered.map((a) => ({ kind: a.kind, src: a.src })) })}
    </div>`);
  }
  if (pdfs.length) {
    parts.push(`<ul class="ap-files">${pdfs.map((a) => `<li><a class="pdf-card" href="${esc(a.src)}" target="_blank" rel="noopener noreferrer">${icon("download")}<span>${esc(a.name || "Arquivo PDF")}</span></a></li>`).join("")}</ul>`);
  }
  return parts.join("");
}

const section = (iconName, title, body) => body
  ? `<section class="ap-sec"><h3 class="ap-sec__title">${icon(iconName)}${esc(title)}</h3>${body}</section>`
  : "";
const para = (text, cls = "") => (text ? `<p class="ap-sec__text ${cls}">${esc(text)}</p>` : "");
const more = (summary, body, { open = false } = {}) => body
  ? `<details class="ap-more" ${open ? "open" : ""}><summary class="ap-more__summary"><span>${esc(summary)}</span>${icon("chevronRight")}</summary><div class="ap-more__body">${body}</div></details>`
  : "";

/**
 * @param {HTMLElement} root
 * @param {object} options
 * @param {boolean} [options.preview]  equipe vendo (sem decidir)
 * @param {(payload: object) => Promise<object>} [options.decide]  { item, version, decision, comment, name, session } → nova visão
 * @param {(payload: object) => Promise<object>} [options.approveAll]  { items: [{item, version}], name, session } → { view, approved, skipped }
 */
export function createApprovalPage(root, { preview = false, decide, approveAll } = {}) {
  let view = null;
  let layout = "lista";
  let filtersOpen = false;
  const filters = { format: "", network: "", status: "" };
  const busy = new Set();
  let confirming = null;      // item com "confirmar aprovação" aberto
  let adjusting = null;       // item com o campo de ajuste aberto
  const drafts = new Map();   // texto do ajuste ainda não enviado
  const expanded = new Set(); // ideias longas abertas por inteiro
  let current = null;         // item aberto no detalhe
  let navIds = [];            // ordem da navegação (a lista filtrada quando o detalhe abriu)
  let moved = false;          // navegou para outro conteúdo dentro do detalhe

  const dialog = document.createElement("dialog");
  dialog.className = "ap-dialog ap-detail";
  dialog.setAttribute("aria-labelledby", "ap-detail-title");
  document.body.append(dialog);
  wireCarousel(dialog);
  wireMediaFallbacks(root); wireMediaFallbacks(dialog);

  const items = () => view?.items || [];
  const byId = (id) => items().find((i) => i.id === id);
  const counts = () => {
    const list = items();
    return {
      total: list.length,
      pending: list.filter((i) => isPending(i.status)).length,
      approved: list.filter((i) => i.status === "aprovado").length,
      adjust: list.filter((i) => i.status === "ajustes").length
    };
  };
  const activeFilters = () => Object.values(filters).filter(Boolean).length;
  const visible = () => items().filter((i) => {
    const c = i.content;
    if (!c) return false;
    if (filters.format && c.format !== filters.format) return false;
    if (filters.network && c.network !== filters.network) return false;
    if (filters.status === "pendente" && !isPending(i.status)) return false;
    if (filters.status && filters.status !== "pendente" && i.status !== filters.status) return false;
    return true;
  });
  const shownStatus = (item) => (preview && item.status === "rascunho" ? "rascunho" : item.status);

  /* ---------- Cabeçalho e progresso ---------- */
  function header() {
    const b = view.batch;
    const mode = APPROVAL_MODES[b.mode] || APPROVAL_MODES.planejamento;
    const c = counts();
    const reviewed = c.approved + c.adjust;
    const pct = c.total ? Math.round((reviewed / c.total) * 100) : 0;
    const month = monthName(b.month).toLowerCase();
    const summary = !c.total ? "Nenhum conteúdo neste link."
      : c.pending ? `${plural(c.pending, "conteúdo aguarda", "conteúdos aguardam")} sua aprovação.`
      : "Tudo revisado. Obrigado!";
    return `
      <header class="ap-hero">
        <div class="ap-hero__top">
          <div class="ap-hero__brand">
            ${view.client.logo ? `<img class="ap-hero__logo" src="${esc(view.client.logo)}" alt="" referrerpolicy="no-referrer">` : `<span class="ap-hero__logo ap-hero__logo--initials" aria-hidden="true">${esc((view.client.name || "·").slice(0, 2).toUpperCase())}</span>`}
            <div><p class="ap-hero__client">${esc(view.client.name)}</p><p class="ap-hero__month">${esc(monthLabel(b.month))}</p></div>
          </div>
          <details class="ap-mode ap-mode--${esc(b.mode)}">
            <summary class="ap-mode__chip">${icon(mode.icon)}<span class="ap-mode__title">${esc(mode.label)}</span><span class="ap-mode__help" aria-hidden="true">?</span></summary>
            <p class="ap-mode__text">${esc(mode.note)}</p>
          </details>
        </div>
        <h1 class="ap-hero__title">${b.mode === "final" ? `Conteúdos de ${esc(month)}` : `Planejamento de ${esc(month)}`}</h1>
        <p class="ap-hero__summary">${esc(summary)}</p>
        ${b.intro ? `<p class="ap-hero__text">${esc(b.intro)}</p>` : ""}
        <section class="ap-progress" aria-label="Progresso da revisão">
          <div class="ap-progress__row">
            <p class="ap-progress__text"><b>${reviewed} de ${c.total}</b> revisados</p>
            <ul class="ap-legend">
              <li class="ap-legend__item ap-legend__item--aguardando"><b>${c.pending}</b> aguardando</li>
              <li class="ap-legend__item ap-legend__item--aprovado"><b>${c.approved}</b> ${c.approved === 1 ? "aprovado" : "aprovados"}</li>
              <li class="ap-legend__item ap-legend__item--ajustes"><b>${c.adjust}</b> ${c.adjust === 1 ? "ajuste" : "ajustes"}</li>
            </ul>
          </div>
          <div class="ap-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${reviewed}" aria-label="${reviewed} de ${c.total} conteúdos revisados">
            <span class="ap-bar__fill" data-pct="${pct}"></span>
          </div>
        </section>
        ${b.expires_at ? `<p class="ap-hero__expires">${icon("clock")}Link válido até ${esc(stampLabel(b.expires_at))}</p>` : ""}
      </header>`;
  }

  function finished() {
    const c = counts();
    if (!c.total || c.pending) return "";
    if (!c.adjust) {
      return `<section class="ap-done ap-done--ok" role="status"><span class="ap-done__icon">${icon("check")}</span><div><h2 class="ap-done__title">${view.batch.mode === "final" ? "Conteúdos aprovados!" : "Planejamento aprovado!"}</h2><p>Obrigado! Recebemos sua aprovação. ${view.batch.mode === "final" ? "Agora é com a gente: vamos programar as publicações." : "Agora nossa equipe seguirá com a próxima etapa."}</p></div></section>`;
    }
    const titles = items().filter((i) => i.status === "ajustes").map((i) => i.content?.title).filter(Boolean);
    return `<section class="ap-done ap-done--partial" role="status"><span class="ap-done__icon">${icon("message")}</span><div>
      <h2 class="ap-done__title">Recebemos sua revisão</h2>
      <p>${plural(c.approved, "aprovado", "aprovados")}. Vamos ajustar ${c.adjust === 1 ? "este" : "estes"}:</p>
      <ul class="ap-done__list">${titles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <p>A nova versão aparece neste mesmo link.</p></div></section>`;
  }

  /* ---------- Ferramentas ---------- */
  function toolbar() {
    const list = items();
    const formats = [...new Set(list.map((i) => i.content?.format).filter(Boolean))];
    const networks = [...new Set(list.map((i) => i.content?.network).filter(Boolean))];
    const c = counts();
    const n = activeFilters();
    const bulk = !preview && view.batch.allow_bulk && c.pending > 0;
    const select = (key, label, all, options) => `
      <label class="ap-filter"><span class="ap-filter__label">${esc(label)}</span><select class="field__input" data-ap-filter="${key}">
        <option value="">${esc(all)}</option>
        ${options.map(([value, text]) => `<option value="${esc(value)}" ${filters[key] === value ? "selected" : ""}>${esc(text)}</option>`).join("")}
      </select></label>`;
    return `
      <div class="ap-tools">
        <div class="ap-tools__row">
          <div class="ap-switch" role="tablist" aria-label="Como ver">
            <button type="button" role="tab" class="ap-switch__btn" data-ap-layout="lista" aria-selected="${layout === "lista"}">${icon("list")}Lista</button>
            <button type="button" role="tab" class="ap-switch__btn" data-ap-layout="calendario" aria-selected="${layout === "calendario"}">${icon("calendar")}Calendário</button>
          </div>
          <button type="button" class="ap-filters-toggle${n ? " is-active" : ""}" data-ap-filters aria-expanded="${filtersOpen}" aria-controls="ap-filters">${icon("layers")}Filtros${n ? `<b>${n}</b>` : ""}</button>
          ${bulk ? `<button class="btn btn--primary ap-bulk" type="button" data-ap-all>${icon("check")}Aprovar todos os pendentes (${c.pending})</button>` : ""}
        </div>
        <div class="ap-filters${filtersOpen ? " is-open" : ""}" id="ap-filters">
          ${select("status", "Status", "Todos", [["pendente", "Aguardando você"], ["aprovado", "Aprovados"], ["ajustes", "Ajustes solicitados"]])}
          ${formats.length > 1 || filters.format ? select("format", "Formato", "Todos", formats.map((f) => [f, typeOf(f).label])) : ""}
          ${networks.length > 1 || filters.network ? select("network", "Rede", "Todas", networks.map((x) => [x, networkOf(x)])) : ""}
          ${n ? `<button type="button" class="ap-link" data-ap-clear>Limpar filtros</button>` : ""}
        </div>
      </div>`;
  }

  /** Celular: "Aprovar todos" fixo no rodapé da tela (no computador fica na barra de ferramentas) */
  function bulkBar() {
    const c = counts();
    if (preview || !view.batch.allow_bulk || !c.pending) return "";
    return `<div class="ap-bulkbar"><button class="btn btn--primary" type="button" data-ap-all>${icon("check")}Aprovar todos os pendentes (${c.pending})</button></div>`;
  }

  /* ---------- Lista ---------- */
  function card(item) {
    const c = item.content;
    const t = typeOf(c.format);
    const s = statusOf(shownStatus(item));
    const note = item.status === "reenviado" ? "Revisado a seu pedido"
      : item.status === "ajustes" ? "Você pediu ajuste" : "";
    const art = thumb(item);
    return `
      <article class="ap-card ap-card--${esc(item.status)}" id="ap-${esc(item.id)}" data-ap-item="${esc(item.id)}">
        <button type="button" class="ap-card__open${art ? " has-art" : ""}" data-ap-open="${esc(item.id)}" aria-label="${esc(`${c.title}. ${shortDate(c)}. ${t.label}. ${s.label}. Ver detalhes`)}">
          <span class="ap-card__info">
            <span class="ap-card__meta"><span class="ap-card__date">${esc(shortDate(c))}</span>${statusBadge(shownStatus(item))}</span>
            <span class="ap-card__title">${esc(c.title)}</span>
            ${note ? `<span class="ap-card__note">${esc(note)}</span>` : ""}
            <span class="ap-card__foot">
              <span class="ap-card__tags"><span class="ap-tag type--${esc(c.format)}">${icon(t.icon)}${esc(t.label)}</span><span class="ap-card__network">${esc(networkOf(c.network))}</span></span>
              <span class="ap-card__more"><span class="ap-card__more-text">Ver detalhes</span>${icon("chevronRight")}</span>
            </span>
          </span>
          ${art}
        </button>
      </article>`;
  }

  const emptyState = () => `<div class="ap-empty"><p>${icon("list")}Nenhum conteúdo com esses filtros.</p><button type="button" class="btn btn--ghost" data-ap-clear>Limpar filtros</button></div>`;
  function listView() {
    const list = visible();
    return list.length ? `<div class="ap-list">${list.map(card).join("")}</div>` : emptyState();
  }

  /* ---------- Calendário ---------- */
  function calendarView() {
    const list = visible();
    const byDay = {};
    list.forEach((i) => { (byDay[i.content.scheduled_date] ||= []).push(i); });
    const chip = (i, rich = false) => {
      const c = i.content;
      const t = typeOf(c.format);
      const s = statusOf(shownStatus(i));
      return `<button type="button" class="ap-chip ap-chip--${esc(i.status)}" data-ap-open="${esc(i.id)}" title="${esc(c.title)}" aria-label="${esc(`${c.title}. ${t.label}. ${s.label}. Ver detalhes`)}">
        <span class="ap-chip__dot" aria-hidden="true"></span>
        <span class="ap-chip__text">${c.scheduled_time ? `<span class="ap-chip__time">${esc(timeLabel(c.scheduled_time))}</span>` : ""}<span class="ap-chip__title">${esc(c.title)}</span>${rich ? `<span class="ap-chip__meta">${icon(t.icon)}${esc(t.label)} · ${esc(s.short)}</span>` : ""}</span>
        ${rich ? icon("chevronRight") : ""}
      </button>`;
    };
    const grid = monthGrid(view.batch.month).map((d) => `
      <div class="ap-cal__cell${d.inMonth ? "" : " is-out"}${byDay[d.iso]?.length ? " has-items" : ""}">
        <span class="ap-cal__day">${d.day}</span>
        ${d.inMonth ? (byDay[d.iso] || []).map((i) => chip(i)).join("") : ""}
      </div>`).join("");
    const days = Object.keys(byDay).sort();
    // No celular: agenda por dia (células pequenas demais para tocar)
    const agenda = days.length
      ? days.map((iso) => `<section class="ap-agenda__day"><h3 class="ap-agenda__title">${esc(longDayLabel(iso))}</h3>${byDay[iso].map((i) => chip(i, true)).join("")}</section>`).join("")
      : emptyState();
    return `
      <div class="ap-cal" aria-label="Calendário de ${esc(monthLabel(view.batch.month))}">
        <div class="ap-cal__head">${WEEKDAYS_SHORT.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="ap-cal__grid">${grid}</div>
      </div>
      <div class="ap-agenda">${agenda}</div>`;
  }

  /* ---------- Detalhe ---------- */
  function decisionArea(item) {
    const c = item.content;
    const pending = isPending(item.status);
    const parts = [];
    if (item.status === "reenviado" && item.previous_request?.comment) {
      parts.push(`<p class="ap-revised">${icon("refresh")}<span><b>Revisamos este conteúdo</b> a partir do seu pedido: “${esc(item.previous_request.comment)}”</span></p>`);
    }
    if (item.decision) {
      const who = item.decision.reviewer_name ? ` por ${esc(item.decision.reviewer_name)}` : "";
      parts.push(item.decision.action === "aprovado"
        ? `<p class="ap-decided ap-decided--ok">${icon("check")}<span>Aprovado${who} em ${esc(stampLabel(item.decision.created_at))}.</span></p>`
        : `<div class="ap-decided ap-decided--adjust">${icon("message")}<div><p>Ajuste solicitado${who} em ${esc(stampLabel(item.decision.created_at))}:</p><blockquote>${esc(item.decision.comment)}</blockquote><p class="ap-muted">Vamos revisar e enviar a nova versão por este link.</p></div></div>`);
    }
    if (preview) {
      parts.push(`<p class="ap-muted ap-preview-note">${icon("eye")}Pré-visualização: o cliente verá ${pending ? "Aprovar conteúdo e Solicitar ajuste" : "o status"} aqui.</p>`);
      return parts.join("");
    }
    if (!pending || !view.batch.allow_individual) {
      const nextPending = navIds.map(byId).find((i) => i && i.id !== item.id && isPending(i.status));
      if (nextPending && item.decision) parts.push(`<div class="ap-actions"><button class="btn btn--primary" type="button" data-ap-goto="${esc(nextPending.id)}">Próximo pendente${icon("arrowRight")}</button></div>`);
      return parts.join("");
    }
    const working = busy.has(item.id);
    if (adjusting === item.id) {
      parts.push(`
        <form class="ap-adjust" data-ap-adjust="${esc(item.id)}" novalidate>
          <label class="field">
            <span class="field__label">O que você gostaria de ajustar?</span>
            <textarea class="field__input field__input--area" name="comment" rows="3" maxlength="1000" required placeholder="Ex.: Prefiro falar mais sobre o café especial.">${esc(drafts.get(item.id) || "")}</textarea>
          </label>
          <p class="form-error" role="alert" hidden></p>
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" data-ap-cancel>Cancelar</button>
            <button class="btn btn--primary" type="submit" ${working ? "disabled" : ""}>${icon("send")}Enviar pedido de ajuste</button>
          </div>
        </form>`);
    } else if (confirming === item.id) {
      parts.push(`
        <div class="ap-confirm" role="group" aria-label="Confirmar aprovação">
          <p><b>Aprovar “${esc(c.title)}”?</b> ${view.batch.mode === "planejamento" ? "Você aprova a ideia; a arte vem depois." : "Você aprova o conteúdo como está."}</p>
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" data-ap-cancel>Cancelar</button>
            <button class="btn btn--success" type="button" data-ap-approve-now="${esc(item.id)}" ${working ? "disabled" : ""}>${icon("check")}Sim, aprovar</button>
          </div>
        </div>`);
    } else {
      parts.push(`
        <div class="ap-actions ap-actions--main">
          <button class="btn btn--ghost" type="button" data-ap-request="${esc(item.id)}" ${working ? "disabled" : ""}>${icon("edit")}Solicitar ajuste</button>
          <button class="btn btn--primary" type="button" data-ap-approve="${esc(item.id)}" ${working ? "disabled" : ""}>${icon("check")}Aprovar conteúdo</button>
        </div>`);
    }
    return parts.join("");
  }

  function detailBody(item) {
    const c = item.content;
    const t = typeOf(c.format);
    const media = mediaBlock(item, view.batch.mode);
    const isLong = (c.idea || "").length > LONG_TEXT;
    const clamped = isLong && !expanded.has(item.id);
    const idea = c.idea
      ? `<p class="ap-sec__text${clamped ? " is-clamped" : ""}">${esc(c.idea)}</p>${isLong ? `<button type="button" class="ap-link" data-ap-expand="${esc(item.id)}" aria-expanded="${!clamped}">${clamped ? "Ver descrição completa" : "Mostrar menos"}</button>` : ""}`
      : "";
    // O banco já manda só o que a etapa mostra: ideia (planejamento) ou arte e legenda (final)
    const final = view.batch.mode === "final";
    const captionBody = [para(c.caption, "ap-sec__text--box"), c.hashtags ? `<p class="ap-hashtags">${esc(c.hashtags)}</p>` : "", c.cta ? `<p class="ap-cta">${icon("send")}<span><b>Chamada para ação:</b> ${esc(c.cta)}</span></p>` : ""].join("");
    const notes = c.planning_notes || c.client_notes;
    const facts = [
      ["Rede", networkOf(c.network)],
      item.version_number > 1 && ["Versão", `Versão ${item.version_number}`]
    ].filter(Boolean);
    const extra = `<dl class="ap-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
    const empty = !c.idea && !c.content_plan && !c.caption && !notes && !(c.assets || []).length;
    return `
      <div class="ap-detail__grid${media ? "" : " is-text"}">
        <div class="ap-detail__intro">
          <div class="ap-detail__meta">${statusBadge(shownStatus(item))}<span class="ap-tag type--${esc(c.format)}">${icon(t.icon)}${esc(t.label)}</span></div>
          <h2 class="ap-detail__title" id="ap-detail-title">${esc(c.title)}</h2>
          <p class="ap-detail__date">${icon("calendar")}${esc(dateLine(c))}</p>
        </div>
        ${media ? `<div class="ap-detail__media">${media}</div>` : ""}
        <div class="ap-detail__info">
          <div class="ap-detail__sections">
            ${section("lightbulb", "A ideia", idea)}
            ${section("play", "Roteiro / como vai ser", para(c.content_plan))}
            ${final ? section("edit", "Legenda", captionBody) : ""}
            ${section("message", final ? "Observações" : "Observações do planejamento", para(notes, "ap-sec__text--note"))}
            ${more("Informações adicionais", extra)}
            ${empty ? '<p class="ap-muted">Nossa equipe ainda está detalhando este conteúdo.</p>' : ""}
          </div>
        </div>
      </div>`;
  }

  function renderDetail({ keepScroll = true } = {}) {
    const item = byId(current);
    if (!item?.content) { closeDetail(); return; }
    const index = navIds.indexOf(item.id);
    const total = navIds.length;
    const prev = index > 0;
    const next = index >= 0 && index < total - 1;
    const scroller = dialog.querySelector(".ap-detail__scroll");
    const top = keepScroll && scroller ? scroller.scrollTop : 0;
    const openDetails = keepScroll ? [...dialog.querySelectorAll(".ap-more")].map((d) => d.open) : null;
    const html = `
      <div class="ap-detail__panel">
        <div class="ap-detail__head">
          <div class="ap-detail__nav">
            <button class="icon-btn" type="button" data-ap-step="-1" aria-label="Conteúdo anterior" ${prev ? "" : "disabled"}>${icon("chevronLeft")}</button>
            <p class="ap-detail__count" aria-live="polite">${index >= 0 ? `Conteúdo <b>${index + 1}</b> de ${total}` : ""}</p>
            <button class="icon-btn" type="button" data-ap-step="1" aria-label="Próximo conteúdo" ${next ? "" : "disabled"}>${icon("chevronRight")}</button>
          </div>
          <button class="icon-btn" type="button" data-ap-close aria-label="Fechar">${icon("close")}</button>
        </div>
        <div class="ap-detail__scroll" data-ap-item="${esc(item.id)}">${detailBody(item)}</div>
        <div class="ap-detail__foot ap-card__decision" aria-live="polite">${decisionArea(item)}</div>
      </div>`;
    // Troca só o painel: os avisos (toasts) que moram dentro da janela continuam
    const old = dialog.querySelector(".ap-detail__panel");
    if (old) old.outerHTML = html; else dialog.insertAdjacentHTML("afterbegin", html);
    if (openDetails) dialog.querySelectorAll(".ap-more").forEach((d, i) => { if (openDetails[i] !== undefined) d.open = openDetails[i]; });
    dialog.querySelector(".ap-detail__scroll").scrollTop = top;
  }

  function openDetail(id) {
    if (!byId(id)) return;
    navIds = visible().map((i) => i.id);
    if (!navIds.includes(id)) navIds = items().map((i) => i.id);
    current = id; moved = false;
    confirming = null; adjusting = null;
    renderDetail({ keepScroll: false });
    if (!dialog.open) { dialog.showModal(); document.documentElement.classList.add("ap-locked"); }
    dialog.querySelector("[data-ap-close]").focus();
  }
  function go(id) {
    if (!id || !byId(id)) return;
    const forward = navIds.indexOf(id) > navIds.indexOf(current);
    current = id; moved = true;
    confirming = null; adjusting = null;
    renderDetail({ keepScroll: false });
    dialog.querySelector(".ap-detail__scroll")?.classList.add(forward ? "is-next" : "is-prev");
  }
  function closeDetail() { if (dialog.open) dialog.close(); }
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("ap-locked");
    const last = current;
    current = null; confirming = null; adjusting = null;
    const target = last && root.querySelector(`[data-ap-open="${CSS.escape(last)}"]`);
    if (target) {
      // Volta para onde estava; se navegou, mostra o último conteúdo visto
      target.focus({ preventScroll: true });
      if (moved) target.scrollIntoView({ block: "center" });
    }
  });

  /* ---------- Página ---------- */
  function render() {
    if (!view) return;
    const scroll = window.scrollY;
    const focused = document.activeElement?.closest?.("[data-ap-filter]")?.dataset.apFilter;
    root.innerHTML = `
      ${preview ? `<div class="ap-preview-bar" role="note">${icon("eye")}<span><b>Pré-visualização da equipe.</b> É assim que o cliente vê o link; os botões de decisão ficam desligados.</span></div>` : ""}
      ${header()}
      ${finished()}
      ${toolbar()}
      <div class="ap-body">${layout === "lista" ? listView() : calendarView()}</div>
      ${bulkBar()}
      <footer class="ap-foot"><span class="ap-foot__mark">${brandMark("ap-foot__logo")}</span><p>Digital Galaxy · Dúvidas? Fale com a nossa equipe pelo canal de sempre.</p></footer>`;
    // Largura da barra pelo CSSOM (a política de segurança não aceita style="" no HTML)
    root.querySelectorAll("[data-pct]").forEach((bar) => { bar.style.width = `${Number(bar.dataset.pct) || 0}%`; });
    window.scrollTo(0, scroll);
    if (focused) root.querySelector(`[data-ap-filter="${focused}"]`)?.focus({ preventScroll: true });
    if (dialog.open && current) renderDetail();
  }

  /* ---------- Nome para o histórico ---------- */
  function askName() {
    const saved = safe.get(NAME_KEY);
    if (saved !== null) return Promise.resolve(saved);
    return new Promise((resolve) => {
      const box = document.createElement("dialog");
      box.className = "ap-dialog ap-dialog--small";
      box.innerHTML = `
        <form class="ap-name" method="dialog" novalidate>
          <h2 class="ap-name__title">Como podemos identificar sua aprovação?</h2>
          <p class="ap-muted">Seu nome aparece no histórico da nossa equipe. Não é preciso criar conta.</p>
          <label class="field"><span class="field__label">Seu nome</span><input class="field__input" name="name" maxlength="80" autocomplete="name" placeholder="Ex.: Maria (marketing)"></label>
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" value="skip" data-ap-skip>Continuar sem nome</button>
            <button class="btn btn--primary" type="submit">Continuar</button>
          </div>
        </form>`;
      document.body.append(box);
      const finish = (name) => { const value = String(name || "").trim().slice(0, 80); safe.set(NAME_KEY, value); box.close(); box.remove(); resolve(value); };
      box.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); finish(box.querySelector("[name=name]").value); });
      box.querySelector("[data-ap-skip]").addEventListener("click", () => finish(""));
      box.addEventListener("cancel", (e) => { e.preventDefault(); finish(""); });
      box.showModal();
      box.querySelector("[name=name]").focus();
    });
  }

  /* ---------- Ações ---------- */
  async function run(itemId, fn, okMessage) {
    busy.add(itemId);
    render();
    try {
      const result = await fn();
      if (result?.view) view = result.view;
      confirming = null; adjusting = null; drafts.delete(itemId);
      if (okMessage) toast(okMessage);
    } catch (error) {
      if (error.view) view = error.view;
      if (error.reason === "versao_desatualizada" || error.reason === "ja_decidido") { confirming = null; adjusting = null; }
      toast(error.message || "Não foi possível concluir. Tente de novo.", "error");
    } finally {
      busy.delete(itemId);
      render();
      if (dialog.open) dialog.querySelector("[data-ap-goto], .ap-detail__foot .btn--primary, [data-ap-close]")?.focus({ preventScroll: true });
    }
  }

  on(root, "click", "[data-ap-layout]", (e, b) => { layout = b.dataset.apLayout; render(); });
  on(root, "click", "[data-ap-filters]", () => { filtersOpen = !filtersOpen; render(); });
  on(root, "change", "[data-ap-filter]", (e, s) => { filters[s.dataset.apFilter] = s.value; render(); });
  on(root, "click", "[data-ap-clear]", () => { filters.format = ""; filters.network = ""; filters.status = ""; render(); });
  on(root, "click", "[data-ap-open]", (e, b) => openDetail(b.dataset.apOpen));

  on(dialog, "click", "[data-ap-step]", (e, b) => {
    const step = b.dataset.apStep;
    go(navIds[navIds.indexOf(current) + Number(step)]);
    (dialog.querySelector(`[data-ap-step="${step}"]:not([disabled])`) || dialog.querySelector("[data-ap-close]")).focus();
  });
  on(dialog, "click", "[data-ap-goto]", (e, b) => { go(b.dataset.apGoto); dialog.querySelector(".ap-detail__foot .btn--primary, [data-ap-close]")?.focus(); });
  on(dialog, "click", "[data-ap-close]", () => closeDetail());
  on(dialog, "click", "[data-ap-expand]", (e, b) => {
    const id = b.dataset.apExpand;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderDetail();
    dialog.querySelector("[data-ap-expand]")?.focus();
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeDetail(); });
  // Celular: deslizar para o lado passa para o conteúdo anterior/próximo (fora da galeria e dos campos)
  let touch = null;
  dialog.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    touch = e.touches.length === 1 && !e.target.closest(".carousel, .media, input, textarea, select, .ap-detail__foot") ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  dialog.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const target = navIds[navIds.indexOf(current) + (dx < 0 ? 1 : -1)];
    if (target) go(target);
  }, { passive: true });
  dialog.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target.closest("input, textarea, select, .carousel__track")) return;
    const target = navIds[navIds.indexOf(current) + (e.key === "ArrowRight" ? 1 : -1)];
    if (target) { e.preventDefault(); go(target); dialog.querySelector("[data-ap-close]").focus(); }
  });

  on(dialog, "click", "[data-ap-approve]", (e, b) => { confirming = b.dataset.apApprove; adjusting = null; renderDetail(); dialog.querySelector("[data-ap-approve-now]")?.focus(); });
  on(dialog, "click", "[data-ap-request]", (e, b) => { adjusting = b.dataset.apRequest; confirming = null; renderDetail(); dialog.querySelector("[data-ap-adjust] textarea")?.focus(); });
  on(dialog, "click", "[data-ap-cancel]", () => { confirming = null; adjusting = null; renderDetail(); dialog.querySelector(".ap-detail__foot .btn--primary")?.focus(); });
  on(dialog, "input", "[data-ap-adjust] textarea", (e, t) => drafts.set(t.closest("[data-ap-adjust]").dataset.apAdjust, t.value));
  on(dialog, "click", "[data-ap-approve-now]", async (e, b) => {
    const item = byId(b.dataset.apApproveNow);
    if (!item || busy.has(item.id)) return;
    const name = await askName();
    await run(item.id, () => decide({ item: item.id, version: item.version_id, decision: "aprovado", name, session: sessionId() }), "Conteúdo aprovado com sucesso!");
  });
  on(dialog, "submit", "[data-ap-adjust]", async (e, form) => {
    e.preventDefault();
    const item = byId(form.dataset.apAdjust);
    const comment = form.elements.comment.value.trim();
    const box = form.querySelector(".form-error");
    if (!comment) { box.textContent = "Conte o que você gostaria de ajustar."; box.hidden = false; form.elements.comment.setAttribute("aria-invalid", "true"); form.elements.comment.focus(); return; }
    if (!item || busy.has(item.id)) return;
    const name = await askName();
    await run(item.id, () => decide({ item: item.id, version: item.version_id, decision: "ajustes", comment, name, session: sessionId() }), "Pedido de ajuste enviado. Obrigado!");
  });

  on(root, "click", "[data-ap-all]", async () => {
    const pending = items().filter((i) => isPending(i.status));
    if (!pending.length) return;
    const ok = await new Promise((resolve) => {
      const box = document.createElement("dialog");
      box.className = "ap-dialog ap-dialog--small";
      box.setAttribute("role", "alertdialog");
      box.innerHTML = `
        <div class="ap-name">
          <h2 class="ap-name__title">Aprovar todos os pendentes?</h2>
          <p>Você está prestes a aprovar ${pending.length} ${pending.length === 1 ? "conteúdo" : "conteúdos"}. Deseja continuar?</p>
          ${counts().adjust ? `<p class="ap-muted">Os que estão com ajuste solicitado não entram.</p>` : ""}
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" data-answer="no">Cancelar</button>
            <button class="btn btn--success" type="button" data-answer="yes">${icon("check")}Confirmar aprovação</button>
          </div>
        </div>`;
      document.body.append(box);
      const finish = (answer) => { box.close(); box.remove(); resolve(answer); };
      box.addEventListener("click", (e) => { const b = e.target.closest("[data-answer]"); if (b) finish(b.dataset.answer === "yes"); else if (e.target === box) finish(false); });
      box.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
      box.showModal();
      box.querySelector('[data-answer="no"]').focus();
    });
    if (!ok) return;
    const name = await askName();
    const button = root.querySelector("[data-ap-all]");
    if (button) { button.disabled = true; button.classList.add("is-loading"); }
    try {
      const result = await approveAll({ items: pending.map((i) => ({ item: i.id, version: i.version_id })), name, session: sessionId() });
      view = result.view;
      const n = result.approved?.length || 0;
      toast(n ? `${n} ${n === 1 ? "conteúdo aprovado" : "conteúdos aprovados"} com sucesso!` : "Nenhum conteúdo precisava de aprovação.");
    } catch (error) {
      if (error.view) view = error.view;
      toast(error.message || "Não foi possível aprovar agora. Tente de novo.", "error");
    } finally {
      render();
    }
  });

  return {
    show(next) { view = next; render(); },
    get view() { return view; }
  };
}

/** Mensagens de link que não abre (sem dados do lote) */
export function renderLinkProblem(root, { title, text, iconName = "lock" }) {
  root.innerHTML = `
    <section class="ap-problem" role="alert">
      <span class="ap-problem__icon">${icon(iconName)}</span>
      <h1 class="ap-problem__title">${esc(title)}</h1>
      <p class="ap-problem__text">${esc(text)}</p>
      <p class="ap-muted">Digital Galaxy · Central de aprovação</p>
    </section>`;
}
