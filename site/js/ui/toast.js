/* Avisos rápidos de confirmação ("Conteúdo aprovado", "Ideia enviada"...).
   Com um painel ou modal aberto, o aviso aparece dentro dele (camada do topo),
   para não ficar atrás do fundo escurecido. */

import { esc } from "../lib/dom.js?v=0470164d89";
import { icon } from "../lib/icons.js?v=0470164d89";

function container() {
  const open = document.querySelector("dialog[open]:not(.is-closing)");
  if (!open) return document.getElementById("toasts");
  let box = open.querySelector(":scope > .toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    open.appendChild(box);
  }
  return box;
}

export function toast(message, tone = "success") {
  const item = document.createElement("div");
  item.className = `toast toast--${tone}`;
  item.innerHTML = `${icon(tone === "success" ? "check" : "message")}<span>${esc(message)}</span>`;
  container().appendChild(item);
  requestAnimationFrame(() => item.classList.add("is-visible"));
  setTimeout(() => {
    item.classList.remove("is-visible");
    setTimeout(() => item.remove(), 500);
  }, 3200);
}
