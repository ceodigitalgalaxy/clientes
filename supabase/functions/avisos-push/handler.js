/* ==========================================================================
   Função "avisos-push" (Supabase Edge Function)
   --------------------------------------------------------------------------
   Manda para o celular/computador (Web Push) os avisos que já aparecem no
   sininho do painel. Só para a equipe; o cliente nunca recebe nada daqui.

   Quem chama:
   - O BANCO, a cada aviso novo (gatilho em notifications, via pg_net), com o
     segredo do gancho no cabeçalho x-hook-secret. O segredo nasce e fica no
     banco (Vault); a função confere pedindo ao próprio banco (push_claim).
       POST { action: "enviar", id }
   - A PESSOA logada (equipe ativa), pelo painel:
       POST { action: "chave" }   → { public_key }  (para o navegador assinar)
       POST { action: "teste" }   → manda um aviso de teste só para ela

   Regras:
   - A chave privada (VAPID) é gerada aqui na primeira vez e guardada no Vault
     do banco; nunca vai para o navegador, para o repositório nem para logs.
   - Cada aviso é enviado uma vez só (push_claim marca pushed_at de forma atômica).
   - O texto do aviso é curto e é cifrado para o aparelho (RFC 8291).
   - Só fala com serviços de push conhecidos (webpush.js); assinatura morta é apagada.
   Sem dependências do Deno aqui: o mesmo código roda nos testes (Node).
   ========================================================================== */

import { generateVapidKeys, sendPush } from "./webpush.js";

const ALLOWED_ORIGINS = ["https://clientes.digitalgalaxy.com.br", "http://localhost:5600", "http://127.0.0.1:5600"];
const SUBJECT = "https://clientes.digitalgalaxy.com.br";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
 * @param {typeof fetch} [fetchImpl]  fala com o Supabase
 * @param {{allowedOrigins?: string[], pushFetch?: typeof fetch}} [options]  pushFetch fala com os serviços de push
 */
export function createHandler(keys, fetchImpl = globalThis.fetch.bind(globalThis), { allowedOrigins = ALLOWED_ORIGINS, pushFetch = globalThis.fetch.bind(globalThis) } = {}) {
  const base = String(keys.url || "").replace(/\/+$/, "");
  const adminHeaders = { apikey: keys.secret, "Content-Type": "application/json", ...(String(keys.secret).startsWith("eyJ") ? { Authorization: `Bearer ${keys.secret}` } : {}) };
  let vapid = null;   // guardado enquanto a função estiver de pé

  async function call(path, { method = "GET", body, headers = adminHeaders } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new HttpError(503, "O servidor não respondeu. Tente de novo em instantes.");
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { response, data };
  }
  async function rpc(name, body = {}) {
    const { response, data } = await call(`/rest/v1/rpc/${name}`, { method: "POST", body });
    if (!response.ok) throw new HttpError(502, "Não foi possível falar com o banco agora. Tente de novo.");
    return data;
  }

  /** Chaves da agência: as do banco; se ainda não existem, gera e guarda (o banco decide em caso de corrida) */
  async function vapidKeys() {
    if (vapid) return vapid;
    let stored = await rpc("push_config");
    if (!stored?.private || !stored?.public) {
      const fresh = await generateVapidKeys();
      stored = await rpc("push_config", { p_private: fresh.private, p_public: fresh.public });
    }
    if (!stored?.private || !stored?.public) throw new HttpError(500, "As notificações ainda não estão configuradas.");
    vapid = stored;
    return vapid;
  }

  /** Quem chama precisa ser da equipe e estar ativo */
  async function requireMember(req) {
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+$/.test(authorization) || /^Bearer\s+sb_/.test(authorization)) throw new HttpError(401, "Entre no painel de novo.");
    const { response, data } = await call("/auth/v1/user", { headers: { apikey: keys.publishable, Authorization: authorization } });
    if (!response.ok || !data?.id) throw new HttpError(401, "Sua sessão expirou. Entre de novo.");
    const member = await call(`/rest/v1/agency_members?select=user_id,active&user_id=eq.${encodeURIComponent(data.id)}`);
    if (!member.response.ok) throw new HttpError(502, "Não foi possível conferir o seu acesso. Tente de novo.");
    const row = Array.isArray(member.data) ? member.data[0] : null;
    if (!row || row.active === false) throw new HttpError(403, "Só a equipe ativa recebe avisos do painel.");
    return data;
  }

  /** Manda para todos os aparelhos e avisa o banco do que deu certo e do que morreu */
  async function deliver(subscriptions, message) {
    const list = Array.isArray(subscriptions) ? subscriptions.slice(0, 20) : [];
    if (!list.length) return { sent: 0, gone: 0, failed: 0 };
    const keysNow = await vapidKeys();
    const results = await Promise.all(list.map((s) => sendPush(s, message, keysNow, { fetchImpl: pushFetch, subject: SUBJECT })));
    const pick = (kind) => list.filter((s, i) => results[i] === kind).map((s) => s.endpoint);
    const ok = pick("ok");
    const gone = pick("gone");
    if (ok.length || gone.length) await rpc("push_report", { p_ok: ok, p_gone: gone }).catch(() => {});
    return { sent: ok.length, gone: gone.length, failed: list.length - ok.length - gone.length };
  }

  const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

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
      if (!keys.url || !keys.secret || !keys.publishable) throw new HttpError(500, "Função sem configuração do Supabase.");
      const raw = await req.text();
      if (raw.length > 4 * 1024) throw new HttpError(413, "Dados grandes demais.");
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); }

      // 1) O banco avisando de um aviso novo (sem navegador: não tem Origin)
      const hook = req.headers.get("x-hook-secret");
      if (hook !== null) {
        if (body?.action !== "enviar" || !UUID.test(String(body.id || "")) || hook.length < 32 || hook.length > 200) throw new HttpError(403, "Pedido recusado.");
        // O banco confere o segredo e entrega o aviso uma única vez (ou nada)
        const claim = await rpc("push_claim", { p_id: body.id, p_secret: hook });
        if (!claim) return reply(200, { sent: 0 });
        return reply(200, await deliver(claim.subscriptions, { title: text(claim.title, 80), body: text(claim.body, 180), url: claim.url, tag: claim.tag }));
      }

      // 2) A pessoa logada, pelo painel
      if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, "Origem não permitida.");
      const caller = await requireMember(req);
      if (body?.action === "chave") return reply(200, { public_key: (await vapidKeys()).public });
      if (body?.action === "teste") {
        const mine = await rpc("push_targets", { p_user: caller.id });
        if (!Array.isArray(mine) || !mine.length) throw new HttpError(409, "Nenhum aparelho seu está com os avisos ativados.");
        const result = await deliver(mine, { title: "Avisos ativados", body: "É assim que os avisos do painel vão chegar neste aparelho.", url: "/admin/", tag: "teste" });
        if (!result.sent) throw new HttpError(502, "O aviso de teste não saiu. Desative e ative de novo neste aparelho.");
        return reply(200, result);
      }
      throw new HttpError(400, "Ação desconhecida.");
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.message });
      console.error("avisos-push: erro inesperado", error?.message);
      return reply(500, { error: "Algo deu errado. Tente de novo." });
    }
  };
}
