/* ==========================================================================
   Prévia da mídia de referência (imagem ou vídeo)
   --------------------------------------------------------------------------
   Usada pelo calendário do cliente e pelo painel da agência.
   - Imagem: mostrada inteira e proporcional (sem cortar nem esticar).
   - Vídeo de plataforma suportada: player OFICIAL de incorporação
       YouTube (youtube-nocookie.com), Vimeo, TikTok e Google Drive.
   - Post ou reel público do Instagram: página oficial de incorporação
       (instagram.com/p/<código>/embed), sem scripts do Instagram no site.
   - Arquivo de vídeo (.mp4, .webm, .ogg, .m4v, .mov): player do navegador,
     sem tocar sozinho.
   - Qualquer outro link (Facebook, perfil do Instagram, páginas, links encurtados...)
     NÃO é incorporado: aparece um aviso amigável e o link para abrir.
   Se a imagem ou o arquivo de vídeo falhar ao carregar, a prévia vira o mesmo
   aviso (wireMediaFallbacks). Players incorporados não avisam quando falham
   (ex.: vídeo privado), por isso o link original fica sempre visível.
   A política de conteúdo (CSP) das páginas libera só esses players.
   ========================================================================== */

import { esc } from "../lib/dom.js?v=d5af9cfdc2";
import { icon } from "../lib/icons.js?v=d5af9cfdc2";

const VIDEO_FILE = /\.(mp4|webm|ogv|ogg|m4v|mov)$/i;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const host = (url) => url.hostname.replace(/^(www|m|mobile)\./, "");

/** Plataformas que não oferecem player incorporável sem scripts de terceiros */
const LINK_ONLY = {
  "facebook.com": "Facebook", "fb.watch": "Facebook",
  "vm.tiktok.com": "TikTok", "vt.tiktok.com": "TikTok", "linkedin.com": "LinkedIn",
  "x.com": "X (Twitter)", "twitter.com": "X (Twitter)", "pinterest.com": "Pinterest",
  "canva.com": "Canva", "dropbox.com": "Dropbox", "wa.me": "WhatsApp"
};

function youtube(url) {
  const h = host(url);
  let id = null; let vertical = false;
  if (h === "youtu.be") id = url.pathname.split("/")[1];
  else if (h === "youtube.com" || h === "music.youtube.com" || h === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(first)) { id = second; vertical = first === "shorts"; }
  } else return null;
  if (!id || !YOUTUBE_ID.test(id)) return { type: "link", provider: "YouTube", reason: "Este link do YouTube não aponta para um vídeo." };
  return { type: "embed", provider: "YouTube", ratio: vertical ? "vertical" : "wide", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
}

function vimeo(url) {
  const h = host(url);
  if (h !== "vimeo.com" && h !== "player.vimeo.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((p) => /^\d{5,12}$/.test(p));
  if (index < 0) return { type: "link", provider: "Vimeo", reason: "Este link do Vimeo não aponta para um vídeo." };
  const id = parts[index];
  // Vídeo não listado: vimeo.com/<id>/<hash> ou ?h=<hash>
  const hash = url.searchParams.get("h") || (h === "vimeo.com" && /^[0-9a-f]{6,20}$/i.test(parts[index + 1] || "") ? parts[index + 1] : "");
  return { type: "embed", provider: "Vimeo", ratio: "wide", src: `https://player.vimeo.com/video/${id}${hash ? `?h=${encodeURIComponent(hash)}` : ""}` };
}

function tiktok(url) {
  if (host(url) !== "tiktok.com") return null;
  const match = url.pathname.match(/\/video\/(\d{8,25})/);
  if (!match) return { type: "link", provider: "TikTok", reason: "Para mostrar aqui, use o link completo do vídeo (tiktok.com/@perfil/video/...)." };
  return { type: "embed", provider: "TikTok", ratio: "vertical", src: `https://www.tiktok.com/player/v1/${match[1]}` };
}

/** Post ou reel: instagram.com/p/<código>, /reel/<código>, /tv/<código> (com ou sem o @perfil antes) */
function instagram(url) {
  if (host(url) !== "instagram.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p));
  const code = index >= 0 ? parts[index + 1] : null;
  if (!code || !/^[A-Za-z0-9_-]{5,40}$/.test(code)) {
    return { type: "link", provider: "Instagram", reason: "Para mostrar aqui, use o link de um post ou reel (instagram.com/p/... ou instagram.com/reel/...). Perfis e stories só abrem no Instagram." };
  }
  return { type: "embed", provider: "Instagram", ratio: "instagram", src: `https://www.instagram.com/p/${code}/embed/`, hint: "Só aparece se o post for público." };
}

function drive(url) {
  if (url.hostname !== "drive.google.com") return null;
  const id = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/)?.[1] || url.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return { type: "link", provider: "Google Drive", reason: "Para mostrar aqui, use o link de um arquivo (não de uma pasta)." };
  return { type: "embed", provider: "Google Drive", ratio: "wide", src: `https://drive.google.com/file/d/${id}/preview`, poster: `https://drive.google.com/thumbnail?id=${id}&sz=w640`, hint: "Se a prévia pedir login, compartilhe o arquivo como \"qualquer pessoa com o link\"." };
}

/**
 * Decide como mostrar um link de mídia.
 * @param {string} rawUrl
 * @param {"image"|"video"} kind  o que a agência marcou no cadastro
 * @returns {{type: "image"|"video"|"embed"|"link"|"invalid", src?: string, provider?: string, ratio?: string, reason?: string, hint?: string, original?: string}}
 */
export function describeMedia(rawUrl, kind = "image") {
  let url;
  try { url = new URL(String(rawUrl || "").trim()); } catch { return { type: "invalid", reason: "O link da referência está incompleto ou com erro." }; }
  if (!["https:", "http:"].includes(url.protocol)) return { type: "invalid", reason: "O link da referência não é um endereço da web." };
  const original = url.href;

  const known = youtube(url) || vimeo(url) || tiktok(url) || instagram(url) || drive(url);
  if (known) return { ...known, original };

  const linkOnly = LINK_ONLY[host(url)] || LINK_ONLY[url.hostname];
  if (linkOnly) return { type: "link", provider: linkOnly, original, reason: `O ${linkOnly} não permite mostrar este conteúdo dentro do portal.` };

  if (VIDEO_FILE.test(url.pathname)) return { type: "video", src: original, original };
  if (kind === "video") return { type: "link", original, reason: "Este link de vídeo não pode ser mostrado aqui. Links aceitos: YouTube, Vimeo, TikTok, Google Drive, post ou reel do Instagram, ou arquivo de vídeo (.mp4, .webm)." };
  return { type: "image", src: original, original };
}

/**
 * Capa para miniaturas (listas, carrossel, agenda): a própria imagem, a capa
 * oficial do vídeo (YouTube; Google Drive quando o arquivo é público) ou o
 * primeiro quadro de um arquivo de vídeo. Vimeo, TikTok e Instagram não dão
 * capa sem scripts ou serviços de terceiros: aí fica só o ícone.
 * @returns {{kind: "image"|"video", src: string} | null}
 */
export function mediaCover(rawUrl, kind = "image") {
  if (!rawUrl) return null;
  const media = describeMedia(rawUrl, kind);
  if (media.type === "image") return { kind: "image", src: media.src };
  if (media.poster) return { kind: "image", src: media.poster };
  if (media.type === "video") return { kind: "video", src: `${media.src.split("#")[0]}#t=0.5` };
  return null;
}

/**
 * Para quem não tem capa em imagem (Instagram e Vimeo): o player oficial,
 * usado como "capa viva" no carrossel. Carregar só quando for aparecer.
 * @returns {{src: string, provider: string} | null}
 */
export function embedCover(rawUrl, kind = "image") {
  if (!rawUrl) return null;
  const media = describeMedia(rawUrl, kind);
  return media.type === "embed" && !media.poster && ["Instagram", "Vimeo"].includes(media.provider) ? { src: media.src, provider: media.provider } : null;
}

/** HTML da capa (imagem ou primeiro quadro do vídeo, sem som e sem controles) */
export function coverHtml(cover, attrs = "") {
  if (!cover) return "";
  return cover.kind === "video"
    ? `<video src="${esc(cover.src)}" muted playsinline preload="metadata" tabindex="-1" aria-hidden="true" ${attrs}></video>`
    : `<img src="${esc(cover.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" ${attrs}>`;
}

const openLink = (href, label = "Abrir referência original") =>
  `<a class="media__open" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${icon("arrowRight")}${esc(label)}</a>`;

/** Aviso amigável (também usado quando a mídia falha ao carregar) */
export function mediaFallback({ original, reason, title = "Não foi possível mostrar a prévia aqui" }) {
  return `
    <div class="media-fallback" role="note">
      <span class="media-fallback__icon">${icon("image")}</span>
      <p class="media-fallback__title">${esc(title)}</p>
      ${reason ? `<p class="media-fallback__text">${esc(reason)}</p>` : ""}
      ${original ? openLink(original) : ""}
    </div>`;
}

/**
 * HTML da prévia.
 * @param {{url: string, kind?: "image"|"video", title?: string}} media
 */
export function renderMedia({ url, kind = "image", title = "" }) {
  const media = describeMedia(url, kind);
  const label = title ? `Referência de ${title}` : "Mídia de referência";
  if (media.type === "image") {
    return `
      <figure class="media media--image" data-media-box data-original="${esc(media.original)}">
        <img src="${esc(media.src)}" alt="${esc(label)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-media>
        <figcaption class="media__foot">${openLink(media.original, "Abrir imagem original")}</figcaption>
      </figure>`;
  }
  if (media.type === "video") {
    return `
      <figure class="media media--video" data-media-box data-original="${esc(media.original)}">
        <video src="${esc(media.src)}" controls playsinline preload="metadata" aria-label="${esc(label)}" data-media></video>
        <figcaption class="media__foot">${openLink(media.original, "Abrir vídeo original")}</figcaption>
      </figure>`;
  }
  if (media.type === "embed") {
    return `
      <figure class="media media--embed media--${media.ratio}" data-provider="${esc(media.provider)}">
        <div class="media__frame">
          <iframe src="${esc(media.src)}" title="${esc(`${media.provider === "Instagram" ? "Post do Instagram" : `Vídeo do ${media.provider}`}: ${title || "referência"}`)}" loading="lazy"
            allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"></iframe>
        </div>
        <figcaption class="media__foot">
          ${media.hint ? `<span class="media__hint">${esc(media.hint)}</span>` : ""}
          ${openLink(media.original, `Abrir no ${media.provider}`)}
        </figcaption>
      </figure>`;
  }
  return mediaFallback({ original: media.original, reason: media.reason, title: media.provider ? `Prévia indisponível para links do ${media.provider}` : undefined });
}

/** Imagem ou arquivo de vídeo que não carregou vira o aviso com o link */
export function wireMediaFallbacks(root) {
  root.addEventListener("error", (event) => {
    const element = event.target;
    if (!(element instanceof HTMLElement) || !element.matches("[data-media]")) return;
    const box = element.closest("[data-media-box]");
    if (!box) return;
    box.outerHTML = mediaFallback({
      original: box.dataset.original,
      reason: element.tagName === "VIDEO"
        ? "O vídeo não carregou. O link pode estar fora do ar, ser privado ou usar um formato que este navegador não reproduz."
        : "A imagem não carregou. O link pode estar fora do ar, ser privado ou não apontar direto para uma imagem."
    });
  }, true);
}
