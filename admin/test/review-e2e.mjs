/* Teste de ponta a ponta: foto do cliente, arte final e aprovação.
   Painel da agência e portal do cliente lado a lado, sobre o Supabase de
   mentira (banco + armazenamento de arquivos em memória).
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/review-e2e.mjs
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
const PORT = 5613;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const FIX = (name) => readFileSync(path.join(HERE, "fixtures", name));

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const D = (day) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe DG" });
fake.addUser("padaria", "Senha-padaria-123", { kind: "cliente", clientId: padaria.id });
fake.addUser("estudio", "Senha-estudio-123", { kind: "cliente", clientId: estudio.id });
const lancamento = await store.createContent(validateContent({ client_id: padaria.id, title: "Carrossel de lançamento", scheduled_date: D(18), scheduled_time: "11:00", network: "instagram", format: "carrossel", media_url: "https://cdn.exemplo.com/referencia.png", caption: "Novidade no forno!", status: "em_producao" }).value);
const outro = await store.createContent(validateContent({ client_id: estudio.id, title: "Post do Estúdio", scheduled_date: D(18), network: "instagram", format: "post", status: "aguardando_aprovacao" }).value);
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
let admin = null;
let portal = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) {
      const name = label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      await admin?.screenshot({ path: `${SHOTS}/falha-painel-${name}.png` }).catch(() => {});
      await portal?.screenshot({ path: `${SHOTS}/falha-portal-${name}.png` }).catch(() => {});
      console.log("   portal:", (await portal?.evaluate(() => document.querySelector("#drawer")?.innerText?.slice(0, 600)).catch(() => ""))?.replace(/\s+/g, " "));
    }
  }
  console.log(results.at(-1));
};

const browser = await chromium.launch();
const consoleErrors = [];
async function newContext(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...options });
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    if (answer === "abort") return route.abort("failed");
    return route.fulfill(answer);
  });
  await context.route("https://cdn.exemplo.com/**", (route) => route.request().url().endsWith(".webm")
    ? route.fulfill({ status: 200, contentType: "video/webm", body: FIX("video.webm") })
    : route.fulfill({ status: 200, contentType: "image/png", body: FIX("arte.png") }));
  // Capa oficial do YouTube (sem internet nos testes)
  await context.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: FIX("arte2.png") }));
  await context.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>Player</p>" }));
  return context;
}
const watch = (page, name) => {
  page.setDefaultTimeout(8000);
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
};
const shot = async (page, name) => { if (!SHOTS) return; await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const signIn = async (page, username, password) => {
  await page.fill('#login-form [name="username"]', username);
  await page.fill('#login-form [name="password"]', password);
  await page.click("#login-form [type=submit]");
  await page.waitForSelector("#app:not([hidden])");
};
const toastSays = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".toast:last-child")?.textContent || ""), re.source);

const adminContext = await newContext();
admin = await adminContext.newPage();
watch(admin, "painel");
const portalContext = await newContext();
portal = await portalContext.newPage();
watch(portal, "portal");

/** Abre os detalhes do conteúdo no painel (recarregando a lista) */
async function adminOpen(title) {
  if (await admin.isVisible("#content-drawer[open]")) {
    await admin.click('#content-drawer [data-action="close-drawer"]');
    await admin.waitForSelector("#content-drawer:not([open])", { state: "attached" });
  }
  await admin.click('[data-route="conteudos"]');
  await admin.click('#filters [type="reset"]');
  await admin.waitForSelector(`.row__title:text("${title}")`);
  await admin.click(`.row__title:text("${title}")`);
  await admin.waitForSelector("#content-drawer[open] [data-final-art]");
}
const portalRefocus = () => portal.evaluate(() => window.dispatchEvent(new Event("focus")));
async function portalOpen(title, statusText) {
  await portalRefocus();
  await portal.waitForFunction(([t, s]) => [...document.querySelectorAll(".chip")].some((c) => c.textContent.includes(t) && (!s || c.getAttribute("aria-label").includes(s))), [title, statusText || ""]);
  await portal.click(`.chip:has-text("${title}")`);
  await portal.waitForSelector("#drawer[open]");
}
const closePortal = async () => { await portal.click('#drawer [data-do="close"]'); await portal.waitForSelector("#drawer:not([open])", { state: "attached" }); };

/* ============================== Testes ============================== */

await step("Entrar no painel e no portal", async () => {
  await admin.goto(`${ORIGIN}/admin/`);
  await signIn(admin, "admdg-teste", "Senha-de-teste-123");
  await portal.goto(`${ORIGIN}/`);
  await signIn(portal, "padaria", "Senha-padaria-123");
  assert.equal(await portal.locator("#profile-avatar img").count(), 0, "sem foto ainda: iniciais");
});

await step("Foto do cliente: escolher, salvar e aparecer no cartão", async () => {
  await admin.click('[data-route="clientes"]');
  await admin.click('.client-card:has-text("Padaria Central") [data-edit-client]');
  await admin.waitForSelector("#client-modal[open]");
  await admin.setInputFiles('#client-modal [name="logo"]', { name: "logo.png", mimeType: "image/png", buffer: FIX("arte2.png") });
  await admin.waitForSelector("#client-modal [data-logo-preview] img");
  await shot(admin, "r01-foto-cliente");
  await admin.click("#client-modal [type=submit]");
  await admin.waitForSelector('.client-card:has-text("Padaria Central") img.avatar--photo');
  const src = await admin.getAttribute('.client-card:has-text("Padaria Central") img.avatar--photo', "src");
  assert.match(src, /\/storage\/v1\/object\/public\/client-logos\/[0-9a-f-]{36}\/[a-z0-9-]+\.(webp|png)$/);
  await admin.waitForFunction(() => document.querySelector(".client-card img.avatar--photo")?.naturalWidth > 0);
  const saved = (await store.listClients()).find((c) => c.id === padaria.id);
  const file = fake.files.get(`client-logos/${saved.logo_path}`);
  assert.ok(file && file.body.length < FIX("arte2.png").length * 4, "foto guardada (reduzida no navegador)");
});

await step("Foto aparece no portal do cliente", async () => {
  await portal.reload();
  await portal.waitForSelector("#profile-avatar img");
  await portal.waitForFunction(() => document.querySelector("#profile-avatar img")?.naturalWidth > 0);
  assert.equal(await portal.locator("#client-badge img, #client-badge .avatar").count(), 0, "logo só uma vez no topo (no botão do perfil)");
  assert.ok((await portal.getAttribute("#profile-avatar img", "src")).includes("client-logos"));
});

await step("Arte final: enviar duas imagens e um link de vídeo, na ordem", async () => {
  await adminOpen("Carrossel de lançamento");
  assert.match(await admin.textContent("#content-drawer .final-art__empty"), /Nenhuma arte final/);
  await admin.setInputFiles("#content-drawer [data-final-files]", [
    { name: "capa.png", mimeType: "image/png", buffer: FIX("arte.png") },
    { name: "segunda.png", mimeType: "image/png", buffer: FIX("arte2.png") }
  ]);
  await toastSays(admin, /2 arquivos enviados/);
  await admin.waitForFunction(() => document.querySelectorAll("#content-drawer .final-item").length === 2);
  await admin.fill('#content-drawer [name="asset_url"]', "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await admin.click("#content-drawer [data-final-link] [type=submit]");
  await admin.waitForFunction(() => document.querySelectorAll("#content-drawer .final-item").length === 3);
  await admin.waitForFunction(() => [...document.querySelectorAll("#content-drawer .final-item img")].every((i) => i.naturalWidth > 0));
  await admin.waitForSelector("#content-drawer .final-item:nth-child(3) iframe");
  assert.equal(await admin.locator("#content-drawer .final-item iframe").count(), 1, "link do YouTube no player oficial");
  assert.equal([...fake.files.keys()].filter((k) => k.startsWith("content-media/")).length, 2);
  // Ordem: o vídeo passa para o 2º lugar
  await admin.click("#content-drawer .final-item:nth-child(3) [data-asset-move='-1']");
  await admin.waitForFunction(() => document.querySelector("#content-drawer .final-item:nth-child(2) iframe"));
  assert.ok((await store.getContent(lancamento.id)).version > 1, "arte final sobe a versão");
  await shot(admin, "r02-arte-final");
});

await step("Arquivo de tipo não aceito é recusado com aviso", async () => {
  await admin.setInputFiles("#content-drawer [data-final-files]", { name: "planilha.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await admin.waitForSelector("#content-drawer .upload.is-error");
  assert.match(await admin.textContent("#content-drawer .upload.is-error"), /Formato não aceito/);
  assert.equal(await admin.locator("#content-drawer .final-item").count(), 3);
});

await step("Enviar para aprovação", async () => {
  await admin.click("#content-drawer [data-send-approval]");
  await toastSays(admin, /Enviado para o cliente aprovar/);
  await admin.waitForFunction(() => /Aguardando o cliente aprovar/.test(document.querySelector("#content-drawer [data-approval-actions]")?.textContent || ""));
  assert.equal((await store.getContent(lancamento.id)).status, "aguardando_aprovacao");
});

let versionSent = 0;
await step("Portal: carrossel com a arte final e a referência", async () => {
  versionSent = (await store.getContent(lancamento.id)).version;
  await portalOpen("Carrossel de lançamento", "Aguardando");
  await portal.waitForSelector("#drawer .carousel");
  assert.match(await portal.textContent("#drawer .detail--final .detail__title"), /Conteúdo para você aprovar/);
  assert.equal(await portal.locator("#drawer .carousel__slide").count(), 3);
  assert.equal((await portal.textContent("#drawer .carousel__count")).trim(), "1 de 3");
  await portal.waitForFunction(() => document.querySelector("#drawer .carousel__slide img")?.naturalWidth > 0);
  assert.match(await portal.getAttribute("#drawer .carousel__slide img", "src"), /\/storage\/v1\/object\/sign\/content-media\/.+\?token=/, "arquivo privado por link assinado");
  await portal.click('#drawer [data-carousel-step="1"]');
  await portal.waitForFunction(() => document.querySelector("#drawer .carousel__count b").textContent === "2");
  assert.equal(await portal.locator("#drawer .carousel__slide:nth-child(2) iframe").count(), 1);
  assert.match(await portal.textContent("#drawer"), /Referência/);
  await shot(portal, "r03-portal-carrossel");
});

await step("Cliente pede ajuste com mensagem", async () => {
  await portal.click('#drawer [data-do="request"]');
  await portal.click('#drawer [data-form="change"] [type=submit]');
  assert.equal(await portal.getAttribute('#drawer [name="message"]', "aria-invalid"), "true", "mensagem obrigatória");
  await portal.fill('#drawer [name="message"]', "Trocar a foto da capa por uma mais clara");
  await portal.click('#drawer [data-form="change"] [type=submit]');
  await portal.waitForSelector("#drawer .decision--ajustes");
  assert.match(await portal.textContent("#drawer .decision--ajustes"), /Trocar a foto da capa/);
  assert.match(await portal.textContent("#drawer .drawer__badges"), /Ajustes solicitados/);
  assert.equal(await portal.locator('#drawer [data-do="confirm"]').count(), 0, "sem aprovar enquanto a equipe ajusta");
  await shot(portal, "r04-portal-ajuste");
  await closePortal();
});

await step("Painel mostra o pedido de ajuste no histórico", async () => {
  await adminOpen("Carrossel de lançamento");
  await admin.waitForSelector("#content-drawer .history__item--ajustes");
  assert.match(await admin.textContent("#content-drawer .history__item--ajustes"), /Cliente pediu ajuste.*versão \d+.*Trocar a foto da capa/s);
  assert.match(await admin.textContent("#content-drawer .drawer__badges"), /Ajustes solicitados/);
  assert.match(await admin.textContent('.row:has-text("Carrossel de lançamento") .row__status'), /Ajustes solicitados/);
});

await step("Equipe troca a capa e envia a nova versão", async () => {
  await admin.click("#content-drawer .final-item:nth-child(1) [data-asset-delete]");
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await admin.waitForFunction(() => document.querySelectorAll("#content-drawer .final-item").length === 2);
  assert.equal([...fake.files.keys()].filter((k) => k.startsWith("content-media/")).length, 1, "arquivo apagado do armazenamento");
  await admin.setInputFiles("#content-drawer [data-final-files]", { name: "capa-nova.png", mimeType: "image/png", buffer: FIX("arte2.png") });
  await admin.waitForFunction(() => document.querySelectorAll("#content-drawer .final-item").length === 3);
  await admin.click("#content-drawer [data-send-approval]");
  await admin.waitForFunction(() => /Aguardando o cliente aprovar/.test(document.querySelector("#content-drawer [data-approval-actions]")?.textContent || ""));
  assert.ok((await store.getContent(lancamento.id)).version > versionSent);
});

await step("Versão desatualizada: aprovar a versão antiga é recusado com aviso", async () => {
  await portalOpen("Carrossel de lançamento", "Aguardando");
  // A equipe mexe na arte enquanto o cliente está olhando
  const fresh = await store.listAssets(lancamento.id);
  await store.moveAsset(fresh[0].id, 99);
  await portal.click('#drawer [data-do="confirm"]');
  await portal.click('#drawer [data-do="approve"]');
  await toastSays(portal, /atualizou este conteúdo/);
  assert.equal((await store.getContent(lancamento.id)).status, "aguardando_aprovacao");
});

await step("Cliente aprova a versão atual", async () => {
  await portal.waitForSelector('#drawer [data-do="confirm"]');
  await portal.click('#drawer [data-do="confirm"]');
  await portal.click('#drawer [data-do="approve"]');
  await portal.waitForSelector("#drawer .decision--aprovado");
  assert.match(await portal.textContent("#drawer .decision--aprovado"), /Você aprovou em/);
  assert.equal((await store.getContent(lancamento.id)).status, "aprovado");
  await closePortal();
});

await step("Painel: aprovado no histórico e marcar como publicado", async () => {
  await adminOpen("Carrossel de lançamento");
  await admin.waitForSelector("#content-drawer .history__item--aprovado");
  await shot(admin, "r05-historico");
  await admin.click("#content-drawer [data-mark-published]");
  await admin.waitForFunction(() => /Conteúdo publicado/.test(document.querySelector("#content-drawer [data-approval-actions]")?.textContent || ""));
  await portalOpen("Carrossel de lançamento", "Publicado");
  assert.match(await portal.textContent("#drawer .decision"), /Conteúdo publicado/);
  await closePortal();
});

await step("Arquivos de outro cliente: o cliente não consegue o link nem envia arquivos", async () => {
  const otherPath = `${estudio.id}/${outro.id}/segredo.png`;
  fake.files.set(`content-media/${otherPath}`, { type: "image/png", body: FIX("arte.png") });
  await store.addAsset({ content_id: outro.id, kind: "image", storage_path: otherPath, position: 0 });
  const attempt = await portal.evaluate(async ({ url, key, otherPath, contentId }) => {
    const session = JSON.parse(localStorage.getItem("dg-portal-sessao"));
    const headers = { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
    const sign = await fetch(`${url}/storage/v1/object/sign/content-media`, { method: "POST", headers, body: JSON.stringify({ paths: [otherPath], expiresIn: 60 }) }).then((r) => r.json());
    const upload = await fetch(`${url}/storage/v1/object/content-media/x/${contentId}/invasao.png`, { method: "POST", headers: { ...headers, "Content-Type": "image/png" }, body: "x" }).then((r) => r.status);
    const decide = await fetch(`${url}/rest/v1/rpc/portal_decide`, { method: "POST", headers, body: JSON.stringify({ p_content_id: contentId, p_version: 1, p_decision: "aprovado" }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const assets = await fetch(`${url}/rest/v1/content_assets?select=*`, { headers }).then((r) => r.json());
    return { sign, upload, decide, assets };
  }, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, otherPath, contentId: outro.id });
  assert.equal(attempt.sign[0].signedURL, null, "sem link para arquivo de outro cliente");
  assert.equal(attempt.upload, 403, "cliente não envia arquivos");
  assert.match(attempt.decide.body.message, /conteudo_nao_encontrado/, "não aprova conteúdo de outro cliente");
  assert.deepEqual(attempt.assets, [], "não lê a tabela de arte final");
  assert.equal((await store.getContent(outro.id)).status, "aguardando_aprovacao");
});

await step("Celular: carrossel cabe na tela e passa com as setas", async () => {
  await store.setContentStatus(lancamento.id, "aguardando_aprovacao");
  const context = await newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  watch(page, "portal-celular");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "padaria", "Senha-padaria-123");
  await page.tap(`.cal__cell[data-day="${D(18)}"] .cal__date`);
  await page.tap('.agenda__item:has-text("Carrossel de lançamento")');
  await page.waitForSelector("#drawer[open] .carousel");
  const box = await page.$eval("#drawer .carousel__track", (t) => ({ w: t.getBoundingClientRect().width, vw: window.innerWidth }));
  assert.ok(box.w <= box.vw, `carrossel ${box.w}px`);
  await page.tap('#drawer [data-carousel-step="1"]');
  await page.waitForFunction(() => document.querySelector("#drawer .carousel__count b").textContent === "2");
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/r06-celular-carrossel.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `rolagem lateral de ${overflow}px`);
  await context.close();
});

await step("Tirar a foto do cliente", async () => {
  await admin.click('#content-drawer [data-action="close-drawer"]');
  await admin.waitForSelector("#content-drawer:not([open])", { state: "attached" });
  await admin.click('[data-route="clientes"]');
  await admin.click('.client-card:has-text("Padaria Central") [data-edit-client]');
  await admin.click("#client-modal [data-logo-remove]");
  await admin.click("#client-modal [type=submit]");
  await admin.waitForFunction(() => !document.querySelector(".client-card img.avatar--photo"));
  assert.equal([...fake.files.keys()].filter((k) => k.startsWith("client-logos/")).length, 0, "arquivo da foto apagado");
});

await step("Importar: modelo para baixar e escolha do cliente", async () => {
  await admin.click('[data-route="importar"]');
  await admin.waitForSelector("#view-importar:not([hidden])");
  const template = await admin.evaluate(async () => { const r = await fetch("modelo-importacao-conteudos.xlsx"); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, zip: b[0] === 0x50 && b[1] === 0x4b }; });
  assert.deepEqual(template, { status: 200, zip: true });
  const options = await admin.$$eval('#import-form [name="client_id"] option', (o) => o.map((x) => x.textContent));
  assert.ok(options.includes("Padaria Central Ltda") && options.includes("Estúdio Luz"));
  // Sem cliente: pede para escolher
  await admin.setInputFiles('#import-form [name="file"]', { name: "importacao.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: FIX("importacao.xlsx") });
  await admin.waitForSelector("#import-preview .state__title");
  if (await admin.inputValue('#import-form [name="client_id"]') === "") assert.match(await admin.textContent("#import-preview"), /Escolha o cliente/);
});

await step("Importar: prévia organiza, valida e marca repetidos", async () => {
  await store.createContent(validateContent({ client_id: padaria.id, title: "Já existe", scheduled_date: "2027-03-15", network: "linkedin", format: "outro" }).value);
  await admin.selectOption('#import-form [name="client_id"]', { label: "Padaria Central Ltda" });
  await admin.waitForSelector("#import-preview .imp-table");
  const rows = await admin.$$eval("#import-preview .imp-row:not(.imp-row--head)", (r) => r.map((x) => ({ line: Number(x.dataset.line), text: x.textContent.replace(/\s+/g, " "), error: x.classList.contains("is-error"), checked: x.querySelector("input").checked })));
  assert.equal(rows.length, 7);
  const byTitle = (t) => rows.find((r) => r.text.includes(t));
  assert.match(byTitle("Importado com imagem").text, /10\/03\/2027.*9h.*Instagram.*Post.*Aguardando aprovação.*Pronto/);
  assert.match(byTitle("Importado com vídeo").text, /11\/03\/2027.*14h.*Instagram.*Carrossel.*Planejado/);
  assert.match(byTitle("Importado sem ano").text, /Facebook.*Stories.*Data sem ano/);
  assert.ok(byTitle("Sem rede").error && /Informe a rede social/.test(byTitle("Sem rede").text));
  assert.ok(rows.find((r) => r.line === 8).error, "linha sem título");
  assert.ok(byTitle("Data impossível").error && /Data inválida/.test(byTitle("Data impossível").text));
  assert.ok(!byTitle("Já existe").error && !byTitle("Já existe").checked && /Já existe um conteúdo/.test(byTitle("Já existe").text), "repetido vem desmarcado");
  assert.match(await admin.textContent("#import-preview .imp-summary"), /4 prontos.*3 com erro.*1 parece repetido/s);
  await admin.waitForFunction(() => document.querySelector("#import-preview [data-imp-thumb]")?.naturalWidth > 0);
  assert.equal(await admin.locator("#import-preview .imp-ref--video, #import-preview .imp-ref--has-video").count(), 1, "referência em vídeo identificada");
  assert.match(await admin.textContent("[data-imp-run]"), /Importar 3 conteúdos/);
  await shot(admin, "r07-importar-previa");
});

await step("Importar: grava os marcados e leva aos conteúdos do cliente", async () => {
  const before = (await store.listContents({ client_id: padaria.id })).length;
  await admin.click("[data-imp-run]");
  await admin.waitForSelector("#import-preview [data-imp-see]");
  assert.match(await admin.textContent("#import-preview .state__title"), /3 conteúdos importados para Padaria Central Ltda/);
  const after = await store.listContents({ client_id: padaria.id });
  assert.equal(after.length, before + 3);
  const imported = after.find((c) => c.title === "Importado com imagem");
  assert.deepEqual([imported.scheduled_date, imported.scheduled_time, imported.network, imported.format, imported.status, imported.media_kind, imported.client_notes, imported.internal_notes], ["2027-03-10", "09:00:00", "instagram", "post", "aguardando_aprovacao", "image", "Confira a cor", "Interno: margem"]);
  assert.equal(after.find((c) => c.title === "Importado com vídeo").media_kind, "image", "carrossel com link: tipo pelo formato");
  await admin.click("#import-preview [data-imp-see]");
  await admin.waitForURL(new RegExp(`client_id=${padaria.id}`));
  await admin.waitForFunction(() => [...document.querySelectorAll(".row__title")].some((n) => n.textContent === "Importado com imagem"));
});

await step("Importar: CSV com ponto e vírgula e arquivo inválido", async () => {
  await admin.click('[data-route="importar"]');
  await admin.selectOption('#import-form [name="client_id"]', { label: "Estúdio Luz" });
  const csv = "Título;Data;Rede social;Formato;Legenda\n\"Ensaio; parte 1\";20/04/2027;Instagram;Reels;\"Texto com \"\"aspas\"\"\"\n";
  await admin.setInputFiles('#import-form [name="file"]', { name: "estudio.csv", mimeType: "text/csv", buffer: Buffer.from(`\uFEFF${csv}`) });
  await admin.waitForSelector("#import-preview .imp-table");
  const csvRow = (await admin.textContent("#import-preview .imp-row:not(.imp-row--head)")).replace(/\s+/g, " ");
  assert.match(csvRow, /20\/04\/2027.*Ensaio; parte 1.*Texto com "aspas".*Reels/, csvRow);
  await admin.setInputFiles('#import-form [name="file"]', { name: "falsa.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("isto não é uma planilha") });
  await admin.waitForSelector("#import-preview .state--error");
  assert.match(await admin.textContent("#import-preview"), /não parece ser uma planilha/);
});

await step("Capa do vídeo de referência na lista (YouTube e arquivo de vídeo)", async () => {
  const base = { client_id: padaria.id, network: "instagram", format: "reels", media_kind: "video", status: "planejado" };
  await store.createContent(validateContent({ ...base, title: "Massa A (YouTube)", scheduled_date: D(25), media_url: "https://youtu.be/dQw4w9WgXcQ" }).value);
  await store.createContent(validateContent({ ...base, title: "Massa B (arquivo)", scheduled_date: D(26), media_url: "https://cdn.exemplo.com/clipe.webm" }).value);
  await store.createContent(validateContent({ ...base, title: "Massa C (Instagram)", scheduled_date: D(27), media_url: "https://www.instagram.com/reel/abc123/" }).value);
  await admin.click('[data-route="conteudos"]');
  await admin.click('#filters [type="reset"]');
  await admin.waitForSelector('.row:has-text("Massa A") .row__thumb img');
  assert.match(await admin.getAttribute('.row:has-text("Massa A") .row__thumb img', "src"), /^https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg$/);
  await admin.waitForFunction(() => document.querySelector('[data-row] .row__thumb img[src*="ytimg"]')?.naturalWidth > 0);
  assert.equal(await admin.locator('.row:has-text("Massa A") .row__play').count(), 1, "selo de vídeo sobre a capa");
  await admin.waitForFunction(() => [...document.querySelectorAll(".row")].find((r) => r.textContent.includes("Massa B"))?.querySelector("video")?.readyState >= 1);
  assert.equal(await admin.locator('.row:has-text("Massa C") .row__thumb--video').count(), 1, "Instagram não dá capa: fica o ícone de play");
  await shot(admin, "r08-capas-video");
});

await step("Status em massa: marcar vários, confirmar e o cliente passa a ver", async () => {
  assert.ok(await admin.isHidden("#bulk-bar"), "barra só aparece com algo marcado");
  for (const t of ["Massa A", "Massa B", "Massa C"]) await admin.check(`.row:has-text("${t}") [data-pick]`);
  assert.equal(await admin.textContent("#bulk-bar [data-bulk-count]"), "3");
  assert.equal(await admin.inputValue("#bulk-bar [data-bulk-status]"), "aguardando_aprovacao", "padrão: enviar para aprovação");
  await shot(admin, "r09-status-em-massa");
  // Cancelar a confirmação não muda nada
  await admin.click("#bulk-bar [data-bulk-apply]");
  await admin.waitForSelector("#confirm-modal[open]");
  assert.match(await admin.textContent("#confirm-modal"), /Mudar 3 conteúdos para "Aguardando aprovação"\?.*3 passam a aparecer no calendário do cliente/s);
  assert.equal(await admin.getAttribute('#confirm-modal [data-confirm="ok"]', "class"), "btn btn--primary", "mudança comum: botão roxo, não vermelho");
  await admin.click('#confirm-modal [data-confirm="cancel"]');
  assert.equal((await store.listContents({ client_id: padaria.id })).filter((c) => c.title.startsWith("Massa") && c.status === "planejado").length, 3);
  // Confirmar
  await admin.click("#bulk-bar [data-bulk-apply]");
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await toastSays(admin, /3 conteúdos atualizados para "Aguardando aprovação"/);
  await admin.waitForSelector("#bulk-bar", { state: "hidden" });
  const after = (await store.listContents({ client_id: padaria.id })).filter((c) => c.title.startsWith("Massa"));
  assert.deepEqual(after.map((c) => c.status), ["aguardando_aprovacao", "aguardando_aprovacao", "aguardando_aprovacao"]);
  assert.equal(await admin.locator('.row:has-text("Massa A") .row__status').textContent(), "Aguardando aprovação");
  // Selecionar todos / desmarcar todos
  await admin.click("[data-bulk-all]");
  assert.equal(Number(await admin.textContent("#bulk-bar [data-bulk-count]")), await admin.locator("[data-pick]").count());
  await admin.click("[data-bulk-all]");
  await admin.waitForSelector("#bulk-bar", { state: "hidden" });
  // O cliente já vê, com a capa do YouTube no carrossel
  await portalRefocus();
  await portal.waitForFunction(() => [...document.querySelectorAll(".slide__title")].some((n) => n.textContent === "Massa A (YouTube)"));
  assert.match(await portal.getAttribute('.slide:has-text("Massa A (YouTube)") .slide__media img', "src"), /i\.ytimg\.com/);
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

await browser.close();
server.close();
console.log(process.exitCode ? "\nAlgum teste falhou." : `\n${results.length} verificações passaram.`);
