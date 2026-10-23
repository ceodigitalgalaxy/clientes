/* ==========================================================================
   Destaques: carrossel no topo do portal
   --------------------------------------------------------------------------
   Mostra primeiro o que pede uma ação do cliente e depois as novidades:
     1. Para você aprovar   (aguardando, por data)
     2. Estamos ajustando   (ajustes pedidos)
     3. Aprovado            (vai ao ar em breve)
     4. Já publicado        (os mais recentes)
   Passa sozinho a cada 6 s (para quando o mouse, o foco ou o dedo estão nele,
   quando a aba está escondida ou um painel está aberto; não passa sozinho
   para quem pediu menos movimento). No celular dá para arrastar com o dedo.
   Embaixo, os números do mês, pequenos.
   ========================================================================== */

import { esc, reduceMotion } from "../lib/dom.js?v=a5be30320a";
import { icon } from "../lib/icons.js?v=a5be30320a";
import { addDays, longDayLabel, dayLabel, timeLabel, monthName } from "../lib/dates.js?v=a5be30320a";
import { ACTIVITY_TYPES, PLATFORMS } from "../domain/model.js?v=a5be30320a";
import { mediaCover, coverHtml, embedCover } from "./media.js?v=a5be30320a";

const AUTOPLAY_MS = 6000;
const MAX_PUBLISHED = 4;
const MAX_SLIDES = 12;

const GROUPS = {
  aguardando: { tag: "Para você aprovar", tagIcon: "clock", cta: "Ver e aprovar" },
  ajustes:    { tag: "Estamos ajustando", tagIcon: "edit", cta: "Ver detalhes" },
  aprovado:   { tag: "Aprovado", tagIcon: "check", cta: "Ver conteúdo" },
  publicado:  { tag: "Já publicado", tagIcon: "send", cta: "Ver conteúdo" }
};

/** Escolhe e ordena os destaques (por id, só o que existe de verdade) */
export function pickHighlights(activities, today) {
  const by = (status) => activities.filter((a) => a.status === status);
  const asc = (a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));
  const list = [
    ...by("aguardando").sort(asc),
    ...by("ajustes").sort(asc),
    ...by("aprovado").filter((a) => a.date >= today).sort(asc),
    ...by("publicado").filter((a) => a.date <= today).sort((a, b) => asc(b, a)).slice(0, MAX_PUBLISHED)
  ];
  return list.slice(0, MAX_SLIDES);
}

/**
 * Capa do conteúdo: imagem da arte final; senão o primeiro quadro do vídeo
 * final; senão a capa da referência (imagem ou capa do vídeo).
 * @returns {{kind: "image"|"video", src: string, play: boolean} | null}  play: é um vídeo
 */
export function cover(activity) {
  const finalImage = activity.final.find((f) => f.kind === "image" && f.src);
  if (finalImage) return { kind: "image", src: finalImage.src, play: false };
  const finalVideo = activity.final.find((f) => f.kind === "video" && f.src);
  const fromVideo = finalVideo && mediaCover(finalVideo.src, "video");
  if (fromVideo) return { ...fromVideo, play: true };
  const ref = activity.media[0];
  const fromRef = ref && mediaCover(ref.src, ref.kind);
  if (fromRef) return { ...fromRef, play: ref.kind === "video" || fromRef.kind === "video" };
  return null;
}

function when(activity, today) {
  const tomorrow = addDays(today, 1);
  const day = activity.date === today ? "Hoje" : activity.date === tomorrow ? "Amanhã" : longDayLabel(activity.date);
  return `${day}${activity.time ? ` às ${timeLabel(activity.time)}` : ""}`;
}

function slide(activity, index, total, today) {
  const group = GROUPS[activity.status];
  const type = ACTIVITY_TYPES[activity.type] || ACTIVITY_TYPES.outro;
  const art = cover(activity);
  // Sem capa em imagem (ex.: Instagram): o post oficial vira a capa, carregado só quando o destaque aparece
  const live = !art && activity.media[0] ? embedCover(activity.media[0].src, activity.media[0].kind) : null;
  const hasVideo = art?.play || (!art && (activity.final.some((f) => f.kind === "video") || activity.media[0]?.kind === "video"));
  const network = activity.platforms.map((p) => PLATFORMS[p] || p).join(", ");
  let tag = group.tag;
  if (activity.status === "aprovado") tag = activity.date === today ? "Aprovado · vai ao ar hoje" : `Aprovado · vai ao ar ${dayLabel(activity.date)}`;
  if (activity.status === "publicado") tag = `Publicado ${activity.date === today ? "hoje" : `em ${dayLabel(activity.date)}`}`;
  const text = activity.status === "ajustes" && activity.decision?.message
    ? `Você pediu: “${activity.decision.message}”`
    : activity.caption;
  const pending = activity.status === "aguardando";
  return `
    <li class="slide slide--${esc(activity.status)}" role="group" aria-roledescription="destaque" aria-label="${index + 1} de ${total}: ${esc(activity.title)}" data-slide="${index}">
      <div class="slide__media type--${esc(activity.type)}">
        <span class="slide__placeholder">${icon(hasVideo ? "play" : type.icon)}</span>
        ${coverHtml(art, "data-slide-img")}
        ${live ? `<span class="slide__embed slide__embed--${esc(live.provider.toLowerCase())}" data-embed="${esc(live.src)}" data-embed-title="${esc(`${live.provider}: ${activity.title}`)}"></span>` : ""}
        ${art && hasVideo ? `<span class="play-badge">${icon("play")}</span>` : ""}
        <button class="slide__hit" type="button" data-highlight="${esc(activity.id)}" tabindex="-1" aria-hidden="true"></button>
      </div>
      <div class="slide__body">
        <span class="slide__tag">${icon(group.tagIcon)}${esc(tag)}</span>
        <h3 class="slide__title">${esc(activity.title)}</h3>
        <p class="slide__meta">${icon("calendar")}<span>${esc(when(activity, today))}</span></p>
        <p class="slide__meta">${icon(type.icon)}<span>${esc(type.label)}${network ? ` · ${esc(network)}` : ""}</span></p>
        ${text ? `<p class="slide__text">${esc(text)}</p>` : ""}
        <button class="btn ${pending ? "btn--primary" : "btn--ghost"} btn--sm slide__cta" type="button" data-highlight="${esc(activity.id)}">${esc(group.cta)}${icon("arrowRight")}</button>
      </div>
    </li>`;
}

const STATS = [
  { key: "planejados", one: "conteúdo no mês", many: "conteúdos no mês", tone: "neutral" },
  { key: "aguardando", one: "para aprovar", many: "para aprovar", tone: "aguardando" },
  { key: "ajustes", one: "em ajuste", many: "em ajuste", tone: "ajustes" },
  { key: "aprovado", one: "aprovado", many: "aprovados", tone: "aprovado" },
  { key: "publicado", one: "publicado", many: "publicados", tone: "publicado" }
];

function miniStats(counts, month) {
  return `
    <div class="mini-stats">
      <p class="mini-stats__label">${esc(monthName(month))}</p>
      <ul class="mini-stats__list" aria-label="Números de ${esc(monthName(month).toLowerCase())}">${STATS.map((s) => `
        <li class="mini-stat mini-stat--${s.tone}${counts[s.key] ? "" : " is-zero"}"><b>${counts[s.key]}</b> ${counts[s.key] === 1 ? s.one : s.many}</li>`).join("")}
      </ul>
    </div>`;
}

export function createHighlights({ container }) {
  let items = [];
  let index = 0;
  let key = "";
  let timer = null;
  let holdUntil = 0;
  let hovering = false;
  let focused = false;
  let wired = false;

  const track = () => container.querySelector(".spot__track");
  const blocked = () => hovering || focused || document.hidden || Date.now() < holdUntil || document.querySelector("dialog[open]") || reduceMotion();

  function paint() {
    const total = items.length;
    container.querySelectorAll(".spot__dot").forEach((dot, i) => {
      dot.classList.toggle("is-active", i === index);
      dot.setAttribute("aria-current", i === index ? "true" : "false");
    });
    container.querySelectorAll(".slide").forEach((s, i) => {
      s.toggleAttribute("inert", i !== index);
      s.classList.toggle("is-active", i === index);
      // Post oficial (Instagram/Vimeo): carrega no destaque atual e no próximo; depois fica
      const near = i === index || i === (index + 1) % total;
      const slot = s.querySelector("[data-embed]:not(.is-loaded)");
      if (slot && near) {
        slot.classList.add("is-loaded");
        const frame = document.createElement("iframe");
        frame.src = slot.dataset.embed;
        frame.title = slot.dataset.embedTitle;
        frame.loading = "lazy";
        frame.tabIndex = -1;
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
        slot.append(frame);
      }
    });
    // Computador: "A seguir" com os próximos destaques (clicar leva até ele)
    const queue = container.querySelector(".spot__queue-list");
    if (queue) {
      const next = [1, 2, 3, 4].map((n) => (index + n) % total).filter((i, k, all) => i !== index && all.indexOf(i) === k);
      queue.innerHTML = next.map((i) => {
        const a = items[i];
        return `<li><button class="queue-item queue-item--${esc(a.status)}" type="button" data-dot="${i}">
          <span class="queue-item__tag">${esc(GROUPS[a.status].tag)}</span>
          <span class="queue-item__title">${esc(a.title)}</span>
          <span class="queue-item__date">${esc(dayLabel(a.date))}</span>
        </button></li>`;
      }).join("");
    }
    const counter = container.querySelector(".spot__count");
    if (counter) counter.textContent = `${index + 1} de ${total}`;
    container.querySelector(".spot")?.classList.toggle("is-paused", Boolean(blocked()));
  }

  function goTo(next, { smooth = true } = {}) {
    const t = track();
    if (!t || !items.length) return;
    index = (next + items.length) % items.length;
    t.scrollTo({ left: index * t.clientWidth, behavior: smooth && !reduceMotion() ? "smooth" : "auto" });
    paint();
    restart();
  }

  function restart() {
    clearTimeout(timer);
    // Reinicia a barrinha de progresso do ponto ativo
    const active = container.querySelector(".spot__dot.is-active");
    if (active) { active.classList.remove("is-running"); void active.offsetWidth; }
    if (items.length < 2) return;
    if (!blocked()) active?.classList.add("is-running");
    timer = setTimeout(() => { if (blocked()) restart(); else goTo(index + 1); }, AUTOPLAY_MS);
  }

  function wire() {
    if (wired) return;
    wired = true;
    container.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-spot-nav]");
      if (nav) { goTo(index + Number(nav.dataset.spotNav)); return; }
      const dot = event.target.closest("[data-dot]");
      if (dot) goTo(Number(dot.dataset.dot));
    });
    container.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hovering = true; restart(); paint(); } });
    container.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hovering = false; restart(); paint(); } });
    // Tocou ou arrastou: espera um pouco antes de voltar a passar sozinho
    container.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { holdUntil = Date.now() + 12000; restart(); } });
    container.addEventListener("focusin", () => { focused = true; restart(); paint(); });
    container.addEventListener("focusout", (e) => { if (!container.contains(e.relatedTarget)) { focused = false; restart(); paint(); } });
    container.addEventListener("keydown", (e) => {
      if (!e.target.closest(".spot")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
    });
    // Imagem que não abre: fica o ícone do tipo
    container.addEventListener("error", (e) => { if (e.target.matches?.("[data-slide-img]")) e.target.remove(); }, true);
    document.addEventListener("visibilitychange", () => { restart(); paint(); });
    window.addEventListener("resize", () => { const t = track(); if (t) t.scrollTo({ left: index * t.clientWidth }); });
  }

  function onScroll() {
    const t = track();
    if (!t || !t.clientWidth) return;
    const next = Math.round(t.scrollLeft / t.clientWidth);
    if (next !== index && next >= 0 && next < items.length) { index = next; paint(); restart(); }
  }

  return {
    /**
     * @param {object} data
     * @param {import("../domain/model.js").Activity[]} data.highlights  já escolhidos (pickHighlights)
     * @param {object} data.counts  números do mês mostrado no calendário
     * @param {string} data.month
     * @param {string} data.today
     */
    render({ highlights, counts, month, today }) {
      wire();
      const nextKey = JSON.stringify([highlights.map((a) => [a.id, a.version, a.status, a.date, a.time, a.title, cover(a)?.src]), counts, month, today]);
      if (nextKey === key && container.querySelector(".spot")) return;   // nada mudou: não mexe (não pula o slide)
      key = nextKey;
      const currentId = items[index]?.id;
      items = highlights;
      index = Math.max(0, items.findIndex((a) => a.id === currentId));
      const pending = items.filter((a) => a.status === "aguardando").length;
      const title = pending
        ? `Você tem ${pending} ${pending === 1 ? "conteúdo" : "conteúdos"} para aprovar`
        : items.length ? "Tudo em dia: veja as novidades" : "Tudo em dia por aqui";
      const controls = items.length > 1 ? `
        <div class="spot__controls">
          <button class="icon-btn" type="button" data-spot-nav="-1" aria-label="Destaque anterior">${icon("chevronLeft")}</button>
          <span class="spot__count" aria-hidden="true"></span>
          <button class="icon-btn" type="button" data-spot-nav="1" aria-label="Próximo destaque">${icon("chevronRight")}</button>
        </div>` : "";
      const body = items.length
        ? `<div class="spot__viewport" role="region" aria-roledescription="carrossel" aria-label="Destaques" tabindex="0">
             <ul class="spot__track">${items.map((a, i) => slide(a, i, items.length, today)).join("")}</ul>
           </div>
           ${items.length > 1 ? '<aside class="spot__queue" aria-label="A seguir"><p class="spot__queue-title">A seguir</p><ul class="spot__queue-list"></ul></aside>' : ""}
           ${items.length > 1 ? `<div class="spot__dots" role="group" aria-label="Escolher destaque">${items.map((a, i) => `<button class="spot__dot slide-dot--${esc(a.status)}" type="button" data-dot="${i}" aria-label="Destaque ${i + 1}: ${esc(a.title)}"><span></span></button>`).join("")}</div>` : ""}`
        : `<div class="spot__empty">
             <span class="spot__empty-icon">${icon("check")}</span>
             <p class="spot__empty-text">Quando tivermos um conteúdo novo para você aprovar, ele aparece aqui primeiro.</p>
           </div>`;
      container.innerHTML = `
        <div class="spot${pending ? " has-pending" : ""}${items.length > 1 ? " has-queue" : ""}">
          <div class="spot__head">
            <div>
              <p class="spot__eyebrow">${icon("sparkle")}Destaques</p>
              <h2 class="spot__title">${esc(title)}</h2>
            </div>
            ${controls}
          </div>
          ${body}
        </div>
        ${miniStats(counts, month)}`;
      const t = track();
      t?.addEventListener("scroll", () => { clearTimeout(t._settle); t._settle = setTimeout(onScroll, 80); }, { passive: true });
      if (t) t.scrollTo({ left: index * t.clientWidth });
      paint();
      restart();
    },
    /** Some da tela (saiu do portal) */
    reset() { clearTimeout(timer); items = []; index = 0; key = ""; }
  };
}
