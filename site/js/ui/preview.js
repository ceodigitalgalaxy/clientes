/* Prévia da arte: mostra a referência cadastrada pela equipe com as regras de
   ui/media.js (imagem proporcional, players oficiais, aviso + link). */

import { esc } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { renderMedia } from "./media.js";

export function renderPreview(activity, brand = "") {
  const media = activity.media || [];
  if (!media.length) {
    const noArt = ["campanha", "acao", "gravacao", "reuniao"].includes(activity.type);
    return `
      <div class="art-empty">
        <span class="art-empty__icon">${icon(noArt ? "calendar" : "image")}</span>
        <p class="art-empty__title">${noArt ? "Esta atividade não tem arte" : "A arte ainda está em produção"}</p>
        <p class="art-empty__text">${noArt ? "Confira os detalhes abaixo." : "Assim que ficar pronta, ela aparece aqui para você conferir."}</p>
      </div>`;
  }
  return media.map((item) => renderMedia({ url: item.src, kind: item.kind, title: activity.title })).join("");
}
