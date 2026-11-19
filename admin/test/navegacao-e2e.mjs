/* Teste de ponta a ponta: rotas e navegação do painel.
   Toda seção abre pelo endereço direto (recarregar a página), com o título da
   aba, o item do menu marcado e o título da página iguais; endereço inexistente
   ou sem permissão cai no Início (e o endereço é corrigido); voltar e avançar
   do navegador; links "?abrir=" malformados não quebram; e o servidor recusa
   o que o menu esconde (a proteção não é só visual).
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/navegacao-e2e.mjs */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5724;
const ORIGIN = `http://localhost:${PORT}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false } });

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
const consoleErrors = [];
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) { results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`); process.exitCode = 1; }
  console.log(results.at(-1));
};
const browser = await chromium.launch();
async function newPage(user, pass, name) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
  });
  const p = await context.newPage();
  p.setDefaultTimeout(8000);
  p.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  p.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
  await p.goto(`${ORIGIN}/admin/`);
  await p.fill('#login-form [name="username"]', user);
  await p.fill('#login-form [name="password"]', pass);
  await p.click("#login-form [type=submit]");
  await p.waitForSelector("#app:not([hidden])");
  return p;
}
const visibleView = (p) => p.evaluate(() => document.querySelector("[data-view]:not([hidden])")?.dataset.view);
const hashRoute = (p) => p.evaluate(() => location.hash.replace(/^#\/?/, "").split("?")[0]);
const ROUTES = { inicio: "Início", demandas: "Minhas demandas", gestao: "Demandas", conteudos: "Conteúdos", aprovacoes: "Aprovações", anuncios: "Anúncios", clientes: "Clientes", importar: "Importar por planilha", financeiro: "Financeiro", equipe: "Equipe" };

const admin = await newPage("admdg-teste", "Senha-de-teste-123", "bruna");

await step("Cada seção abre pelo endereço direto (recarregando): título da aba, menu marcado e título da página batem", async () => {
  for (const [route, title] of Object.entries(ROUTES)) {
    await admin.goto(`${ORIGIN}/admin/#/${route}`);
    await admin.reload();
    await admin.waitForSelector("#app:not([hidden])");
    await admin.waitForFunction((r) => document.querySelector(`[data-view="${r}"]`) && !document.querySelector(`[data-view="${r}"]`).hidden, route);
    assert.equal(await visibleView(admin), route);
    assert.equal(await admin.title(), `${title} · Painel da agência`, route);
    if (route !== "importar") assert.equal(await admin.getAttribute(`.admin-nav [data-route="${route}"]`, "aria-current"), "page", `menu marcado em ${route}`);
    if (!["inicio"].includes(route)) assert.match(await admin.textContent(`[data-view="${route}"] .view__title`), new RegExp(`^${title}$`), `título da página em ${route}`);
  }
});

await step("Endereço inexistente cai no Início e o endereço é corrigido", async () => {
  await admin.goto(`${ORIGIN}/admin/#/financeiro-que-nao-existe`);
  await admin.waitForFunction(() => location.hash === "#/inicio");
  assert.equal(await visibleView(admin), "inicio");
});

await step("Todo link interno do menu leva a uma seção que existe", async () => {
  const hrefs = await admin.$$eval('a[href^="#/"]', (a) => [...new Set(a.map((x) => x.getAttribute("href").slice(2).split("?")[0]))]);
  for (const r of hrefs) assert.ok(r in ROUTES, `link para #/${r}`);
});

await step("Voltar e avançar do navegador trocam de seção corretamente", async () => {
  await admin.click('.admin-nav [data-route="gestao"]'); await admin.waitForFunction(() => location.hash === "#/gestao");
  await admin.click('.admin-nav [data-route="conteudos"]'); await admin.waitForFunction(() => location.hash.startsWith("#/conteudos"));
  await admin.goBack(); await admin.waitForFunction(() => location.hash === "#/gestao");
  assert.equal(await visibleView(admin), "gestao");
  await admin.goForward(); await admin.waitForFunction(() => location.hash.startsWith("#/conteudos"));
  assert.equal(await visibleView(admin), "conteudos");
});

await step("Filtro no endereço (Conteúdos) sobrevive ao recarregar; filtro inválido é ignorado", async () => {
  await admin.goto(`${ORIGIN}/admin/#/conteudos?client_id=${padaria.id}`);
  await admin.reload(); await admin.waitForSelector("#app:not([hidden])");
  await admin.waitForFunction((id) => document.querySelector('#filters [name="client_id"]')?.value === id, padaria.id);
  await admin.goto(`${ORIGIN}/admin/#/conteudos?client_id=<script>&status=qualquer`);
  await admin.waitForTimeout(600);
  assert.equal(await visibleView(admin), "conteudos");
  assert.equal(await admin.inputValue('#filters [name="client_id"]'), "");
});

await step('Link "?abrir=" malformado não abre nada nem quebra; o endereço fica limpo', async () => {
  await admin.goto(`${ORIGIN}/admin/?abrir=conteudo.nao-e-um-id`);
  await admin.waitForSelector("#app:not([hidden])");
  await admin.waitForFunction(() => location.search === "");
  assert.equal(await admin.locator("dialog[open]").count(), 0);
});

const ana = await newPage("ana.design", "Senha-da-Ana-123", "ana");

await step("Colaboradora: seções do administrador não aparecem no menu e o endereço direto cai no Início", async () => {
  for (const route of ["clientes", "equipe", "importar", "aprovacoes", "financeiro"]) {
    assert.equal(await ana.isVisible(`.admin-nav [data-route="${route}"]`), false, `menu sem ${route}`);
    await ana.goto(`${ORIGIN}/admin/#/${route}`);
    await ana.waitForFunction(() => location.hash === "#/inicio");
    assert.equal(await visibleView(ana), "inicio", route);
  }
});

await step("O servidor recusa o que o menu esconde (não é só visual)", async () => {
  const token = await ana.evaluate(() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v?.access_token) return v.access_token; } catch { /* outra chave */ } } return null; });
  assert.ok(token, "sessão da colaboradora");
  const call = (path, init) => ana.evaluate(async ({ url, key, token, path, init }) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
    return { status: r.status, body: await r.text() };
  }, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, token, path, init });
  const created = await call("clients", { method: "POST", body: JSON.stringify({ name: "Cliente invasor", slug: "invasor" }) });
  assert.ok(created.status >= 400, `criar cliente: ${created.status}`);
  const promote = await call(`agency_members?user_id=eq.${encodeURIComponent("qualquer")}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });
  assert.ok(promote.status >= 400 || promote.body === "[]", `virar administradora: ${promote.status} ${promote.body}`);
});

await step("Sem erros no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
