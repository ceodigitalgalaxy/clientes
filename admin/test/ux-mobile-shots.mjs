/* Capturas do PAINEL inteiro no celular (iPhone 13, 390 px) para revisão
   visual, sobre o Supabase de mentira com dados de teste. Não testa nada:
   fotografa cada tela (como está agora: Início, Minhas, quadro de demandas,
   painel da demanda, calendário, aprovações, anúncios, clientes, equipe,
   sininho) e mede a rolagem lateral e os alvos de toque pequenos.
   PLAYWRIGHT=... UX_SHOTS=pasta node admin/test/ux-mobile-shots.mjs */

import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = Number(process.env.UX_PORT || 5711);
const OUT = process.env.UX_SHOTS;
const DEVICE = process.env.UX_DEVICE || "iPhone 13";
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", contact_name: "Maria", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz Fotografia e Eventos", slug: "estudio-luz", active: true });
const admin = fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: true, edit_scope: "atribuidos", can_send_approval: false, job_title: "Designer" } });
fake.addUser("caio.video", "Senha-do-Caio-123", { name: "Caio Videomaker", profile: { role: "colaborador", all_clients: true, edit_scope: "atribuidos", can_send_approval: false, job_title: "Videomaker" } });
const made = [];
for (const [d, title, client, network, format, status, extra] of [
  [-2, "Post atrasado da padaria", padaria, "instagram", "post", "planejado", {}],
  [0, "Stories do café da manhã", padaria, "instagram", "stories", "em_producao", {}],
  [1, "Reels da fornada de domingo com música", padaria, "instagram", "reels", "aguardando_aprovacao", {}],
  [1, "Carrossel de pães artesanais", padaria, "instagram", "carrossel", "planejado", {}],
  [1, "Bastidores do ensaio", estudio, "tiktok", "reels", "em_producao", {}],
  [3, "Depoimento de cliente", estudio, "facebook", "post", "aprovado", {}],
  [6, "Promoção de inverno", padaria, "facebook", "carrossel", "planejado", {}]
]) made.push(await store.createContent(validateContent({ client_id: client.id, title, scheduled_date: plus(d), scheduled_time: "10:30", network, format, status, caption: "Legenda de exemplo.", ...extra }).value));
store.addAssignee(made[1].id, admin.id, "Ana Designer", "Bruna Admin", ana.id);
store.addAssignee(made[3].id, admin.id, "Ana Designer", "Bruna Admin", ana.id);

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices[DEVICE] });
await context.route(`${SUPABASE_URL}/**`, async (route) => {
  const req = route.request();
  const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
  return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => console.log("erro:", e.message));
const report = [];
/** Rolagem lateral, quem passa da tela e botões menores que 32 px (difíceis de tocar) */
const audit = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const top = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  const scrollers = (n) => { for (let p = n.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true; } return false; };
  const wide = [...top.querySelectorAll("*")].filter((n) => { const r = n.getBoundingClientRect(); return r.width && r.right > vw + 1 && !scrollers(n) && getComputedStyle(n).position !== "fixed"; });
  const small = [...top.querySelectorAll("button, a, select, input:not([type=hidden]), [role=tab]")].filter((n) => {
    const r = n.getBoundingClientRect(); const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0" && (r.height < 32 || r.width < 32) && !n.closest(".link-btn, .inbox__item") && n.offsetParent !== null && r.top < innerHeight * 3;
  }).map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).join(".")}(${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)})`);
  return { page: document.documentElement.scrollWidth - vw, culprits: wide.slice(0, 4).map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).join(".")}`), small: [...new Set(small)].slice(0, 6) };
});
const shot = async (name, { full = false } = {}) => {
  await page.waitForTimeout(450);
  const o = await audit();
  report.push(`${name}: lateral ${o.page}px${o.culprits.length ? ` passam: ${o.culprits.join(", ")}` : ""}${o.small.length ? ` | pequenos: ${o.small.join(", ")}` : ""}`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
};
const closeTop = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(350); };

await page.goto(`http://localhost:${PORT}/admin/`);
await page.fill('#login-form [name="username"]', "admdg-teste");
await page.fill('#login-form [name="password"]', "Senha-de-teste-123");
await page.click("#login-form [type=submit]");
await page.waitForSelector("#app:not([hidden])");
await page.waitForSelector(".kpis .kpi__n");

// Demandas de exemplo pela própria tela (criar, delegar, comentar)
await page.goto(`http://localhost:${PORT}/admin/#/gestao`);
await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
for (const [title, who, due, client] of [["Campanha de Natal da padaria", ana.id, plus(2), padaria.id], ["Roteiro do vídeo institucional", admin.id, plus(0), estudio.id], ["Organizar a pasta de referências", admin.id, plus(-1), ""]]) {
  await page.click('#view-gestao [data-action="new-task"]');
  await page.waitForSelector("#task-drawer[open] [data-task-new]");
  if (client) await page.selectOption("[data-task-new] [name=client_id]", client);
  await page.fill("[data-task-new] [name=title]", title);
  await page.fill("[data-task-new] [name=due_date]", due);
  if (who !== admin.id) { await page.click("[data-task-new] .pick-person:has-text('Bruna Admin')"); await page.click(`[data-task-new] .pick-person:has([value="${who}"])`); }
  await page.click('[data-task-new] .pick-label:has-text("Design")');
  await page.click("[data-task-new] [data-open-after]");
  await page.waitForSelector("#task-drawer[open] .task-props");
  if (title.startsWith("Campanha")) {
    await page.fill("[data-subtask-add] [name=title]", "Fotos dos panetones");
    await page.selectOption("[data-subtask-add] [name=assignee]", ana.id);
    await page.click("[data-subtask-add] [type=submit]");
    await page.waitForSelector(".subtask");
    await page.fill("[data-check-add] [name=body]", "Separar referências");
    await page.press("[data-check-add] [name=body]", "Enter");
    await page.waitForSelector(".check-item");
    await page.fill("[data-task-comment-form] textarea", "Pode separar as fotos até quinta?");
    await page.click("[data-task-comment-form] [type=submit]");
    await page.waitForSelector(".tcomment");
  }
  await closeTop();
}

await page.goto(`http://localhost:${PORT}/admin/#/inicio`);
await page.waitForSelector(".kpis .kpi__n");
await shot("c01-inicio");
await shot("c01b-inicio-inteiro", { full: true });
await page.click('[data-action="toggle-inbox"]'); await page.waitForSelector("#inbox:not([hidden])");
await shot("c02-sininho");
await page.click('[data-action="toggle-inbox"]');
await page.click('.admin-nav [data-route="demandas"]'); await page.waitForSelector("#task-list .task-card");
await shot("c03-minhas", { full: true });
await page.click('.admin-nav [data-route="gestao"]'); await page.waitForSelector(".tcard");
await shot("c04-quadro");
await page.click('.tcard:has-text("Campanha de Natal") [data-task-open-card]'); await page.waitForSelector("#task-drawer[open] .task-props");
await shot("c05-demanda-topo");
await page.locator("#task-body .detail:has(.subtasks)").scrollIntoViewIfNeeded(); await shot("c06-demanda-subtarefas");
await page.locator("#task-body .task-activity").scrollIntoViewIfNeeded(); await shot("c07-demanda-atividade");
await closeTop();
await page.click('#view-gestao [data-action="new-task"]'); await page.waitForSelector("#task-drawer[open] [data-task-new]");
await shot("c08-nova-demanda");
await closeTop();
await page.click('.admin-nav [data-route="conteudos"]'); await page.waitForSelector(".acal--month");
await shot("c09-calendario-mes");
await page.click('[data-cal-mode="semana"]'); await page.waitForTimeout(300); await shot("c10-calendario-semana");
await page.click('[data-cal-mode="dia"]'); await page.waitForTimeout(300); await shot("c11-calendario-dia");
await page.click('[data-cal-mode="quadro"]'); await page.waitForTimeout(300); await shot("c12-calendario-quadro");
await page.click('[data-cal-mode="lista"]'); await page.waitForSelector(".row[data-row]"); await shot("c13-lista");
await page.click(".row__title >> nth=0"); await page.waitForSelector("#content-drawer[open]");
await shot("c14-conteudo-topo");
await page.evaluate(() => { const b = document.querySelector("#content-drawer .drawer__body"); b.scrollTop = b.scrollHeight; }); await shot("c15-conteudo-fim");
await closeTop();
await page.click('[data-cal-mode="mes"]');
await page.click("[data-nav-more]"); await page.waitForSelector("#nav-sheet:not([hidden])"); await shot("c16-menu-mais");
await page.click('#nav-sheet [data-route="aprovacoes"]'); await page.waitForSelector("#view-aprovacoes:not([hidden])"); await page.waitForTimeout(500);
await shot("c17-aprovacoes");
await page.locator('#view-aprovacoes [data-action="new-batch"]:visible').first().click(); await page.waitForTimeout(600); await shot("c18-novo-lote"); await closeTop();
await page.click("[data-nav-more]"); await page.click('#nav-sheet [data-route="equipe"]'); await page.waitForSelector(".member-card"); await shot("c19-equipe");
await page.click("[data-nav-more]"); await page.click('#nav-sheet [data-route="clientes"]'); await page.waitForSelector(".client-card"); await shot("c20-clientes");
await page.click("[data-nav-more]"); await page.click('#nav-sheet [data-route="anuncios"]'); await page.waitForTimeout(600); await shot("c21-anuncios");
console.log(report.join("\n"));
await browser.close();
server.close();
