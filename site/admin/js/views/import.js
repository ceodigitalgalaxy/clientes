/* Seção Importar: planilha (.xlsx ou .csv) → conteúdos de um cliente.
   1. Escolher o cliente e a planilha (modelo para baixar).
   2. Prévia linha a linha: o que está pronto, o que precisa de correção e o
      que parece repetido (desmarcado). Miniatura da referência em cada linha.
   3. Importar os marcados de uma vez (tudo ou nada). */

import { $, esc, on } from "../../../js/lib/dom.js";
import { icon } from "../../../js/lib/icons.js";
import { timeLabel } from "../../../js/lib/dates.js";
import { typeBadge } from "../../../js/ui/badges.js";
import { describeMedia, mediaCover, coverHtml } from "../../../js/ui/media.js";
import { NETWORKS, CONTENT_STATUS } from "../domain/rules.js";
import { readSpreadsheet } from "../lib/spreadsheet.js";
import { mapRows, COLUMN_LABELS } from "../domain/import.js";
import { setBusy } from "../ui/dialogs.js";
import { stateBlock } from "../ui/states.js";

const shortDate = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

function refCell(value) {
  if (!value.media_url) return '<span class="imp-ref imp-ref--none" title="Sem referência">—</span>';
  const media = describeMedia(value.media_url, value.media_kind || "image");
  const link = `<a class="imp-ref__link" href="${esc(media.original || value.media_url)}" target="_blank" rel="noopener noreferrer" title="Abrir a referência">`;
  if (media.type === "invalid") return `<span class="imp-ref imp-ref--bad" title="${esc(media.reason)}">${icon("close")}</span>`;
  const cover = mediaCover(value.media_url, value.media_kind || "image");
  const video = media.type !== "image";
  if (cover) return `${link}<span class="imp-ref${video ? " imp-ref--has-video" : ""}" title="${esc(media.provider || "")}">${coverHtml(cover, "data-imp-thumb")}${video ? `<span class="row__play">${icon("play")}</span>` : ""}</span></a>`;
  return `${link}<span class="imp-ref imp-ref--video" title="${esc(media.provider || "Vídeo")}">${icon("play")}</span></a>`;
}

export function setupImport({ api, state, toast, navigate }) {
  const view = $("#view-importar");
  const form = $("#import-form");
  const clientSelect = form.elements.client_id;
  const fileInput = form.elements.file;
  const preview = $("#import-preview");
  const fileLabel = form.querySelector("[data-file-name]");
  let result = null;          // { items, missing, error }
  let selected = new Set();   // linhas marcadas para importar
  let importing = false;

  /** Clientes ativos no seletor (mantém a escolha) */
  function syncClients() {
    const current = clientSelect.value;
    const active = state.clients.filter((c) => c.active);
    clientSelect.innerHTML = `<option value="">Escolha o cliente</option>${active.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}`;
    if (active.some((c) => c.id === current)) clientSelect.value = current;
    else if (active.length === 1) clientSelect.value = active[0].id;
  }

  function render() {
    if (!result) { preview.innerHTML = ""; return; }
    if (result.error) {
      preview.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível usar esta planilha", text: result.error });
      return;
    }
    const { items, missing } = result;
    if (!items.length) {
      preview.innerHTML = stateBlock({ iconName: "calendar", title: "Nenhum conteúdo na planilha", text: "A planilha tem os títulos das colunas, mas nenhuma linha preenchida." });
      return;
    }
    const ready = items.filter((i) => i.valid).length;
    const withErrors = items.length - ready;
    const dupes = items.filter((i) => i.duplicate).length;
    const chosen = items.filter((i) => selected.has(i.line)).length;
    const optionalMissing = missing.filter((f) => !["title", "scheduled_date"].includes(f));
    preview.innerHTML = `
      <div class="imp-summary" role="status">
        <span class="imp-pill imp-pill--ok">${icon("check")}${ready} ${ready === 1 ? "pronto" : "prontos"}</span>
        ${withErrors ? `<span class="imp-pill imp-pill--error">${icon("close")}${withErrors} com erro</span>` : ""}
        ${dupes ? `<span class="imp-pill imp-pill--warn">${icon("copy")}${dupes} ${dupes === 1 ? "parece repetido" : "parecem repetidos"}</span>` : ""}
        ${optionalMissing.length ? `<span class="imp-note">Colunas não encontradas (ficam vazias): ${esc(optionalMissing.map((f) => COLUMN_LABELS[f]).join(", "))}</span>` : ""}
      </div>
      <div class="imp-table" role="table" aria-label="Prévia da importação">
        <div class="imp-row imp-row--head" role="row">
          <span role="columnheader"><input type="checkbox" data-imp-all aria-label="Marcar todos os prontos" ${chosen && chosen === items.filter((i) => i.valid).length ? "checked" : ""}></span>
          <span role="columnheader">Linha</span><span role="columnheader">Data</span><span role="columnheader">Ref.</span><span role="columnheader">Título</span>
          <span role="columnheader">Rede</span><span role="columnheader">Formato</span><span role="columnheader">Status</span><span role="columnheader">Situação</span>
        </div>
        ${items.map((item) => {
          const v = item.value;
          return `
          <div class="imp-row${item.valid ? "" : " is-error"}${item.duplicate ? " is-dupe" : ""}" role="row" data-line="${item.line}">
            <span role="cell"><input type="checkbox" data-imp-line="${item.line}" aria-label="Importar a linha ${item.line}" ${item.valid ? "" : "disabled"} ${selected.has(item.line) ? "checked" : ""}></span>
            <span role="cell" class="imp-line">${item.line}</span>
            <span role="cell" class="imp-date">${esc(shortDate(v.scheduled_date))}${v.scheduled_time ? `<small>${esc(timeLabel(v.scheduled_time))}</small>` : ""}</span>
            <span role="cell">${refCell(v)}</span>
            <span role="cell" class="imp-title">${esc(v.title || "—")}${v.caption ? `<small>${esc(v.caption.slice(0, 80))}${v.caption.length > 80 ? "…" : ""}</small>` : ""}</span>
            <span role="cell">${esc(NETWORKS[v.network] || "—")}</span>
            <span role="cell">${v.format ? typeBadge(v.format) : "—"}</span>
            <span role="cell">${esc(CONTENT_STATUS[v.status]?.label || "—")}</span>
            <span role="cell" class="imp-check">${item.errors.length
              ? `<ul class="imp-msgs imp-msgs--error">${item.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
              : `<span class="imp-ok">${icon("check")}Pronto</span>`}
              ${item.warnings.length ? `<ul class="imp-msgs imp-msgs--warn">${item.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</span>
          </div>`;
        }).join("")}
      </div>
      <div class="imp-actions">
        <p class="imp-note">${withErrors ? "Linhas com erro não são importadas: corrija na planilha e escolha o arquivo de novo." : "Tudo certo para importar."}</p>
        <button class="btn btn--primary" type="button" data-imp-run ${chosen ? "" : "disabled"}>${icon("sparkle")}<span>${chosen ? `Importar ${chosen} ${chosen === 1 ? "conteúdo" : "conteúdos"}` : "Nada marcado para importar"}</span></button>
      </div>`;
  }

  async function analyze() {
    const file = fileInput.files?.[0];
    fileLabel.textContent = file ? file.name : "Nenhum arquivo escolhido";
    result = null;
    selected = new Set();
    if (!file) { render(); return; }
    if (!clientSelect.value) {
      preview.innerHTML = stateBlock({ iconName: "users", title: "Escolha o cliente primeiro", text: "Os conteúdos da planilha vão para o calendário do cliente escolhido." });
      return;
    }
    preview.innerHTML = '<div class="state" role="status"><span class="skeleton imp-loading"></span><p class="state__text">Lendo a planilha…</p></div>';
    try {
      const [sheet, existing] = await Promise.all([readSpreadsheet(file), api.listContents({ client_id: clientSelect.value })]);
      result = mapRows(sheet.rows, { clientId: clientSelect.value, date1904: sheet.date1904, existing });
      // Prontos e não repetidos já vêm marcados
      result.items.forEach((item) => { if (item.valid && !item.duplicate) selected.add(item.line); });
    } catch (error) {
      result = { error: error.message, items: [], missing: [] };
    }
    render();
  }

  form.addEventListener("change", (event) => {
    if (event.target === fileInput || event.target === clientSelect) analyze();
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  on(preview, "change", "[data-imp-line]", (event, box) => {
    const line = Number(box.dataset.impLine);
    if (box.checked) selected.add(line); else selected.delete(line);
    render();
  });
  on(preview, "change", "[data-imp-all]", (event, box) => {
    result.items.filter((i) => i.valid).forEach((i) => (box.checked ? selected.add(i.line) : selected.delete(i.line)));
    render();
  });
  preview.addEventListener("error", (event) => {
    const el = event.target;
    if (el instanceof HTMLElement && el.matches("[data-imp-thumb]")) {
      const box = el.closest(".imp-ref");
      box.innerHTML = icon(box.classList.contains("imp-ref--has-video") ? "play" : "image");
    }
  }, true);

  on(preview, "click", "[data-imp-run]", async (event, button) => {
    if (importing || !result) return;
    const rows = result.items.filter((i) => i.valid && selected.has(i.line)).map((i) => i.value);
    if (!rows.length) return;
    importing = true;
    setBusy(button, true);
    const clientId = clientSelect.value;
    const client = state.clients.find((c) => c.id === clientId);
    try {
      await api.createContents(rows);
      toast(`${rows.length} ${rows.length === 1 ? "conteúdo importado" : "conteúdos importados"}`);
      result = null;
      selected = new Set();
      fileInput.value = "";
      fileLabel.textContent = "Nenhum arquivo escolhido";
      preview.innerHTML = stateBlock({
        iconName: "check",
        title: `${rows.length} ${rows.length === 1 ? "conteúdo importado" : "conteúdos importados"} para ${client?.name || "o cliente"}`,
        text: "Eles já estão na lista de conteúdos. Os que estiverem como Aguardando aprovação já aparecem para o cliente.",
        actions: `<button class="btn btn--primary btn--sm" type="button" data-imp-see="${esc(clientId)}">${icon("calendar")}<span>Ver conteúdos do cliente</span></button>`
      });
    } catch (error) {
      toast(`Nada foi importado: ${error.message}`, "error");
      setBusy(button, false);
    } finally {
      importing = false;
    }
  });
  on(preview, "click", "[data-imp-see]", (event, button) => navigate("conteudos", { client_id: button.dataset.impSee }));

  return {
    show() {
      syncClients();
      if (!state.clients.some((c) => c.active)) {
        preview.innerHTML = stateBlock({ iconName: "users", title: "Cadastre um cliente primeiro", text: "A importação coloca os conteúdos no calendário de um cliente.", actions: `<button class="btn btn--primary btn--sm" type="button" data-action="go-clients">${icon("arrowRight")}<span>Ir para Clientes</span></button>` });
      } else if (!result && preview.querySelector(".state")?.textContent.includes("Cadastre um cliente")) {
        preview.innerHTML = "";
      }
      view.hidden = false;
    }
  };
}
