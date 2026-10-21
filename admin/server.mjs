/* ==========================================================================
   Prévia local do site (portal do cliente + painel da agência)
   --------------------------------------------------------------------------
   node admin/server.mjs  →  http://localhost:5600/admin/
   Serve a pasta site/ exatamente como o GitHub Pages publica, para testar
   antes de enviar. Não guarda chave nenhuma: o painel entra com usuário e
   senha, igual ao publicado.
   - Escuta só em 127.0.0.1 e recusa outros endereços no cabeçalho Host
     (proteção contra DNS rebinding).
   - Só leitura (GET/HEAD) e só arquivos de dentro de site/.
   ========================================================================== */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(HERE, "..", "site");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json"
};

// A política de conteúdo (CSP) de cada página fica na própria página (<meta>), como no GitHub Pages
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin"
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

/** Arquivo de dentro de site/, com proteção contra "../" */
async function serveStatic(res, relative, method) {
  const file = path.normalize(path.join(SITE_DIR, relative));
  if (!file.startsWith(SITE_DIR + path.sep)) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(method === "HEAD" ? undefined : body);
    return true;
  } catch { return false; }
}

export function createPreviewServer({ port }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) { res.writeHead(421).end(); return; }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, SECURITY_HEADERS).end(); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { pathname = "/"; }
      if (pathname === "/admin") { res.writeHead(301, { Location: "/admin/" }).end(); return; }
      const relative = pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
      if (!(await serveStatic(res, relative, req.method))) {
        res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        res.end("Não encontrado");
      }
    } catch (error) {
      console.error("[prévia] erro inesperado:", error.message);
      res.writeHead(500, SECURITY_HEADERS).end();
    }
  });
}

// Execução direta: node admin/server.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(loadEnv().ADMIN_PORT) || 5600;
  createPreviewServer({ port }).listen(port, "127.0.0.1", () => {
    console.log(`\n  Painel da agência: http://localhost:${port}/admin/`);
    console.log(`  Portal do cliente: http://localhost:${port}/`);
    console.log("  Prévia só neste computador. Ctrl+C para encerrar.\n");
  });
}
