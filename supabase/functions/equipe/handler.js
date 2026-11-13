/* ==========================================================================
   Função "equipe" (Supabase Edge Function)
   --------------------------------------------------------------------------
   Deixa o ADMINISTRADOR criar logins da equipe, trocar a senha e ativar ou
   desativar o acesso pelo painel, sem a chave secreta sair do servidor.
   (Nome, função, perfil, clientes e permissões o painel muda direto no
   banco: as regras do banco só deixam o administrador.)

   Regras:
   - Só atende ADMINISTRADOR ativo (agency_members.role = 'admin'). O token de
     quem chama é conferido no Supabase Auth a cada pedido.
   - Só mexe em contas da equipe (equipe+<usuario>@...). Nunca em clientes.
   - Ninguém desativa o próprio acesso; o banco também impede ficar sem
     administrador ativo.
   - Desativar bane o login no Auth (as sessões param de renovar) e marca
     active = false (o banco nega tudo na hora).
   - A senha vai direto para o Supabase Auth; não é registrada em lugar nenhum.

   Pedido: POST { action: "criar", username, password, name, email?, job_title?, role,
                  all_clients, client_ids?, edit_scope, can_send_approval }
                { action: "senha", user_id, password }
                { action: "acesso", user_id, active }
   Sem dependências do Deno aqui: o mesmo código roda nos testes (Node).
   ========================================================================== */

import { parseUsername, loginEmail, passwordProblem } from "./accounts.js";

const ALLOWED_ORIGINS = ["https://clientes.digitalgalaxy.com.br", "http://localhost:5600", "http://127.0.0.1:5600"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BAN_FOREVER = "876000h";   // ~100 anos

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

/** Dados do membro (mesmas regras do banco), para criar */
export function memberFields(body) {
  const fields = {};
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max + 1) : "");
  const name = text(body.name, 80);
  const email = text(body.email, 160).toLowerCase();
  const job = text(body.job_title, 60);
  if (!name) fields.name = "Informe o nome.";
  else if (name.length > 80) fields.name = "Use até 80 caracteres.";
  if (email && (email.length > 160 || !EMAIL.test(email))) fields.email = "Confira o e-mail.";
  if (job.length > 60) fields.job_title = "Use até 60 caracteres.";
  const role = body.role === "admin" ? "admin" : body.role === "colaborador" ? "colaborador" : null;
  if (!role) fields.role = "Escolha o perfil.";
  const allClients = role === "admin" || body.all_clients === true;
  const clientIds = Array.isArray(body.client_ids) ? [...new Set(body.client_ids)] : [];
  if (!clientIds.every((id) => UUID.test(String(id))) || clientIds.length > 500) fields.client_ids = "Seleção de clientes inválida.";
  if (role === "colaborador" && !allClients && !clientIds.length) fields.client_ids = "Escolha pelo menos um cliente (ou todos).";
  const editScope = role === "admin" ? "todos" : body.edit_scope === "atribuidos" ? "atribuidos" : body.edit_scope === "todos" ? "todos" : null;
  if (!editScope) fields.edit_scope = "Escolha o que a pessoa pode editar.";
  return {
    fields,
    value: {
      name, email: email || null, job_title: job || null, role, all_clients: allClients,
      edit_scope: editScope, can_send_approval: role === "admin" || body.can_send_approval === true
    },
    clientIds: allClients ? [] : clientIds
  };
}

/**
 * @param {{url: string, secret: string, publishable: string}} keys
 * @param {typeof fetch} [fetchImpl]
 */
export function createHandler(keys, fetchImpl = globalThis.fetch.bind(globalThis), { allowedOrigins = ALLOWED_ORIGINS } = {}) {
  const base = String(keys.url || "").replace(/\/+$/, "");
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

  /** Quem chama precisa ser administrador ativo */
  async function requireAdmin(req) {
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+$/.test(authorization) || /^Bearer\s+sb_/.test(authorization)) throw new HttpError(401, "Entre no painel de novo.");
    const { response, data } = await call("/auth/v1/user", { headers: { apikey: keys.publishable, Authorization: authorization } });
    if (!response.ok || !data?.id) throw new HttpError(401, "Sua sessão expirou. Entre de novo.");
    const member = await call(`/rest/v1/agency_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(data.id)}`);
    if (!member.response.ok) throw new HttpError(502, "Não foi possível conferir o seu acesso. Tente de novo.");
    const row = Array.isArray(member.data) ? member.data[0] : null;
    if (!row || row.role !== "admin" || row.active === false) throw new HttpError(403, "Só administradores gerenciam a equipe.");
    return data;
  }

  const passwordOf = (raw, username) => {
    const problem = typeof raw !== "string" ? "Informe a senha." : passwordProblem(raw, username);
    if (problem) throw new HttpError(422, "Revise os campos destacados.", { password: problem });
    return raw;
  };

  /** Membro da equipe existente (nunca um cliente) */
  async function findMember(userId) {
    if (!UUID.test(String(userId || ""))) throw new HttpError(422, "Pessoa inválida.");
    const { response, data } = await call(`/rest/v1/agency_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(userId)}`);
    if (!response.ok) throw new HttpError(502, "Não foi possível consultar a equipe. Tente de novo.");
    if (!Array.isArray(data) || !data.length) throw new HttpError(404, "Essa pessoa não está na equipe.");
    return data[0];
  }

  const actions = {
    async criar(body) {
      const username = parseUsername(body.username);
      const { fields, value, clientIds } = memberFields(body);
      if (!username) fields.username = "Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.";
      if (Object.keys(fields).length) throw new HttpError(422, "Revise os campos destacados.", fields);
      const password = passwordOf(body.password, username);

      const created = await call("/auth/v1/admin/users", {
        method: "POST",
        body: { email: loginEmail(username, "equipe"), password, email_confirm: true, user_metadata: { name: value.name } }
      });
      if (!created.response.ok) {
        const code = created.data?.error_code || created.data?.code;
        if (code === "email_exists" || code === "user_already_exists") throw new HttpError(409, "Esse usuário já existe. Escolha outro.", { username: "Esse usuário já existe. Escolha outro." });
        if (code === "weak_password") throw new HttpError(422, "Revise os campos destacados.", { password: "Senha fraca demais. Use uma senha mais longa e variada." });
        throw new HttpError(502, "Não foi possível criar o acesso agora. Tente de novo.");
      }
      const userId = created.data?.id;
      const undo = () => call(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
      const member = await call("/rest/v1/agency_members", { method: "POST", body: { user_id: userId, ...value }, headers: { ...adminHeaders, Prefer: "return=minimal" } });
      if (!member.response.ok) { await undo(); throw new HttpError(502, "Não foi possível cadastrar a pessoa na equipe. Nada foi criado; tente de novo."); }
      if (clientIds.length) {
        const link = await call("/rest/v1/agency_member_clients", { method: "POST", body: clientIds.map((client_id) => ({ user_id: userId, client_id })), headers: { ...adminHeaders, Prefer: "return=minimal" } });
        if (!link.response.ok) { await undo(); throw new HttpError(502, "Não foi possível liberar os clientes. Nada foi criado; tente de novo."); }
      }
      return { ok: true, user_id: userId, username };
    },

    async senha(body, caller) {
      const member = await findMember(body.user_id);
      const password = passwordOf(body.password, "");
      if (member.user_id === caller.id) throw new HttpError(422, "Para trocar a sua própria senha, use o comando da equipe.");
      const { response } = await call(`/auth/v1/admin/users/${encodeURIComponent(member.user_id)}`, { method: "PUT", body: { password } });
      if (!response.ok) throw new HttpError(502, "Não foi possível trocar a senha agora. Tente de novo.");
      return { ok: true };
    },

    async acesso(body, caller) {
      const member = await findMember(body.user_id);
      const active = body.active === true;
      if (member.user_id === caller.id) throw new HttpError(422, "Você não pode desativar o seu próprio acesso.");
      // Banco primeiro: ele recusa deixar a agência sem administrador ativo
      const row = await call(`/rest/v1/agency_members?user_id=eq.${encodeURIComponent(member.user_id)}`, { method: "PATCH", body: { active }, headers: { ...adminHeaders, Prefer: "return=minimal" } });
      if (!row.response.ok) {
        if (/ultimo_admin/.test(JSON.stringify(row.data || ""))) throw new HttpError(409, "A agência precisa de pelo menos um administrador ativo.");
        throw new HttpError(502, "Não foi possível mudar o acesso agora. Tente de novo.");
      }
      const ban = await call(`/auth/v1/admin/users/${encodeURIComponent(member.user_id)}`, { method: "PUT", body: { ban_duration: active ? "none" : BAN_FOREVER } });
      if (!ban.response.ok) throw new HttpError(502, active ? "Acesso reativado no painel, mas o login ainda está bloqueado. Tente de novo." : "Acesso bloqueado no painel; o login será encerrado na próxima renovação. Tente de novo para garantir.");
      return { ok: true, active };
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
      const caller = await requireAdmin(req);
      const raw = await req.text();
      if (raw.length > 32 * 1024) throw new HttpError(413, "Dados grandes demais.");
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); }
      if (!body || !Object.hasOwn(actions, body.action)) throw new HttpError(400, "Ação desconhecida.");
      return reply(200, await actions[body.action](body, caller));
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message, fields: error.fields });
      console.error("equipe: erro inesperado", error?.message);
      return reply(500, { error: "Algo deu errado. Tente de novo." });
    }
  };
}
