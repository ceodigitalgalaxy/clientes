/* Arquivos e aprovação, dentro dos detalhes do conteúdo (painel).
   - Arquivos e materiais: capa, imagens, slides do carrossel (na ordem),
     vídeo, thumbnail do vídeo e PDF (armazenamento privado) ou links. Mudar os
     arquivos sobe a versão do conteúdo.
   - Aprovação e produção: status separados; o cliente aprova pelo link do lote
     (seção Aprovações). O histórico mostra cada versão enviada e a resposta. */

import { esc, on } from "../../../js/lib/dom.js?v=476ab22dd7";
import { icon } from "../../../js/lib/icons.js?v=476ab22dd7";
import { stampLabel } from "../../../js/lib/dates.js?v=476ab22dd7";
import { renderMedia, mediaFallback } from "../../../js/ui/media.js?v=476ab22dd7";
import { UPLOAD_LIMITS } from "../../../js/lib/storage.js?v=476ab22dd7";
import { APPROVAL_STATUS, PRODUCTION_STATUS } from "../../../js/domain/approvals.js?v=476ab22dd7";

const ACCEPT = UPLOAD_LIMITS.contentTypes.join(",");
const ROLES = { midia: "Galeria / carrossel", capa: "Capa", thumbnail: "Thumbnail do vídeo" };
/** Última arte final vista de cada conteúdo: o painel redesenhado já começa com ela (sem piscar) */
const lastAssets = new Map();

/** HTML das seções (preenchidas por mountReview) */
export const reviewSections = () => `
  <section class="detail final-art" data-final-art>
    <div class="detail__head">
      <h3 class="detail__title">Arquivos e materiais</h3>
      <span class="field__hint">Capa, imagens, slides do carrossel (na ordem), vídeo, thumbnail e PDF</span>
    </div>
    <div data-final-list><span class="skeleton final-art__loading" aria-hidden="true"></span></div>
    <div class="final-art__add">
      <label class="btn btn--ghost btn--sm final-art__choose">
        <input class="visually-hidden" type="file" multiple accept="${ACCEPT}" data-final-files>
        <span>${icon("image")}Enviar arquivos</span>
      </label>
      <form class="final-art__link" data-final-link novalidate>
        <label class="field">
          <span class="visually-hidden">Link da arte final</span>
          <input class="field__input" name="asset_url" type="url" inputmode="url" placeholder="Ou cole um link (Drive, YouTube, Vimeo...)" autocomplete="off" spellcheck="false">
        </label>
        <select class="field__input final-art__kind" name="kind" aria-label="Tipo do link">
          <option value="video">Vídeo</option>
          <option value="image">Imagem</option>
        </select>
        <button class="btn btn--ghost btn--sm" type="submit">Adicionar link</button>
      </form>
      <p class="field__hint">Arquivos de até 50 MB (JPG, PNG, WebP, GIF, MP4, WebM, MOV ou PDF). Vídeos maiores: use um link. Escolha em cada item se é a capa ou a thumbnail do vídeo.</p>
    </div>
    <div class="uploads" data-final-uploads aria-live="polite"></div>
  </section>
  <section class="detail approval-box" data-approval>
    <div class="detail__head"><h3 class="detail__title">Aprovação e produção</h3></div>
    <div data-approval-actions></div>
    <div data-approval-history><span class="skeleton final-art__loading" aria-hidden="true"></span></div>
  </section>`;

/**
 * @param {object} options
 * @param {HTMLElement} options.root   onde reviewSections() foi colocado
 * @param {object} options.content     conteúdo (linha da tabela contents)
 * @param {(updated?: object) => Promise<void>} options.onChanged  conteúdo mudou (versão/status)
 */
export function mountReview({ root, content, api, toast, confirm, onChanged }) {
  const listBox = root.querySelector("[data-final-list]");
  const uploads = root.querySelector("[data-final-uploads]");
  const fileInput = root.querySelector("[data-final-files]");
  const linkForm = root.querySelector("[data-final-link]");
  const actionsBox = root.querySelector("[data-approval-actions]");
  const historyBox = root.querySelector("[data-approval-history]");
  let assets = [];
  let history = { versions: [], decisions: [], legacy: [] };
  let busy = false;
  const alive = () => root.isConnected;

  /* ---------- Arte final ---------- */
  function renderAssets() {
    if (!assets.length) {
      listBox.innerHTML = '<p class="final-art__empty">Nenhum arquivo ainda. Na aprovação de planejamento eles são opcionais; para a aprovação de conteúdo final, envie aqui a arte, o vídeo ou os slides.</p>';
      return;
    }
    listBox.innerHTML = `<ol class="final-list">${assets.map((asset, i) => `
      <li class="final-item" data-asset="${esc(asset.id)}">
        <span class="final-item__n" aria-hidden="true">${i + 1}</span>
        <div class="final-item__media">${asset.kind === "pdf"
          ? `<a class="pdf-card" href="${esc(asset.src || "#")}" target="_blank" rel="noopener noreferrer">${icon("download")}<span>${esc(asset.name || "Arquivo PDF")}</span></a>`
          : asset.src
          ? renderMedia({ url: asset.src, kind: asset.kind, title: `${content.title} (${i + 1})` })
          : mediaFallback({ reason: "Não foi possível abrir este arquivo agora." })}</div>
        <div class="final-item__actions">
          ${asset.kind === "pdf" ? '<span class="asset-role asset-role--pdf">PDF</span>' : `<label class="asset-role"><span class="visually-hidden">Uso deste arquivo</span><select class="field__input" data-asset-role aria-label="Uso deste arquivo">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${(asset.role || "midia") === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`}
          <button class="icon-btn" type="button" data-asset-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Mover para antes" title="Mover para antes">${icon("chevronLeft")}</button>
          <button class="icon-btn" type="button" data-asset-move="1" ${i === assets.length - 1 ? "disabled" : ""} aria-label="Mover para depois" title="Mover para depois">${icon("chevronRight")}</button>
          <button class="icon-btn icon-btn--danger" type="button" data-asset-delete aria-label="Remover da arte final" title="Remover">${icon("trash")}</button>
        </div>
      </li>`).join("")}</ol>`;
  }

  async function loadAssets() {
    try {
      assets = await api.listAssets(content.id);
      lastAssets.set(content.id, assets);
      if (alive()) renderAssets();
    } catch (error) {
      if (!alive()) return;
      listBox.innerHTML = `<div class="state state--error state--inline" role="alert"><p class="state__text">${esc(error.message)}</p><button class="btn btn--ghost btn--sm" type="button" data-final-retry>${icon("refresh")}Tentar de novo</button></div>`;
    }
  }

  const nextPosition = () => (assets.length ? Math.max(...assets.map((a) => a.position)) + 1 : 0);

  async function changed() {
    await loadAssets();
    await onChanged();
  }

  fileInput.addEventListener("change", async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = "";
    if (!files.length) return;
    // Outra ação ainda terminando (ex.: mudar a ordem): espera em vez de ignorar o arquivo
    while (busy) await new Promise((r) => setTimeout(r, 50));
    busy = true;
    let position = nextPosition();
    let sent = 0;
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "upload";
      row.innerHTML = `<span class="upload__name"></span><progress class="upload__bar" max="1" value="0"></progress><span class="upload__state">Enviando…</span>`;
      row.querySelector(".upload__name").textContent = file.name;
      uploads.append(row);
      try {
        await api.addAssetFile(content, file, { position, onProgress: (p) => { row.querySelector("progress").value = p; } });
        row.querySelector(".upload__state").textContent = "Enviado";
        row.classList.add("is-done");
        position += 1;
        sent += 1;
      } catch (error) {
        row.classList.add("is-error");
        row.querySelector(".upload__state").textContent = error.message;
      }
    }
    busy = false;
    setTimeout(() => uploads.querySelectorAll(".upload.is-done").forEach((n) => n.remove()), 2500);
    if (sent) { toast(sent === 1 ? "Arquivo enviado" : `${sent} arquivos enviados`); await changed(); }
  });

  linkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = linkForm.elements.asset_url;
    const button = linkForm.querySelector("[type=submit]");
    linkForm.querySelectorAll(".field__error").forEach((n) => n.remove());
    input.removeAttribute("aria-invalid");
    button.disabled = true;
    try {
      await api.addAssetLink(content, { url: input.value, kind: linkForm.elements.kind.value, position: nextPosition() });
      input.value = "";
      toast("Link adicionado");
      await changed();
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      input.closest(".field").insertAdjacentHTML("beforeend", `<span class="field__error">${esc(error.fields?.asset_url || error.message)}</span>`);
      input.focus();
    } finally {
      button.disabled = false;
    }
  });

  on(root, "click", "[data-final-retry]", () => loadAssets());
  on(root, "click", "[data-asset-move]", async (event, button) => {
    if (busy) return;
    const index = assets.findIndex((a) => a.id === button.closest("[data-asset]").dataset.asset);
    const other = index + Number(button.dataset.assetMove);
    if (index < 0 || other < 0 || other >= assets.length) return;
    busy = true;
    try {
      // Posições iguais (itens antigos) viram distintas antes da troca
      const a = { ...assets[index], position: assets[index].position === assets[other].position ? index : assets[index].position };
      const b = { ...assets[other], position: a.position === assets[other].position ? other : assets[other].position };
      await api.swapAssets(a, b);
      await changed();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy = false;
    }
  });
  on(root, "click", "[data-asset-delete]", async (event, button) => {
    const asset = assets.find((a) => a.id === button.closest("[data-asset]").dataset.asset);
    if (!asset || busy) return;
    const ok = await confirm({ title: "Remover este item?", text: asset.storage_path ? "O arquivo sai do conteúdo. Se ele já foi enviado ao cliente numa versão, continua guardado no histórico." : "O link será retirado do conteúdo.", confirmLabel: "Remover" });
    if (!ok) return;
    busy = true;
    try {
      await api.deleteAsset(asset);
      toast("Item removido");
      await changed();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy = false;
    }
  });

  on(root, "change", "[data-asset-role]", async (event, select) => {
    const asset = assets.find((a) => a.id === select.closest("[data-asset]").dataset.asset);
    if (!asset) return;
    select.disabled = true;
    try {
      await api.setAssetRole(asset, select.value);
      toast(select.value === "capa" ? "Definido como capa" : select.value === "thumbnail" ? "Definido como thumbnail do vídeo" : "Arquivo na galeria");
      await changed();
    } catch (error) {
      toast(error.message, "error");
      select.value = asset.role || "midia";
    } finally {
      select.disabled = false;
    }
  });

  /* ---------- Aprovação e produção ---------- */
  function renderActions() {
    const a = APPROVAL_STATUS[content.approval_status] || APPROVAL_STATUS.rascunho;
    const p = PRODUCTION_STATUS[content.production_status];
    const latest = history.versions?.[0];
    const stale = latest && latest.content_version < content.version && content.approval_status !== "rascunho";
    actionsBox.innerHTML = `
      <div class="approval-box__pair">
        <span class="appr-chip appr-chip--${esc(a.tone)}">${icon(a.icon)}${esc(a.label)}</span>
        <span class="prod-chip">${icon(p?.icon || "edit")}${esc(p ? p.label : "Produção não iniciada")}</span>
      </div>
      ${stale ? `<p class="approval-box__warn">${icon("refresh")}Este conteúdo mudou depois do último envio (o cliente viu a versão ${esc(latest.version_number)}). Reenvie pelo lote em Aprovações para ele aprovar de novo.</p>` : ""}
      <div class="approval-box__buttons">
        <button class="btn btn--ghost btn--sm" type="button" data-go-approvals>${icon("send")}<span>Abrir aprovações do cliente</span></button>
        ${content.production_status !== "publicado" ? `<button class="btn btn--ghost btn--sm" type="button" data-mark-published>${icon("check")}<span>Marcar como publicado</span></button>` : ""}
      </div>`;
  }

  function renderHistory() {
    const rows = [];
    for (const v of history.versions || []) {
      const ds = (history.decisions || []).filter((d) => d.version_id === v.id);
      rows.push(`<li class="history__item history__item--versao">${icon("layers")}<div><p class="history__title">Versão ${esc(v.version_number)} enviada <span class="history__meta">· ${esc(stampLabel(v.created_at))}</span></p></div></li>`);
      ds.forEach((d) => rows.push(`
        <li class="history__item history__item--${d.action === "aprovado" ? "aprovado" : "ajustes"}">
          ${icon(d.action === "aprovado" ? "check" : "edit")}
          <div>
            <p class="history__title">${d.action === "aprovado" ? "Aprovado" : "Ajuste solicitado"}${d.reviewer_name ? ` por ${esc(d.reviewer_name)}` : ""} <span class="history__meta">· versão ${esc(v.version_number)} · ${esc(stampLabel(d.created_at))}${d.bulk ? " · aprovação em lote" : ""}</span></p>
            ${d.comment ? `<p class="history__text">${esc(d.comment)}</p>` : ""}
          </div>
        </li>`));
    }
    for (const h of history.legacy || []) {
      rows.push(`<li class="history__item history__item--${esc(h.decision)}">${icon(h.decision === "aprovado" ? "check" : "edit")}<div><p class="history__title">${h.decision === "aprovado" ? "Cliente aprovou pelo portal" : "Cliente pediu ajuste pelo portal"} <span class="history__meta">· versão ${esc(h.version)} · ${esc(stampLabel(h.created_at))}</span></p>${h.message ? `<p class="history__text">${esc(h.message)}</p>` : ""}</div></li>`);
    }
    historyBox.innerHTML = rows.length ? `<ul class="history">${rows.join("")}</ul>` : '<p class="field__hint">Ainda não foi enviado ao cliente. Inclua num lote em Aprovações e gere o link.</p>';
  }

  async function loadHistory() {
    try {
      history = await api.contentApprovalHistory(content.id);
      if (!alive()) return;
      renderHistory();
      renderActions();
    } catch (error) {
      if (alive()) historyBox.innerHTML = `<p class="field__error">${esc(error.message)}</p>`;
    }
  }

  on(root, "click", "[data-go-approvals]", () => { location.hash = `#/aprovacoes?client_id=${encodeURIComponent(content.client_id)}`; });
  on(root, "click", "[data-mark-published]", async (event, button) => {
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const updated = await api.setContentProduction(content.id, "publicado");
      toast("Marcado como publicado");
      await onChanged(updated);
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  });

  if (lastAssets.has(content.id)) { assets = lastAssets.get(content.id); renderAssets(); }
  renderActions();
  loadAssets().then(() => { if (alive()) renderActions(); });
  loadHistory();

  return {
    /** Conteúdo novo (versão/status) sem redesenhar a seção: o que está sendo digitado não se perde */
    update(next) {
      content = next;
      if (alive()) { renderActions(); loadHistory(); }
    }
  };
}
