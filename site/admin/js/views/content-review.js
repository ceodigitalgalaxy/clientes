/* Arte final e aprovação, dentro dos detalhes do conteúdo (painel).
   - Arte final: arquivos (enviados para o armazenamento privado) ou links, na
     ordem do carrossel. Mudar a arte sobe a versão do conteúdo.
   - Aprovação: "Enviar para aprovação" deixa o conteúdo aguardando o cliente;
     o histórico mostra o que ele respondeu e em qual versão. */

import { esc, on } from "../../../js/lib/dom.js?v=b3c5769ca7";
import { icon } from "../../../js/lib/icons.js?v=b3c5769ca7";
import { stampLabel } from "../../../js/lib/dates.js?v=b3c5769ca7";
import { renderMedia, mediaFallback } from "../../../js/ui/media.js?v=b3c5769ca7";
import { UPLOAD_LIMITS } from "../../../js/lib/storage.js?v=b3c5769ca7";

const ACCEPT = UPLOAD_LIMITS.mediaTypes.join(",");
/** Última arte final vista de cada conteúdo: o painel redesenhado já começa com ela (sem piscar) */
const lastAssets = new Map();

/** HTML das seções (preenchidas por mountReview) */
export const reviewSections = () => `
  <section class="detail final-art" data-final-art>
    <div class="detail__head">
      <h3 class="detail__title">Arte final</h3>
      <span class="field__hint">Imagem, vídeo ou as imagens do carrossel, na ordem</span>
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
      <p class="field__hint">Arquivos de até 50 MB (JPG, PNG, WebP, GIF, MP4, WebM, MOV). Vídeos maiores: use um link.</p>
    </div>
    <div class="uploads" data-final-uploads aria-live="polite"></div>
  </section>
  <section class="detail approval-box" data-approval>
    <div class="detail__head"><h3 class="detail__title">Aprovação do cliente</h3></div>
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
  let history = [];
  let busy = false;
  const alive = () => root.isConnected;

  /* ---------- Arte final ---------- */
  function renderAssets() {
    if (!assets.length) {
      listBox.innerHTML = '<p class="final-art__empty">Nenhuma arte final ainda. Quando o conteúdo ficar pronto, envie aqui e mande para o cliente aprovar.</p>';
      return;
    }
    listBox.innerHTML = `<ol class="final-list">${assets.map((asset, i) => `
      <li class="final-item" data-asset="${esc(asset.id)}">
        <span class="final-item__n" aria-hidden="true">${i + 1}</span>
        <div class="final-item__media">${asset.src
          ? renderMedia({ url: asset.src, kind: asset.kind, title: `${content.title} (${i + 1})` })
          : mediaFallback({ reason: "Não foi possível abrir este arquivo agora." })}</div>
        <div class="final-item__actions">
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
    if (!files.length || busy) return;
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
    const ok = await confirm({ title: "Remover este item da arte final?", text: asset.storage_path ? "O arquivo será apagado do armazenamento." : "O link será retirado da arte final." , confirmLabel: "Remover" });
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

  /* ---------- Aprovação ---------- */
  function renderActions() {
    const latest = history[0];
    const changedAfterApproval = content.status === "aprovado" && latest?.decision === "aprovado" && latest.version < content.version;
    const parts = [];
    if (content.status === "aguardando_aprovacao") {
      parts.push(`<p class="approval-box__state">${icon("clock")}Aguardando o cliente aprovar a versão ${esc(content.version)}.</p>`);
    } else if (content.status === "publicado") {
      parts.push(`<p class="approval-box__state">${icon("send")}Conteúdo publicado.</p>`);
    } else {
      if (changedAfterApproval) parts.push(`<p class="approval-box__warn">${icon("refresh")}A arte mudou depois da aprovação (aprovada a versão ${esc(latest.version)}; agora é a ${esc(content.version)}). Envie de novo para o cliente aprovar.</p>`);
      if (content.status === "ajustes") parts.push(`<p class="approval-box__state">${icon("edit")}O cliente pediu ajuste. Depois de ajustar, envie a nova versão.</p>`);
      const label = content.status === "aprovado" ? (changedAfterApproval ? "Enviar nova versão para aprovação" : "Enviar de novo para aprovação") : content.status === "ajustes" ? "Enviar nova versão para aprovação" : "Enviar para aprovação";
      parts.push(`<div class="approval-box__buttons">
        <button class="btn btn--primary btn--sm" type="button" data-send-approval>${icon("send")}<span>${esc(label)}</span></button>
        ${content.status === "aprovado" && !changedAfterApproval ? `<button class="btn btn--ghost btn--sm" type="button" data-mark-published>${icon("check")}<span>Marcar como publicado</span></button>` : ""}
      </div>`);
      if (!assets.length && content.status !== "aprovado") parts.push('<p class="field__hint">Dica: envie a arte final antes, para o cliente ver o conteúdo pronto.</p>');
    }
    actionsBox.innerHTML = parts.join("");
  }

  function renderHistory() {
    historyBox.innerHTML = history.length
      ? `<ul class="history">${history.map((h) => `
          <li class="history__item history__item--${esc(h.decision)}">
            ${icon(h.decision === "aprovado" ? "check" : "edit")}
            <div>
              <p class="history__title">${h.decision === "aprovado" ? "Cliente aprovou" : "Cliente pediu ajuste"} <span class="history__meta">· versão ${esc(h.version)} · ${esc(stampLabel(h.created_at))}</span></p>
              ${h.message ? `<p class="history__text">${esc(h.message)}</p>` : ""}
            </div>
          </li>`).join("")}</ul>`
      : '<p class="field__hint">O cliente ainda não respondeu sobre este conteúdo.</p>';
  }

  async function loadHistory() {
    try {
      history = await api.listApprovals(content.id);
      if (!alive()) return;
      renderHistory();
      renderActions();
    } catch (error) {
      if (alive()) historyBox.innerHTML = `<p class="field__error">${esc(error.message)}</p>`;
    }
  }

  async function setStatus(button, action, message) {
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const updated = await action();
      toast(message);
      await onChanged(updated);
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }
  on(root, "click", "[data-send-approval]", (event, button) => setStatus(button, () => api.sendForApproval(content.id), "Enviado para o cliente aprovar"));
  on(root, "click", "[data-mark-published]", (event, button) => setStatus(button, () => api.setContentStatus(content.id, "publicado"), "Marcado como publicado"));

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
