/* Teste de ponta a ponta: busca rápida (Ctrl+K / "/" / lupa no topo).
   Acha demandas, conteúdos, clientes e seções ignorando acentos; teclado
   (↑ ↓ Enter Esc); cada resultado abre no lugar certo; colaborador só encontra
   o que pode ver (o banco recorta); no celular abre pela lupa.
   Também confere que Conteúdos abre na Semana quando a pessoa ainda não escolheu.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/busca-e2e.mjs */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5723;
const ORIGIN = `http://localhost:${PORT}`;
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz Fotografia", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false } });
const pao = await store.createContent(validateContent({ client_id: padaria.id, title: "Pão de fermentação natural", scheduled_date: plus(2), network: "instagram", format: "reels" }).value);
await store.createContent(validateContent({ client_id: estudio.id, title: "Ensaio de fotografia no parque", scheduled_date: plus(3), network: "instagram", format: "post" }).value);

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
async function newPage(options, user, pass, name) {
  const context = await browser.newContext(options);
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
  await p.waitForSelector(".kpis .kpi__n");
  return p;
}
const titles = (p) => p.$$eval("#search-modal .qs__title", (n) => n.map((x) => x.textContent));
const search = async (p, text) => { await p.fill("#search-modal [data-search-input]", text); await p.waitForTimeout(150); };

const page = await newPage({ viewport: { width: 1366, height: 800 } }, "admdg-teste", "Senha-de-teste-123", "bruna");

await step("Demanda de exemplo criada pelo quadro", async () => {
  await page.evaluate(() => { location.hash = "#/gestao"; });
  await page.locator('[data-action="new-task"]:visible').first().click();
  await page.fill("[data-task-new] [name=title]", "Cardápio de Natal da padaria");
  await page.selectOption("[data-task-new] [name=client_id]", padaria.id);
  await page.click("[data-task-new] .btn--primary[type=submit]");
  await page.waitForSelector('.tcard:has-text("Cardápio de Natal")');
});

await step("Ctrl+K abre a busca com o campo em foco; vazio mostra as seções", async () => {
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#search-modal[open]");
  assert.equal(await page.evaluate(() => document.activeElement?.matches("[data-search-input]")), true);
  const t = await titles(page);
  assert.ok(t.includes("Início") && t.includes("Demandas") && t.includes("Equipe"), t.join(","));
});

await step("Acha sem acento e em qualquer ordem: demanda, conteúdo e cliente", async () => {
  await search(page, "cardapio natal");
  await page.waitForFunction(() => [...document.querySelectorAll("#search-modal .qs__title")].some((n) => n.textContent.includes("Cardápio")));
  await search(page, "pao fermentacao");
  assert.deepEqual(await titles(page), ["Pão de fermentação natural"]);
  await search(page, "estudio");
  const t = await titles(page);
  assert.ok(t.includes("Estúdio Luz Fotografia"), "cliente encontrado");
  await search(page, "xyzqualquer");
  assert.match(await page.textContent("#search-modal .qs__empty"), /Nada encontrado/);
});

await step("Teclado: ↓ e Enter abrem a demanda escolhida", async () => {
  await search(page, "natal");
  await page.waitForFunction(() => document.querySelectorAll("#search-modal .qs__row").length > 0);
  assert.equal(await page.getAttribute("#qs-opt-0", "aria-selected"), "true");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#task-drawer[open] .task-props");
  assert.equal(await page.inputValue(".task-title"), "Cardápio de Natal da padaria");
  assert.equal(await page.locator("#search-modal[open]").count(), 0, "a busca fechou");
  await page.click('#task-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
});

await step('"/" abre a busca; conteúdo abre o detalhe; Esc fecha', async () => {
  await page.keyboard.press("/");
  await page.waitForSelector("#search-modal[open]");
  await search(page, "pao");
  await page.click(`#search-modal .qs__row:has-text("Pão de fermentação")`);
  await page.waitForSelector("#content-drawer[open]");
  assert.match(await page.textContent("#drawer-title"), /Pão de fermentação/);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#content-drawer:not([open])", { state: "attached" });
  await page.keyboard.press("/");
  await page.waitForSelector("#search-modal[open]");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#search-modal:not([open])", { state: "attached" });
});

await step("Cliente leva a Conteúdos já filtrado por ele, e Conteúdos abre na Semana", async () => {
  await page.keyboard.press("Control+k");
  await search(page, "padaria central");
  await page.click('#search-modal .qs__row:has-text("Padaria Central Ltda") >> nth=-1');
  await page.waitForFunction(() => location.hash.startsWith("#/conteudos"));
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue('#filters [name="client_id"]'), padaria.id, "filtro do cliente");
  assert.equal(await page.getAttribute('[data-cal-mode="semana"]', "aria-pressed"), "true", "abre na Semana");
});

await step("Colaboradora só encontra o que pode ver (conteúdo e cliente de outro cliente não aparecem)", async () => {
  const ana = await newPage({ viewport: { width: 1280, height: 800 } }, "ana.design", "Senha-da-Ana-123", "ana");
  await ana.keyboard.press("Control+k");
  await ana.waitForSelector("#search-modal[open]");
  await search(ana, "fotografia");
  await ana.waitForTimeout(500);
  assert.match(await ana.textContent("#search-modal [data-search-results]"), /Nada encontrado/);
  await search(ana, "pao");
  await ana.waitForFunction(() => document.querySelectorAll("#search-modal .qs__row").length > 0);
  assert.deepEqual(await titles(ana), ["Pão de fermentação natural"]);
  const t = await (async () => { await search(ana, ""); return titles(ana); })();
  assert.ok(!t.includes("Clientes") && !t.includes("Equipe"), "seções de administrador não aparecem para ela");
  assert.ok(pao.id);
});

await step("Celular: a lupa no topo abre a busca, que cabe na tela", async () => {
  const phone = await newPage({ ...devices["iPhone 13"] }, "admdg-teste", "Senha-de-teste-123", "celular");
  await phone.click('[data-action="quick-search"]');
  await phone.waitForSelector("#search-modal[open]");
  const box = await phone.$eval("#search-modal", (m) => { const r = m.getBoundingClientRect(); return { w: r.width, left: r.left, top: r.top }; });
  assert.ok(box.left >= 0 && box.w <= 390 && box.top < 40, JSON.stringify(box));
  const size = await phone.$eval("[data-search-input]", (i) => parseFloat(getComputedStyle(i).fontSize));
  assert.ok(size >= 16, "16px: o iPhone não dá zoom");
});

await step("Sem erros no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
