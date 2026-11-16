/* @menção num campo de texto: ao digitar "@" abre a lista de pessoas (setas,
   Enter/Tab escolhem, Esc fecha). Guarda quem foi escolhido; mentions(texto)
   devolve só quem ainda está no texto. Quem pode ser mencionado vem de
   people() (o banco confere de novo: só vale quem enxerga a demanda). */

import { esc } from "../../../js/lib/dom.js?v=304713f3c3";

const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const nameOf = (m) => m.name || m.username || "Sem nome";

let seq = 0;

/** area: textarea; people(): pessoas que podem ser mencionadas */
export function attachMentions(area, people) {
  const id = `mention-list-${++seq}`;
  const list = document.createElement("ul");
  list.className = "mention-list";
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Pessoas para mencionar");
  list.hidden = true;
  // A lista abre colada embaixo do campo
  const anchor = document.createElement("div");
  anchor.className = "mention-anchor";
  area.replaceWith(anchor);
  anchor.append(area, list);
  area.setAttribute("aria-autocomplete", "list");
  area.setAttribute("aria-controls", id);
  const chosen = new Map();   // nome → id
  let options = [];
  let index = 0;

  function render() {
    list.innerHTML = options.map((m, i) => `<li role="option" id="${id}-${i}" class="mention-option${i === index ? " is-active" : ""}" aria-selected="${i === index}" data-pick="${i}"><span class="avatar">${esc(initials(nameOf(m)))}</span><span><b>${esc(nameOf(m))}</b>${m.job_title ? ` <span class="field__optional">· ${esc(m.job_title)}</span>` : ""}</span></li>`).join("");
    list.hidden = !options.length;
    area.setAttribute("aria-activedescendant", options.length ? `${id}-${index}` : "");
  }
  function close() { options = []; list.hidden = true; area.setAttribute("aria-activedescendant", ""); }
  function pick(i) {
    const m = options[i];
    if (!m) return;
    const caret = area.selectionStart;
    const before = area.value.slice(0, caret).replace(/@[^\s@]*$/, `@${nameOf(m)} `);
    area.value = before + area.value.slice(caret);
    area.setSelectionRange(before.length, before.length);
    chosen.set(nameOf(m), m.user_id);
    close();
    area.focus();
  }
  area.addEventListener("input", () => {
    const match = area.value.slice(0, area.selectionStart).match(/(?:^|\s)@([^\s@]{0,30})$/);
    if (!match) { close(); return; }
    const q = fold(match[1]);
    options = people().filter((m) => fold(nameOf(m)).split(/\s+/).some((w) => w.startsWith(q)) || fold(m.username).startsWith(q)).slice(0, 6);
    index = 0;
    render();
  });
  area.addEventListener("keydown", (event) => {
    if (list.hidden || !options.length) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); area.form?.requestSubmit(); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); index = (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length; render(); }
    else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(index); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  });
  list.addEventListener("mousedown", (event) => {
    const li = event.target.closest("[data-pick]");
    if (li) { event.preventDefault(); pick(Number(li.dataset.pick)); }
  });
  area.addEventListener("blur", () => setTimeout(close, 150));

  return {
    /** Ids de quem foi escolhido e continua escrito no texto */
    mentions(text = area.value) { return [...chosen].filter(([name]) => text.includes(`@${name}`)).map(([, uid]) => uid); },
    /** Já começa sabendo quem está mencionado (edição) */
    preset(entries) { entries.forEach(([name, uid]) => chosen.set(name, uid)); },
    clear() { chosen.clear(); close(); }
  };
}

/** Texto do comentário com as menções destacadas (já escapado) */
export function mentionHtml(body, mentions, nameById) {
  let html = esc(body).replace(/\n/g, "<br>");
  (mentions || []).forEach((uid) => {
    const name = esc(nameById(uid));
    html = html.split(`@${name}`).join(`<span class="mention">@${name}</span>`);
  });
  return html;
}
