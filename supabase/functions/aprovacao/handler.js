/* ==========================================================================
   Função "aprovacao" (Supabase Edge Function): a página pública de aprovação
   --------------------------------------------------------------------------
   O cliente abre https://clientes.digitalgalaxy.com.br/aprovacao/#<token>,
   sem login. A página só fala com ESTA função, que:
   - confere o token no banco (só o SHA-256 dele fica guardado), com limite de
     tentativas por IP e por link: funções approval_public_* (só a chave
     secreta executa; anon e clientes logados não);
   - devolve só o lote daquele link (a cópia congelada da versão enviada:
     sem referência interna, sem observações internas, sem rascunhos);
   - assina os arquivos privados por 30 minutos (link revogado = nenhum link
     novo; os já emitidos vencem sozinhos);
   - registra as decisões (aprovar, pedir ajuste, aprovar todos), conferindo
     versão e cliques repetidos no banco, numa transação.

   Pedido: POST { action: "ver", token }
                { action: "decidir", token, item, version, decision: "aprovado"|"ajustes", comment?, name?, session? }
                { action: "aprovar_todos", token, items: [{ item, version }], name?, session? }
   Sem dependências do Deno: o mesmo código roda nos testes (Node).
   ========================================================================== */

const ALLOWED_ORIGINS = ["https://clientes.digitalgalaxy.com.br", "http://localhost:5600", "http://127.0.0.1:5600"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const SESSION = /^[A-Za-z0-9-]{8,64}$/;
const SIGN_SECONDS = 1800;
const MAX_BODY = 32 * 1024;

/** Respostas do banco → status HTTP e mensagem para o cliente */
const ERRORS = {
  link_invalido: [404, "Este link de aprovação não existe ou está incompleto. Confira se copiou o endereço inteiro ou peça um novo link à Digital Galaxy."],
  link_desativado: [410, "Este link foi desativado. Peça o link atualizado à Digital Galaxy."],
  link_expirado: [410, "Este link expirou. Peça um novo link à Digital Galaxy."],
  muitas_tentativas: [429, "Muitas tentativas seguidas. Espere um minuto e tente de novo."],
  nao_permitido: [403, "Este link não permite esta ação."],
  acao_invalida: [400, "Ação inválida."],
  comentario_obrigatorio: [422, "Conte o que você gostaria de ajustar."],
  comentario_longo: [422, "O comentário pode ter até 1.000 caracteres."],
  item_nao_encontrado: [404, "Este conteúdo não está mais neste link."],
  versao_desatualizada: [409, "Nossa equipe atualizou este conteúdo enquanto você olhava. Confira a versão nova antes de responder."],
  ja_decidido: [409, "Este conteúdo já foi respondido."],
  nada_para_aprovar: [422, "Não há conteúdos pendentes para aprovar."]
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** Chaves que o Supabase entrega à função (novas sb_ ou legadas) */
export function keysFromEnv(get) {
  const parse = (name) => { try { return JSON.parse(get(name) || "{}"); } catch { return {}; } };
  return { url: get("SUPABASE_URL"), secret: parse("SUPABASE_SECRET_KEYS").default || get("SUPABASE_SERVICE_ROLE_KEY") };
}

/** IP de quem chama (para o limite de tentativas) */
export function clientIp(headers) {
  const first = (value) => String(value || "").split(",")[0].trim();
  return (first(headers.get("cf-connecting-ip")) || first(headers.get("x-forwarded-for")) || first(headers.get("x-real-ip")) || "").slice(0, 64);
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);

/**
 * @param {{url: string, secret: string}} keys
 * @param {typeof fetch} [fetchImpl]
 * @returns {(req: Request) => Promise<Response>}
 */
export function createHandler(keys, fetchImpl = globalThis.fetch.bind(globalThis), { allowedOrigins = ALLOWED_ORIGINS } = {}) {
  const base = String(keys.url || "").replace(/\/+$/, "");
  const adminHeaders = { apikey: keys.secret, "Content-Type": "application/json", ...(String(keys.secret).startsWith("eyJ") ? { Authorization: `Bearer ${keys.secret}` } : {}) };

  async function call(path, body) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(body) });
    } catch {
      throw new HttpError(503, "Não foi possível conectar. Verifique a internet e tente de novo.");
    }
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    return { response, data };
  }

  async function rpc(name, body) {
    const { response, data } = await call(`/rest/v1/rpc/${name}`, body);
    if (!response.ok) throw new HttpError(502, "Não conseguimos carregar a aprovação agora. Tente de novo em instantes.");
    return data;
  }

  /** Troca o caminho dos arquivos privados por links assinados; nunca devolve o caminho */
  async function present(view) {
    if (!view || typeof view !== "object" || !Array.isArray(view.items)) return view;
    const paths = [...new Set(view.items.flatMap((i) => (i.content?.assets || []).map((a) => a.storage_path).filter(Boolean)))];
    const links = new Map();
    if (paths.length) {
      const { response, data } = await call("/storage/v1/object/sign/content-media", { expiresIn: SIGN_SECONDS, paths });
      if (response.ok && Array.isArray(data)) {
        data.forEach((row) => { if (row?.path && row.signedURL) links.set(row.path, `${base}/storage/v1${row.signedURL.startsWith("/") ? "" : "/"}${row.signedURL}`); });
      }
    }
    const logo = view.client?.logo_path;
    return {
      ...view,
      client: { name: view.client?.name || "", logo: logo ? `${base}/storage/v1/object/public/client-logos/${String(logo).split("/").map(encodeURIComponent).join("/")}` : null },
      items: view.items.map((item) => ({
        ...item,
        content: item.content ? {
          ...item.content,
          assets: (item.content.assets || []).map(({ storage_path, url, ...asset }) => ({ ...asset, src: storage_path ? links.get(storage_path) || null : url || null, file: Boolean(storage_path) }))
        } : null
      }))
    };
  }

  /** Resultado do banco: erro conhecido → HttpError (com o lote atualizado, quando vier) */
  async function settle(data) {
    if (!data || typeof data !== "object") throw new HttpError(502, "Resposta inesperada do servidor. Tente de novo.");
    if (data.error) {
      const [status, message] = ERRORS[data.error] || [400, "Não foi possível concluir. Tente de novo."];
      throw new HttpError(status, message, { reason: data.error, view: data.view ? await present(data.view) : undefined });
    }
    return data;
  }

  const actions = {
    async ver(body, ip) {
      return { view: await present(await settle(await rpc("approval_public_view", { p_token: body.token, p_ip: ip }))) };
    },
    async decidir(body, ip) {
      if (!UUID.test(String(body.item || "")) || !UUID.test(String(body.version || ""))) throw new HttpError(400, "Conteúdo inválido.");
      if (!["aprovado", "ajustes"].includes(body.decision)) throw new HttpError(400, ERRORS.acao_invalida[1]);
      const comment = text(body.comment, 1001);
      if (body.decision === "ajustes" && !comment?.trim()) throw new HttpError(422, ERRORS.comentario_obrigatorio[1], { reason: "comentario_obrigatorio" });
      if (comment && comment.length > 1000) throw new HttpError(422, ERRORS.comentario_longo[1], { reason: "comentario_longo" });
      const data = await settle(await rpc("approval_public_decide", {
        p_token: body.token, p_ip: ip, p_item: body.item, p_version: body.version, p_action: body.decision,
        p_comment: comment, p_name: text(body.name, 80), p_session: SESSION.test(String(body.session || "")) ? body.session : null
      }));
      return { ok: true, status: data.status, view: await present(data.view) };
    },
    async aprovar_todos(body, ip) {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 200 || !items.every((x) => UUID.test(String(x?.item || "")) && UUID.test(String(x?.version || "")))) {
        throw new HttpError(422, ERRORS.nada_para_aprovar[1], { reason: "nada_para_aprovar" });
      }
      const data = await settle(await rpc("approval_public_approve_all", {
        p_token: body.token, p_ip: ip, p_items: items.map((x) => ({ item: x.item, version: x.version })),
        p_name: text(body.name, 80), p_session: SESSION.test(String(body.session || "")) ? body.session : null
      }));
      return { ok: true, approved: data.approved || [], skipped: (data.skipped || []).map((s) => ({ item: s.item, reason: s.error })), view: await present(data.view) };
    }
  };

  return async function handle(req) {
    const origin = req.headers.get("origin") || "";
    const headers = {
      "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "apikey, content-type, x-client-info, authorization",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer"
    };
    const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      if (req.method !== "POST") throw new HttpError(405, "Método não permitido.");
      if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, "Origem não permitida.");
      if (!keys.url || !keys.secret) throw new HttpError(500, "Função sem configuração do Supabase.");
      const raw = await req.text();
      if (raw.length > MAX_BODY) throw new HttpError(413, "Dados grandes demais.");
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); }
      if (!body || typeof body !== "object" || !Object.hasOwn(actions, body.action)) throw new HttpError(400, "Ação desconhecida.");
      if (!TOKEN.test(String(body.token || ""))) throw new HttpError(404, ERRORS.link_invalido[1], { reason: "link_invalido" });
      return reply(200, await actions[body.action](body, clientIp(req.headers)));
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message, ...error.extra });
      console.error("aprovacao: erro inesperado", error?.message);
      return reply(500, { error: "Algo deu errado. Tente de novo." });
    }
  };
}
