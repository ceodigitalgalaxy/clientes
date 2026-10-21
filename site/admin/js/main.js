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

import { $, on } from "../../js/lib/dom.js";
import { icon, brandMark } from "../../js/lib/icons.js";
import { toast } from "../../js/ui/toast.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../js/config.js";
import { createAuth } from "../../js/lib/auth.js";
import { createSupabaseStore } from "./data/store.js";
import { createApi } from "./api.js";
import { validateContentFilters } from "./domain/rules.js";
import { createConfirm, showFieldErrors, setBusy } from "./ui/dialogs.js";
import { setupClients } from "./views/clients.js";
import { setupContents } from "./views/contents.js";

/* O painel não abre dentro de outro site (proteção contra clique disfarçado).
   A página fica invisível até esta checagem (veja .admin em admin.css). */
if (window.top !== window.self) throw new Error("O painel não pode ser aberto dentro de outra página.");
document.body.classList.add("is-ready");

const ROUTES = ["conteudos", "clientes"];

const auth = createAuth({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "equipe" });
const store = createSupabaseStore({
  url: SUPABASE_URL,
  apiKey: SUPABASE_PUBLISHABLE_KEY,
  getToken: () => auth.accessToken(),
  onUnauthorized: () => auth.refresh()
});
const api = createApi({ store, onSessionLost: (message) => showLogin(message) });

const state = {
  route: "conteudos",
  clients: [],
  clientsLoaded: false,
  filters: {},
  signedIn: false
};

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
const contents = setupContents({ api, state, toast, confirm, navigate });

/** Mostra a seção do endereço atual */
async function showRoute() {
  if (!state.signedIn) return;
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  state.route = ROUTES.includes(path) ? path : "conteudos";
  state.filters = state.route === "conteudos" ? validateContentFilters(Object.fromEntries(new URLSearchParams(query))) : {};
  document.querySelectorAll("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== state.route; });
  document.querySelectorAll("[data-route]").forEach((link) => {
    if (link.dataset.route === state.route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${state.route === "clientes" ? "Clientes" : "Conteúdos"} · Painel da agência`;
  if (!state.clientsLoaded) {
    clients.renderLoading();
    if (state.route === "conteudos") contents.renderLoading();
    const ok = await loadClients();
    if (!ok && state.route === "conteudos") { await contents.load(); return; }
  }
  if (state.route === "conteudos") await contents.load();
}

/* ---------- Entrada e saída ---------- */

const loginScreen = $("#login");
const loginForm = $("#login-form");
const app = $("#app");

/** Volta para a tela de entrada, apagando da tela tudo o que veio do banco */
function showLogin(message = "", { info = false } = {}) {
  const wasSignedIn = state.signedIn;
  state.signedIn = false;
  state.clients = [];
  state.clientsLoaded = false;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  $("#contents-list").innerHTML = "";
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
  let member = false;
  try {
    member = await api.isAgencyMember(user.id);
  } catch (error) {
    if (error.status === 401) return;          // sessão vencida: o login já foi mostrado
    showLogin(error.message);
    return;
  }
  if (!member) {
    await auth.signOut();
    showLogin("Este usuário não tem acesso ao painel da agência.");
    return;
  }
  state.signedIn = true;
  $("#user-name").lastChild.textContent = user.name;
  loginScreen.hidden = true;
  app.hidden = false;
  if (!location.hash) history.replaceState(null, "", "#/conteudos");
  await showRoute();
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

hydrateIcons();
$("#user-name").append(document.createTextNode(""));
window.addEventListener("hashchange", showRoute);
on(document, "click", "[data-route]", (event, link) => {
  if (link.dataset.route === state.route && location.hash.startsWith(`#/${state.route}`)) { event.preventDefault(); navigate(state.route); }
});
if (auth.session) enterApp(); else showLogin();
