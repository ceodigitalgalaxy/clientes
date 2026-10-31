/* ==========================================================================
   Função "ler-produto" (Supabase Edge Function)
   --------------------------------------------------------------------------
   O gerador de artes manda o link de um produto (loja online) e recebe
   nome, descrição, preço e a foto, para preencher o card sozinho.
   O navegador não consegue ler outro site direto (bloqueio de CORS); esta
   função lê a página no servidor.

   Pedidos (POST, com o login de quem usa o portal ou o painel):
     { url }     → { nome, descricao, preco, precoAntigo, imagem, site }
     { imagem }  → a própria imagem (para desenhar no card sem bloqueio)

   Proteções: só pessoas logadas; só http(s) na porta padrão; nada de
   endereços internos (localhost, IPs privados); no máximo 4 redirecionamentos,
   9 s de espera, 1,5 MB de página e 8 MB de imagem.
   Sem dependências do Deno aqui: o mesmo código roda nos testes (Node).
   ========================================================================== */

const ALLOWED_ORIGINS = ["https://clientes.digitalgalaxy.com.br", "http://localhost:5600", "http://127.0.0.1:5600"];
const PAGE_BYTES = 1.5 * 1024 * 1024;
const IMAGE_BYTES = 8 * 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function keysFromEnv(get) {
  const parse = (name) => { try { return JSON.parse(get(name) || "{}"); } catch { return {}; } };
  return { url: get("SUPABASE_URL"), publishable: parse("SUPABASE_PUBLISHABLE_KEYS").default || get("SUPABASE_ANON_KEY") };
}

/** Endereço externo e público? (barra localhost, redes internas e portas fora do padrão) */
export function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return null;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  if (host.includes(":")) return null;   // IPv6 literal: recusado
  return u;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const clean = (s, max) => {
  const t = decode(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
};
/** Preço em reais no formato brasileiro (182,90) */
export function brl(value) {
  if (value === null || value === undefined || value === "") return "";
  let s = String(value).trim().replace(/[^\d.,]/g, "");
  if (!s) return "";
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

/** Lê nome, descrição, preço e foto do HTML (JSON-LD de Produto, depois Open Graph) */
export function parseProduct(html, pageUrl) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const type = [].concat(node["@type"] || []).map(String);
    if (type.some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) found.push(node);
    Object.values(node).forEach((v) => { if (v && typeof v === "object") walk(v); });
  };
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* bloco inválido: ignora */ }
  }
  const meta = (names) => {
    for (const name of names) {
      const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
      const tag = html.match(re)?.[0];
      const content = tag?.match(/content\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
      if (content) return decode(content);
    }
    return "";
  };
  const p = found[0] || {};
  const pickImage = (img) => (typeof img === "string" ? img : Array.isArray(img) ? pickImage(img[0]) : img?.url || img?.contentUrl || "");
  const offers = [].concat(p.offers || []).flatMap((o) => [o, ...[].concat(o?.offers || [])]).filter(Boolean);
  const offerPrice = offers.map((o) => o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? [].concat(o.priceSpecification || [])[0]?.price).find((v) => v !== undefined && v !== null && v !== "");
  const listPrice = offers.map((o) => o.highPrice ?? [].concat(o.priceSpecification || []).find((ps) => /ListPrice|StrikethroughPrice/i.test(String(ps?.priceType || "")))?.price).find(Boolean);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const nome = clean(p.name || meta(["og:title", "twitter:title"]) || title, 120);
  const descricao = clean(p.description || meta(["og:description", "description", "twitter:description"]), 220);
  const preco = brl(offerPrice ?? meta(["product:price:amount", "og:price:amount", "price"]));
  const precoAntigo = brl(listPrice || meta(["product:original_price:amount"]));
  let imagem = pickImage(p.image) || meta(["og:image", "og:image:secure_url", "twitter:image", "image"]);
  try { imagem = imagem ? new URL(imagem, pageUrl).href : ""; } catch { imagem = ""; }
  return { nome, descricao, preco, precoAntigo: precoAntigo && precoAntigo !== preco ? precoAntigo : "", imagem, site: new URL(pageUrl).hostname.replace(/^www\./, "") };
}

/**
 * @param {{url: string, publishable: string}} keys
 * @param {typeof fetch} [fetchImpl]
 */
export function createHandler(keys, fetchImpl = globalThis.fetch.bind(globalThis), { allowedOrigins = ALLOWED_ORIGINS } = {}) {
  const base = String(keys.url || "").replace(/\/+$/, "");

  const cors = (origin) => ({
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  });
  const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" } });

  async function requireUser(req) {
    const authorization = req.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+$/.test(authorization) || /^Bearer\s+sb_/.test(authorization)) throw new HttpError(401, "Entre de novo.");
    let response;
    try { response = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: keys.publishable, Authorization: authorization } }); }
    catch { throw new HttpError(503, "O servidor de login não respondeu. Tente de novo."); }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.id) throw new HttpError(401, "Sua sessão expirou. Entre de novo.");
  }

  /** Busca seguindo no máximo 4 redirecionamentos, conferindo cada endereço */
  async function get(raw, accept) {
    let url = safeUrl(raw);
    if (!url) throw new HttpError(422, "Use um link público que comece com http ou https.");
    for (let hop = 0; hop < 5; hop++) {
      let response;
      try {
        response = await fetchImpl(url.href, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "pt-BR,pt;q=0.9" }, signal: AbortSignal.timeout(9000) });
      } catch { throw new HttpError(502, "O site do produto não respondeu. Tente de novo ou cole a imagem."); }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        url = safeUrl(new URL(response.headers.get("location"), url).href);
        if (!url) throw new HttpError(422, "O link leva para um endereço não permitido.");
        continue;
      }
      if (!response.ok) {
        // Loja que bloqueia leitura automática: respeitamos o bloqueio e indicamos o botão do navegador
        if ([401, 403, 429, 451, 503].includes(response.status)) throw new HttpError(422, "Essa loja não permite leitura automática. Abra o produto no navegador e use o botão \"Enviar para o gerador\" dos favoritos, ou cole a imagem e os dados.");
        throw new HttpError(502, `O site do produto não respondeu como esperado (código ${response.status}). Cole a imagem e os dados à mão.`);
      }
      return { response, url };
    }
    throw new HttpError(502, "O link redireciona demais.");
  }

  async function readLimited(response, max) {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(await response.arrayBuffer()).slice(0, max);
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel().catch(() => {}); if (max === IMAGE_BYTES) throw new HttpError(413, "Imagem grande demais (máximo 8 MB)."); break; }
      chunks.push(value);
    }
    const out = new Uint8Array(Math.min(size, max)); let at = 0;
    for (const c of chunks) { out.set(c.subarray(0, Math.min(c.length, out.length - at)), at); at += c.length; if (at >= out.length) break; }
    return out;
  }

  return async function handle(req) {
    const origin = req.headers.get("origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== "POST") return json(405, { error: "Use POST." }, origin);
    try {
      await requireUser(req);
      const body = await req.json().catch(() => ({}));
      if (body?.imagem) {
        const { response } = await get(body.imagem, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
        const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(type)) throw new HttpError(415, "Esse link não é de uma imagem.");
        const bytes = await readLimited(response, IMAGE_BYTES);
        return new Response(bytes, { status: 200, headers: { ...cors(origin), "Content-Type": type, "Cache-Control": "private, max-age=600" } });
      }
      if (body?.url) {
        const { response, url } = await get(body.url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
        const type = (response.headers.get("content-type") || "").toLowerCase();
        if (type.startsWith("image/")) return json(200, { nome: "", descricao: "", preco: "", precoAntigo: "", imagem: url.href, site: url.hostname.replace(/^www\./, "") }, origin);
        if (!type.includes("html")) throw new HttpError(415, "Esse link não é de uma página de produto.");
        const html = new TextDecoder("utf-8").decode(await readLimited(response, PAGE_BYTES));
        const product = parseProduct(html, url.href);
        if (!product.nome && !product.imagem) throw new HttpError(422, "Não encontrei os dados do produto nessa página. Cole a imagem e escreva o nome.");
        return json(200, product, origin);
      }
      throw new HttpError(422, "Mande o link do produto.");
    } catch (error) {
      return json(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "Algo deu errado ao ler o produto." }, origin);
    }
  };
}
