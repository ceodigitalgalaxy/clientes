/* Teste de ponta a ponta: Financeiro → Metas.
   Administrador define o limite do MEI e metas (faturamento, teto por categoria,
   clientes ativos, meta do ano); o realizado vem dos lançamentos; meta repetida
   é recusada; editar e desativar; repetir as metas no mês seguinte; o sócio só
   consulta; quem não tem acesso não recebe nada; celular sem rolagem lateral.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/metas-e2e.mjs */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { todayBR, shiftMonth } from "../../site/admin/js/domain/finance.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5726;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || "";

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
fake.addUser("socio.teste", "Senha-do-Socio-123", { name: "Sócio Teste", profile: { role: "colaborador", all_clients: true, client_ids: [], edit_scope: "todos", can_send_approval: false, finance_access: "ver" } });
fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: true, client_ids: [], edit_scope: "atribuidos", can_send_approval: false } });

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
  return p;
}
const callAs = (p, path, init = {}) => p.evaluate(async ({ url, key, path, init }) => {
  let token = null;
  for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v?.access_token) token = v.access_token; } catch { /* outra chave */ } }
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  return { status: r.status, body: await r.text() };
}, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, path, init });
const F = (name) => `#fin-modal [name="${name}"]`;
const save = async (p) => { await p.click("#fin-modal [type=submit]"); await p.waitForSelector("#fin-modal:not([open])", { state: "attached" }); };
const goMetas = async (p, query = "") => {
  await p.evaluate((q) => { location.hash = `#/financeiro?aba=metas${q}`; }, query);
  await p.waitForSelector('#fin-goals[aria-busy="false"]');
};
const card = (p, name) => p.locator(`.fin-goals__section[aria-label="Metas do mês"] .fin-goal:has(.fin-goal__name:text-is("${name}"))`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const month = todayBR().slice(0, 7);

const admin = await newPage({ viewport: { width: 1366, height: 900 } }, "admdg-teste", "Senha-de-teste-123", "admin");

await step("Aba Metas vazia: convite para definir o limite do MEI e criar a primeira meta", async () => {
  await goMetas(admin);
  assert.equal(await admin.getAttribute('[data-fin-tab="metas"]', "aria-selected"), "true");
  assert.equal(await admin.isVisible("[data-fin-basis-wrap]"), false, "vencimento × competência só em Lançamentos");
  assert.match(await admin.textContent("#fin-goals"), /Nenhuma meta para este mês/);
  assert.equal(await admin.isVisible('#fin-goals button:has-text("Definir o limite anual do MEI")'), true);
});

await step("Limite do MEI: o administrador informa o valor (nada vem preenchido)", async () => {
  await admin.click("[data-mei-edit]");
  assert.equal(await admin.inputValue(F("mei_limit")), "");
  await admin.fill(F("mei_limit"), "81.000,00");
  await save(admin);
  await admin.waitForSelector('.fin-mei:has-text("R$ 81.000,00")');
  assert.equal(fake.finance.settings.mei_annual_limit_cents, 8100000);
});

await step("Lançamentos que alimentam as metas (receita recebida, reembolso fora do faturamento, despesa)", async () => {
  const add = async (dir, desc, amount, cat, paid) => {
    await admin.click(`[data-fin-new="${dir}"]`);
    await admin.fill(F("description"), desc);
    await admin.fill(F("amount"), amount);
    await admin.selectOption(F("category_id"), { label: cat });
    if (paid) await admin.check(F("paid_now"));
    await save(admin);
  };
  await add("receita", "Mensalidade", "6.000,00", "Mensalidade de cliente", true);
  await add("receita", "Reembolso de impressão", "500,00", "Reembolso recebido", false);
  await add("despesa", "Assinaturas", "250,00", "Ferramentas e assinaturas", false);
  assert.equal(fake.finance.entries.length, 3);
});

await step("Meta de faturamento do mês: realizado vem dos lançamentos (sem o reembolso)", async () => {
  await goMetas(admin);
  await admin.click('[data-goal-new="mes"]');
  await admin.selectOption(F("kind"), "faturamento");
  await admin.fill(F("target"), "10.000,00");
  await save(admin);
  const c = card(admin, "Faturamento");
  await c.waitFor();
  assert.match(await c.textContent(), /R\$ 6\.000,00\s*de R\$ 10\.000,00\s*60%/);
  assert.match(await c.textContent(), /Falta R\$ 4\.000,00/);
  assert.match(await c.textContent(), /por competência/);
  assert.equal(await c.locator(".fin-goal__fill").evaluate((n) => getComputedStyle(n).width !== "0px"), true, "barra preenchida (sem style inline)");
});

await step("Teto por categoria estourado e clientes ativos (quantidade)", async () => {
  await admin.click('[data-goal-new="mes"]');
  await admin.selectOption(F("kind"), "limite_categoria");
  assert.equal(await admin.isVisible(F("category_id")), true);
  await admin.selectOption(F("category_id"), { label: "Ferramentas e assinaturas" });
  await admin.fill(F("target"), "200,00");
  await save(admin);
  const cap = card(admin, "Gasto com Ferramentas e assinaturas");
  await cap.waitFor();
  assert.match(await cap.textContent(), /Estourou o teto/);
  assert.match(await cap.textContent(), /R\$ 50,00 acima do teto/);
  await admin.click('[data-goal-new="mes"]');
  await admin.selectOption(F("kind"), "clientes_ativos");
  assert.equal(await admin.isVisible(F("basis")), false, "clientes ativos não tem base");
  assert.equal(await admin.isVisible(F("target")), false);
  await admin.fill(F("target_count"), "3");
  await save(admin);
  assert.match(await card(admin, "Clientes ativos").textContent(), /1 cliente\s*de 3 clientes/);
});

await step("Meta igual no mesmo mês é recusada com explicação", async () => {
  await admin.click('[data-goal-new="mes"]');
  await admin.selectOption(F("kind"), "faturamento");
  await admin.fill(F("target"), "1,00");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal .form-error:not([hidden])");
  assert.match(await admin.textContent("#fin-modal .form-error"), /Já existe uma meta/);
  await admin.click('#fin-modal [data-action="close-modal"] >> nth=-1');
  await admin.waitForSelector("#fin-modal:not([open])", { state: "attached" });
});

await step("Meta do ano pelo caixa e limite do MEI usam o faturamento do ano", async () => {
  await admin.click('[data-goal-new="ano"]');
  assert.equal(await admin.isChecked('#fin-modal [name="period"][value="ano"]'), true);
  await admin.selectOption(F("kind"), "faturamento");
  await admin.fill(F("target"), "120.000,00");
  await admin.selectOption(F("basis"), "caixa");
  await save(admin);
  const year = admin.locator('.fin-goals__section[aria-label="Metas do ano"] .fin-goal');
  await year.waitFor();
  assert.match(await year.textContent(), /R\$ 6\.000,00\s*de R\$ 120\.000,00/);
  assert.match(await year.textContent(), /pelo caixa/);
  assert.match(await admin.textContent(".fin-mei"), /R\$ 6\.000,00\s*de R\$ 81\.000,00\s*7%/);
  await shot(admin, "metas");
});

await step("Editar a meta (tipo e período ficam fixos) e ver o novo resultado", async () => {
  await card(admin, "Faturamento").locator("[data-goal-edit]").click();
  assert.equal(await admin.locator(F("kind")).count(), 0, "tipo não muda ao editar");
  assert.equal(await admin.inputValue(F("target")), "10.000,00");
  await admin.fill(F("target"), "5.000,00");
  await save(admin);
  await admin.waitForFunction(() => /Meta já batida/.test(document.querySelector("#fin-goals")?.textContent || ""));
  assert.equal(fake.finance.goals.find((g) => g.kind === "faturamento" && g.period === "mes").target, 500000);
});

await step("Mês seguinte: repetir as metas do mês anterior com um clique", async () => {
  const next = shiftMonth(month, 1);
  if (next.slice(0, 4) !== month.slice(0, 4)) return;   // virada de ano: o botão não aparece (outro ano)
  await admin.click('[data-fin-month="1"]');
  await admin.waitForSelector("[data-goal-copy]");
  await admin.click("[data-goal-copy]");
  await admin.waitForFunction(() => document.querySelectorAll('.fin-goals__section[aria-label="Metas do mês"] .fin-goal').length === 3);
  assert.equal(fake.finance.goals.filter((g) => g.period_start === `${next}-01`).length, 3);
  assert.match(await admin.textContent("#fin-goals"), /Mês a mês/);
  await admin.click('[data-fin-month="-1"]');
  await admin.waitForSelector('#fin-goals[aria-busy="false"]');
});

await step("Desativar meta: pede confirmação, some da tela e fica na auditoria", async () => {
  await card(admin, "Clientes ativos").locator("[data-goal-archive]").click();
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await admin.waitForFunction(() => !/Clientes ativos/.test(document.querySelector('.fin-goals__section[aria-label="Metas do mês"]')?.textContent || ""));
  const g = fake.finance.goals.find((x) => x.kind === "clientes_ativos" && x.period_start === `${month}-01`);
  assert.equal(g.active, false, "não foi apagada");
  assert.ok(fake.finance.audit.some((a) => a.table_name === "fin_goals" && a.row_id === g.id && a.action === "alterou"));
});

const socio = await newPage({ viewport: { width: 1280, height: 860 } }, "socio.teste", "Senha-do-Socio-123", "socio");

await step("Sócio vê as metas e o limite do MEI, sem botões de mudar; o banco recusa se ele tentar", async () => {
  await goMetas(socio);
  await card(socio, "Faturamento").waitFor();
  assert.equal(await socio.locator("[data-goal-new], [data-goal-edit], [data-goal-archive], [data-mei-edit], [data-goal-copy]").count(), 0);
  assert.match(await socio.textContent(".fin-mei"), /81\.000,00/);
  const created = await callAs(socio, "fin_goals", { method: "POST", body: JSON.stringify({ kind: "despesas", period: "mes", period_start: `${month}-01`, target: 1 }) });
  assert.ok(created.status >= 400, `criar: ${created.status}`);
  const g = fake.finance.goals[0];
  const changed = await callAs(socio, `fin_goals?id=eq.${g.id}`, { method: "PATCH", body: JSON.stringify({ target: 1 }) });
  assert.ok(changed.status >= 400 || changed.body === "[]");
  const mei = await callAs(socio, "fin_settings?id=eq.true", { method: "PATCH", body: JSON.stringify({ mei_annual_limit_cents: 1 }) });
  assert.ok(mei.status >= 400 || mei.body === "[]");
  assert.equal(fake.finance.settings.mei_annual_limit_cents, 8100000);
});

const ana = await newPage({ viewport: { width: 1280, height: 860 } }, "ana.design", "Senha-da-Ana-123", "ana");

await step("Sem acesso ao financeiro: metas e faturamento do ano não chegam", async () => {
  for (const t of ["fin_goals", "fin_goal_progress", "fin_year_revenue"]) assert.equal((await callAs(ana, `${t}?select=*`)).body, "[]", t);
});

await step("Celular: metas em uma coluna, sem rolagem lateral", async () => {
  const phone = await newPage({ ...devices["iPhone 13"] }, "admdg-teste", "Senha-de-teste-123", "celular");
  await goMetas(phone);
  await card(phone, "Faturamento").waitFor();
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(wide <= 0, `rolagem lateral: ${wide}px`);
  await shot(phone, "metas-celular");
});

await step("Sem erros no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
