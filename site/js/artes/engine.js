/* ==========================================================================
   Motor das artes (canvas): desenha Oferta, Plano e Aviso nos formatos
   stories (1080×1920), feed (1080×1080) e A4 (1240×1754, exporta em dobro).
   --------------------------------------------------------------------------
   Tudo vem da identidade do cliente (kit): cores, logos e unidades.
   As campanhas sazonais (Natal, Black Friday...) trocam só a paleta.
   As letras diminuem sozinhas até tudo caber; nada é cortado.
   ========================================================================== */

export const FORMATS = {
  story: { W: 1080, H: 1920, exp: 1, label: "Stories", size: "1080×1920" },
  feed: { W: 1080, H: 1080, exp: 1, label: "Feed", size: "1080×1080" },
  a4: { W: 1240, H: 1754, exp: 2, label: "A4", size: "impressão" }
};

export const CAMPAIGNS = {
  padrao: { label: "Identidade da marca", titulo: ["Ofertas da", "Semana"], plano: ["Super oferta!", ""] },
  verao: { label: "Verão", titulo: ["Ofertas de", "Verão"], plano: ["Verão", "Super oferta!"] },
  natal: { label: "Natal", titulo: ["Ofertas de", "Natal"], plano: ["Natal", "Presente pro pet"] },
  halloween: { label: "Halloween", titulo: ["Ofertas de", "Halloween"], plano: ["Halloween", ""] },
  blackfriday: { label: "Black Friday", titulo: ["", "Black Friday"], plano: ["Black Friday", ""] },
  pascoa: { label: "Páscoa", titulo: ["Ofertas de", "Páscoa"], plano: ["Páscoa", "Super oferta!"] },
  maes: { label: "Dia das Mães", titulo: ["Especial", "Dia das Mães"], plano: ["Dia das Mães", ""] },
  pais: { label: "Dia dos Pais", titulo: ["Especial", "Dia dos Pais"], plano: ["Dia dos Pais", ""] },
  pets: { label: "Dia dos Animais", titulo: ["Especial", "Dia dos Animais"], plano: ["Dia dos Animais", ""] }
};

/** Modelos de arte (a agência libera os que fazem sentido para cada cliente) */
export const MODELS = {
  oferta: { label: "Oferta", hint: "produto e preço" },
  plano: { label: "Plano", hint: "serviço ou pacote" },
  evento: { label: "Evento", hint: "aula, episódio, data" },
  antesdepois: { label: "Antes e depois", hint: "resultado" },
  frase: { label: "Frase", hint: "dica, depoimento" },
  aviso: { label: "Aviso", hint: "feriado, horário" }
};

export const STATUS = { normal: "Funciona normalmente", reduzido: "Horário reduzido", especial: "Horário especial", fechado: "Fechada", oculto: "Não mostrar no card" };

/* ---------- cores ---------- */
const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const luma = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const pick = (value, fallback) => (HEX.test(String(value || "")) ? value : fallback);

/** Paleta da marca a partir das cores do cliente */
export function brandTheme(colors = {}) {
  const p = pick(colors.primaria, "#06603A"), s = pick(colors.secundaria, "#A9CF45");
  const dark = mix(p, "#000000", 0.25);
  return {
    bg1: mix(p, "#FFFFFF", 0.06), bg2: mix(p, "#000000", 0.2), deco1: s, deco2: mix(s, "#000000", 0.18),
    sub: mix(p, "#FFFFFF", 0.88), titleA: mix(pick(colors.titulo, "#FFD84D"), "#FFFFFF", 0.25), titleB: pick(colors.titulo, "#F59E0B"),
    chamada: "#FFFFFF", price: pick(colors.preco, "#F28C00"), tag: s, tagInk: luma(s) > 0.55 ? dark : "#FFFFFF",
    alert: pick(colors.alerta, "#E53935"), waveInk: luma(s) > 0.55 ? dark : "#FFFFFF", card: "#FFFFFF", cardInk: luma(p) < 0.6 ? p : dark,
    cardText: "#3A4740", cardPill: luma(p) < 0.6 ? p : dark, ribbon: s, ribbon2: luma(p) < 0.6 ? p : dark, snow: false, shadow: false
  };
}
const SEASONS = {
  verao: { bg1: "#4FD6D8", bg2: "#1FB3BF", deco1: "#F7C35A", deco2: "#F0A93B", sub: "#FFFFFF", titleA: "#D4EA6A", titleB: "#7DBA2F", waveInk: "#6B3E0C", tag: "#FFFFFF", tagInk: "#0E7C86", cardInk: "#0E7C86", cardPill: "#0E7C86", ribbon: "#F7C35A", ribbon2: "#0E7C86", shadow: true },
  natal: { bg1: "#0F5A36", bg2: "#083822", deco1: "#C62828", deco2: "#E3B04B", sub: "#F3E9D2", titleA: "#FFF0B8", titleB: "#E3B04B", price: "#C62828", tag: "#E3B04B", tagInk: "#4A1010", waveInk: "#FFFFFF", cardInk: "#0F5A36", cardPill: "#C62828", ribbon: "#C62828", ribbon2: "#0F5A36", alert: "#C62828", snow: true },
  halloween: { bg1: "#3A2366", bg2: "#160C2A", deco1: "#FF8A1F", deco2: "#7B4FBF", sub: "#E2D9F3", titleA: "#FFC15E", titleB: "#FF6A00", price: "#E8590C", tag: "#FF8A1F", tagInk: "#160C2A", waveInk: "#160C2A", cardInk: "#3A2366", cardPill: "#E8590C", ribbon: "#FF8A1F", ribbon2: "#3A2366", alert: "#E8590C" },
  blackfriday: { bg1: "#1C1C1C", bg2: "#050505", deco1: "#FFD400", deco2: "#3A3A3A", sub: "#E6E6E6", titleA: "#FFE34D", titleB: "#FFC400", price: "#D62828", tag: "#FFD400", tagInk: "#111111", waveInk: "#111111", cardInk: "#111111", cardPill: "#111111", ribbon: "#FFD400", ribbon2: "#111111", alert: "#D62828" },
  pascoa: { bg1: "#8E6CC9", bg2: "#5B3E96", deco1: "#F9D56E", deco2: "#F4A6C6", sub: "#F6F0FF", titleA: "#FFF3B0", titleB: "#F9D56E", price: "#E0569B", tag: "#F9D56E", tagInk: "#3E2A66", waveInk: "#3E2A66", cardInk: "#5B3E96", cardPill: "#E0569B", ribbon: "#F4A6C6", ribbon2: "#5B3E96", alert: "#E0569B" },
  maes: { bg1: "#E2557F", bg2: "#A8274F", deco1: "#FFD1DC", deco2: "#F7A1B9", sub: "#FFF0F4", titleA: "#FFFFFF", titleB: "#FFD1DC", price: "#C2185B", tag: "#FFD1DC", tagInk: "#7A1033", waveInk: "#7A1033", cardInk: "#A8274F", cardPill: "#C2185B", ribbon: "#FFD1DC", ribbon2: "#A8274F", alert: "#C2185B" },
  pais: { bg1: "#24527A", bg2: "#13324D", deco1: "#F2B33D", deco2: "#5C8DB8", sub: "#E6EEF6", titleA: "#FFE29A", titleB: "#F2B33D", price: "#E07A00", tag: "#F2B33D", tagInk: "#13324D", waveInk: "#13324D", cardInk: "#24527A", cardPill: "#24527A", ribbon: "#F2B33D", ribbon2: "#13324D", alert: "#E07A00" },
  pets: { bg1: "#2F8F83", bg2: "#1B5E56", deco1: "#FFC857", deco2: "#F28F3B", sub: "#E8F6F4", titleA: "#FFE29A", titleB: "#FFC857", price: "#F28F3B", tag: "#FFC857", tagInk: "#1B5E56", waveInk: "#1B5E56", cardInk: "#1B5E56", cardPill: "#F28F3B", ribbon: "#FFC857", ribbon2: "#1B5E56", alert: "#E4572E" }
};
export function themeFor(campaign, colors) {
  const base = brandTheme(colors);
  return campaign === "padrao" || !SEASONS[campaign] ? base : { ...base, snow: false, shadow: false, ...SEASONS[campaign] };
}

/* ---------- textos ---------- */
const MS = "'Montserrat', system-ui, sans-serif";
const f = (w, px, it) => `${it ? "italic " : ""}${w} ${Math.round(px)}px ${MS}`;
const ANTON = (px) => `${Math.round(px)}px 'Anton', Impact, sans-serif`;
const LILITA = (px) => `${Math.round(px)}px 'Lilita One', 'Arial Black', sans-serif`;
const ls = (ctx, px) => { if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`; };

export const formatMoney = (v) => {
  v = String(v || "").trim().replace(/^R\$\s*/i, "");
  if (!v) return "";
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? v : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const isMoney = (v) => Boolean(v) && !Number.isNaN(Number(formatMoney(v).replace(/\./g, "").replace(",", ".")));
const formatDate = (v) => { if (!v) return ""; const [y, m, d] = v.split("-"); return `${d}/${m}/${y}`; };
export const formatPhone = (z) => { const d = String(z || "").replace(/\D/g, ""); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d; };

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function lines(ctx, text, font, width, max) {
  ctx.font = font;
  const out = [];
  let line = "";
  for (const w of String(text || "").split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  if (out.length > max) {
    const keep = out.slice(0, max);
    let l = keep[max - 1];
    while (l.length > 1 && ctx.measureText(`${l}…`).width > width) l = l.slice(0, -1);
    keep[max - 1] = `${l.replace(/\s+\S*$/, "")}…`;
    return keep;
  }
  return out;
}
/** Linhas com larguras parecidas: nenhuma palavra sozinha na última linha */
function balanced(ctx, text, font, width, max) {
  const base = lines(ctx, text, font, width, max);
  if (base.length < 2 || /…$/.test(base[base.length - 1])) return base;
  let lo = width * 0.35, hi = width;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2, t = lines(ctx, text, font, mid, max);
    if (t.length === base.length && !/…$/.test(t[t.length - 1])) hi = mid; else lo = mid;
  }
  return lines(ctx, text, font, hi, max);
}
function textBlock(ctx, text, { font, x, y, w, lh, max, color, align, draw, upper }) {
  const rows = balanced(ctx, upper ? String(text).toUpperCase() : text, font, w, max);
  if (draw) {
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = "top"; ctx.textAlign = align || "left";
    const ax = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
    rows.forEach((l, i) => ctx.fillText(l, ax, y + i * lh));
    ctx.textAlign = "left";
  }
  return y + rows.length * lh;
}
const DW = (im) => im.naturalWidth || im.width, DH = (im) => im.naturalHeight || im.height;
function contain(ctx, im, x, y, w, h, valign) {
  if (!im) return;
  const r = Math.min(w / DW(im), h / DH(im)), iw = DW(im) * r, ih = DH(im) * r;
  ctx.drawImage(im, x + (w - iw) / 2, valign === "bottom" ? y + h - ih : y + (h - ih) / 2, iw, ih);
}
function cover(ctx, im, x, y, w, h) { const r = Math.max(w / DW(im), h / DH(im)), iw = DW(im) * r, ih = DH(im) * r; ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
function placeholder(ctx, x, y, w, h, label) {
  ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.setLineDash([14, 10]); ctx.lineWidth = 3; rr(ctx, x, y, w, h, 24); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = f(700, Math.max(22, w / 16)); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + w / 2, y + h / 2); ctx.restore();
}

/** Foto recortada com sombra de contato no chão + sombra suave (esconde a borda do recorte) */
function cutout(ctx, im, x, y, w, h, { shadow = true, valign } = {}) {
  if (!im) return;
  const r = Math.min(w / DW(im), h / DH(im)), iw = DW(im) * r, ih = DH(im) * r;
  const ix = x + (w - iw) / 2, iy = valign === "bottom" ? y + h - ih : y + (h - ih) / 2;
  if (shadow) {
    ctx.save();
    const cx = ix + iw / 2, cy = iy + ih - ih * 0.01, rx = iw * 0.46, ry = Math.max(10, iw * 0.07);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(0.55, "rgba(0,0,0,.18)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.translate(cx, cy); ctx.scale(1, ry / rx); ctx.translate(-cx, -cy);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.38)"; ctx.shadowBlur = Math.max(18, iw * 0.05); ctx.shadowOffsetY = Math.max(8, iw * 0.025);
    ctx.drawImage(im, ix, iy, iw, ih); ctx.restore();
  } else ctx.drawImage(im, ix, iy, iw, ih);
}
function coverRound(ctx, im, x, y, w, h, r) { ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip(); cover(ctx, im, x, y, w, h); ctx.restore(); }

/**
 * @param {object} options
 * @param {object} options.kit     identidade do cliente (colors, units, legal)
 * @param {object} options.logos   imagens carregadas: { emblema, principal, alternativo }
 */
export function createEngine({ kit, logos }) {
  const units = Array.isArray(kit.units) ? kit.units : [];
  const logoOf = (key) => logos[key] || logos.principal || logos.emblema || null;

  function logo(ctx, key, x, y, h) {
    const im = logoOf(key);
    if (!im || !DW(im)) return 0;
    const w = (h * DW(im)) / DH(im);
    ctx.drawImage(im, x, y, w, h);
    return w;
  }

  function background(ctx, F, T, wave, noArcs) {
    const { W, H } = F, g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, T.bg1); g.addColorStop(1, T.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!noArcs) {
      ctx.save(); ctx.lineCap = "round";
      ctx.strokeStyle = T.deco1; ctx.lineWidth = W * 0.055; ctx.beginPath(); ctx.arc(-W * 0.03, -W * 0.03, W * 0.2, 0, Math.PI / 2); ctx.stroke();
      ctx.strokeStyle = T.deco2; ctx.lineWidth = W * 0.018; ctx.beginPath(); ctx.arc(-W * 0.03, -W * 0.03, W * 0.265, 0.05, Math.PI / 2 - 0.05); ctx.stroke(); ctx.restore();
    }
    if (T.snow) {
      ctx.fillStyle = "rgba(255,255,255,.18)";
      let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
      for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H * 0.8, 2 + rnd() * 6, 0, Math.PI * 2); ctx.fill(); }
    }
    if (wave) {
      const hw = wave;
      ctx.fillStyle = T.deco2; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - hw * 0.55); ctx.bezierCurveTo(W * 0.3, H - hw * 0.2, W * 0.62, H - hw * 1.35, W, H - hw * 1.12); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.deco1; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - hw * 0.3); ctx.bezierCurveTo(W * 0.32, H - hw * 0.02, W * 0.6, H - hw * 1.1, W, H - hw * 0.85); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }

  /** Título da campanha: chamada pequena + nome grande em degradê */
  function campaign(ctx, { x, y, w, chamada, nome, T, max, draw }) {
    let size = max;
    ctx.font = ANTON(size);
    const tw = ctx.measureText(nome.toUpperCase()).width;
    if (tw > w) size = (size * w) / tw;
    const cs = Math.max(26, max * 0.27), ax = x + w / 2;
    let cy = y;
    if (chamada) {
      if (draw) {
        ctx.font = f(800, cs, true); ctx.fillStyle = T.chamada; ctx.textAlign = "center"; ctx.textBaseline = "top";
        if (T.shadow) { ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 8; }
        ctx.fillText(chamada, ax, cy); ctx.shadowColor = "transparent";
      }
      cy += cs * 1.18 + size * 0.14;
    }
    if (draw) {
      ctx.save(); ctx.font = ANTON(size); ctx.textAlign = "center"; ctx.textBaseline = "top";
      const g = ctx.createLinearGradient(0, cy, 0, cy + size * 1.15); g.addColorStop(0, T.titleA); g.addColorStop(1, T.titleB);
      ctx.shadowColor = "rgba(0,0,0,.30)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6; ctx.fillStyle = g; ctx.fillText(nome.toUpperCase(), ax, cy); ctx.restore(); ctx.textAlign = "left";
    }
    return cy + size * 1.2;
  }

  function tagPill(ctx, x, y, text, T, s) {
    ctx.font = f(900, 26 * s); ls(ctx, 2);
    const t = text.toUpperCase(), w = ctx.measureText(t).width + 56 * s;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.03); ctx.fillStyle = T.tag; rr(ctx, 0, 0, w, 54 * s, 10 * s); ctx.fill();
    ctx.fillStyle = T.tagInk; ctx.textBaseline = "middle"; ctx.fillText(t, 28 * s, 27 * s + 1); ctx.restore(); ls(ctx, 0);
    return w;
  }

  /** "DE" riscado + caixa branca "POR APENAS" com o preço numa linha de base só */
  function priceBlock(ctx, { x, y, w, d, T, s, draw }) {
    const de = formatMoney(d.de), por = formatMoney(d.por);
    let cy = y;
    if (de) {
      const t = `DE: R$ ${de}`;
      ctx.font = f(700, 32 * s);
      const tw = ctx.measureText(t).width;
      if (draw) {
        ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "top"; ctx.fillText(t, x, cy);
        const pre = ctx.measureText("DE: ").width;
        ctx.strokeStyle = T.alert; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.moveTo(x + pre - 2, cy + 19 * s); ctx.lineTo(x + tw + 2, cy + 19 * s); ctx.stroke();
      }
      cy += 32 * s * 1.45;
    }
    const padX = 30 * s, padY = 24 * s, lab = 24 * s, big = 104 * s, rsz = 50 * s;
    ctx.font = ANTON(big); const nw = ctx.measureText(por).width;
    ctx.font = ANTON(rsz); const rw = ctx.measureText("R$").width + 10 * s;
    ctx.font = f(900, lab); ls(ctx, 1.5); const lw = ctx.measureText("POR APENAS:").width; ls(ctx, 0);
    const bw = Math.min(w, Math.max(lw, rw + nw) + padX * 2), bh = padY + lab + 10 * s + big * 1.02 + padY * 0.7;
    if (draw) {
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.22)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8; ctx.fillStyle = "#FFFFFF"; rr(ctx, x, cy, bw, bh, 18 * s); ctx.fill(); ctx.restore();
      ctx.textBaseline = "top"; ctx.fillStyle = T.price; ctx.font = f(900, lab); ls(ctx, 1.5); ctx.fillText("POR APENAS:", x + padX, cy + padY); ls(ctx, 0);
      const base = cy + padY + lab + 10 * s + big * 0.98;
      ctx.textBaseline = "alphabetic"; ctx.font = ANTON(rsz); ctx.fillText("R$", x + padX, base); ctx.font = ANTON(big); ctx.fillText(por, x + padX + rw, base);
    }
    if (Math.max(lw, rw + nw) + padX * 2 > w) cy += 1e6;   // preço largo demais: conta como "não coube"
    cy += bh;
    if (d.extra) { cy += 14 * s; cy = textBlock(ctx, d.extra, { font: f(700, 26 * s), x, y: cy, w, lh: 26 * s * 1.3, max: 2, color: "#FFFFFF", draw }); }
    return cy;
  }

  /* ----- OFERTA: produto à esquerda, nome e preço à direita ----- */
  function oferta(ctx, F, T, d, U, s, draw) {
    const { W, H } = F, story = d.formato === "story", feed = d.formato === "feed";
    const pad = feed ? 60 : (72 * W) / 1080, hw = feed ? 150 : story ? 230 : 210, logoH = feed ? 170 : story ? 220 : 230;
    if (draw) background(ctx, F, T, hw);
    let y = campaign(ctx, { x: pad, y: feed ? 40 : story ? 220 : 90, w: W - pad * 2, chamada: d.chamada, nome: d.nome, T, max: (feed ? 140 : story ? 210 : 190) * Math.min(s, 1), draw });
    y += feed ? 18 : 40;
    const bottom = H - hw * 0.62 - 24;
    const rx = W * 0.48, lx = pad, lw = rx - pad - 36, rw = W - rx - pad, bottomL = H - hw * 0.62 - logoH - 8;
    let need = 0;
    if (d.selo) need += 54 * s + 16 * s;
    need += lines(ctx, d.produto, f(800, 34 * s), rw, 4).length * 34 * s * 1.18 + 18 * s;
    if (d.descricao) need += lines(ctx, d.descricao, f(500, 24 * s), rw, 3).length * 24 * s * 1.35 + 14 * s;
    need += priceBlock(ctx, { x: rx, y: 0, w: rw, d, T, s, draw: false });
    if (y + need > bottom) return bottom + 1;
    let ry = Math.min(bottom - need, y + Math.max(0, (bottomL - y - need) / 2));
    if (draw) {
      if (d.photo) cutout(ctx, d.photo, lx, y, lw, bottomL - y, { shadow: d.shadow !== false });
      else placeholder(ctx, lx, y, lw, bottomL - y, "Foto do produto");
    }
    if (d.selo) { if (draw) tagPill(ctx, rx, ry, d.selo, T, s); ry += 54 * s + 16 * s; }
    ry = textBlock(ctx, d.produto, { font: f(800, 34 * s), x: rx, y: ry, w: rw, lh: 34 * s * 1.18, max: 4, color: "#FFFFFF", draw }) + 18 * s;
    if (d.descricao) ry = textBlock(ctx, d.descricao, { font: f(500, 24 * s), x: rx, y: ry - 4 * s, w: rw, lh: 24 * s * 1.35, max: 3, color: T.sub, draw }) + 14 * s;
    priceBlock(ctx, { x: rx, y: ry, w: rw, d, T, s, draw });
    if (draw) {
      const lwid = logo(ctx, U?.logo || "principal", pad, H - hw * 0.62 - logoH, logoH);
      const legal = d.validade ? `Oferta válida até ${formatDate(d.validade)} ${kit.legal || "ou enquanto durarem os estoques."}` : (kit.legal || "Oferta por tempo limitado.");
      ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = T.waveInk; ctx.font = f(800, Math.round((W / 1080) * 24));
      ctx.fillText(legal, W - pad * 0.7, H - Math.max(22, hw * 0.16), W - lwid - pad * 2); ctx.textAlign = "left";
    }
    return 0;
  }

  /* ----- PLANO: faixa no topo, foto e cartão branco ----- */
  const PL = { feed: { ht: 36, eh: 132, pt: 150, pb: 600, ct: 540, cb: 1036, pad: 60, hw: 120 }, story: { ht: 200, eh: 170, pt: 330, pb: 1090, ct: 1000, cb: 1660, pad: 70, hw: 200 }, a4: { ht: 70, eh: 180, pt: 230, pb: 900, ct: 820, cb: 1630, pad: 90, hw: 170 } };
  function plano(ctx, F, T, d, U, s, draw) {
    const { W, H } = F, P = PL[d.formato], pad = P.pad, cx = pad, cw = W - pad * 2, ch = P.cb - P.ct, mid = W / 2;
    const inner = cw - 80 * s;
    let need = 56 * s + 22 * s;
    const tl = balanced(ctx, d.titulo.toUpperCase(), f(900, 52 * s), inner, 3); need += tl.length * 52 * s * 1.1 + 12 * s;
    const dl = d.detalhe ? balanced(ctx, d.detalhe, f(600, 30 * s), inner, 2) : []; need += dl.length * 30 * s * 1.3 + (dl.length ? 16 * s : 0);
    if (d.brinde) need += 50 * s + 16 * s;
    need += (d.modo === "desconto" ? 150 : 84) * s * 1.05 + 18 * s;
    need += 2 * 24 * s * 1.35 + 30 * s;
    if (need > ch - 50 * s) return H;
    if (!draw) return 0;
    background(ctx, F, T, P.hw, true);
    // cabeçalho: emblema + faixas
    logo(ctx, "emblema", pad, P.ht, P.eh);
    ctx.save(); ctx.translate(pad + P.eh * 0.9, P.ht + P.eh * 0.18); ctx.rotate(-0.035);
    ctx.font = f(900, P.eh * 0.36, true); ls(ctx, 4);
    const c1 = (d.chamada || " ").toUpperCase(), w1 = ctx.measureText(c1).width + 50;
    ctx.fillStyle = T.ribbon; rr(ctx, 0, 0, w1, P.eh * 0.5, 6); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 6; ctx.fillText(c1, 25, P.eh * 0.25 + 2); ctx.shadowColor = "transparent";
    const c2 = (d.nome || "").toUpperCase();
    if (c2) {
      ctx.font = f(800, P.eh * 0.22); ls(ctx, 5); const w2 = ctx.measureText(c2).width + 44;
      ctx.fillStyle = T.ribbon2; rr(ctx, w1 * 0.18, P.eh * 0.5, w2, P.eh * 0.34, 4); ctx.fill(); ctx.fillStyle = "#FFFFFF"; ctx.fillText(c2, w1 * 0.18 + 22, P.eh * 0.67 + 1);
    }
    ls(ctx, 0); ctx.restore();
    // foto com cortes inclinados
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, P.pt + 30); ctx.lineTo(W, P.pt); ctx.lineTo(W, P.pb - 30); ctx.lineTo(0, P.pb); ctx.closePath(); ctx.clip();
    if (d.photo) cover(ctx, d.photo, 0, P.pt, W, P.pb - P.pt);
    else { ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(0, P.pt, W, P.pb - P.pt); placeholder(ctx, pad, P.pt + 40, W - pad * 2, P.ct - P.pt - 60, "Foto do serviço"); }
    ctx.restore();
    // cartão branco
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; ctx.fillStyle = T.card; rr(ctx, cx, P.ct, cw, ch, 34 * s); ctx.fill(); ctx.restore();
    let y = P.ct + Math.max(36 * s, (ch - need) / 2);
    ctx.font = f(900, 30 * s); ls(ctx, 2);
    const pt = d.tipo.toUpperCase(), pw = ctx.measureText(pt).width + 70 * s;
    ctx.fillStyle = T.cardPill; rr(ctx, mid - pw / 2, y, pw, 56 * s, 28 * s); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(pt, mid, y + 28 * s + 1); ls(ctx, 0);
    y += 56 * s + 22 * s;
    ctx.textBaseline = "top"; ctx.fillStyle = T.cardInk; ctx.font = f(900, 52 * s); tl.forEach((l, i) => ctx.fillText(l, mid, y + i * 52 * s * 1.1)); y += tl.length * 52 * s * 1.1 + 12 * s;
    if (dl.length) { ctx.font = f(600, 30 * s); ctx.fillStyle = T.cardText; dl.forEach((l, i) => ctx.fillText(l, mid, y + i * 30 * s * 1.3)); y += dl.length * 30 * s * 1.3 + 16 * s; }
    if (d.brinde) {
      ctx.font = f(900, 24 * s); const gl = "GANHE", gw = ctx.measureText(gl).width + 36 * s;
      ctx.font = f(800, 30 * s); const bw = ctx.measureText(d.brinde).width, bx = mid - (gw + 16 * s + bw) / 2;
      ctx.fillStyle = T.ribbon; rr(ctx, bx, y + 4 * s, gw, 42 * s, 21 * s); ctx.fill();
      ctx.fillStyle = T.tagInk; ctx.font = f(900, 24 * s); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(gl, bx + 18 * s, y + 25 * s + 1);
      ctx.fillStyle = T.cardInk; ctx.font = f(800, 30 * s); ctx.fillText(d.brinde, bx + gw + 16 * s, y + 25 * s + 1);
      ctx.textAlign = "center"; ctx.textBaseline = "top"; y += 50 * s + 16 * s;
    }
    ctx.textAlign = "left";
    if (d.modo === "desconto") {
      const v = `${String(d.valor).replace(/[^\d,.]/g, "")}%`;
      ctx.font = ANTON(150 * s); const vw = ctx.measureText(v).width;
      ctx.font = f(900, 26 * s); const aw = ctx.measureText("ATÉ").width + 30 * s;
      ctx.font = f(900, 32 * s); const dw = Math.max(ctx.measureText("DE").width, ctx.measureText("DESCONTO").width);
      const bx = mid - (aw + 14 * s + vw + 16 * s + dw) / 2;
      ctx.fillStyle = T.cardPill; rr(ctx, bx, y + 56 * s, aw, 40 * s, 20 * s); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.font = f(900, 26 * s); ctx.textBaseline = "middle"; ctx.fillText("ATÉ", bx + 15 * s, y + 76 * s + 1);
      ctx.textBaseline = "top"; ctx.fillStyle = T.alert; ctx.font = ANTON(150 * s); ctx.fillText(v, bx + aw + 14 * s, y);
      ctx.font = f(900, 32 * s); ctx.fillText("DE", bx + aw + 14 * s + vw + 16 * s, y + 40 * s); ctx.fillText("DESCONTO", bx + aw + 14 * s + vw + 16 * s, y + 76 * s);
    } else {
      const v = `R$ ${formatMoney(d.valor)}`;
      ctx.font = f(900, 84 * s); const vw = ctx.measureText(v).width;
      ctx.font = f(900, 22 * s); const lw = ctx.measureText("POR APENAS:").width + 36 * s;
      const bx = mid - (lw + 18 * s + vw) / 2;
      ctx.fillStyle = T.cardPill; rr(ctx, bx, y + 30 * s, lw, 40 * s, 20 * s); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.fillText("POR APENAS:", bx + 18 * s, y + 50 * s + 1);
      ctx.fillStyle = T.alert; ctx.font = f(900, 84 * s); ctx.textBaseline = "top"; ctx.fillText(v, bx + lw + 18 * s, y);
    }
    const fy = P.cb - 30 * s - 2 * 24 * s * 1.35;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = f(900, 24 * s); ctx.fillStyle = T.cardInk; ctx.fillText(d.validade ? `OFERTA VÁLIDA ATÉ ${formatDate(d.validade)}` : "", mid, fy, cw - 60 * s);
    ctx.font = f(600, 22 * s); ctx.fillStyle = T.cardText; ctx.fillText(`${U?.whatsapp ? `WhatsApp ${formatPhone(U.whatsapp)} · ` : ""}*Consulte as condições`, mid, fy + 24 * s * 1.35, cw - 60 * s);
    ctx.textAlign = "left";
    return 0;
  }

  /* ----- AVISO: emblema, título grande, unidades e faixa com o WhatsApp ----- */
  const AV = { feed: { et: 34, es: 118, pad: 60, band: 96, max: 150 }, story: { et: 200, es: 160, pad: 72, band: 110, max: 220 }, a4: { et: 70, es: 170, pad: 90, band: 120, max: 220 } };
  function aviso(ctx, F, T, d, U, s, draw) {
    const { W, H } = F, A = AV[d.formato], pad = A.pad, cw = W - pad * 2, bandY = d.formato === "story" ? H - 300 : H - A.band;
    if (draw) background(ctx, F, T, 0);
    let y = A.et;
    if (draw) logo(ctx, "emblema", (W - A.es) / 2, y, A.es);
    y += A.es + 24 * s + (d.shift || 0);
    ctx.font = f(900, 40 * s, true); ls(ctx, 1);
    const st = d.selo.toUpperCase(), sw = ctx.measureText(st).width + 50 * s;
    if (draw) { ctx.save(); ctx.translate(W / 2, y + 30 * s); ctx.rotate(-0.04); ctx.fillStyle = T.tag; rr(ctx, -sw / 2, -30 * s, sw, 60 * s, 8 * s); ctx.fill(); ctx.fillStyle = T.tagInk; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(st, 0, 2); ctx.restore(); }
    ls(ctx, 0); y += 64 * s;
    let ts = A.max * s; ctx.font = LILITA(ts);
    const tt = d.titulo.toUpperCase(), ww = ctx.measureText(tt).width;
    let tl = [tt];
    if (ww > cw) {
      if ((ts * cw) / ww >= A.max * s * 0.6) ts = (ts * cw) / ww;
      else { ts *= 0.7; tl = balanced(ctx, tt, LILITA(ts), cw, 2); ctx.font = LILITA(ts); const m = Math.max(...tl.map((l) => ctx.measureText(l).width)); if (m > cw) ts *= cw / m; }
    }
    if (draw) { ctx.save(); ctx.font = LILITA(ts); ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6; tl.forEach((l, i) => ctx.fillText(l, W / 2, y + i * ts * 0.98)); ctx.restore(); }
    y += tl.length * ts * 0.98 + 14 * s;
    if (d.sub) y = textBlock(ctx, d.sub, { font: f(600, 32 * s), x: pad, y, w: cw, lh: 32 * s * 1.32, max: 3, color: T.sub, align: "center", draw }) + 22 * s;
    const hasPhoto = Boolean(d.photo), colW = hasPhoto ? W * 0.58 - pad : cw;
    if (d.destaque) {
      const dl = balanced(ctx, d.destaque.toUpperCase(), f(800, 28 * s), colW - 48 * s, 2), dh = dl.length * 28 * s * 1.25 + 26 * s;
      if (draw) {
        ctx.font = f(800, 28 * s); const dw = Math.max(...dl.map((l) => ctx.measureText(l).width)) + 48 * s, dx = hasPhoto ? pad : (W - dw) / 2;
        ctx.fillStyle = T.alert; rr(ctx, dx, y, dw, dh, 10 * s); ctx.fill(); ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "top"; ctx.textAlign = "center";
        dl.forEach((l, i) => ctx.fillText(l, dx + dw / 2, y + 13 * s + i * 28 * s * 1.25)); ctx.textAlign = "left";
      }
      y += dh + 24 * s;
    }
    const rowsTop = y, rh = 96 * s;
    for (const u of (d.units || []).filter((x) => x.status !== "oculto")) {
      if (draw) {
        ctx.fillStyle = T.tag; rr(ctx, pad, y, colW, rh, rh / 2); ctx.fill();
        const r = 26 * s, ccx = pad + 18 * s + r, ccy = y + rh / 2;
        ctx.fillStyle = T.tagInk; ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = T.tag; ctx.lineWidth = 5 * s; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        if (u.status === "fechado") { ctx.moveTo(ccx - 9 * s, ccy - 9 * s); ctx.lineTo(ccx + 9 * s, ccy + 9 * s); ctx.moveTo(ccx + 9 * s, ccy - 9 * s); ctx.lineTo(ccx - 9 * s, ccy + 9 * s); }
        else { ctx.moveTo(ccx - 11 * s, ccy + 1 * s); ctx.lineTo(ccx - 3 * s, ccy + 9 * s); ctx.lineTo(ccx + 12 * s, ccy - 8 * s); }
        ctx.stroke();
        const tx = ccx + r + 20 * s, tw = pad + colW - tx - 24 * s;
        ctx.fillStyle = T.tagInk; ctx.textBaseline = "top"; ctx.font = f(800, 30 * s); ctx.fillText(u.nome, tx, y + 14 * s, tw);
        const label = u.status === "fechado" ? "Fechada" : u.status === "normal" ? (u.horario || "Funcionamento normal") : `${STATUS[u.status]}${u.horario ? `: ${u.horario}` : ""}`;
        ctx.font = f(600, 26 * s); ctx.fillText(label, tx, y + 52 * s, tw);
      }
      y += rh + 14 * s;
    }
    y -= 14 * s;
    if (d.retorno) { y += 22 * s; y = textBlock(ctx, d.retorno, { font: f(700, 28 * s), x: pad, y, w: cw, lh: 28 * s * 1.3, max: 2, color: "#FFFFFF", align: "center", draw }); }
    if (y > bandY - 16 * s) return H;
    if (!draw) return -(bandY - 16 * s - y);
    if (hasPhoto) cutout(ctx, d.photo, W * 0.5, rowsTop - 60 * s, W * 0.5 - pad * 0.3, bandY - rowsTop + 60 * s - 12, { shadow: d.shadow !== false, valign: "bottom" });
    ctx.fillStyle = T.alert; ctx.fillRect(0, bandY, W, A.band);
    const t = `${(d.cta || "Fale conosco:").toUpperCase()} ${U?.whatsapp ? formatPhone(U.whatsapp) : ""}`.trim();
    let fs = (40 * W) / 1080; ctx.font = f(900, fs); const m = ctx.measureText(t).width; if (m > W - pad * 2) fs *= (W - pad * 2) / m;
    ctx.font = f(900, fs); ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, W / 2, bandY + A.band / 2 + 2); ctx.textAlign = "left";
    return 0;
  }

  /** Faixa de chamada no rodapé: texto + WhatsApp da unidade */
  function band(ctx, F, T, text, U, y, h) {
    const { W } = F, pad = W * 0.06;
    const t = [String(text || "").toUpperCase(), U?.whatsapp ? formatPhone(U.whatsapp) : ""].filter(Boolean).join(" ");
    ctx.fillStyle = T.alert; ctx.fillRect(0, y, W, h);
    if (!t) return;
    let fs = (38 * W) / 1080; ctx.font = f(900, fs); const m = ctx.measureText(t).width; if (m > W - pad * 2) fs *= (W - pad * 2) / m;
    ctx.font = f(900, fs); ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, W / 2, y + h / 2 + 2); ctx.textAlign = "left";
  }
  const bandSize = (F) => (F.H > F.W * 1.5 ? { y: F.H - 300, h: 110 } : { y: F.H - Math.round(F.W * 0.09), h: Math.round(F.W * 0.09) });

  /* ----- EVENTO: foto no alto, título, data/hora/local e chamada ----- */
  function evento(ctx, F, T, d, U, s, draw) {
    const { W, H } = F, pad = W * 0.065, cw = W - pad * 2, B = bandSize(F);
    const photoH = d.photo ? H * (F.H > F.W * 1.5 ? 0.4 : 0.42) : 0;
    if (draw) {
      background(ctx, F, T, 0, Boolean(d.photo));
      if (d.photo) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, photoH); ctx.clip(); cover(ctx, d.photo, 0, 0, W, photoH); ctx.restore();
        const g = ctx.createLinearGradient(0, photoH * 0.55, 0, photoH); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, T.bg1);
        ctx.fillStyle = g; ctx.fillRect(0, photoH * 0.55, W, photoH * 0.45 + 2);
      }
      logo(ctx, "emblema", d.photo ? pad : W - pad - W * 0.13, (F.H > F.W * 1.5 ? 200 : pad * 0.7), W * 0.13);
    }
    let y = d.photo ? photoH - 30 * s : (F.H > F.W * 1.5 ? 420 : H * 0.2) + (d.shift || 0);
    if (d.chamada) { if (draw) tagPill(ctx, pad, y, d.chamada, T, s); y += 54 * s + 22 * s; }
    ctx.save(); ls(ctx, 1);
    y = textBlock(ctx, String(d.titulo).toUpperCase(), { font: ANTON(110 * s), x: pad, y, w: cw, lh: 110 * s * 1.02, max: 3, color: "#FFFFFF", draw });
    ctx.restore(); y += 22 * s;
    const infos = [["cal", d.data], ["clock", d.horario], ["pin", d.local]].filter(([, v]) => v);
    for (const [kind, text] of infos) {
      if (draw) {
        const r = 26 * s, cx = pad + r, cy = y + r;
        ctx.fillStyle = T.tag; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = T.tagInk; ctx.lineWidth = 4 * s; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        if (kind === "cal") { ctx.rect(cx - 11 * s, cy - 9 * s, 22 * s, 19 * s); ctx.moveTo(cx - 11 * s, cy - 3 * s); ctx.lineTo(cx + 11 * s, cy - 3 * s); }
        else if (kind === "clock") { ctx.arc(cx, cy, 12 * s, 0, Math.PI * 2); ctx.moveTo(cx, cy - 7 * s); ctx.lineTo(cx, cy); ctx.lineTo(cx + 5 * s, cy + 4 * s); }
        else { ctx.moveTo(cx, cy + 13 * s); ctx.bezierCurveTo(cx - 16 * s, cy - 2 * s, cx - 9 * s, cy - 15 * s, cx, cy - 14 * s); ctx.bezierCurveTo(cx + 9 * s, cy - 15 * s, cx + 16 * s, cy - 2 * s, cx, cy + 13 * s); }
        ctx.stroke();
        ctx.fillStyle = "#FFFFFF"; ctx.font = f(800, 32 * s); ctx.textBaseline = "middle"; ctx.fillText(text, pad + r * 2 + 18 * s, cy + 1, cw - r * 2 - 18 * s);
      }
      y += 52 * s + 16 * s;
    }
    if (d.descricao) { y += 8 * s; y = textBlock(ctx, d.descricao, { font: f(600, 30 * s), x: pad, y, w: cw, lh: 30 * s * 1.35, max: 3, color: T.sub, draw }); }
    if (y > B.y - 24 * s) return H;
    if (!draw) return d.photo ? 0 : -(B.y - 24 * s - y);
    band(ctx, F, T, d.cta, U, B.y, B.h);
    return 0;
  }

  /* ----- ANTES E DEPOIS: duas fotos lado a lado (feed) ou uma sobre a outra ----- */
  function antesdepois(ctx, F, T, d, U, s, draw) {
    const { W, H } = F, pad = W * 0.06, cw = W - pad * 2, B = bandSize(F), tall = F.H > F.W * 1.2;
    if (draw) background(ctx, F, T, 0);
    let y = tall ? (F.H > F.W * 1.5 ? 210 : 90) : 64;
    y = campaign(ctx, { x: pad, y, w: cw, chamada: d.chamada, nome: d.titulo, T, max: (tall ? 150 : 110) * Math.min(s, 1), draw });
    y += 16 * s;
    const descH = d.descricao ? lines(ctx, d.descricao, f(600, 30 * s), cw, 2).length * 30 * s * 1.35 + 20 * s : 0;
    const avail = B.y - 28 * s - y - descH, gap = 24 * s;
    if (avail < (tall ? 500 : 280) * s) return H;
    if (draw) {
      const boxes = tall ? [[pad, y, cw, (avail - gap) / 2], [pad, y + (avail - gap) / 2 + gap, cw, (avail - gap) / 2]]
        : [[pad, y, (cw - gap) / 2, avail], [pad + (cw - gap) / 2 + gap, y, (cw - gap) / 2, avail]];
      [["ANTES", d.photo, T.ribbon2, "#FFFFFF"], ["DEPOIS", d.photo2, T.tag, T.tagInk]].forEach(([label, im, bg, ink], i) => {
        const [bx, by, bw, bh] = boxes[i];
        ctx.save(); ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10; ctx.fillStyle = "#FFFFFF"; rr(ctx, bx, by, bw, bh, 28 * s); ctx.fill(); ctx.restore();
        if (im) coverRound(ctx, im, bx + 8 * s, by + 8 * s, bw - 16 * s, bh - 16 * s, 22 * s);
        else placeholder(ctx, bx + 8 * s, by + 8 * s, bw - 16 * s, bh - 16 * s, `Foto ${label.toLowerCase()}`);
        ctx.font = f(900, 28 * s); ls(ctx, 3); const lw = ctx.measureText(label).width + 48 * s;
        ctx.fillStyle = bg; rr(ctx, bx + 24 * s, by + 24 * s, lw, 54 * s, 27 * s); ctx.fill();
        ctx.fillStyle = ink; ctx.textBaseline = "middle"; ctx.fillText(label, bx + 48 * s, by + 51 * s + 1); ls(ctx, 0);
      });
    }
    y += avail + 20 * s;
    if (d.descricao) textBlock(ctx, d.descricao, { font: f(600, 30 * s), x: pad, y, w: cw, lh: 30 * s * 1.35, max: 2, color: "#FFFFFF", align: "center", draw });
    if (draw) band(ctx, F, T, d.cta, U, B.y, B.h);
    return 0;
  }

  /* ----- FRASE: dica, frase ou depoimento em destaque, com autor ----- */
  function frase(ctx, F, T, d, U, s, draw) {
    const { W, H } = F, pad = W * 0.09, cw = W - pad * 2, tall = F.H > F.W * 1.2;
    const logoH = tall ? 190 : 140, bottom = H - logoH - (F.H > F.W * 1.5 ? 260 : 70);
    const ts = 58 * s, tl = balanced(ctx, d.texto, f(800, ts), cw, 8), textH = tl.length * ts * 1.28;
    const authorH = d.autor ? 130 * s : 0, need = 54 * s + 40 * s + 120 * s + textH + 40 * s + authorH;
    const top = Math.max(F.H > F.W * 1.5 ? 220 : 60, ((bottom - need) / 2));
    if (top + need > bottom) return H;
    if (!draw) return 0;
    background(ctx, F, T, 0);
    let y = top;
    if (d.tipo) { ctx.font = f(900, 26 * s); ls(ctx, 2); const w = ctx.measureText(d.tipo.toUpperCase()).width + 56 * s; ls(ctx, 0); tagPill(ctx, (W - w) / 2, y, d.tipo, T, s); }
    y += 54 * s + 40 * s;
    ctx.font = `bold ${Math.round(260 * s)}px Georgia, "Times New Roman", serif`; ctx.fillStyle = T.deco1; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("\u201C", W / 2, y - 40 * s);
    y += 120 * s;
    ctx.font = f(800, ts); ctx.fillStyle = "#FFFFFF"; tl.forEach((l, i) => ctx.fillText(l, W / 2, y + i * ts * 1.28)); y += textH + 40 * s;
    if (d.autor) {
      const av = d.photo ? 104 * s : 0;
      ctx.font = f(800, 34 * s); const nw = ctx.measureText(d.autor).width; ctx.font = f(600, 26 * s); const dw = d.detalhe ? ctx.measureText(d.detalhe).width : 0;
      const tw = Math.max(nw, dw), total = av + (av ? 24 * s : 0) + tw, x0 = (W - total) / 2;
      if (av) {
        ctx.save(); ctx.beginPath(); ctx.arc(x0 + av / 2, y + av / 2, av / 2, 0, Math.PI * 2); ctx.clip(); cover(ctx, d.photo, x0, y, av, av); ctx.restore();
        ctx.strokeStyle = T.deco1; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.arc(x0 + av / 2, y + av / 2, av / 2, 0, Math.PI * 2); ctx.stroke();
      }
      const tx = x0 + av + (av ? 24 * s : 0); ctx.textAlign = "left";
      ctx.font = f(800, 34 * s); ctx.fillStyle = "#FFFFFF"; ctx.fillText(d.autor, tx, y + (d.detalhe ? 14 : 34) * s);
      if (d.detalhe) { ctx.font = f(600, 26 * s); ctx.fillStyle = T.sub; ctx.fillText(d.detalhe, tx, y + 58 * s); }
    }
    ctx.textAlign = "left";
    const lw = logoOf("principal") ? (logoH * DW(logoOf("principal"))) / DH(logoOf("principal")) : 0;
    logo(ctx, "principal", (W - lw) / 2, bottom + (F.H > F.W * 1.5 ? 60 : 20), logoH);
    return 0;
  }

  // tamanho inicial das letras por modelo e formato (diminui sozinho se não couber)
  const S0 = { oferta: { story: 1.3, feed: 1, a4: 1.25 }, plano: { story: 1.22, feed: 1, a4: 1.2 }, aviso: { story: 1.4, feed: 1, a4: 1.3 }, evento: { story: 1.3, feed: 1, a4: 1.25 }, antesdepois: { story: 1.25, feed: 1, a4: 1.2 }, frase: { story: 1.35, feed: 1, a4: 1.3 } };

  return {
    units,
    /** Desenha a arte `d` no canvas; scale 2 = A4 em alta para impressão */
    render(canvas, d, scale = 1) {
      const F = FORMATS[d.formato], T = themeFor(d.tema, kit.colors), U = units.find((u) => u.id === d.unidade) || units[0];
      canvas.width = F.W * scale; canvas.height = F.H * scale;
      const ctx = canvas.getContext("2d"); ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const body = { oferta, plano, aviso, evento, antesdepois, frase }[d.modelo], s0 = S0[d.modelo][d.formato];
      let s = s0;
      while (s > s0 * 0.55 && body(ctx, F, T, d, U, s, false) > 0) s -= 0.04;
      if (d.modelo === "aviso" || d.modelo === "evento") d = { ...d, shift: Math.max(0, -body(ctx, F, T, d, U, s, false)) * 0.45 };
      ctx.clearRect(0, 0, F.W, F.H);
      body(ctx, F, T, d, U, s, true);
    }
  };
}
