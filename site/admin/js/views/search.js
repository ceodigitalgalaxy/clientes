/* Busca rápida (Ctrl+K, ⌘K ou "/"): um campo só que acha demandas, conteúdos,
   clientes e seções do painel. Teclado: ↑ ↓ escolhem, Enter abre, Esc fecha.
   - Só mostra o que a pessoa já pode ver: os dados vêm do banco já recortados
     pelas permissões (RLS), os clientes de state.clients e as seções do menu
     que estão à vista para o perfil dela.
   - Busca ao abrir (e reaproveita por 60 s); ignora acentos e maiúsculas. */

import { $, esc, on } from "../../../js/lib/dom.js?v=cef16017bf";
import { icon } from "../../../js/lib/icons.js?v=cef16017bf";
import { closeDialog, wireDialog } from "../ui/dialogs.js?v=cef16017bf";
import { TASK_STATUS, dueParts } from "../domain/tasks.js?v=cef16017bf";
import { FORMATS } from "../domain/rules.js?v=cef16017bf";

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const shortDay = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "");
const PER_GROUP = 6;

export function setupSearch({ api, state, navigate, openTask, openContent, openClient }) {
  const dialog = $("#search-modal");
  const input = dialog.querySelector("[data-search-input]");
  const list = dialog.querySelector("[data-search-results]");
  let data = null;          // { tasks, contents, at }
  let loading = null;
  let items = [];           // resultados à vista, na ordem do teclado
  let active = 0;

  wireDialog(dialog);
  const clientName = (id) => (id ? state.clients.find((c) => c.id === id)?.name || "" : "Interno da agência");

  async function fetchData() {
    if (data && Date.now() - data.at < 60000) return data;
    loading ||= Promise.all([api.listTasks().catch(() => []), api.listContents({}).catch(() => [])])
      .then(([tasks, contents]) => { data = { tasks, contents, at: Date.now() }; return data; })
      .finally(() => { loading = null; });
    return loading;
  }

  /** Seções do menu que a pessoa vê (respeita o perfil: o que está escondido não aparece) */
  const pages = () => [...document.querySelectorAll(".admin-nav [data-route]")]
    .filter((a) => !a.hidden).map((a) => ({ route: a.dataset.route, label: a.textContent.trim().replace(/\d+$/, "").trim() }));

  /** Pontuação: começa com o termo > tem o termo; todas as palavras precisam aparecer */
  function score(text, words, q) {
    const t = norm(text);
    if (!words.every((w) => t.includes(w))) return 0;
    return t.startsWith(q) ? 3 : t.split(/\s+/).some((w) => w.startsWith(words[0])) ? 2 : 1;
  }
  function pick(rows, textOf, q, words) {
    return rows.map((r) => ({ r, s: score(textOf(r), words, q) })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, PER_GROUP).map((x) => x.r);
  }

  function results(query) {
    const q = norm(query).trim();
    const words = q.split(/\s+/).filter(Boolean);
    const groups = [];
    if (!q) {
      groups.push({ title: "Ir para", rows: pages().map((p) => ({ kind: "page", id: p.route, title: p.label, meta: "", icon: "arrowRight" })) });
      return groups;
    }
    if (data) {
      const tasks = pick(data.tasks.filter((t) => !t.archived_at), (t) => `${t.title} ${clientName(t.client_id)}`, q, words);
      if (tasks.length) groups.push({ title: "Demandas", rows: tasks.map((t) => ({ kind: "task", id: t.id, title: t.title, icon: t.kind === "edicao" ? "play" : "layers",
        meta: [clientName(t.client_id), TASK_STATUS[t.status]?.label, t.due_at ? `entrega ${shortDay(dueParts(t.due_at).date)}` : ""].filter(Boolean).join(" · ") })) });
      const contents = pick(data.contents, (c) => `${c.title} ${clientName(c.client_id)}`, q, words);
      if (contents.length) groups.push({ title: "Conteúdos", rows: contents.map((c) => ({ kind: "content", id: c.id, title: c.title, icon: "calendar",
        meta: [clientName(c.client_id), FORMATS[c.format]?.label, c.scheduled_date ? `publica ${shortDay(c.scheduled_date)}` : ""].filter(Boolean).join(" · ") })) });
    }
    const clients = pick(state.clients, (c) => `${c.name} ${c.slug || ""}`, q, words);
    if (clients.length) groups.push({ title: "Clientes", rows: clients.map((c) => ({ kind: "client", id: c.id, title: c.name, icon: "users", meta: "ver os conteúdos" })) });
    const nav = pick(pages(), (p) => p.label, q, words);
    if (nav.length) groups.push({ title: "Ir para", rows: nav.map((p) => ({ kind: "page", id: p.route, title: p.label, meta: "", icon: "arrowRight" })) });
    return groups;
  }

  function render() {
    const groups = results(input.value);
    items = groups.flatMap((g) => g.rows);
    active = Math.min(active, Math.max(0, items.length - 1));
    let i = -1;
    list.innerHTML = groups.length ? groups.map((g) => `
      <li class="qs__group" role="presentation"><p class="qs__group-title" aria-hidden="true">${esc(g.title)}</p>
        <ul class="qs__rows" role="group" aria-label="${esc(g.title)}">${g.rows.map((r) => { i += 1; return `
          <li class="qs__row" id="qs-opt-${i}" role="option" aria-selected="${i === active}" data-qs-index="${i}">
            <span class="qs__icon">${icon(r.icon)}</span>
            <span class="qs__text"><span class="qs__title">${esc(r.title)}</span>${r.meta ? `<span class="qs__meta">${esc(r.meta)}</span>` : ""}</span>
            <span class="qs__enter" aria-hidden="true">${icon("arrowRight")}</span>
          </li>`; }).join("")}</ul></li>`).join("")
      : `<li class="qs__empty" role="presentation">${loading ? "Buscando…" : `Nada encontrado para "${esc(input.value.trim())}".`}</li>`;
    input.setAttribute("aria-activedescendant", items.length ? `qs-opt-${active}` : "");
  }
  function move(delta) {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    list.querySelectorAll("[data-qs-index]").forEach((n) => n.setAttribute("aria-selected", String(Number(n.dataset.qsIndex) === active)));
    input.setAttribute("aria-activedescendant", `qs-opt-${active}`);
    list.querySelector(`#qs-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }
  function choose(index = active) {
    const r = items[index];
    if (!r) return;
    input.blur();
    closeDialog(dialog);
    // Depois da janela fechar, para o painel aberto não disputar o foco com ela
    setTimeout(() => {
      if (r.kind === "task") openTask(r.id);
      else if (r.kind === "content") openContent(r.id);
      else if (r.kind === "client") openClient(r.id);
      else navigate(r.id);
    }, 240);
  }

  async function open() {
    if (dialog.open) { input.select(); return; }
    document.querySelectorAll("dialog[open]").forEach((d) => closeDialog(d));
    input.value = "";
    active = 0;
    render();
    dialog.showModal();
    input.focus();
    await fetchData();
    if (dialog.open) render();
  }

  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") { event.preventDefault(); choose(); }
  });
  on(list, "click", "[data-qs-index]", (event, row) => choose(Number(row.dataset.qsIndex)));
  on(list, "mousemove", "[data-qs-index]", (event, row) => { const n = Number(row.dataset.qsIndex); if (n !== active) { active = n - 0; move(0); } });
  on(document, "click", '[data-action="quick-search"]', () => open());
  document.addEventListener("keydown", (event) => {
    if (!state.signedIn) return;
    // Campo escondido (de uma janela já fechada) com foco preso não conta como "digitando"
    const field = event.target.closest?.("input, textarea, select, [contenteditable]");
    const typing = field && !field.closest("dialog:not([open])");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); open(); return; }
    if (event.key === "/" && !typing && !document.querySelector("dialog[open]:not(.is-closing)")) { event.preventDefault(); open(); }
  });
  // Algo mudou (salvou, chegou aviso): a próxima busca pega de novo
  ["task-saved", "content-saved"].forEach((name) => document.addEventListener(name, () => { data = null; }));

  return { open, reset() { data = null; } };
}
