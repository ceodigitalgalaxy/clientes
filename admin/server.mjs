/* ==========================================================================
   Painel administrativo · servidor local
   --------------------------------------------------------------------------
   Roda SÓ no computador da agência (node admin/server.mjs) até existir login.
   - Escuta apenas em 127.0.0.1: ninguém na rede ou na internet alcança.
   - Recusa outros endereços no cabeçalho Host (proteção contra DNS rebinding)
     e pedidos de escrita vindos de outros sites (Origin diferente).
   - Guarda a chave secreta do Supabase (admin/.env) fora do navegador.
   - Serve a tela do painel (admin/public) e reaproveita CSS, fontes e módulos
     do portal publicado (site/), sem copiar arquivos.
   Este painel NÃO vai para o GitHub Pages: o workflow publica só site/.
   ========================================================================== */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseStore, StoreError } from "./lib/store-supabase.mjs";
import { validateClient, validateContent, validateContentFilters, isUuid, isDate } from "./public/js/domain/rules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
const SITE_DIR = path.join(HERE, "..", "site");
// Do portal, só o que o painel reaproveita
const SHARED_ALLOWED = ["css/", "fonts/", "images/logo/", "js/lib/", "js/domain/", "js/ui/toast.js", "js/ui/badges.js"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon"
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin"
};

/** Lê admin/.env (KEY=valor por linha). Variáveis de ambiente têm prioridade. */
export function loadEnv(file = path.join(HERE, ".env")) {
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !line.trim().startsWith("#")) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("SUPABASE_") || k === "ADMIN_PORT")) };
}

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

const send = (res, status, payload, extra = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(payload));
};

async function readJson(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "Envie os dados em JSON.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "Dados grandes demais.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new HttpError(400, "Dados inválidos."); }
}

function requireValid({ value, errors }) {
  if (Object.keys(errors).length) throw new HttpError(422, "Revise os campos destacados.", errors);
  return value;
}

const requireId = (id) => { if (!isUuid(id)) throw new HttpError(404, "Registro não encontrado."); return id; };

/** Rotas da API do painel */
async function handleApi(req, res, url, store) {
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, id, sub] = parts;
  const method = req.method;

  if (resource === "health" && method === "GET") {
    if (!store) return send(res, 200, { ok: false, configured: false });
    await store.ping();
    return send(res, 200, { ok: true, configured: true, store: store.kind });
  }
  if (!store) throw new HttpError(503, "O painel ainda não está ligado ao banco. Preencha SUPABASE_URL e SUPABASE_SECRET_KEY em admin/.env e reinicie o servidor.");

  if (resource === "clients") {
    if (!id && method === "GET") return send(res, 200, await store.listClients());
    if (!id && method === "POST") return send(res, 201, await store.createClient(requireValid(validateClient(await readJson(req)))));
    if (id && !sub && method === "GET") return send(res, 200, await store.getClient(requireId(id)));
    if (id && !sub && method === "PATCH") return send(res, 200, await store.updateClient(requireId(id), requireValid(validateClient(await readJson(req)))));
    if (id && !sub && method === "DELETE") { await store.deleteClient(requireId(id)); return send(res, 200, { ok: true }); }
    // Calendário do cliente: o mesmo recorte que o portal do cliente vai consultar
    if (id && sub === "calendar" && method === "GET") {
      const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
      return send(res, 200, await store.listClientCalendar(requireId(id), { from: isDate(from) ? from : undefined, to: isDate(to) ? to : undefined }));
    }
  }

  if (resource === "contents") {
    if (!id && method === "GET") return send(res, 200, await store.listContents(validateContentFilters(Object.fromEntries(url.searchParams))));
    if (!id && method === "POST") return send(res, 201, await store.createContent(requireValid(validateContent(await readJson(req)))));
    if (id && method === "GET") return send(res, 200, await store.getContent(requireId(id)));
    if (id && method === "PATCH") return send(res, 200, await store.updateContent(requireId(id), requireValid(validateContent(await readJson(req)))));
    if (id && method === "DELETE") { await store.deleteContent(requireId(id)); return send(res, 200, { ok: true }); }
  }

  throw new HttpError(404, "Rota não encontrada.");
}

/** Arquivos estáticos com proteção contra "../" */
async function serveStatic(res, root, relative) {
  const file = path.normalize(path.join(root, relative));
  if (!file.startsWith(root + path.sep) && file !== root) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
    return true;
  } catch { return false; }
}

export function createAdminServer({ store, port }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  return http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) { res.writeHead(421).end(); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && !allowedOrigins.has(req.headers.origin)) throw new HttpError(403, "Pedido recusado.");
        await handleApi(req, res, url, store);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Método não permitido.");

      let served = false;
      if (url.pathname.startsWith("/shared/")) {
        const relative = decodeURIComponent(url.pathname.slice("/shared/".length));
        if (SHARED_ALLOWED.some((prefix) => relative.startsWith(prefix))) served = await serveStatic(res, SITE_DIR, relative);
      } else {
        const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
        served = await serveStatic(res, PUBLIC_DIR, relative);
      }
      if (!served) { res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" }); res.end("Não encontrado"); }
    } catch (error) {
      if (error instanceof HttpError || error instanceof StoreError) return send(res, error.status, { error: error.message, fields: error.fields });
      console.error("[painel] erro inesperado:", error.message);
      send(res, 500, { error: "Algo deu errado no servidor do painel. Tente de novo." });
    }
  });
}

// Execução direta: node admin/server.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const env = loadEnv();
  const port = Number(env.ADMIN_PORT) || 5600;
  const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
  const store = configured ? createSupabaseStore({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY }) : null;
  createAdminServer({ store, port }).listen(port, "127.0.0.1", () => {
    console.log(`\n  Painel da agência: http://localhost:${port}`);
    console.log(configured ? "  Banco: Supabase configurado" : "  ATENÇÃO: preencha admin/.env (veja admin/.env.example) para ligar o banco");
    console.log("  Só acessível neste computador. Ctrl+C para encerrar.\n");
  });
}
