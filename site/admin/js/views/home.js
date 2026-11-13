/* Início: o centro de controle do painel.
   - Indicadores no topo (atrasadas, vencem logo, com o cliente, em produção,
     publicados no mês); cada um leva para onde se resolve.
   - Precisam de atenção, minhas demandas, próximas publicações e atividade
     recente, em cartões compactos (clicar abre o conteúdo).
   Tudo vem do banco já recortado pelas permissões (cada um vê os clientes dele). */

import { $, esc, on } from "../../../js/lib/dom.js?v=75a584518a";
import { icon } from "../../../js/lib/icons.js?v=75a584518a";
import { todayISO, addDays, longDayLabel, monthLabel, stampLabel, timeLabel } from "../../../js/lib/dates.js?v=75a584518a";
import { alertTone, nearestDeadline, daysFrom } from "../domain/deadlines.js?v=75a584518a";
import { stateBlock } from "../ui/states.js?v=75a584518a";
import { avatars, eventText } from "./contents.js?v=75a584518a";
import { toneLabels, attentionItems } from "./contents-calendar.js?v=75a584518a";

const WITH_CLIENT = ["aguardando_aprovacao", "reenviado"];
const DONE = ["agendado", "publicado"];
const shortDay = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const whenLabel = (n) => (n === null ? "Sem data" : n < 0 ? `Atrasado ${-n} ${-n === 1 ? "dia" : "dias"}` : n === 0 ? "Hoje" : n === 1 ? "Amanhã" : `Em ${n} dias`);

export function setupHome({ api, state, navigate, openContent, openForm, focusContents }) {
  const root = $("#home");
  let rows = [];
  let events = [];

  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente";
  const clientDot = (id) => `cli-${[...String(id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 8}`;
  const people = (c) => ((c.assignees || []).length ? avatars(state.team, c.assignees) : "");

  /** Cartão compacto: faixa da cor do alerta, título, cliente, quando e quem */
  function item(c, { when, tone }) {
    return `
      <li class="hitem tone--${tone}">
        <button class="hitem__open" type="button" data-open-home="${esc(c.id)}">
          <span class="hitem__when">${esc(when)}</span>
          <span class="hitem__title">${esc(c.title)}</span>
          <span class="hitem__client"><span class="cli-dot ${clientDot(c.client_id)}" aria-hidden="true"></span>${esc(clientName(c.client_id))}</span>
        </button>
        ${people(c)}
      </li>`;
  }
  const card = (id, title, iconName, body, action = "") => `
    <section class="hcard" aria-labelledby="${id}">
      <header class="hcard__head"><h2 class="hcard__title" id="${id}">${icon(iconName)}${esc(title)}</h2>${action}</header>
      ${body}
    </section>`;
  const empty = (text) => `<p class="hcard__empty">${esc(text)}</p>`;

  function render() {
    const today = todayISO();
    const month = today.slice(0, 7);
    const limits = state.alerts;
    const labels = toneLabels(limits);
    const open = rows.filter((c) => !DONE.includes(c.production_status));
    const toneOf = (c) => alertTone(c, today, limits);
    const att = attentionItems(rows, today, limits);
    const late = att.filter((x) => x.n !== null && x.n < 0).length;
    const soon = att.length - late;
    const withClient = rows.filter((c) => WITH_CLIENT.includes(c.approval_status) || WITH_CLIENT.includes(c.final_status)).length;
    const producing = rows.filter((c) => c.production_status === "em_producao").length;
    const published = rows.filter((c) => c.production_status === "publicado" && (c.scheduled_date || "").startsWith(month)).length;
    const me = state.me?.user_id;
    const mine = open.filter((c) => (c.assignees || []).includes(me))
      .map((c) => ({ c, n: daysFrom(today, nearestDeadline(c)) }))
      .sort((a, b) => (a.n ?? 999) - (b.n ?? 999)).slice(0, 6);
    const next = rows.filter((c) => c.scheduled_date >= today && c.scheduled_date <= addDays(today, 7) && c.production_status !== "publicado")
      .sort((a, b) => (a.scheduled_date + (a.scheduled_time || "99")).localeCompare(b.scheduled_date + (b.scheduled_time || "99"))).slice(0, 6);

    const kpi = (key, n, label, tone, hint) => `
      <li><button class="kpi kpi--${tone}${n ? "" : " is-zero"}" type="button" data-home-go="${key}">
        <span class="kpi__n">${n}</span><span class="kpi__label">${esc(label)}</span><span class="kpi__hint">${esc(hint)}</span>
      </button></li>`;
    root.innerHTML = `
      <ul class="kpis" aria-label="Resumo">
        ${kpi("atencao", late, late === 1 ? "Atrasada" : "Atrasadas", "late", "prazo vencido")}
        ${kpi("atencao", soon, "Vencem logo", "soon", labels.atencao.label.toLowerCase())}
        ${kpi(state.can.send ? "aprovacoes" : "mes", withClient, "Com o cliente", "client", "aguardando aprovação")}
        ${kpi("quadro", producing, "Em produção", "prod", "a equipe está fazendo")}
        ${kpi("mes", published, "Publicados", "done", monthLabel(month).toLowerCase())}
      </ul>
      <div class="home-grid">
        ${card("h-att", "Precisam de atenção", "bell",
          att.length ? `<ul class="hlist">${att.slice(0, 6).map(({ c, n, tone }) => item(c, { when: whenLabel(n), tone })).join("")}</ul>` : empty("Nada atrasado nem vencendo logo. Tudo em dia."),
          att.length > 6 ? `<button class="link-btn" type="button" data-home-go="atencao">Ver todas (${att.length})</button>` : "")}
        ${card("h-mine", "Minhas demandas", "list",
          mine.length ? `<ul class="hlist">${mine.map(({ c, n }) => item(c, { when: c.due_date || c.scheduled_date ? `${whenLabel(n)} · ${shortDay(nearestDeadline(c))}` : "Sem data", tone: toneOf(c) })).join("")}</ul>` : empty("Nenhuma demanda com você agora."),
          `<a class="link-btn" href="#/demandas">Ver todas</a>`)}
        ${card("h-next", "Próximas publicações", "calendar",
          next.length ? `<ul class="hlist">${next.map((c) => item(c, { when: `${c.scheduled_date === today ? "Hoje" : shortDay(c.scheduled_date)}${c.scheduled_time ? ` · ${timeLabel(c.scheduled_time.slice(0, 5))}` : ""}`, tone: toneOf(c) })).join("")}</ul>` : empty("Nada programado para os próximos 7 dias."),
          `<button class="link-btn" type="button" data-home-go="semana">Ver a semana</button>`)}
        ${card("h-activity", "Atividade recente", "refresh",
          events.length ? `<ul class="hfeed">${events.map((e) => `
            <li><button class="hfeed__item" type="button" data-open-home="${esc(e.content_id)}">
              <span class="hfeed__text"><b>${esc(e.actor_name || "Alguém")}</b> · ${esc(eventText(e))}</span>
              <span class="hfeed__meta">${esc(e.contents?.title || "")} · ${esc(stampLabel(e.created_at))}</span>
            </button></li>`).join("")}</ul>` : empty("Ainda sem movimento por aqui."))}
      </div>`;
  }

  async function load() {
    const name = firstName(state.me?.name);
    $("#inicio-title").textContent = name ? `Olá, ${name}` : "Início";
    $("#inicio-date").textContent = longDayLabel(todayISO());
    root.setAttribute("aria-busy", "true");
    if (!rows.length) root.innerHTML = `<ul class="kpis kpis--loading">${'<li><span class="kpi skeleton"></span></li>'.repeat(5)}</ul>`;
    const today = todayISO();
    const from = [addDays(today, -90), `${today.slice(0, 7)}-01`].sort()[0];
    try {
      const [list, recent] = await Promise.all([api.listContents({ from, to: addDays(today, 31) }), api.recentEvents(8).catch(() => [])]);
      rows = list;
      events = recent;
      render();
    } catch (error) {
      root.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar o início", text: error.message });
    } finally { root.setAttribute("aria-busy", "false"); }
  }

  on(root, "click", "[data-open-home]", (event, b) => openContent(b.dataset.openHome));
  on(root, "click", "[data-home-go]", (event, b) => {
    const go = b.dataset.homeGo;
    if (go === "aprovacoes") { navigate("aprovacoes"); return; }
    focusContents({ mode: go === "atencao" ? null : go, attention: go === "atencao" });
  });
  on(document, "click", '[data-action="home-new-content"]', () => openForm());
  document.addEventListener("content-saved", () => { if (state.route === "inicio") load(); });

  return { load, reset() { rows = []; events = []; } };
}
