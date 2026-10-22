/* ==========================================================================
   Painel lateral com os detalhes de um conteúdo
   Abre por cima do calendário (que continua visível ao fundo) e concentra
   as três ações do cliente: aprovar, solicitar alteração e observar.
   Também abre pelo dia (openDay): lista o que está programado ou avisa que
   o dia está livre. Com dados reais (repo.features), mostra o status
   definido pela agência e as observações liberadas para o cliente; as ações
   que ainda não existem no banco ficam escondidas.
   ========================================================================== */

import { esc, on, reduceMotion } from "../lib/dom.js?v=b3c5769ca7";
import { icon } from "../lib/icons.js?v=b3c5769ca7";
import { longDayLabel, timeLabel, stampLabel } from "../lib/dates.js?v=b3c5769ca7";
import { ACTIVITY_TYPES, PLATFORMS, STATUS } from "../domain/model.js?v=b3c5769ca7";
import { statusOf, latestDecision } from "../domain/status.js?v=b3c5769ca7";
import { typeBadge, statusBadge } from "./badges.js?v=b3c5769ca7";
import { renderPreview, renderFinal, wireCarousel } from "./preview.js?v=b3c5769ca7";
import { wireMediaFallbacks } from "./media.js?v=b3c5769ca7";
import { toast } from "./toast.js?v=b3c5769ca7";

const LIVE_STATUS_TEXT = {
  aguardando: ["Este conteúdo espera a sua aprovação", "Confira a prévia e a legenda. Para aprovar ou pedir ajustes, fale com a nossa equipe pelo canal de sempre."],
  aprovado: ["Conteúdo aprovado", "Ele segue para publicação na data programada."],
  publicado: ["Conteúdo publicado", "Este conteúdo já foi ao ar."]
};

export function createDrawer({ dialog, repo, getContext, onChange }) {
  let activity = null;
  let comments = [];
  let mode = "idle"; // idle | confirm-approve | request-change
  let day = null;     // dia aberto (lista) ou de onde o conteúdo foi aberto
  let view = "detail"; // detail | day
  const features = { approvals: true, comments: true, ...(repo.features || {}) };
  wireMediaFallbacks(dialog);
  wireCarousel(dialog);

  const approvalsFor = () => getContext().approvals.filter((a) => a.activityId === activity.id);

  /* ---------- Blocos ---------- */
  const meta = () => {
    const t = ACTIVITY_TYPES[activity.type] || ACTIVITY_TYPES.outro;
    const rows = [
      ["calendar", "Data", longDayLabel(activity.date)],
      activity.time ? ["clock", "Horário", timeLabel(activity.time)] : null,
      [t.icon, "Formato", t.label],
      ["target", "Rede social", activity.platforms.map((p) => PLATFORMS[p] || p).join(", ")]
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
    // Dados reais: o status vem da agência; aprovar por aqui ainda não existe
    if (!features.approvals) {
      const [title, text] = LIVE_STATUS_TEXT[statusOf(activity, [])] || LIVE_STATUS_TEXT.aguardando;
      return `<div class="decision decision--info">${icon("clock")}<div><p class="decision__title">${esc(title)}</p><p class="decision__text">${esc(text)}</p></div></div>`;
    }
    if (!activity.requiresApproval) {
      return `<div class="decision decision--info">${icon("calendar")}<p>Esta atividade não precisa de aprovação. Se quiser comentar algo, deixe uma observação abaixo.</p></div>`;
    }
    // Dados reais: depois de aprovado, com ajuste pedido ou publicado, a próxima ação é da equipe
    if (activity.status && activity.status !== "aguardando" && mode === "idle") {
      const decision = activity.decision;
      if (activity.status === "publicado") {
        return `<div class="decision decision--aprovado"><span class="decision__icon">${icon("send")}</span><div><p class="decision__title">Conteúdo publicado</p><p class="decision__text">Este conteúdo já foi ao ar.</p></div></div>`;
      }
      if (activity.status === "aprovado") {
        return `<div class="decision decision--aprovado"><span class="decision__icon">${icon("check")}</span><div><p class="decision__title">Conteúdo aprovado</p><p class="decision__text">${decision?.decision === "aprovado" ? `Você aprovou em ${esc(stampLabel(decision.createdAt))}. ` : ""}Ele segue para publicação na data programada.</p></div></div>`;
      }
      return `<div class="decision decision--ajustes"><span class="decision__icon">${icon("edit")}</span><div>
        <p class="decision__title">Ajustes solicitados</p>
        ${decision?.decision === "ajustes" ? `<p class="decision__text">Seu pedido em ${esc(stampLabel(decision.createdAt))}:</p><blockquote class="decision__quote">${esc(decision.message)}</blockquote>` : ""}
        <p class="decision__text">Nossa equipe vai preparar uma nova versão, e ela aparece aqui para você aprovar.</p>
      </div></div>`;
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

  /** Observações que a agência liberou para o cliente (dados reais) */
  const sharedNotes = () => activity.notes ? section("Observações da Digital Galaxy", `
      <div class="note note--agencia note--shared">
        <span class="avatar avatar--xs avatar--brand">DG</span>
        <div class="note__body"><p class="note__text">${esc(activity.notes)}</p></div>
      </div>`) : "";

  const dayItems = () => getContext().activities.filter((a) => a.date === day);

  /** Lista do dia (ou aviso de dia livre) */
  const renderDay = () => {
    const items = dayItems();
    const approvals = getContext().approvals;
    dialog.innerHTML = `
      <div class="drawer__panel">
        <header class="drawer__header">
          <div class="drawer__badges"><span class="type-badge">${icon("calendar")}${items.length ? `${items.length} ${items.length === 1 ? "conteúdo" : "conteúdos"}` : "Dia livre"}</span></div>
          <button class="icon-btn" type="button" data-do="close" aria-label="Fechar">${icon("close")}</button>
        </header>
        <div class="drawer__body">
          <h2 class="drawer__title" id="drawer-title">${esc(longDayLabel(day))}</h2>
          ${items.length ? `<ul class="day-list">${items.map((a) => `
            <li>
              <button class="agenda__item day-list__item" type="button" data-day-item="${esc(a.id)}">
                <span class="agenda__time">${a.time ? timeLabel(a.time) : "Dia todo"}</span>
                <span class="agenda__body">
                  ${typeBadge(a.type)}
                  <span class="agenda__name">${esc(a.title)}</span>
                  ${statusBadge(statusOf(a, approvals))}
                </span>
                ${icon("chevronRight", "icon agenda__go")}
              </button>
            </li>`).join("")}</ul>`
          : `<div class="day-empty">
              <span class="art-empty__icon">${icon("calendar")}</span>
              <p class="art-empty__title">Nada programado para este dia</p>
              <p class="art-empty__text">Quando houver um conteúdo nesta data, ele aparece aqui.</p>
            </div>`}
        </div>
      </div>`;
  };

  /** Celular: aprovar ou pedir alteração sempre à mão, presos embaixo da folha */
  const quickBar = (status) => features.approvals && activity.requiresApproval && status === "aguardando" && mode === "idle" ? `
    <footer class="drawer__quick">
      <button class="btn btn--ghost" type="button" data-do="request">${icon("edit")}Pedir alteração</button>
      <button class="btn btn--primary" type="button" data-do="confirm">${icon("check")}Aprovar</button>
    </footer>` : "";

  const render = (keepScroll = false) => {
    if (view === "day") return renderDay();
    const body = dialog.querySelector(".drawer__body");
    const scroll = keepScroll && body ? body.scrollTop : 0;
    const { client } = getContext();
    const status = statusOf(activity, approvalsFor());
    const copy = activity.caption ? `<button class="link-btn" type="button" data-do="copy">${icon("copy")}Copiar</button>` : "";
    const back = day && dayItems().length > 1 ? `<button class="link-btn drawer__back" type="button" data-do="back">${icon("chevronLeft")}${esc(longDayLabel(day))}</button>` : "";
    dialog.innerHTML = `
      <div class="drawer__panel">
        <header class="drawer__header">
          <div class="drawer__badges">${back}${typeBadge(activity.type, true)}${statusBadge(status)}</div>
          <button class="icon-btn" type="button" data-do="close" aria-label="Fechar detalhes">${icon("close")}</button>
        </header>
        <div class="drawer__body">
          <h2 class="drawer__title" id="drawer-title">${esc(activity.title)}</h2>
          ${meta()}
          ${activity.final?.length
            ? `<section class="detail detail--final"><div class="detail__head"><h3 class="detail__title">${activity.status === "aguardando" ? "Conteúdo para você aprovar" : "Conteúdo final"}</h3>${activity.final.length > 1 ? `<span class="detail__hint">${activity.final.length} itens</span>` : ""}</div><div class="preview preview--final">${renderFinal(activity)}</div></section>
               ${activity.media?.length ? section("Referência", `<div class="preview preview--ref">${renderPreview(activity)}</div>`) : ""}`
            : `<div class="preview">${renderPreview(activity, client.name)}</div>`}
          ${section("Objetivo", activity.objective ? `<p class="detail__text">${esc(activity.objective)}</p>` : "")}
          ${section("A ideia", activity.description ? `<p class="detail__text">${esc(activity.description)}</p>` : "")}
          ${section("Legenda", activity.caption ? `<p class="detail__text detail__caption">${esc(activity.caption)}</p>` : (features.approvals ? "" : `<p class="detail__text detail__muted">A legenda ainda está sendo preparada.</p>`), copy)}
          ${sharedNotes()}
          <section class="detail detail--decision" aria-live="polite">${approvalBlock()}</section>
          ${features.comments ? commentsBlock() : ""}
          <p class="drawer__version">Versão ${activity.version} · atualizada em ${esc(stampLabel(activity.updatedAt))}</p>
        </div>
        ${quickBar(status)}
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
    if (action === "back") { view = "day"; render(); dialog.querySelector("[data-day-item]")?.focus(); return; }
    if (action === "cancel") { mode = "idle"; return render(true); }
    if (action === "confirm") { mode = "confirm-approve"; render(true); dialog.querySelector('[data-do="approve"]')?.focus(); return; }
    if (action === "request") { mode = "request-change"; render(true); dialog.querySelector('textarea[name="message"]')?.focus(); return; }
    if (action === "copy") {
      try { await navigator.clipboard.writeText(activity.caption); toast("Legenda copiada"); } catch { toast("Não foi possível copiar", "info"); }
      return;
    }
    if (action === "approve") {
      button.disabled = true;
      button.classList.add("is-loading");
      await decide({ decision: "aprovado" }, "Conteúdo aprovado. Obrigado!");
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
      await decide({ decision: "ajustes", message: field.value }, "Pedido de alteração enviado");
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

  on(dialog, "click", "[data-day-item]", (event, button) => { showActivity(button.dataset.dayItem); });

  /** Aprovar ou pedir ajuste; depois recarrega para mostrar o status novo */
  async function decide({ decision, message = "" }, success) {
    const id = activity.id;
    try {
      const approval = await repo.addApproval({ activityId: id, version: activity.version, decision, message });
      mode = "idle";
      await onChange({ approval });
      activity = getContext().activities.find((a) => a.id === id) || activity;
      render(true);
      toast(success);
    } catch (error) {
      mode = "idle";
      await onChange({}).catch(() => {});
      activity = getContext().activities.find((a) => a.id === id) || activity;
      render(true);
      toast(error.message || "Não foi possível enviar agora. Tente de novo.", "info");
    }
  }

  async function showActivity(id) {
    activity = getContext().activities.find((a) => a.id === id);
    if (!activity) return false;
    view = "detail";
    mode = "idle";
    comments = features.comments ? await repo.listComments(activity.id) : [];
    render();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".drawer__body").scrollTop = 0;
    dialog.querySelector('[data-do="back"], [data-do="close"]').focus();
    return true;
  }

  /** Assinatura do que o cliente vê: muda quando a agência edita */
  const signature = (a) => a ? [a.id, a.version, a.status, a.date, a.time, a.updatedAt].join("|") : "";

  // Clique no fundo fecha; Esc fecha (nativo do <dialog>, com animação aqui)
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });

  return {
    /** Detalhes de um conteúdo (de: dia de onde veio, para o botão "voltar") */
    async open(id, { from = null } = {}) {
      day = from;
      return showActivity(id);
    },

    /** Dia: um conteúdo abre direto; vários viram lista; nenhum mostra o aviso */
    async openDay(iso) {
      day = iso;
      const items = dayItems();
      if (items.length === 1) return showActivity(items[0].id);
      view = "day";
      activity = null;
      render();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector("[data-day-item], [data-do='close']").focus();
      return true;
    },

    /** Dados novos (atualização automática): redesenha só se algo mudou */
    refresh() {
      if (!dialog.open) return;
      if (view === "day") { renderDay(); return; }
      if (!activity) return;
      const next = getContext().activities.find((a) => a.id === activity.id);
      if (!next) {
        close();
        toast("O conteúdo que você estava vendo mudou de data ou foi removido.", "info");
        return;
      }
      if (signature(next) === signature(activity) && next.caption === activity.caption && next.notes === activity.notes && next.title === activity.title && JSON.stringify(next.media) === JSON.stringify(activity.media)) return;
      activity = next;
      render(true);
    },

    get openId() { return dialog.open && view === "detail" ? activity?.id : null; },
    close
  };
}
