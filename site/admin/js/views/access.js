/* Acesso do cliente ao portal: criar login, trocar senha e remover.
   Tudo passa pela função acesso-cliente (a chave secreta nunca vem para o
   navegador). A senha aparece só uma vez, para a equipe copiar e enviar; ela
   não fica guardada no painel. */

import { $, esc, on } from "../../../js/lib/dom.js?v=fd0ca6eef6";
import { icon } from "../../../js/lib/icons.js?v=fd0ca6eef6";
import { slugify, passwordProblem, USERNAME_LIMITS, PASSWORD_LIMITS } from "../domain/rules.js?v=fd0ca6eef6";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=fd0ca6eef6";

const PORTAL_URL = "https://clientes.digitalgalaxy.com.br";
// Sem letras e números parecidos (l, I, 1, O, 0): mais fácil de digitar
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const SYMBOLS = "#@%*-+!";

/** Senha aleatória de 14 caracteres (com letra maiúscula, minúscula, número e símbolo) */
export function generatePassword(username = "") {
  const pick = (chars) => {
    const limit = 256 - (256 % chars.length);
    const byte = new Uint8Array(1);
    do { crypto.getRandomValues(byte); } while (byte[0] >= limit);
    return chars[byte[0] % chars.length];
  };
  for (;;) {
    const parts = [pick("ABCDEFGHJKLMNPQRSTUVWXYZ"), pick("abcdefghijkmnpqrstuvwxyz"), pick("23456789"), pick(SYMBOLS)];
    while (parts.length < 14) parts.push(pick(ALPHABET));
    // Embaralha (Fisher-Yates com números aleatórios seguros)
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const r = new Uint32Array(1); crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    const password = parts.join("");
    if (!passwordProblem(password, username)) return password;
  }
}

export function setupAccess({ api, state, toast, confirm, onChanged }) {
  const dialog = $("#access-modal");
  const form = dialog.querySelector("form");
  const done = dialog.querySelector(".access-done");
  const submit = form.querySelector("[type=submit]");
  const { username, password } = form.elements;
  let mode = "create";   // create | password
  let client = null;
  let saving = false;
  let credentials = "";

  wireDialog(dialog, { canClose: () => !saving });
  // Ao fechar, nada da senha fica na página
  dialog.addEventListener("close", () => {
    password.value = "";
    credentials = "";
    done.querySelector("[data-done-password]").textContent = "";
    password.type = "password";
  });

  function open(nextMode, nextClient, user = "") {
    mode = nextMode;
    client = nextClient;
    form.reset();
    showFieldErrors(form, {});
    form.hidden = false;
    done.hidden = true;
    password.type = "password";
    dialog.querySelector("#access-modal-title").textContent = mode === "create" ? "Criar acesso ao portal" : "Trocar senha do acesso";
    dialog.querySelector("#access-modal-text").textContent = `Cliente: ${client.name}`;
    submit.querySelector("span").textContent = mode === "create" ? "Criar acesso" : "Trocar senha";
    username.value = mode === "create" ? slugify(client.slug || client.name).slice(0, USERNAME_LIMITS.max) : user;
    username.readOnly = mode !== "create";
    dialog.showModal();
    (mode === "create" ? username : password).focus();
  }

  function showDone(user, pass) {
    credentials = `Portal de clientes Digital Galaxy\nEndereço: ${PORTAL_URL}\nUsuário: ${user}\nSenha: ${pass}`;
    done.querySelector("[data-done-title]").textContent = mode === "create" ? "Acesso criado" : "Senha trocada";
    done.querySelector("[data-done-user]").textContent = user;
    done.querySelector("[data-done-password]").textContent = pass;
    form.hidden = true;
    done.hidden = false;
    password.value = "";
    done.querySelector('[data-access="copy"]').focus();
  }

  dialog.querySelector('[data-access="generate"]').addEventListener("click", () => {
    password.value = generatePassword(username.value.trim().toLowerCase());
    password.type = "text";
    showFieldErrors(form, {});
    password.focus();
  });
  dialog.querySelector('[data-access="toggle"]').addEventListener("click", (event) => {
    password.type = password.type === "password" ? "text" : "password";
    event.currentTarget.setAttribute("aria-pressed", String(password.type === "text"));
  });
  dialog.querySelector('[data-access="copy"]').addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(credentials); toast("Dados de acesso copiados"); }
    catch { toast("Não foi possível copiar. Selecione e copie os dados manualmente.", "info"); }
  });
  dialog.querySelector('[data-access="finish"]').addEventListener("click", () => closeDialog(dialog));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = username.value.trim().toLowerCase();
    const pass = password.value;
    saving = true;
    setBusy(submit, true);
    try {
      if (mode === "create") await api.createClientAccess(client.id, { username: user, password: pass });
      else await api.setClientPassword(user, pass);
      showDone(user, pass);
      toast(mode === "create" ? "Acesso ao portal criado" : "Senha trocada");
      await onChanged();
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.fields && Object.keys(error.fields).length ? "" : error.message);
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  const list = $("#clients-list");
  on(list, "click", "[data-portal-create]", (event, btn) => {
    const target = state.clients.find((c) => c.id === btn.dataset.portalCreate);
    if (target) open("create", target);
  });
  on(list, "click", "[data-portal-password]", (event, btn) => {
    const target = state.clients.find((c) => c.id === btn.dataset.client);
    if (target) open("password", target, btn.dataset.portalPassword);
  });
  on(list, "click", "[data-portal-remove]", async (event, btn) => {
    const user = btn.dataset.portalRemove;
    const ok = await confirm({ title: `Remover o acesso "${user}"?`, text: "O cliente deixa de entrar no portal com este usuário. Os conteúdos não são apagados.", confirmLabel: "Remover acesso" });
    if (!ok) return;
    try {
      await api.removeClientAccess(user);
      toast("Acesso removido");
      await onChanged();
    } catch (error) {
      toast(error.message, "error");
    }
  });

  return { open };
}

/** Bloco "Acesso ao portal" do cartão do cliente */
export function portalBlock(client) {
  const users = client.portal_users || [];
  const rows = users.map((user) => `
    <li class="portal-user">
      <code class="portal-user__name">${esc(user)}</code>
      <span class="portal-user__actions">
        <button class="link-btn" type="button" data-portal-password="${esc(user)}" data-client="${esc(client.id)}">Trocar senha</button>
        <button class="link-btn link-btn--danger" type="button" data-portal-remove="${esc(user)}">Remover</button>
      </span>
    </li>`).join("");
  const create = client.active
    ? `<button class="btn btn--ghost btn--sm" type="button" data-portal-create="${esc(client.id)}">${icon("user")}<span>${users.length ? "Criar outro acesso" : "Criar acesso ao portal"}</span></button>`
    : (users.length ? "" : '<span class="field__optional">Ative o cliente para criar o acesso.</span>');
  return `
    <div class="client-card__access">
      <span class="client-card__portal">${icon("lock")}${users.length ? "Acesso ao portal" : "Sem acesso ao portal"}</span>
      ${rows ? `<ul class="portal-users">${rows}</ul>` : ""}
      ${create}
    </div>`;
}

export const PASSWORD_HINT = `Pelo menos ${PASSWORD_LIMITS.min} caracteres, sem conter o usuário. Use "Gerar senha" para uma senha forte.`;
