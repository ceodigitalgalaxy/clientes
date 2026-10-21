/* Utilitários de DOM: escape de texto e montagem de HTML com segurança */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapa texto vindo dos dados (sempre usar antes de colocar em innerHTML) */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escuta eventos de filhos que casam com o seletor (delegação) */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Dispositivo com mouse de verdade: o resumo do dia abre no hover */
export const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
