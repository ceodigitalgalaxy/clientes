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
// Dados reais: pedidos de ajuste ainda não passam pelo portal; mostra os publicados
const LIVE_STATS = [...STATS.slice(0, 3), { key: "publicado", label: "Publicados", tone: "publicado" }];

export function renderSummary(container, { plan, counts, month, live = false, hasActivities = false }) {
  const focus = !plan && live && hasActivities
    ? `
      <article class="focus">
        <p class="focus__eyebrow">${icon("target2")}Seus conteúdos de ${esc(monthName(month).toLowerCase())}</p>
        <h2 class="focus__title">Confira o que a nossa equipe preparou</h2>
        <p class="focus__text">Clique em um dia ou em um conteúdo para ver a prévia, a legenda e o status.</p>
      </article>`
    : plan
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

  const stats = (live ? LIVE_STATS : STATS).map((s) => `
      <li class="stat stat--${s.tone}">
        <span class="stat__value">${counts[s.key]}</span>
        <span class="stat__label">${s.label}</span>
      </li>`).join("");

  container.innerHTML = `${focus}<ul class="stats" aria-label="Indicadores do mês">${stats}</ul>`;
}
