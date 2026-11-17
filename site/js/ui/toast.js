/* Avisos rápidos de confirmação ("Conteúdo aprovado", "Ideia enviada"...).
   Com um painel ou modal aberto, o aviso aparece dentro dele (camada do topo),
   para não ficar atrás do fundo escurecido. */

import { esc } from "../lib/dom.js?v=852f83f166";
import { icon } from "../lib/icons.js?v=852f83f166";

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
  const box = container();
  // No máximo 2 avisos à vista: o mais antigo sai para não cobrir a tela
  [...box.querySelectorAll(".toast")].slice(0, -1).forEach((old) => { old.classList.remove("is-visible"); setTimeout(() => old.remove(), 300); });
  if (tone === "error") item.setAttribute("role", "alert");
  box.appendChild(item);
  void item.offsetWidth;   // garante que a entrada anime (estado inicial já pintado)
  item.classList.add("is-visible");
  // Erro fica mais tempo na tela: precisa ser lido
  setTimeout(() => {
    item.classList.remove("is-visible");
    setTimeout(() => item.remove(), 400);
  }, tone === "error" ? 5200 : 3200);
}
