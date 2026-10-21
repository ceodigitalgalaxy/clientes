/* ==========================================================================
   Painel da agência · Digital Galaxy
   Liga as seções (Conteúdos e Clientes) ao servidor local e cuida da
   navegação por endereço: #/conteudos?client_id=...&from=...&status=...
   ========================================================================== */

import { $, on } from "/shared/js/lib/dom.js";
import { icon, brandMark } from "/shared/js/lib/icons.js";
import { toast } from "/shared/js/ui/toast.js";
import { api } from "./api.js";
import { validateContentFilters } from "./domain/rules.js";
import { createConfirm } from "./ui/dialogs.js";
import { setupClients } from "./views/clients.js";
import { setupContents } from "./views/contents.js";

const ROUTES = ["conteudos", "clientes"];

const state = {
  route: "conteudos",
  clients: [],
  clientsLoaded: false,
  filters: {}
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

/* Indicador de conexão com o banco no topo */
async function checkHealth() {
  const box = $("#db-status");
  const text = box.querySelector(".db-status__text");
  try {
    const health = await api.health();
    box.classList.toggle("is-ok", health.ok);
    box.classList.toggle("is-error", !health.ok);
    text.textContent = health.ok ? "Banco conectado" : "Banco não configurado";
  } catch {
    box.classList.add("is-error");
    text.textContent = "Sem conexão com o banco";
  }
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon));
    node.removeAttribute("data-icon");
  });
  root.querySelectorAll('[data-slot="brand-mark"]').forEach((node) => { node.innerHTML = brandMark(); });
}

hydrateIcons();
window.addEventListener("hashchange", showRoute);
on(document, "click", "[data-route]", (event, link) => {
  if (link.dataset.route === state.route && location.hash.startsWith(`#/${state.route}`)) { event.preventDefault(); navigate(state.route); }
});
if (!location.hash) history.replaceState(null, "", "#/conteudos");
checkHealth();
showRoute();
