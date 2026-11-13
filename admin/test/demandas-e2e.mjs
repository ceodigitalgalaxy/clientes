/* Teste de ponta a ponta: Gestão de demandas (Etapa E1) — quadro Kanban, card,
   criação rápida, arrastar entre colunas, painel lateral com salvamento
   automático, edição simultânea, filtros, colunas personalizadas, demanda
   criada junto com o conteúdo, sincronia com a aprovação do cliente,
   permissões por cliente (inclusive no "servidor") e celular.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/demandas-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5671;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Designer" } });
const caio = fake.addUser("caio.video", "Senha-do-Caio-123", { name: "Caio Videomaker", profile: { role: "colaborador", all_clients: false, client_ids: [estudio.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Videomaker" } });

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-demandas-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
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
const byTitle = (title) => fake.tasks.all().find((t) => t.title === title);
const colOf = (name) => `.tcol:has(.tcol__name:text-is("${name}"))`;
const cardIn = (col, title) => page.locator(`${colOf(col)} .tcard:has(.tcard__title:text-is("${title}"))`);
const goBoard = async () => {
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
};
/** Pede direto ao "servidor", com o login desta página (prova que a regra está no banco) */
const asPage = (method, path, body) => page.evaluate(async ({ method, path, body, url, key }) => {
  const session = JSON.parse(localStorage.getItem("dg-painel-sessao") || "null");
  const token = session?.access_token;
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.text() };
}, { method, path, body, url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });

/* ============================== Administrador ============================== */
page = await newPage({ viewport: { width: 1440, height: 1000 } }, "admin");

await step("Menu tem Demandas e o quadro abre com as 7 colunas oficiais", async () => {
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.click('.admin-nav [data-route="gestao"]');
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
  const names = await page.$$eval(".tcol__name", (n) => n.map((x) => x.textContent));
  assert.deepEqual(names, ["A fazer", "Em andamento", "Em revisão", "Aguardando outra pessoa", "Aguardando cliente", "Ajustes solicitados", "Concluído"]);
  assert.match(await page.textContent("[data-board-count]"), /^0 demandas/);
});

await step("+ Nova demanda: painel lateral com cliente, responsável, entrega e etiqueta", async () => {
  await page.click('#view-gestao [data-action="new-task"]');
  await page.waitForSelector("#task-drawer[open] [data-task-new]");
  await page.selectOption("[data-task-new] [name=client_id]", padaria.id);
  // Ao escolher o cliente, só aparece quem enxerga esse cliente (o Caio não)
  const names = await page.$$eval("[data-task-new] .pick-person", (n) => n.map((x) => x.textContent.trim()));
  assert.ok(names.some((n) => n.includes("Ana Designer")) && !names.some((n) => n.includes("Caio")), names.join(" | "));
  await page.fill("[data-task-new] [name=title]", "Arte do cardápio de Natal");
  await page.fill("[data-task-new] [name=due_date]", plus(2));
  await page.fill("[data-task-new] [name=due_time]", "15:00");
  await page.click(`[data-task-new] .pick-person:has([value="${ana.id}"])`);
  await page.click('[data-task-new] .pick-label:has-text("Design")');
  await shot("01-nova-demanda");
  await page.click("[data-task-new] .btn--primary[type=submit]");
  await toastSays(/Demanda criada/);
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
  const card = cardIn("A fazer", "Arte do cardápio de Natal");
  await card.waitFor();
  const text = await card.textContent();
  assert.match(text, /Design/);
  assert.match(text, /Padaria Central/);
  assert.ok(text.includes(plus(2).split("-").reverse().slice(0, 2).join("/")), "mostra o dia da entrega");
  const t = byTitle("Arte do cardápio de Natal");
  assert.equal(t.client_id, padaria.id);
  assert.equal(t.status, "a_fazer");
  assert.ok(t.task_assignees.some((a) => a.user_id === ana.id));
  assert.equal(t.task_labels.length, 1);
  assert.equal(new Date(t.due_at).getHours(), 15);
});

await step("Adicionar direto na coluna cria já naquela etapa", async () => {
  await page.fill(`${colOf("Em andamento")} [data-quick-add] [name=title]`, "Roteiro do vídeo institucional");
  await page.press(`${colOf("Em andamento")} [data-quick-add] [name=title]`, "Enter");
  await cardIn("Em andamento", "Roteiro do vídeo institucional").waitFor();
  assert.equal(byTitle("Roteiro do vídeo institucional").status, "em_andamento");
  assert.equal(byTitle("Roteiro do vídeo institucional").client_id, null, "sem filtro de cliente vira interna");
});

await step("Arrastar o card para outra coluna grava a etapa (status oficial)", async () => {
  await cardIn("A fazer", "Arte do cardápio de Natal").dragTo(page.locator(`${colOf("Em revisão")} .tcol__items`));
  await cardIn("Em revisão", "Arte do cardápio de Natal").waitFor();
  await toastSays(/Em revisão/);
  assert.equal(byTitle("Arte do cardápio de Natal").status, "em_revisao");
  assert.equal(await cardIn("A fazer", "Arte do cardápio de Natal").count(), 0);
  await shot("02-quadro");
});

await step("Abrir o card: tudo editável no painel, salva sozinho e registra no histórico", async () => {
  await page.click('.tcard:has-text("Arte do cardápio de Natal") [data-task-open-card]');
  await page.waitForSelector("#task-drawer[open] .task-props");
  await page.selectOption('[data-task-field="priority"]', "urgente");
  await page.waitForSelector('[data-save-state]:text-is("Salvo ✓")');
  assert.equal(byTitle("Arte do cardápio de Natal").priority, "urgente");
  await page.fill('[data-task-field="description"]', "Usar as fotos novas do panetone.");
  await page.locator('[data-task-field="description"]').blur();
  await page.waitForFunction(() => document.querySelector("[data-save-state]")?.textContent === "Salvo ✓");
  await page.waitForFunction(() => /Prioridade: Urgente/.test(document.querySelector("[data-task-history]")?.textContent || ""));
  assert.equal(byTitle("Arte do cardápio de Natal").description, "Usar as fotos novas do panetone.");
  await shot("03-painel-demanda");
});

await step("Edição simultânea: se outra pessoa salvou antes, avisa e recarrega (nada se perde em silêncio)", async () => {
  const t = byTitle("Arte do cardápio de Natal");
  fake.tasks.editAsOther(t.id, { title: "Arte do cardápio de Natal (v2)" });
  await page.selectOption('[data-task-field="priority"]', "alta");
  await toastSays(/Outra pessoa alterou/);
  await page.waitForFunction(() => document.querySelector(".task-title")?.value === "Arte do cardápio de Natal (v2)");
  assert.equal(byTitle("Arte do cardápio de Natal (v2)").priority, "urgente", "a gravação velha não passou por cima");
  // Agora, com a versão nova, a mudança grava
  await page.selectOption('[data-task-field="priority"]', "alta");
  await page.waitForSelector('[data-save-state]:text-is("Salvo ✓")');
  assert.equal(byTitle("Arte do cardápio de Natal (v2)").priority, "alta");
});

await step("Mudar a etapa pelo painel move o card no quadro", async () => {
  const concluido = await page.$eval('[data-task-field="column_id"]', (s) => [...s.options].find((o) => o.textContent === "Concluído").value);
  await page.selectOption('[data-task-field="column_id"]', concluido);
  await page.waitForSelector('[data-save-state]:text-is("Salvo ✓")');
  await page.click('#task-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
  await cardIn("Concluído", "Arte do cardápio de Natal (v2)").waitFor();
  const t = byTitle("Arte do cardápio de Natal (v2)");
  assert.equal(t.status, "concluido");
  assert.ok(t.completed_at);
});

await step("Filtros por cliente e por pessoa", async () => {
  await page.selectOption("#board-bar [name=client]", estudio.id);
  await page.waitForFunction(() => document.querySelectorAll("#tboard .tcard").length === 0);
  assert.match(await page.textContent("[data-board-count]"), /0 demandas com esses filtros/);
  await page.selectOption("#board-bar [name=client]", "interno");
  await page.waitForFunction(() => document.querySelectorAll("#tboard .tcard").length === 1);
  await page.click("#board-bar [data-board-clear]");
  await page.selectOption("#board-bar [name=person]", ana.id);
  await page.waitForFunction(() => document.querySelectorAll("#tboard .tcard").length === 1);
  assert.match(await page.textContent("#tboard .tcard"), /cardápio/);
  await page.click("#board-bar [data-board-clear]");
  await page.waitForFunction(() => document.querySelectorAll("#tboard .tcard").length === 2);
});

await step("Colunas personalizáveis (administrador): renomear mantém a etapa oficial", async () => {
  await page.click('#view-gestao [data-action="board-columns"]');
  await page.waitForSelector("#columns-modal[open] .colrow");
  const row = page.locator('#columns-modal .colrow:has([data-col-field="status"] option[selected][value="em_revisao"])');
  await row.locator('[data-col-field="name"]').fill("Revisão interna");
  await row.locator('[data-col-field="name"]').press("Tab");
  await toastSays(/Coluna salva/);
  await shot("04-colunas");
  // Não dá para apagar a única coluna de uma etapa
  await page.locator('#columns-modal .colrow:has([data-col-field="name"][value="A fazer"]) [data-col-delete]').click();
  await toastSays(/Precisa existir ao menos uma coluna/);
  await page.click('#columns-modal [data-action="close-modal"]');
  await page.waitForSelector("#columns-modal:not([open])", { state: "attached" });
  await page.waitForSelector('.tcol__name:text-is("Revisão interna")');
  assert.equal(fake.tasks.columns.find((c) => c.name === "Revisão interna").status, "em_revisao");
});

await step("Novo conteúdo com \"Criar demanda de produção\" marcado cria a demanda ligada", async () => {
  await page.goto(`${ORIGIN}/admin/#/conteudos`);
  await page.waitForSelector("#view-conteudos:not([hidden])");
  await page.click('#view-conteudos .view__head [data-action="new-content"]');
  await page.waitForSelector("#content-modal[open]");
  assert.equal(await page.isChecked('#content-modal [name="make_task"]'), true, "vem marcado");
  await page.selectOption('#content-modal [name="client_id"]', padaria.id);
  await page.fill('#content-modal [name="title"]', "Reels da fornada de domingo");
  await page.fill('#content-modal [name="scheduled_date"]', plus(5));
  await page.selectOption('#content-modal [name="network"]', "instagram");
  await page.selectOption('#content-modal [name="format"]', "reels");
  await page.click("#content-modal [type=submit]");
  await toastSays(/demanda criada no quadro/);
  const t = byTitle("Reels da fornada de domingo");
  assert.ok(t, "a demanda existe");
  assert.equal(t.client_id, padaria.id);
  assert.ok(t.content_id, "ligada ao conteúdo");
  await goBoard();
  await page.locator('.tcard:has-text("Reels da fornada de domingo") .tcard__flag').waitFor();
});

await step("Cliente pede ajuste no conteúdo → a demanda ligada vai para Ajustes solicitados", async () => {
  const t = byTitle("Reels da fornada de domingo");
  store.setContentApproval(t.content_id, "ajustes");
  assert.equal(byTitle("Reels da fornada de domingo").status, "ajustes");
  await page.reload();
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
  await cardIn("Ajustes solicitados", "Reels da fornada de domingo").waitFor();
});

await step("Arquivar tira do quadro e dá para restaurar", async () => {
  await page.click('.tcard:has-text("Roteiro do vídeo institucional") [data-task-open-card]');
  await page.waitForSelector("#task-drawer[open] .task-props");
  await page.click("#task-tools [data-menu-toggle]");
  await page.click('[data-task-act="archive"]');
  await toastSays(/arquivada/);
  await page.waitForFunction(() => ![...document.querySelectorAll(".tcard__title")].some((n) => n.textContent === "Roteiro do vídeo institucional"));
  assert.ok(byTitle("Roteiro do vídeo institucional").archived_at, "arquivada, não apagada");
});

/* ============================== Colaboradora ============================== */
await step("Colaboradora vê só as demandas dos clientes dela e cria demanda interna", async () => {
  page = await newPage({ viewport: { width: 1280, height: 900 } }, "ana");
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("ana.design", "Senha-da-Ana-123");
  await goBoard();
  const titles = await page.$$eval(".tcard__title", (n) => n.map((x) => x.textContent));
  assert.ok(titles.includes("Arte do cardápio de Natal (v2)"));
  assert.ok(!titles.includes("Roteiro do vídeo institucional"), "a interna de outra pessoa não aparece");
  assert.equal(await page.isVisible('#view-gestao [data-action="board-columns"]'), false, "colunas são do administrador");
  const clients = await page.$$eval("#board-bar [name=client] option", (o) => o.map((x) => x.textContent));
  assert.ok(!clients.includes("Estúdio Luz"));
  await page.keyboard.press("n");
  await page.waitForSelector("#task-drawer[open] [data-task-new]");
  await page.fill("[data-task-new] [name=title]", "Organizar a pasta de referências");
  await page.click("[data-task-new] .btn--primary[type=submit]");
  await cardIn("A fazer", "Organizar a pasta de referências").waitFor();
  assert.equal(byTitle("Organizar a pasta de referências").client_id, null);
});

await step("Servidor recusa: criar para cliente que ela não vê, colocar alguém de fora e mexer em coluna", async () => {
  const forbidden = await asPage("POST", "tasks", { title: "Tentativa", client_id: estudio.id });
  assert.equal(forbidden.status, 403, forbidden.body);
  const t = byTitle("Arte do cardápio de Natal (v2)");
  const outsider = await asPage("POST", "task_assignees", [{ task_id: t.id, user_id: caio.id }]);
  assert.equal(outsider.status, 403, "o Caio não enxerga a Padaria");
  const col = fake.tasks.columns[0];
  const rename = await asPage("PATCH", `board_columns?id=eq.${col.id}`, { name: "Hackeada" });
  assert.equal(JSON.parse(rename.body).length, 0);
  assert.equal(fake.tasks.columns[0].name, "A fazer");
});

await step("Outro colaborador (outro cliente) não vê as demandas da Padaria nem a interna da Ana", async () => {
  page = await newPage({ viewport: { width: 1280, height: 900 } }, "caio");
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("caio.video", "Senha-do-Caio-123");
  await goBoard();
  assert.equal(await page.locator(".tcard").count(), 0);
  const leak = await asPage("GET", "tasks?select=id,title");
  assert.deepEqual(JSON.parse(leak.body), []);
});

/* ============================== Celular ============================== */
await step("Celular: quadro rola de lado dentro dele, sem estourar a página", async () => {
  page = await newPage({ ...devices["iPhone 13"] }, "celular");
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await goBoard();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `a página passou ${overflow}px da tela`);
  const scrolls = await page.$eval("#tboard", (b) => b.scrollWidth > b.clientWidth);
  assert.ok(scrolls, "o quadro rola de lado");
  await shot("05-celular-quadro");
  await page.click('.tcard:has-text("Arte do cardápio") [data-task-open-card]');
  await page.waitForSelector("#task-drawer[open] .task-props");
  const box = await page.$eval("#task-drawer", (d) => Math.round(d.getBoundingClientRect().width));
  assert.ok(box <= 390, `painel com ${box}px`);
  await shot("06-celular-painel");
});

await step("Sem erros no console", async () => {
  assert.deepEqual(consoleErrors, []);
});

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
