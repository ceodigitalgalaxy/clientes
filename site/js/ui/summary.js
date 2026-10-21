/* Resumo do mês: "Nosso foco neste mês" + quatro indicadores discretos */

import { esc } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { monthName } from "../lib/dates.js";

const STATS = [
  { key: "planejados", label: "Conteúdos planejados", tone: "neutral" },
  { key: "aguardando", label: "Aguardando aprovação", tone: "aguardando" },
  { key: "aprovado",   label: "Aprovados",            tone: "aprovado" },
  { key: "ajustes",    label: "Ajustes solicitados",  tone: "ajustes" }
];

export function renderSummary(container, { plan, counts, month }) {
  const focus = plan
    ? `
      <article class="focus">
        <p class="focus__eyebrow">${icon("target2")}Nosso foco em ${esc(monthName(month).toLowerCase())}</p>
        <h2 class="focus__title">${esc(plan.focus.title)}</h2>
        <p class="focus__text">${esc(plan.focus.summary)}</p>
      </article>`
    : `
      <article class="focus focus--empty">
        <p class="focus__eyebrow">${icon("target2")}Nosso foco em ${esc(monthName(month).toLowerCase())}</p>
        <h2 class="focus__title">O planejamento deste mês ainda está sendo preparado</h2>
        <p class="focus__text">Assim que a nossa equipe compartilhar, a estratégia e os conteúdos aparecem aqui.</p>
      </article>`;

  const stats = STATS.map((s) => `
      <li class="stat stat--${s.tone}">
        <span class="stat__value">${counts[s.key]}</span>
        <span class="stat__label">${s.label}</span>
      </li>`).join("");

  container.innerHTML = `${focus}<ul class="stats" aria-label="Indicadores do mês">${stats}</ul>`;
}
