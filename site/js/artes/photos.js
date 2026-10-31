/* ==========================================================================
   Fotos do gerador de artes
   --------------------------------------------------------------------------
   - Arquivo do aparelho, imagem colada (copiar imagem na web) ou link.
   - Link: tenta direto; se o site não liberar, passa pelo images.weserv.nl
     (serviço público que só repassa a imagem).
   - removeBackground: tira o fundo liso (branco ou de uma cor só) a partir
     das bordas, como nas fotos de produto das lojas online.
   ========================================================================== */

const DW = (im) => im.naturalWidth || im.width, DH = (im) => im.naturalHeight || im.height;

export function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error("Não foi possível abrir essa imagem.")); im.src = reader.result; };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
}

/** Imagem de um link da web (aceita também links de resultado do Google Imagens) */
export async function imageFromUrl(raw) {
  let url = String(raw || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Cole um link que comece com http.");
  try { const u = new URL(url); const inner = u.searchParams.get("imgurl") || u.searchParams.get("mediaurl"); if (inner) url = inner; } catch { /* link comum */ }
  const tries = [url, `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&output=png`];
  for (const src of tries) {
    try { return await loadImage(src); } catch { /* tenta o próximo */ }
  }
  throw new Error("Esse link não abriu. Na página da imagem, clique com o botão direito, escolha \"Copiar imagem\" e cole no campo.");
}

/** Tira o fundo liso a partir das bordas; devolve um canvas recortado (ou a própria imagem) */
export function removeBackground(im) {
  const W0 = DW(im), H0 = DH(im), k = Math.min(1, 1600 / Math.max(W0, H0)), w = Math.round(W0 * k), h = Math.round(H0 * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h);
  let data;
  try { data = x.getImageData(0, 0, w, h); } catch { return im; }
  const p = data.data, N = w * h, border = [];
  for (let i = 0; i < w; i++) border.push(i, (h - 1) * w + i);
  for (let j = 0; j < h; j++) border.push(j * w, j * w + w - 1);
  if (border.filter((b) => p[b * 4 + 3] < 20).length > border.length * 0.5) return im;   // já está sem fundo
  const med = (ch) => { const v = border.map((b) => p[b * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const br = med(0), bg = med(1), bb = med(2), tol = 40;
  const dist = (q) => { const i = q * 4, a = p[i] - br, b = p[i + 1] - bg, d = p[i + 2] - bb; return Math.sqrt(a * a + b * b + d * d); };
  const mask = new Uint8Array(N), queue = new Int32Array(N);
  let head = 0, tail = 0;
  for (const b of border) if (!mask[b] && dist(b) < tol) { mask[b] = 1; queue[tail++] = b; }
  while (head < tail) {
    const q = queue[head++], cx = q % w, cy = (q / w) | 0;
    for (const n of [cx > 0 ? q - 1 : -1, cx < w - 1 ? q + 1 : -1, cy > 0 ? q - w : -1, cy < h - 1 ? q + w : -1]) {
      if (n >= 0 && !mask[n] && dist(n) < tol) { mask[n] = 1; queue[tail++] = n; }
    }
  }
  if (tail < N * 0.03) return im;   // quase nada para tirar
  const clamp = (v) => Math.min(255, Math.max(0, v));
  for (let q = 0; q < N; q++) {
    const i = q * 4;
    if (mask[q]) { p[i + 3] = 0; continue; }
    const cx = q % w, cy = (q / w) | 0;
    const edge = (cx > 0 && mask[q - 1]) || (cx < w - 1 && mask[q + 1]) || (cy > 0 && mask[q - w]) || (cy < h - 1 && mask[q + w]);
    if (edge) {   // borda suave, sem o halo da cor do fundo
      const a = Math.max(0.15, Math.min(1, (dist(q) - tol * 0.5) / (tol * 1.6)));
      p[i] = clamp((p[i] - br * (1 - a)) / a); p[i + 1] = clamp((p[i + 1] - bg * (1 - a)) / a); p[i + 2] = clamp((p[i + 2] - bb * (1 - a)) / a); p[i + 3] = Math.round(p[i + 3] * a);
    }
  }
  x.putImageData(data, 0, 0);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let q = 0; q < N; q++) if (p[q * 4 + 3] > 12) { const a = q % w, b = (q / w) | 0; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; }
  if (x1 <= x0 || y1 <= y0) return im;
  const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Miniatura (data URL) para mostrar no formulário */
export function thumbnail(im) {
  try {
    const t = document.createElement("canvas"); const k = Math.min(1, 160 / Math.max(DW(im), DH(im)));
    t.width = Math.max(1, Math.round(DW(im) * k)); t.height = Math.max(1, Math.round(DH(im) * k));
    t.getContext("2d").drawImage(im, 0, 0, t.width, t.height);
    return t.toDataURL("image/png");
  } catch { return ""; }
}
