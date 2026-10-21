/* ==========================================================================
   Armazenamento no Supabase (PostgreSQL), via API REST (PostgREST)
   --------------------------------------------------------------------------
   Usado SÓ pelo servidor local do painel (admin/server.mjs). A chave secreta
   fica aqui, no servidor, e nunca vai para o navegador. Ela ignora o RLS: por
   isso o servidor só aceita conexões do próprio computador (veja server.mjs).

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

const CLIENT_FIELDS = "id,name,slug,segment,contact_name,contact_email,notes,active,created_at,updated_at";
const CONTENT_FIELDS = "id,client_id,title,scheduled_date,scheduled_time,network,format,media_url,media_kind,caption,internal_notes,status,version,created_at,updated_at";

/** Traduz erros do PostgREST/PostgreSQL para mensagens do painel */
function translate(status, body) {
  const code = body && body.code;
  if (code === "23505") return new StoreError(409, "Já existe um cliente com esse identificador. Escolha outro.", code);
  if (code === "23503") return new StoreError(409, "Este cliente tem conteúdos cadastrados e não pode ser excluído. Você pode inativá-lo.", code);
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") return new StoreError(400, "Algum campo está fora do formato aceito. Revise e tente de novo.", code);
  if (code === "PGRST116") return new StoreError(404, "Registro não encontrado. Ele pode ter sido excluído.", code);
  if (status === 401 || status === 403) return new StoreError(502, "O banco recusou o acesso. Confira a chave secreta em admin/.env.", code);
  return new StoreError(502, "O banco de dados não respondeu como esperado. Tente de novo em instantes.", code);
}

export function createSupabaseStore({ url, secretKey, fetchImpl = globalThis.fetch }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const headers = { apikey: secretKey, "Content-Type": "application/json" };
  // Chave legada (JWT "service_role") também vai no Authorization
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  async function request(path, { method = "GET", body, single = false, prefer } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method,
        headers: {
          ...headers,
          ...(single ? { Accept: "application/vnd.pgrst.object+json" } : {}),
          ...(prefer ? { Prefer: prefer } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new StoreError(503, "Não foi possível conectar ao banco de dados. Verifique a internet e tente de novo.");
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw translate(response.status, data);
    return data;
  }

  const enc = encodeURIComponent;

  return {
    kind: "supabase",

    async listClients() {
      // contents(count): quantidade de conteúdos de cada cliente, numa consulta só
      const rows = await request(`clients?select=${CLIENT_FIELDS},contents(count)&order=name.asc`);
      return rows.map(({ contents, ...client }) => ({ ...client, contents_count: contents?.[0]?.count ?? 0 }));
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
      const query = [`select=${CONTENT_FIELDS}`, "order=scheduled_date.asc,scheduled_time.asc.nullslast,created_at.asc"];
      if (filters.client_id) query.push(`client_id=eq.${enc(filters.client_id)}`);
      if (filters.status) query.push(`status=eq.${enc(filters.status)}`);
      if (filters.from) query.push(`scheduled_date=gte.${enc(filters.from)}`);
      if (filters.to) query.push(`scheduled_date=lte.${enc(filters.to)}`);
      return request(`contents?${query.join("&")}`);
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

    async ping() {
      await request("clients?select=id&limit=1");
      return true;
    }
  };
}
