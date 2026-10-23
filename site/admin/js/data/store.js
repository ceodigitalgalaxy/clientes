/* ==========================================================================
   Armazenamento no Supabase (PostgreSQL), via API REST (PostgREST)
   --------------------------------------------------------------------------
   Dois modos, com o mesmo código:
   - Navegador (painel publicado): chave PUBLICÁVEL + sessão de quem entrou
     (getToken). O banco só entrega dados a membros da equipe (RLS).
   - Comandos locais (admin/verify.mjs): chave SECRETA, que ignora o RLS.
     Ela fica só em admin/.env, no computador da agência, nunca no navegador.

   Todos os métodos recebem dados já validados (rules.js) e devolvem objetos
   simples. Erros do banco viram StoreError com status HTTP e mensagem em
   português.
   ========================================================================== */

export class StoreError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CLIENT_FIELDS = "id,name,slug,segment,contact_name,contact_email,notes,active,logo_path,created_at,updated_at";
const AD_FIELDS = "id,client_id,title,campaign_context,objective,platform,platform_other,format,creative_stage,primary_text,headline,description,cta,destination_url,client_notes,internal_notes,status,version,submitted_at,submitted_by,first_submitted_at,created_by,created_at,updated_at";
const AD_ASSET_FIELDS = "id,ad_id,kind,storage_path,url,position,created_at";

/** Recusas das funções do fluxo de anúncios (raise exception) em português */
export const AD_ERRORS = {
  sem_criativo: "Envie pelo menos um arquivo ou link do criativo antes de mandar para aprovação.",
  anuncio_bloqueado: "Este anúncio está com o cliente (ou já foi aprovado/arquivado). Recolha ou reabra para editar.",
  use_fluxo_do_anuncio: "O status muda só pelos botões do anúncio.",
  cliente_fixo: "Depois do primeiro envio, o anúncio não muda de cliente.",
  anuncio_com_historico: "Este anúncio já foi enviado ao cliente e tem histórico. Arquive em vez de excluir.",
  transicao_invalida: "Esta ação não vale para o status atual do anúncio. Atualize a página.",
  anuncio_nao_encontrado: "Anúncio não encontrado. Ele pode ter sido excluído.",
  sem_permissao: "Seu usuário não tem permissão para fazer isso.",
  mensagem_longa: "A mensagem passou do limite de 1000 caracteres."
};
const CONTENT_FIELDS = "id,client_id,title,scheduled_date,scheduled_time,network,format,media_url,media_kind,caption,internal_notes,client_notes,status,version,created_at,updated_at";

/** Traduz erros do PostgREST/PostgreSQL para mensagens do painel */
function translate(status, body, withSession) {
  const code = body && body.code;
  if (code === "P0001" && AD_ERRORS[body.message]) return new StoreError(409, AD_ERRORS[body.message], body.message);
  if (code === "23505") return new StoreError(409, "Já existe um cliente com esse identificador. Escolha outro.", code);
  if (code === "23503") return new StoreError(409, "Este cliente tem conteúdos ou anúncios cadastrados e não pode ser excluído. Você pode inativá-lo.", code);
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") return new StoreError(400, "Algum campo está fora do formato aceito. Revise e tente de novo.", code);
  if (code === "PGRST116") return new StoreError(404, "Registro não encontrado. Ele pode ter sido excluído.", code);
  if (withSession && status === 401) return new StoreError(401, "Sua sessão expirou. Entre de novo.", "session_expired");
  if (withSession && (status === 403 || code === "42501")) return new StoreError(403, "Seu usuário não tem permissão para fazer isso.", code);
  if (status === 401 || status === 403) return new StoreError(502, "O banco recusou o acesso. Confira a chave secreta em admin/.env.", code);
  return new StoreError(502, "O banco de dados não respondeu como esperado. Tente de novo em instantes.", code);
}

/**
 * @param {object} options
 * @param {string} options.url        endereço do projeto Supabase
 * @param {string} options.apiKey     chave publicável (navegador) ou secreta (comandos locais)
 * @param {() => Promise<string>} [options.getToken]   sessão de quem entrou (só no navegador)
 * @param {() => Promise<unknown>} [options.onUnauthorized]  renova a sessão depois de um 401
 */
export function createSupabaseStore({ url, apiKey, secretKey, getToken, onUnauthorized, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const key = apiKey || secretKey;
  if (!key) throw new Error("createSupabaseStore: informe a chave (apiKey).");
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const withSession = typeof getToken === "function";
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Chave legada (JWT "service_role") também vai no Authorization
  if (!withSession && key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  async function request(path, { method = "GET", body, single = false, prefer } = {}, retry = true) {
    // Sem sessão válida, getToken falha antes de qualquer pedido ao banco
    const auth = withSession ? { Authorization: `Bearer ${await getToken()}` } : {};
    let response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method,
        headers: {
          ...headers,
          ...auth,
          ...(single ? { Accept: "application/vnd.pgrst.object+json" } : {}),
          ...(prefer ? { Prefer: prefer } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new StoreError(503, "Não foi possível conectar ao banco de dados. Verifique a internet e tente de novo.");
    }
    // Sessão vencida no meio do caminho: renova uma vez e repete o pedido
    if (response.status === 401 && withSession && retry && onUnauthorized) {
      await onUnauthorized();
      return request(path, { method, body, single, prefer }, false);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw translate(response.status, data, withSession);
    return data;
  }

  const enc = encodeURIComponent;

  return {
    kind: "supabase",

    async listClients() {
      // contents(count): quantidade de conteúdos de cada cliente; client_members: logins do portal
      const rows = await request(`clients?select=${CLIENT_FIELDS},contents(count),client_members(username)&order=name.asc`);
      return rows.map(({ contents, client_members: members, ...client }) => ({
        ...client,
        contents_count: contents?.[0]?.count ?? 0,
        portal_users: (members || []).map((m) => m.username).sort()
      }));
    },

    async getClient(id) {
      return request(`clients?select=${CLIENT_FIELDS}&id=eq.${enc(id)}`, { single: true });
    },

    async createClient(value) {
      return request(`clients?select=${CLIENT_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },

    async updateClient(id, value) {
      return request(`clients?select=${CLIENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },

    async deleteClient(id) {
      await request(`clients?select=id&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },

    async listContents(filters = {}) {
      // content_assets(count): quantos itens de arte final cada conteúdo tem
      const query = [`select=${CONTENT_FIELDS},content_assets(count)`, "order=scheduled_date.asc,scheduled_time.asc.nullslast,created_at.asc"];
      if (filters.client_id) query.push(`client_id=eq.${enc(filters.client_id)}`);
      if (filters.status) query.push(`status=eq.${enc(filters.status)}`);
      if (filters.from) query.push(`scheduled_date=gte.${enc(filters.from)}`);
      if (filters.to) query.push(`scheduled_date=lte.${enc(filters.to)}`);
      const rows = await request(`contents?${query.join("&")}`);
      return rows.map(({ content_assets: assets, ...row }) => ({ ...row, assets_count: assets?.[0]?.count ?? 0 }));
    },

    /** Vários conteúdos de uma vez (importação): tudo ou nada, numa única gravação */
    async createContents(values) {
      return request(`contents?select=${CONTENT_FIELDS}`, { method: "POST", body: values, prefer: "return=representation" });
    },

    /** Só o status (ex.: "Enviar para aprovação"); não muda a versão */
    async setContentStatus(id, status) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { status }, single: true, prefer: "return=representation" });
    },

    /** Mesmo status para vários conteúdos de uma vez (uma gravação só) */
    async setContentsStatus(ids, status) {
      return request(`contents?select=${CONTENT_FIELDS}&id=in.(${ids.map(enc).join(",")})`, { method: "PATCH", body: { status }, prefer: "return=representation" });
    },

    /** Foto do cliente (caminho no bucket client-logos, ou null para tirar) */
    async setClientLogo(id, logoPath) {
      return request(`clients?select=${CLIENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { logo_path: logoPath }, single: true, prefer: "return=representation" });
    },

    /* Arte final (content_assets): arquivos ou links, na ordem do carrossel */
    async listAssets(contentId) {
      return request(`content_assets?select=id,content_id,kind,storage_path,url,position,created_at&content_id=eq.${enc(contentId)}&order=position.asc,created_at.asc`);
    },
    async addAsset(value) {
      return request("content_assets?select=id,content_id,kind,storage_path,url,position,created_at", { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async moveAsset(id, position) {
      return request(`content_assets?select=id,position&id=eq.${enc(id)}`, { method: "PATCH", body: { position }, single: true, prefer: "return=representation" });
    },
    async deleteAsset(id) {
      return request(`content_assets?select=id,storage_path&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },

    /** Histórico de decisões do cliente, mais recente primeiro */
    async listApprovals(contentId) {
      return request(`content_approvals?select=id,version,decision,message,created_at&content_id=eq.${enc(contentId)}&order=created_at.desc`);
    },

    async getContent(id) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { single: true });
    },

    async createContent(value) {
      return request(`contents?select=${CONTENT_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },

    async updateContent(id, value) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },

    async deleteContent(id) {
      await request(`contents?select=id&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },

    /** Calendário do cliente: só o que ele pode ver (view sem observações internas) */
    async listClientCalendar(clientId, { from, to } = {}) {
      const query = ["select=*", `client_id=eq.${enc(clientId)}`, "order=scheduled_date.asc,scheduled_time.asc.nullslast"];
      if (from) query.push(`scheduled_date=gte.${enc(from)}`);
      if (to) query.push(`scheduled_date=lte.${enc(to)}`);
      return request(`client_calendar_items?${query.join("&")}`);
    },

    /* ---------- Anúncios (aprovação de criativos pagos) ---------- */
    async listAds(filters = {}) {
      const query = [`select=${AD_FIELDS},ad_assets(${AD_ASSET_FIELDS})`, "order=updated_at.desc", "ad_assets.order=position.asc,created_at.asc"];
      if (filters.client_id) query.push(`client_id=eq.${enc(filters.client_id)}`);
      if (filters.status) query.push(`status=eq.${enc(filters.status)}`);
      const rows = await request(`ads?${query.join("&")}`);
      return rows.map(({ ad_assets: assets, ...ad }) => ({ ...ad, assets: assets || [] }));
    },
    async getAd(id) {
      const row = await request(`ads?select=${AD_FIELDS},ad_assets(${AD_ASSET_FIELDS})&id=eq.${enc(id)}&ad_assets.order=position.asc,created_at.asc`, { single: true });
      const { ad_assets: assets, ...ad } = row;
      return { ...ad, assets: assets || [] };
    },
    async createAd(value) {
      return request(`ads?select=${AD_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async updateAd(id, value) {
      return request(`ads?select=${AD_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },
    /** Só o tipo do criativo, para vários (o banco recusa se algum não estiver editável) */
    async setAdsStage(ids, stage) {
      return request(`ads?select=id,creative_stage&id=in.(${ids.map(enc).join(",")})`, { method: "PATCH", body: { creative_stage: stage }, prefer: "return=representation" });
    },
    async deleteAd(id) {
      await request(`ads?select=id&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },
    /** enviar | recolher | reabrir | arquivar | reativar (o banco confere o status e grava o histórico) */
    async adTransition(id, action, message = null) {
      const rows = await request("rpc/ad_transition", { method: "POST", body: { p_ad_id: id, p_action: action, p_message: message } });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async addAdAsset(value) {
      return request(`ad_assets?select=${AD_ASSET_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async moveAdAsset(id, position) {
      return request(`ad_assets?select=id,position&id=eq.${enc(id)}`, { method: "PATCH", body: { position }, single: true, prefer: "return=representation" });
    },
    async deleteAdAsset(id) {
      return request(`ad_assets?select=id,storage_path&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },
    /** Histórico (mais antigo primeiro) e versões enviadas (mais nova primeiro) */
    async listAdEvents(id) {
      return request(`ad_events?select=id,version,event,from_status,to_status,actor_role,actor_username,message,created_at&ad_id=eq.${enc(id)}&order=created_at.asc`);
    },
    async listAdVersions(id) {
      return request(`ad_versions?select=id,version,snapshot,submitted_at&ad_id=eq.${enc(id)}&order=version.desc`);
    },

    /** A pessoa logada faz parte da equipe? (ela só enxerga o próprio cadastro) */
    async isAgencyMember(userId) {
      const rows = await request(`agency_members?select=user_id&user_id=eq.${enc(userId)}`);
      return Array.isArray(rows) && rows.length === 1;
    },

    async ping() {
      await request("clients?select=id&limit=1");
      return true;
    }
  };
}
