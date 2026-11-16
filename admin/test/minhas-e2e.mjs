/* Teste de ponta a ponta: demanda passada pelo quadro aparece NA HORA para o
   responsável, em "Minhas demandas" (e no Início), sem ele recarregar nada.
   Duas pessoas ao mesmo tempo: a administradora cria/delega no quadro e a
   colaboradora, com o painel aberto, vê chegar (pela atualização automática,
   ao voltar para o app e pelo aviso no celular), abre, muda a etapa e conclui.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/minhas-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5701;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Designer" } });
// Um conteúdo do calendário com a Ana (continua aparecendo junto das demandas)
const conteudo = await store.createContent(validateContent({ client_id: padaria.id, title: "Carrossel de pães", scheduled_date: plus(9), network: "instagram", format: "carrossel" }).value);
store.addAssignee(conteudo.id, ana.id, "Bruna Admin", "Ana Designer");

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-minhas-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
  }
  console.log(results.at(-1));
};
const browser = await chromium.launch();
const consoleErrors = [];
async function newPage(options, name) {
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
  return p;
}
const shot = async (p, name, opts = {}) => { if (!SHOTS) return; await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }); };
const toastSays = (p, re, timeout = 8000) => p.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout });
const signIn = async (p, user, pass) => {
  await p.fill('#login-form [name="username"]', user);
  await p.fill('#login-form [name="password"]', pass);
  await p.click("#login-form [type=submit]");
  await p.waitForSelector("#app:not([hidden])");
};
const card = (p, title) => p.locator(`#task-list .task-card:has(.task-card__name:text-is("${title}"))`);
const byTitle = (title) => fake.tasks.all().find((t) => t.title === title);

const bruna = await newPage({ viewport: { width: 1440, height: 1000 } }, "bruna");
const anaPage = await newPage({ viewport: { width: 1280, height: 900 } }, "ana");

await step("Ana deixa Minhas aberta: por enquanto só o conteúdo do calendário", async () => {
  page = anaPage;
  await page.goto(`${ORIGIN}/admin/#/demandas`);
  await signIn(page, "ana.design", "Senha-da-Ana-123");
  await card(page, "Carrossel de pães").waitFor();
  assert.equal(await page.locator("#task-list .task-card--demanda").count(), 0);
});

await step("Bruna cria a demanda no quadro com a Ana de responsável", async () => {
  page = bruna;
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await signIn(page, "admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
  await page.click('#view-gestao [data-action="new-task"]');
  await page.selectOption("[data-task-new] [name=client_id]", padaria.id);
  await page.fill("[data-task-new] [name=title]", "Post do Dia dos Pais");
  await page.fill("[data-task-new] [name=due_date]", plus(1));
  await page.fill("[data-task-new] [name=due_time]", "15:00");
  await page.click("[data-task-new] .pick-person:has-text('Bruna Admin')");   // tira ela mesma
  await page.click(`[data-task-new] .pick-person:has([value="${ana.id}"])`);
  await page.click("[data-task-new] .btn--primary[type=submit]");
  await toastSays(page, /Demanda criada/);
  assert.deepEqual(byTitle("Post do Dia dos Pais").task_assignees.map((a) => a.user_id), [ana.id]);
});

await step("Sem a Ana fazer nada, a demanda aparece em Minhas dela (marcada como Nova) com aviso na tela", async () => {
  page = anaPage;
  // Atualização automática (a cada 20 s), sem recarregar
  await card(page, "Post do Dia dos Pais").waitFor({ timeout: 26000 });
  await toastSays(page, /Bruna Admin te passou uma demanda: Post do Dia dos Pais/);
  const c = card(page, "Post do Dia dos Pais");
  assert.ok(await c.locator(".new-chip").isVisible(), "marcada como Nova");
  assert.match(await c.textContent(), /Padaria Central/);
  assert.match(await c.textContent(), /Amanhã · 15:00/);
  assert.match(await page.textContent('.task-group:has(.task-card__name:text-is("Post do Dia dos Pais")) .task-group__title'), /Hoje e amanhã/);
  assert.ok(await card(page, "Carrossel de pães").isVisible(), "o conteúdo continua junto");
  assert.equal(await page.textContent('[data-route="demandas"] [data-my-tasks]'), "1", "contador do menu");
  await shot(page, "minhas-01-chegou");
});

await step("Subtarefa delegada chega na hora quando o aviso do celular chega", async () => {
  page = bruna;
  await page.click('.tcard:has-text("Post do Dia dos Pais") [data-task-open-card]');
  await page.waitForSelector("#task-drawer[open] [data-subtask-add]");
  await page.fill("[data-subtask-add] [name=title]", "Fotos do pai com o pão");
  await page.selectOption("[data-subtask-add] [name=assignee]", ana.id);
  await page.click("[data-subtask-add] [type=submit]");
  await toastSays(page, /entregue para Ana Designer/);
  page = anaPage;
  // O aviso push chegou no aparelho: o receptor avisa o painel aberto (aqui, simulado)
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "novo-aviso" } })));
  await card(page, "Fotos do pai com o pão").waitFor({ timeout: 4000 });
  assert.match(await card(page, "Fotos do pai com o pão").textContent(), /Padaria Central[^·]*· Subtarefa/);
  assert.match(await card(page, "Fotos do pai com o pão").textContent(), /em "Post do Dia dos Pais"/);
});

await step("Abrir a demanda tira o \"Nova\" e marca o aviso como lido", async () => {
  await card(page, "Post do Dia dos Pais").locator("[data-open-board-task]").click();
  await page.waitForSelector("#task-drawer[open] .task-props");
  assert.equal(await page.inputValue(".task-title"), "Post do Dia dos Pais");
  await page.click('#task-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
  await page.waitForFunction(() => !document.querySelector('#task-list .task-card.is-new .task-card__name')?.textContent?.includes("Dia dos Pais"));
  const t = byTitle("Post do Dia dos Pais");
  assert.ok(store.listNotifications(ana.id).filter((n) => n.task_id === t.id).every((n) => n.read_at), "avisos daquela demanda lidos");
});

await step("Mudar a etapa ali mesmo grava no quadro; concluída sai de Minhas", async () => {
  const t = byTitle("Post do Dia dos Pais");
  await page.selectOption(`[data-task-status="${t.id}"]`, "em_andamento");
  await toastSays(page, /Etapa: Em andamento/);
  assert.equal(byTitle("Post do Dia dos Pais").status, "em_andamento");
  await page.selectOption(`[data-task-status="${t.id}"]`, "concluido");
  await toastSays(page, /concluída/);
  await page.waitForFunction(() => ![...document.querySelectorAll("#task-list .task-card__name")].some((n) => n.textContent === "Post do Dia dos Pais"));
  assert.equal(byTitle("Post do Dia dos Pais").status, "concluido");
  await shot(page, "minhas-02-etapa");
});

await step("Voltar para o app (aba ou ícone) também confere na hora", async () => {
  page = bruna;
  await page.click('#task-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
  await page.fill('[data-quick-add] [name=title] >> nth=0', "Revisar legenda de sábado");
  await page.press('[data-quick-add] [name=title] >> nth=0', "Enter");
  await toastSays(page, /Demanda criada/);
  const t = byTitle("Revisar legenda de sábado");
  await page.click(`.tcard:has-text("Revisar legenda de sábado") [data-task-open-card]`);
  await page.click("[data-task-people-edit]");
  await page.click(`[data-task-people-box] .pick-person:has([value="${ana.id}"])`);
  await page.click("[data-task-people-save]");
  await toastSays(page, /Responsáveis atualizados/);
  assert.ok(byTitle("Revisar legenda de sábado").task_assignees.some((a) => a.user_id === ana.id), t.id);
  page = anaPage;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await card(page, "Revisar legenda de sábado").waitFor({ timeout: 4000 });
  assert.match(await card(page, "Revisar legenda de sábado").textContent(), /Interno da agência/);
});

await step("Início da Ana: Minhas demandas mostra as demandas do quadro e abre no painel", async () => {
  await page.click('.admin-nav [data-route="inicio"]');
  await page.waitForSelector('#home .hcard:has(#h-mine) .hitem');
  const text = await page.textContent("#home .hcard:has(#h-mine)");
  assert.match(text, /Fotos do pai com o pão/);
  assert.match(text, /Carrossel de pães/);
  await page.click('#home .hcard:has(#h-mine) [data-open-home-task]:has-text("Fotos do pai com o pão")');
  await page.waitForSelector("#task-drawer[open] .task-props");
  assert.equal(await page.inputValue(".task-title"), "Fotos do pai com o pão");
});

await step("Celular: Minhas com demandas e conteúdos cabe na tela", async () => {
  page = await newPage({ ...devices["iPhone 13"] }, "ana-celular");
  await page.goto(`${ORIGIN}/admin/#/demandas`);
  await signIn(page, "ana.design", "Senha-da-Ana-123");
  await card(page, "Fotos do pai com o pão").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `a página passou ${overflow}px da tela`);
  await shot(page, "minhas-03-celular");
});

await step("Sem erros no console", async () => {
  assert.deepEqual(consoleErrors, []);
});

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
