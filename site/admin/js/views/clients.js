/* Seção Clientes: lista, cadastro, edição e exclusão (só sem conteúdos) */

import { $, esc, on } from "../../../js/lib/dom.js";
import { icon } from "../../../js/lib/icons.js";
import { validateClient, slugify } from "../domain/rules.js";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js";
import { stateBlock, loadingCards, button } from "../ui/states.js";
import { portalBlock } from "./access.js";

const initials = (name) => name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

export function setupClients({ api, state, toast, confirm, onClientsChanged, navigate }) {
  const list = $("#clients-list");
  const count = $("#clients-count");
  const dialog = $("#client-modal");
  const form = dialog.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  let editing = null;          // cliente em edição (null = novo)
  let slugTouched = false;     // identificador escrito à mão não é mais gerado pelo nome
  let saving = false;

  wireDialog(dialog, { canClose: () => !saving });

  function render() {
    list.setAttribute("aria-busy", "false");
    const { clients } = state;
    count.textContent = clients.length ? `${clients.length} ${clients.length === 1 ? "cliente" : "clientes"}` : "";
    if (!clients.length) {
      list.innerHTML = stateBlock({
        iconName: "users",
        title: "Nenhum cliente cadastrado",
        text: "Cadastre o primeiro cliente para começar a montar o calendário de conteúdos dele.",
        actions: button("new-client", "Cadastrar cliente", { primary: true, iconName: "user" })
      });
      return;
    }
    list.innerHTML = clients.map((client) => `
      <article class="client-card${client.active ? "" : " is-inactive"}" data-client-card="${esc(client.id)}">
        <div class="client-card__head">
          <span class="avatar avatar--client" aria-hidden="true">${esc(initials(client.name))}</span>
          <div>
            <h2 class="client-card__name">${esc(client.name)}</h2>
            <span class="client-card__slug" title="Identificador">${esc(client.slug)}</span>
          </div>
        </div>
        <div class="client-card__meta">
          ${client.segment ? `<span>${esc(client.segment)}</span>` : ""}
          ${client.contact_name || client.contact_email ? `<span>${esc([client.contact_name, client.contact_email].filter(Boolean).join(" · "))}</span>` : '<span class="field__optional">Sem contato cadastrado</span>'}
          ${client.active ? "" : '<span><span class="pill-off">Inativo</span></span>'}
        </div>
        ${portalBlock(client)}
        <div class="client-card__foot">
          <span class="client-card__count">${client.contents_count} ${client.contents_count === 1 ? "conteúdo" : "conteúdos"}</span>
          <div class="client-card__actions">
            <button class="icon-btn" type="button" data-client-contents="${esc(client.id)}" aria-label="Ver conteúdos de ${esc(client.name)}" title="Ver conteúdos">${icon("calendar")}</button>
            <button class="icon-btn" type="button" data-edit-client="${esc(client.id)}" aria-label="Editar ${esc(client.name)}" title="Editar">${icon("edit")}</button>
            ${client.contents_count === 0 ? `<button class="icon-btn icon-btn--danger" type="button" data-delete-client="${esc(client.id)}" aria-label="Excluir ${esc(client.name)}" title="Excluir">${icon("trash")}</button>` : ""}
          </div>
        </div>
      </article>`).join("");
  }

  function renderLoading() {
    list.setAttribute("aria-busy", "true");
    count.textContent = "";
    list.innerHTML = loadingCards();
  }

  function renderError(message) {
    list.setAttribute("aria-busy", "false");
    count.textContent = "";
    list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar os clientes", text: message, actions: button("reload-clients", "Tentar de novo", { iconName: "refresh" }) });
  }

  function open(client = null) {
    editing = client;
    slugTouched = Boolean(client);
    form.reset();
    showFieldErrors(form, {});
    dialog.querySelector(".modal__title").textContent = client ? "Editar cliente" : "Novo cliente";
    submit.querySelector("span").textContent = client ? "Salvar alterações" : "Cadastrar cliente";
    if (client) {
      ["name", "slug", "segment", "contact_name", "contact_email", "notes"].forEach((name) => { form.elements[name].value = client[name] || ""; });
      form.elements.active.checked = client.active;
    } else {
      form.elements.active.checked = true;
    }
    dialog.showModal();
    form.elements.name.focus();
  }

  form.elements.name.addEventListener("input", () => { if (!slugTouched) form.elements.slug.value = slugify(form.elements.name.value); });
  form.elements.slug.addEventListener("input", () => { slugTouched = true; });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.active = form.elements.active.checked;
    const { errors } = validateClient(data);
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    saving = true;
    setBusy(submit, true);
    try {
      if (editing) await api.updateClient(editing.id, data);
      else await api.createClient(data);
      closeDialog(dialog);
      toast(editing ? "Cliente atualizado" : "Cliente cadastrado");
      await onClientsChanged();
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.message);
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  on(document, "click", '[data-action="new-client"]', () => open());
  on(list, "click", "[data-edit-client]", (event, btn) => open(state.clients.find((c) => c.id === btn.dataset.editClient)));
  on(list, "click", "[data-client-contents]", (event, btn) => navigate("conteudos", { client_id: btn.dataset.clientContents }));
  on(list, "click", '[data-action="reload-clients"]', () => onClientsChanged());
  on(list, "click", "[data-delete-client]", async (event, btn) => {
    const client = state.clients.find((c) => c.id === btn.dataset.deleteClient);
    if (!client) return;
    const ok = await confirm({ title: `Excluir ${client.name}?`, text: "O cadastro do cliente será apagado. Esta ação não pode ser desfeita." });
    if (!ok) return;
    try {
      await api.deleteClient(client.id);
      toast("Cliente excluído");
      await onClientsChanged();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  return { render, renderLoading, renderError, open };
}
