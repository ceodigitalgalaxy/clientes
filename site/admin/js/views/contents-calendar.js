/* Calendário editorial do painel (aba Conteúdos): mês, semana, dia e quadro.
   - Computador: cada dia mostra os conteúdos como etiquetas coloridas pelo
     alerta de prazo/status, com a bolinha da cor do cliente; dá para
     arrastar a etiqueta para outro dia (quem pode editar) e criar no "+".
   - Celular: o mês vira uma grade compacta com pontinhos; tocar no dia mostra
     a agenda dele logo abaixo. Semana vira uma agenda dia a dia.
   - Quadro (Kanban): colunas pelas etapas de produção; arrastar o cartão muda
     a etapa (no celular, um seletor no cartão faz o mesmo).
   Só monta o HTML; os cliques e o arrastar ficam em contents.js. */

import { esc } from "../../../js/lib/dom.js?v=8083d4a8ab";
import { icon } from "../../../js/lib/icons.js?v=8083d4a8ab";
import { monthGrid, weekDays, weekLabel, monthLabel, longDayLabel, timeLabel, WEEKDAYS_SHORT, addDays, fromISO, toISO } from "../../../js/lib/dates.js?v=8083d4a8ab";
import { typeBadge } from "../../../js/ui/badges.js?v=8083d4a8ab";
import { TONES, alertTone, nearestDeadline, daysFrom } from "../domain/deadlines.js?v=8083d4a8ab";
import { kebab } from "../ui/menu.js?v=8083d4a8ab";
import { PRODUCTION_STATUS } from "../domain/rules.js?v=8083d4a8ab";

export const CAL_MODES = { mes: "Mês", semana: "Semana", dia: "Dia", quadro: "Quadro", lista: "Lista" };
/** Colunas do quadro: "" = ainda não começou */
export const BOARD_COLUMNS = [["", "Não iniciado"], ...Object.entries(PRODUCTION_STATUS).map(([k, v]) => [k, v.label])];
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
 *        canEdit(c), canCreate, canConfigure, limits {soon, urgent}, people(c), stages(c) }
 */
export function renderCalendar(ctx) {
  const byDay = {};
  for (const c of ctx.contents) (byDay[c.scheduled_date] ||= []).push(c);
  Object.values(byDay).forEach((items) => items.sort((a, b) => (a.scheduled_time || "99").localeCompare(b.scheduled_time || "99") || a.title.localeCompare(b.title)));
  const body = ctx.mode === "quadro" ? board(ctx) : ctx.mode === "semana" ? week(ctx, byDay) : ctx.mode === "dia" ? dayView(ctx, byDay) : month(ctx, byDay);
  return `${body}${legend(ctx)}`;
}

const toneOf = (ctx, c) => alertTone(c, ctx.today, ctx.limits);
/** Ver, editar e excluir num menu ⋯ (as mesmas ações da lista) */
const cardMenu = (ctx, c) => kebab([
  { label: "Ver detalhes", icon: "eye", attrs: `data-view-content="${esc(c.id)}"` },
  ctx.canEdit(c) && { label: "Editar", icon: "edit", attrs: `data-edit-content="${esc(c.id)}"` },
  ctx.canDelete && { label: "Excluir", icon: "trash", attrs: `data-delete-content="${esc(c.id)}"`, danger: true }
], `Mais ações: ${c.title}`);
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
      <div class="card-menu">${cardMenu(ctx, c)}</div>
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

/** Rótulos das cores com os limites atuais (o administrador ajusta) */
export function toneLabels(limits) {
  const days = (n) => (n === 0 ? "no dia" : `${n} ${n === 1 ? "dia" : "dias"}`);
  return {
    urgente: { label: "Urgente ou atrasado", hint: `até ${days(limits.urgent)} e não aprovado, ou com o prazo vencido` },
    atencao: { label: `Prazo em até ${days(limits.soon)}`, hint: `até ${days(limits.soon)} e não concluído` },
    cliente: TONES.cliente, producao: TONES.producao, nao_iniciado: TONES.nao_iniciado, concluido: TONES.concluido
  };
}

function legend(ctx) {
  const labels = toneLabels(ctx.limits);
  return `
    <div class="tone-legend-row">
      <ul class="tone-legend" aria-label="O que cada cor quer dizer">
        ${Object.entries(labels).map(([k, t]) => `<li title="${esc(t.hint)}"><span class="tdot tone--${k}" aria-hidden="true"></span>${esc(t.label)}</li>`).join("")}
      </ul>
      ${ctx.canConfigure ? `<button class="link-btn tone-legend__edit" type="button" data-action="alert-settings">${icon("clock")}<span>Ajustar prazos das cores</span></button>` : ""}
    </div>`;
}

/* ---------- Quadro (Kanban) ---------- */
const shortDay = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "—");
function boardCard(ctx, c) {
  const tone = toneOf(ctx, c);
  const editable = ctx.canEdit(c);
  const due = c.due_date ? `<span class="kcard__due" title="Prazo interno">${icon("clock")}${esc(shortDay(c.due_date))}</span>` : "";
  return `
    <article class="kcard tone--${tone}"${editable ? ` draggable="true" data-kdrag="${esc(c.id)}"` : ""} data-kcard="${esc(c.id)}">
      <button class="kcard__open" type="button" data-view-content="${esc(c.id)}" aria-label="Abrir ${esc(c.title)}"></button>
      <div class="card-menu">${cardMenu(ctx, c)}</div>
      <p class="kcard__client"><span class="cli-dot ${cli(ctx, c)}" aria-hidden="true"></span>${esc(ctx.clientName(c.client_id))}</p>
      <p class="kcard__title">${esc(c.title)}</p>
      <p class="kcard__meta">${typeBadge(c.format)}<span class="kcard__date">${icon("calendar")}${esc(shortDay(c.scheduled_date))}${c.scheduled_time ? ` · ${esc(timeLabel(c.scheduled_time.slice(0, 5)))}` : ""}</span>${due}</p>
      <div class="kcard__foot"><span class="tone-pill tone--${tone}">${esc(toneLabels(ctx.limits)[tone].label)}</span>${ctx.people(c)}</div>
      ${editable ? `<label class="kcard__move"><span class="visually-hidden">Etapa de ${esc(c.title)}</span><select class="field__input" data-kmove="${esc(c.id)}">${BOARD_COLUMNS.map(([k, label]) => `<option value="${esc(k)}"${(c.production_status || "") === k ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>` : ""}
    </article>`;
}
function board(ctx) {
  const sorted = [...ctx.contents].sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || "") || (a.scheduled_time || "99").localeCompare(b.scheduled_time || "99"));
  return `
    <div class="kboard" role="list" aria-label="Quadro por etapa de produção">
      ${BOARD_COLUMNS.map(([key, label]) => {
        const items = sorted.filter((c) => (c.production_status || "") === key);
        return `
          <section class="kcol" role="listitem" data-kcol="${esc(key)}" aria-label="${esc(label)}">
            <h3 class="kcol__title">${esc(label)} <span class="kcol__count">${items.length}</span></h3>
            <div class="kcol__items">${items.length ? items.map((c) => boardCard(ctx, c)).join("") : '<p class="kcol__empty">Nada aqui</p>'}</div>
          </section>`;
      }).join("")}
    </div>`;
}

/* ---------- Precisam de atenção ---------- */
/** Os conteúdos atrasados, urgentes e com prazo perto (fora os concluídos), do mais apertado ao mais folgado */
export function attentionItems(contents, today, limits) {
  return contents
    .map((c) => ({ c, tone: alertTone(c, today, limits), n: daysFrom(today, nearestDeadline(c)) }))
    .filter((x) => x.tone === "urgente" || x.tone === "atencao")
    .sort((a, b) => (a.n ?? 99) - (b.n ?? 99) || a.c.title.localeCompare(b.c.title));
}
export function renderAttention(ctx, items, open) {
  if (!items.length) return "";
  const late = items.filter((x) => x.n !== null && x.n < 0).length;
  const urgent = items.filter((x) => x.tone === "urgente").length - late;
  const soon = items.filter((x) => x.tone === "atencao").length;
  const parts = [late && `<b class="att__n att__n--late">${late}</b> ${late === 1 ? "atrasada" : "atrasadas"}`, urgent && `<b class="att__n att__n--urgent">${urgent}</b> ${urgent === 1 ? "urgente" : "urgentes"}`, soon && `<b class="att__n att__n--soon">${soon}</b> com prazo perto`].filter(Boolean);
  const when = (n) => (n === null ? "" : n < 0 ? `Atrasado ${-n} ${-n === 1 ? "dia" : "dias"}` : n === 0 ? "Vence hoje" : n === 1 ? "Vence amanhã" : `Vence em ${n} dias`);
  return `
    <div class="att${open ? " is-open" : ""}">
      <button class="att__bar" type="button" data-action="toggle-attention" aria-expanded="${open}">
        ${icon("bell")}<span class="att__title">Precisam de atenção</span><span class="att__parts">${parts.join('<span class="att__sep">·</span>')}</span><span class="att__chev">${icon("chevronRight")}</span>
      </button>
      ${open ? `<ul class="att__list">${items.slice(0, 12).map(({ c, tone, n }) => `
        <li class="att__item tone--${tone}">
          <button type="button" class="att__open" data-view-content="${esc(c.id)}">
            <span class="att__when">${esc(when(n))}</span>
            <span class="att__name">${esc(c.title)}</span>
            <span class="att__client"><span class="cli-dot ${cli(ctx, c)}" aria-hidden="true"></span>${esc(ctx.clientName(c.client_id))}</span>
          </button>
          ${ctx.people(c)}
        </li>`).join("")}${items.length > 12 ? `<li class="att__more">e mais ${items.length - 12}</li>` : ""}</ul>` : ""}
    </div>`;
}
