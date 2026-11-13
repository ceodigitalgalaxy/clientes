/* Teste de ponta a ponta: calendário editorial da aba Conteúdos e o painel no celular.
   Mês, semana, dia e lista; cores de alerta; cor do cliente; arrastar para
   mudar a data; criar no dia; no celular: menu embaixo com "Mais", filtros
   recolhidos, botão flutuante, mês com pontinhos e a agenda do dia tocado.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/calendario-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";
import { alertTone } from "../../site/admin/js/domain/deadlines.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5651;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const TODAY = iso(today);
const MONTH = TODAY.slice(0, 7);
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
// Dias dentro do mês atual (o calendário abre no mês de hoje)
const inMonth = (day) => `${MONTH}-${pad(day)}`;
const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
const busyDay = today.getDate() <= 20 ? inMonth(Math.min(today.getDate() + 6, last)) : inMonth(3);
const freeDay = today.getDate() <= 20 ? inMonth(Math.min(today.getDate() + 8, last)) : inMonth(5);

/* ---- Regras das cores (sem navegador) ---- */
const tone = (c) => alertTone(c, "2026-11-13");
assert.equal(tone({ scheduled_date: "2026-11-30", production_status: "publicado" }), "concluido");
assert.equal(tone({ scheduled_date: "2026-11-10" }), "urgente", "atrasado");
assert.equal(tone({ scheduled_date: "2026-11-30", due_date: "2026-11-14" }), "urgente", "prazo interno amanhã e não aprovado");
assert.equal(tone({ scheduled_date: "2026-11-14", final_status: "aprovado" }), "atencao", "amanhã mas aprovado: só atenção");
assert.equal(tone({ scheduled_date: "2026-11-30", approval_status: "aguardando_aprovacao" }), "cliente");
assert.equal(tone({ scheduled_date: "2026-11-16" }), "atencao", "até 3 dias");
assert.equal(tone({ scheduled_date: "2026-11-30", production_status: "em_producao" }), "producao");
assert.equal(tone({ scheduled_date: "2026-11-30" }), "nao_iniciado");
console.log("✔ Cores de alerta (regra)");

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe Digital Galaxy" });
const make = (client, title, date, extra = {}) => store.createContent(validateContent({ client_id: client.id, title, scheduled_date: date, scheduled_time: "10:00", network: "instagram", format: "post", ...extra }).value);
const mover = await make(padaria, "Agenda de pães", busyDay, { status: "em_producao" });
await make(padaria, "Carrossel de receitas", busyDay, { format: "carrossel", status: "aguardando_aprovacao" });
await make(estudio, "Ensaio de fim de ano", busyDay, { format: "reels" });
await make(estudio, "Bastidores do estúdio", busyDay);
await make(padaria, "Publicado ontem", plus(-1) .slice(0, 7) === MONTH ? plus(-1) : TODAY, { status: "publicado" });

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-cal-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
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
const signIn = async () => {
  await page.fill('#login-form [name="username"]', "admdg-teste");
  await page.fill('#login-form [name="password"]', "Senha-de-teste-123");
  await page.click("#login-form [type=submit]");
  await page.waitForSelector("#app:not([hidden])");
};
const cell = (date) => `.acal__cell[data-cal-day="${date}"]`;

/* ============================== Computador ============================== */
page = await newPage({ viewport: { width: 1440, height: 1000 } }, "computador");

await step("Conteúdos abre no calendário do mês, com cores e legenda", async () => {
  await page.goto(`${ORIGIN}/admin/#/conteudos`);
  await signIn();
  await page.waitForSelector(".acal--month .acal-item");
  assert.equal(await page.getAttribute('[data-cal-mode="mes"]', "aria-pressed"), "true");
  assert.equal(await page.isVisible("#contents-list"), false, "lista escondida");
  assert.equal(await page.isVisible('#filters [name="from"]'), false, "período vem do calendário");
  assert.equal(await page.locator(`${cell(busyDay)} .acal-item`).count(), 3, "até 3 etiquetas por dia");
  assert.match(await page.textContent(`${cell(busyDay)} .acal__more`), /\+1 conteúdo/);
  assert.equal(await page.locator(`${cell(busyDay)} .acal-item.tone--cliente`).count(), 1, "aguardando cliente em roxo");
  assert.equal(new Set(await page.$$eval(`${cell(busyDay)} .acal-item .cli-dot`, (d) => d.map((x) => x.className))).size, 2, "duas cores de cliente");
  assert.equal(await page.locator(".tone-legend li").count(), 6);
  assert.ok(await page.locator(".acal__cell.is-today").count() === 1);
  await shot("cal01-mes");
});

await step("Clicar na etiqueta abre o conteúdo", async () => {
  await page.click(`${cell(busyDay)} .acal-item >> nth=0`);
  await page.waitForSelector("#content-drawer[open]");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#content-drawer", { state: "hidden" });
});

await step("Arrastar para outro dia muda a data (e salva)", async () => {
  // Arrasto de verdade com o mouse (como a pessoa faz)
  const from = await page.locator(`[data-drag="${mover.id}"]`).boundingBox();
  const to = await page.locator(cell(freeDay)).boundingBox();
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await toastSays(/Agenda de pães.*foi para/);
  assert.equal((await store.getContent(mover.id)).scheduled_date, freeDay);
  await page.waitForSelector(`${cell(freeDay)} [data-drag="${mover.id}"]`);
});

await step("+N abre o dia; semana mostra tudo; o modo fica guardado", async () => {
  await page.click(`${cell(busyDay)} .acal__date`);
  await page.waitForSelector(".agenda--day .agenda-card");
  assert.equal(await page.getAttribute('[data-cal-mode="dia"]', "aria-pressed"), "true");
  assert.equal(await page.locator(".agenda--day .agenda-card").count(), 3);
  await shot("cal02-dia");
  await page.click('[data-cal-mode="semana"]');
  await page.waitForSelector(".acal--week");
  assert.ok(await page.locator(".acal--week .acal-item--detailed").count() >= 3);
  await shot("cal03-semana");
  await page.reload();
  await page.waitForSelector(".acal--week");
  await page.click('[data-cal-mode="mes"]');
  await page.waitForSelector(".acal--month");
});

await step("Navegar meses e voltar para hoje", async () => {
  const title = await page.textContent("#cal-title");
  await page.click('[data-cal-step="1"]');
  await page.waitForFunction((t) => document.querySelector("#cal-title").textContent !== t, title);
  await page.click("[data-cal-today]");
  await page.waitForFunction((t) => document.querySelector("#cal-title").textContent === t, title);
});

await step("Criar no dia: o formulário já vem com a data", async () => {
  await page.hover(cell(freeDay));
  await page.click(`${cell(freeDay)} [data-cal-new]`);
  await page.waitForSelector("#content-modal[open]");
  assert.equal(await page.inputValue('#content-modal [name="scheduled_date"]'), freeDay);
  await page.click('#content-modal [data-action="close-modal"]');
});

await step("Lista continua disponível (com seleção em massa)", async () => {
  await page.click('[data-cal-mode="lista"]');
  await page.waitForSelector(".row[data-row]");
  assert.equal(await page.isVisible('#filters [name="from"]'), true);
  assert.equal(await page.isVisible("#contents-calendar"), false);
  await page.click('[data-cal-mode="mes"]');
  await page.waitForSelector(".acal--month");
});

/* ============================== Celular ============================== */
page = await newPage({ ...devices["iPhone 13"] }, "celular");

await step("Celular: menu embaixo com 'Mais', topo enxuto e botão flutuante", async () => {
  await page.goto(`${ORIGIN}/admin/#/conteudos`);
  await signIn();
  await page.waitForSelector(".acal--month");
  const nav = await page.$eval(".admin-nav", (n) => { const r = n.getBoundingClientRect(); return { bottom: Math.round(innerHeight - r.bottom), pos: getComputedStyle(n).position }; });
  assert.equal(nav.pos, "fixed");
  assert.ok(nav.bottom <= 1, "menu colado embaixo");
  const visible = await page.$$eval(".admin-nav .admin-nav__link", (l) => l.filter((a) => a.offsetParent !== null).map((a) => a.textContent.trim()));
  assert.deepEqual(visible.map((t) => t.replace(/\d+$/, "")), ["Demandas", "Conteúdos", "Aprovações", "Anúncios", "Mais"], JSON.stringify(visible));
  assert.equal(await page.isVisible(".admin-bar"), false);
  const fab = await page.$eval('#view-conteudos [data-action="new-content"]', (b) => getComputedStyle(b).position);
  assert.equal(fab, "fixed");
  assert.equal(await page.isVisible("#filters"), false, "filtros recolhidos");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `sem rolagem lateral (${overflow}px)`);
  await shot("cal04-celular-mes");
});

await step("Celular: tocar no dia mostra a agenda dele embaixo", async () => {
  await page.click(`${cell(busyDay)} .acal__date`);
  await page.waitForSelector(".agenda--picked .agenda-card");
  assert.equal(await page.locator(".agenda--picked .agenda-card").count(), 3);
  assert.equal(await page.getAttribute('[data-cal-mode="mes"]', "aria-pressed"), "true", "continua no mês");
  await shot("cal05-celular-agenda", { fullPage: true });
});

await step("Celular: filtros abrem pelo botão e mostram quantos estão ativos", async () => {
  await page.click(".filters-toggle");
  await page.waitForSelector("#filters.is-open");
  await page.selectOption('#filters [name="client_id"]', padaria.id);
  await page.waitForFunction(() => document.querySelector(".filters-toggle__count")?.textContent === "1");
  await shot("cal06-celular-filtros");
  await page.click(".filters-toggle");
  await page.waitForSelector(".acal--month");
  assert.equal(await page.locator(`${cell(busyDay)} .acal__dots .tdot`).count(), 1, "só a Padaria nesse dia");
});

await step("Celular: 'Mais' abre as outras seções", async () => {
  await page.click("[data-nav-more]");
  await page.waitForSelector("#nav-sheet:not([hidden])");
  assert.match(await page.textContent("#nav-sheet"), /Clientes.*Importar.*Equipe/s);
  await shot("cal07-celular-mais", { fullPage: false });
  await page.click('#nav-sheet [data-route="equipe"]');
  await page.waitForSelector("#team-list .member-card");
  assert.equal(await page.isHidden("#nav-sheet"), true);
  assert.match(await page.getAttribute("[data-nav-more]", "class"), /is-current/);
  await page.click('.admin-nav [data-route="conteudos"]');
  await page.waitForSelector(".acal--month");
});

await step("Celular: novo conteúdo abre como folha com os botões fixos embaixo", async () => {
  await page.click('#view-conteudos [data-action="new-content"]');
  await page.waitForSelector("#content-modal[open]");
  await page.waitForTimeout(400);
  const box = await page.$eval("#content-modal", (m) => { const r = m.getBoundingClientRect(); return { w: Math.round(r.width), bottom: Math.round(innerHeight - r.bottom) }; });
  assert.equal(box.w, 390);
  assert.ok(box.bottom <= 1, "folha encostada embaixo");
  const actions = await page.$eval("#content-modal .modal__actions", (a) => { const r = a.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top < innerHeight; });
  assert.ok(actions, "botões visíveis sem rolar");
  await shot("cal08-celular-form");
  await page.click('#content-modal [data-action="close-modal"]');
});

await step("Celular: semana vira agenda dia a dia", async () => {
  await page.click('[data-cal-mode="semana"]');
  await page.waitForSelector(".acal--week");
  const cols = await page.$eval(".acal--week", (n) => getComputedStyle(n).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 1);
  await shot("cal09-celular-semana", { fullPage: true });
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));
console.log(`\n${results.filter((r) => r.startsWith("✔")).length} verificações passaram.`);
if (process.exitCode) console.log("Algum teste falhou.");
await browser.close();
server.close();
