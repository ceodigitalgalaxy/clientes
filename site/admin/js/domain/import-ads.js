/* ==========================================================================
   Importação de anúncios: linhas da planilha → anúncios (rascunhos)
   --------------------------------------------------------------------------
   - Mesma leitura da importação de conteúdos (títulos das colunas em
     qualquer ordem, com ou sem acento; colunas desconhecidas ignoradas).
   - Apelidos de plataforma, formato e objetivo ("facebook" → Meta Ads,
     "foto" → Imagem, "whatsapp" → Mensagens...). Plataforma que não é
     Meta/Google/TikTok vira "Outra", com o nome escrito na planilha.
   - "Link do criativo": um ou mais links (um por linha, ou separados por
     espaço, vírgula ou ponto e vírgula), na ordem do carrossel.
   - "Enviar para aprovação" = sim: depois de criar, envia ao cliente (só se
     houver criativo). Sem essa coluna, tudo entra como rascunho.
   - Cada linha passa pela MESMA validação do cadastro manual (validateAd).
   ========================================================================== */

import { validateAd, AD_PLATFORMS, AD_FORMATS } from "./rules.js?v=0470164d89";
import { norm, lookup, isEmptyRow, MAX_IMPORT_ROWS } from "./import.js?v=0470164d89";
import { describeMedia } from "../../../js/ui/media.js?v=0470164d89";

export const AD_COLUMNS = {
  title: ["titulo", "titulo do anuncio", "nome do anuncio", "anuncio", "nome"],
  platform: ["plataforma", "plataforma de veiculacao", "rede", "canal", "veiculacao"],
  format: ["formato", "tipo", "formato do anuncio"],
  objective: ["objetivo", "objetivo da campanha"],
  campaign_context: ["contexto", "descricao da campanha", "contexto da campanha", "descricao e contexto da campanha", "campanha", "publico", "briefing"],
  primary_text: ["texto principal", "texto", "copy", "texto do anuncio", "legenda"],
  headline: ["headline", "titulo headline", "titulo do criativo", "chamada", "manchete"],
  description: ["descricao", "descricao complementar", "descricao do anuncio"],
  cta: ["cta", "botao", "botao cta", "chamada para acao", "call to action"],
  destination_url: ["link de destino", "destino", "url de destino", "link do site", "site", "landing page", "lp"],
  creative: ["link do criativo", "criativo", "links do criativo", "midia", "arte", "link da arte", "url do criativo", "video", "imagem"],
  client_notes: ["observacao para o cliente", "observacoes para o cliente", "obs para o cliente", "obs cliente", "nota para o cliente"],
  internal_notes: ["observacoes internas", "observacao interna", "obs interna", "obs internas", "notas internas", "observacoes", "observacao", "obs"],
  send: ["enviar para aprovacao", "enviar", "enviar ao cliente", "mandar para aprovacao"]
};
export const AD_COLUMN_LABELS = {
  title: "Título do anúncio", platform: "Plataforma", format: "Formato", objective: "Objetivo", campaign_context: "Contexto da campanha",
  primary_text: "Texto principal", headline: "Headline", description: "Descrição", cta: "CTA", destination_url: "Link de destino",
  creative: "Link do criativo", client_notes: "Observação para o cliente", internal_notes: "Observações internas", send: "Enviar para aprovação"
};

const PLATFORM_ALIASES = {
  meta: ["meta", "meta ads", "facebook", "facebook ads", "instagram", "instagram ads", "fb", "ig", "face", "insta", "facebook e instagram"],
  google: ["google", "google ads", "adwords", "youtube", "youtube ads", "pesquisa google", "display"],
  tiktok: ["tiktok", "tik tok", "tiktok ads", "tt"]
};
const FORMAT_ALIASES = {
  imagem: ["imagem", "foto", "estatico", "post", "arte", "card", "banner", "image"],
  video: ["video", "reels", "reel", "stories video", "shorts", "vídeo"],
  carrossel: ["carrossel", "carrosel", "carousel", "carrocel", "album"]
};
const OBJECTIVE_ALIASES = {
  reconhecimento: ["reconhecimento", "reconhecimento da marca", "alcance", "awareness", "marca"],
  trafego: ["trafego", "trafego para o site", "cliques", "visitas", "site"],
  engajamento: ["engajamento", "interacao", "seguidores", "curtidas"],
  leads: ["leads", "cadastros", "cadastros leads", "cadastro", "geracao de leads", "lead", "formulario"],
  vendas: ["vendas", "conversao", "conversoes", "venda", "compras"],
  mensagens: ["mensagens", "mensagem", "whatsapp", "direct", "conversas"],
  outro: ["outro", "outros"]
};
const YES = ["sim", "s", "x", "yes", "enviar", "1", "true", "ok"];
const NO = ["nao", "n", "no", "0", "false", ""];

/** Links do criativo: aceita vários, na ordem */
export function splitLinks(raw) {
  return String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

/** Acha a linha de títulos: precisa de "título" e de "plataforma" ou "formato" */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const map = {};
    (rows[i] || []).forEach((cell, col) => {
      const key = norm(cell);
      for (const [field, names] of Object.entries(AD_COLUMNS)) {
        if (names.includes(key) && map[field] === undefined) { map[field] = col; break; }
      }
    });
    if (map.title !== undefined && (map.platform !== undefined || map.format !== undefined)) return { index: i, map };
  }
  return null;
}

/**
 * @param {Array<Array<any>>} rows
 * @param {{clientId: string, existing?: Array<{title: string}>}} options  existing: anúncios do cliente (avisar repetidos)
 * @returns {{ error?: string, columns: string[], missing: string[], items: Array<{line: number, value: object, creative: Array<{url: string, kind: string}>, send: boolean, errors: string[], warnings: string[], duplicate: boolean, valid: boolean}> }}
 */
export function mapAdRows(rows, { clientId, existing = [] }) {
  const header = findHeader(rows);
  if (!header) {
    return { error: "Não encontrei os títulos das colunas. A primeira linha precisa ter pelo menos \"Título do anúncio\" e \"Plataforma\" (use o modelo de anúncios).", columns: [], missing: ["title", "platform"], items: [] };
  }
  const columns = Object.keys(header.map);
  const missing = Object.keys(AD_COLUMN_LABELS).filter((f) => header.map[f] === undefined);
  const seen = new Set(existing.map((a) => norm(a.title)));
  const items = [];
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;
    if (items.length >= MAX_IMPORT_ROWS) return { error: `A planilha tem mais de ${MAX_IMPORT_ROWS} anúncios. Divida em arquivos menores.`, columns, missing, items: [] };
    const cell = (field) => (header.map[field] === undefined ? "" : row[header.map[field]] ?? "");
    const text = (field) => String(cell(field) ?? "").trim();
    const errors = [];
    const warnings = [];

    let platform = lookup(PLATFORM_ALIASES, cell("platform"));
    let platformOther = "";
    if (!platform && text("platform")) {
      if (["outra", "outra plataforma", "outro", "outros"].includes(norm(cell("platform")))) errors.push("Plataforma \"Outra\": escreva o nome (ex.: LinkedIn Ads).");
      else { platform = "outra"; platformOther = text("platform").slice(0, 60); }
    }
    if (!text("platform")) errors.push(`Informe a plataforma (${Object.values(AD_PLATFORMS).slice(0, 3).join(", ")} ou o nome de outra).`);

    const format = lookup(FORMAT_ALIASES, cell("format"));
    if (!format) errors.push(text("format") ? `Formato desconhecido: "${text("format")}". Use: ${Object.values(AD_FORMATS).map((f) => f.label.toLowerCase()).join(", ")}.` : "Informe o formato (imagem, vídeo ou carrossel).");

    let objective = "";
    if (text("objective")) {
      objective = lookup(OBJECTIVE_ALIASES, cell("objective"));
      if (!objective) { warnings.push(`Objetivo "${text("objective")}" não reconhecido: ficou em branco.`); objective = ""; }
    }

    const sendText = norm(cell("send"));
    let send = false;
    if (YES.includes(sendText)) send = true;
    else if (!NO.includes(sendText)) warnings.push(`"Enviar para aprovação" = "${text("send")}": entendi como não. Use sim ou não.`);

    // Criativo: cada link vira um item (vídeo pelo link ou pelo formato)
    const creative = [];
    for (const url of splitLinks(cell("creative"))) {
      const media = describeMedia(url, format === "video" ? "video" : "image");
      if (media.type === "invalid") { errors.push(`Link do criativo inválido: "${url.slice(0, 60)}". Use links que comecem com https://`); continue; }
      const kind = media.type === "image" ? "image" : media.type === "video" || media.type === "embed" || format === "video" ? "video" : "image";
      if (url.length > 2000) { errors.push("Link do criativo muito longo."); continue; }
      creative.push({ url, kind });
    }
    if (creative.length > 20) errors.push("Use até 20 links de criativo por anúncio.");
    if (send && !creative.length) warnings.push("Sem link do criativo: entra como rascunho (envie o arquivo pelo painel e mande para aprovação).");
    if (format === "carrossel" && creative.length === 1) warnings.push("Carrossel com um só item.");

    const input = {
      client_id: clientId,
      title: text("title"),
      platform: platform || "",
      platform_other: platformOther,
      format: format || "",
      objective,
      campaign_context: text("campaign_context"),
      primary_text: text("primary_text"),
      headline: text("headline"),
      description: text("description"),
      cta: text("cta"),
      destination_url: text("destination_url"),
      client_notes: text("client_notes"),
      internal_notes: text("internal_notes")
    };
    const { value, errors: fieldErrors } = validateAd(input);
    for (const [field, message] of Object.entries(fieldErrors)) {
      if (["platform", "platform_other", "format"].includes(field) && errors.length) continue;   // já explicado acima
      errors.push(`${field === "client_id" ? "Cliente" : AD_COLUMN_LABELS[field] || field}: ${message}`);
    }
    const duplicate = Boolean(value.title && seen.has(norm(value.title)));
    if (duplicate) warnings.push("Já existe um anúncio com este título para o cliente.");
    if (value.title) seen.add(norm(value.title));
    items.push({ line: i + 1, value, creative, send: send && creative.length > 0, errors, warnings, duplicate, valid: errors.length === 0 });
  }
  return { columns, missing, items };
}
