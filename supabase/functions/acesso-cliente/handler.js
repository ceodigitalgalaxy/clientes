/* ==========================================================================
   Função "acesso-cliente" (Supabase Edge Function)
   --------------------------------------------------------------------------
   Deixa a EQUIPE criar, trocar a senha e remover o LOGIN DE UM CLIENTE pelo
   painel da agência, sem a chave secreta sair do servidor.

   Regras:
   - Só atende quem está logado como membro da equipe (agency_members). O
     token de quem chama é conferido no Supabase Auth a cada pedido.
   - Só mexe em contas de cliente (cliente+<usuario>@...), ligadas a um
     cliente em client_members. Nunca cria, altera ou remove contas da equipe.
   - A senha vai direto para o Supabase Auth (que guarda só a versão
     criptografada). Ela não é registrada em lugar nenhum.

   Pedido: POST { action: "criar", client_id, username, password }
                { action: "senha", username, password }
                { action: "remover", username }
   Sem dependências do Deno aqui: o mesmo código roda nos testes (Node).
   ========================================================================== */

import { parseUsername, loginEmail, passwordProblem } from "./accounts.js";

const ALLOWED_ORIGINS = ["https://clientes.digitalgalaxy.com.br", "http://localhost:5600", "http://127.0.0.1:5600"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

/** Chaves que o Supabase entrega à função (novas sb_ ou legadas) */
export function keysFromEnv(get) {
  const parse = (name) => { try { return JSON.parse(get(name) || "{}"); } catch { return {}; } };
  return {
    url: get("SUPABASE_URL"),
    secret: parse("SUPABASE_SECRET_KEYS").default || get("SUPABASE_SERVICE_ROLE_KEY"),
    publishable: parse("SUPABASE_PUBLISHABLE_KEYS").default || get("SUPABASE_ANON_KEY")
  };
}

/**
 * @param {{url: string, secret: string, publishable: string}} keys
 * @param {typeof fetch} [fetchImpl]
 * @returns {(req: Request) => Promise<Response>}
 */
export function createHandler(keys, fetchImpl = globalThis.fetch.bind(globalThis), { allowedOrigins = ALLOWED_ORIGINS } = {}) {
  const base = String(keys.url || "").replace(/\/+$/, "");
  // Chave sb_ só no apikey; chave legada (JWT) também no Authorization
  const adminHeaders = { apikey: keys.secret, "Content-Type": "application/json", ...(String(keys.secret).startsWith("eyJ") ? { Authorization: `Bearer ${keys.secret}` } : {}) };

  async function call(path, { method = "GET", body, headers = adminHeaders } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new HttpError(503, "O servidor de login não respondeu. Tente de novo em instantes.");
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { response, data };
  }

  /** Quem está chamando: precisa ser membro da equipe */
  async function requireTeamMember(req) {
    const authorization = req.headers.get("authorization") || "";
    // Precisa ser o token de uma pessoa logada, não uma chave do projeto
    if (!/^Bearer\s+\S+$/.test(authorization) || /^Bearer\s+sb_/.test(authorization)) throw new HttpError(401, "Entre no painel de novo.");
    const { response, data } = await call("/auth/v1/user", { headers: { apikey: keys.publishable, Authorization: authorization } });
    if (!response.ok || !data?.id) throw new HttpError(401, "Sua sessão expirou. Entre de novo.");
    const member = await call(`/rest/v1/agency_members?select=user_id&user_id=eq.${encodeURIComponent(data.id)}`);
    if (!member.response.ok) throw new HttpError(502, "Não foi possível conferir o seu acesso. Tente de novo.");
    if (!Array.isArray(member.data) || member.data.length !== 1) throw new HttpError(403, "Só a equipe da agência pode gerenciar acessos.");
    return data;
  }

  const usernameOf = (raw) => {
    const username = parseUsername(raw);
    if (!username) throw new HttpError(422, "Revise os campos destacados.", { username: "Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado." });
    return username;
  };
  const passwordOf = (raw, username) => {
    const problem = typeof raw !== "string" ? "Informe a senha." : passwordProblem(raw, username);
    if (problem) throw new HttpError(422, "Revise os campos destacados.", { password: problem });
    return raw;
  };

  /** Login de cliente existente (pelo usuário), nunca da equipe */
  async function findClientLogin(username) {
    const { response, data } = await call(`/rest/v1/client_members?select=user_id,client_id,username&username=eq.${encodeURIComponent(username)}`);
    if (!response.ok) throw new HttpError(502, "Não foi possível consultar os acessos. Tente de novo.");
    if (!Array.isArray(data) || !data.length) throw new HttpError(404, "Esse login de cliente não existe.");
    return data[0];
  }

  const actions = {
    async criar(body) {
      const fields = {};
      if (!UUID.test(String(body.client_id || ""))) fields.client_id = "Escolha o cliente.";
      const username = parseUsername(body.username);
      if (!username) fields.username = "Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.";
      if (Object.keys(fields).length) throw new HttpError(422, "Revise os campos destacados.", fields);
      const password = passwordOf(body.password, username);

      const client = await call(`/rest/v1/clients?select=id,name,active&id=eq.${encodeURIComponent(body.client_id)}`);
      const row = Array.isArray(client.data) ? client.data[0] : null;
      if (!row) throw new HttpError(404, "Cliente não encontrado.");
      if (!row.active) throw new HttpError(409, "Este cliente está inativo. Ative o cliente antes de criar o acesso.");

      const taken = await call(`/rest/v1/client_members?select=user_id&username=eq.${encodeURIComponent(username)}`);
      if (Array.isArray(taken.data) && taken.data.length) throw new HttpError(409, "Esse usuário já existe. Escolha outro.", { username: "Esse usuário já existe. Escolha outro." });

      const created = await call("/auth/v1/admin/users", {
        method: "POST",
        body: { email: loginEmail(username, "cliente"), password, email_confirm: true, user_metadata: { name: row.name } }
      });
      if (!created.response.ok) {
        const code = created.data?.error_code || created.data?.code;
        if (code === "email_exists" || code === "user_already_exists") throw new HttpError(409, "Esse usuário já existe. Escolha outro.", { username: "Esse usuário já existe. Escolha outro." });
        if (code === "weak_password") throw new HttpError(422, "Revise os campos destacados.", { password: "Senha fraca demais. Use uma senha mais longa e variada." });
        throw new HttpError(502, "Não foi possível criar o acesso agora. Tente de novo.");
      }
      const userId = created.data?.id;
      const link = await call("/rest/v1/client_members", { method: "POST", body: { user_id: userId, client_id: row.id, username }, headers: { ...adminHeaders, Prefer: "return=minimal" } });
      if (!link.response.ok) {
        // Sem o vínculo a conta não serve para nada: desfaz
        await call(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
        throw new HttpError(502, "Não foi possível ligar o acesso ao cliente. Nada foi criado; tente de novo.");
      }
      return { ok: true, username, client_id: row.id };
    },

    async senha(body) {
      const username = usernameOf(body.username);
      const password = passwordOf(body.password, username);
      const login = await findClientLogin(username);
      const { response } = await call(`/auth/v1/admin/users/${encodeURIComponent(login.user_id)}`, { method: "PUT", body: { password } });
      if (!response.ok) throw new HttpError(502, "Não foi possível trocar a senha agora. Tente de novo.");
      return { ok: true, username };
    },

    async remover(body) {
      const username = usernameOf(body.username);
      const login = await findClientLogin(username);
      // Apagar a conta também apaga o vínculo (client_members: on delete cascade)
      const { response } = await call(`/auth/v1/admin/users/${encodeURIComponent(login.user_id)}`, { method: "DELETE" });
      if (!response.ok) throw new HttpError(502, "Não foi possível remover o acesso agora. Tente de novo.");
      return { ok: true, username };
    }
  };

  return async function handle(req) {
    const origin = req.headers.get("origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    };
    const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method !== "POST") throw new HttpError(405, "Método não permitido.");
      if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, "Origem não permitida.");
      if (!keys.url || !keys.secret || !keys.publishable) throw new HttpError(500, "Função sem configuração do Supabase.");
      await requireTeamMember(req);
      const raw = await req.text();
      if (raw.length > 4096) throw new HttpError(413, "Dados grandes demais.");
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); }
      const action = actions[body?.action];
      if (!action || !Object.hasOwn(actions, body.action)) throw new HttpError(400, "Ação desconhecida.");
      return reply(200, await action(body));
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message, fields: error.fields });
      console.error("acesso-cliente: erro inesperado", error?.message);
      return reply(500, { error: "Algo deu errado. Tente de novo." });
    }
  };
}
