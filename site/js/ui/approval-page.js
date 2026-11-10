/* ==========================================================================
   Página de aprovação (o que o cliente vê pelo link)
   --------------------------------------------------------------------------
   Usada pela página pública (aprovacao/index.html) e pela pré-visualização
   da equipe ("Visualizar como cliente", só leitura).
   - Cabeçalho com o cliente, o mês, o título e a mensagem do lote.
   - Aviso do MODO (planejamento x conteúdo final): o cliente sabe o que aprova.
   - Progresso (aguardando / aprovados / ajustes) e barra.
   - Lista (principal) ou calendário (no celular vira agenda por dia), com
     filtros de formato, rede e status.
   - Cartão: data, formato, rede, prévia/galeria/vídeo, ideia, roteiro, texto
     na arte, objetivo, legenda, CTA e status; Aprovar conteúdo / Solicitar
     ajuste (comentário obrigatório). Aprovar todos os pendentes, com
     confirmação. Na primeira ação, pede um nome para o histórico.
   Tudo o que vem do banco passa por esc(): nada vira HTML.
   ========================================================================== */

import { esc, on } from "../lib/dom.js?v=887272bbb7";
import { icon, brandMark } from "../lib/icons.js?v=887272bbb7";
import { monthLabel, monthName, longDayLabel, timeLabel, monthGrid, WEEKDAYS_SHORT, stampLabel } from "../lib/dates.js?v=887272bbb7";
import { ACTIVITY_TYPES, PLATFORMS } from "../domain/model.js?v=887272bbb7";
import { APPROVAL_STATUS, APPROVAL_MODES, isPending } from "../domain/approvals.js?v=887272bbb7";
import { renderFinal, wireCarousel } from "./preview.js?v=887272bbb7";
import { wireMediaFallbacks } from "./media.js?v=887272bbb7";
import { toast } from "./toast.js?v=887272bbb7";

const NAME_KEY = "dg-aprovacao-nome";
const SESSION_KEY = "dg-aprovacao-sessao";
const safe = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };

/** Identificador da sessão de aprovação (não identifica a pessoa) */
function sessionId() {
  let id = safe.get(SESSION_KEY);
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = (globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
    safe.set(SESSION_KEY, id);
  }
  return id;
}

const statusBadge = (status) => {
  const s = APPROVAL_STATUS[status] || APPROVAL_STATUS.aguardando_aprovacao;
  return `<span class="ap-badge ap-badge--${esc(s.tone)}">${icon(s.icon)}${esc(s.label)}</span>`;
};
const typeOf = (format) => ACTIVITY_TYPES[format] || ACTIVITY_TYPES.outro;
const networkOf = (network) => PLATFORMS[network] || "Outra rede";
const dateLine = (c) => `${longDayLabel(c.scheduled_date)}${c.scheduled_time ? ` · ${timeLabel(c.scheduled_time)}` : ""}`;

/** Galeria/vídeo/PDF do conteúdo: capa primeiro, thumbnail só como capa do vídeo */
function mediaBlock(item, mode) {
  const assets = item.content?.assets || [];
  const pdfs = assets.filter((a) => a.kind === "pdf" && a.src);
  const visual = assets.filter((a) => a.kind !== "pdf" && a.role !== "thumbnail");
  const cover = visual.find((a) => a.role === "capa");
  const ordered = cover ? [cover, ...visual.filter((a) => a !== cover)] : visual;
  const parts = [];
  if (ordered.length) {
    parts.push(`<div class="ap-media${mode === "planejamento" ? " ap-media--draft" : ""}">
      ${mode === "planejamento" ? `<span class="ap-media__tag">${icon("lightbulb")}Prévia: não é a arte final</span>` : ""}
      ${renderFinal({ title: item.content.title, final: ordered.map((a) => ({ kind: a.kind, src: a.src })) })}
    </div>`);
  }
  if (pdfs.length) {
    parts.push(`<ul class="ap-files">${pdfs.map((a) => `<li><a class="pdf-card" href="${esc(a.src)}" target="_blank" rel="noopener noreferrer">${icon("download")}<span>${esc(a.name || "Arquivo PDF")}</span></a></li>`).join("")}</ul>`);
  }
  return parts.join("");
}

const textSection = (iconName, title, text, cls = "") => text
  ? `<section class="ap-sec ${cls}"><h4 class="ap-sec__title">${icon(iconName)}${esc(title)}</h4><p class="ap-sec__text">${esc(text)}</p></section>`
  : "";

/**
 * @param {HTMLElement} root
 * @param {object} options
 * @param {boolean} [options.preview]  equipe vendo (sem decidir)
 * @param {(payload: object) => Promise<object>} [options.decide]  { item, version, decision, comment, name, session } → nova visão
 * @param {(payload: object) => Promise<object>} [options.approveAll]  { items: [{item, version}], name, session } → { view, approved, skipped }
 */
export function createApprovalPage(root, { preview = false, decide, approveAll } = {}) {
  let view = null;
  let layout = "lista";
  const filters = { format: "", network: "", status: "" };
  const busy = new Set();
  let confirming = null;     // item com "confirmar aprovação" aberto
  let adjusting = null;      // item com o campo de ajuste aberto
  const drafts = new Map();  // texto do ajuste ainda não enviado

  const dialog = document.createElement("dialog");
  dialog.className = "ap-dialog";
  document.body.append(dialog);
  wireCarousel(root); wireCarousel(dialog);
  wireMediaFallbacks(root); wireMediaFallbacks(dialog);

  const items = () => view?.items || [];
  const counts = () => {
    const list = items();
    return {
      total: list.length,
      pending: list.filter((i) => isPending(i.status)).length,
      approved: list.filter((i) => i.status === "aprovado").length,
      adjust: list.filter((i) => i.status === "ajustes").length
    };
  };
  const visible = () => items().filter((i) => {
    const c = i.content;
    if (!c) return false;
    if (filters.format && c.format !== filters.format) return false;
    if (filters.network && c.network !== filters.network) return false;
    if (filters.status === "pendente" && !isPending(i.status)) return false;
    if (filters.status && filters.status !== "pendente" && i.status !== filters.status) return false;
    return true;
  });

  /* ---------- Blocos ---------- */
  function header() {
    const b = view.batch;
    const mode = APPROVAL_MODES[b.mode] || APPROVAL_MODES.planejamento;
    const n = counts().total;
    const month = monthName(b.month).toLowerCase();
    const done = n > 0 && counts().pending === 0;
    return `
      <header class="ap-hero">
        <div class="ap-hero__brand">
          ${view.client.logo ? `<img class="ap-hero__logo" src="${esc(view.client.logo)}" alt="" referrerpolicy="no-referrer">` : `<span class="ap-hero__logo ap-hero__logo--initials" aria-hidden="true">${esc((view.client.name || "·").slice(0, 2).toUpperCase())}</span>`}
          <div><p class="ap-hero__client">${esc(view.client.name)}</p><p class="ap-hero__month">${icon("calendar")}${esc(monthLabel(b.month))}</p></div>
        </div>
        <p class="ap-hero__eyebrow">${esc(b.title)}</p>
        <h1 class="ap-hero__title">${done ? "Obrigado! Tudo revisado." : b.mode === "final" ? `Seus conteúdos de ${esc(month)} estão prontos!` : `Seu planejamento de ${esc(month)} está pronto!`}</h1>
        <p class="ap-hero__text">${b.intro ? esc(b.intro) : `Preparamos ${n} ${n === 1 ? "conteúdo" : "conteúdos"} para você revisar. Confira ${esc(mode.what)} e aprove o que estiver de acordo.`}</p>
        <div class="ap-mode ap-mode--${esc(b.mode)}" role="note">
          <span class="ap-mode__icon">${icon(mode.icon)}</span>
          <div><p class="ap-mode__title">${esc(mode.label)}</p><p class="ap-mode__text">${esc(mode.note)}</p></div>
        </div>
        ${b.expires_at ? `<p class="ap-hero__expires">${icon("clock")}Este link vale até ${esc(stampLabel(b.expires_at))}.</p>` : ""}
      </header>`;
  }

  function progress() {
    const c = counts();
    const reviewed = c.approved + c.adjust;
    const pct = c.total ? Math.round((reviewed / c.total) * 100) : 0;
    return `
      <section class="ap-progress" aria-label="Progresso da revisão">
        <ul class="ap-stats">
          <li class="ap-stat ap-stat--aguardando"><b>${c.pending}</b><span>Aguardando aprovação</span></li>
          <li class="ap-stat ap-stat--aprovado"><b>${c.approved}</b><span>Aprovados</span></li>
          <li class="ap-stat ap-stat--ajustes"><b>${c.adjust}</b><span>Ajustes solicitados</span></li>
        </ul>
        <div class="ap-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${reviewed}" aria-label="${reviewed} de ${c.total} conteúdos revisados">
          <span class="ap-bar__fill" data-pct="${pct}"></span>
        </div>
        <p class="ap-progress__text"><b>${reviewed} de ${c.total}</b> ${c.total === 1 ? "conteúdo revisado" : "conteúdos revisados"}</p>
      </section>`;
  }

  function finished() {
    const c = counts();
    if (!c.total || c.pending) return "";
    if (!c.adjust) {
      return `<section class="ap-done ap-done--ok" role="status"><span class="ap-done__icon">${icon("check")}</span><div><h2 class="ap-done__title">Planejamento aprovado!</h2><p>Obrigado! Recebemos sua aprovação. Agora nossa equipe seguirá com a próxima etapa.</p></div></section>`;
    }
    const pendingTitles = items().filter((i) => i.status === "ajustes").map((i) => i.content?.title).filter(Boolean);
    return `<section class="ap-done ap-done--partial" role="status"><span class="ap-done__icon">${icon("message")}</span><div>
      <h2 class="ap-done__title">Recebemos sua revisão</h2>
      <p>${c.approved} ${c.approved === 1 ? "conteúdo aprovado" : "conteúdos aprovados"}. ${c.adjust === 1 ? "Este precisa" : "Estes precisam"} de revisão da nossa equipe:</p>
      <ul class="ap-done__list">${pendingTitles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <p>Quando a nova versão ficar pronta, ela aparece neste mesmo link.</p></div></section>`;
  }

  function toolbar() {
    const list = items();
    const formats = [...new Set(list.map((i) => i.content?.format).filter(Boolean))];
    const networks = [...new Set(list.map((i) => i.content?.network).filter(Boolean))];
    const c = counts();
    const bulk = !preview && view.batch.allow_bulk && c.pending > 0;
    return `
      <div class="ap-tools">
        <div class="ap-switch" role="tablist" aria-label="Como ver">
          <button type="button" role="tab" class="ap-switch__btn" data-ap-layout="lista" aria-selected="${layout === "lista"}">${icon("list")}Lista</button>
          <button type="button" role="tab" class="ap-switch__btn" data-ap-layout="calendario" aria-selected="${layout === "calendario"}">${icon("calendar")}Calendário</button>
        </div>
        <div class="ap-filters">
          <label class="ap-filter"><span class="visually-hidden">Formato</span><select class="field__input" data-ap-filter="format"><option value="">Todos os formatos</option>${formats.map((f) => `<option value="${esc(f)}" ${filters.format === f ? "selected" : ""}>${esc(typeOf(f).label)}</option>`).join("")}</select></label>
          <label class="ap-filter"><span class="visually-hidden">Rede</span><select class="field__input" data-ap-filter="network"><option value="">Todas as redes</option>${networks.map((n) => `<option value="${esc(n)}" ${filters.network === n ? "selected" : ""}>${esc(networkOf(n))}</option>`).join("")}</select></label>
          <label class="ap-filter"><span class="visually-hidden">Status</span><select class="field__input" data-ap-filter="status">
            <option value="">Todos os status</option>
            <option value="pendente" ${filters.status === "pendente" ? "selected" : ""}>Aguardando você</option>
            <option value="aprovado" ${filters.status === "aprovado" ? "selected" : ""}>Aprovados</option>
            <option value="ajustes" ${filters.status === "ajustes" ? "selected" : ""}>Ajustes solicitados</option>
          </select></label>
        </div>
        ${bulk ? `<button class="btn btn--primary ap-bulk" type="button" data-ap-all>${icon("check")}Aprovar todos os pendentes (${c.pending})</button>` : ""}
      </div>`;
  }

  function decisionArea(item) {
    const c = item.content;
    const pending = isPending(item.status);
    const parts = [];
    if (item.status === "reenviado" && item.previous_request?.comment) {
      parts.push(`<p class="ap-revised">${icon("refresh")}<span><b>Revisamos este conteúdo</b> a partir do seu pedido: “${esc(item.previous_request.comment)}”</span></p>`);
    }
    if (item.decision) {
      const who = item.decision.reviewer_name ? ` por ${esc(item.decision.reviewer_name)}` : "";
      parts.push(item.decision.action === "aprovado"
        ? `<p class="ap-decided ap-decided--ok">${icon("check")}<span>Aprovado${who} em ${esc(stampLabel(item.decision.created_at))}.</span></p>`
        : `<div class="ap-decided ap-decided--adjust">${icon("message")}<div><p>Ajuste solicitado${who} em ${esc(stampLabel(item.decision.created_at))}:</p><blockquote>${esc(item.decision.comment)}</blockquote><p class="ap-muted">Nossa equipe vai revisar e enviar uma nova versão por este link.</p></div></div>`);
    }
    if (preview) {
      parts.push(`<p class="ap-muted">${icon("eye")}Pré-visualização: o cliente verá os botões ${pending ? "Aprovar conteúdo e Solicitar ajuste" : "conforme o status"} aqui.</p>`);
      return parts.join("");
    }
    if (!pending || !view.batch.allow_individual) return parts.join("");
    const working = busy.has(item.id);
    if (adjusting === item.id) {
      parts.push(`
        <form class="ap-adjust" data-ap-adjust="${esc(item.id)}" novalidate>
          <label class="field">
            <span class="field__label">O que você gostaria de ajustar?</span>
            <textarea class="field__input field__input--area" name="comment" rows="4" maxlength="1000" required placeholder="Ex.: Gostaria de mudar o tema para falar mais sobre proteção de pintura.">${esc(drafts.get(item.id) || "")}</textarea>
          </label>
          <p class="form-error" role="alert" hidden></p>
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" data-ap-cancel>Cancelar</button>
            <button class="btn btn--primary" type="submit" ${working ? "disabled" : ""}>${icon("send")}Enviar pedido de ajuste</button>
          </div>
        </form>`);
    } else if (confirming === item.id) {
      parts.push(`
        <div class="ap-confirm" role="group" aria-label="Confirmar aprovação">
          <p><b>Aprovar “${esc(c.title)}”?</b> ${view.batch.mode === "planejamento" ? "Você aprova a ideia; a arte vem depois." : "Você aprova o conteúdo como está."}</p>
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" data-ap-cancel>Cancelar</button>
            <button class="btn btn--success" type="button" data-ap-approve-now="${esc(item.id)}" ${working ? "disabled" : ""}>${icon("check")}Sim, aprovar</button>
          </div>
        </div>`);
    } else {
      parts.push(`
        <div class="ap-actions ap-actions--main">
          <button class="btn btn--ghost" type="button" data-ap-request="${esc(item.id)}" ${working ? "disabled" : ""}>${icon("edit")}Solicitar ajuste</button>
          <button class="btn btn--primary" type="button" data-ap-approve="${esc(item.id)}" ${working ? "disabled" : ""}>${icon("check")}Aprovar conteúdo</button>
        </div>`);
    }
    return parts.join("");
  }

  function card(item, { inDialog = false } = {}) {
    const c = item.content;
    const t = typeOf(c.format);
    return `
      <article class="ap-card ap-card--${esc(item.status)}" ${inDialog ? "" : `id="ap-${esc(item.id)}"`} data-ap-item="${esc(item.id)}" aria-labelledby="ap-title-${esc(item.id)}${inDialog ? "-d" : ""}">
        <div class="ap-card__top">
          <p class="ap-card__date">${icon("calendar")}${esc(dateLine(c))}</p>
          ${statusBadge(preview && item.status === "rascunho" ? "rascunho" : item.status)}
        </div>
        <div class="ap-card__tags">
          <span class="ap-tag type--${esc(c.format)}">${icon(t.icon)}${esc(t.label)}</span>
          <span class="ap-tag">${icon("target")}${esc(networkOf(c.network))}</span>
          ${c.pillar ? `<span class="ap-tag ap-tag--pillar">${esc(c.pillar)}</span>` : ""}
          ${item.version_number > 1 ? `<span class="ap-tag">Versão ${esc(item.version_number)}</span>` : ""}
        </div>
        <h3 class="ap-card__title" id="ap-title-${esc(item.id)}${inDialog ? "-d" : ""}">${esc(c.title)}</h3>
        ${mediaBlock(item, view.batch.mode)}
        <div class="ap-card__body">
          ${textSection("lightbulb", "A ideia", c.idea)}
          ${textSection("play", "Roteiro / como vai ser", c.content_plan)}
          ${c.art_text ? `<section class="ap-sec"><h4 class="ap-sec__title">${icon("type")}Texto na arte</h4><blockquote class="art-text">${esc(c.art_text)}</blockquote></section>` : ""}
          ${textSection("target", "Objetivo", c.objective)}
          ${textSection("edit", "Legenda", c.caption, "ap-sec--caption")}
          ${textSection("send", "Chamada para ação", c.cta)}
          ${textSection("message", "Observação da Digital Galaxy", c.client_notes, "ap-sec--note")}
          ${!c.idea && !c.content_plan && !c.caption && !(c.assets || []).length ? '<p class="ap-muted">Nossa equipe ainda está detalhando este conteúdo.</p>' : ""}
        </div>
        <div class="ap-card__decision" aria-live="polite">${decisionArea(item)}</div>
      </article>`;
  }

  function listView() {
    const list = visible();
    if (!list.length) return `<p class="ap-empty">${icon("list")}Nenhum conteúdo com esses filtros.</p>`;
    return `<div class="ap-list">${list.map((i) => card(i)).join("")}</div>`;
  }

  function calendarView() {
    const list = visible();
    const byDay = {};
    list.forEach((i) => { (byDay[i.content.scheduled_date] ||= []).push(i); });
    const chip = (i) => `<button type="button" class="ap-chip ap-chip--${esc(i.status)}" data-ap-open="${esc(i.id)}">${icon(typeOf(i.content.format).icon)}<span>${i.content.scheduled_time ? `${esc(timeLabel(i.content.scheduled_time))} ` : ""}${esc(i.content.title)}</span></button>`;
    const grid = monthGrid(view.batch.month).map((d) => `
      <div class="ap-cal__cell${d.inMonth ? "" : " is-out"}${byDay[d.iso]?.length ? " has-items" : ""}">
        <span class="ap-cal__day">${d.day}</span>
        ${d.inMonth ? (byDay[d.iso] || []).map(chip).join("") : ""}
      </div>`).join("");
    const days = Object.keys(byDay).sort();
    // No celular: agenda por dia (células pequenas demais para tocar)
    const agenda = days.length
      ? days.map((iso) => `<section class="ap-agenda__day"><h3 class="ap-agenda__title">${esc(longDayLabel(iso))}</h3>${byDay[iso].map(chip).join("")}</section>`).join("")
      : `<p class="ap-empty">${icon("calendar")}Nenhum conteúdo com esses filtros.</p>`;
    return `
      <div class="ap-cal" aria-label="Calendário de ${esc(monthLabel(view.batch.month))}">
        <div class="ap-cal__head">${WEEKDAYS_SHORT.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="ap-cal__grid">${grid}</div>
      </div>
      <div class="ap-agenda">${agenda}</div>`;
  }

  function render() {
    if (!view) return;
    const scroll = window.scrollY;
    root.innerHTML = `
      ${preview ? `<div class="ap-preview-bar" role="note">${icon("eye")}<span><b>Pré-visualização da equipe.</b> É assim que o cliente vê o link. Os botões de decisão ficam desligados aqui.</span></div>` : ""}
      ${header()}
      ${progress()}
      ${finished()}
      ${toolbar()}
      <div class="ap-body">${layout === "lista" ? listView() : calendarView()}</div>
      <footer class="ap-foot"><span class="ap-foot__mark">${brandMark("ap-foot__logo")}</span><p>Digital Galaxy · Central de aprovação. Qualquer dúvida, fale com a nossa equipe pelo canal de sempre.</p></footer>`;
    // Largura da barra pelo CSSOM (a política de segurança não aceita style="" no HTML)
    root.querySelectorAll("[data-pct]").forEach((bar) => { bar.style.width = `${Number(bar.dataset.pct) || 0}%`; });
    window.scrollTo(0, scroll);
    if (dialog.open && dialog.dataset.item) {
      const item = items().find((i) => i.id === dialog.dataset.item);
      if (item) dialog.querySelector(".ap-dialog__body").innerHTML = card(item, { inDialog: true });
    }
  }

  /* ---------- Nome para o histórico ---------- */
  function askName() {
    const saved = safe.get(NAME_KEY);
    if (saved !== null) return Promise.resolve(saved);
    return new Promise((resolve) => {
      const box = document.createElement("dialog");
      box.className = "ap-dialog ap-dialog--small";
      box.innerHTML = `
        <form class="ap-name" method="dialog" novalidate>
          <h2 class="ap-name__title">Como podemos identificar sua aprovação?</h2>
          <p class="ap-muted">Seu nome aparece no histórico da nossa equipe. Não é preciso criar conta.</p>
          <label class="field"><span class="field__label">Seu nome</span><input class="field__input" name="name" maxlength="80" autocomplete="name" placeholder="Ex.: Maria (marketing)"></label>
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" value="skip" data-ap-skip>Continuar sem nome</button>
            <button class="btn btn--primary" type="submit">Continuar</button>
          </div>
        </form>`;
      document.body.append(box);
      const finish = (name) => { const value = String(name || "").trim().slice(0, 80); safe.set(NAME_KEY, value); box.close(); box.remove(); resolve(value); };
      box.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); finish(box.querySelector("[name=name]").value); });
      box.querySelector("[data-ap-skip]").addEventListener("click", () => finish(""));
      box.addEventListener("cancel", (e) => { e.preventDefault(); finish(""); });
      box.showModal();
      box.querySelector("[name=name]").focus();
    });
  }

  /* ---------- Ações ---------- */
  async function run(itemId, fn, okMessage) {
    busy.add(itemId);
    render();
    try {
      const result = await fn();
      if (result?.view) view = result.view;
      confirming = null; adjusting = null; drafts.delete(itemId);
      if (okMessage) toast(okMessage);
    } catch (error) {
      if (error.view) view = error.view;
      if (error.reason === "versao_desatualizada" || error.reason === "ja_decidido") { confirming = null; adjusting = null; }
      toast(error.message || "Não foi possível concluir. Tente de novo.", "error");
    } finally {
      busy.delete(itemId);
      render();
    }
  }

  on(root, "click", "[data-ap-layout]", (e, b) => { layout = b.dataset.apLayout; render(); });
  on(root, "change", "[data-ap-filter]", (e, s) => { filters[s.dataset.apFilter] = s.value; render(); });
  const handleActions = (container) => {
    on(container, "click", "[data-ap-approve]", (e, b) => { confirming = b.dataset.apApprove; adjusting = null; render(); container.querySelector("[data-ap-approve-now]")?.focus(); });
    on(container, "click", "[data-ap-request]", (e, b) => { adjusting = b.dataset.apRequest; confirming = null; render(); container.querySelector(`[data-ap-adjust] textarea`)?.focus(); });
    on(container, "click", "[data-ap-cancel]", () => { confirming = null; adjusting = null; render(); });
    on(container, "input", "[data-ap-adjust] textarea", (e, t) => drafts.set(t.closest("[data-ap-adjust]").dataset.apAdjust, t.value));
    on(container, "click", "[data-ap-approve-now]", async (e, b) => {
      const item = items().find((i) => i.id === b.dataset.apApproveNow);
      if (!item || busy.has(item.id)) return;
      const name = await askName();
      await run(item.id, () => decide({ item: item.id, version: item.version_id, decision: "aprovado", name, session: sessionId() }), "Conteúdo aprovado com sucesso!");
    });
    on(container, "submit", "[data-ap-adjust]", async (e, form) => {
      e.preventDefault();
      const item = items().find((i) => i.id === form.dataset.apAdjust);
      const comment = form.elements.comment.value.trim();
      const box = form.querySelector(".form-error");
      if (!comment) { box.textContent = "Conte o que você gostaria de ajustar."; box.hidden = false; form.elements.comment.setAttribute("aria-invalid", "true"); form.elements.comment.focus(); return; }
      if (!item || busy.has(item.id)) return;
      const name = await askName();
      await run(item.id, () => decide({ item: item.id, version: item.version_id, decision: "ajustes", comment, name, session: sessionId() }), "Pedido de ajuste enviado. Obrigado!");
    });
  };
  handleActions(root);
  handleActions(dialog);

  on(root, "click", "[data-ap-open]", (e, b) => {
    const item = items().find((i) => i.id === b.dataset.apOpen);
    if (!item) return;
    dialog.dataset.item = item.id;
    dialog.innerHTML = `<div class="ap-dialog__panel"><div class="ap-dialog__head"><button class="icon-btn" type="button" data-ap-close aria-label="Fechar">${icon("close")}</button></div><div class="ap-dialog__body">${card(item, { inDialog: true })}</div></div>`;
    dialog.showModal();
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target.closest("[data-ap-close]")) { dialog.close(); delete dialog.dataset.item; } });

  on(root, "click", "[data-ap-all]", async () => {
    const pending = items().filter((i) => isPending(i.status));
    if (!pending.length) return;
    const ok = await new Promise((resolve) => {
      const box = document.createElement("dialog");
      box.className = "ap-dialog ap-dialog--small";
      box.setAttribute("role", "alertdialog");
      box.innerHTML = `
        <div class="ap-name">
          <h2 class="ap-name__title">Aprovar todos os pendentes?</h2>
          <p>Você está prestes a aprovar ${pending.length} ${pending.length === 1 ? "conteúdo" : "conteúdos"}. Deseja continuar?</p>
          ${counts().adjust ? `<p class="ap-muted">Os que estão com ajuste solicitado não entram.</p>` : ""}
          <div class="ap-actions">
            <button class="btn btn--ghost" type="button" data-answer="no">Cancelar</button>
            <button class="btn btn--success" type="button" data-answer="yes">${icon("check")}Confirmar aprovação</button>
          </div>
        </div>`;
      document.body.append(box);
      const finish = (answer) => { box.close(); box.remove(); resolve(answer); };
      box.addEventListener("click", (e) => { const b = e.target.closest("[data-answer]"); if (b) finish(b.dataset.answer === "yes"); else if (e.target === box) finish(false); });
      box.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
      box.showModal();
      box.querySelector('[data-answer="no"]').focus();
    });
    if (!ok) return;
    const name = await askName();
    const button = root.querySelector("[data-ap-all]");
    if (button) { button.disabled = true; button.classList.add("is-loading"); }
    try {
      const result = await approveAll({ items: pending.map((i) => ({ item: i.id, version: i.version_id })), name, session: sessionId() });
      view = result.view;
      const n = result.approved?.length || 0;
      toast(n ? `${n} ${n === 1 ? "conteúdo aprovado" : "conteúdos aprovados"} com sucesso!` : "Nenhum conteúdo precisava de aprovação.");
    } catch (error) {
      if (error.view) view = error.view;
      toast(error.message || "Não foi possível aprovar agora. Tente de novo.", "error");
    } finally {
      render();
    }
  });

  return {
    show(next) { view = next; render(); },
    get view() { return view; }
  };
}

/** Mensagens de link que não abre (sem dados do lote) */
export function renderLinkProblem(root, { title, text, iconName = "lock" }) {
  root.innerHTML = `
    <section class="ap-problem" role="alert">
      <span class="ap-problem__icon">${icon(iconName)}</span>
      <h1 class="ap-problem__title">${esc(title)}</h1>
      <p class="ap-problem__text">${esc(text)}</p>
      <p class="ap-muted">Digital Galaxy · Central de aprovação</p>
    </section>`;
}
