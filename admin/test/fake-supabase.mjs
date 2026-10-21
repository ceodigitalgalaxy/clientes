/* SÓ PARA TESTES AUTOMÁTICOS: um Supabase de mentira (login + API do banco)
   que responde aos mesmos pedidos que o painel faz, usando o armazenamento em
   memória (memory-store.mjs). O teste de ponta a ponta intercepta os pedidos
   do navegador ao endereço do Supabase e responde por aqui.
   Imita as regras que importam para a tela: sem login → recusa; quem não é da
   equipe → não vê nada; token vencido → 401; token de renovação gira a cada uso.
   Portal do cliente: rpc/portal_profile e rpc/portal_contents só devolvem o
   cliente ligado ao login e não aceitam outros parâmetros (como o PostgREST). */

import { randomUUID, randomBytes } from "node:crypto";
import { loginEmail } from "../../site/admin/js/domain/rules.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS"
};

const json = (status, body) => ({ status, headers: { "content-type": "application/json", ...CORS }, body: body === undefined ? "" : JSON.stringify(body) });

export function createFakeSupabase({ store, publishableKey }) {
  const users = new Map();          // email → { id, email, password, name, member }
  const accessTokens = new Map();   // token → userId
  const refreshTokens = new Map();  // token → userId
  const log = [];

  const token = () => randomBytes(24).toString("base64url");
  function issue(user) {
    const access = token(); const refresh = token();
    accessTokens.set(access, user.id);
    refreshTokens.set(refresh, user.id);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: { id: user.id, email: user.email, user_metadata: { name: user.name } } };
  }
  const userById = (id) => [...users.values()].find((u) => u.id === id);

  function eq(params, column, op = "eq") {
    const value = params.get(column);
    return value && value.startsWith(`${op}.`) ? decodeURIComponent(value.slice(op.length + 1)) : undefined;
  }
  function range(params, column) {
    const out = {};
    for (const value of params.getAll(column)) {
      if (value.startsWith("gte.")) out.from = value.slice(4);
      if (value.startsWith("lte.")) out.to = value.slice(4);
    }
    return out;
  }

  /** Funções do portal: o cliente vem da sessão, nunca de um parâmetro */
  async function rpc(name, body, user) {
    const keys = Object.keys(body || {}).sort().join(",");
    if (name === "portal_profile" && keys === "") return store.portalProfile(user.id);
    if (name === "portal_contents" && keys === "p_from,p_to") return store.portalContents(user.id, body.p_from, body.p_to);
    return { error: json(404, { code: "PGRST202", message: "Could not find the function with the given parameters" }) };
  }

  async function rest(method, table, params, body, user, single) {
    if (table.startsWith("rpc/") && method === "POST") return rpc(table.slice(4), body, user);
    if (table === "agency_members") {
      const id = eq(params, "user_id");
      return id === user.id && user.member ? [{ user_id: user.id }] : [];
    }
    // Quem não é da equipe (inclusive clientes) não enxerga nada nas tabelas e não grava nada (como o RLS)
    if (!user.member) {
      if (method === "GET") return [];
      return { error: json(403, { code: "42501", message: "new row violates row-level security policy" }) };
    }
    const id = eq(params, "id");
    if (table === "clients") {
      if (method === "GET" && id) return [await store.getClient(id)];
      if (method === "GET") return (await store.listClients()).map(({ contents_count, portal_users, ...c }) => ({ ...c, contents: [{ count: contents_count }], client_members: portal_users.map((username) => ({ username })) }));
      if (method === "POST") return [await store.createClient(body)];
      if (method === "PATCH") return [await store.updateClient(id, body)];
      if (method === "DELETE") { await store.deleteClient(id); return [{ id }]; }
    }
    if (table === "contents") {
      if (method === "GET" && id) return [await store.getContent(id)];
      if (method === "GET") return store.listContents({ client_id: eq(params, "client_id"), status: eq(params, "status"), ...range(params, "scheduled_date") });
      if (method === "POST") return [await store.createContent(body)];
      if (method === "PATCH") return [await store.updateContent(id, body)];
      if (method === "DELETE") { await store.deleteContent(id); return [{ id }]; }
    }
    if (table === "client_calendar_items" && method === "GET") {
      return store.listClientCalendar(eq(params, "client_id"), range(params, "scheduled_date"));
    }
    return { error: json(404, { code: "PGRST205", message: "not found" }) };
  }

  return {
    log,
    failAuthNext: 0,   // pedidos de login que devem dar "muitas tentativas"
    offline: false,    // simula internet caída (todo pedido falha)

    /** kind "equipe" (member = acesso ao painel) ou "cliente" (clientId = cliente do portal) */
    addUser(username, password, { name = username, member = true, kind = "equipe", clientId = null } = {}) {
      const user = { id: randomUUID(), email: loginEmail(username, kind), password, name, member: kind === "equipe" && member };
      users.set(user.email, user);
      if (kind === "cliente" && clientId) store.addMember(user.id, clientId, username);
      return user;
    },
    /** Todos os tokens de acesso vencem (a renovação ainda funciona) */
    expireAccessTokens() { accessTokens.clear(); },
    /** Sessões encerradas no servidor (ex.: senha trocada): nem a renovação funciona */
    revokeAll() { accessTokens.clear(); refreshTokens.clear(); },

    async handle({ method, url, headers, body }) {
      const { pathname, searchParams } = new URL(url);
      if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
      if (this.offline) return "abort";
      const authorization = headers.authorization || "";
      log.push({ method, path: pathname, query: searchParams.toString(), hasToken: authorization.startsWith("Bearer ") });
      if (headers.apikey !== publishableKey) return json(401, { message: "Invalid API key" });
      const data = body ? JSON.parse(body) : undefined;

      /* ---- Login ---- */
      if (pathname === "/auth/v1/token" && method === "POST") {
        const grant = searchParams.get("grant_type");
        if (grant === "password") {
          if (this.failAuthNext > 0) { this.failAuthNext -= 1; return json(429, { error_code: "over_request_rate_limit", msg: "Too many requests" }); }
          const user = users.get(String(data?.email || "").toLowerCase());
          if (!user || user.password !== data?.password) return json(400, { error: "invalid_grant", error_code: "invalid_credentials", error_description: "Invalid login credentials" });
          return json(200, issue(user));
        }
        if (grant === "refresh_token") {
          const userId = refreshTokens.get(data?.refresh_token);
          if (!userId) return json(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
          refreshTokens.delete(data.refresh_token);   // gira a cada uso
          return json(200, issue(userById(userId)));
        }
      }
      if (pathname === "/auth/v1/logout" && method === "POST") {
        const userId = accessTokens.get(authorization.slice(7));
        if (userId) for (const [t, id] of refreshTokens) if (id === userId) refreshTokens.delete(t);
        return { status: 204, headers: CORS, body: "" };
      }

      /* ---- API do banco ---- */
      if (pathname.startsWith("/rest/v1/")) {
        const userId = accessTokens.get(authorization.slice(7));
        if (!authorization.startsWith("Bearer ")) return json(401, { code: "42501", message: "permission denied" });
        if (!userId) return json(401, { code: "PGRST303", message: "JWT expired" });
        const single = (headers.accept || "").includes("vnd.pgrst.object");
        let result;
        try {
          result = await rest(method, pathname.slice("/rest/v1/".length), searchParams, data, userById(userId), single);
        } catch (error) {
          if (error.code === "offline") return "abort";
          const status = error.code === "PGRST116" ? 406 : error.status || 500;
          return json(status, { code: error.code, message: error.message });
        }
        if (result?.error) return result.error;
        const isRpc = pathname.startsWith("/rest/v1/rpc/");
        if (single) return result.length === 1 ? json(method === "POST" ? 201 : 200, result[0]) : json(406, { code: "PGRST116", message: "0 rows" });
        return json(method === "POST" && !isRpc ? 201 : 200, result);
      }
      return json(404, { message: "not found" });
    }
  };
}
