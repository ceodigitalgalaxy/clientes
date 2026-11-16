/* Teste de ponta a ponta: pedido de edição de vídeo.
   A administradora pede (pasta do Drive, formato, o que fazer, prazo, editor,
   checklist), o editor recebe na hora, abre a pasta, entrega o link do vídeo;
   ela pede ajuste (rodada 2), ele entrega de novo e ela aprova. Também: pedido
   a partir de um conteúdo do calendário, links inseguros recusados e as
   recusas do "servidor" (editor não aprova a própria entrega).
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/edicao-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5721;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DRIVE = "https://drive.google.com/drive/folders/1AbCdEfGhIjK";

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const bruna = fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const caio = fake.addUser("caio.video", "Senha-do-Caio-123", { name: "Caio Videomaker", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Editor de vídeo" } });
const reels = await store.createContent(validateContent({ client_id: padaria.id, title: "Reels da fornada de domingo", scheduled_date: plus(6), scheduled_time: "11:00", network: "instagram", format: "reels" }).value);

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-edicao-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
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
const notes = (user, kind) => store.listNotifications(user.id).filter((n) => n.kind === kind);
const asPage = (method, path, body) => page.evaluate(async ({ method, path, body, url, key }) => {
  const token = JSON.parse(localStorage.getItem("dg-painel-sessao") || "null")?.access_token;
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.text() };
}, { method, path, body, url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });
const openTask = async (title) => {
  await page.click(`.tcard:has-text("${title}") [data-task-open-card]`);
  await page.waitForSelector("#task-drawer[open] .edit-box");
};
const closePanel = async () => { await page.click('#task-drawer [data-action="close-drawer"]'); await page.waitForSelector("#task-drawer:not([open])", { state: "attached" }); };

const brunaPage = await newPage({ viewport: { width: 1440, height: 1000 } }, "bruna");
const caioPage = await newPage({ ...devices["iPhone 13"] }, "caio");

await step("Pedido de edição pelo quadro: formulário guiado, link inseguro recusado", async () => {
  page = brunaPage;
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
  await page.click('#view-gestao [data-action="new-edit-request"]');
  await page.waitForSelector("#task-drawer[open] [data-edit-new]");
  await page.fill("[data-edit-new] [name=title]", "Edição do vídeo institucional");
  await page.selectOption("[data-edit-new] [name=client_id]", padaria.id);
  const editors = await page.$$eval("[data-edit-new] [name=editor] option", (o) => o.map((x) => x.textContent));
  assert.ok(editors.some((e) => e.includes("Caio Videomaker · Editor de vídeo")), editors.join(" | "));
  await page.selectOption("[data-edit-new] [name=editor]", caio.id);
  await page.fill("[data-edit-new] [name=drive_url]", "javascript:alert(1)");
  await page.selectOption("[data-edit-new] [name=video_format]", "9_16");
  await page.fill("[data-edit-new] [name=video_duration]", "até 45 s");
  await page.fill("[data-edit-new] [name=description]", "Abrir com a fachada, legenda em todas as falas, trilha leve, logo no final.");
  await page.fill("[data-edit-new] [name=due_date]", plus(3));
  assert.equal(await page.locator("[data-edit-new] [name=check_item]:checked").count(), 7, "checklist padrão marcado");
  await page.uncheck('[data-edit-new] [name=check_item][value="Cor"]');
  await shot("ed01-pedido");
  await page.click("[data-edit-new] [type=submit]");
  await page.waitForSelector("[data-edit-new] .field__error");
  assert.match(await page.textContent("[data-edit-new] .field__error"), /https/);
  assert.equal(byTitle("Edição do vídeo institucional"), undefined, "nada foi criado");
});

await step("Enviar: o pedido abre com o botão da pasta, o checklist e a rodada 1 com o editor", async () => {
  await page.fill("[data-edit-new] [name=drive_url]", DRIVE);
  await page.click("[data-edit-new] [type=submit]");
  await page.waitForSelector("#task-drawer[open] .edit-box");
  const t = byTitle("Edição do vídeo institucional");
  assert.equal(t.kind, "edicao");
  assert.equal(t.drive_url, DRIVE);
  assert.equal(t.video_format, "9_16");
  assert.deepEqual(t.task_assignees.map((a) => a.user_id), [caio.id]);
  assert.equal(t.task_checklist.length, 6, "o item desmarcado não entra");
  const link = page.locator(".edit-box__drive");
  assert.equal(await link.getAttribute("href"), DRIVE);
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.match(await link.getAttribute("rel"), /noopener/);
  assert.match(await link.textContent(), /Abrir pasta no Google Drive/);
  await page.waitForSelector(".round.is-current");
  assert.match(await page.textContent(".round.is-current"), /Rodada 1.*Com o editor/s);
  assert.equal(await page.locator("[data-edit-deliver]").count(), 0, "quem pediu não vê \"Entregar\"");
  assert.match(await page.textContent(".edit-action__wait"), /Com o editor \(Caio Videomaker\)/);
  assert.equal(notes(caio, "tarefa_atribuida").length, 1, "o editor é avisado");
  await shot("ed02-pedido-aberto");
  await closePanel();
  assert.match(await page.textContent('.tcard:has-text("Edição do vídeo institucional")'), /R1/);
});

await step("Editor (celular): vê em Minhas com \"Abrir pasta\" e entrega o link do vídeo", async () => {
  page = caioPage;
  await page.goto(`${ORIGIN}/admin/#/demandas`);
  await signIn("caio.video", "Senha-do-Caio-123");
  const card = page.locator('#task-list .task-card:has-text("Edição do vídeo institucional")');
  await card.waitFor();
  assert.match(await card.textContent(), /Edição 9:16/);
  assert.equal(await card.locator(`a[href="${DRIVE}"]`).count(), 1, "atalho para a pasta");
  await shot("ed03-minhas-editor");
  await card.locator("[data-open-board-task]").click();
  await page.waitForSelector("#task-drawer[open] [data-edit-deliver]");
  assert.equal(await page.locator("[data-edit-approve]").count(), 0, "editor não aprova");
  await page.fill("[data-edit-deliver] [name=url]", "http://inseguro.com/video");
  await page.click("[data-edit-deliver] [type=submit]");
  await page.waitForSelector("[data-edit-deliver] .form-error:not([hidden])");
  await page.fill("[data-edit-deliver] [name=url]", "https://drive.google.com/file/d/versao1/view");
  await page.fill("[data-edit-deliver] [name=note]", "Usei a trilha 2 da pasta.");
  await shot("ed04-editor-entrega");
  await page.click("[data-edit-deliver] [type=submit]");
  await toastSays(/Entregue/);
  await page.waitForSelector(".round.is-current .round__video");
  const t = byTitle("Edição do vídeo institucional");
  assert.equal(t.status, "em_revisao");
  assert.equal(notes(bruna, "edicao_entregue").length, 1, "quem pediu é avisada");
});

await step("Servidor: o editor não aprova a própria entrega nem troca a pasta por link inseguro", async () => {
  const t = byTitle("Edição do vídeo institucional");
  const approve = await asPage("POST", "rpc/edit_review", { p_task: t.id, p_decision: "aprovado" });
  assert.equal(approve.status, 400);
  assert.match(approve.body, /so_quem_pediu_revisa/);
  const swap = await asPage("PATCH", `tasks?id=eq.${t.id}`, { drive_url: "javascript:alert(1)" });
  assert.equal(swap.status, 400);
  assert.equal(byTitle("Edição do vídeo institucional").drive_url, DRIVE);
});

await step("Quem pediu revisa e pede ajuste com os pontos: vira a rodada 2 e o editor é avisado", async () => {
  page = brunaPage;
  await openTask("Edição do vídeo institucional");
  await page.waitForSelector("[data-edit-review]");
  assert.match(await page.textContent(".round.is-current"), /Entregue por Caio Videomaker/);
  assert.match(await page.textContent(".round.is-current"), /Usei a trilha 2/);
  await page.click("[data-edit-adjust-open]");
  await page.click("[data-edit-adjust] [type=submit]");
  await page.waitForSelector("[data-edit-adjust] .form-error:not([hidden])");
  await page.fill("[data-edit-adjust] [name=notes]", "0:12 trocar a música\n0:30 cortar a pausa");
  await shot("ed05-pedir-ajuste");
  await page.click("[data-edit-adjust] [type=submit]");
  await toastSays(/rodada 2/);
  await page.waitForFunction(() => /Rodada 2/.test(document.querySelector(".round.is-current")?.textContent || ""));
  assert.match(await page.textContent(".round.is-current"), /0:12 trocar a música/);
  const t = byTitle("Edição do vídeo institucional");
  assert.equal(t.status, "ajustes");
  assert.equal(notes(caio, "edicao_ajuste").length, 1);
  await closePanel();
});

await step("Editor entrega a rodada 2 e quem pediu aprova: Concluído e o editor é avisado", async () => {
  page = caioPage;
  await page.reload();
  await page.locator('#task-list .task-card:has-text("Edição do vídeo institucional") [data-open-board-task]').click();
  await page.waitForSelector("#task-drawer[open] [data-edit-deliver]");
  assert.match(await page.textContent(".round.is-current"), /0:30 cortar a pausa/);
  await page.fill("[data-edit-deliver] [name=url]", "https://drive.google.com/file/d/versao2/view");
  await page.click("[data-edit-deliver] [type=submit]");
  await toastSays(/Entregue/);
  page = brunaPage;
  await page.reload();
  await page.waitForSelector(".tcard");
  await openTask("Edição do vídeo institucional");
  await page.click("[data-edit-approve]");
  await page.click('#confirm-modal [data-confirm="ok"]');
  await toastSays(/Edição aprovada/);
  await page.waitForSelector(".edit-action__done");
  const t = byTitle("Edição do vídeo institucional");
  assert.equal(t.status, "concluido");
  assert.deepEqual(fake.tasks.rounds.filter((r) => r.task_id === t.id).map((r) => [r.round, r.decision]), [[1, "ajustes"], [2, "aprovado"]]);
  assert.equal(notes(caio, "edicao_aprovada").length, 1);
  await shot("ed06-aprovado");
  await closePanel();
});

await step("Pedido a partir do conteúdo do calendário: já vem com cliente, título, formato e prazo", async () => {
  await page.goto(`${ORIGIN}/admin/#/conteudos`);
  await page.click('[data-cal-mode="lista"]');
  await page.click(`.row [data-view-content="${reels.id}"]`);
  await page.waitForSelector("#content-drawer[open]");
  await page.click(`#content-drawer [data-content-edit-request="${reels.id}"]`);
  await page.waitForSelector("#task-drawer[open] [data-edit-new]");
  assert.equal(await page.inputValue("[data-edit-new] [name=title]"), "Edição: Reels da fornada de domingo");
  assert.equal(await page.inputValue("[data-edit-new] [name=client_id]"), padaria.id);
  assert.equal(await page.inputValue("[data-edit-new] [name=video_format]"), "9_16");
  assert.equal(await page.inputValue("[data-edit-new] [name=due_date]"), plus(5), "véspera da publicação");
  assert.equal(await page.inputValue("[data-edit-new] [name=editor]"), caio.id, "lembra o último editor");
  await page.fill("[data-edit-new] [name=drive_url]", DRIVE);
  await page.click("[data-edit-new] [type=submit]");
  await page.waitForSelector("#task-drawer[open] .edit-box");
  assert.equal(byTitle("Edição: Reels da fornada de domingo").content_id, reels.id);
});

await step("Celular: o pedido aberto cabe na tela", async () => {
  page = caioPage;
  await page.reload();
  await page.locator('#task-list .task-card:has-text("Edição: Reels") [data-open-board-task]').click();
  await page.waitForSelector("#task-drawer[open] .edit-box");
  const wide = await page.$eval("#task-drawer .drawer__body", (b) => b.scrollWidth - b.clientWidth);
  assert.ok(wide <= 1, `painel rola de lado ${wide}px`);
  await shot("ed07-celular-pedido");
});

await step("Sem erros no console", async () => {
  assert.deepEqual(consoleErrors, []);
});

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
