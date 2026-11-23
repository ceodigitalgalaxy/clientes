/* Início: o centro de controle do painel.
   - Indicadores no topo (atrasadas, vencem logo, com o cliente, em produção,
     publicados no mês); cada um leva para onde se resolve.
   - Precisam de atenção, minhas demandas, próximas publicações e atividade
     recente, em cartões compactos (clicar abre o conteúdo).
   Tudo vem do banco já recortado pelas permissões (cada um vê os clientes dele). */

import { $, esc, on } from "../../../js/lib/dom.js?v=282cf0daa2";
import { icon } from "../../../js/lib/icons.js?v=282cf0daa2";
import { todayISO, addDays, longDayLabel, monthLabel, stampLabel, timeLabel } from "../../../js/lib/dates.js?v=282cf0daa2";
import { alertTone, nearestDeadline, daysFrom } from "../domain/deadlines.js?v=282cf0daa2";
import { stateBlock } from "../ui/states.js?v=282cf0daa2";
import { avatars, eventText, clientDotClass } from "./contents.js?v=282cf0daa2";
import { toneLabels, attentionItems } from "./contents-calendar.js?v=282cf0daa2";
import { dueParts, dueState } from "../domain/tasks.js?v=282cf0daa2";

const WITH_CLIENT = ["aguardando_aprovacao", "reenviado"];
const DONE = ["agendado", "publicado"];
const shortDay = (iso) => (iso ? iso.split("-").reverse().slice(0, 2).join("/") : "");
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const whenLabel = (n) => (n === null ? "Sem data" : n < 0 ? `Atrasado ${-n} ${-n === 1 ? "dia" : "dias"}` : n === 0 ? "Hoje" : n === 1 ? "Amanhã" : `Em ${n} dias`);

export function setupHome({ api, state, navigate, openContent, openTask, openForm, focusContents }) {
  const root = $("#home");
  let rows = [];
  let events = [];
  let boardTasks = [];

  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente";
  const clientDot = (id) => clientDotClass(state.clients, id);
  const people = (c) => ((c.assignees || []).length ? avatars(state.team, c.assignees) : "");

  /** Cartão compacto: faixa da cor do alerta, título, cliente, quando e quem */
  function item(c, { when, tone, task = false }) {
    return `
      <li class="hitem tone--${tone}">
        <button class="hitem__open" type="button" ${task ? "data-open-home-task" : "data-open-home"}="${esc(c.id)}">
          <span class="hitem__when">${esc(when)}</span>
          <span class="hitem__title">${esc(c.title)}</span>
          <span class="hitem__client"><span class="cli-dot ${clientDot(c.client_id)}" aria-hidden="true"></span>${esc(c.client_id ? clientName(c.client_id) : "Interno da agência")}</span>
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
    // Minhas: conteúdos e demandas do quadro (inclusive subtarefas) que estão comigo, do prazo mais apertado
    const TONE = { late: "urgente", today: "urgente", soon: "atencao", ok: "producao", done: "concluido" };
    const linked = new Set(boardTasks.filter((t) => t.content_id && !t.parent_id && (t.task_assignees || []).some((a) => a.user_id === me)).map((t) => t.content_id));
    const mineContents = open.filter((c) => (c.assignees || []).includes(me) && !linked.has(c.id)).map((c) => {
      const n = daysFrom(today, nearestDeadline(c));
      return { id: c.id, key: `${nearestDeadline(c) || "9999"}`, html: () => item(c, { when: c.due_date || c.scheduled_date ? `${whenLabel(n)} · ${shortDay(nearestDeadline(c))}` : "Sem data", tone: toneOf(c) }) };
    });
    const mineTasks = boardTasks.filter((t) => t.status !== "concluido" && (t.task_assignees || []).some((a) => a.user_id === me)).map((t) => {
      const due = dueState(t.due_at, t.status);
      const { date, time } = dueParts(t.due_at);
      return { id: t.content_id || t.id, key: `${date || "9999"}T${time}`, html: () => item({ ...t, assignees: (t.task_assignees || []).map((a) => a.user_id) }, { task: true, when: due ? `${due.label} · ${timeLabel(time)}` : "Sem data", tone: due ? TONE[due.tone] : "nao_iniciado" }) };
    });
    const mine = [...mineTasks, ...mineContents].sort((a, b) => a.key.localeCompare(b.key)).slice(0, 6);
    const shown = new Set(mine.map((x) => x.id));
    const attOthers = att.filter(({ c }) => !shown.has(c.id));
    const next = rows.filter((c) => c.scheduled_date >= today && c.scheduled_date <= addDays(today, 7) && c.production_status !== "publicado")
      .sort((a, b) => (a.scheduled_date + (a.scheduled_time || "99")).localeCompare(b.scheduled_date + (b.scheduled_time || "99"))).slice(0, 5);

    const kpi = (key, n, label, tone, hint) => `
      <li><button class="kpi kpi--${tone}${n ? "" : " is-zero"}" type="button" data-home-go="${key}" title="${esc(hint)}">
        <span class="kpi__n">${n}</span><span class="kpi__label">${esc(label)}</span><span class="visually-hidden"> (${esc(hint)})</span>
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
        ${card("h-mine", "Minhas demandas", "list",
          mine.length ? `<ul class="hlist">${mine.map((x) => x.html()).join("")}</ul>` : empty("Nenhuma demanda com você agora."),
          `<a class="link-btn" href="#/demandas">Ver todas</a>`)}
        ${card("h-att", mine.length ? "Também precisam de atenção" : "Precisam de atenção", "bell",
          attOthers.length ? `<ul class="hlist">${attOthers.slice(0, 5).map(({ c, n, tone }) => item(c, { when: whenLabel(n), tone })).join("")}</ul>` : empty(att.length ? "O resto está em dia." : "Nada atrasado nem vencendo logo. Tudo em dia."),
          attOthers.length > 5 ? `<button class="link-btn" type="button" data-home-go="atencao">Ver todas (${att.length})</button>` : "")}
        ${card("h-next", "Próximas publicações", "calendar",
          next.length ? `<ul class="hlist">${next.map((c) => item(c, { when: `${c.scheduled_date === today ? "Hoje" : shortDay(c.scheduled_date)}${c.scheduled_time ? ` · ${timeLabel(c.scheduled_time.slice(0, 5))}` : ""}`, tone: toneOf(c) })).join("")}</ul>` : empty("Nada programado para os próximos 7 dias."),
          `<button class="link-btn" type="button" data-home-go="semana">Ver a semana</button>`)}
        <details class="hcard hcard--fold" data-home-activity ${activityOpen ? "open" : ""}>
          <summary class="hcard__head hcard__summary"><h2 class="hcard__title" id="h-activity">${icon("refresh")}Atividade recente</h2><span class="hcard__hint">${activityOpen ? "Fechar" : "Ver"}</span></summary>
          <div data-home-feed>${activityOpen ? feedHtml() : ""}</div>
        </details>
      </div>`;
  }

  /** Atividade recente: fechada até a pessoa abrir; só então busca (e continua aberta ao voltar) */
  let activityOpen = false;
  let eventsLoaded = false;
  function feedHtml() {
    if (!eventsLoaded) return '<p class="hcard__empty">Carregando…</p>';
    return events.length ? `<ul class="hfeed">${events.map((e) => `
            <li><button class="hfeed__item" type="button" data-open-home="${esc(e.content_id)}">
              <span class="hfeed__text"><b>${esc(e.actor_name || "Alguém")}</b> · ${esc(eventText(e))}</span>
              <span class="hfeed__meta">${esc(e.contents?.title || "")} · ${esc(stampLabel(e.created_at))}</span>
            </button></li>`).join("")}</ul>` : empty("Ainda sem movimento por aqui.");
  }
  async function loadFeed() {
    try { events = await api.recentEvents(8); } catch { events = []; }
    eventsLoaded = true;
    const box = root.querySelector("[data-home-feed]");
    if (box && activityOpen) box.innerHTML = feedHtml();
  }
  root.addEventListener("toggle", (event) => {
    if (!event.target.matches?.("[data-home-activity]")) return;
    activityOpen = event.target.open;
    event.target.querySelector(".hcard__hint").textContent = activityOpen ? "Fechar" : "Ver";
    if (activityOpen) { event.target.querySelector("[data-home-feed]").innerHTML = feedHtml(); loadFeed(); }
  }, true);

  async function load() {
    const name = firstName(state.me?.name);
    $("#inicio-title").textContent = name ? `Olá, ${name}` : "Início";
    $("#inicio-date").textContent = longDayLabel(todayISO());
    root.setAttribute("aria-busy", "true");
    if (!rows.length) root.innerHTML = `<ul class="kpis kpis--loading">${'<li><span class="kpi skeleton"></span></li>'.repeat(5)}</ul>`;
    const today = todayISO();
    const from = [addDays(today, -90), `${today.slice(0, 7)}-01`].sort()[0];
    try {
      const [list, tasks] = await Promise.all([api.listContents({ from, to: addDays(today, 31) }), api.listTasks().catch(() => [])]);
      rows = list;
      boardTasks = tasks;
      render();
      if (activityOpen) loadFeed();
    } catch (error) {
      root.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar o início", text: error.message });
    } finally { root.setAttribute("aria-busy", "false"); }
  }

  on(root, "click", "[data-open-home]", (event, b) => openContent(b.dataset.openHome));
  on(root, "click", "[data-open-home-task]", (event, b) => openTask(b.dataset.openHomeTask));
  on(root, "click", "[data-home-go]", (event, b) => {
    const go = b.dataset.homeGo;
    if (go === "aprovacoes") { navigate("aprovacoes"); return; }
    focusContents({ mode: go === "atencao" ? null : go, attention: go === "atencao" });
  });
  on(document, "click", '[data-action="home-new-content"]', () => openForm());
  document.addEventListener("content-saved", () => { if (state.route === "inicio") load(); });

  return { load, reset() { rows = []; events = []; boardTasks = []; activityOpen = false; eventsLoaded = false; } };
}
