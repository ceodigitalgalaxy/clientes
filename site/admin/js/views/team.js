/* Equipe (só administrador): quem entra no painel, perfil, clientes liberados,
   permissões e a carga de demandas de cada pessoa.
   Criar login, trocar senha e ativar/desativar passam pela função "equipe"
   (a chave secreta fica no servidor). Nome, função, perfil, clientes e
   permissões são gravados direto no banco, que só deixa o administrador. */

import { $, esc, on } from "../../../js/lib/dom.js?v=424169d0b1";
import { icon } from "../../../js/lib/icons.js?v=424169d0b1";
import { ROLES, validateMember, parseUsername } from "../domain/rules.js?v=424169d0b1";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=424169d0b1";
import { stateBlock, loadingCards } from "../ui/states.js?v=424169d0b1";
import { generatePassword } from "./access.js?v=424169d0b1";
import { daysUntil } from "./contents.js?v=424169d0b1";
import { deadlineOf, isOpenTask } from "./tasks.js?v=424169d0b1";

const PANEL_URL = "https://clientes.digitalgalaxy.com.br/admin/";

export function setupTeam({ api, state, toast, confirm, loadTeam }) {
  const list = $("#team-list");
  const dialog = $("#member-modal");
  const form = dialog.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  let editing = null;
  let saving = false;
  let contents = [];

  wireDialog(dialog, { canClose: () => !saving });
  dialog.addEventListener("close", () => { form.elements.password.value = ""; });

  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "Cliente removido";
  const nameOf = (m) => m.name || m.username || "Sem nome";

  /** Carga: demandas abertas e atrasadas de cada pessoa */
  function workload(userId) {
    const open = contents.filter((c) => (c.assignees || []).includes(userId) && isOpenTask(c));
    const late = open.filter((c) => !["pronto_para_agendar", "agendado"].includes(c.production_status) && (daysUntil(deadlineOf(c)) ?? 1) < 0);
    return { open: open.length, late: late.length };
  }

  function card(m) {
    const w = workload(m.user_id);
    const me = m.user_id === state.me?.user_id;
    const clients = m.role === "admin" || m.all_clients ? "Todos os clientes" : (m.client_ids || []).map(clientName).join(", ") || "Nenhum cliente";
    const perms = m.role === "admin" ? "Acesso completo" : [m.edit_scope === "todos" ? "Edita todos os conteúdos" : "Edita só as próprias demandas", m.can_send_approval ? "envia para aprovação" : "não envia para aprovação"].join(" · ");
    return `
      <article class="member-card${m.active === false ? " is-off" : ""}" data-member="${esc(m.user_id)}">
        <div class="member-card__head">
          <span class="avatar avatar--lg">${esc(nameOf(m).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>
          <div class="member-card__who">
            <p class="member-card__name">${esc(nameOf(m))}${me ? ' <span class="field__optional">(você)</span>' : ""}</p>
            <p class="member-card__job">${esc(m.job_title || ROLES[m.role] || "")} · <span class="member-card__user">@${esc(m.username || "")}</span></p>
          </div>
          <span class="appr-chip ${m.active === false ? "appr-chip--neutral" : m.role === "admin" ? "appr-chip--reenviado" : "appr-chip--aprovado"}">${esc(m.active === false ? "Desativado" : ROLES[m.role] || m.role)}</span>
        </div>
        <dl class="member-card__facts">
          <div><dt>Clientes</dt><dd>${esc(clients)}</dd></div>
          <div><dt>Permissões</dt><dd>${esc(perms)}</dd></div>
          ${m.email ? `<div><dt>E-mail</dt><dd>${esc(m.email)}</dd></div>` : ""}
        </dl>
        <ul class="member-card__load" aria-label="Carga de demandas">
          <li><b>${w.open}</b><span>em aberto</span></li>
          <li class="${w.late ? "is-late" : ""}"><b>${w.late}</b><span>atrasadas</span></li>
        </ul>
        <div class="member-card__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-member-tasks="${esc(m.user_id)}">${icon("list")}<span>Ver demandas</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-member-edit="${esc(m.user_id)}">${icon("edit")}<span>Editar</span></button>
          ${me ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-member-password="${esc(m.user_id)}">${icon("lock")}<span>Nova senha</span></button>
          <button class="btn btn--ghost btn--sm ${m.active === false ? "" : "btn--danger-text"}" type="button" data-member-active="${esc(m.user_id)}">${icon(m.active === false ? "refresh" : "close")}<span>${m.active === false ? "Reativar" : "Desativar"}</span></button>`}
        </div>
      </article>`;
  }

  function render() {
    list.setAttribute("aria-busy", "false");
    const people = state.team;
    list.innerHTML = people.length
      ? people.map(card).join("")
      : stateBlock({ iconName: "users", title: "Só você por aqui", text: "Cadastre colaboradores e libere para cada um só os clientes em que ele trabalha." });
  }

  async function load() {
    list.setAttribute("aria-busy", "true");
    list.innerHTML = loadingCards();
    try {
      const [, rows] = await Promise.all([loadTeam(), api.listContents({})]);
      contents = rows;
      render();
    } catch (error) {
      list.setAttribute("aria-busy", "false");
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar a equipe", text: error.message });
    }
  }

  /* ---------- Formulário ---------- */
  function syncRole() {
    const collab = form.querySelector("[name=role]:checked")?.value !== "admin";
    form.querySelectorAll("[data-collab-only]").forEach((el) => { el.hidden = !collab; });
    const all = form.elements.all_clients.checked;
    form.querySelector("[data-member-clients]").hidden = all;
  }
  function openForm(member = null) {
    editing = member;
    form.reset();
    showFieldErrors(form, {});
    dialog.querySelector("#member-modal-title").textContent = member ? `Editar ${nameOf(member)}` : "Nova pessoa na equipe";
    submit.querySelector("span").textContent = member ? "Salvar" : "Criar acesso";
    form.querySelectorAll("[data-create-only]").forEach((el) => { el.hidden = Boolean(member); });
    const chosen = new Set(member?.client_ids || []);
    form.querySelector("[data-member-clients]").innerHTML = state.clients.length
      ? state.clients.map((c) => `<label class="check"><input type="checkbox" name="client_id" value="${esc(c.id)}" ${chosen.has(c.id) ? "checked" : ""}><span>${esc(c.name)}${c.active ? "" : ' <span class="field__optional">(inativo)</span>'}</span></label>`).join("")
      : '<p class="field__hint">Cadastre clientes primeiro.</p>';
    if (member) {
      form.elements.name.value = member.name || "";
      form.elements.job_title.value = member.job_title || "";
      form.elements.email.value = member.email || "";
      form.querySelector(`[name=role][value="${member.role}"]`).checked = true;
      form.elements.all_clients.checked = Boolean(member.all_clients);
      form.querySelector(`[name=edit_scope][value="${member.edit_scope || "atribuidos"}"]`).checked = true;
      form.elements.can_send_approval.checked = Boolean(member.can_send_approval);
      // Ninguém tira o próprio perfil de administrador (o banco também recusa)
      form.querySelectorAll("[name=role]").forEach((r) => { r.disabled = member.user_id === state.me?.user_id; });
    } else {
      form.querySelectorAll("[name=role]").forEach((r) => { r.disabled = false; });
      form.elements.password.value = generatePassword();
    }
    syncRole();
    dialog.showModal();
    form.elements.name.focus();
  }
  form.querySelectorAll("[name=role]").forEach((r) => r.addEventListener("change", syncRole));
  form.elements.all_clients.addEventListener("change", syncRole);
  on(form, "click", '[data-action="new-password"]', () => { form.elements.password.value = generatePassword(parseUsername(form.elements.username.value) || ""); });

  const readForm = () => {
    const data = Object.fromEntries(new FormData(form));
    data.role = form.querySelector("[name=role]:checked")?.value || editing?.role;
    data.all_clients = form.elements.all_clients.checked;
    data.can_send_approval = form.elements.can_send_approval.checked;
    data.client_ids = [...form.querySelectorAll("[name=client_id]:checked")].map((b) => b.value);
    return data;
  };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = readForm();
    const { errors } = validateMember(data);
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    saving = true;
    setBusy(submit, true);
    try {
      if (editing) {
        await api.updateMember(editing.user_id, data, editing.client_ids || []);
        closeDialog(dialog);
        toast(`${data.name} atualizado`);
      } else {
        const created = await api.createMember(data);
        const credentials = `Acesso ao painel da Digital Galaxy\n${PANEL_URL}\nUsuário: ${created.username}\nSenha: ${data.password}`;
        const copied = await copyText(credentials);
        closeDialog(dialog);
        await confirm({
          title: `Acesso de ${data.name} criado`,
          text: `${copied ? "Copiamos o usuário e a senha. " : ""}Usuário: ${created.username} · Senha: ${data.password}. Envie para a pessoa: a senha não fica guardada no painel.`,
          confirmLabel: "Pronto", tone: "primary"
        });
      }
      await load();
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.message);
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  /* ---------- Ações dos cartões ---------- */
  const find = (id) => state.team.find((m) => m.user_id === id);
  on(document, "click", '[data-action="new-member"]', () => openForm());
  on(list, "click", "[data-member-edit]", (event, b) => { const m = find(b.dataset.memberEdit); if (m) openForm(m); });
  on(list, "click", "[data-member-tasks]", (event, b) => {
    location.hash = "#/demandas";
    // A tela de demandas lê a pessoa escolhida no seletor
    setTimeout(() => {
      const select = document.querySelector("[data-task-person]");
      if (select) { select.value = b.dataset.memberTasks; select.dispatchEvent(new Event("change", { bubbles: true })); }
    }, 400);
  });
  on(list, "click", "[data-member-password]", async (event, b) => {
    const m = find(b.dataset.memberPassword);
    if (!m) return;
    const ok = await confirm({ title: `Gerar uma nova senha para ${nameOf(m)}?`, text: "A senha atual para de funcionar na hora.", confirmLabel: "Gerar nova senha", tone: "primary" });
    if (!ok) return;
    const password = generatePassword(m.username || "");
    try {
      await api.setMemberPassword(m.user_id, password);
      const copied = await copyText(`Acesso ao painel da Digital Galaxy\n${PANEL_URL}\nUsuário: ${m.username}\nSenha: ${password}`);
      await confirm({ title: `Nova senha de ${nameOf(m)}`, text: `${copied ? "Copiamos o usuário e a senha. " : ""}Usuário: ${m.username} · Senha: ${password}`, confirmLabel: "Pronto", tone: "primary" });
    } catch (error) { toast(error.message, "error"); }
  });
  on(list, "click", "[data-member-active]", async (event, b) => {
    const m = find(b.dataset.memberActive);
    if (!m) return;
    const activate = m.active === false;
    if (!activate) {
      const ok = await confirm({ title: `Desativar ${nameOf(m)}?`, text: "A pessoa sai do painel na hora e não entra mais até ser reativada. As demandas e o histórico dela continuam.", confirmLabel: "Desativar" });
      if (!ok) return;
    }
    b.disabled = true;
    try {
      await api.setMemberActive(m.user_id, activate);
      toast(activate ? `${nameOf(m)} pode entrar de novo` : `${nameOf(m)} foi desativado`);
      await load();
    } catch (error) { b.disabled = false; toast(error.message, "error"); }
  });

  return { load };
}
