/* ==========================================================================
   Regras do painel administrativo
   --------------------------------------------------------------------------
   Usadas pela tela (validação antes de enviar) e pelos comandos locais
   (admin/equipe.mjs, admin/verify.mjs). As mesmas regras também estão no
   banco (supabase/migrations), que é a barreira final.
   Sem dependências: roda no navegador e no Node.
   ========================================================================== */

/** Status do fluxo de produção (guardado no conteúdo) */
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
  whatsapp: "WhatsApp"
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
  title: 160, mediaUrl: 2000, caption: 2200, internalNotes: 4000, sharedNotes: 2000
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
    caption: clean(input.caption),
    internal_notes: clean(input.internal_notes),
    client_notes: clean(input.client_notes),
    status: clean(input.status) || "planejado"
  };
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
export { USERNAME_LIMITS, PASSWORD_LIMITS, normalizeUsername, parseUsername, loginEmail, usernameFromEmail, accountKind, passwordProblem } from "../../../js/domain/accounts.js?v=794e2a0209";

/* ---------- Anúncios ---------- */
export { AD_STAGES, AD_STATUS, AD_CLIENT_STATUS, AD_PLATFORMS, AD_OBJECTIVES, AD_FORMATS, AD_CTAS, AD_LIMITS, AD_EVENTS, platformLabel, adCanSend, adSendBlock } from "../../../js/domain/ads.js?v=794e2a0209";
import { AD_STAGES as STAGES_OF_ADS, AD_STATUS as STATUS_OF_ADS, AD_PLATFORMS as PLATFORMS_OF_ADS, AD_OBJECTIVES as OBJECTIVES_OF_ADS, AD_FORMATS as FORMATS_OF_ADS, AD_LIMITS as L } from "../../../js/domain/ads.js?v=794e2a0209";

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
