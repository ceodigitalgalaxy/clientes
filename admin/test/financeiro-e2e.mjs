/* Teste de ponta a ponta: Financeiro (Fase A).
   Administrador lança receita e despesa, registra recebimento parcial, estorna,
   cancela, edita a conta; clique duplo não duplica; o sócio (acesso "ver") só
   consulta; quem não tem acesso não vê o menu e o banco não entrega nada; o
   administrador libera o acesso pela Equipe; celular sem rolagem para o lado.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/financeiro-e2e.mjs */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { todayBR } from "../../site/admin/js/domain/finance.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5725;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || "";

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
fake.addUser("socio.teste", "Senha-do-Socio-123", { name: "Sócio Teste", profile: { role: "colaborador", all_clients: true, client_ids: [], edit_scope: "todos", can_send_approval: false, finance_access: "ver", job_title: "Sócio" } });
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
/** Chamada direta à API com a sessão da página (como alguém tentando pular a tela) */
const callAs = (p, path, init = {}) => p.evaluate(async ({ url, key, path, init }) => {
  let token = null;
  for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (v?.access_token) token = v.access_token; } catch { /* outra chave */ } }
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  return { status: r.status, body: await r.text() };
}, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, path, init });
const goFinance = async (p) => { await p.evaluate(() => { location.hash = "#/financeiro"; }); await p.waitForSelector('[data-view="financeiro"]:not([hidden]) #fin-list[aria-busy="false"]'); };
const fieldIn = (name) => `#fin-modal [name="${name}"]`;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
const today = todayBR();

const admin = await newPage({ viewport: { width: 1366, height: 860 } }, "admdg-teste", "Senha-de-teste-123", "admin");

await step("Administrador vê o menu Financeiro; mês vazio avisa que o histórico não tem início", async () => {
  assert.equal(await admin.isVisible('.admin-nav [data-route="financeiro"]'), true);
  await goFinance(admin);
  assert.equal(await admin.title(), "Financeiro · Painel da agência");
  assert.match(await admin.textContent("#fin-list"), /Nenhum lançamento/);
  assert.match(await admin.textContent("[data-fin-notice]"), /início do histórico/i);
  assert.match(await admin.textContent("[data-fin-notice]"), /Conta Inter/);
  assert.equal(await admin.isVisible('[data-fin-new="receita"]'), true);
});

await step("Nova receita com valor em reais: aparece na lista e nos totais (em centavos, sem arredondar)", async () => {
  await admin.click('[data-fin-new="receita"]');
  await admin.waitForSelector("#fin-modal[open]");
  await admin.fill(fieldIn("description"), "Mensalidade Padaria");
  await admin.fill(fieldIn("amount"), "1.500,10");
  await admin.selectOption(fieldIn("category_id"), { label: "Mensalidade de cliente" });
  await admin.selectOption(fieldIn("client_id"), padaria.id);
  await admin.selectOption(fieldIn("revenue_kind"), "recorrente");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector('.fin-row:has-text("Mensalidade Padaria")');
  assert.equal(fake.finance.entries.length, 1);
  assert.equal(fake.finance.entries[0].amount_cents, 150010);
  assert.match(await admin.textContent(".fin-sum--in"), /R\$ 1\.500,10/);
  assert.match(await admin.textContent('.fin-row:has-text("Mensalidade Padaria")'), /A receber/);
});

await step("Validação na tela: valor zero e sem categoria não são enviados", async () => {
  await admin.click('[data-fin-new="despesa"]');
  await admin.fill(fieldIn("description"), "Teste");
  await admin.fill(fieldIn("amount"), "0");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal .field__error");
  const errors = await admin.$$eval("#fin-modal .field__error", (n) => n.map((x) => x.textContent).join(" | "));
  assert.match(errors, /maior que zero/);
  assert.match(errors, /categoria/i);
  await admin.click('#fin-modal [data-action="close-modal"] >> nth=-1');
  await admin.waitForSelector("#fin-modal:not([open])", { state: "attached" });
});

await step("Clique duplo em Lançar não duplica a despesa (e já registra o pagamento)", async () => {
  await admin.click('[data-fin-new="despesa"]');
  await admin.fill(fieldIn("description"), "Assinatura de software");
  await admin.fill(fieldIn("amount"), "99,90");
  await admin.selectOption(fieldIn("category_id"), { label: "Ferramentas e assinaturas" });
  await admin.check(fieldIn("paid_now"));
  await admin.dblclick("#fin-modal [type=submit]");
  await admin.waitForSelector('.fin-row:has-text("Assinatura de software")');
  await admin.waitForTimeout(400);
  assert.equal(fake.finance.entries.filter((e) => e.description === "Assinatura de software").length, 1, "um lançamento só");
  assert.equal(fake.finance.settlements.length, 1, "um pagamento só");
  assert.match(await admin.textContent('.fin-row:has-text("Assinatura de software")'), /Pago/);
});

await step("Mesmo envio repetido direto na API: o banco recusa (23505)", async () => {
  const e = fake.finance.entries[0];
  const again = await callAs(admin, "fin_entries", { method: "POST", body: JSON.stringify({ direction: "receita", description: "Cópia", amount_cents: 100, category_id: e.category_id, competence_date: e.competence_date, due_date: e.due_date, request_id: e.request_id }) });
  assert.equal(again.status, 409);
  assert.match(again.body, /23505/);
});

await step("Recebimento parcial: status muda, falta o resto; passar do saldo é recusado", async () => {
  await admin.click('.fin-row:has-text("Mensalidade Padaria")');
  await admin.waitForSelector('#fin-drawer[open] [data-fin-settle]');
  await admin.click("[data-fin-settle]");
  await admin.waitForSelector("#fin-modal[open]");
  assert.equal(await admin.inputValue(fieldIn("amount")), "1.500,10", "sugere o que falta");
  await admin.fill(fieldIn("amount"), "1.500,11");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal .field__error");
  assert.match(await admin.textContent("#fin-modal .field__error"), /não pode passar/);
  await admin.fill(fieldIn("amount"), "500,00");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal:not([open])", { state: "attached" });
  await admin.waitForFunction(() => /Falta\s*R\$ 1\.000,10/.test(document.querySelector("#fin-body .fin-money")?.textContent || ""));
  assert.match(await admin.textContent("#fin-badges"), /Recebido em parte/);
  assert.equal(await admin.locator("[data-fin-cancel]").count(), 0, "com recebimento ativo não dá para cancelar");
  await shot(admin, "fin-detalhe");
});

await step("Estorno pede motivo, volta o valor e fica no histórico; depois o lançamento pode ser cancelado", async () => {
  await admin.click("[data-fin-void]");
  await admin.waitForSelector("#fin-modal[open]");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal .field__error");
  await admin.fill(fieldIn("reason"), "Registrado em duplicidade");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal:not([open])", { state: "attached" });
  await admin.waitForSelector("#fin-body .fin-settlements li.is-void");
  assert.match(await admin.textContent("#fin-body .fin-money"), /Falta\s*R\$ 1\.500,10/);
  await admin.click("[data-fin-history-toggle] summary");
  await admin.waitForFunction(() => /estornou/.test(document.querySelector("[data-fin-audit]")?.textContent || ""));
  assert.match(await admin.textContent("[data-fin-audit]"), /Bruna Admin/);
  await admin.click("[data-fin-cancel]");
  await admin.fill(fieldIn("reason"), "Cliente pausou o contrato");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForFunction(() => /Cancelado/.test(document.querySelector("#fin-badges")?.textContent || ""));
  assert.equal(await admin.locator("#fin-body [data-fin-edit]").count(), 0, "cancelado não se edita");
  assert.equal(fake.finance.entries.length, 2, "nada foi apagado");
  await admin.click('#fin-drawer [data-action="close-drawer"]');
  await admin.waitForSelector("#fin-drawer:not([open])", { state: "attached" });
  assert.doesNotMatch(await admin.textContent(".fin-sum--in"), /1\.500,10/, "cancelado sai dos totais");
});

await step("Filtros pelo endereço sobrevivem ao recarregar; filtro inválido é ignorado", async () => {
  await admin.selectOption('#fin-filters [name="direction"]', "despesa");
  await admin.waitForFunction(() => location.hash.includes("direction=despesa"));
  await admin.reload();
  await admin.waitForSelector('#fin-list[aria-busy="false"]');
  assert.equal(await admin.inputValue('#fin-filters [name="direction"]'), "despesa");
  assert.equal(await admin.locator('.fin-row:has-text("Mensalidade")').count(), 0);
  await admin.goto(`${ORIGIN}/admin/#/financeiro?status=<x>&category_id=1%20or%201`);
  await admin.waitForSelector('#fin-list[aria-busy="false"]');
  assert.equal(await admin.inputValue('#fin-filters [name="status"]'), "");
  await admin.evaluate(() => { location.hash = "#/financeiro"; });
  await admin.waitForTimeout(300);
});

await step("Contas: saldo pela movimentação; administrador informa o saldo inicial", async () => {
  await goFinance(admin);
  await admin.click('[data-fin-tab="contas"]');
  await admin.waitForSelector(".fin-account");
  assert.match(await admin.textContent(".fin-account"), /-R\$ 99,90/);
  assert.match(await admin.textContent(".fin-account"), /Saldo inicial não informado/);
  await admin.click("[data-fin-account-edit]");
  await admin.fill(fieldIn("opening_balance"), "2.000,00");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForSelector("#fin-modal .field__error");
  await admin.fill(fieldIn("opening_date"), "2026-01-01");
  await admin.click("#fin-modal [type=submit]");
  await admin.waitForFunction(() => /R\$ 1\.900,10/.test(document.querySelector(".fin-account")?.textContent || ""));
  await shot(admin, "fin-contas");
});

const socio = await newPage({ viewport: { width: 1280, height: 820 } }, "socio.teste", "Senha-do-Socio-123", "socio");

await step("Sócio (só consulta): vê o menu, a lista e os totais, sem nenhum botão de mudar", async () => {
  assert.equal(await socio.isVisible('.admin-nav [data-route="financeiro"]'), true);
  await goFinance(socio);
  await socio.waitForSelector('.fin-row:has-text("Assinatura de software")');
  assert.equal(await socio.isVisible('[data-fin-new="receita"]'), false);
  assert.equal(await socio.isVisible("[data-fin-readonly]"), true);
  assert.equal(await socio.isVisible('[data-fin-tab="categorias"]'), false);
  await socio.click('.fin-row:has-text("Assinatura de software")');
  await socio.waitForSelector("#fin-drawer[open] .fin-money");
  assert.equal(await socio.locator("#fin-body [data-fin-settle], #fin-body [data-fin-edit], #fin-body [data-fin-cancel], #fin-body [data-fin-void]").count(), 0);
  await socio.click('#fin-drawer [data-action="close-drawer"]');
  await socio.click('[data-fin-tab="contas"]');
  await socio.waitForSelector(".fin-account");
  assert.equal(await socio.locator("[data-fin-account-edit]").count(), 0);
  assert.equal(await socio.isVisible("[data-fin-history]"), false);
});

await step("Sócio pulando a tela: o banco recusa criar, alterar, estornar e apagar", async () => {
  const e = fake.finance.entries[1];
  const s = fake.finance.settlements[0];
  const created = await callAs(socio, "fin_entries", { method: "POST", body: JSON.stringify({ direction: "despesa", description: "x", amount_cents: 100, category_id: e.category_id, competence_date: e.competence_date, due_date: e.due_date, request_id: crypto.randomUUID() }) });
  assert.ok(created.status >= 400, `criar: ${created.status}`);
  const changed = await callAs(socio, `fin_entries?id=eq.${e.id}`, { method: "PATCH", body: JSON.stringify({ description: "mexi" }) });
  assert.ok(changed.status >= 400 || changed.body === "[]", `alterar: ${changed.status} ${changed.body}`);
  const voided = await callAs(socio, `fin_settlements?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ voided_at: new Date().toISOString(), void_reason: "x" }) });
  assert.ok(voided.status >= 400 || voided.body === "[]", `estornar: ${voided.status}`);
  const removed = await callAs(socio, `fin_entries?id=eq.${e.id}`, { method: "DELETE" });
  assert.ok(removed.status >= 400, `apagar: ${removed.status}`);
  const self = await callAs(socio, "agency_members?user_id=eq.qualquer", { method: "PATCH", body: JSON.stringify({ finance_access: "ver" }) });
  assert.ok(self.status >= 400 || self.body === "[]", "não muda acesso de ninguém");
  assert.equal(e.description, "Assinatura de software");
  assert.equal(s.voided_at, null);
});

const ana = await newPage({ viewport: { width: 1280, height: 820 } }, "ana.design", "Senha-da-Ana-123", "ana");

await step("Sem acesso: menu escondido, endereço direto cai no Início e o banco não entrega nada", async () => {
  assert.equal(await ana.isVisible('.admin-nav [data-route="financeiro"]'), false);
  await ana.evaluate(() => { location.hash = "#/financeiro"; });
  await ana.waitForFunction(() => location.hash === "#/inicio");
  for (const table of ["fin_entries_view", "fin_entries", "fin_settlements", "fin_account_balances", "fin_accounts", "fin_audit", "fin_settings"]) {
    const r = await callAs(ana, `${table}?select=*`);
    assert.equal(r.body, "[]", `${table}: ${r.body.slice(0, 80)}`);
  }
  await ana.keyboard.press("Control+k");
  await ana.waitForSelector("#search-modal[open]");
  assert.doesNotMatch(await ana.textContent("#search-modal [data-search-results]"), /Financeiro/, "busca não oferece a seção");
  await ana.keyboard.press("Escape");
});

await step("Equipe: administrador libera a consulta do financeiro para a Ana (e o banco passa a entregar)", async () => {
  await admin.evaluate(() => { location.hash = "#/equipe"; });
  await admin.waitForSelector('.member-card:has-text("Sócio Teste")');
  assert.match(await admin.textContent('.member-card:has-text("Sócio Teste")'), /consulta o financeiro/);
  await admin.click('.member-card:has-text("Ana Designer") [data-member-edit]');
  await admin.waitForSelector("#member-modal[open]");
  assert.equal(await admin.isChecked('#member-modal [name="finance_access"][value="nenhum"]'), true);
  await admin.check('#member-modal [name="finance_access"][value="ver"]');
  await admin.click("#member-modal [type=submit]");
  await admin.waitForSelector('.member-card:has-text("Ana Designer"):has-text("consulta o financeiro")');
  const r = await callAs(ana, "fin_entries_view?select=id");
  assert.equal(JSON.parse(r.body).length, 2);
  // Ao virar administrador, o seletor some (administrador sempre gerencia)
  await admin.click('.member-card:has-text("Ana Designer") [data-member-edit]');
  await admin.check('#member-modal [name="role"][value="admin"]');
  assert.equal(await admin.isVisible('#member-modal [name="finance_access"]'), false);
  await admin.click('#member-modal [data-action="close-modal"] >> nth=-1');
});

await step("Celular: lista legível, filtros recolhidos e nada rola para o lado", async () => {
  const phone = await newPage({ ...devices["iPhone 13"] }, "admdg-teste", "Senha-de-teste-123", "celular");
  await goFinance(phone);
  await phone.waitForSelector(".fin-row");
  assert.equal(await phone.isVisible("#fin-filters"), false, "filtros recolhidos");
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(wide <= 0, `rolagem lateral: ${wide}px`);
  await shot(phone, "fin-celular");
  await phone.click(".fin-row >> nth=0");
  await phone.waitForSelector("#fin-drawer[open] .fin-money");
  const wide2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(wide2 <= 0, `rolagem lateral no detalhe: ${wide2}px`);
});

await step("Tudo ficou na trilha de auditoria, com quem fez", async () => {
  const actions = fake.finance.audit.map((a) => `${a.table_name}:${a.action}`);
  for (const want of ["fin_entries:criou", "fin_settlements:criou", "fin_settlements:estornou", "fin_entries:cancelou", "fin_accounts:alterou"]) assert.ok(actions.includes(want), want);
  assert.ok(fake.finance.audit.every((a) => a.actor_name === "Bruna Admin"));
  assert.equal(today.length, 10);
});

await step("Sem erros no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
