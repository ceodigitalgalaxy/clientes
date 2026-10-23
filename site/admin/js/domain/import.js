/* ==========================================================================
   Importação de conteúdos: linhas da planilha → conteúdos do painel
   --------------------------------------------------------------------------
   - Acha a linha de títulos e reconhece as colunas pelo nome (com ou sem
     acento, em qualquer ordem). Colunas desconhecidas são ignoradas.
   - Entende datas do Excel, "12/11/2026", "12/11" (ano atual), "2026-11-12";
     horários do Excel, "10:30", "10h30", "14h".
   - Entende apelidos comuns de rede, formato e status ("insta", "carrosel",
     "vídeo", "para aprovar"...). Status vazio vira "Planejado".
   - Cada linha passa pela MESMA validação do cadastro manual (rules.js).
   Sem dependências: roda no navegador e nos testes (Node).
   ========================================================================== */

import { validateContent, NETWORKS, CONTENT_STATUS } from "./rules.js?v=e96162d7e7";

export const MAX_IMPORT_ROWS = 500;

/** "Observação para o Cliente:" → "observacao para o cliente" */
export const norm = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Colunas aceitas (nomes já normalizados) */
const COLUMNS = {
  title: ["titulo", "titulo da publicacao", "tema", "assunto", "conteudo", "nome", "publicacao", "post"],
  scheduled_date: ["data", "dia", "data programada", "data de publicacao", "data da publicacao", "data da postagem", "data de postagem"],
  scheduled_time: ["horario", "hora", "horario de publicacao", "horario da postagem"],
  network: ["rede", "rede social", "redes", "plataforma", "canal"],
  format: ["formato", "tipo", "tipo de conteudo"],
  media_url: ["link da referencia", "referencia", "link", "url", "link de referencia", "url da referencia", "referencia url", "midia", "link da midia"],
  caption: ["legenda", "texto", "copy", "texto da legenda"],
  client_notes: ["observacao para o cliente", "observacoes para o cliente", "obs para o cliente", "obs cliente", "observacao cliente", "nota para o cliente"],
  internal_notes: ["observacoes internas", "observacao interna", "obs interna", "obs internas", "notas internas", "observacoes", "observacao", "obs"],
  status: ["status", "etapa", "situacao", "andamento"]
};
export const COLUMN_LABELS = {
  title: "Título", scheduled_date: "Data", scheduled_time: "Horário", network: "Rede social", format: "Formato",
  media_url: "Link da referência", caption: "Legenda", client_notes: "Observação para o cliente", internal_notes: "Observações internas", status: "Status"
};

const NETWORK_ALIASES = {
  instagram: ["instagram", "insta", "ig", "reels instagram"],
  facebook: ["facebook", "fb", "face", "meta"],
  tiktok: ["tiktok", "tik tok", "tt"],
  linkedin: ["linkedin", "linked in", "lkd"],
  youtube: ["youtube", "yt", "you tube", "shorts", "youtube shorts"],
  google: ["google", "perfil do google", "google meu negocio", "gmn", "gbp", "google business", "perfil da empresa no google"],
  whatsapp: ["whatsapp", "whats", "zap", "wpp", "whatsapp status", "status do whatsapp"]
};
const FORMAT_ALIASES = {
  post: ["post", "imagem", "imagem post", "foto", "estatico", "feed", "arte", "card", "post unico"],
  carrossel: ["carrossel", "carrosel", "carousel", "carrocel", "album"],
  reels: ["reels", "reel", "video", "video reels", "shorts", "tiktok video"],
  stories: ["stories", "story", "storie", "storys", "historia", "historias"],
  outro: ["outro", "outros", "outro formato"]
};
const STATUS_ALIASES = {
  planejado: ["planejado", "planejamento", "a fazer", "ideia", "pauta", "rascunho"],
  em_producao: ["em producao", "producao", "fazendo", "em andamento", "produzindo"],
  aguardando_aprovacao: ["aguardando aprovacao", "aguardando", "para aprovar", "para aprovacao", "enviado para aprovacao", "em aprovacao"],
  ajustes: ["ajustes", "ajustes solicitados", "ajuste", "em ajuste", "alteracao"],
  aprovado: ["aprovado", "aprovada", "ok"],
  publicado: ["publicado", "publicada", "postado", "postada", "no ar"]
};

export const lookup = (aliases, value) => {
  const key = norm(value);
  if (!key) return null;
  for (const [id, names] of Object.entries(aliases)) if (names.includes(key)) return id;
  return null;
};

/* ---------- Datas e horários ---------- */
const pad = (n) => String(n).padStart(2, "0");
const isoFromParts = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Data do Excel (número de dias) → AAAA-MM-DD */
export function excelDate(serial, date1904 = false) {
  const days = Math.floor(Number(serial));
  if (!(days > 0 && days < 2958466)) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** @returns {{value: string|null, warning?: string, error?: string}} */
export function parseDate(raw, { date1904 = false, today = new Date() } = {}) {
  if (raw === "" || raw === null || raw === undefined) return { value: null, error: "Informe a data." };
  if (typeof raw === "number") {
    const value = excelDate(raw, date1904);
    return value ? { value } : { value: null, error: "Data inválida." };
  }
  const text = String(raw).trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const value = isoFromParts(+m[1], +m[2], +m[3]); return value ? { value } : { value: null, error: `Data inválida: "${text}".` }; }
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) {
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    if (m[3] && m[3].length === 2) year += 2000;
    const value = isoFromParts(year, +m[2], +m[1]);
    if (!value) return { value: null, error: `Data inválida: "${text}".` };
    return m[3] ? { value } : { value, warning: `Data sem ano: considerei ${year}.` };
  }
  return { value: null, error: `Não entendi a data "${text}". Use dia/mês/ano (ex.: 12/11/2026).` };
}

/** @returns {{value: string|null, error?: string}} */
export function parseTime(raw) {
  if (raw === "" || raw === null || raw === undefined) return { value: null };
  if (typeof raw === "number") {
    const fraction = raw % 1;
    const minutes = Math.round(fraction * 24 * 60) % (24 * 60);
    if (raw >= 1 && fraction === 0) return { value: null, error: "Horário inválido." };
    return { value: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
  }
  const text = String(raw).trim().toLowerCase();
  const m = text.match(/^(\d{1,2})(?:\s*[:h]\s*(\d{2})?)?(?::\d{2})?\s*(?:h|hs|hrs)?$/);
  if (m) {
    const h = Number(m[1]); const min = Number(m[2] || 0);
    if (h < 24 && min < 60) return { value: `${pad(h)}:${pad(min)}` };
  }
  return { value: null, error: `Não entendi o horário "${raw}". Use 10:30 ou 14h.` };
}

/* ---------- Planilha → conteúdos ---------- */
export const isEmptyRow = (row) => !row || row.every((cell) => cell === "" || cell === null || cell === undefined);

/** Acha a linha de títulos: a primeira que tenha pelo menos "título" e "data" */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const map = {};
    (rows[i] || []).forEach((cell, col) => {
      const key = norm(cell);
      for (const [field, names] of Object.entries(COLUMNS)) {
        if (names.includes(key) && map[field] === undefined) { map[field] = col; break; }
      }
    });
    if (map.title !== undefined && map.scheduled_date !== undefined) return { index: i, map };
  }
  return null;
}

const FIELD_LABEL = { client_id: "Cliente", ...COLUMN_LABELS, media_kind: "Tipo da mídia" };

/**
 * @param {Array<Array<any>>} rows       matriz da planilha (spreadsheet.js)
 * @param {object} options
 * @param {string} options.clientId      cliente escolhido na tela
 * @param {boolean} [options.date1904]
 * @param {Array<{title: string, scheduled_date: string}>} [options.existing]  conteúdos já cadastrados do cliente (para avisar repetidos)
 * @returns {{ error?: string, columns: string[], missing: string[], items: Array<{line: number, value: object, errors: string[], warnings: string[], duplicate: boolean, valid: boolean}> }}
 */
export function mapRows(rows, { clientId, date1904 = false, existing = [], today = new Date() }) {
  const header = findHeader(rows);
  if (!header) {
    return { error: "Não encontrei os títulos das colunas. A primeira linha precisa ter pelo menos \"Título\" e \"Data\" (use o modelo).", columns: [], missing: ["title", "scheduled_date"], items: [] };
  }
  const columns = Object.keys(header.map);
  const missing = Object.keys(COLUMN_LABELS).filter((f) => header.map[f] === undefined);
  const seen = new Set(existing.map((c) => `${norm(c.title)}|${c.scheduled_date}`));
  const items = [];
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;
    if (items.length >= MAX_IMPORT_ROWS) {
      return { error: `A planilha tem mais de ${MAX_IMPORT_ROWS} conteúdos. Divida em arquivos menores.`, columns, missing, items: [] };
    }
    const cell = (field) => (header.map[field] === undefined ? "" : row[header.map[field]] ?? "");
    const text = (field) => String(cell(field) ?? "").trim();
    const errors = [];
    const warnings = [];

    const date = parseDate(cell("scheduled_date"), { date1904, today });
    if (date.error) errors.push(date.error);
    if (date.warning) warnings.push(date.warning);
    const time = parseTime(cell("scheduled_time"));
    if (time.error) errors.push(time.error);

    const network = lookup(NETWORK_ALIASES, cell("network"));
    if (!network) errors.push(text("network") ? `Rede social desconhecida: "${text("network")}". Use: ${Object.values(NETWORKS).join(", ")}.` : "Informe a rede social.");
    const format = lookup(FORMAT_ALIASES, cell("format"));
    if (!format) errors.push(text("format") ? `Formato desconhecido: "${text("format")}". Use: post, carrossel, reels, stories ou outro.` : "Informe o formato.");
    let status = "planejado";
    if (text("status")) {
      status = lookup(STATUS_ALIASES, cell("status"));
      if (!status) { errors.push(`Status desconhecido: "${text("status")}". Use: ${Object.values(CONTENT_STATUS).map((s) => s.label).join(", ")}.`); status = "planejado"; }
    }

    const input = {
      client_id: clientId,
      title: text("title"),
      scheduled_date: date.value || "",
      scheduled_time: time.value || "",
      network: network || "",
      format: format || "",
      media_url: text("media_url"),
      caption: text("caption"),
      client_notes: text("client_notes"),
      internal_notes: text("internal_notes"),
      status
    };
    const { value, errors: fieldErrors } = validateContent(input);
    for (const [field, message] of Object.entries(fieldErrors)) {
      // Data, horário, rede e formato já têm mensagem própria acima
      if (["scheduled_date", "scheduled_time", "network", "format"].includes(field) && errors.length) continue;
      errors.push(`${FIELD_LABEL[field] || field}: ${message}`);
    }
    const duplicate = Boolean(value.title && value.scheduled_date && seen.has(`${norm(value.title)}|${value.scheduled_date}`));
    if (duplicate) warnings.push("Já existe um conteúdo com este título nesta data.");
    if (value.title && value.scheduled_date) seen.add(`${norm(value.title)}|${value.scheduled_date}`);
    items.push({ line: i + 1, value, errors, warnings, duplicate, valid: errors.length === 0 });
  }
  return { columns, missing, items };
}
