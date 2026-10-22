/* Telas de estado reaproveitadas pelas listas: carregando, vazio e erro */

import { esc } from "../../../js/lib/dom.js?v=b3c5769ca7";
import { icon } from "../../../js/lib/icons.js?v=b3c5769ca7";

export const loadingRows = (rows = 5) =>
  Array.from({ length: rows }, () => `<div class="skeleton-row" aria-hidden="true">${'<span class="skeleton"></span>'.repeat(6)}</div>`).join("");

export const loadingCards = (cards = 3) =>
  Array.from({ length: cards }, () => '<span class="skeleton skeleton-card" aria-hidden="true"></span>').join("");

/**
 * @param {{ iconName: string, title: string, text: string, actions?: string, tone?: "error" }} options
 * actions: HTML de botões já montados (com data-action)
 */
export const stateBlock = ({ iconName, title, text, actions = "", tone }) => `
  <div class="state${tone ? ` state--${tone}` : ""}" role="${tone === "error" ? "alert" : "status"}">
    <span class="state__icon">${icon(iconName)}</span>
    <p class="state__title">${esc(title)}</p>
    <p class="state__text">${esc(text)}</p>
    ${actions ? `<div class="state__actions">${actions}</div>` : ""}
  </div>`;

export const button = (action, label, { primary = false, iconName, data = "" } = {}) =>
  `<button class="btn btn--sm ${primary ? "btn--primary" : "btn--ghost"}" type="button" data-action="${action}" ${data}>${iconName ? icon(iconName) : ""}<span>${esc(label)}</span></button>`;
