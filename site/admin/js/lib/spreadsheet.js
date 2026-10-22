/* ==========================================================================
   Leitor de planilhas (.xlsx e .csv), sem bibliotecas externas
   --------------------------------------------------------------------------
   .xlsx é um arquivo zip com XML dentro. Aqui: lê o índice do zip,
   descompacta com o DecompressionStream do próprio navegador (ou do Node,
   nos testes) e extrai a PRIMEIRA aba da planilha.
   Devolve uma matriz de linhas: números ficam números (datas e horários do
   Excel são números), textos ficam textos. Células vazias viram "".
   Sem eval nem execução de fórmulas: usa o último valor salvo pelo Excel.
   ========================================================================== */

export class SpreadsheetError extends Error {}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 2000;

/* ---------- Zip ---------- */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** { "caminho/no/zip": () => Promise<Uint8Array> } */
function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // Fim do índice central: procura a assinatura a partir do final
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new SpreadsheetError("O arquivo não parece ser uma planilha do Excel (.xlsx).");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = {};
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new SpreadsheetError("Planilha danificada (índice do arquivo).");
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries[name] = async () => {
      if (view.getUint32(local, true) !== 0x04034b50) throw new SpreadsheetError("Planilha danificada.");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new SpreadsheetError("Planilha com compactação não suportada. Salve de novo como .xlsx.");
    };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/* ---------- XML (só o necessário, sem executar nada) ---------- */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()];
});
/** Junta todos os <t>…</t> de um trecho (texto com formatação vem em pedaços) */
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

const columnIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] || "A";
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
};

async function readXlsx(buffer) {
  const zip = readZip(buffer);
  const text = async (name) => (zip[name] ? new TextDecoder().decode(await zip[name]()) : null);

  // Primeira aba (na ordem do Excel) e onde ela está no zip
  const workbook = await text("xl/workbook.xml");
  if (!workbook) throw new SpreadsheetError("O arquivo não parece ser uma planilha do Excel (.xlsx).");
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(workbook);
  const firstSheet = workbook.match(/<sheet\s[^>]*>/)?.[0];
  const relId = firstSheet && (attr(firstSheet, "r:id") || attr(firstSheet, "id"));
  const rels = (await text("xl/_rels/workbook.xml.rels")) || "";
  let target = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === relId);
  target = target ? attr(target, "Target") : "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = await text(sheetPath);
  if (!sheet) throw new SpreadsheetError("Não encontrei a primeira aba da planilha.");

  const sharedXml = (await text("xl/sharedStrings.xml")) || "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\s[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const index = Number(attr(rowMatch[0], "r")) - 1;
    if (!(index >= 0) || index >= MAX_ROWS) continue;
    const row = [];
    for (const cell of (rowMatch[1] || "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c ${cell[1]}>`;
      const ref = attr(tag, "r");
      const col = ref ? columnIndex(ref) : row.length;
      const type = attr(tag, "t");
      const inner = cell[2] || "";
      const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "str" || type === "e") value = raw === undefined ? "" : decodeXml(raw);
      else if (type === "b") value = raw === "1";
      else if (raw !== undefined && raw !== "") value = Number(raw);
      if (col < 200) row[col] = value;
    }
    rows[index] = Array.from(row, (v) => (v === undefined ? "" : v));
  }
  return { rows: Array.from(rows, (r) => r || []), date1904 };
}

/* ---------- CSV ---------- */
function readCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] || "";
  // Excel em português costuma salvar com ponto e vírgula
  const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
      if (rows.length >= MAX_ROWS) break;
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return { rows, date1904: false };
}

/**
 * Lê .xlsx ou .csv.
 * @param {{name: string, size: number, arrayBuffer: () => Promise<ArrayBuffer>}} file
 * @returns {Promise<{rows: Array<Array<string|number|boolean>>, date1904: boolean}>}
 */
export async function readSpreadsheet(file) {
  if (!file) throw new SpreadsheetError("Escolha uma planilha.");
  if (file.size > MAX_BYTES) throw new SpreadsheetError("Planilha grande demais (limite de 10 MB).");
  const name = String(file.name || "").toLowerCase();
  const buffer = await file.arrayBuffer();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return readCsv(new TextDecoder().decode(buffer));
  if (name.endsWith(".xls")) throw new SpreadsheetError("Planilha no formato antigo (.xls). No Excel, use Arquivo → Salvar como → Pasta de Trabalho do Excel (.xlsx).");
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new SpreadsheetError("O arquivo não parece ser uma planilha .xlsx ou .csv.");
  try {
    return await readXlsx(buffer);
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new SpreadsheetError("Não foi possível ler esta planilha. Abra no Excel e salve de novo como .xlsx.");
  }
}
