/* ==========================================================================
   Versão dos arquivos do site (contra cache misturado)
   --------------------------------------------------------------------------
   O GitHub Pages guarda cada arquivo em cache por até 10 minutos, cada um no
   seu tempo. Sem versão, o navegador pode juntar o CSS novo com um módulo JS
   antigo (tela quebrada). Este comando coloca a MESMA versão em tudo:
     - nos <link>/<script> das páginas (…?v=VERSÃO)
     - em todo import relativo dos módulos (from "./x.js?v=VERSÃO")
   A versão é um resumo (hash) do conteúdo: só muda quando algum arquivo muda.

   node admin/versao.mjs              → atualiza os arquivos
   node admin/versao.mjs --verificar  → só confere (os testes usam; falha se
                                        alguém esqueceu de rodar)
   ========================================================================== */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const PAGES = ["index.html", "admin/index.html"].map((p) => path.join(SITE, p));
const CODE_DIRS = ["js", "admin/js", "css", "admin/css"].map((d) => path.join(SITE, d));

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

// import ... from "./x.js" | export ... from "../x.js" | import "./x.js"  (só caminhos relativos)
const IMPORT = /(\bfrom\s*|^\s*import\s*)(["'])(\.{1,2}\/[^"'?#]+\.js)(?:\?v=[\w-]*)?\2/gm;
// <link href="css/x.css?v=…"> e <script src="js/x.js?v=…"> (arquivos do próprio site)
const ASSET = /((?:href|src)=")((?!https?:|\/\/)[^"?#]+\.(?:css|js))(?:\?v=[\w-]*)?"/g;

const stripJs = (text) => text.replace(IMPORT, (m, lead, q, spec) => `${lead}${q}${spec}${q}`);
const stripHtml = (text) => text.replace(ASSET, (m, attr, file) => `${attr}${file}"`);

const files = CODE_DIRS.flatMap(walk).filter((f) => /\.(js|css)$/.test(f)).sort();

/** Hash do conteúdo de tudo (sem as versões, para ser estável) */
function computeVersion() {
  const hash = createHash("sha256");
  for (const file of [...files, ...PAGES]) {
    const text = readFileSync(file, "utf8");
    hash.update(path.relative(SITE, file)).update("\0");
    hash.update(file.endsWith(".js") ? stripJs(text) : file.endsWith(".html") ? stripHtml(text) : text).update("\0");
  }
  return hash.digest("hex").slice(0, 10);
}

export function versionSite({ check = false } = {}) {
  const version = computeVersion();
  const stale = [];
  const apply = (file, next) => {
    const text = readFileSync(file, "utf8");
    if (text === next) return;
    stale.push(path.relative(SITE, file));
    if (!check) writeFileSync(file, next);
  };
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    apply(file, readFileSync(file, "utf8").replace(IMPORT, (m, lead, q, spec) => `${lead}${q}${spec}?v=${version}${q}`));
  }
  for (const file of PAGES) {
    apply(file, readFileSync(file, "utf8").replace(ASSET, (m, attr, file2) => `${attr}${file2}?v=${version}"`));
  }
  return { version, stale };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const check = process.argv.includes("--verificar");
  const { version, stale } = versionSite({ check });
  if (check && stale.length) {
    console.error(`✘ Versões desatualizadas em: ${stale.join(", ")}\n  Rode: node admin/versao.mjs`);
    process.exit(1);
  }
  console.log(check ? `✔ Versão dos arquivos em dia (${version})` : `✔ Versão ${version}${stale.length ? ` aplicada em ${stale.length} arquivos` : " (nada mudou)"}`);
}
