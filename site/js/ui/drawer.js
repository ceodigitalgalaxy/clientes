/* ==========================================================================
   Painel lateral com os detalhes de um conteúdo
   Abre por cima do calendário (que continua visível ao fundo) e concentra
   as três ações do cliente: aprovar, solicitar alteração e observar.
   ========================================================================== */

import { esc, on, reduceMotion } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { longDayLabel, timeLabel, stampLabel } from "../lib/dates.js";
import { ACTIVITY_TYPES, PLATFORMS } from "../domain/model.js";
import { statusOf, latestDecision } from "../domain/status.js";
import { typeBadge, statusBadge } from "./badges.js";
import { renderPreview } from "./preview.js";
import { toast } from "./toast.js";

export function createDrawer({ dialog, repo, getContext, onChange }) {
  let activity = null;
  let comments = [];
  let mode = "idle"; // idle | confirm-approve | request-change

  const approvalsFor = () => getContext().approvals.filter((a) => a.activityId === activity.id);

  /* ---------- Blocos ---------- */
  const meta = () => {
    const t = ACTIVITY_TYPES[activity.type] || ACTIVITY_TYPES.outro;
    const rows = [
      ["calendar", "Data", longDayLabel(activity.date)],
      activity.time ? ["clock", "Horário", timeLabel(activity.time)] : null,
      [t.icon, "Formato", t.label],
      ["target", "Onde", activity.platforms.map((p) => PLATFORMS[p] || p).join(", ")]
    ].filter(Boolean);
    return `<dl class="facts">${rows.map(([ic, label, value]) => `
      <div class="facts__row"><dt>${icon(ic)}${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;
  };

  const section = (title, body, extra = "") => body ? `
    <section class="detail">
      <div class="detail__head"><h3 class="detail__title">${title}</h3>${extra}</div>
      ${body}
    </section>` : "";

  const approvalBlock = () => {
    if (!activity.requiresApproval) {
      return `<div class="decision decision--info">${icon("calendar")}<p>Esta atividade não precisa de aprovação. Se quiser comentar algo, deixe uma observação abaixo.</p></div>`;
    }
    const approvals = approvalsFor();
    const status = statusOf(activity, approvals);
    const decision = latestDecision(activity, approvals);
    const older = approvals.filter((a) => a.version < activity.version).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);

    if (mode === "confirm-approve") {
      return `
        <div class="decision decision--confirm">
          <p class="decision__title">Aprovar este conteúdo?</p>
          <p class="decision__text">Depois de aprovado, ele segue para publicação na data combinada.</p>
          <div class="decision__actions">
            <button class="btn btn--success" type="button" data-do="approve">${icon("check")}Sim, aprovar</button>
            <button class="btn btn--ghost" type="button" data-do="cancel">Voltar</button>
          </div>
        </div>`;
    }
    if (mode === "request-change") {
      return `
        <form class="decision decision--form" data-form="change" novalidate>
          <label class="field">
            <span class="field__label">O que você gostaria de mudar?</span>
            <textarea class="field__input field__input--area" name="message" rows="4" maxlength="800" required placeholder="Ex.: trocar a foto da capa, ajustar o preço, mudar uma palavra da legenda..."></textarea>
          </label>
          <div class="decision__actions">
            <button class="btn btn--primary" type="submit">${icon("send")}Enviar pedido</button>
            <button class="btn btn--ghost" type="button" data-do="cancel">Cancelar</button>
          </div>
        </form>`;
    }

    const versionNote = activity.version > 1 && status === "aguardando" && older
      ? `<p class="decision__note">${icon("refresh")}Nova versão preparada depois do seu pedido de ${older.decision === "ajustes" ? "ajuste" : "revisão"}.</p>` : "";

    if (status === "aprovado") {
      return `
        <div class="decision decision--aprovado">
          <span class="decision__icon">${icon("check")}</span>
          <div>
            <p class="decision__title">Conteúdo aprovado</p>
            <p class="decision__text">Você aprovou em ${esc(stampLabel(decision.createdAt))}. Obrigado!</p>
            <button class="link-btn" type="button" data-do="request">Pedir uma alteração mesmo assim</button>
          </div>
        </div>`;
    }
    if (status === "ajustes") {
      return `
        <div class="decision decision--ajustes">
          <span class="decision__icon">${icon("edit")}</span>
          <div>
            <p class="decision__title">Ajustes solicitados</p>
            <p class="decision__text">Seu pedido em ${esc(stampLabel(decision.createdAt))}:</p>
            <blockquote class="decision__quote">${esc(decision.message)}</blockquote>
            <p class="decision__text">Nossa equipe vai preparar uma nova versão e ela aparece aqui para você aprovar.</p>
          </div>
        </div>
        <div class="decision__actions decision__actions--split">
          <button class="btn btn--primary" type="button" data-do="confirm">${icon("check")}Aprovar conteúdo</button>
          <button class="btn btn--ghost" type="button" data-do="request">Solicitar outra alteração</button>
        </div>`;
    }
    return `
      <div class="decision decision--aguardando">
        <span class="decision__icon">${icon("clock")}</span>
        <div>
          <p class="decision__title">Este conteúdo espera a sua aprovação</p>
          <p class="decision__text">Confira a prévia, a ideia e a legenda. Se estiver tudo certo, é só aprovar.</p>
          ${versionNote}
        </div>
      </div>
      <div class="decision__actions decision__actions--split">
        <button class="btn btn--primary" type="button" data-do="confirm">${icon("check")}Aprovar conteúdo</button>
        <button class="btn btn--ghost" type="button" data-do="request">${icon("edit")}Solicitar alteração</button>
      </div>`;
  };

  const commentsBlock = () => `
    <section class="detail">
      <div class="detail__head"><h3 class="detail__title">Observações</h3></div>
      ${comments.length ? `<ul class="notes">${comments.map((c) => `
        <li class="note note--${esc(c.author.role)}">
          <span class="avatar avatar--xs ${c.author.role === "agencia" ? "avatar--brand" : ""}">${c.author.role === "agencia" ? "DG" : esc(getContext().client.initials)}</span>
          <div class="note__body">
            <p class="note__meta"><b>${c.author.role === "agencia" ? "Digital Galaxy" : "Você"}</b> · ${esc(stampLabel(c.createdAt))}</p>
            <p class="note__text">${esc(c.text)}</p>
          </div>
        </li>`).join("")}</ul>` : `<p class="notes__empty">Nenhuma observação ainda. Deixe um comentário, sugestão ou dúvida sobre este conteúdo.</p>`}
      <form class="note-form" data-form="comment" novalidate>
        <label class="visually-hidden" for="note-text">Escreva uma observação</label>
        <textarea class="field__input field__input--area" id="note-text" name="text" rows="2" maxlength="800" required placeholder="Escreva uma observação..."></textarea>
        <button class="btn btn--ghost btn--sm" type="submit">${icon("message")}Adicionar observação</button>
      </form>
    </section>`;

  const render = (keepScroll = false) => {
    const body = dialog.querySelector(".drawer__body");
    const scroll = keepScroll && body ? body.scrollTop : 0;
    const { client } = getContext();
    const status = statusOf(activity, approvalsFor());
    const copy = activity.caption ? `<button class="link-btn" type="button" data-do="copy">${icon("copy")}Copiar</button>` : "";
    dialog.innerHTML = `
      <div class="drawer__panel">
        <header class="drawer__header">
          <div class="drawer__badges">${typeBadge(activity.type, true)}${statusBadge(status)}</div>
          <button class="icon-btn" type="button" data-do="close" aria-label="Fechar detalhes">${icon("close")}</button>
        </header>
        <div class="drawer__body">
          <h2 class="drawer__title" id="drawer-title">${esc(activity.title)}</h2>
          ${meta()}
          <div class="preview">${renderPreview(activity, client.name)}</div>
          ${section("Objetivo", activity.objective ? `<p class="detail__text">${esc(activity.objective)}</p>` : "")}
          ${section("A ideia", activity.description ? `<p class="detail__text">${esc(activity.description)}</p>` : "")}
          ${section("Legenda", activity.caption ? `<p class="detail__text detail__caption">${esc(activity.caption)}</p>` : "", copy)}
          <section class="detail detail--decision" aria-live="polite">${approvalBlock()}</section>
          ${commentsBlock()}
          <p class="drawer__version">Versão ${activity.version} · atualizada em ${esc(stampLabel(activity.updatedAt))}</p>
        </div>
      </div>`;
    if (keepScroll) dialog.querySelector(".drawer__body").scrollTop = scroll;
  };

  /* ---------- Ações ---------- */
  const close = () => {
    if (!dialog.open) return;
    if (reduceMotion()) { dialog.close(); return; }
    dialog.classList.add("is-closing");
    setTimeout(() => { dialog.classList.remove("is-closing"); dialog.close(); }, 260);
  };

  on(dialog, "click", "[data-do]", async (event, button) => {
    const action = button.dataset.do;
    if (action === "close") return close();
    if (action === "cancel") { mode = "idle"; return render(true); }
    if (action === "confirm") { mode = "confirm-approve"; render(true); dialog.querySelector('[data-do="approve"]')?.focus(); return; }
    if (action === "request") { mode = "request-change"; render(true); dialog.querySelector('textarea[name="message"]')?.focus(); return; }
    if (action === "copy") {
      try { await navigator.clipboard.writeText(activity.caption); toast("Legenda copiada"); } catch { toast("Não foi possível copiar", "info"); }
      return;
    }
    if (action === "approve") {
      button.disabled = true;
      const approval = await repo.addApproval({ activityId: activity.id, version: activity.version, decision: "aprovado" });
      mode = "idle";
      await onChange({ approval });
      render(true);
      toast("Conteúdo aprovado. Obrigado!");
    }
  });

  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const field = form.querySelector("textarea");
    if (!field.value.trim()) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
      return;
    }
    form.querySelector("[type=submit]").disabled = true;
    if (form.dataset.form === "change") {
      const approval = await repo.addApproval({ activityId: activity.id, version: activity.version, decision: "ajustes", message: field.value });
      mode = "idle";
      await onChange({ approval });
      render(true);
      toast("Pedido de alteração enviado");
    } else {
      comments.push(await repo.addComment({ activityId: activity.id, text: field.value }));
      await onChange({});
      render(true);
      const body = dialog.querySelector(".drawer__body");
      dialog.querySelector(".notes")?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
      body.querySelector("#note-text")?.focus();
      toast("Observação adicionada");
    }
  });
  dialog.addEventListener("input", (event) => { if (event.target.value.trim()) event.target.removeAttribute("aria-invalid"); });

  // Clique no fundo fecha; Esc fecha (nativo do <dialog>, com animação aqui)
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });

  return {
    async open(id) {
      activity = getContext().activities.find((a) => a.id === id);
      if (!activity) return;
      mode = "idle";
      comments = await repo.listComments(activity.id);
      render();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector(".drawer__body").scrollTop = 0;
      dialog.querySelector('[data-do="close"]').focus();
    },
    close
  };
}
