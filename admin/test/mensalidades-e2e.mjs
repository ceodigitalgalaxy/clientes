/* Teste de ponta a ponta: Financeiro → Mensalidades.
   Cadastrar a mensalidade de cada cliente, lançar o mês com um clique (sem
   duplicar), registrar o recebimento direto da lista, reajuste valendo só para
   os meses ainda não lançados, pausar, clientes sem mensalidade, o sócio só
   consulta, sem acesso não recebe nada, celular sem rolagem lateral.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/mensalidades-e2e.mjs */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { todayBR, shiftMonth } from "../../site/admin/js/domain/finance.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5727;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || "";

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz Fotografia", slug: "estudio-luz", active: true });
await store.createClient({ name: "Pet Shop Amigo", slug: "pet-amigo", active: true });
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
const goMonthly = async (p, query = "") => {
  await p.evaluate((q) => { location.hash = `#/financeiro?aba=mensalidades${q}`; }, query);
  await p.waitForSelector('#fin-monthly[aria-busy="false"]');
};
const row = (p, client) => p.locator(`.fin-mrow:has(.fin-mrow__client:text-is("${client}"))`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const month = todayBR().slice(0, 7);
const next = shiftMonth(month, 1);

const admin = await newPage({ viewport: { width: 1366, height: 900 } }, "admdg-teste", "Senha-de-teste-123", "admin");

await step("Sem mensalidades: convite para cadastrar e lista de clientes ativos sem mensalidade", async () => {
  await goMonthly(admin);
  assert.equal(await admin.getAttribute('[data-fin-tab="mensalidades"]', "aria-selected"), "true");
  assert.match(await admin.textContent("#fin-monthly"), /Nenhuma mensalidade cadastrada/);
  assert.match(await admin.textContent(".fin-without"), /Clientes ativos sem mensalidade \(3\)/);
});

await step("Cadastrar mensalidades (pela lista de clientes sem mensalidade e pelo botão)", async () => {
  await admin.click(`.fin-without [data-contract-new="${padaria.id}"]`);
  assert.equal(await admin.inputValue(F("client_id")), padaria.id, "cliente já escolhido");
  assert.equal(await admin.inputValue(F("description")), "Mensalidade");
  await admin.fill(F("amount"), "1.500,00");
  await admin.fill(F("due_day"), "31");
  await save(admin);
  await admin.click("#fin-monthly .fin-goals__head [data-contract-new]");
  await admin.selectOption(F("client_id"), estudio.id);
  await admin.fill(F("amount"), "900,00");
  await admin.fill(F("due_day"), "10");
  await admin.fill(F("end_month"), month);
  await save(admin);
  await row(admin, "Estúdio Luz Fotografia").waitFor();
  assert.equal(fake.finance.contracts.length, 2);
  assert.match(await admin.textContent(".fin-without"), /\(1\)/);
  assert.match(await row(admin, "Padaria Central Ltda").textContent(), /Não lançada/);
  assert.match(await admin.textContent(".fin-sum--res"), /R\$ 2\.400,00/);
});

await step("Validação: valor e dia do vencimento", async () => {
  await admin.click(".fin-without [data-contract-new]");
  await admin.fill(F("amount"), "0");
  await admin.fill(F("due_day"), "40");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal .field__error");
  const errors = await admin.$$eval("#fin-modal .field__error", (n) => n.map((x) => x.textContent).join(" | "));
  assert.match(errors, /maior que zero/);
  assert.match(errors, /Dia de 1 a 31/);
  await admin.click('#fin-modal [data-action="close-modal"] >> nth=-1');
  await admin.waitForSelector("#fin-modal:not([open])", { state: "attached" });
});

await step("Lançar o mês com um clique: vira receita recorrente, sem duplicar se clicar de novo", async () => {
  assert.match(await admin.textContent(".fin-generate"), /2 mensalidades ainda não lançadas/);
  await admin.click("[data-monthly-generate]");
  await admin.waitForFunction(() => !document.querySelector(".fin-generate"));
  assert.equal(fake.finance.entries.length, 2);
  assert.ok(fake.finance.entries.every((e) => e.revenue_kind === "recorrente" && e.contract_id && e.client_id));
  const pad = fake.finance.entries.find((e) => e.client_id === padaria.id);
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  assert.equal(pad.due_date, `${month}-${lastDay}`, "dia 31 vira o último dia do mês");
  const again = await callAs(admin, "rpc/fin_generate_monthly", { method: "POST", body: JSON.stringify({ p_month: `${month}-01` }) });
  assert.equal(again.body, "0", "lançar de novo não duplica");
  assert.equal(fake.finance.entries.length, 2);
  await shot(admin, "mensalidades");
});

await step("\"Recebeu\" direto da lista: recebimento parcial e depois o resto", async () => {
  await row(admin, "Padaria Central Ltda").locator("[data-monthly-receive]").click();
  await admin.waitForSelector("#fin-modal[open]");
  assert.equal(await admin.inputValue(F("amount")), "1.500,00");
  await admin.fill(F("amount"), "500,00");
  await save(admin);
  await admin.waitForFunction(() => /em parte/.test([...document.querySelectorAll(".fin-mrow")].find((r) => r.textContent.includes("Padaria"))?.textContent || ""));
  assert.match(await row(admin, "Padaria Central Ltda").textContent(), /falta R\$ 1\.000,00/);
  await row(admin, "Padaria Central Ltda").locator("[data-monthly-receive]").click();
  await save(admin);
  await admin.waitForFunction(() => /Recebida/.test([...document.querySelectorAll(".fin-mrow")].find((r) => r.textContent.includes("Padaria"))?.textContent || ""));
  assert.equal(await row(admin, "Padaria Central Ltda").locator("[data-monthly-receive]").count(), 0, "quitada: sem botão");
  assert.match(await admin.textContent(".fin-sum--in"), /R\$ 1\.500,00/);
});

await step("Abrir a mensalidade mostra o lançamento com os recebimentos", async () => {
  await row(admin, "Padaria Central Ltda").locator("[data-fin-open]").click();
  await admin.waitForSelector("#fin-drawer[open] .fin-settlements");
  assert.equal(await admin.locator("#fin-body .fin-settlements li").count(), 2);
  await admin.click('#fin-drawer [data-action="close-drawer"]');
  await admin.waitForSelector("#fin-drawer:not([open])", { state: "attached" });
});

await step("Reajuste vale só para os meses ainda não lançados; mensalidade que acabou não aparece no mês seguinte", async () => {
  await row(admin, "Padaria Central Ltda").locator("[data-contract-edit]").click();
  await admin.fill(F("amount"), "1.650,00");
  await save(admin);
  assert.equal(fake.finance.entries.find((e) => e.client_id === padaria.id).amount_cents, 150000, "mês já lançado não muda");
  await admin.click('[data-fin-month="1"]');
  await admin.waitForFunction((m) => location.hash.includes(`mes=${m}`), next);
  await admin.waitForSelector('#fin-monthly[aria-busy="false"]');
  await row(admin, "Padaria Central Ltda").waitFor();
  assert.equal(await row(admin, "Estúdio Luz Fotografia").count(), 0, "terminou no mês anterior");
  await admin.click("[data-monthly-generate]");
  await admin.waitForFunction(() => !document.querySelector(".fin-generate"));
  assert.equal(fake.finance.entries.find((e) => e.client_id === padaria.id && e.competence_date === `${next}-01`).amount_cents, 165000);
});

await step("Pausar: não lança nos meses seguintes e aparece como pausada", async () => {
  await row(admin, "Padaria Central Ltda").locator("[data-contract-edit]").click();
  await admin.check(F("paused"));
  await save(admin);
  await admin.click('[data-fin-month="1"]');
  await admin.waitForSelector('#fin-monthly[aria-busy="false"]');
  await admin.waitForFunction(() => /Pausadas neste mês: Padaria/.test(document.querySelector("#fin-monthly")?.textContent || ""));
  assert.equal(await admin.locator(".fin-generate").count(), 0);
});

const socio = await newPage({ viewport: { width: 1280, height: 860 } }, "socio.teste", "Senha-do-Socio-123", "socio");

await step("Sócio vê as mensalidades sem botões de mudar; o banco recusa se ele tentar", async () => {
  await goMonthly(socio);
  await row(socio, "Padaria Central Ltda").waitFor();
  assert.equal(await socio.locator("[data-contract-new], [data-contract-edit], [data-monthly-receive], [data-monthly-generate]").count(), 0);
  const gen = await callAs(socio, "rpc/fin_generate_monthly", { method: "POST", body: JSON.stringify({ p_month: `${shiftMonth(month, 5)}-01` }) });
  assert.ok(gen.status >= 400, `lançar: ${gen.status}`);
  const k = fake.finance.contracts[0];
  const changed = await callAs(socio, `fin_contracts?id=eq.${k.id}`, { method: "PATCH", body: JSON.stringify({ amount_cents: 1 }) });
  assert.ok(changed.status >= 400 || changed.body === "[]");
  const created = await callAs(socio, "fin_contracts", { method: "POST", body: JSON.stringify({ client_id: padaria.id, amount_cents: 1, due_day: 1, start_month: `${month}-01`, category_id: k.category_id }) });
  assert.ok(created.status >= 400);
  assert.equal(k.amount_cents, 165000);
});

const ana = await newPage({ viewport: { width: 1280, height: 860 } }, "ana.design", "Senha-da-Ana-123", "ana");

await step("Sem acesso ao financeiro: mensalidades não chegam e não dá para lançar", async () => {
  assert.equal((await callAs(ana, "fin_contracts?select=*")).body, "[]");
  const gen = await callAs(ana, "rpc/fin_generate_monthly", { method: "POST", body: JSON.stringify({ p_month: `${month}-01` }) });
  assert.ok(gen.status >= 400);
});

await step("Celular: lista legível, abas roláveis e nada rola para o lado", async () => {
  const phone = await newPage({ ...devices["iPhone 13"] }, "admdg-teste", "Senha-de-teste-123", "celular");
  await goMonthly(phone);
  await row(phone, "Padaria Central Ltda").waitFor();
  assert.match(await phone.textContent(".fin-sum--res"), /R\$ 2\.400,00/, "pausada depois: o mês já lançado continua contando");
  assert.equal(await phone.locator("text=Pausadas neste mês").count(), 0, "já lançada não aparece como pausada no mês");
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(wide <= 0, `rolagem lateral: ${wide}px`);
  await shot(phone, "mensalidades-celular");
});

await step("Sem erros no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
