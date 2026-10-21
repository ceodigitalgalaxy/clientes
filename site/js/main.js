/* ==========================================================================
   Portal de clientes Digital Galaxy · painel do cliente
   Liga os dados (repositório) aos componentes da tela.
   ========================================================================== */

import { createDemoRepository } from "./data/repository.js";
import { $, esc, on, canHover, reduceMotion } from "./lib/dom.js";
import { icon, brandMark } from "./lib/icons.js";
import { monthKey, addMonths, monthLabel, todayISO } from "./lib/dates.js";
import { summarize } from "./domain/status.js";
import { renderSummary } from "./ui/summary.js";
import { renderCalendar, renderAgenda, renderLegend, setupDayPopover } from "./ui/calendar.js";
import { createDrawer } from "./ui/drawer.js";
import { renderIdeas, setupIdeaModal } from "./ui/ideas.js";
import { toast } from "./ui/toast.js";

// Hoje só existe a demonstração. Com backend, trocar aqui por createApiRepository(...)
const repo = createDemoRepository();

const state = {
  client: null,
  month: monthKey(new Date()),
  plan: null,
  activities: [],
  approvals: [],
  ideas: [],
  selected: todayISO()
};

const el = {
  calendar: $("#calendar"),
  agenda: $("#agenda"),
  legend: $("#legend"),
  overview: $("#overview"),
  title: $("#calendar-title"),
  monthChip: $("#month-chip"),
  ideasList: $("#ideas-list"),
  ideasCount: $("#ideas-count")
};

/* ---------- Carregamento ---------- */
async function loadMonth(month) {
  state.month = month;
  const [plan, activities] = await Promise.all([repo.getPlan(month), repo.listActivities(month)]);
  state.plan = plan;
  // Conteúdos só aparecem quando o planejamento do mês foi compartilhado
  state.activities = plan ? activities : [];
  state.approvals = await repo.listApprovals(state.activities.map((a) => a.id));
  if (!state.selected.startsWith(month)) {
    state.selected = month === monthKey(new Date()) ? todayISO() : (state.activities[0]?.date || `${month}-01`);
  }
}

async function refreshApprovals() {
  state.approvals = await repo.listApprovals(state.activities.map((a) => a.id));
}

/* ---------- Renderização ---------- */
function renderMonth() {
  el.title.textContent = monthLabel(state.month);
  renderSummary(el.overview, { plan: state.plan, counts: summarize(state.activities, state.approvals), month: state.month });
  renderLegend(el.legend, state.activities);
  renderCalendar(el.calendar, { ...state, hasPlan: Boolean(state.plan) });
  renderAgenda(el.agenda, state);
  const isCurrent = state.month === monthKey(new Date());
  document.querySelector('[data-nav="today"]').disabled = isCurrent && state.selected === todayISO();
}

function renderIdeasArea() {
  renderIdeas(el.ideasList, state.ideas);
  el.ideasCount.textContent = state.ideas.length;
}

function renderHeader() {
  const { client } = state;
  $("#client-badge").innerHTML = `<span class="avatar avatar--client" aria-hidden="true">${esc(client.initials)}</span><span class="client-badge__text"><span class="client-badge__name"></span><span class="client-badge__segment"></span></span>`;
  $(".client-badge__name").textContent = client.name;
  $(".client-badge__segment").textContent = client.segment;
  $("#profile-avatar").textContent = client.initials;
  $("#profile-who").textContent = client.name;
  $("#welcome-hello").textContent = `Olá, ${client.name}!`;
  el.monthChip.innerHTML = `${icon("calendar")}<span></span>`;
  el.monthChip.querySelector("span").textContent = monthLabel(monthKey(new Date()));
}

/* Ícones declarados no HTML com data-icon */
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon));
    node.removeAttribute("data-icon");
  });
  root.querySelectorAll('[data-slot="brand-mark"]').forEach((node) => { node.innerHTML = brandMark(); });
}

/* ---------- Interações ---------- */
const drawer = createDrawer({
  dialog: $("#drawer"),
  repo,
  getContext: () => state,
  onChange: async () => { await refreshApprovals(); renderMonth(); }
});

const ideaModal = setupIdeaModal({
  dialog: $("#idea-modal"),
  repo,
  onSaved: async () => { state.ideas = await repo.listIdeas(); renderIdeasArea(); }
});

const popover = setupDayPopover({
  calendar: el.calendar,
  popover: $("#day-popover"),
  getState: () => state,
  onOpenActivity: (id) => drawer.open(id)
});

/* Troca de mês: o mês atual desliza e some para um lado, o novo entra pelo outro.
   Cliques seguidos interrompem a animação anterior sem embaralhar os meses. */
let navToken = 0;
async function goTo(month) {
  popover.hide();
  if (month === state.month) { renderMonth(); return; }
  const dir = month > state.month ? 1 : -1;
  const token = ++navToken;
  const targets = [el.calendar, el.title, el.overview, el.legend];
  const loading = loadMonth(month);
  if (!reduceMotion()) {
    await Promise.all(targets.map((node) => node.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 24}px)` }],
      { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
    ).finished.catch(() => {})));
  }
  await loading;
  if (token !== navToken) return;
  renderMonth();
  targets.forEach((node, i) => {
    node.getAnimations().forEach((a) => a.cancel());
    if (reduceMotion()) return;
    node.animate(
      [{ opacity: 0, transform: `translateX(${dir * 32}px)` }, { opacity: 1, transform: "none" }],
      { duration: 560, delay: i === 0 ? 40 : 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
    );
  });
}

function setupEvents() {
  on(document, "click", "[data-nav]", (event, button) => {
    const nav = button.dataset.nav;
    if (nav === "today") { state.selected = todayISO(); goTo(monthKey(new Date())); return; }
    goTo(addMonths(state.month, Number(nav)));
  });
  on(document, "click", "[data-activity]", (event, button) => {
    if (button.closest("#day-popover")) return; // o popover cuida do próprio clique
    popover.hide();
    drawer.open(button.dataset.activity);
  });
  on(el.calendar, "click", "[data-select]", (event, button) => {
    state.selected = button.dataset.select;
    renderMonth();
    // No celular, leva até a agenda do dia
    if (!canHover()) el.agenda.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.calendar.querySelector(`[data-select="${state.selected}"].cal__date`)?.focus({ preventScroll: true });
  });
  on(document, "click", '[data-action="new-idea"]', () => ideaModal.open());
  on(el.ideasList, "click", "[data-edit-idea]", (event, button) => {
    const idea = state.ideas.find((i) => i.id === button.dataset.editIdea);
    if (idea) ideaModal.open({ idea });
  });
  on(document, "click", '[data-action="show-ideas"]', () => $("#ideias").scrollIntoView({ behavior: "smooth" }));

  // Page Up / Page Down mudam o mês quando o foco está no calendário
  el.calendar.addEventListener("keydown", (event) => {
    if (event.target.closest("textarea, input")) return;
    if (event.key === "PageUp") { event.preventDefault(); goTo(addMonths(state.month, -1)); }
    if (event.key === "PageDown") { event.preventDefault(); goTo(addMonths(state.month, 1)); }
  });

  // Menu do perfil (preparado para o login futuro)
  const profileButton = $("#profile-button");
  const profileMenu = $("#profile-menu");
  const setMenu = (open) => { profileMenu.hidden = !open; profileButton.setAttribute("aria-expanded", String(open)); };
  profileButton.addEventListener("click", () => setMenu(profileMenu.hidden));
  document.addEventListener("click", (event) => { if (!event.target.closest(".profile")) setMenu(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
  on(profileMenu, "click", '[data-action="reset-demo"]', async () => {
    setMenu(false);
    await repo.resetDemo();
    state.ideas = await repo.listIdeas();
    await refreshApprovals();
    renderMonth();
    renderIdeasArea();
    toast("Demonstração restaurada", "info");
  });
}

/* ---------- Início ---------- */
async function start() {
  hydrateIcons();
  document.querySelectorAll(".js-year").forEach((node) => { node.textContent = new Date().getFullYear(); });
  if (repo.isDemo) $("#demo-bar").hidden = false;
  setupEvents();
  try {
    state.client = await repo.getClient();
    renderHeader();
    await loadMonth(state.month);
    state.ideas = await repo.listIdeas();
    renderMonth();
    renderIdeasArea();
  } catch (error) {
    console.error(error);
    el.calendar.innerHTML = `<div class="load-error"><p>Não conseguimos carregar o seu planejamento agora.</p><button class="btn btn--ghost btn--sm" type="button" data-action="reload">Tentar de novo</button></div>`;
    on(el.calendar, "click", '[data-action="reload"]', () => window.location.reload());
  }
}

start();
