/* Prévia da arte. "mock" é uma prévia ILUSTRATIVA da demonstração, desenhada em CSS;
   "image" e "video" (dados reais) mostram a referência cadastrada pela equipe,
   com as regras de ui/media.js (imagem proporcional, players oficiais, aviso + link). */

import { esc } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { renderMedia } from "./media.js";

const ratioClass = (ratio) => ({ "1:1": "square", "4:5": "portrait", "9:16": "vertical" }[ratio] || "square");

function mockArt(media, type, brand) {
  const isVideo = type === "reels" || type === "stories";
  const slides = media.slides > 1 ? `<span class="art__slides">${icon("layers")}1/${media.slides}</span>` : "";
  return `
    <figure class="art art--${ratioClass(media.ratio)} art--${esc(media.palette || "wheat")}">
      <div class="art__canvas">
        <span class="art__brand">${esc(brand)}</span>
        <p class="art__headline">${esc(media.headline)}</p>
        ${isVideo ? `<span class="art__play">${icon("play")}</span>` : ""}
        ${slides}
      </div>
      <figcaption class="art__caption">Prévia ilustrativa (demonstração)</figcaption>
    </figure>`;
}

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
  return media.map((item) => {
    if (item.kind === "image" || item.kind === "video") return renderMedia({ url: item.src, kind: item.kind, title: activity.title });
    return mockArt(item, activity.type, brand);
  }).join("");
}
