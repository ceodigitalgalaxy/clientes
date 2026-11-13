/* Calendário editorial do painel (aba Conteúdos): mês, semana e dia.
   - Computador: cada dia mostra os conteúdos como etiquetas coloridas pelo
     alerta de prazo/status, com a bolinha da cor do cliente; dá para
     arrastar a etiqueta para outro dia (quem pode editar) e criar no "+".
   - Celular: o mês vira uma grade compacta com pontinhos; tocar no dia mostra
     a agenda dele logo abaixo. Semana vira uma agenda dia a dia.
   Só monta o HTML; os cliques e o arrastar ficam em contents.js. */

import { esc } from "../../../js/lib/dom.js?v=b28509c2bb";
import { icon } from "../../../js/lib/icons.js?v=b28509c2bb";
import { monthGrid, weekDays, weekLabel, monthLabel, longDayLabel, timeLabel, WEEKDAYS_SHORT, addDays, fromISO, toISO } from "../../../js/lib/dates.js?v=b28509c2bb";
import { typeBadge } from "../../../js/ui/badges.js?v=b28509c2bb";
import { TONES, alertTone } from "../domain/deadlines.js?v=b28509c2bb";

export const CAL_MODES = { mes: "Mês", semana: "Semana", dia: "Dia", lista: "Lista" };
const MAX_CHIPS = 3;
const CLIENT_COLORS = 8;

/** Primeiro e último dia mostrados (para buscar só o que aparece) */
export function calendarRange(mode, cursor) {
  if (mode === "semana") { const days = weekDays(cursor); return { from: days[0].iso, to: days[6].iso }; }
  if (mode === "dia") return { from: cursor, to: cursor };
  const grid = monthGrid(cursor.slice(0, 7));
  return { from: grid[0].iso, to: grid.at(-1).iso };
}

/** Anda um mês, uma semana ou um dia */
export function stepCursor(mode, cursor, delta) {
  if (mode === "semana") return addDays(cursor, 7 * delta);
  if (mode === "dia") return addDays(cursor, delta);
  const d = fromISO(`${cursor.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + delta);
  return toISO(d);
}

export function calendarTitle(mode, cursor) {
  if (mode === "semana") return weekLabel(cursor);
  if (mode === "dia") return longDayLabel(cursor);
  return monthLabel(cursor.slice(0, 7));
}

/**
 * ctx: { contents, mode, cursor, selected, today, clientIndex(id), clientName(id),
 *        canEdit(c), canCreate, people(c) (avatares), stages(c) (etiquetas de etapa) }
 */
export function renderCalendar(ctx) {
  const byDay = {};
  for (const c of ctx.contents) (byDay[c.scheduled_date] ||= []).push(c);
  Object.values(byDay).forEach((items) => items.sort((a, b) => (a.scheduled_time || "99").localeCompare(b.scheduled_time || "99") || a.title.localeCompare(b.title)));
  const body = ctx.mode === "semana" ? week(ctx, byDay) : ctx.mode === "dia" ? dayView(ctx, byDay) : month(ctx, byDay);
  return `${body}${legend()}`;
}

const toneOf = (ctx, c) => alertTone(c, ctx.today);
const cli = (ctx, c) => `cli-${ctx.clientIndex(c.client_id) % CLIENT_COLORS}`;

function chip(ctx, c, { detailed = false } = {}) {
  const tone = toneOf(ctx, c);
  const drag = ctx.canEdit(c) ? ` draggable="true" data-drag="${esc(c.id)}"` : "";
  const label = `${c.title} · ${ctx.clientName(c.client_id)}${c.scheduled_time ? ` · ${timeLabel(c.scheduled_time.slice(0, 5))}` : ""} · ${TONES[tone].label}`;
  return `
    <li>
      <button class="acal-item tone--${tone}${detailed ? " acal-item--detailed" : ""}" type="button" data-view-content="${esc(c.id)}"${drag} title="${esc(label)}" aria-label="${esc(label)}">
        <span class="acal-item__line"><span class="cli-dot ${cli(ctx, c)}" aria-hidden="true"></span>${c.scheduled_time ? `<span class="acal-item__time">${esc(timeLabel(c.scheduled_time.slice(0, 5)))}</span>` : ""}<span class="acal-item__title">${esc(c.title)}</span></span>
        ${detailed ? `<span class="acal-item__client">${esc(ctx.clientName(c.client_id))}</span><span class="acal-item__meta">${typeBadge(c.format)}${ctx.people(c)}</span>` : ""}
      </button>
    </li>`;
}

/** Cartão da agenda (dia, semana no celular e o dia tocado no mês do celular) */
function agendaCard(ctx, c) {
  const tone = toneOf(ctx, c);
  return `
    <article class="agenda-card tone--${tone}">
      <button class="agenda-card__open" type="button" data-view-content="${esc(c.id)}" aria-label="Abrir ${esc(c.title)}"></button>
      <div class="agenda-card__time">${c.scheduled_time ? esc(timeLabel(c.scheduled_time.slice(0, 5))) : "—"}</div>
      <div class="agenda-card__main">
        <p class="agenda-card__client"><span class="cli-dot ${cli(ctx, c)}" aria-hidden="true"></span>${esc(ctx.clientName(c.client_id))}</p>
        <p class="agenda-card__title">${esc(c.title)}</p>
        <p class="agenda-card__meta">${typeBadge(c.format)}<span class="tone-pill tone--${tone}">${esc(TONES[tone].label)}</span>${ctx.people(c)}</p>
        <p class="agenda-card__stages">${ctx.stages(c)}</p>
      </div>
    </article>`;
}

function agendaList(ctx, items, iso) {
  const add = ctx.canCreate ? `<button class="btn btn--ghost btn--sm agenda__add" type="button" data-cal-new="${esc(iso)}">${icon("sparkle")}<span>Novo conteúdo neste dia</span></button>` : "";
  if (!items?.length) return `<p class="agenda__empty">Nada programado para este dia.</p>${add}`;
  return `<div class="agenda__items">${items.map((c) => agendaCard(ctx, c)).join("")}</div>${add}`;
}

function cellClasses(ctx, day, items) {
  return ["acal__cell", day.inMonth ? "" : "is-out", day.iso === ctx.today ? "is-today" : "", day.iso === ctx.selected ? "is-selected" : "", items?.length ? "has-items" : "", day.weekday === 0 || day.weekday === 6 ? "is-weekend" : ""].filter(Boolean).join(" ");
}

function dayHead(ctx, day, items, { long = false } = {}) {
  const n = items?.length || 0;
  const label = `${longDayLabel(day.iso)}${day.iso === ctx.today ? " (hoje)" : ""}, ${n ? `${n} ${n === 1 ? "conteúdo" : "conteúdos"}` : "nada programado"}`;
  return `
    <div class="acal__dayhead">
      <button class="acal__date" type="button" data-cal-select="${day.iso}" aria-label="${esc(label)}"${day.iso === ctx.selected ? ' aria-pressed="true"' : ""}>
        ${long ? `<span class="acal__wd">${WEEKDAYS_SHORT[day.weekday]}</span>` : ""}<span class="acal__num">${day.day}</span>
      </button>
      ${ctx.canCreate ? `<button class="acal__add" type="button" data-cal-new="${day.iso}" aria-label="Novo conteúdo em ${esc(longDayLabel(day.iso))}" title="Novo conteúdo neste dia">${icon("sparkle")}</button>` : ""}
    </div>`;
}

function month(ctx, byDay) {
  const grid = monthGrid(ctx.cursor.slice(0, 7));
  const cells = grid.map((day) => {
    const items = byDay[day.iso] || [];
    const more = items.length - MAX_CHIPS;
    const dots = items.slice(0, 4).map((c) => `<span class="tdot tone--${toneOf(ctx, c)}"></span>`).join("");
    return `
      <div class="${cellClasses(ctx, day, items)}" data-cal-day="${day.iso}">
        ${dayHead(ctx, day, items)}
        ${items.length ? `<ul class="acal__items">${items.slice(0, MAX_CHIPS).map((c) => chip(ctx, c)).join("")}</ul>` : ""}
        ${more > 0 ? `<button class="acal__more" type="button" data-cal-day-open="${day.iso}">+${more} ${more === 1 ? "conteúdo" : "conteúdos"}</button>` : ""}
        ${items.length ? `<span class="acal__dots" aria-hidden="true">${dots}${items.length > 4 ? '<span class="tdot tdot--more"></span>' : ""}</span>` : ""}
      </div>`;
  }).join("");
  const sel = ctx.selected && grid.some((d) => d.iso === ctx.selected) ? ctx.selected : null;
  return `
    <div class="acal acal--month">
      <div class="acal__weekdays" aria-hidden="true">${WEEKDAYS_SHORT.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="acal__grid">${cells}</div>
    </div>
    ${sel ? `<section class="agenda agenda--picked" aria-live="polite" aria-label="Conteúdos do dia escolhido">
      <h3 class="agenda__title">${esc(longDayLabel(sel))}${sel === ctx.today ? " · hoje" : ""}</h3>
      ${agendaList(ctx, byDay[sel], sel)}
    </section>` : ""}`;
}

function week(ctx, byDay) {
  const days = weekDays(ctx.cursor);
  return `
    <div class="acal acal--week">
      ${days.map((day) => {
        const items = byDay[day.iso] || [];
        return `
          <div class="${cellClasses(ctx, day, items)}" data-cal-day="${day.iso}">
            ${dayHead(ctx, day, items, { long: true })}
            ${items.length ? `<ul class="acal__items">${items.map((c) => chip(ctx, c, { detailed: true })).join("")}</ul>` : '<p class="acal__none">—</p>'}
          </div>`;
      }).join("")}
    </div>`;
}

function dayView(ctx, byDay) {
  return `<section class="agenda agenda--day" data-cal-day="${esc(ctx.cursor)}" aria-label="Conteúdos do dia">${agendaList(ctx, byDay[ctx.cursor], ctx.cursor)}</section>`;
}

function legend() {
  return `
    <ul class="tone-legend" aria-label="O que cada cor quer dizer">
      ${Object.entries(TONES).map(([k, t]) => `<li title="${esc(t.hint)}"><span class="tdot tone--${k}" aria-hidden="true"></span>${esc(t.label)}</li>`).join("")}
    </ul>`;
}
