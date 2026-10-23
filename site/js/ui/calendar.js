/* ==========================================================================
   Calendário (o centro do portal): visão do mês ou da semana
   - Desktop: cada dia mostra as atividades como etiquetas; passar o mouse
     (ou focar a data pelo teclado) abre o resumo do dia num popover.
   - Celular: cada dia mostra pontinhos coloridos; tocar no dia abre a
     agenda do dia logo abaixo do calendário.
   - Clicar numa atividade abre o painel lateral com os detalhes.
   - Semana: os mesmos cartões de dia, mais altos e com todas as atividades.
   ========================================================================== */

import { esc, on, canHover } from "../lib/dom.js?v=0470164d89";
import { icon } from "../lib/icons.js?v=0470164d89";
import { monthGrid, weekDays, WEEKDAYS_SHORT, todayISO, timeLabel, dayLabel, longDayLabel } from "../lib/dates.js?v=0470164d89";
import { ACTIVITY_TYPES, STATUS } from "../domain/model.js?v=0470164d89";
import { statusOf } from "../domain/status.js?v=0470164d89";
import { typeBadge, statusBadge, statusMark } from "./badges.js?v=0470164d89";
import { cover } from "./highlights.js?v=0470164d89";
import { coverHtml } from "./media.js?v=0470164d89";

const MAX_CHIPS = 3;
const DAY_STATUS_ORDER = ["aguardando", "ajustes", "aprovado", "publicado"];

/** Agrupa as atividades por dia */
const byDay = (activities) => activities.reduce((map, a) => { (map[a.date] ||= []).push(a); return map; }, {});

const countLabel = (n) => (n === 1 ? "1 atividade" : `${n} atividades`);

function chip(activity, approvals) {
  const t = ACTIVITY_TYPES[activity.type] || ACTIVITY_TYPES.outro;
  const status = statusOf(activity, approvals);
  return `
    <li>
      <button class="chip type--${esc(activity.type)}" type="button" data-activity="${esc(activity.id)}"
        aria-label="${esc(`${t.label}: ${activity.title}${activity.time ? `, ${timeLabel(activity.time)}` : ""}${status ? `. ${STATUS[status].label}` : ""}`)}">
        <span class="chip__top">${icon(t.icon, "icon chip__icon")}<span class="chip__meta">${activity.time ? timeLabel(activity.time) : esc(t.short)}</span>${statusMark(status)}</span><span class="chip__title">${esc(activity.title)}</span>
      </button>
    </li>`;
}

function cell(day, items, approvals, selected, maxChips = MAX_CHIPS) {
  const today = day.iso === todayISO();
  const statuses = items.map((a) => statusOf(a, approvals));
  const pending = statuses.filter((st) => st === "aguardando").length;
  // O dia todo pega a cor do status; com vários, vale o que pede ação primeiro
  const dayStatus = DAY_STATUS_ORDER.find((st) => statuses.includes(st));
  const classes = ["cal__cell", day.inMonth ? "" : "is-out", today ? "is-today" : "", items.length ? "has-items" : "", dayStatus ? `day--${dayStatus}` : "", day.iso === selected ? "is-selected" : "", day.weekday === 0 || day.weekday === 6 ? "is-weekend" : ""].filter(Boolean).join(" ");
  const shown = items.slice(0, maxChips);
  const more = items.length - shown.length;
  const label = `${longDayLabel(day.iso)}${today ? " (hoje)" : ""}${items.length ? `, ${countLabel(items.length)}` : ", sem atividades"}${pending ? `, ${pending} para aprovar` : ""}`;
  const dots = items.slice(0, 4).map((a) => `<span class="dot type--${esc(a.type)}"></span>`).join("");
  return `
    <div class="${classes}" data-day="${day.iso}">
      <button class="cal__date" type="button" data-select="${day.iso}" aria-label="${esc(label)}"${day.iso === selected ? ' aria-pressed="true"' : ""}>
        <span class="cal__num">${day.day}</span>
      </button>
      ${items.length ? `<ul class="cal__items">${shown.map((a) => chip(a, approvals)).join("")}</ul>` : ""}
      ${more > 0 ? `<button class="cal__more" type="button" data-select="${day.iso}" tabindex="-1" aria-hidden="true">+${more} ${more === 1 ? "atividade" : "atividades"}</button>` : ""}
      ${items.length ? `<span class="cal__dots" aria-hidden="true">${dots}${items.length > 4 ? '<span class="dot dot--more"></span>' : ""}</span>` : ""}
    </div>`;
}

export function renderLegend(container, activities, statusKeys = ["aguardando", "aprovado", "ajustes"]) {
  const present = Object.keys(ACTIVITY_TYPES).filter((type) => activities.some((a) => a.type === type));
  const types = present.map((type) => `<li>${typeBadge(type)}</li>`).join("");
  const statuses = statusKeys.map((s) => `<li class="legend__status">${statusMark(s)}<span>${STATUS[s].short}</span></li>`).join("");
  container.innerHTML = types + (present.length ? `<li class="legend__sep" aria-hidden="true"></li>${statuses}` : "");
}

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {"month"|"week"} [options.view]  semana: a que contém options.selected
 * @param {boolean} [options.live]        dados reais (textos do estado vazio)
 * @param {boolean} [options.canSuggest]  mostra o botão "Compartilhar uma ideia"
 */
export function renderCalendar(container, { month, activities, approvals, selected, hasPlan, view = "month", live = false, canSuggest = true }) {
  const days = byDay(activities);
  const week = view === "week";
  const grid = week ? weekDays(selected) : monthGrid(month);
  const empty = !activities.length;
  const ideaButton = canSuggest ? `<button class="btn btn--ghost btn--sm" type="button" data-action="new-idea">${icon("sparkle")}Compartilhar uma ideia</button>` : "";
  const emptyTitle = week ? "Nada programado nesta semana"
    : live ? "Ainda não há conteúdos liberados para este mês"
    : hasPlan ? "Os conteúdos deste mês estão a caminho" : "Ainda não há planejamento para este mês";
  const emptyText = live
    ? "Quando a nossa equipe liberar um conteúdo para você conferir, ele aparece aqui."
    : "Quando a nossa equipe compartilhar, eles aparecem aqui. Enquanto isso, que tal mandar uma ideia?";
  container.innerHTML = `
    <div class="cal${week ? " cal--week" : ""}${empty ? " is-empty" : ""}">
      <div class="cal__head" aria-hidden="true">${WEEKDAYS_SHORT.map((d, i) => `<span class="${i === 0 || i === 6 ? "is-weekend" : ""}">${d}</span>`).join("")}</div>
      <div class="cal__grid">${grid.map((day) => cell(day, day.inMonth ? days[day.iso] || [] : [], approvals, selected, week ? Infinity : MAX_CHIPS)).join("")}</div>
      ${empty && week ? `<p class="cal__week-empty">${icon("calendar")}${esc(emptyTitle)}</p>` : ""}
      ${empty && !week ? `
        <div class="cal__empty">
          <span class="cal__empty-icon">${icon("calendar")}</span>
          <p class="cal__empty-title">${esc(emptyTitle)}</p>
          <p class="cal__empty-text">${esc(emptyText)}</p>
          ${ideaButton}
        </div>` : ""}
    </div>`;
}

/** Agenda do dia (aparece no celular, abaixo do calendário) */
export function renderAgenda(container, { selected, month, activities, approvals, view = "month" }) {
  if (!selected || (view === "month" && !selected.startsWith(month))) { container.innerHTML = ""; return; }
  const items = activities.filter((a) => a.date === selected);
  // Dia vazio: aponta o próximo dia com conteúdo (ou o anterior, se não houver)
  const later = activities.filter((a) => a.date > selected).sort((a, b) => a.date.localeCompare(b.date))[0];
  const earlier = activities.filter((a) => a.date < selected).sort((a, b) => b.date.localeCompare(a.date))[0];
  const jump = later || earlier;
  container.innerHTML = `
    <h3 class="agenda__title">${esc(longDayLabel(selected))}${items.length ? `<span class="agenda__count">${countLabel(items.length).replace("atividade", "conteúdo")}</span>` : ""}</h3>
    ${items.length ? `<ul class="agenda__list">${items.map((a) => {
      const art = cover(a);
      const t = ACTIVITY_TYPES[a.type] || ACTIVITY_TYPES.outro;
      return `
      <li>
        <button class="agenda__item${statusOf(a, approvals) === "aguardando" ? " is-pending" : ""}" type="button" data-activity="${esc(a.id)}">
          <span class="agenda__thumb type--${esc(a.type)}">${icon(t.icon)}${coverHtml(art, "data-agenda-img")}${art?.play ? `<span class="play-badge play-badge--sm">${icon("play")}</span>` : ""}</span>
          <span class="agenda__body">
            <span class="agenda__meta">${a.time ? timeLabel(a.time) : "Sem horário"} · ${esc(t.short)}</span>
            <span class="agenda__name">${esc(a.title)}</span>
            ${statusBadge(statusOf(a, approvals))}
          </span>
          ${icon("chevronRight", "icon agenda__go")}
        </button>
      </li>`;
    }).join("")}</ul>`
    : `<div class="agenda__empty">
        <p>Nada programado para este dia.</p>
        ${jump ? `<button class="btn btn--ghost btn--sm" type="button" data-agenda-go="${esc(jump.date)}">${icon(later ? "arrowRight" : "chevronLeft")}${later ? "Próximo" : "Último"}: ${esc(dayLabel(jump.date))}</button>` : ""}
      </div>`}`;
  // Imagem que não abre: fica o ícone
  container.querySelectorAll("[data-agenda-img]").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
}

/* ---------- Popover do dia (só com mouse) ---------- */
export function setupDayPopover({ calendar, popover, getState, onOpenActivity }) {
  let hideTimer = 0;
  let currentDay = null;

  const hide = () => {
    clearTimeout(hideTimer);
    popover.classList.remove("is-visible");
    popover.hidden = true;
    currentDay = null;
  };
  const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 160); };

  const show = (cellEl) => {
    clearTimeout(hideTimer);
    const iso = cellEl.dataset.day;
    if (iso === currentDay && !popover.hidden) return;
    const { activities, approvals } = getState();
    const items = activities.filter((a) => a.date === iso);
    if (!items.length) { hide(); return; }
    currentDay = iso;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", `Resumo de ${dayLabel(iso)}`);
    popover.innerHTML = `
      <p class="popover__date">${esc(longDayLabel(iso))}</p>
      <ul class="popover__list">${items.map((a) => {
        const t = ACTIVITY_TYPES[a.type] || ACTIVITY_TYPES.outro;
        const status = statusOf(a, approvals);
        return `
        <li>
          <button class="popover__item" type="button" data-activity="${esc(a.id)}">
            <span class="popover__bar type--${esc(a.type)}"></span>
            <span class="popover__main">
              <span class="popover__meta">${a.time ? `${timeLabel(a.time)} · ` : ""}${esc(t.label)}</span>
              <span class="popover__name">${esc(a.title)}</span>
            </span>
            ${status ? statusBadge(status, false) : ""}
          </button>
        </li>`;
      }).join("")}</ul>
      <p class="popover__hint">Clique em um conteúdo para ver os detalhes</p>`;
    popover.hidden = false;
    position(cellEl);
    requestAnimationFrame(() => popover.classList.add("is-visible"));
  };

  const position = (cellEl) => {
    const rect = cellEl.getBoundingClientRect();
    const pop = popover.getBoundingClientRect();
    const gap = 8;
    let left = rect.right + gap;
    if (left + pop.width > window.innerWidth - 16) left = rect.left - pop.width - gap;
    if (left < 16) left = Math.max(16, rect.left + rect.width / 2 - pop.width / 2);
    let top = rect.top;
    top = Math.min(top, window.innerHeight - pop.height - 16);
    top = Math.max(16, top);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  };

  calendar.addEventListener("pointerover", (event) => {
    // Só com mouse: no toque o resumo flutuante atrapalharia (o celular usa a agenda)
    if (!canHover() || event.pointerType !== "mouse") return;
    const cellEl = event.target.closest(".cal__cell.has-items");
    if (cellEl) show(cellEl);
    else scheduleHide();
  });
  calendar.addEventListener("pointerleave", scheduleHide);
  popover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  popover.addEventListener("pointerleave", scheduleHide);
  // Teclado: focar a data mostra o mesmo resumo (não depois de um toque na tela)
  let lastTouch = 0;
  document.addEventListener("pointerdown", (event) => { if (event.pointerType !== "mouse") lastTouch = Date.now(); }, true);
  calendar.addEventListener("focusin", (event) => {
    const date = event.target.closest(".cal__date");
    if (date && canHover() && Date.now() - lastTouch > 1500) show(date.closest(".cal__cell"));
  });
  calendar.addEventListener("focusout", (event) => {
    if (!popover.contains(event.relatedTarget)) scheduleHide();
  });
  popover.addEventListener("focusout", (event) => {
    if (!popover.contains(event.relatedTarget)) scheduleHide();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !popover.hidden) hide(); });
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide);

  on(popover, "click", "[data-activity]", (event, button) => { hide(); onOpenActivity(button.dataset.activity); });

  return { hide };
}
