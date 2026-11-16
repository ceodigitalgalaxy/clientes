/* Teste de ponta a ponta: Gestão de demandas (Etapa E2) — subtarefas com
   responsáveis diferentes (delegação), checklist, comentários com @menção,
   resposta, edição rastreável e apagar, etiquetas (administrador), avisos
   no sininho e as recusas do "servidor".
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/demandas2-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5681;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
const admin = fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Designer" } });
fake.addUser("caio.video", "Senha-do-Caio-123", { name: "Caio Videomaker", profile: { role: "colaborador", all_clients: false, client_ids: [estudio.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Videomaker" } });

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-demandas2-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
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
const notes = (user, kind) => store.listNotifications(user.id).filter((n) => !kind || n.kind === kind);
const asPage = (method, path, body) => page.evaluate(async ({ method, path, body, url, key }) => {
  const token = JSON.parse(localStorage.getItem("dg-painel-sessao") || "null")?.access_token;
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.text() };
}, { method, path, body, url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });
const panelReady = () => page.waitForSelector("#task-drawer[open] .task-props");

/* ============================== Administradora ============================== */
page = await newPage({ viewport: { width: 1440, height: 1000 } }, "admin");

await step("Cria a demanda e abre o painel com Subtarefas, Checklist e Comentários", async () => {
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
  await page.click('#view-gestao [data-action="new-task"]');
  await page.selectOption("[data-task-new] [name=client_id]", padaria.id);
  await page.fill("[data-task-new] [name=title]", "Campanha de Natal");
  await page.click("[data-task-new] [data-open-after]");
  await panelReady();
  for (const title of ["Subtarefas", "Checklist"]) assert.ok(await page.isVisible(`#task-body .detail__title:has-text("${title}")`), title);
  assert.ok(await page.isVisible("[data-task-comment-form]"), "comentários à vista");
  assert.ok(await page.isVisible("#task-body .history-toggle__summary"), "histórico fechado, com o botão para abrir");
  assert.equal(await page.isVisible("[data-task-history]"), false);
});

await step("Subtarefa entregue para outra pessoa: avisa ela e o responsável da demanda continua o mesmo", async () => {
  await page.fill("[data-subtask-add] [name=title]", "Fotos dos panetones");
  // Só aparece quem enxerga o cliente (o Caio não)
  const people = await page.$$eval("[data-subtask-add] [name=assignee] option", (o) => o.map((x) => x.textContent));
  assert.ok(people.some((p) => p.includes("Ana")) && !people.some((p) => p.includes("Caio")), people.join(" | "));
  await page.selectOption("[data-subtask-add] [name=assignee]", ana.id);
  await page.fill("[data-subtask-add] [name=due_date]", plus(3));
  await page.click("[data-subtask-add] [type=submit]");
  await toastSays(/entregue para Ana Designer/);
  await page.waitForSelector('.subtask:has-text("Fotos dos panetones")');
  const sub = byTitle("Fotos dos panetones");
  const main = byTitle("Campanha de Natal");
  assert.equal(sub.parent_id, main.id);
  assert.equal(sub.client_id, padaria.id, "herda o cliente");
  assert.deepEqual(sub.task_assignees.map((a) => a.user_id), [ana.id]);
  assert.deepEqual(main.task_assignees.map((a) => a.user_id), [admin.id], "o responsável da demanda não mudou");
  assert.equal(notes(ana, "tarefa_atribuida").length, 1);
  await page.fill("[data-subtask-add] [name=title]", "Legenda do carrossel");
  await page.press("[data-subtask-add] [name=title]", "Enter");
  await page.waitForSelector('.subtask:has-text("Legenda do carrossel")');
  assert.match(await page.textContent('#task-body .detail__title:has-text("Subtarefas")'), /0\/2/);
});

await step("Checklist: adicionar, marcar e o card mostra o progresso", async () => {
  for (const item of ["Separar referências", "Aprovar paleta"]) {
    await page.fill("[data-check-add] [name=body]", item);
    await page.press("[data-check-add] [name=body]", "Enter");
    await page.waitForSelector(`.check-item:has-text("${item}")`);
  }
  await page.click('.check-item:has-text("Separar referências") input');
  await page.waitForSelector(".check-item.is-done");
  assert.equal(await page.textContent("[data-check-count]"), "1/2");
  assert.deepEqual(fake.tasks.checklist.map((i) => i.done).sort(), [false, true]);
  await page.waitForFunction(() => /1\/2/.test(document.querySelector(".tcard")?.textContent || ""));
});

await step("Comentário com @menção avisa só quem enxerga a demanda", async () => {
  const area = page.locator("[data-task-comment-form] textarea");
  await area.click();
  await area.pressSequentially("Oi @An");
  await page.waitForSelector("[data-task-comment-form] .mention-list:not([hidden])");
  const names = await page.$$eval("[data-task-comment-form] .mention-option", (o) => o.map((x) => x.textContent));
  assert.ok(names.some((n) => n.includes("Ana Designer")));
  await area.press("Enter");
  await area.pressSequentially("pode separar as fotos até quinta?");
  await page.click("[data-task-comment-form] [type=submit]");
  await toastSays(/1 pessoa avisada/);
  await page.waitForSelector('.tcomment .mention:text-is("@Ana Designer")');
  assert.equal(notes(ana, "tarefa_mencao").length, 1);
  // O Caio não aparece para mencionar
  await area.pressSequentially("@Ca");
  await page.waitForTimeout(200);
  assert.equal(await page.isVisible("[data-task-comment-form] .mention-list:not([hidden]) .mention-option"), false);
  await area.fill("");
  await page.waitForFunction(() => /\(1\)/.test(document.querySelector("[data-comment-count]")?.textContent || ""));
  await shot("e2-01-painel-subtarefas-comentarios");
});

await step("Editar o próprio comentário guarda o texto anterior", async () => {
  await page.click(".tcomment [data-comment-edit]");
  const area = page.locator("[data-inline-comment] textarea");
  await area.fill("Oi @Ana Designer, pode separar as fotos até sexta?");
  await page.click("[data-inline-comment] [type=submit]");
  await toastSays(/texto anterior fica guardado/);
  await page.click(".tcomment [data-comment-versions]");
  await page.waitForSelector(".tcomment__versions:not([hidden]) .tcomment__old");
  assert.match(await page.textContent(".tcomment__old"), /até quinta/);
  assert.equal(fake.tasks.comments[0].body, "Oi @Ana Designer, pode separar as fotos até sexta?");
});

await step("Histórico separado dos comentários e fechado até abrir", async () => {
  await page.click("#task-body .history-toggle__summary");
  await page.waitForSelector("[data-task-history] .history__item");
  assert.match(await page.textContent("[data-task-history]"), /Demanda criada/);
  assert.equal((await page.$$eval("[data-task-history] .history__title", (n) => n.map((x) => x.textContent))).some((t) => /pode separar/.test(t)), false, "comentário não se mistura com o histórico");
  await page.click("#task-body .history-toggle__summary");
  await page.waitForSelector("[data-task-history]", { state: "hidden" });
});

await step("Etiquetas (administrador): renomear, arquivar e criar; arquivada some das escolhas", async () => {
  await page.click('#task-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
  await page.click("#view-gestao [data-board-settings]"); await page.click('#view-gestao [data-action="board-labels"]');
  await page.waitForSelector("#labels-modal[open] .labelrow");
  const reels = page.locator('#labels-modal .labelrow:has([data-label-field="name"][value="Reels"])');
  await reels.locator('[data-label-field="name"]').fill("Reels e vídeos");
  await reels.locator('[data-label-field="name"]').press("Tab");
  await toastSays(/Etiqueta salva/);
  await page.locator('#labels-modal .labelrow:has([data-label-field="name"][value="Aguardando material"]) [data-label-archive]').click();
  await toastSays(/arquivada/);
  await page.fill("#labels-modal [data-label-add] [name=name]", "Fim de ano");
  await page.selectOption("#labels-modal [data-label-add] [name=color]", "verde");
  await page.click("#labels-modal [data-label-add] [type=submit]");
  await toastSays(/Fim de ano/);
  await shot("e2-02-etiquetas");
  await page.click('#labels-modal .modal__actions [data-action="close-modal"]');
  await page.waitForSelector("#labels-modal:not([open])", { state: "attached" });
  await page.click('.tcard:has-text("Campanha de Natal") [data-task-open-card]');
  await panelReady();
  const chips = await page.$$eval("#task-body .pick-label", (n) => n.map((x) => x.textContent.trim()));
  assert.ok(chips.includes("Reels e vídeos") && chips.includes("Fim de ano") && !chips.includes("Aguardando material"), chips.join(" | "));
  await page.click('#task-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#task-drawer:not([open])", { state: "attached" });
});

/* ============================== Colaboradora ============================== */
await step("Ana: o sininho leva direto para a demanda; ela conclui a subtarefa e quem criou é avisada", async () => {
  page = await newPage({ viewport: { width: 1280, height: 900 } }, "ana");
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("ana.design", "Senha-da-Ana-123");
  await page.click('[data-action="toggle-inbox"]');
  await page.waitForSelector('#inbox .inbox__item:has-text("te passou uma demanda")');
  assert.ok(await page.isVisible('#inbox .inbox__item:has-text("te mencionou numa demanda")'));
  await shot("e2-03-sininho");
  await page.click('#inbox .inbox__item:has-text("te passou uma demanda")');
  await panelReady();
  assert.equal(await page.inputValue(".task-title"), "Fotos dos panetones");
  await page.click(".task-crumbs [data-task-open]");
  await page.waitForFunction(() => document.querySelector(".task-title")?.value === "Campanha de Natal");
  await page.click('.subtask:has-text("Fotos dos panetones") [data-subtask-done]');
  await toastSays(/Subtarefa concluída/);
  assert.equal(byTitle("Fotos dos panetones").status, "concluido");
  assert.equal(notes(admin, "subtarefa_concluida").length, 1);
});

await step("Ana responde; não edita comentário de outra pessoa (nem pelo servidor)", async () => {
  await page.waitForSelector(".tcomment");
  assert.equal(await page.locator(".tcomment [data-comment-edit]").count(), 0, "sem botão Editar no comentário da Bruna");
  await page.click(".tcomment [data-comment-reply]");
  await page.fill("[data-inline-comment] textarea", "Combinado, envio na sexta.");
  await page.click("[data-inline-comment] [type=submit]");
  await page.waitForSelector('.tcomments--replies .tcomment:has-text("Combinado")');
  const theirs = fake.tasks.comments.find((c) => c.author_id === admin.id);
  const hack = await asPage("PATCH", `task_comments?id=eq.${theirs.id}`, { body: "texto trocado" });
  assert.deepEqual(JSON.parse(hack.body), [], "o banco não deixa nem achar a linha para editar");
  assert.match(fake.tasks.comments.find((c) => c.id === theirs.id).body, /até sexta/, "texto intacto");
  assert.equal(notes(admin, "tarefa_comentario").length, 1, "a Bruna (quem criou) é avisada da resposta");
});

await step("Caio (outro cliente) não lê comentários nem checklist dessa demanda", async () => {
  page = await newPage({ viewport: { width: 1280, height: 900 } }, "caio");
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("caio.video", "Senha-do-Caio-123");
  const t = byTitle("Campanha de Natal");
  assert.deepEqual(JSON.parse((await asPage("GET", `task_comments?task_id=eq.${t.id}`)).body), []);
  assert.deepEqual(JSON.parse((await asPage("GET", `task_checklist?task_id=eq.${t.id}`)).body), []);
  const write = await asPage("POST", "task_comments", { task_id: t.id, body: "intruso" });
  assert.equal(write.status, 403);
});

await step("Administradora apaga a resposta: some o texto, fica o registro", async () => {
  page = await newPage({ viewport: { width: 1440, height: 1000 } }, "admin2");
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector(".tcard");
  await page.click('.tcard:has-text("Campanha de Natal") [data-task-open-card]');
  await page.waitForSelector('.tcomments--replies .tcomment:has-text("Combinado")');
  await page.click('.tcomments--replies .tcomment [data-comment-delete]');
  await page.click('#confirm-modal [data-confirm="ok"]');
  await page.waitForSelector(".tcomment__body--gone");
  assert.ok(fake.tasks.comments.find((c) => c.body.startsWith("Combinado")).deleted_at);
});

/* ============================== Celular ============================== */
await step("Celular: painel com subtarefas, checklist e comentários sem estourar a tela", async () => {
  page = await newPage({ ...devices["iPhone 13"] }, "celular");
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector(".tcard");
  await page.click('.tcard:has-text("Campanha de Natal") [data-task-open-card]');
  await page.waitForSelector(".subtask");
  const wide = await page.$eval("#task-drawer .drawer__body", (b) => b.scrollWidth - b.clientWidth);
  assert.ok(wide <= 1, `painel rola de lado ${wide}px`);
  await page.locator("[data-subtask-add]").scrollIntoViewIfNeeded();
  await shot("e2-04-celular-subtarefas");
  await page.locator("[data-task-comment-form]").scrollIntoViewIfNeeded();
  await shot("e2-05-celular-comentarios");
});

await step("Sem erros no console", async () => {
  assert.deepEqual(consoleErrors, []);
});

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
