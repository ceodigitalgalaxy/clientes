/* Teste de ponta a ponta: Etapa 4 — Início (centro de controle), menu "⋯",
   comentários com @menção e avisos (sininho), no computador e no celular.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/inicio-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5661;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = plus(0);

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
const admin = fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Designer" } });
const make = (client, title, date, extra = {}) => store.createContent(validateContent({ client_id: client.id, title, scheduled_date: date, scheduled_time: "10:00", network: "instagram", format: "post", ...extra }).value);
const atrasado = await make(padaria, "Post atrasado da padaria", plus(-2));
const amanha = await make(padaria, "Stories de amanhã", plus(1), { status: "em_producao" });
await make(estudio, "Ensaio aguardando o cliente", plus(10), { status: "aguardando_aprovacao" });
await make(estudio, "Bastidores em produção", plus(12), { status: "em_producao" });
await make(padaria, "Publicado esta semana", TODAY, { status: "publicado" });
// A Ana recebe uma demanda (o gatilho avisa)
store.addAssignee(amanha.id, ana.id, "Bruna Admin", "Ana Designer", admin.id);

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-inicio-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
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
const shot = async (name, opts = {}) => { if (!SHOTS) return; await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }); };
const toastSays = (re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source);
const signIn = async (user, pass) => {
  await page.fill('#login-form [name="username"]', user);
  await page.fill('#login-form [name="password"]', pass);
  await page.click("#login-form [type=submit]");
  await page.waitForSelector("#app:not([hidden])");
};
const kpi = (label) => page.$eval(`.kpi:has(.kpi__label:text-is("${label}")) .kpi__n`, (n) => Number(n.textContent));

/* ============================== Administrador ============================== */
page = await newPage({ viewport: { width: 1440, height: 1000 } }, "admin");

await step("Entrar abre o Início com indicadores e cartões", async () => {
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector(".kpis .kpi__n");
  assert.match(page.url(), /#\/inicio/);
  assert.equal(await page.textContent("#inicio-title"), "Olá, Bruna");
  assert.equal(await kpi("Atrasada"), 1);
  assert.equal(await kpi("Vencem logo"), 1);
  assert.equal(await kpi("Com o cliente"), 1);
  assert.equal(await kpi("Em produção"), 2);
  assert.equal(await kpi("Publicados"), 1);
  assert.match(await page.textContent(".hcard:has(#h-att)"), /Atrasado 2 dias.*Post atrasado da padaria/s);
  assert.match(await page.textContent(".hcard:has(#h-next)"), /Stories de amanhã/);
  assert.match(await page.textContent(".hcard:has(#h-activity)"), /Ana Designer virou responsável/);
  await shot("in01-inicio");
});

await step("Indicador leva para onde se resolve (Em produção → quadro)", async () => {
  await page.click('.kpi:has(.kpi__label:text-is("Em produção"))');
  await page.waitForSelector(".kboard");
  assert.match(page.url(), /#\/conteudos/);
  await page.click('.admin-nav [data-route="inicio"]');
  await page.waitForSelector(".kpis .kpi__n");
});

await step("Menu ⋯ na lista: ações secundárias e exclusão que explica o impacto", async () => {
  await page.goto(`${ORIGIN}/admin/#/conteudos`);
  await page.waitForSelector(".seg");
  await page.click('[data-cal-mode="lista"]');
  await page.waitForSelector(".row[data-row]");
  const row = `.row:has-text("Stories de amanhã")`;
  await page.click(`${row} [data-menu-toggle]`);
  await page.waitForSelector(`${row} .menu:not([hidden])`);
  assert.deepEqual(await page.$$eval(`${row} .menu [role=menuitem]`, (b) => b.map((x) => x.textContent.trim())), ["Ver detalhes", "Editar", "Excluir"]);
  await shot("in02-menu");
  await page.keyboard.press("Escape");
  await page.waitForSelector(`${row} .menu`, { state: "hidden" });
  await page.click(`${row} [data-menu-toggle]`);
  await page.click(`${row} .menu [data-delete-content]`);
  await page.waitForSelector("#confirm-modal[open]");
  assert.match(await page.textContent("#confirm-modal"), /junto com os responsáveis, os comentários e o histórico da demanda\..*Não dá para desfazer/s);
  await page.click('#confirm-modal [data-confirm="cancel"]');
  assert.ok(await store.getContent(amanha.id), "cancelar mantém");
});

await step("Comentário com @menção avisa a pessoa", async () => {
  await page.click(`.row [data-view-content="${amanha.id}"]`);
  await page.waitForSelector("#content-drawer [data-comment-form]");
  const area = "#content-drawer [data-comment-form] textarea";
  await page.click(area);
  await page.keyboard.type("Oi @An");
  await page.waitForSelector(".mention-list:not([hidden]) .mention-option");
  assert.match(await page.textContent(".mention-list"), /Ana Designer/);
  await page.keyboard.press("Enter");
  await page.keyboard.type("pode trocar a cor do fundo?");
  assert.equal(await page.inputValue(area), "Oi @Ana Designer pode trocar a cor do fundo?");
  await page.click("#content-drawer [data-comment-form] [type=submit]");
  await toastSays(/1 pessoa avisada/);
  await page.waitForSelector("#content-drawer .comment .mention");
  assert.match(await page.textContent("#content-drawer .comments__list"), /Bruna Admin.*Oi @Ana Designer pode trocar a cor do fundo\?/s);
  await shot("in03-comentario");
  await page.keyboard.press("Escape");
});

await step("Cliente pede ajuste: quem é responsável recebe aviso", async () => {
  // Decisão do cliente pelo link público (mesmo caminho do banco: muda o status de aprovação)
  store.setContentApproval(amanha.id, "ajustes", "planejamento");
  assert.ok(store.listNotifications(ana.id).some((n) => n.kind === "ajuste"));
});

/* ============================== Colaboradora ============================== */
page = await newPage({ viewport: { width: 1440, height: 1000 } }, "ana");

await step("Sininho da Ana: atribuição, menção e ajuste", async () => {
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("ana.design", "Senha-da-Ana-123");
  await page.waitForSelector("[data-inbox-count]:not([hidden])");
  assert.equal((await page.textContent("[data-inbox-count]")).trim(), "3");
  await page.click('[data-action="toggle-inbox"]');
  await page.waitForSelector("#inbox:not([hidden]) .inbox__item");
  const text = await page.textContent("#inbox");
  assert.match(text, /O cliente pediu ajuste.*Bruna Admin te mencionou.*pode trocar a cor do fundo.*Bruna Admin te colocou como responsável/s);
  await shot("in04-avisos");
  await page.click("#inbox .inbox__item >> nth=1");
  await page.waitForSelector("#content-drawer[open]");
  await page.waitForSelector("#content-drawer .comment");
  assert.equal((await page.textContent("[data-inbox-count]")).trim(), "2");
  await page.keyboard.press("Escape");
  await page.click('[data-action="toggle-inbox"]');
  await page.click("[data-inbox-all]");
  await page.waitForSelector("[data-inbox-count]", { state: "hidden" });
  assert.equal(store.listNotifications(ana.id).filter((n) => !n.read_at).length, 0);
});

await step("Ana só vê o cliente dela no Início e não menciona quem não enxerga o cliente", async () => {
  await page.click('.admin-nav [data-route="inicio"]');
  await page.waitForSelector(".kpis .kpi__n");
  assert.equal(await kpi("Com o cliente"), 0, "o do Estúdio não aparece");
  assert.match(await page.textContent(".hcard:has(#h-mine)"), /Stories de amanhã/);
  // Pelo servidor: menção a quem não vê o cliente é descartada; aviso de outra pessoa não aparece
  const res = await page.evaluate(async ({ url, key, contentId, adminId }) => {
    const s = JSON.parse(localStorage.getItem("dg-painel-sessao"));
    const h = { apikey: key, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" };
    const post = await fetch(`${url}/rest/v1/content_comments?select=id,mentions`, { method: "POST", headers: h, body: JSON.stringify({ content_id: contentId, body: "teste", mentions: [adminId, "00000000-0000-4000-8000-000000000000"] }) });
    const notes = await fetch(`${url}/rest/v1/notifications?select=id,kind`, { headers: h });
    return { status: post.status, row: await post.json(), notes: await notes.json() };
  }, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, contentId: amanha.id, adminId: admin.id });
  assert.equal(res.status, 201);
  assert.deepEqual(res.row[0].mentions, [admin.id], "só quem enxerga o cliente fica na menção");
  assert.ok(res.notes.every((n) => n.kind), "lê só os próprios avisos");
  assert.ok(store.listNotifications(admin.id).some((n) => n.kind === "mencao"), "a administradora foi avisada");
});

/* ============================== Celular ============================== */
page = await newPage({ ...devices["iPhone 13"] }, "celular");

await step("Celular: Início cabe na tela, indicadores deslizam e o sininho abre", async () => {
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector(".kpis .kpi__n");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `sem rolagem lateral (${overflow}px)`);
  const visible = await page.$$eval(".admin-nav .admin-nav__link", (l) => l.filter((a) => a.offsetParent !== null).map((a) => a.textContent.trim().replace(/\d+$/, "")));
  assert.deepEqual(visible, ["Início", "Demandas", "Conteúdos", "Aprovações", "Mais"]);
  await shot("in05-celular-inicio", { fullPage: true });
  await page.click('[data-action="toggle-inbox"]');
  await page.waitForSelector("#inbox:not([hidden])");
  await shot("in06-celular-avisos");
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));
console.log(`\n${results.filter((r) => r.startsWith("✔")).length} verificações passaram.`);
if (process.exitCode) console.log("Algum teste falhou.");
await browser.close();
server.close();
