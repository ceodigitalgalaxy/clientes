/* Prévia do conteúdo no portal:
   - Arte final (o que vai ser publicado): um item ou carrossel, em destaque.
   - Referência: a inspiração cadastrada pela equipe.
   Sempre pelas regras de ui/media.js (imagem proporcional, players oficiais,
   aviso + link quando não dá para mostrar). */

import { esc } from "../lib/dom.js?v=d5af9cfdc2";
import { icon } from "../lib/icons.js?v=d5af9cfdc2";
import { renderMedia, mediaFallback } from "./media.js?v=d5af9cfdc2";

const emptyArt = (activity) => {
  const noArt = ["campanha", "acao", "gravacao", "reuniao"].includes(activity.type);
  return `
    <div class="art-empty">
      <span class="art-empty__icon">${icon(noArt ? "calendar" : "image")}</span>
      <p class="art-empty__title">${noArt ? "Esta atividade não tem arte" : "A arte ainda está em produção"}</p>
      <p class="art-empty__text">${noArt ? "Confira os detalhes abaixo." : "Assim que ficar pronta, ela aparece aqui para você conferir."}</p>
    </div>`;
};

/** Referência (inspiração) */
export function renderPreview(activity) {
  const media = activity.media || [];
  if (!media.length) return emptyArt(activity);
  return media.map((item) => renderMedia({ url: item.src, kind: item.kind, title: activity.title })).join("");
}

/** Arte final: um item ou carrossel com setas e contador */
export function renderFinal(activity) {
  const items = activity.final || [];
  if (!items.length) return "";
  const slides = items.map((item, i) => `
    <div class="carousel__slide" data-slide="${i}" ${items.length > 1 ? `role="group" aria-label="${i + 1} de ${items.length}"` : ""}>
      ${item.src
        ? renderMedia({ url: item.src, kind: item.kind, title: items.length > 1 ? `${activity.title} (${i + 1})` : activity.title })
        : mediaFallback({ title: "Não foi possível abrir este arquivo agora", reason: "Feche e abra os detalhes de novo em instantes." })}
    </div>`).join("");
  if (items.length === 1) return `<div class="final-single">${slides}</div>`;
  return `
    <div class="carousel" data-carousel>
      <div class="carousel__track" tabindex="0" aria-label="Carrossel com ${items.length} itens. Use as setas para passar.">${slides}</div>
      <div class="carousel__nav">
        <button class="icon-btn" type="button" data-carousel-step="-1" aria-label="Item anterior" disabled>${icon("chevronLeft")}</button>
        <span class="carousel__count" aria-live="polite"><b>1</b> de ${esc(items.length)}</span>
        <button class="icon-btn" type="button" data-carousel-step="1" aria-label="Próximo item">${icon("chevronRight")}</button>
      </div>
    </div>`;
}

/** Setas e contador do carrossel (uma vez por painel) */
export function wireCarousel(root) {
  const update = (carousel) => {
    const track = carousel.querySelector(".carousel__track");
    const total = track.children.length;
    const index = Math.min(total - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
    carousel.querySelector(".carousel__count b").textContent = String(index + 1);
    carousel.querySelector('[data-carousel-step="-1"]').disabled = index <= 0;
    carousel.querySelector('[data-carousel-step="1"]').disabled = index >= total - 1;
  };
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-carousel-step]");
    if (!button || !root.contains(button)) return;
    const carousel = button.closest("[data-carousel]");
    const track = carousel.querySelector(".carousel__track");
    const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) + Number(button.dataset.carouselStep);
    track.scrollTo({ left: index * track.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  root.addEventListener("scroll", (event) => {
    const track = event.target;
    if (track instanceof HTMLElement && track.classList.contains("carousel__track")) update(track.closest("[data-carousel]"));
  }, true);
  root.addEventListener("keydown", (event) => {
    const track = event.target;
    if (!(track instanceof HTMLElement) || !track.classList.contains("carousel__track")) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    track.closest("[data-carousel]").querySelector(`[data-carousel-step="${event.key === "ArrowLeft" ? -1 : 1}"]`).click();
  });
}
