/* ==========================================================================
   Painel da agência · Digital Galaxy
   --------------------------------------------------------------------------
   1. Sem sessão: mostra só a tela de entrada. Nenhum dado é pedido ao banco.
   2. Depois do login: confere se a pessoa faz parte da equipe
      (agency_members). Se não fizer, encerra a sessão e avisa.
   3. Com acesso: liga as seções (Conteúdos e Clientes) ao banco e cuida da
      navegação por endereço: #/conteudos?client_id=...&from=...&status=...
   O banco aplica as mesmas regras (RLS): esconder a tela não é a proteção.
   ========================================================================== */

import { $, on } from "../../js/lib/dom.js?v=424169d0b1";
import { icon, brandMark } from "../../js/lib/icons.js?v=424169d0b1";
import { toast } from "../../js/ui/toast.js?v=424169d0b1";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../js/config.js?v=424169d0b1";
import { createAuth } from "../../js/lib/auth.js?v=424169d0b1";
import { createStorage } from "../../js/lib/storage.js?v=424169d0b1";
import { createSupabaseStore } from "./data/store.js?v=424169d0b1";
import { createApi } from "./api.js?v=424169d0b1";
import { validateContentFilters } from "./domain/rules.js?v=424169d0b1";
import { createConfirm, showFieldErrors, setBusy } from "./ui/dialogs.js?v=424169d0b1";
import { setupClients } from "./views/clients.js?v=424169d0b1";
import { setupContents } from "./views/contents.js?v=424169d0b1";
import { setupAccess } from "./views/access.js?v=424169d0b1";
import { setupImport } from "./views/import.js?v=424169d0b1";
import { setupAds } from "./views/ads.js?v=424169d0b1";
import { setupBrand } from "./views/brand.js?v=424169d0b1";
import { setupApprovals } from "./views/approvals.js?v=424169d0b1";
import { setupTeam } from "./views/team.js?v=424169d0b1";
import { setupTasks } from "./views/tasks.js?v=424169d0b1";

/* O painel não abre dentro de outro site (proteção contra clique disfarçado).
   A página fica invisível até esta checagem (veja .admin em admin.css). */
if (window.top !== window.self) throw new Error("O painel não pode ser aberto dentro de outra página.");
document.body.classList.add("is-ready");

const ROUTES = ["demandas", "conteudos", "aprovacoes", "anuncios", "clientes", "importar", "equipe"];
const TITLES = { demandas: "Minhas demandas", conteudos: "Conteúdos", aprovacoes: "Aprovações de Conteúdo", anuncios: "Aprovação de anúncios", clientes: "Clientes", importar: "Importar conteúdos", equipe: "Equipe" };
// Seções que dependem do perfil (o banco recusa de qualquer jeito; aqui só não mostramos)
const NEEDS = { clientes: "admin", equipe: "admin", importar: "edit", aprovacoes: "send" };

const auth = createAuth({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "equipe" });
const store = createSupabaseStore({
  url: SUPABASE_URL,
  apiKey: SUPABASE_PUBLISHABLE_KEY,
  getToken: () => auth.accessToken(),
  onUnauthorized: () => auth.refresh()
});
// Arquivos (foto do cliente e arte final), sempre com a sessão da equipe
const storage = createStorage({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, getToken: () => auth.accessToken(), refresh: () => auth.refresh() });
const api = createApi({
  store,
  storage,
  onSessionLost: (message) => showLogin(message),
  // Logins de cliente: função no Supabase que guarda a chave secreta (supabase/functions/acesso-cliente)
  access: { url: `${SUPABASE_URL}/functions/v1/acesso-cliente`, apiKey: SUPABASE_PUBLISHABLE_KEY, getToken: () => auth.accessToken(), refresh: () => auth.refresh() },
  // Logins da equipe: função "equipe" (só administrador)
  team: { url: `${SUPABASE_URL}/functions/v1/equipe`, apiKey: SUPABASE_PUBLISHABLE_KEY, getToken: () => auth.accessToken(), refresh: () => auth.refresh() }
});

const state = {
  route: "conteudos",
  clients: [],
  clientsLoaded: false,
  filters: {},
  signedIn: false,
  me: null,          // cadastro de quem entrou (perfil e permissões)
  team: [],          // diretório da equipe (para escolher responsáveis)
  can: { admin: false, edit: false, send: false },
  alerts: { soon: 3, urgent: 1 }   // limites das cores de alerta (ajustes da agência)
};

/** O que o perfil pode fazer (espelha as regras do banco) */
function permissions(me) {
  const admin = me?.role === "admin";
  return { admin, edit: admin || me?.edit_scope === "todos", send: admin || Boolean(me?.can_send_approval) };
}
const allowed = (route) => !NEEDS[route] || state.can[NEEDS[route]];
async function loadTeam() {
  try { state.team = await api.teamDirectory(); } catch { state.team = []; }
  return state.team;
}

const confirm = createConfirm($("#confirm-modal"));

function navigate(route, params = {}, { replace = false } = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const hash = `#/${route}${query ? `?${query}` : ""}`;
  if (replace) { history.replaceState(null, "", hash); showRoute(); }
  else if (location.hash === hash) showRoute();
  else location.hash = hash;
}

async function loadClients() {
  try {
    state.clients = await api.listClients();
    state.clientsLoaded = true;
    clients.render();
    return true;
  } catch (error) {
    state.clientsLoaded = false;
    clients.renderError(error.message);
    return false;
  }
}

const clients = setupClients({ api, state, toast, confirm, navigate, onClientsChanged: async () => { await loadClients(); if (state.route === "conteudos") await contents.load(); } });
setupBrand({ api, state, toast });
const contents = setupContents({ api, state, toast, confirm, navigate });
setupAccess({ api, state, toast, confirm, onChanged: () => loadClients() });
const importer = setupImport({ api, state, toast, navigate });
const adsView = setupAds({ api, state, toast, confirm, navigate });
const teamView = setupTeam({ api, state, toast, confirm, loadTeam });
const tasksView = setupTasks({ api, state, toast, navigate, openContent: (id) => contents.openById(id) });
const approvalsView = setupApprovals({ api, state, toast, confirm, navigate, openContentForm: (content, preset) => contents.openForm(content, preset) });

/** Mostra a seção do endereço atual */
async function showRoute() {
  if (!state.signedIn) return;
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const previous = state.route;
  state.route = ROUTES.includes(path) && allowed(path) ? path : (state.can.edit ? "conteudos" : "demandas");
  // Endereço de uma seção sem permissão (ou inexistente): a barra de endereço mostra onde a pessoa está
  if (path !== state.route) history.replaceState(null, "", `#/${state.route}`);
  // Trocou de seção: painéis e janelas da seção anterior fecham (não ficam por cima)
  if (previous && previous !== state.route) document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  state.filters = state.route === "conteudos" ? validateContentFilters(Object.fromEntries(new URLSearchParams(query))) : {};
  document.querySelectorAll("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== state.route; });
  document.querySelectorAll("[data-route]").forEach((link) => {
    if (link.dataset.route === state.route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${TITLES[state.route]} · Painel da agência`;
  // "Mais" (celular) fica marcado quando a seção aberta está dentro dele
  navMore.classList.toggle("is-current", Boolean(navSheet.querySelector(`[data-route="${state.route}"]`)));
  if (!state.clientsLoaded) {
    clients.renderLoading();
    if (state.route === "conteudos") contents.renderLoading();
    if (state.route === "anuncios") adsView.renderLoading();
    if (state.route === "aprovacoes") approvalsView.renderLoading();
    const ok = await loadClients();
    if (!ok && state.route === "conteudos") { await contents.load(); return; }
  }
  if (state.route === "conteudos") await contents.load();
  if (state.route === "demandas") await tasksView.load();
  if (state.route === "equipe") await teamView.load();
  if (state.route === "importar") importer.show();
  if (state.route === "anuncios") await adsView.load(Object.fromEntries(new URLSearchParams(query)));
  if (state.route === "aprovacoes") await approvalsView.load(Object.fromEntries(new URLSearchParams(query)));
}

/* ---------- Entrada e saída ---------- */

const loginScreen = $("#login");
const loginForm = $("#login-form");
const app = $("#app");

/** Volta para a tela de entrada, apagando da tela tudo o que veio do banco */
function showLogin(message = "", { info = false } = {}) {
  const wasSignedIn = state.signedIn;
  state.signedIn = false;
  state.me = null;
  state.team = [];
  state.can = permissions(null);
  state.clients = [];
  state.clientsLoaded = false;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  $("#contents-list").innerHTML = "";
  $("#ads-list").innerHTML = "";
  document.querySelector("[data-ads-attention]").hidden = true;
  approvalsView.stopPolling();
  approvalsView.reset();
  $("#clients-list").innerHTML = "";
  $("#contents-count").textContent = "";
  $("#clients-count").textContent = "";
  app.hidden = true;
  loginScreen.hidden = false;
  document.title = "Entrar · Painel da agência";
  showFieldErrors(loginForm, {}, message);
  loginForm.querySelector(".form-error").classList.toggle("is-info", info);
  if (wasSignedIn || !loginForm.elements.username.value) loginForm.elements.username.focus();
}

/** Confere se quem entrou faz parte da equipe e abre o painel */
async function enterApp() {
  const user = auth.user;
  let me = null;
  try {
    me = await api.getProfile(user.id);
  } catch (error) {
    if (error.status === 401) return;          // sessão vencida: o login já foi mostrado
    showLogin(error.message);
    return;
  }
  if (!me || me.active === false) {
    await auth.signOut();
    showLogin(me ? "Seu acesso ao painel foi desativado. Fale com um administrador." : "Este usuário não tem acesso ao painel da agência.");
    return;
  }
  state.signedIn = true;
  state.me = { ...me, user_id: user.id, role: me.role || "admin" };
  state.can = permissions(state.me);
  // Menu e botões conforme o perfil (o banco aplica as mesmas regras)
  document.querySelectorAll("[data-needs]").forEach((el) => { el.hidden = !state.can[el.dataset.needs]; });
  document.body.classList.toggle("is-admin", state.can.admin);
  document.body.classList.toggle("can-edit", state.can.edit);
  document.body.classList.toggle("can-send", state.can.send);
  buildMobileNav();
  $("#user-name").lastChild.textContent = me.name || user.name;
  [, state.alerts] = await Promise.all([loadTeam(), api.alertSettings()]);
  loginScreen.hidden = true;
  app.hidden = false;
  if (!location.hash) history.replaceState(null, "", state.can.edit ? "#/conteudos" : "#/demandas");
  await showRoute();
  tasksView.refreshCount();
  // Contador do menu "Anúncios": quantos o cliente pediu para alterar
  if (state.route !== "anuncios") adsView.refreshAttention();
  // Avisos da central de aprovação (decisões dos clientes), a cada 30 s
  if (state.can.send) {
    if (state.route !== "aprovacoes") approvalsView.refreshAttention();
    approvalsView.startPolling();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector("[type=submit]");
  const { username, password } = loginForm.elements;
  const fields = {};
  if (!username.value.trim()) fields.username = "Informe o usuário.";
  if (!password.value) fields.password = "Informe a senha.";
  if (Object.keys(fields).length) { showFieldErrors(loginForm, fields); return; }
  showFieldErrors(loginForm, {});
  setBusy(submit, true);
  try {
    await auth.signIn(username.value, password.value);
    password.value = "";
    await enterApp();
  } catch (error) {
    password.value = "";
    showFieldErrors(loginForm, {}, error.message);
    loginForm.querySelector(".form-error").classList.remove("is-info");
    password.focus();
  } finally {
    setBusy(submit, false);
  }
});

on(document, "click", '[data-action="sign-out"]', async () => {
  await auth.signOut();
  showLogin("Você saiu do painel.", { info: true });
});

/* Saiu em outra aba: sai aqui também */
auth.onChange((session) => { if (!session && state.signedIn) showLogin("Você saiu do painel.", { info: true }); });
auth.syncTabs();

/* ---------- Início ---------- */

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon));
    node.removeAttribute("data-icon");
  });
  root.querySelectorAll('[data-slot="brand-mark"]').forEach((node) => { node.innerHTML = brandMark(); });
}

/* ---------- Celular: menu embaixo (até 4 seções + "Mais") e filtros recolhidos ---------- */
const NAV_SLOTS = 4;
const navMore = document.querySelector("[data-nav-more]");
const navSheet = $("#nav-sheet");
function buildMobileNav() {
  const links = [...document.querySelectorAll(".admin-nav a.admin-nav__link")].filter((a) => !a.hidden);
  const overflow = links.length > NAV_SLOTS + 1 ? links.slice(NAV_SLOTS) : [];
  links.forEach((a) => a.classList.toggle("is-overflow", overflow.includes(a)));
  navMore.hidden = !overflow.length;
  navSheet.innerHTML = overflow.map((a) => `<a class="nav-sheet__link" href="${a.getAttribute("href")}" data-route="${a.dataset.route}">${a.innerHTML}</a>`).join("");
  setNavSheet(false);
}
function setNavSheet(open) {
  navSheet.hidden = !open;
  navMore.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("nav-sheet-open", open);
}
navMore.addEventListener("click", () => setNavSheet(navSheet.hidden));
navSheet.addEventListener("click", (event) => { if (event.target.closest("a")) setNavSheet(false); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !navSheet.hidden) { setNavSheet(false); navMore.focus(); } });
document.addEventListener("click", (event) => { if (!navSheet.hidden && !event.target.closest("#nav-sheet, [data-nav-more]")) setNavSheet(false); });

function wireFilterToggles() {
  document.querySelectorAll("form.filters").forEach((form) => {
    if (!form.id) return;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn--ghost btn--sm filters-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", form.id);
    toggle.innerHTML = `${icon("list")}<span>Filtros</span><span class="filters-toggle__count" hidden></span>`;
    form.before(toggle);
    const sync = () => {
      const active = [...form.elements].filter((el) => el.name && !el.closest("[hidden]") && el.value && el.type !== "checkbox").length;
      const badge = toggle.querySelector(".filters-toggle__count");
      badge.hidden = !active;
      badge.textContent = String(active);
    };
    toggle.addEventListener("click", () => {
      const open = !form.classList.contains("is-open");
      form.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
    form.addEventListener("change", sync);
    form.addEventListener("reset", () => setTimeout(sync));
    window.addEventListener("hashchange", () => setTimeout(sync, 50));
    setTimeout(sync, 300);
  });
}

hydrateIcons();
wireFilterToggles();
$("#user-name").append(document.createTextNode(""));
window.addEventListener("hashchange", showRoute);
on(document, "click", "[data-route]", (event, link) => {
  if (link.dataset.route === state.route && location.hash.startsWith(`#/${state.route}`)) { event.preventDefault(); navigate(state.route); }
});
if (auth.session) enterApp(); else showLogin();
