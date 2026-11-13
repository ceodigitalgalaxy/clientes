/* Teste de ponta a ponta: Central de aprovação com link público.
   Painel da agência (lotes, link, avisos, nova versão, relatório) e a página
   pública /aprovacao/ (sem login), no computador e no celular, sobre o
   Supabase de mentira com a função "aprovacao" de verdade.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/approvals-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5600;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const FIX = (name) => readFileSync(path.join(HERE, "fixtures", name));

const pad = (n) => String(n).padStart(2, "0");
const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
const MONTH = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
const D = (day) => `${MONTH}-${pad(day)}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe DG" });
const make = (client, title, day, extra = {}) => store.createContent(validateContent({ client_id: client.id, title, scheduled_date: D(day), scheduled_time: "10:00", network: "instagram", format: "post", ...extra }).value);
const c1 = await make(padaria, "Primeira fornada", 5, { idea: "Mostrar o pão saindo do forno", content_plan: "1. Forno abrindo\n2. Pães na vitrine", art_text: "Saiu agora!", objective: "Movimento de manhã", caption: "Nada como pão quentinho.", cta: "Peça pelo WhatsApp", pillar: "Bastidores", media_url: "https://cdn.exemplo.com/REFERENCIA-INTERNA.png", internal_notes: "SEGREDO-DA-EQUIPE", format: "reels" });
const c2 = await make(padaria, "Promoção do café", 12, { idea: "Café + pão por R$ 9,90", format: "carrossel" });
const c3 = await make(padaria, "Depoimento de cliente", 20, { idea: "Cliente antigo conta a história" });
await make(estudio, "Ensaio do estúdio", 8);
const arte = `${padaria.id}/${c1.id}/capa.png`;
fake.files.set(`content-media/${arte}`, { type: "image/png", body: FIX("arte.png") });
await store.addAsset({ content_id: c1.id, kind: "image", role: "capa", storage_path: arte, position: 0 });
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
let admin = null;
let client = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) {
      const name = label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      await admin?.screenshot({ path: `${SHOTS}/falha-painel-${name}.png` }).catch(() => {});
      await client?.screenshot({ path: `${SHOTS}/falha-cliente-${name}.png`, fullPage: true }).catch(() => {});
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
  await context.route("https://cdn.exemplo.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: FIX("arte.png") }));
  return context;
}
const watch = (page, name) => {
  page.setDefaultTimeout(8000);
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
};
const shot = async (page, name, opts = {}) => { if (!SHOTS) return; await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }); };
const toastSays = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source);
const confirmOk = async (page = admin) => {
  await page.click('#confirm-modal [data-confirm="ok"]');
  await page.waitForSelector("#confirm-modal:not([open])", { state: "attached" });
};
const batchId = () => store.listBatchSummary({ client_id: padaria.id }).then((rows) => rows[0].id);
const linkFor = async () => `${ORIGIN}/aprovacao/#${store.approvalTokenOf(await batchId())}`;
const card = (title) => `.ap-card:has(.ap-card__title:text-is("${title}"))`;
const DETAIL = ".ap-detail[open]";
const openDetail = async (page, title) => {
  await page.click(`${card(title)} [data-ap-open]`);
  await page.waitForSelector(`${DETAIL} .ap-detail__title:text-is("${title}")`);
};
const closeDetail = async (page) => { await page.click(`${DETAIL} [data-ap-close]`); await page.waitForSelector(".ap-detail", { state: "hidden" }); };

const adminContext = await newContext();
admin = await adminContext.newPage();
watch(admin, "painel");
const clientContext = await newContext();
client = await clientContext.newPage();
watch(client, "cliente");

/* ============================== Testes ============================== */

await step("Painel: seção Aprovações vazia, com chamada para criar o lote", async () => {
  await admin.goto(`${ORIGIN}/admin/#/aprovacoes`);
  await admin.fill('#login-form [name="username"]', "admdg-teste");
  await admin.fill('#login-form [name="password"]', "Senha-de-teste-123");
  await admin.click("#login-form [type=submit]");
  await admin.waitForSelector("#app:not([hidden])");
  await admin.waitForSelector("#batches-list .state__title");
  assert.equal(await admin.textContent("#batches-list .state__title"), "Nenhum lote de aprovação ainda");
  assert.match(await admin.textContent("#aprovacoes-title"), /Aprovações de Conteúdo/);
});

await step("Criar lote: valida, cria e já abre a escolha de conteúdos do mês", async () => {
  await admin.click('.view__head [data-action="new-batch"]');
  await admin.waitForSelector("#batch-modal[open]");
  await admin.selectOption('#batch-modal [name="client_id"]', "");
  await admin.fill('#batch-modal [name="title"]', "");
  await admin.click("#batch-modal [type=submit]");
  await admin.waitForSelector("#batch-modal .field__error");
  assert.match(await admin.textContent("#batch-modal"), /Escolha o cliente.*Dê um título/s);
  await admin.selectOption('#batch-modal [name="client_id"]', padaria.id);
  await admin.fill('#batch-modal [name="month"]', MONTH);
  await admin.fill('#batch-modal [name="title"]', "Planejamento do mês");
  await admin.fill('#batch-modal [name="intro_message"]', "Oi! Preparamos 3 conteúdos para você.");
  await admin.click("#batch-modal [type=submit]");
  await admin.waitForSelector("#pick-modal[open]");
  const titles = await admin.$$eval("#pick-modal .pick-item__title", (n) => n.map((x) => x.textContent));
  assert.deepEqual(titles.sort(), ["Depoimento de cliente", "Primeira fornada", "Promoção do café"], "só conteúdos do cliente e do mês");
  for (const t of titles) await admin.check(`#pick-modal .pick-item:has-text("${t}") input`);
  await admin.click("#pick-modal [type=submit]");
  await admin.waitForSelector("#pick-modal:not([open])", { state: "attached" });
  await admin.waitForFunction(() => document.querySelectorAll("#batch-drawer .batch-item").length === 3);
  assert.deepEqual(await admin.$$eval("#batch-drawer .batch-item__title", (n) => n.map((x) => x.textContent)), ["Primeira fornada", "Promoção do café", "Depoimento de cliente"], "ordem por data");
  await shot(admin, "ap01-lote");
});

await step("Gerar link: escolhe conteúdos, modo, expiração; link copiado", async () => {
  await admin.click('#batch-drawer [data-batch-publish]');
  await admin.waitForSelector("#publish-modal[open]");
  assert.equal(await admin.locator('#publish-modal [name="item"]:checked').count(), 3);
  await admin.check('#publish-modal [name="mode"][value="planejamento"]');
  const until = new Date(); until.setDate(until.getDate() + 20);
  await admin.fill('#publish-modal [name="expires_on"]', `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}`);
  await admin.click("#publish-modal [type=submit]");
  await toastSays(admin, /3 conteúdos enviados/);
  await toastSays(admin, /Link copiado/);
  const copied = await admin.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, await linkFor());
  assert.match(copied, /\/aprovacao\/#[A-Za-z0-9_-]{43}$/, "token longo depois do #");
  await admin.waitForSelector('#batch-drawer [data-batch-revoke]');
  assert.equal((await store.getContent(c1.id)).approval_status, "aguardando_aprovacao");
});

await step("Mensagem pronta para o WhatsApp com o link no lugar de [LINK]", async () => {
  await admin.click('#batch-drawer [data-batch-whatsapp]');
  await toastSays(admin, /Mensagem para o WhatsApp copiada/);
  const text = await admin.evaluate(() => navigator.clipboard.readText());
  assert.ok(text.includes(await linkFor()) && !text.includes("[LINK]"));
  assert.match(text, /Solicitar ajuste.*não precisa criar conta nem fazer login/s);
});

await step("Cliente abre o link sem login e vê só o lote, sem nada interno", async () => {
  await client.goto(await linkFor());
  await client.waitForSelector(".ap-card");
  const text = await client.textContent("body");
  assert.match(text, /Padaria Central Ltda/);
  assert.match(text, /Oi! Preparamos 3 conteúdos para você\./);
  assert.match(text, /Aprovação de planejamento.*Você está aprovando a IDEIA/s);
  assert.equal(await client.locator(".ap-card").count(), 3);
  assert.match(await client.textContent(card("Primeira fornada")), /Aguardando aprovação.*Primeira fornada.*Reels.*Ver detalhes/s);
  assert.ok(!(await client.textContent(card("Primeira fornada"))).includes("Mostrar o pão"), "cartão sem a descrição longa");
  // Planejamento: a arte (mesmo já anexada) não vai; cartão sem espaço de imagem
  assert.equal(await client.locator(".ap-card .ap-thumb").count(), 0, "planejamento sem arte");
  await openDetail(client, "Primeira fornada");
  const detail = await client.textContent(DETAIL);
  assert.match(detail, /Conteúdo 1 de 3.*A ideia.*Mostrar o pão.*Roteiro \/ como vai ser.*Forno abrindo.*Informações adicionais.*Rede/s);
  for (const hidden of ["Nada como pão quentinho", "Saiu agora!", "Peça pelo WhatsApp", "Movimento de manhã", "Bastidores", "Legenda"]) {
    assert.ok(!detail.includes(hidden), `planejamento não mostra "${hidden}"`);
  }
  assert.equal(await client.locator(`${DETAIL} img, ${DETAIL} video`).count(), 0, "sem arte no detalhe");
  await shot(client, "ap02b-detalhe");
  await client.click(`${DETAIL} [data-ap-step="1"]`);
  await client.waitForSelector(`${DETAIL} .ap-detail__title:text-is("Promoção do café")`);
  assert.match(await client.textContent(`${DETAIL} .ap-detail__count`), /2 de 3/);
  await client.keyboard.press("ArrowLeft");
  await client.waitForSelector(`${DETAIL} .ap-detail__title:text-is("Primeira fornada")`);
  assert.ok(await client.isDisabled(`${DETAIL} [data-ap-step="-1"]`), "não há anterior ao primeiro");
  await client.keyboard.press("Escape");
  await client.waitForSelector(".ap-detail", { state: "hidden" });
  assert.equal(await client.evaluate(() => document.activeElement?.closest(".ap-card")?.querySelector(".ap-card__title")?.textContent), "Primeira fornada", "o foco volta para o cartão");
  const html = await client.content();
  assert.ok(!html.includes("REFERENCIA-INTERNA") && !html.includes("SEGREDO-DA-EQUIPE") && !html.includes("Ensaio do estúdio"));
  assert.ok(!html.includes("Nada como pão quentinho") && !html.includes("sign/content-media"), "nem legenda nem arquivo no planejamento");
  assert.match(await client.textContent(".ap-progress__text"), /0 de 3/);
  assert.equal(await client.getAttribute('meta[name="robots"]', "content"), "noindex, nofollow, noarchive");
  await shot(client, "ap02-cliente", { fullPage: true });
});

await step("Aprovar um conteúdo: confirma, pede o nome uma vez e atualiza o progresso", async () => {
  await openDetail(client, "Primeira fornada");
  await client.click(`${DETAIL} [data-ap-approve]`);
  await client.click(`${DETAIL} [data-ap-approve-now]`);
  await client.waitForSelector("dialog.ap-dialog--small [name=name]");
  assert.match(await client.textContent("dialog.ap-dialog--small"), /Como podemos identificar sua aprovação\?/);
  await client.fill("dialog.ap-dialog--small [name=name]", "Maria");
  await client.click("dialog.ap-dialog--small [type=submit]");
  await toastSays(client, /Conteúdo aprovado com sucesso!/);
  await client.waitForFunction(() => /1 de 3/.test(document.querySelector(".ap-progress__text")?.textContent || ""));
  assert.match(await client.textContent(DETAIL), /Aprovado por Maria/);
  assert.match(await client.textContent(card("Primeira fornada")), /Aprovado/);
  // Depois de decidir, segue para o próximo pendente sem fechar
  await client.click(`${DETAIL} [data-ap-goto]`);
  await client.waitForSelector(`${DETAIL} .ap-detail__title:text-is("Promoção do café")`);
  const [decision] = await store.listDecisions({ content_id: c1.id });
  assert.deepEqual([decision.action, decision.reviewer_name], ["aprovado", "Maria"]);
  assert.ok(decision.session_id, "sessão registrada");
});

await step("Solicitar ajuste exige comentário e registra", async () => {
  await client.click(`${DETAIL} [data-ap-request]`);
  await client.click(`${DETAIL} [data-ap-adjust] [type=submit]`);
  await client.waitForSelector(`${DETAIL} .form-error:not([hidden])`);
  await client.fill(`${DETAIL} [data-ap-adjust] textarea`, "Gostaria de falar mais do café especial.");
  await client.click(`${DETAIL} [data-ap-adjust] [type=submit]`);
  await toastSays(client, /Pedido de ajuste enviado/);
  await client.waitForFunction(() => /Ajuste solicitado/.test(document.querySelector(".ap-detail[open]")?.textContent || ""));
  assert.match(await client.textContent(card("Promoção do café")), /Ajustes solicitados.*Você pediu ajuste/s);
  await closeDetail(client);
  assert.equal(await client.locator("dialog.ap-dialog--small").count(), 0, "o nome não é pedido de novo");
  assert.equal((await store.getContent(c2.id)).approval_status, "ajustes");
});

await step("Calendário: conteúdos nas datas, abre os detalhes com as ações", async () => {
  await client.click('[data-ap-layout="calendario"]');
  await client.waitForSelector(".ap-cal .ap-chip");
  assert.equal(await client.locator(".ap-cal .ap-chip").count(), 3);
  await client.click('.ap-cal .ap-chip:has-text("Depoimento de cliente")');
  await client.waitForSelector(".ap-dialog[open] [data-ap-approve]");
  await shot(client, "ap03-calendario");
  await client.click(".ap-dialog[open] [data-ap-close]");
  await client.click('[data-ap-layout="lista"]');
  await client.click("[data-ap-filters]");
  await client.selectOption('[data-ap-filter="status"]', "ajustes");
  assert.equal(await client.locator(".ap-list .ap-card").count(), 1);
  assert.match(await client.textContent("[data-ap-filters]"), /Filtros\s*1/);
  await client.click(".ap-filters [data-ap-clear]");
  assert.equal(await client.locator(".ap-list .ap-card").count(), 3);
});

await step("Painel: avisos internos, contagens e status geral sem recarregar", async () => {
  await admin.click('#batch-drawer [data-action="close-drawer"]');
  await admin.waitForSelector("#batch-drawer:not([open])", { state: "attached" });
  await admin.click('[data-route="aprovacoes"]');
  await admin.waitForSelector(".batch-card");
  await admin.waitForSelector("[data-approvals-attention]:not([hidden])");
  assert.equal(await admin.textContent("[data-approvals-attention]"), "2");
  assert.match(await admin.textContent(".batch-card"), /Com ajustes pendentes/);
  assert.deepEqual(await admin.$$eval(".batch-counts b", (n) => n.map((x) => x.textContent)), ["3", "1", "1", "1"]);
  assert.match(await admin.textContent(".appr-overview"), /Todos\s*1.*Com ajustes\s*1/s);
  assert.match(await admin.textContent(".batch-card .next-step"), /1 ajuste pedido pelo cliente/);
  await admin.click('[data-action="toggle-notifications"]');
  assert.match(await admin.textContent("#approval-notifications"), /Maria pediu ajuste.*café especial/s);
  await shot(admin, "ap04-painel-avisos");
  await admin.click("[data-notif-read-all]");
  await admin.waitForSelector("[data-approvals-attention]", { state: "hidden" });
});

await step("Nova versão: edita, reenvia; cliente vê 'revisado' com o pedido", async () => {
  await store.updateContent(c2.id, { ...(await store.getContent(c2.id)), idea: "Café especial da casa + pão" });
  await admin.click(".batch-card [data-batch-open]");
  await admin.waitForSelector('#batch-drawer .batch-item:has-text("Promoção do café") [data-item-resend]');
  assert.match(await admin.textContent('#batch-drawer .batch-item:has-text("Promoção do café")'), /Ajuste pedido por Maria.*café especial/s);
  await admin.click('#batch-drawer .batch-item:has-text("Promoção do café") [data-item-resend]');
  await confirmOk();
  await toastSays(admin, /Nova versão enviada/);
  await client.reload();
  await client.waitForSelector(card("Promoção do café"));
  assert.match(await client.textContent(card("Promoção do café")), /Revisado a seu pedido/);
  await openDetail(client, "Promoção do café");
  const text = await client.textContent(DETAIL);
  assert.match(text, /Revisado e reenviado.*Versão 2/s);
  assert.match(text, /Revisamos este conteúdo.*café especial/s);
  assert.match(text, /Café especial da casa \+ pão/);
  assert.equal((await store.listVersions({ content_id: c2.id })).length, 2, "versão anterior preservada");
  await closeDetail(client);
});

await step("Aprovar todos os pendentes: confirmação, cada um registrado, planejamento aprovado", async () => {
  await client.click("[data-ap-all]");
  await client.waitForSelector('dialog[role="alertdialog"]');
  assert.match(await client.textContent('dialog[role="alertdialog"]'), /Você está prestes a aprovar 2 conteúdos\. Deseja continuar\?/);
  await client.click('dialog[role="alertdialog"] [data-answer="yes"]');
  await toastSays(client, /2 conteúdos aprovados/);
  await client.waitForSelector(".ap-done--ok");
  assert.match(await client.textContent(".ap-done--ok"), /Planejamento aprovado!.*Obrigado! Recebemos sua aprovação/s);
  assert.equal((await store.listDecisions({ batch_id: await batchId() })).filter((d) => d.bulk).length, 2);
  assert.ok(store.approvalEvents.some((e) => e.event_type === "lote_aprovado"));
  await shot(client, "ap05-aprovado", { fullPage: true });
});

await step("Painel: histórico legível e relatório em PDF", async () => {
  await admin.click('#batch-drawer [data-action="close-drawer"]');
  await admin.waitForSelector("#batch-drawer:not([open])", { state: "attached" });
  await admin.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await admin.waitForFunction(() => /Aprovado/.test(document.querySelector(".batch-card .appr-chip")?.textContent || ""));
  await admin.click(".batch-card [data-batch-open]");
  await admin.waitForSelector("#batch-drawer .history__item");
  const history = await admin.textContent("#batch-drawer .history");
  assert.match(history, /Planejamento totalmente aprovado/);
  assert.match(history, /Ajuste solicitado.*Maria \(pelo link\)/s);
  assert.match(await admin.textContent("#batch-drawer"), /identifica a sessão, não comprova a identidade/);
  await admin.click("#batch-drawer .batch-drawer__tools [data-menu-toggle]");
  const [download] = await Promise.all([admin.waitForEvent("download"), admin.click("#batch-drawer .menu [data-batch-report]")]);
  assert.match(download.suggestedFilename(), /^aprovacao-padaria-central-ltda-planejamento-do-mes\.pdf$/);
  const pdf = readFileSync(await download.path()).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-") && pdf.includes("Planejamento do m") && pdf.includes("Primeira fornada") && pdf.includes("Maria"));
  assert.ok(!pdf.includes("SEGREDO-DA-EQUIPE"));
});

await step("Visualizar como cliente (pré-visualização da equipe, sem botões)", async () => {
  const [preview] = await Promise.all([adminContext.waitForEvent("page"), admin.click("#batch-drawer [data-batch-preview]")]);
  watch(preview, "previa");
  await preview.waitForSelector(".ap-preview-bar");
  assert.equal(await preview.locator(".ap-card").count(), 3);
  assert.equal(await preview.locator("[data-ap-approve], [data-ap-all]").count(), 0);
  await preview.click(".ap-card [data-ap-open] >> nth=0");
  await preview.waitForSelector(".ap-detail[open] .ap-preview-note");
  assert.equal(await preview.locator(".ap-detail[open] [data-ap-approve]").count(), 0);
  await preview.close();
});

await step("Desativar o link bloqueia na hora; regenerar invalida o anterior", async () => {
  const old = await linkFor();
  await admin.click("#batch-drawer [data-batch-regenerate]");
  await confirmOk();
  await toastSays(admin, /Novo link gerado/);
  const fresh = await linkFor();
  assert.notEqual(fresh, old);
  await client.goto("about:blank");
  await client.goto(old);
  await client.waitForSelector(".ap-problem");
  assert.match(await client.textContent(".ap-problem"), /Link desativado/);
  await client.goto("about:blank");
  await client.goto(fresh);
  await client.waitForSelector(".ap-card");
  await admin.click("#batch-drawer [data-batch-revoke]");
  await confirmOk();
  await toastSays(admin, /Link desativado/);
  await client.reload();
  await client.waitForSelector(".ap-problem");
  assert.match(await client.textContent(".ap-problem"), /Link desativado/);
  assert.equal(await client.locator(".ap-card, img").count(), 0, "nada do lote nem arquivos");
  await shot(client, "ap06-desativado");
});

await step("Link inexistente ou incompleto: aviso sem dados", async () => {
  await client.goto("about:blank");
  await client.goto(`${ORIGIN}/aprovacao/#${"x".repeat(43)}`);
  await client.waitForSelector(".ap-problem");
  assert.match(await client.textContent(".ap-problem"), /Link não encontrado/);
  await client.goto("about:blank");
  await client.goto(`${ORIGIN}/aprovacao/`);
  await client.waitForSelector(".ap-problem");
});

await step("Celular (aprovação final): arte e legenda, decisão e agenda, sem rolagem lateral", async () => {
  // O depoimento ganha legenda (o final precisa de arte ou legenda)
  await store.updateContent(c3.id, { ...(await store.getContent(c3.id)), caption: "Há 20 anos com você." });
  const b2 = await store.createBatch({ client_id: padaria.id, title: "Arte final do mês", month: `${MONTH}-01`, approval_mode: "final" }, { id: "x", username: "admdg-teste" });
  await store.approvalSetItems({ id: "x", member: true, username: "admdg-teste" }, { p_batch: b2.id, p_contents: [c1.id, c3.id] });
  const { token } = await store.approvalPublish({ id: "x", member: true, username: "admdg-teste" }, { p_batch: b2.id, p_items: null, p_title: "Arte final do mês", p_intro: "", p_mode: "final" });
  const context = await newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  watch(page, "celular");
  await page.goto(`${ORIGIN}/aprovacao/#${token}`);
  await page.waitForSelector(".ap-card");
  assert.match(await page.textContent(".ap-mode"), /Aprovação de conteúdo final/);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 0, "sem rolagem lateral na lista");
  const cardHeight = await page.$eval(".ap-card__open", (b) => b.getBoundingClientRect().height);
  assert.ok(cardHeight >= 48 && cardHeight < 260, `cartão compacto e fácil de tocar (${cardHeight}px)`);
  assert.ok(await page.isVisible(".ap-bulkbar [data-ap-all]"), "aprovar todos fixo no rodapé");
  assert.ok(await page.isHidden(".ap-tools [data-ap-all]"), "sem botão repetido na barra do topo");
  // Final: a arte vai (link assinado) e a miniatura só aparece em quem tem arte
  await page.waitForFunction(() => document.querySelector(".ap-card img")?.naturalWidth > 0);
  assert.match(await page.getAttribute(".ap-card img", "src"), /\/storage\/v1\/object\/sign\/content-media\/.+\?token=/, "arte por link assinado");
  assert.equal(await page.locator(`${card("Depoimento de cliente")} .ap-thumb`).count(), 0, "sem arte: sem espaço de imagem");
  await shot(page, "ap07-celular", { fullPage: true });
  await page.tap(".ap-card [data-ap-open] >> nth=0");
  await page.waitForSelector(".ap-detail[open] [data-ap-approve]");
  const btn = await page.$eval(".ap-detail[open] [data-ap-approve]", (b) => b.getBoundingClientRect().height);
  assert.ok(btn >= 48, `botão de ${btn}px (fácil de tocar)`);
  assert.match(await page.textContent(".ap-detail[open]"), /Legenda.*Nada como pão quentinho/s);
  assert.ok(!(await page.textContent(".ap-detail[open]")).includes("Mostrar o pão"), "o final não repete a ideia");
  const fit = await page.$eval(".ap-detail[open] .ap-detail__panel", (p) => p.scrollWidth - p.clientWidth);
  assert.ok(fit <= 0, "detalhe sem rolagem lateral");
  await shot(page, "ap07b-celular-detalhe");
  // Deslizar para a esquerda passa para o próximo conteúdo
  await page.evaluate(() => {
    const el = document.querySelector(".ap-detail[open] .ap-detail__title");
    const at = (x) => [new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })];
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: at(300), changedTouches: at(300) }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: at(120) }));
  });
  await page.waitForFunction(() => /2 de 2/.test(document.querySelector(".ap-detail[open] .ap-detail__count")?.textContent || ""));
  await page.tap(".ap-detail[open] [data-ap-close]");
  await page.tap('[data-ap-layout="calendario"]');
  await page.waitForSelector(".ap-agenda .ap-chip");
  assert.ok(await page.isHidden(".ap-cal"), "no celular o calendário vira agenda");
  assert.ok(await overflow() <= 0, "sem rolagem lateral no calendário");
  await page.tap(".ap-agenda .ap-chip >> nth=0");
  await page.waitForSelector(".ap-dialog[open] [data-ap-approve]");
  await page.tap(".ap-dialog[open] [data-ap-approve]");
  await page.tap(".ap-dialog[open] [data-ap-approve-now]");
  await page.waitForSelector("dialog.ap-dialog--small [data-ap-skip]");
  await page.tap("dialog.ap-dialog--small [data-ap-skip]");
  await toastSays(page, /Conteúdo aprovado com sucesso!/);
  await shot(page, "ap08-celular-agenda");
  await context.close();
});

await step("Painel no celular: lista de lotes e gerenciar sem rolagem lateral", async () => {
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.click('#batch-drawer [data-action="close-drawer"]').catch(() => {});
  await admin.waitForSelector("#batch-drawer:not([open])", { state: "attached" });
  const overflow = () => admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 0, "lista sem rolagem lateral");
  await admin.click(".batch-card [data-batch-open]");
  await admin.waitForSelector("#batch-drawer .batch-item");
  const wide = await admin.$eval("#batch-drawer .drawer__panel", (p) => p.scrollWidth - p.clientWidth);
  assert.ok(wide <= 0, `gerenciar sem rolagem lateral (${wide}px)`);
  await shot(admin, "ap09-painel-celular");
  await admin.setViewportSize({ width: 1360, height: 900 });
});

await step("Excluir lote já enviado: confirma, some da lista, pendentes voltam a rascunho", async () => {
  await admin.reload();
  const target = '.batch-card:has(.batch-card__open:text-is("Arte final do mês"))';
  await admin.waitForSelector(target);
  const id = await admin.getAttribute(target, "data-batch");
  await admin.click(`${target} [data-menu-toggle]`); await admin.click(`${target} .menu [data-batch-delete]`);
  await admin.waitForSelector("#confirm-modal[open]");
  assert.match(await admin.textContent("#confirm-modal"), /já foi enviado.*link para de funcionar.*histórico de decisões.*voltam para rascunho/s);
  await confirmOk();
  await toastSays(admin, /Lote excluído/);
  await admin.waitForSelector(target, { state: "detached" });
  assert.equal((await store.listDecisions({ batch_id: id })).length, 0, "histórico do lote apagado");
  // Lote final: só o status FINAL volta; a ideia aprovada continua aprovada
  assert.equal((await store.getContent(c3.id)).final_status, "rascunho", "pendente volta para rascunho");
  assert.equal((await store.getContent(c3.id)).approval_status, "aprovado", "ideia continua aprovada");
  assert.equal((await store.getContent(c1.id)).final_status, "aprovado", "aprovado continua aprovado");
  assert.ok(await store.getContent(c3.id), "conteúdo continua no calendário");
  // O outro lote continua e também pode ser excluído pelo painel de gerenciar
  await admin.click(".batch-card [data-batch-open]");
  await admin.waitForSelector("#batch-drawer .batch-drawer__tools [data-menu-toggle]");
  await admin.click("#batch-drawer .batch-drawer__tools [data-menu-toggle]");
  await admin.click("#batch-drawer .menu [data-batch-delete]");
  await confirmOk();
  await toastSays(admin, /Lote excluído/);
  await admin.waitForSelector(".batch-card", { state: "detached" });
});

await step("Do conteúdo: 'Enviar para aprovação final' cria o lote final; sem arte nem legenda não vai", async () => {
  await admin.goto(`${ORIGIN}/admin/#/conteudos`);
  await admin.click(`.row [data-view-content="${c2.id}"]`);
  await admin.waitForSelector("#content-drawer [data-send-stage=final]");
  assert.match(await admin.textContent("#content-drawer .approval-box__stages"), /Aprovação da ideia.*Aprovado.*Aprovação final.*Não enviado/s);
  assert.match(await admin.textContent("#content-drawer"), /Planejamento.*vai no link da ideia.*Produção.*só vai ao cliente na aprovação final/s);
  await admin.waitForTimeout(400);
  await shot(admin, "ap11-conteudo-etapas");
  await admin.click("#content-drawer [data-send-stage=final]");
  await admin.waitForSelector("#publish-modal[open]");
  assert.ok(await admin.isChecked('#publish-modal [name="mode"][value="final"]'));
  await admin.click("#publish-modal [type=submit]");
  await admin.waitForSelector("#publish-modal .form-error:not([hidden])");
  assert.match(await admin.textContent("#publish-modal .form-error"), /precisa de arte.*ou legenda/);
  await admin.click('#publish-modal [data-action="close-modal"]');
  // Completa a produção (legenda e hashtags) e envia de novo
  await admin.goto(`${ORIGIN}/admin/#/conteudos`);
  await admin.click(`.row [data-edit-content="${c2.id}"]`);
  await admin.waitForSelector("#content-modal[open]");
  assert.match(await admin.textContent("#content-modal"), /1\. Planejamento.*2\. Produção.*3\. Interno/s);
  await shot(admin, "ap12-formulario", { fullPage: false });
  await admin.fill('#content-modal [name="caption"]', "Café especial + pão na chapa por R$ 9,90.");
  await admin.fill('#content-modal [name="hashtags"]', "#cafedamanha #padaria");
  await admin.fill('#content-modal [name="client_notes"]', "Arte com a nova logo.");
  await admin.click("#content-modal [type=submit]");
  await admin.waitForSelector("#content-modal", { state: "hidden" });
  await admin.click(`.row [data-view-content="${c2.id}"]`);
  await admin.click("#content-drawer [data-send-stage=final]");
  await admin.waitForSelector("#publish-modal[open]");
  await admin.click("#publish-modal [type=submit]");
  await toastSays(admin, /Link copiado/);
  const saved = await store.getContent(c2.id);
  assert.deepEqual([saved.approval_status, saved.final_status], ["aprovado", "aguardando_aprovacao"], "ideia e final independentes");
  const link = await admin.evaluate(() => navigator.clipboard.readText());
  await client.goto("about:blank");
  await client.goto(link);
  await client.waitForSelector(".ap-card");
  await openDetail(client, "Promoção do café");
  assert.match(await client.textContent(DETAIL), /Legenda.*Café especial \+ pão na chapa.*#cafedamanha.*Observações.*Arte com a nova logo/s);
  await shot(client, "ap10-final-detalhe");
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

console.log(`\n${results.filter((r) => r.startsWith("✔")).length} verificações passaram.`);
if (process.exitCode) console.log("Algum teste falhou.");
await browser.close();
server.close();
