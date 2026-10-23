/* Pequenos elementos repetidos: etiqueta de tipo e selo de status */

import { esc } from "../lib/dom.js?v=98478e305b";
import { icon } from "../lib/icons.js?v=98478e305b";
import { ACTIVITY_TYPES, STATUS } from "../domain/model.js?v=98478e305b";

export const typeBadge = (type, long = false) => {
  const t = ACTIVITY_TYPES[type] || ACTIVITY_TYPES.outro;
  return `<span class="type-badge type--${esc(type)}">${icon(t.icon)}${esc(long ? t.label : t.short)}</span>`;
};

const STATUS_ICON = { aguardando: "clock", aprovado: "check", ajustes: "edit", publicado: "send" };

export const statusBadge = (status, long = true) => {
  if (!status) return "";
  return `<span class="status-badge status--${status}">${icon(STATUS_ICON[status])}${esc(long ? STATUS[status].label : STATUS[status].short)}</span>`;
};

/** Só o ícone, para os chips do calendário (texto para leitor de tela) */
export const statusMark = (status) => status
  ? `<span class="status-mark status--${status}" title="${esc(STATUS[status].label)}">${icon(STATUS_ICON[status])}<span class="visually-hidden">${esc(STATUS[status].label)}</span></span>`
  : "";
