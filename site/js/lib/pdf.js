/* ==========================================================================
   Gerador de PDF mínimo (sem bibliotecas externas)
   --------------------------------------------------------------------------
   Texto (Helvetica e Helvetica-Bold, fontes padrão de todo leitor de PDF,
   com acentos do português pela codificação WinAnsi), retângulos e linhas.
   Coordenadas em pontos (1/72 pol.), com a origem no canto SUPERIOR esquerdo
   (como na tela); o arquivo é montado no navegador e baixado direto.
   Emojis e símbolos fora do WinAnsi são omitidos; outras letras viram "?".
   ========================================================================== */

/* Larguras da Helvetica (1/1000 do tamanho da fonte), caracteres 32 a 126 */
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/* Unicode → WinAnsi (o que difere do Latin-1) */
const WIN_ANSI = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99 };

function toWinAnsi(text) {
  let out = "";
  for (const ch of String(text ?? "").normalize("NFC")) {
    const code = ch.codePointAt(0);
    if (WIN_ANSI[ch]) out += String.fromCharCode(WIN_ANSI[ch]);
    else if (code === 9 || code === 10 || code === 13) out += " ";
    else if ((code >= 32 && code <= 126) || (code >= 0xA0 && code <= 0xFF)) out += ch;
    else if (code >= 0x2000) out += "";   // emojis e símbolos: somem (a fonte padrão não tem)
    else out += "?";
  }
  return out;
}

/** Largura de um caractere já em WinAnsi */
function charWidth(code, bold) {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  if (code >= 32 && code <= 126) return table[code - 32];
  if (code === 0x85) return 1000;               // reticências
  if (code === 0x95) return 350;                 // marcador
  if (code === 0x96) return 556;                 // travessão curto
  if (code === 0x97) return 1000;
  if (code >= 0xC0) {                            // letras acentuadas: largura da letra base
    const base = String.fromCharCode(code).normalize("NFD")[0].charCodeAt(0);
    if (base >= 32 && base <= 126) return table[base - 32];
  }
  return 556;
}

export function textWidth(text, size, bold = false) {
  const s = toWinAnsi(text);
  let w = 0;
  for (let i = 0; i < s.length; i += 1) w += charWidth(s.charCodeAt(i), bold);
  return (w * size) / 1000;
}

/** Corta com "…" para caber em maxWidth */
export function fitText(text, maxWidth, size, bold = false) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (textWidth(clean, size, bold) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 1 && textWidth(`${out}…`, size, bold) > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** Quebra em linhas de até maxWidth (no máximo maxLines; a última leva "…" se sobrar) */
export function wrapText(text, maxWidth, size, bold = false, maxLines = Infinity) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    line = textWidth(word, size, bold) <= maxWidth ? word : fitText(word, maxWidth, size, bold);
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxWidth, size, bold);
    return kept;
  }
  return lines.length ? lines : [""];
}

const hex = (color) => {
  const m = String(color || "#000000").replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(" ");
};
const num = (v) => (Math.round(v * 100) / 100).toString();
const escapePdf = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/**
 * @param {{width?: number, height?: number, title?: string, author?: string}} [options]  A4 deitado por padrão
 */
export function createPdf({ width = 842, height = 595, title = "", author = "" } = {}) {
  const pages = [];

  function addPage() {
    const ops = [];
    const page = {
      width, height,
      /** Texto com a linha de base em y */
      text(x, y, value, { size = 10, bold = false, color = "#000000" } = {}) {
        ops.push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${hex(color)} rg ${num(x)} ${num(height - y)} Td (${escapePdf(toWinAnsi(value))}) Tj ET`);
      },
      rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 1 } = {}) {
        if (!fill && !stroke) return;
        ops.push(`${fill ? `${hex(fill)} rg ` : ""}${stroke ? `${hex(stroke)} RG ${num(lineWidth)} w ` : ""}${num(x)} ${num(height - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
      },
      line(x1, y1, x2, y2, { color = "#000000", lineWidth = 1 } = {}) {
        ops.push(`${hex(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(height - y1)} m ${num(x2)} ${num(height - y2)} l S`);
      },
      ops
    };
    pages.push(page);
    return page;
  }

  /** Monta o arquivo (bytes) */
  function build() {
    const objects = [];   // índice = número do objeto - 1
    const add = (body) => { objects.push(body); return objects.length; };
    const catalogId = add(null);
    const pagesId = add(null);
    const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds = pages.map((page) => {
      const content = page.ops.join("\n");
      const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    });
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const infoId = add(`<< /Title (${escapePdf(toWinAnsi(title))}) /Author (${escapePdf(toWinAnsi(author))}) /Producer (Portal Digital Galaxy) >>`);

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Cada caractere já é um byte (0–255)
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  return { addPage, build, get pageCount() { return pages.length; } };
}
