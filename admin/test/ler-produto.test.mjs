/* Testes da função ler-produto (supabase/functions/ler-produto/handler.js):
   leitura de páginas de produto (JSON-LD e Open Graph), preço em reais,
   bloqueio de endereços internos e de quem não está logado.
   Rode: node admin/test/ler-produto.test.mjs */

import assert from "node:assert/strict";
import { createHandler, parseProduct, safeUrl, brl } from "../../supabase/functions/ler-produto/handler.js";

let passed = 0;
const check = async (label, fn) => { await fn(); passed += 1; };

const VTEX = `<!doctype html><html><head><title>Loja</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Coleira Seresto Cães acima de 8 kg","description":"<p>Proteção de até <b>8 meses</b> contra pulgas &amp; carrapatos.</p>","image":["/arquivos/seresto.png"],
"offers":{"@type":"AggregateOffer","lowPrice":189.9,"highPrice":259.9,"offers":[{"@type":"Offer","price":189.9}]}}]}</script></head><body></body></html>`;
const OG = `<html><head><meta property="og:title" content="Plano Mensal Jiu-Jitsu"><meta name="description" content="Aulas todos os dias &#8211; turmas infantil e adulto"><meta property="og:image" content="https://cdn.exemplo.com/foto.jpg"><meta property="product:price:amount" content="1299.00"></head></html>`;

await check("JSON-LD de produto (VTEX, @graph, AggregateOffer)", () => {
  const p = parseProduct(VTEX, "https://www.loja.com.br/seresto/p");
  assert.equal(p.nome, "Coleira Seresto Cães acima de 8 kg");
  assert.equal(p.descricao, "Proteção de até 8 meses contra pulgas & carrapatos.");
  assert.equal(p.preco, "189,90");
  assert.equal(p.precoAntigo, "259,90");
  assert.equal(p.imagem, "https://www.loja.com.br/arquivos/seresto.png");
  assert.equal(p.site, "loja.com.br");
});
await check("Open Graph quando não há JSON-LD", () => {
  const p = parseProduct(OG, "https://academia.exemplo.com/plano");
  assert.equal(p.nome, "Plano Mensal Jiu-Jitsu");
  assert.equal(p.descricao, "Aulas todos os dias – turmas infantil e adulto");
  assert.equal(p.preco, "1.299,00");
  assert.equal(p.imagem, "https://cdn.exemplo.com/foto.jpg");
});
await check("Preço em reais", () => {
  assert.equal(brl("1.299,90"), "1.299,90");
  assert.equal(brl("1299.9"), "1.299,90");
  assert.equal(brl("R$ 89,9"), "89,90");
  assert.equal(brl(""), "");
  assert.equal(brl("0"), "");
});
await check("Só endereços públicos (sem localhost, IP interno ou porta estranha)", () => {
  ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://[::1]/", "https://loja.com.br:8080/", "file:///etc/passwd", "ftp://loja.com.br/", "http://intranet/", "https://user:pw@loja.com.br/"]
    .forEach((u) => assert.equal(safeUrl(u), null, u));
  assert.ok(safeUrl("https://www.loja.com.br/produto/p"));
});

/* Handler completo, com login e site de mentira */
const pages = {
  "https://www.loja.com.br/seresto/p": { status: 200, type: "text/html; charset=utf-8", body: VTEX },
  "https://www.loja.com.br/curto": { status: 301, location: "https://www.loja.com.br/seresto/p" },
  "https://www.loja.com.br/vai-pra-dentro": { status: 302, location: "http://127.0.0.1/admin" },
  "https://www.loja.com.br/arquivos/seresto.png": { status: 200, type: "image/png", body: new Uint8Array([137, 80, 78, 71]) }
};
const fake = async (url, init = {}) => {
  if (url.endsWith("/auth/v1/user")) return init.headers.Authorization === "Bearer token-bom" ? new Response('{"id":"u1"}') : new Response("{}", { status: 401 });
  const page = pages[url];
  if (!page) return new Response("não", { status: 404 });
  if (page.location) return new Response(null, { status: page.status, headers: { location: page.location } });
  return new Response(page.body, { status: page.status, headers: { "content-type": page.type } });
};
const handle = createHandler({ url: "https://projeto.supabase.co", publishable: "sb_publishable_x" }, fake);
const call = (body, token = "token-bom") => handle(new Request("https://f/ler-produto", { method: "POST", headers: { authorization: `Bearer ${token}`, origin: "https://clientes.digitalgalaxy.com.br" }, body: JSON.stringify(body) }));

await check("Sem login: recusa", async () => {
  const r = await call({ url: "https://www.loja.com.br/seresto/p" }, "token-ruim");
  assert.equal(r.status, 401);
});
await check("Link do produto (com redirecionamento) devolve os dados", async () => {
  const r = await call({ url: "https://www.loja.com.br/curto" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://clientes.digitalgalaxy.com.br");
  const data = await r.json();
  assert.equal(data.preco, "189,90");
});
await check("Redirecionamento para endereço interno é barrado", async () => {
  const r = await call({ url: "https://www.loja.com.br/vai-pra-dentro" });
  assert.equal(r.status, 422);
});
await check("Imagem do produto vem pela função (sem bloqueio no navegador)", async () => {
  const r = await call({ imagem: "https://www.loja.com.br/arquivos/seresto.png" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
});
await check("Pré-checagem do navegador (OPTIONS)", async () => {
  const r = await handle(new Request("https://f/ler-produto", { method: "OPTIONS", headers: { origin: "http://localhost:5600" } }));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:5600");
});

console.log(`ler-produto: ${passed} verificações passaram`);
