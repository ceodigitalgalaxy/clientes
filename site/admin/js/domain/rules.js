/* ==========================================================================
   Regras do painel administrativo
   --------------------------------------------------------------------------
   Usadas pela tela (validação antes de enviar) e pelos comandos locais
   (admin/equipe.mjs, admin/verify.mjs). As mesmas regras também estão no
   banco (supabase/migrations), que é a barreira final.
   Sem dependências: roda no navegador e no Node.
   ========================================================================== */

import { APPROVAL_STATUS, PRODUCTION_STATUS, statusFromPair, pairFromStatus } from "../../../js/domain/approvals.js?v=887272bbb7";
export { APPROVAL_STATUS, PRODUCTION_STATUS, statusFromPair, pairFromStatus };

/** Situação no calendário (coluna antiga "status", calculada da aprovação + produção) */
export const CONTENT_STATUS = {
  planejado:            { label: "Planejado" },
  em_producao:          { label: "Em produção" },
  aguardando_aprovacao: { label: "Aguardando aprovação" },
  ajustes:              { label: "Ajustes solicitados" },
  aprovado:             { label: "Aprovado" },
  publicado:            { label: "Publicado" }
};

/** Status que aparecem no calendário do cliente (mesma regra da view client_calendar_items) */
export const CLIENT_VISIBLE_STATUS = ["aguardando_aprovacao", "ajustes", "aprovado", "publicado"];

/** Redes: mesmas chaves de PLATFORMS (site/js/domain/model.js) */
export const NETWORKS = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google: "Perfil do Google",
  whatsapp: "WhatsApp",
  outra: "Outra rede"
};

/** Formatos: mesmas chaves de ACTIVITY_TYPES (cores e ícones do calendário) */
export const FORMATS = {
  post:      { label: "Imagem (post)",    media: "image" },
  carrossel: { label: "Carrossel",        media: "image" },
  reels:     { label: "Vídeo (reels)",    media: "video" },
  stories:   { label: "Stories",          media: "image" },
  outro:     { label: "Outro formato",    media: "image" }
};

export const MEDIA_KINDS = { image: "Imagem", video: "Vídeo" };

export const LIMITS = {
  clientName: 120, slug: 60, segment: 120, contactName: 120, clientNotes: 2000,
  title: 160, mediaUrl: 2000, caption: 2200, internalNotes: 4000, sharedNotes: 2000, idea: 2000, contentPlan: 4000, artText: 1000, objective: 500, pillar: 80, cta: 200
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isUuid = (value) => typeof value === "string" && UUID.test(value);

export const isDate = (value) => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** "Trigo & Mel Padaria" → "trigo-mel-padaria" */
export function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, "");
}

const clean = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

/**
 * Valida e normaliza um cliente.
 * @returns {{ value: object, errors: Record<string, string> }}
 */
export function validateClient(input = {}) {
  const errors = {};
  const value = {
    name: clean(input.name),
    slug: clean(input.slug),
    segment: clean(input.segment),
    contact_name: clean(input.contact_name),
    contact_email: clean(input.contact_email),
    notes: clean(input.notes),
    active: input.active === undefined ? true : Boolean(input.active)
  };
  if (value.slug) value.slug = value.slug.toLowerCase();

  if (!value.name) errors.name = "Informe o nome do cliente.";
  else if (value.name.length > LIMITS.clientName) errors.name = `Use até ${LIMITS.clientName} caracteres.`;

  if (!value.slug) errors.slug = "Informe um identificador.";
  else if (value.slug.length > LIMITS.slug || !SLUG.test(value.slug)) errors.slug = "Use só letras minúsculas, números e hífens (ex.: padaria-central).";

  if (value.segment && value.segment.length > LIMITS.segment) errors.segment = `Use até ${LIMITS.segment} caracteres.`;
  if (value.contact_name && value.contact_name.length > LIMITS.contactName) errors.contact_name = `Use até ${LIMITS.contactName} caracteres.`;
  if (value.contact_email && !EMAIL.test(value.contact_email)) errors.contact_email = "Informe um e-mail válido.";
  if (value.notes && value.notes.length > LIMITS.clientNotes) errors.notes = `Use até ${LIMITS.clientNotes} caracteres.`;

  return { value, errors };
}

/**
 * Valida e normaliza um conteúdo.
 * @returns {{ value: object, errors: Record<string, string> }}
 */
export function validateContent(input = {}) {
  const errors = {};
  const value = {
    client_id: clean(input.client_id),
    title: clean(input.title),
    scheduled_date: clean(input.scheduled_date),
    scheduled_time: clean(input.scheduled_time),
    network: clean(input.network),
    format: clean(input.format),
    media_url: clean(input.media_url),
    media_kind: clean(input.media_kind),
    pillar: clean(input.pillar),
    idea: clean(input.idea),
    content_plan: clean(input.content_plan),
    art_text: clean(input.art_text),
    objective: clean(input.objective),
    caption: clean(input.caption),
    cta: clean(input.cta),
    internal_notes: clean(input.internal_notes),
    client_notes: clean(input.client_notes),
    status: clean(input.status) || "planejado"
  };
  // Aprovação e produção separadas; a situação no calendário sai das duas
  if (input.approval_status !== undefined || input.production_status !== undefined) {
    value.approval_status = clean(input.approval_status) || "rascunho";
    value.production_status = clean(input.production_status);
    if (!APPROVAL_STATUS[value.approval_status]) errors.approval_status = "Escolha a situação da aprovação.";
    if (value.production_status && !PRODUCTION_STATUS[value.production_status]) errors.production_status = "Escolha a etapa de produção.";
    value.status = statusFromPair(value.approval_status, value.production_status);
  } else {
    Object.assign(value, pairFromStatus(value.status));
  }
  if (value.scheduled_time && value.scheduled_time.length > 5) value.scheduled_time = value.scheduled_time.slice(0, 5);
  if (!value.media_url) value.media_kind = null;
  else if (!value.media_kind) value.media_kind = FORMATS[value.format]?.media || "image";

  if (!isUuid(value.client_id)) errors.client_id = "Escolha o cliente.";
  if (!value.title) errors.title = "Informe o título da publicação.";
  else if (value.title.length > LIMITS.title) errors.title = `Use até ${LIMITS.title} caracteres.`;
  if (!isDate(value.scheduled_date)) errors.scheduled_date = "Informe a data programada.";
  if (value.scheduled_time && !TIME.test(value.scheduled_time)) errors.scheduled_time = "Use o formato HH:MM.";
  if (!NETWORKS[value.network]) errors.network = "Escolha a rede social.";
  if (!FORMATS[value.format]) errors.format = "Escolha o formato.";
  if (value.media_url) {
    let ok = false;
    try { ok = ["http:", "https:"].includes(new URL(value.media_url).protocol); } catch { ok = false; }
    if (!ok) errors.media_url = "Use um link que comece com https://";
    else if (value.media_url.length > LIMITS.mediaUrl) errors.media_url = "Link muito longo.";
    if (!MEDIA_KINDS[value.media_kind]) errors.media_kind = "Escolha se é imagem ou vídeo.";
  }
  [["idea", LIMITS.idea], ["content_plan", LIMITS.contentPlan], ["art_text", LIMITS.artText], ["objective", LIMITS.objective], ["pillar", LIMITS.pillar], ["cta", LIMITS.cta]].forEach(([field, max]) => {
    if (value[field] && value[field].length > max) errors[field] = `Use até ${max.toLocaleString("pt-BR")} caracteres.`;
  });
  if (value.caption && value.caption.length > LIMITS.caption) errors.caption = `A legenda pode ter até ${LIMITS.caption} caracteres.`;
  if (value.internal_notes && value.internal_notes.length > LIMITS.internalNotes) errors.internal_notes = `Use até ${LIMITS.internalNotes} caracteres.`;
  if (value.client_notes && value.client_notes.length > LIMITS.sharedNotes) errors.client_notes = `Use até ${LIMITS.sharedNotes} caracteres.`;
  if (!CONTENT_STATUS[value.status]) errors.status = "Escolha o status.";

  return { value, errors };
}

/** Filtros da lista de conteúdos (também validados no servidor) */
export function validateContentFilters(input = {}) {
  const filters = {};
  if (input.client_id && isUuid(input.client_id)) filters.client_id = input.client_id;
  if (input.from && isDate(input.from)) filters.from = input.from;
  if (input.to && isDate(input.to)) filters.to = input.to;
  if (input.status && CONTENT_STATUS[input.status]) filters.status = input.status;
  return filters;
}

/* Regras de usuário e senha: as mesmas do portal do cliente (site/js/domain/accounts.js) */
export { USERNAME_LIMITS, PASSWORD_LIMITS, normalizeUsername, parseUsername, loginEmail, usernameFromEmail, accountKind, passwordProblem } from "../../../js/domain/accounts.js?v=887272bbb7";

/* ---------- Anúncios ---------- */
export { AD_STAGES, AD_STATUS, AD_CLIENT_STATUS, AD_PLATFORMS, AD_OBJECTIVES, AD_FORMATS, AD_CTAS, AD_LIMITS, AD_EVENTS, platformLabel, adCanSend, adSendBlock } from "../../../js/domain/ads.js?v=887272bbb7";
import { AD_STAGES as STAGES_OF_ADS, AD_STATUS as STATUS_OF_ADS, AD_PLATFORMS as PLATFORMS_OF_ADS, AD_OBJECTIVES as OBJECTIVES_OF_ADS, AD_FORMATS as FORMATS_OF_ADS, AD_LIMITS as L } from "../../../js/domain/ads.js?v=887272bbb7";

const isHttpUrl = (value) => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } };

/** Campos do anúncio (status e versão mudam só pelo fluxo, no banco) */
export function validateAd(input = {}) {
  const errors = {};
  const value = {
    client_id: clean(input.client_id),
    title: clean(input.title),
    campaign_context: clean(input.campaign_context),
    objective: clean(input.objective),
    platform: clean(input.platform),
    platform_other: clean(input.platform_other),
    format: clean(input.format),
    creative_stage: clean(input.creative_stage) || "final",
    primary_text: clean(input.primary_text),
    headline: clean(input.headline),
    description: clean(input.description),
    cta: clean(input.cta),
    destination_url: clean(input.destination_url),
    client_notes: clean(input.client_notes),
    internal_notes: clean(input.internal_notes)
  };
  if (value.platform !== "outra") value.platform_other = null;
  const max = (field, limit, label = "Use") => { if (value[field] && value[field].length > limit) errors[field] = `${label} até ${limit} caracteres.`; };

  if (!isUuid(value.client_id)) errors.client_id = "Escolha o cliente.";
  if (!value.title) errors.title = "Informe o título do anúncio.";
  max("title", L.title);
  if (value.objective && !OBJECTIVES_OF_ADS[value.objective]) errors.objective = "Escolha um objetivo da lista.";
  if (!PLATFORMS_OF_ADS[value.platform]) errors.platform = "Escolha a plataforma.";
  if (value.platform === "outra" && !value.platform_other) errors.platform_other = "Informe qual plataforma.";
  max("platform_other", L.platformOther);
  if (!FORMATS_OF_ADS[value.format]) errors.format = "Escolha o formato.";
  if (!STAGES_OF_ADS[value.creative_stage]) errors.creative_stage = "Escolha se é referência ou arte final.";
  max("campaign_context", L.campaignContext);
  max("primary_text", L.primaryText);
  max("headline", L.headline);
  max("description", L.description);
  max("cta", L.cta);
  max("client_notes", L.clientNotes);
  max("internal_notes", L.internalNotes);
  if (value.destination_url && (!isHttpUrl(value.destination_url) || value.destination_url.length > L.url)) errors.destination_url = "Use um link que comece com https://";
  return { value, errors };
}

/** Filtros da lista de anúncios */
export function validateAdFilters(input = {}) {
  const filters = {};
  if (input.client_id && isUuid(input.client_id)) filters.client_id = input.client_id;
  if (input.status && STATUS_OF_ADS[input.status]) filters.status = input.status;
  return filters;
}

/* ---------- Gerador de artes: identidade do cliente ---------- */
export const BRAND_COLORS = { primaria: "Cor principal (fundo)", secundaria: "Cor de apoio (detalhes)", preco: "Cor do preço", alerta: "Cor de alerta (faixas)", titulo: "Cor do título da campanha" };
export const BRAND_CAMPAIGNS = { padrao: "Identidade da marca", verao: "Verão", natal: "Natal", halloween: "Halloween", blackfriday: "Black Friday", pascoa: "Páscoa", maes: "Dia das Mães", pais: "Dia dos Pais", pets: "Dia dos Animais" };
export const BRAND_MODELS = { oferta: "Oferta de produto (varejo)", plano: "Plano, pacote ou serviço", evento: "Evento, aula ou episódio", antesdepois: "Antes e depois", frase: "Frase, dica ou depoimento", aviso: "Aviso (feriado, horário)" };
export const BRAND_LOGO_SLOTS = { emblema: "Símbolo (redondo)", principal: "Logo principal", alternativo: "Logo alternativo" };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const UNIT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Confere a identidade das artes; devolve { value, errors } como as outras validações */
export function validateBrandKit(input = {}) {
  const errors = {};
  const colors = {};
  Object.keys(BRAND_COLORS).forEach((key) => {
    const v = String(input.colors?.[key] || "").trim();
    if (!v) return;
    if (!HEX_COLOR.test(v)) errors[`color_${key}`] = "Use uma cor no formato #RRGGBB.";
    else colors[key] = v.toUpperCase();
  });
  if (!colors.primaria) errors.color_primaria = "Escolha a cor principal.";
  const units = [];
  (Array.isArray(input.units) ? input.units : []).forEach((u, i) => {
    const nome = String(u.nome || "").trim(), marca = String(u.marca || "").trim(), endereco = String(u.endereco || "").trim();
    const whatsapp = String(u.whatsapp || "").replace(/\D/g, "");
    if (!nome && !marca && !endereco && !whatsapp) return;
    if (!nome) errors[`unit_${i}_nome`] = "Dê um nome para a unidade.";
    if (nome.length > 60 || marca.length > 60) errors[`unit_${i}_nome`] = "Use até 60 caracteres.";
    if (endereco.length > 120) errors[`unit_${i}_endereco`] = "Use até 120 caracteres.";
    if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) errors[`unit_${i}_whatsapp`] = "Use DDD + número (ex.: 51999999999).";
    const id = slugify(nome || `unidade-${i + 1}`).slice(0, 40) || `unidade-${i + 1}`;
    units.push({ id: UNIT_ID.test(id) ? id : `unidade-${i + 1}`, nome, marca, endereco, whatsapp, logo: u.logo === "alternativo" ? "alternativo" : "principal" });
  });
  if (units.length > 12) errors.units = "Cadastre até 12 unidades.";
  const ids = new Set();
  units.forEach((u, i) => { if (ids.has(u.id)) u.id = `${u.id}-${i + 1}`; ids.add(u.id); });
  const campaigns = [...new Set((Array.isArray(input.campaigns) ? input.campaigns : []).filter((c) => BRAND_CAMPAIGNS[c]))];
  if (!campaigns.includes("padrao")) campaigns.unshift("padrao");
  const models = [...new Set((Array.isArray(input.models) ? input.models : []).filter((m) => BRAND_MODELS[m]))];
  if (!models.length) errors.models = "Escolha pelo menos um modelo.";
  const legal = String(input.legal || "").trim();
  if (legal.length > 200) errors.legal = "Use até 200 caracteres.";
  const logos = {};
  Object.keys(BRAND_LOGO_SLOTS).forEach((key) => { const v = input.logos?.[key]; if (typeof v === "string" && /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(v)) logos[key] = v; });
  return { value: { enabled: input.enabled !== false, colors, logos, units, campaigns, models, legal: legal || null }, errors };
}


/* ---------- Central de aprovação: lote ---------- */
export const BATCH_MODES = ["planejamento", "final"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Lote de aprovação (título, mês AAAA-MM, modo e mensagem de abertura).
 * @returns {{ value: object, errors: Record<string, string> }}
 */
export function validateBatch(input = {}, { requireClient = true } = {}) {
  const errors = {};
  const month = clean(input.month);
  const value = {
    title: clean(input.title),
    month: month && MONTH.test(month.slice(0, 7)) ? `${month.slice(0, 7)}-01` : null,
    approval_mode: clean(input.approval_mode) || "planejamento",
    intro_message: clean(input.intro_message)
  };
  if (requireClient) {
    value.client_id = clean(input.client_id);
    if (!isUuid(value.client_id)) errors.client_id = "Escolha o cliente.";
  }
  if (!value.title) errors.title = "Dê um título ao lote (ex.: Planejamento de novembro).";
  else if (value.title.length > 120) errors.title = "Use até 120 caracteres.";
  if (!value.month) errors.month = "Escolha o mês do planejamento.";
  if (!BATCH_MODES.includes(value.approval_mode)) errors.approval_mode = "Escolha o tipo de aprovação.";
  if (value.intro_message && value.intro_message.length > 1000) errors.intro_message = "Use até 1.000 caracteres.";
  return { value, errors };
}
