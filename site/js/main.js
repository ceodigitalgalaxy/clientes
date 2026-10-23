/* ==========================================================================
   Portal de clientes Digital Galaxy · painel do cliente
   Liga os dados (repositório) aos componentes da tela.
   --------------------------------------------------------------------------
   O cliente entra com usuário e senha e vê só os conteúdos do próprio
   cliente, lidos do banco (data/supabase-repository.js). Sem login, nenhum
   dado é pedido. Os dados se atualizam sozinhos (a cada 30 s, ao voltar
   para a aba e no botão "Atualizar").
   ========================================================================== */

import { createSupabaseRepository } from "./data/supabase-repository.js?v=d5af9cfdc2";
import { createAuth } from "./lib/auth.js?v=d5af9cfdc2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=d5af9cfdc2";
import { $, esc, on, reduceMotion } from "./lib/dom.js?v=d5af9cfdc2";
import { icon, brandMark } from "./lib/icons.js?v=d5af9cfdc2";
import { monthKey, addMonths, addDays, monthLabel, weekLabel, weekDays, todayISO, fromISO, daysInMonth } from "./lib/dates.js?v=d5af9cfdc2";
import { summarize } from "./domain/status.js?v=d5af9cfdc2";
import { createHighlights, pickHighlights } from "./ui/highlights.js?v=d5af9cfdc2";
import { renderCalendar, renderAgenda, renderLegend, setupDayPopover } from "./ui/calendar.js?v=d5af9cfdc2";
import { createDrawer } from "./ui/drawer.js?v=d5af9cfdc2";
import { renderIdeas, setupIdeaModal } from "./ui/ideas.js?v=d5af9cfdc2";
import { toast } from "./ui/toast.js?v=d5af9cfdc2";

/* O portal não abre dentro de outro site (proteção contra clique disfarçado).
   A página fica invisível até esta checagem (body.portal em style.css). */
if (window.top !== window.self) throw new Error("O portal não pode ser aberto dentro de outra página.");
document.body.classList.add("is-ready");

const REFRESH_MS = 30_000;

const auth = createAuth({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "cliente" });
const repo = createSupabaseRepository({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, auth });
// O que o banco já guarda (aprovar, observar, ideias e foco do mês chegam nas próximas etapas)
const features = { approvals: false, comments: false, ideas: false, plans: false, ...(repo.features || {}) };

const state = {
  client: null,
  view: "month",          // month | week
  month: monthKey(new Date()),
  plan: null,
  activities: [],
  approvals: [],
  ideas: [],
  pool: [],               // conteúdos de 31 dias antes até 31 dias depois de hoje (destaques)
  selected: todayISO(),
  loaded: false
};

const el = {
  app: $("#app"),
  login: $("#login"),
  loginForm: $("#login-form"),
  calendar: $("#calendar"),
  agenda: $("#agenda"),
  legend: $("#legend"),
  overview: $("#overview"),
  title: $("#calendar-title"),
  monthChip: $("#month-chip"),
  ideasList: $("#ideas-list"),
  ideasCount: $("#ideas-count")
};

const pad = (n) => String(n).padStart(2, "0");
const monthStart = (key) => `${key}-01`;
const monthEnd = (key) => `${key}-${pad(daysInMonth(key))}`;

/* ---------- Carregamento ---------- */

/** Período buscado: o mês inteiro (ou os dois meses que a semana toca), para o resumo do mês */
function viewRange() {
  if (state.view === "week") {
    const days = weekDays(state.selected);
    return [monthStart(days[0].iso.slice(0, 7)), monthEnd(days[6].iso.slice(0, 7))];
  }
  return [monthStart(state.month), monthEnd(state.month)];
}

async function fetchActivities(from, to) {
  if (repo.listActivitiesBetween) return repo.listActivitiesBetween(from, to);
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
  const lists = await Promise.all(months.map((m) => repo.listActivities(m)));
  return lists.flat();
}

/* Cada busca leva um número. Uma resposta mais antiga que a já exibida é
   descartada (ex.: atualização automática que termina depois de uma recarga). */
let loadSeq = 0;
let shownSeq = 0;
function applyData(data) {
  if (data.seq < shownSeq) return false;
  shownSeq = data.seq;
  const { seq, ...rest } = data;
  Object.assign(state, rest);
  return true;
}

async function loadData() {
  const seq = ++loadSeq;
  const [from, to] = viewRange();
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7), state.month])];
  const today = todayISO();
  const [plans, activities, pool] = await Promise.all([
    Promise.all(months.map((m) => repo.getPlan(m))),
    fetchActivities(from, to),
    fetchActivities(addDays(today, -31), addDays(today, 31))
  ]);
  const planOf = Object.fromEntries(months.map((m, i) => [m, plans[i]]));
  // Quem decide o que aparece é o status definido pela agência (e, quando existir, o planejamento compartilhado)
  const visible = features.plans ? activities.filter((a) => planOf[a.date.slice(0, 7)]) : activities;
  const approvals = await repo.listApprovals(visible.map((a) => a.id));
  return { seq, plan: planOf[state.month] || null, activities: visible, approvals, pool };
}

async function refreshApprovals() {
  state.approvals = await repo.listApprovals(state.activities.map((a) => a.id));
}

/** O que importa para saber se algo mudou no banco */
const signature = (activities) => JSON.stringify(activities.map((a) => [a.id, a.version, a.status, a.date, a.time, a.updatedAt, a.title]));

/* ---------- Renderização ---------- */
function renderView() {
  const week = state.view === "week";
  const monthItems = state.activities.filter((a) => a.date.startsWith(state.month));
  const weekIsos = week ? new Set(weekDays(state.selected).map((d) => d.iso)) : null;
  const viewItems = week ? state.activities.filter((a) => weekIsos.has(a.date)) : monthItems;
  el.title.textContent = week ? weekLabel(state.selected) : monthLabel(state.month);
  const today = todayISO();
  highlights.render({ highlights: pickHighlights(state.pool, today), counts: summarize(monthItems, state.approvals), month: state.month, today });
  renderLegend(el.legend, viewItems, ["aguardando", "ajustes", "aprovado", "publicado"]);
  renderCalendar(el.calendar, { ...state, activities: viewItems, hasPlan: Boolean(state.plan), live: true, canSuggest: features.ideas });
  el.calendar.removeAttribute("aria-busy");
  renderAgenda(el.agenda, state);
  const showingToday = week ? weekIsos.has(today) : state.month === monthKey(new Date());
  document.querySelector('[data-nav="today"]').disabled = showingToday && state.selected === today;
  document.querySelectorAll("[data-view-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.viewMode === state.view)));
  document.querySelectorAll('[data-nav="-1"], [data-nav="1"]').forEach((button) => {
    const next = button.dataset.nav === "1";
    button.setAttribute("aria-label", week ? (next ? "Próxima semana" : "Semana anterior") : (next ? "Próximo mês" : "Mês anterior"));
  });
}

function renderIdeasArea() {
  renderIdeas(el.ideasList, state.ideas);
  el.ideasCount.textContent = state.ideas.length;
}

function renderHeader() {
  const { client } = state;
  // Foto/logo do cliente (cadastrada no painel) ou as iniciais
  const photo = client.logoUrl ? `<img class="avatar avatar--client avatar--photo" src="${esc(client.logoUrl)}" alt="">` : `<span class="avatar avatar--client" aria-hidden="true">${esc(client.initials)}</span>`;
  $("#client-badge").innerHTML = `${photo}<span class="client-badge__text"><span class="client-badge__name"></span><span class="client-badge__segment"></span></span>`;
  $(".client-badge__name").textContent = client.name;
  $(".client-badge__segment").textContent = client.segment;
  $("#profile-avatar").innerHTML = client.logoUrl ? `<img src="${esc(client.logoUrl)}" alt="">` : esc(client.initials);
  $("#profile-avatar").classList.toggle("avatar--has-photo", Boolean(client.logoUrl));
  $("#profile-who").textContent = client.name;
  $("#welcome-hello").textContent = `Olá, ${client.name}!`;
  el.monthChip.innerHTML = `${icon("calendar")}<span></span>`;
  el.monthChip.querySelector("span").textContent = monthLabel(monthKey(new Date()));
  $("#profile-note").textContent = auth.user?.username ? `Usuário: ${auth.user.username}` : "";
}

function renderLoadError(error) {
  el.calendar.removeAttribute("aria-busy");
  el.calendar.innerHTML = `<div class="load-error" role="alert"><p>${esc(error?.message || "Não conseguimos carregar o seu planejamento agora.")}</p><button class="btn btn--ghost btn--sm" type="button" data-action="retry-load">${icon("refresh")}Tentar de novo</button></div>`;
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
/** Layout de celular (agenda abaixo do calendário) */
const agendaVisible = () => getComputedStyle(el.agenda).display !== "none";

const highlights = createHighlights({ container: el.overview });

const drawer = createDrawer({
  dialog: $("#drawer"),
  repo,
  getContext: () => state,
  // Depois de aprovar ou pedir ajuste: busca de novo (o status mudou no banco)
  onChange: async () => { if (applyData(await loadData())) renderView(); }
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

/* Troca de período (mês, semana ou visão): o atual desliza e some para um lado,
   o novo entra pelo outro. Cliques seguidos interrompem a animação anterior. */
let navToken = 0;
async function navigate(changes = {}, dir = 0) {
  popover.hide();
  const token = ++navToken;
  Object.assign(state, changes);
  if (state.view === "week") state.month = monthKey(fromISO(state.selected));
  const targets = [el.calendar, el.title, el.legend];
  let done = false;
  const loading = loadData().finally(() => { done = true; });
  loading.catch(() => {});   // o erro é tratado abaixo
  if (dir && !reduceMotion()) {
    await Promise.all(targets.map((node) => node.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 24}px)` }],
      { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
    ).finished.catch(() => {})));
  }
  // Ainda carregando: mostra o esqueleto do calendário
  const skeleton = setTimeout(() => {
    if (token !== navToken || done) return;
    targets.forEach((node) => node.getAnimations().forEach((a) => a.cancel()));
    el.title.textContent = state.view === "week" ? weekLabel(state.selected) : monthLabel(state.month);
    el.calendar.setAttribute("aria-busy", "true");
    el.calendar.innerHTML = '<div class="skeleton skeleton--calendar"></div>';
  }, dir ? 0 : 200);
  let data;
  try {
    data = await loading;
  } catch (error) {
    clearTimeout(skeleton);
    if (token !== navToken) return;
    targets.forEach((node) => node.getAnimations().forEach((a) => a.cancel()));
    handleError(error);
    return;
  }
  clearTimeout(skeleton);
  if (token !== navToken) return;
  // Se uma atualização mais nova já chegou (para esta mesma tela), fica com ela, mas desenha mesmo assim
  applyData(data);
  if (state.view === "month" && !state.selected.startsWith(state.month)) {
    state.selected = state.month === monthKey(new Date()) ? todayISO() : (state.activities.find((a) => a.date.startsWith(state.month))?.date || `${state.month}-01`);
  }
  renderView();
  drawer.refresh();
  targets.forEach((node, i) => {
    node.getAnimations().forEach((a) => a.cancel());
    if (!dir || reduceMotion()) return;
    node.animate(
      [{ opacity: 0, transform: `translateX(${dir * 32}px)` }, { opacity: 1, transform: "none" }],
      { duration: 560, delay: i === 0 ? 40 : 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
    );
  });
}

/** Mês anterior/seguinte ou semana anterior/seguinte */
function step(delta) {
  if (state.view === "week") return navigate({ selected: addDays(state.selected, delta * 7) }, delta);
  return navigate({ month: addMonths(state.month, delta) }, delta);
}

function handleError(error) {
  if (error?.status === 401 || error?.reason === "no_access") {
    if (error.reason === "no_access") auth.signOut();
    showLogin(error.message);
    return;
  }
  if (!error?.status) console.error(error);   // erros conhecidos (sem internet, servidor) já aparecem na tela
  renderLoadError(error);
}

/* ---------- Atualização automática (dados reais) ---------- */
let refreshing = false;
async function refreshQuietly({ announce = false } = {}) {
  if (!state.loaded || refreshing || document.hidden) return;
  refreshing = true;
  const token = navToken;
  const button = document.querySelector('[data-action="refresh"]');
  button?.classList.add("is-spinning");
  try {
    const data = await loadData();
    if (token !== navToken || !state.loaded) return;
    const changed = signature(data.activities) !== signature(state.activities) || signature(data.pool) !== signature(state.pool);
    if (!applyData(data)) return;
    if (changed) {
      popover.hide();
      renderView();
      drawer.refresh();
    }
    if (announce) toast(changed ? "Calendário atualizado" : "Tudo em dia: nada mudou", "info");
  } catch (error) {
    if (error?.status === 401 || error?.reason === "no_access") handleError(error);
    else if (announce) toast(error?.message || "Não foi possível atualizar agora.", "info");
  } finally {
    refreshing = false;
    button?.classList.remove("is-spinning");
  }
}

function setupEvents() {
  on(document, "click", "[data-nav]", (event, button) => {
    const nav = button.dataset.nav;
    if (nav === "today") {
      const today = todayISO();
      const dir = today < state.selected ? -1 : today > state.selected ? 1 : 0;
      const moves = state.view === "week" ? !weekDays(state.selected).some((d) => d.iso === today) : monthKey(new Date()) !== state.month;
      navigate({ selected: today, month: monthKey(new Date()) }, moves ? dir : 0);
      return;
    }
    step(Number(nav));
  });
  on(document, "click", "[data-view-mode]", (event, button) => {
    if (button.dataset.viewMode === state.view) return;
    navigate({ view: button.dataset.viewMode, month: monthKey(fromISO(state.selected)) });
  });
  on(document, "click", "[data-activity]", (event, button) => {
    if (button.closest("#day-popover")) return; // o popover cuida do próprio clique
    popover.hide();
    drawer.open(button.dataset.activity);
  });
  // Destaque: leva o calendário até o dia do conteúdo e abre os detalhes
  on(el.overview, "click", "[data-highlight]", async (event, button) => {
    const id = button.dataset.highlight;
    const item = state.pool.find((a) => a.id === id);
    if (!item) return;
    if (!state.activities.some((a) => a.id === id)) {
      const month = item.date.slice(0, 7);
      await navigate({ month, selected: item.date }, month > state.month ? 1 : -1);
    } else if (state.selected !== item.date) {
      state.selected = item.date;
      renderView();
    }
    drawer.open(id);
  });
  on(el.calendar, "click", "[data-select]", (event, button) => {
    const iso = button.dataset.select;
    // Dia de outro mês (cinza): vai para aquele mês
    if (state.view === "month" && !iso.startsWith(state.month)) {
      navigate({ month: iso.slice(0, 7), selected: iso }, iso > state.selected ? 1 : -1);
      return;
    }
    state.selected = iso;
    renderView();
    if (!agendaVisible()) {
      // Computador: abre os detalhes do dia (ou o aviso de dia livre)
      popover.hide();
      drawer.openDay(iso);
    } else {
      // Celular: leva até a agenda do dia
      el.agenda.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el.calendar.querySelector(`[data-select="${iso}"].cal__date`)?.focus({ preventScroll: true });
    }
  });
  on(el.calendar, "click", '[data-action="retry-load"]', () => navigate({}));
  // Agenda (celular): "Próximo: dia X" seleciona aquele dia
  on(el.agenda, "click", "[data-agenda-go]", (event, button) => {
    state.selected = button.dataset.agendaGo;
    renderView();
    el.calendar.querySelector(`[data-select="${state.selected}"].cal__date`)?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  });
  on(document, "click", '[data-action="refresh"]', () => refreshQuietly({ announce: true }));
  on(document, "click", '[data-action="new-idea"]', () => ideaModal.open());
  on(el.ideasList, "click", "[data-edit-idea]", (event, button) => {
    const idea = state.ideas.find((i) => i.id === button.dataset.editIdea);
    if (idea) ideaModal.open({ idea });
  });
  on(document, "click", '[data-action="show-ideas"]', () => $("#ideias").scrollIntoView({ behavior: "smooth" }));

  // Page Up / Page Down mudam o período quando o foco está no calendário
  el.calendar.addEventListener("keydown", (event) => {
    if (event.target.closest("textarea, input")) return;
    if (event.key === "PageUp") { event.preventDefault(); step(-1); }
    if (event.key === "PageDown") { event.preventDefault(); step(1); }
  });

  // Menu do perfil
  const profileButton = $("#profile-button");
  const profileMenu = $("#profile-menu");
  const setMenu = (open) => { profileMenu.hidden = !open; profileButton.setAttribute("aria-expanded", String(open)); };
  profileButton.addEventListener("click", () => setMenu(profileMenu.hidden));
  document.addEventListener("click", (event) => { if (!event.target.closest(".profile")) setMenu(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
  on(profileMenu, "click", '[data-action="sign-out"]', async () => {
    setMenu(false);
    await auth.signOut();
    showLogin("Você saiu do portal.", { info: true });
  });

  setInterval(() => refreshQuietly(), REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshQuietly(); });
  window.addEventListener("focus", () => refreshQuietly());
  // Saiu em outra aba: sai aqui também
  auth.onChange((session) => { if (!session && state.loaded) showLogin("Você saiu do portal.", { info: true }); });
  auth.syncTabs();
}

/* ---------- Entrada (dados reais) ---------- */
function setLoginMessage(message, info = false) {
  const box = el.loginForm.querySelector(".form-error");
  box.textContent = message;
  box.hidden = !message;
  box.classList.toggle("is-info", info);
}

/** Volta para a tela de entrada, apagando da tela tudo o que veio do banco */
function showLogin(message = "", { info = false } = {}) {
  state.loaded = false;
  navToken += 1;
  state.client = null;
  state.activities = [];
  state.approvals = [];
  state.pool = [];
  highlights.reset();
  popover.hide();
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  el.calendar.innerHTML = '<div class="skeleton skeleton--calendar"></div>';
  el.agenda.innerHTML = "";
  el.legend.innerHTML = "";
  el.overview.innerHTML = '<div class="skeleton skeleton--block"></div>';
  $("#client-badge").innerHTML = '<span class="skeleton skeleton--text"></span>';
  $("#welcome-hello").textContent = "Olá!";
  $("#profile-avatar").textContent = "·";
  $("#profile-avatar").classList.remove("avatar--has-photo");
  el.app.hidden = true;
  el.login.hidden = false;
  document.title = "Entrar · Portal de clientes Digital Galaxy";
  setLoginMessage(message, info);
  el.loginForm.elements.username.focus();
}

async function enterApp() {
  try {
    state.client = await repo.getClient();
  } catch (error) {
    if (error.reason === "no_access") await auth.signOut();
    showLogin(error.message);
    return;
  }
  el.login.hidden = true;
  el.app.hidden = false;
  document.title = "Seu planejamento · Digital Galaxy";
  renderHeader();
  state.loaded = true;
  await navigate({ selected: todayISO(), month: monthKey(new Date()) });
}

function setupLogin() {
  el.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { username, password } = el.loginForm.elements;
    const submit = el.loginForm.querySelector("[type=submit]");
    [username, password].forEach((field) => {
      if (field.value.trim()) field.removeAttribute("aria-invalid"); else field.setAttribute("aria-invalid", "true");
    });
    if (!username.value.trim() || !password.value) {
      setLoginMessage("Informe o usuário e a senha.");
      (username.value.trim() ? password : username).focus();
      return;
    }
    submit.disabled = true;
    submit.classList.add("is-loading");
    setLoginMessage("");
    try {
      await auth.signIn(username.value, password.value);
      password.value = "";
      await enterApp();
    } catch (error) {
      password.value = "";
      setLoginMessage(error.message);
      password.focus();
    } finally {
      submit.disabled = false;
      submit.classList.remove("is-loading");
    }
  });
}

/* ---------- Início ---------- */
async function start() {
  hydrateIcons();
  document.querySelectorAll(".js-year").forEach((node) => { node.textContent = new Date().getFullYear(); });
  // Ações que ainda não gravam no banco ficam escondidas
  document.querySelectorAll("[data-feature]").forEach((node) => { node.hidden = !features[node.dataset.feature]; });
  setupEvents();
  setupLogin();
  if (auth.session) await enterApp(); else showLogin();
}

start();
