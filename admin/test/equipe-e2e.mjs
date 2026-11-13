/* Teste de ponta a ponta: equipe, perfis e tarefas (etapa 2).
   O administrador cria um colaborador limitado a um cliente, atribui uma
   demanda com prazo e prioridade; o colaborador entra, vê "Minhas demandas",
   não enxerga o outro cliente nem as áreas de administrador, e o servidor
   (Supabase de mentira com as regras do banco) recusa o que ele não pode.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/equipe-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5641;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const later = new Date(); later.setDate(later.getDate() + 20);

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe DG" });
const make = (client, title, extra = {}) => store.createContent(validateContent({ client_id: client.id, title, scheduled_date: iso(later), network: "instagram", format: "post", ...extra }).value);
const segredo = await make(estudio, "Ensaio secreto do estúdio");
const outra = await make(padaria, "Post sem responsável");
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
let admin = null;
let colab = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) {
      const name = label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      await admin?.screenshot({ path: `${SHOTS}/falha-admin-${name}.png` }).catch(() => {});
      await colab?.screenshot({ path: `${SHOTS}/falha-colab-${name}.png` }).catch(() => {});
    }
  }
  console.log(results.at(-1));
};

const browser = await chromium.launch();
const consoleErrors = [];
async function newContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...options });
  // Estes testes usam a lista de conteúdos (o calendário tem o próprio teste: calendario-e2e)
  await context.addInitScript(() => { try { if (!localStorage.getItem("dg-painel-conteudos-modo")) localStorage.setItem("dg-painel-conteudos-modo", "lista"); } catch { /* sem armazenamento */ } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    if (answer === "abort") return route.abort("failed");
    return route.fulfill(answer);
  });
  return context;
}
const watch = (page, name) => {
  page.setDefaultTimeout(8000);
  page.on("console", (m) => {
    // 4xx esperados nos testes de permissão do servidor
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
};
const shot = async (page, name, opts = {}) => { if (!SHOTS) return; await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }); };
const toastSays = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source);
const signIn = async (page, username, password) => {
  await page.fill('#login-form [name="username"]', username);
  await page.fill('#login-form [name="password"]', password);
  await page.click("#login-form [type=submit]");
};
const visibleNav = (page) => page.$$eval(".admin-nav [data-route]", (links) => links.filter((a) => !a.hidden && a.offsetParent !== null).map((a) => a.dataset.route));
/** Pedido direto à API do banco com o token do colaborador (sem passar pela tela) */
const direct = (page, method, pathAndQuery, body) => page.evaluate(async ({ url, key, method, pathAndQuery, body }) => {
  const session = JSON.parse(localStorage.getItem("dg-painel-sessao"));
  const response = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, method, pathAndQuery, body });

const adminContext = await newContext();
admin = await adminContext.newPage();
watch(admin, "admin");
let password = "";
let anaId = "";
let tarefaId = "";

/* ============================== Testes ============================== */

await step("Administrador vê a área Equipe com o próprio cartão", async () => {
  await admin.goto(`${ORIGIN}/admin/#/equipe`);
  await signIn(admin, "admdg-teste", "Senha-de-teste-123");
  await admin.waitForSelector("#app:not([hidden])");
  await admin.waitForSelector("#team-list .member-card");
  assert.match(await admin.textContent("#team-list"), /Equipe DG.*\(você\).*Administrador/s);
  const nav = await visibleNav(admin);
  for (const r of ["conteudos", "demandas", "clientes", "equipe", "aprovacoes"]) assert.ok(nav.includes(r), `menu do admin tem ${r}`);
  assert.equal(await admin.locator("#team-list [data-member-active]").count(), 0, "não desativa a si mesmo");
});

await step("Criar colaborador: valida, cria login e mostra usuário e senha", async () => {
  await admin.click('[data-action="new-member"]');
  await admin.waitForSelector("#member-modal[open]");
  await admin.click("#member-modal [type=submit]");
  await admin.waitForSelector("#member-modal .field__error");
  await admin.fill('#member-modal [name="name"]', "Ana Designer");
  await admin.fill('#member-modal [name="job_title"]', "Designer");
  await admin.fill('#member-modal [name="username"]', "ana.design");
  assert.ok((await admin.inputValue('#member-modal [name="password"]')).length >= 10, "senha gerada");
  await admin.check(`#member-modal [name="client_id"][value="${padaria.id}"]`);
  await shot(admin, "eq01-novo-colaborador");
  password = await admin.inputValue('#member-modal [name="password"]');
  await admin.click("#member-modal [type=submit]");
  await admin.waitForSelector("#confirm-modal[open]");
  assert.match(await admin.textContent("#confirm-modal"), /Usuário: ana\.design/);
  assert.ok((await admin.evaluate(() => navigator.clipboard.readText())).includes(password), "copiou a senha");
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await admin.waitForSelector('#team-list .member-card:has-text("Ana Designer")');
  const text = await admin.textContent('#team-list .member-card:has-text("Ana Designer")');
  assert.match(text, /Padaria Central Ltda/);
  assert.match(text, /Edita só as próprias demandas · não envia para aprovação/);
  anaId = await admin.getAttribute('#team-list .member-card:has-text("Ana Designer")', "data-member");
  await shot(admin, "eq02-equipe");
});

await step("Conteúdo com responsável, prazo interno e prioridade", async () => {
  await admin.goto(`${ORIGIN}/admin/#/conteudos`);
  await admin.waitForSelector(".row[data-row]");
  await admin.click('.view__head [data-action="new-content"]');
  await admin.waitForSelector("#content-modal[open]");
  await admin.selectOption('#content-modal [name="client_id"]', estudio.id);
  assert.equal(await admin.locator(`#content-modal [name="assignee"][value="${anaId}"]`).count(), 0, "Ana não aparece para cliente que ela não vê");
  await admin.selectOption('#content-modal [name="client_id"]', padaria.id);
  await admin.fill('#content-modal [name="title"]', "Arte da promoção de pão");
  await admin.fill('#content-modal [name="scheduled_date"]', iso(later));
  await admin.selectOption('#content-modal [name="network"]', "instagram");
  await admin.selectOption('#content-modal [name="format"]', "post");
  await admin.check(`#content-modal [name="assignee"][value="${anaId}"]`);
  await admin.fill('#content-modal [name="due_date"]', iso(tomorrow));
  await admin.selectOption('#content-modal [name="priority"]', "alta");
  await shot(admin, "eq03-form-tarefa");
  await admin.click("#content-modal [type=submit]");
  await admin.waitForSelector("#content-modal", { state: "hidden" });
  const all = await store.listContents({});
  const created = all.find((c) => c.title === "Arte da promoção de pão");
  tarefaId = created.id;
  assert.deepEqual([created.due_date, created.priority, created.assignees], [iso(tomorrow), "alta", [anaId]]);
  await admin.waitForSelector(`.row:has-text("Arte da promoção de pão") .avatar`);
  await shot(admin, "eq04-lista-com-responsavel");
});

const colabContext = await newContext();
colab = await colabContext.newPage();
watch(colab, "colaborador");

await step("Colaborador entra pelo Início e vê Minhas demandas, sem áreas de administrador", async () => {
  await colab.goto(`${ORIGIN}/admin/`);
  await signIn(colab, "ana.design", password);
  await colab.waitForSelector("#app:not([hidden])");
  await colab.waitForSelector(".kpis .kpi__n");
  assert.match(colab.url(), /#\/inicio/);
  assert.match(await colab.textContent(".hcard:has(#h-mine)"), /Arte da promoção de pão/);
  await colab.click('.admin-nav [data-route="demandas"]');
  await colab.waitForSelector("#task-list .task-card");
  const nav = await visibleNav(colab);
  assert.ok(nav.includes("demandas") && nav.includes("conteudos"));
  for (const r of ["clientes", "equipe", "aprovacoes", "importar"]) assert.ok(!nav.includes(r), `menu sem ${r}`);
  assert.match(await colab.textContent("#task-list"), /Hoje e amanhã.*Arte da promoção de pão/s);
  assert.equal((await colab.textContent("[data-my-tasks]")).trim(), "1");
  await shot(colab, "eq05-minhas-demandas");
  await colab.goto(`${ORIGIN}/admin/#/equipe`);
  await colab.waitForTimeout(400);
  assert.doesNotMatch(colab.url(), /#\/equipe/, "rota de admin redireciona");
});

await step("Colaborador vê só o cliente liberado e não exclui nada", async () => {
  await colab.goto(`${ORIGIN}/admin/#/conteudos`);
  await colab.waitForSelector(".row[data-row]");
  const list = await colab.textContent("#contents-list");
  assert.doesNotMatch(list, /Ensaio secreto do estúdio/);
  assert.match(list, /Arte da promoção de pão/);
  assert.equal(await colab.locator(".row [data-delete-content]").count(), 0, "sem excluir");
  assert.equal(await colab.locator(`.row:has-text("Post sem responsável") [data-edit-content]`).count(), 0, "não edita o que não é dele");
  assert.equal(await colab.locator('.view__head [data-action="new-content"]:visible').count(), 0, "não cria conteúdo");
});

await step("Colaborador atualiza a produção da própria demanda", async () => {
  await colab.goto(`${ORIGIN}/admin/#/demandas`);
  await colab.waitForSelector(`[data-task-prod="${tarefaId}"]`);
  await colab.selectOption(`[data-task-prod="${tarefaId}"]`, "em_producao");
  await toastSays(colab, /Produção/);
  assert.equal((await store.getContent(tarefaId)).production_status, "em_producao");
});

await step("No formulário, os status de aprovação ficam travados para quem não envia", async () => {
  await colab.goto(`${ORIGIN}/admin/#/conteudos`);
  await colab.click(`.row:has-text("Arte da promoção de pão") [data-edit-content]`);
  await colab.waitForSelector("#content-modal[open]");
  assert.equal(await colab.isDisabled('#content-modal [name="approval_status"]'), true);
  assert.equal(await colab.isDisabled('#content-modal [name="final_status"]'), true);
  await colab.fill('#content-modal [name="caption"]', "Legenda escrita pela Ana");
  await colab.click("#content-modal [type=submit]");
  await colab.waitForSelector("#content-modal", { state: "hidden" });
  assert.equal((await store.getContent(tarefaId)).caption, "Legenda escrita pela Ana");
});

await step("O servidor recusa o que a tela esconde (outro cliente, excluir, aprovar, se promover)", async () => {
  const clients = await direct(colab, "GET", "clients?select=id,name");
  assert.deepEqual(clients.data.map((c) => c.name), ["Padaria Central Ltda"]);
  const hidden = await direct(colab, "GET", `contents?select=id&id=eq.${segredo.id}`);
  assert.deepEqual(hidden.data, []);
  await direct(colab, "DELETE", `contents?id=eq.${tarefaId}`);
  assert.ok(await store.getContent(tarefaId), "não excluiu");
  const approve = await direct(colab, "PATCH", `contents?id=eq.${tarefaId}`, { approval_status: "aprovado" });
  assert.match(JSON.stringify(approve.data), /sem_permissao_aprovacao/);
  const other = await direct(colab, "PATCH", `contents?id=eq.${outra.id}`, { caption: "invasão" });
  assert.deepEqual(other.data, []);
  assert.notEqual((await store.getContent(outra.id)).caption, "invasão");
  const promote = await direct(colab, "PATCH", `agency_members?user_id=eq.${anaId}`, { role: "admin" });
  assert.deepEqual(promote.data, []);
  const newClient = await direct(colab, "POST", "clients", { name: "Cliente pirata", slug: "pirata" });
  assert.equal(newClient.status, 403);
  const team = await colab.evaluate(async ({ url, key }) => {
    const session = JSON.parse(localStorage.getItem("dg-painel-sessao"));
    const r = await fetch(`${url}/functions/v1/equipe`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "criar", username: "pirata", password: "Senha-Pirata-123", name: "Pirata", role: "admin" }) });
    return r.status;
  }, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });
  assert.equal(team, 403, "função equipe só para administrador");
});

await step("Histórico da demanda mostra quem fez cada mudança", async () => {
  await admin.goto(`${ORIGIN}/admin/#/conteudos`);
  await admin.reload();
  await admin.waitForSelector(`.row [data-view-content="${tarefaId}"]`);
  await admin.click(`.row [data-view-content="${tarefaId}"]`);
  await admin.waitForSelector("#content-drawer .task-box");
  await admin.waitForFunction(() => /Ana Designer/.test(document.querySelector("#content-drawer")?.textContent || "") && /Histórico/.test(document.querySelector("#content-drawer").textContent));
  const text = await admin.textContent("#content-drawer");
  assert.match(text, /Equipe DG/);
  await shot(admin, "eq06-historico");
  await admin.keyboard.press("Escape");
});

await step("Desativar tira a pessoa do painel e bloqueia o login", async () => {
  await admin.goto(`${ORIGIN}/admin/#/equipe`);
  await admin.waitForSelector(`[data-member-active="${anaId}"]`);
  await admin.click(`[data-member-active="${anaId}"]`);
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await toastSays(admin, /desativado/);
  await admin.waitForSelector('#team-list .member-card.is-off:has-text("Ana Designer")');
  await colab.reload();
  await colab.waitForSelector("#login:not([hidden])");
  await signIn(colab, "ana.design", password);
  await colab.waitForSelector("#login .form-error:not([hidden])");
  assert.match(await colab.textContent("#login .form-error"), /desativado/);
  await admin.click(`[data-member-active="${anaId}"]`);
  await toastSays(admin, /pode entrar de novo/);
  await signIn(colab, "ana.design", password);
  await colab.waitForSelector("#app:not([hidden])");
});

await step("Celular: Minhas demandas cabe na tela", async () => {
  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  // Estes testes usam a lista de conteúdos (o calendário tem o próprio teste: calendario-e2e)
  await mobile.addInitScript(() => { try { if (!localStorage.getItem("dg-painel-conteudos-modo")) localStorage.setItem("dg-painel-conteudos-modo", "lista"); } catch { /* sem armazenamento */ } });
  await mobile.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    if (answer === "abort") return route.abort("failed");
    return route.fulfill(answer);
  });
  const phone = await mobile.newPage();
  watch(phone, "celular");
  await phone.goto(`${ORIGIN}/admin/`);
  await signIn(phone, "ana.design", password);
  await phone.waitForSelector(".kpis .kpi__n");
  await phone.click('.admin-nav [data-route="demandas"]');
  await phone.waitForSelector("#task-list .task-card");
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `sem rolagem lateral (${overflow}px)`);
  await shot(phone, "eq07-celular-demandas", { fullPage: true });
  await mobile.close();
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

console.log(`\n${results.filter((r) => r.startsWith("✔")).length} verificações passaram.`);
if (process.exitCode) console.log("Algum teste falhou.");
await browser.close();
server.close();
