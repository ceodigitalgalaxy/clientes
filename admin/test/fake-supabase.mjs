/* SÓ PARA TESTES AUTOMÁTICOS: um Supabase de mentira (login + API do banco)
   que responde aos mesmos pedidos que o painel faz, usando o armazenamento em
   memória (memory-store.mjs). O teste de ponta a ponta intercepta os pedidos
   do navegador ao endereço do Supabase e responde por aqui.
   Imita as regras que importam para a tela: sem login → recusa; quem não é da
   equipe → não vê nada; token vencido → 401; token de renovação gira a cada uso.
   Portal do cliente: rpc/portal_profile e rpc/portal_contents só devolvem o
   cliente ligado ao login e não aceitam outros parâmetros (como o PostgREST).
   Função acesso-cliente: roda o código REAL (supabase/functions/acesso-cliente)
   com a chave secreta de mentira, sobre a API de administração de logins daqui. */

import { randomUUID, randomBytes } from "node:crypto";
import { loginEmail } from "../../site/admin/js/domain/rules.js";
import { createHandler } from "../../supabase/functions/acesso-cliente/handler.js";

/** Chave secreta de mentira: só o "servidor" (a função) conhece */
export const FAKE_SECRET = "sb_secret_FAKE_SERVIDOR";

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
    if (name === "portal_contents" && keys === "p_from,p_to") return (await store.portalContents(user.id, body.p_from, body.p_to)).map(({ assets, decision, ...row }) => row);
    if (name === "portal_client" && keys === "") return store.portalProfile(user.id);
    if (name === "portal_calendar" && keys === "p_from,p_to") return store.portalContents(user.id, body.p_from, body.p_to);
    if (name === "portal_decide" && ["p_content_id,p_decision,p_message,p_version", "p_content_id,p_decision,p_version"].includes(keys)) return store.portalDecide(user.id, body);
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
      if (method === "PATCH" && Object.keys(body).join() === "logo_path") return [await store.setClientLogo(id, body.logo_path)];
      if (method === "PATCH") return [await store.updateClient(id, body)];
      if (method === "DELETE") { await store.deleteClient(id); return [{ id }]; }
    }
    if (table === "content_assets") {
      if (method === "GET") return store.listAssets(eq(params, "content_id"));
      if (method === "POST") return [await store.addAsset(body)];
      if (method === "PATCH") return [await store.moveAsset(id, body.position)];
      if (method === "DELETE") return [await store.deleteAsset(id)];
    }
    if (table === "content_approvals" && method === "GET") return store.listApprovals(eq(params, "content_id"));
    if (table === "contents") {
      if (method === "GET" && id) return [await store.getContent(id)];
      if (method === "GET") return (await store.listContents({ client_id: eq(params, "client_id"), status: eq(params, "status"), ...range(params, "scheduled_date") })).map(({ assets_count, ...c }) => ({ ...c, content_assets: [{ count: assets_count }] }));
      if (method === "POST" && Array.isArray(body)) return store.createContents(body);
      if (method === "POST") return [await store.createContent(body)];
      if (method === "PATCH" && Object.keys(body).join() === "status") return [await store.setContentStatus(id, body.status)];
      if (method === "PATCH") return [await store.updateContent(id, body)];
      if (method === "DELETE") { await store.deleteContent(id); return [{ id }]; }
    }
    if (table === "client_calendar_items" && method === "GET") {
      return store.listClientCalendar(eq(params, "client_id"), range(params, "scheduled_date"));
    }
    return { error: json(404, { code: "PGRST205", message: "not found" }) };
  }

  /* ---- Armazenamento de arquivos (Storage), com as mesmas regras dos buckets ---- */
  const files = new Map();        // "bucket/caminho" → { type, body }
  const signTokens = new Map();   // token → "bucket/caminho"
  const BUCKETS = {
    "client-logos": { public: true, max: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
    "content-media": { public: false, max: 50 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"] }
  };
  const serve = (key) => {
    const file = files.get(key);
    return file ? { status: 200, headers: { "content-type": file.type, ...CORS }, body: file.body } : json(404, { message: "Object not found" });
  };
  function storageRoute({ method, pathname, searchParams, headers, body, bodyBuffer }) {
    const rest = pathname.slice("/storage/v1/object/".length).split("/").map(decodeURIComponent);
    // Links públicos e assinados não levam chave nem login (como no Supabase)
    if (method === "GET" && rest[0] === "public" && BUCKETS[rest[1]]?.public) return serve(rest.slice(1).join("/"));
    if (method === "GET" && rest[0] === "sign") {
      const key = rest.slice(1).join("/");
      return signTokens.get(searchParams.get("token")) === key ? serve(key) : json(400, { message: "Invalid signature" });
    }
    if (headers.apikey !== publishableKey) return json(401, { message: "Invalid API key" });
    const user = userById(accessTokens.get((headers.authorization || "").slice(7)));
    if (!user) return json(400, { statusCode: "403", message: "jwt expired" });
    if (method === "POST" && rest[0] === "sign") {
      const bucket = rest[1];
      const { paths = [] } = JSON.parse(body || "{}");
      return json(200, paths.map((path) => {
        const key = `${bucket}/${path}`;
        const allowed = user.member || (bucket === "content-media" && store.canReadMedia(user.id, path));
        if (!allowed || !files.has(key)) return { path, signedURL: null, error: "Either the object does not exist or you do not have access to it" };
        const token = randomBytes(12).toString("hex");
        signTokens.set(token, key);
        return { path, signedURL: `/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}?token=${token}`, error: null };
      }));
    }
    const bucket = BUCKETS[rest[0]];
    if (!bucket) return json(404, { message: "Bucket not found" });
    if (!user.member) return json(403, { statusCode: "403", message: "new row violates row-level security policy" });
    if (method === "POST") {
      const key = rest.join("/");
      const type = headers["content-type"] || "";
      const data = bodyBuffer || Buffer.from(body || "");
      if (!bucket.types.includes(type)) return json(415, { statusCode: "415", message: `mime type ${type} is not supported` });
      if (data.length > bucket.max) return json(413, { statusCode: "413", message: "The object exceeded the maximum allowed size" });
      if (files.has(key)) return json(409, { statusCode: "409", message: "The resource already exists" });
      files.set(key, { type, body: data });
      return json(200, { Key: key });
    }
    if (method === "DELETE") {
      const { prefixes = [] } = JSON.parse(body || "{}");
      prefixes.forEach((p) => files.delete(`${rest[0]}/${p}`));
      return json(200, prefixes.map((name) => ({ name })));
    }
    return json(405, { message: "Method not allowed" });
  }

  /** Pedidos feitos com a chave secreta (só a função): sem RLS */
  async function serviceRest(method, table, params, body) {
    if (table === "agency_members") {
      const id = eq(params, "user_id");
      const user = userById(id);
      return user && user.member ? [{ user_id: id }] : [];
    }
    if (table === "clients" && method === "GET") {
      const id = eq(params, "id");
      try { const c = await store.getClient(id); return [{ id: c.id, name: c.name, active: c.active }]; } catch { return []; }
    }
    if (table === "client_members" && method === "GET") return store.findMembers({ username: eq(params, "username"), userId: eq(params, "user_id") });
    if (table === "client_members" && method === "POST") {
      try { store.addMember(body.user_id, body.client_id, body.username); return []; }
      catch { return { error: json(409, { code: "23505", message: "duplicate key" }) }; }
    }
    return { error: json(404, { code: "PGRST205", message: "not found" }) };
  }

  const fake = {
    log,
    files,
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

    async handle({ method, url, headers, body, bodyBuffer }) {
      const { pathname, searchParams } = new URL(url);
      if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
      if (this.offline) return "abort";
      const authorization = headers.authorization || "";
      log.push({ method, path: pathname, query: searchParams.toString(), hasToken: authorization.startsWith("Bearer ") });
      if (pathname.startsWith("/storage/v1/object/")) return storageRoute({ method, pathname, searchParams, headers, body, bodyBuffer });
      // Funções do Supabase: não exigem apikey (a função confere quem chama)
      if (pathname === "/functions/v1/acesso-cliente") return this.callFunction({ method, url, headers, body });
      const secret = headers.apikey === FAKE_SECRET;
      if (!secret && headers.apikey !== publishableKey) return json(401, { message: "Invalid API key" });
      const data = body ? JSON.parse(body) : undefined;

      /* ---- Administração de logins (só com a chave secreta) ---- */
      if (pathname === "/auth/v1/user" && method === "GET") {
        const userId = accessTokens.get(authorization.slice(7));
        const user = userId && userById(userId);
        return user ? json(200, { id: user.id, email: user.email }) : json(401, { msg: "invalid JWT" });
      }
      if (pathname.startsWith("/auth/v1/admin/")) {
        if (!secret) return json(401, { msg: "This endpoint requires a valid service role key" });
        const id = pathname.split("/")[5];
        if (method === "POST" && !id) {
          if (users.has(data.email)) return json(422, { error_code: "email_exists", msg: "already registered" });
          const user = { id: randomUUID(), email: data.email, password: data.password, name: data.user_metadata?.name || "", member: false };
          users.set(user.email, user);
          return json(200, { id: user.id, email: user.email });
        }
        const user = userById(id);
        if (!user) return json(404, { error_code: "user_not_found" });
        if (method === "PUT") {
          user.password = data.password;
          for (const [t, uid] of refreshTokens) if (uid === id) refreshTokens.delete(t);
          return json(200, { id });
        }
        if (method === "DELETE") {
          users.delete(user.email);
          store.removeMember(id);
          for (const map of [accessTokens, refreshTokens]) for (const [t, uid] of map) if (uid === id) map.delete(t);
          return json(200, {});
        }
      }
      if (secret && pathname.startsWith("/rest/v1/")) {
        const result = await serviceRest(method, pathname.slice("/rest/v1/".length), searchParams, data);
        if (result?.error) return result.error;
        return json(method === "POST" ? 201 : 200, result);
      }

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

  // A função de verdade, com a chave secreta de mentira, falando com este Supabase
  const functionHandler = createHandler(
    { url: "https://peieimwpkrattuldmjux.supabase.co", secret: FAKE_SECRET, publishable: publishableKey },
    async (url, init = {}) => {
      const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      const answer = await fake.handle({ method: init.method || "GET", url, headers, body: init.body });
      if (answer === "abort") throw new TypeError("rede");
      return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
    },
    { allowedOrigins: ["http://localhost:5611", "http://localhost:5612", "http://localhost:5600"] }
  );
  fake.callFunction = async ({ method, url, headers, body }) => {
    const response = await functionHandler(new Request(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body }));
    return { status: response.status, headers: Object.fromEntries(response.headers), body: response.status === 204 ? "" : await response.text() };
  };
  return fake;
}
