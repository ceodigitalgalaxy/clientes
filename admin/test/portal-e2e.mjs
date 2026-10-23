/* Teste de ponta a ponta: painel da agência → calendário do cliente.
   O painel e o portal abrem lado a lado (navegadores separados) sobre o mesmo
   Supabase de mentira em memória (fake-supabase.mjs). Nada sai para a
   internet: imagens, vídeos e o player do YouTube são respondidos aqui.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/portal-e2e.mjs
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
const PORT = 5612;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const FIXTURES = { png: readFileSync(path.join(HERE, "fixtures/arte.png")), webm: readFileSync(path.join(HERE, "fixtures/video.webm")) };

/* Datas do mês atual (o portal abre nele) */
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const NEXT = (() => { const d = new Date(now.getFullYear(), now.getMonth() + 1, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
const D = (day) => `${MONTH}-${pad(day)}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", segment: "Fotografia", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe DG" });
fake.addUser("padaria", "Senha-padaria-123", { kind: "cliente", clientId: padaria.id });
fake.addUser("estudio", "Senha-estudio-123", { kind: "cliente", clientId: estudio.id });
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) { results.push(`✘ ${label}: ${error.message.split("\n")[0]}`); process.exitCode = 1; }
  console.log(results.at(-1));
};

/* ---------- Navegadores ---------- */
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
  // Mídias de referência (sem internet)
  await context.route("https://cdn.exemplo.com/**", (route) => {
    const url = route.request().url();
    if (url.includes("arte.png")) return route.fulfill({ status: 200, contentType: "image/png", body: FIXTURES.png });
    if (url.includes("video.webm")) return route.fulfill({ status: 200, contentType: "video/webm", body: FIXTURES.webm });
    return route.fulfill({ status: 404, body: "não encontrado" });
  });
  await context.route("https://www.instagram.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>post</title><p>Post do Instagram</p>" }));
  await context.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title><p>Player do YouTube</p>" }));
  return context;
}
const watch = (page, name) => {
  page.setDefaultTimeout(8000);
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(600);   // espera a animação do painel lateral terminar
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

const adminContext = await newContext();
const admin = await adminContext.newPage();
watch(admin, "painel");
const portalContext = await newContext();
const portal = await portalContext.newPage();
watch(portal, "portal");

/* ---------- Ajudantes ---------- */
async function adminCreate(data) {
  await admin.waitForSelector("#content-modal:not([open])", { state: "attached" });
  await admin.click('.view__head [data-action="new-content"]');
  await admin.selectOption('#content-modal [name="client_id"]', { label: data.client });
  for (const [name, value] of Object.entries(data)) {
    if (name === "client") continue;
    const el = admin.locator(`#content-modal [name="${name}"]`).first();
    if ((await el.evaluate((n) => n.tagName)) === "SELECT") await el.selectOption(value); else await el.fill(value);
  }
  await admin.click("#content-modal [type=submit]");
  await admin.waitForFunction((t) => [...document.querySelectorAll(".row__title")].some((n) => n.textContent === t), data.title);
}
async function adminEdit(title, changes) {
  await admin.click(`.row:has-text("${title}") [data-edit-content]`);
  await admin.waitForSelector("#content-modal[open]");
  for (const [name, value] of Object.entries(changes)) await admin.fill(`#content-modal [name="${name}"]`, value);
  await admin.click("#content-modal [type=submit]");
  await admin.waitForSelector("#content-modal:not([open])", { state: "attached" });
}
/** O cliente volta para a aba do portal: a página busca os dados de novo sozinha */
const portalRefocus = (page = portal) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const chipTitles = (page = portal) => page.$$eval(".cal .chip__title", (n) => n.map((x) => x.textContent));
const chipsOn = (iso, page = portal) => page.$$eval(`.cal__cell[data-day="${iso}"] .chip__title`, (n) => n.map((x) => x.textContent));
const signIn = async (page, username, password) => {
  await page.fill('#login-form [name="username"]', username);
  await page.fill('#login-form [name="password"]', password);
  await page.click("#login-form [type=submit]");
};
const toastSays = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source);
const restCalls = () => fake.log.filter((r) => r.path.startsWith("/rest/"));

/* ============================== Testes ============================== */

await step("Portal sem login: só a entrada, nenhum dado pedido ao banco", async () => {
  await portal.goto(`${ORIGIN}/`);
  await portal.waitForSelector("#login:not([hidden])");
  assert.equal(await portal.isVisible("#app"), false);
  assert.equal(restCalls().length, 0);
  await shot(portal, "p00-entrar");
});

await step("Conta da equipe não entra no portal do cliente", async () => {
  await signIn(portal, "admdg-teste", "Senha-de-teste-123");
  await portal.waitForFunction(() => /Usuário ou senha incorretos/.test(document.querySelector("#login .form-error").textContent));
  assert.equal(await portal.isVisible("#app"), false);
});

await step("Cliente entra e vê o próprio portal, ainda vazio", async () => {
  await signIn(portal, "padaria", "Senha-padaria-123");
  await portal.waitForSelector("#app:not([hidden])");
  assert.equal(await portal.textContent("#welcome-hello"), "Olá, Padaria Central Ltda!");
  await portal.waitForSelector(".cal__empty-title");
  assert.equal(await portal.textContent(".cal__empty-title"), "Ainda não há conteúdos liberados para este mês");
  assert.equal(await portal.isVisible("#ideias"), false, "ideias ainda não existem no banco");
  assert.equal(await portal.isVisible('[data-action="new-idea"]'), false, "botão de ideia escondido");
  assert.equal(await portal.isVisible('[data-action="show-ideas"]'), false);
  assert.equal(await portal.isVisible('[data-action="refresh"]'), true);
});

await step("Equipe entra no painel da agência", async () => {
  await admin.goto(`${ORIGIN}/admin/`);
  await signIn(admin, "admdg-teste", "Senha-de-teste-123");
  await admin.waitForSelector("#app:not([hidden])");
  await admin.click('[data-route="clientes"]');
  await admin.waitForSelector('.client-card:has-text("Padaria Central")');
  assert.equal(await admin.textContent('.client-card:has-text("Padaria Central") .portal-user__name'), "padaria");
  await admin.click('[data-route="conteudos"]');
});

await step("Imagem cadastrada no painel aparece na data certa do calendário", async () => {
  await adminCreate({ client: "Padaria Central Ltda", title: "Pão de fermentação natural", scheduled_date: D(10), scheduled_time: "10:30", network: "instagram", format: "post", media_url: "https://cdn.exemplo.com/arte.png", caption: "Chegou o pão que você pediu!", client_notes: "Confira a cor da embalagem.", internal_notes: "SEGREDO: margem baixa", status: "aguardando_aprovacao" });
  // Do mesmo cliente, mas ainda em produção: não aparece
  await adminCreate({ client: "Padaria Central Ltda", title: "Rascunho escondido", scheduled_date: D(11), network: "instagram", format: "post", status: "planejado" });
  // De outro cliente: não aparece
  await adminCreate({ client: "Estúdio Luz", title: "Conteúdo do Estúdio", scheduled_date: D(10), network: "instagram", format: "post", status: "aguardando_aprovacao" });
  await portalRefocus();
  await portal.waitForFunction((iso) => document.querySelector(`.cal__cell[data-day="${iso}"] .chip__title`)?.textContent === "Pão de fermentação natural", D(10));
  assert.deepEqual(await chipsOn(D(10)), ["Pão de fermentação natural"]);
  assert.equal(await portal.textContent(`.cal__cell[data-day="${D(10)}"] .chip__meta`), "10h30");
});

await step("Conteúdos de outros clientes, em produção e observações internas não aparecem", async () => {
  const titles = await chipTitles();
  assert.ok(!titles.includes("Conteúdo do Estúdio"), "outro cliente");
  assert.ok(!titles.includes("Rascunho escondido"), "status planejado");
  const html = await portal.content();
  assert.ok(!html.includes("SEGREDO"), "observação interna");
  assert.ok(!html.includes("Estúdio Luz"));
});

await step("Detalhes: título, imagem proporcional, legenda, rede, data, status e observação", async () => {
  await portal.click(`.cal__cell[data-day="${D(10)}"] .chip`);
  await portal.waitForSelector("#drawer[open] .media--image img");
  assert.equal(await portal.textContent("#drawer-title"), "Pão de fermentação natural");
  await portal.waitForFunction(() => document.querySelector("#drawer .media--image img")?.naturalWidth > 0);
  const img = await portal.$eval("#drawer .media--image img", (i) => ({ nw: i.naturalWidth, nh: i.naturalHeight, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, fit: getComputedStyle(i).objectFit }));
  assert.deepEqual([img.nw, img.nh], [800, 1000]);
  assert.ok(Math.abs(img.w / img.h - 0.8) < 0.01, `proporção ${img.w}x${img.h}`);
  const text = await portal.textContent("#drawer");
  for (const part of ["Chegou o pão que você pediu!", "Instagram", "Aguardando aprovação", "Confira a cor da embalagem.", "10h30"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes(`${Number(D(10).slice(8))} de`), "data");
  assert.ok(!text.includes("SEGREDO"));
  assert.equal(await portal.locator('#drawer [data-form="comment"]').count(), 0, "comentários (ainda não gravam no banco) ficam escondidos");
  assert.equal(await portal.locator('#drawer .drawer__body [data-do="confirm"]').count(), 1, "aguardando aprovação: o cliente pode aprovar");
  await shot(portal, "p01-detalhes-imagem");
});

await step("Painel aberto se atualiza quando a agência edita (legenda)", async () => {
  await adminEdit("Pão de fermentação natural", { caption: "Legenda revisada pela equipe" });
  await portalRefocus();
  await portal.waitForFunction(() => document.querySelector("#drawer .detail__caption")?.textContent === "Legenda revisada pela equipe");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Vídeo do YouTube cadastrado no painel: player oficial incorporado", async () => {
  await adminCreate({ client: "Padaria Central Ltda", title: "Reels dos bastidores", scheduled_date: D(12), network: "instagram", format: "reels", media_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", status: "aprovado" });
  await portalRefocus();
  await portal.waitForSelector(`.cal__cell[data-day="${D(12)}"] .chip`);
  await portal.click(`.cal__cell[data-day="${D(12)}"] .chip`);
  await portal.waitForSelector("#drawer[open] .media--embed iframe");
  assert.equal(await portal.getAttribute("#drawer iframe", "src"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  assert.match(await portal.getAttribute("#drawer iframe", "sandbox"), /allow-scripts/);
  assert.equal(await portal.getAttribute("#drawer .media__open", "href"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.match(await portal.textContent("#drawer .drawer__badges"), /Aprovado/);
  const frame = portal.frameLocator("#drawer iframe");
  assert.equal(await frame.locator("p").textContent(), "Player do YouTube", "o player carregou dentro do portal (CSP permite)");
  await shot(portal, "p02-detalhes-youtube");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Arquivo de vídeo: reprodução no player do navegador", async () => {
  await store.createContent(validateContent({ client_id: padaria.id, title: "Vídeo do forno", scheduled_date: D(13), network: "tiktok", format: "reels", media_url: "https://cdn.exemplo.com/video.webm", status: "aguardando_aprovacao" }).value);
  await portalRefocus();
  await portal.waitForSelector(`.cal__cell[data-day="${D(13)}"] .chip`);
  await portal.click(`.cal__cell[data-day="${D(13)}"] .chip`);
  await portal.waitForSelector("#drawer[open] .media--video video");
  await portal.waitForFunction(() => document.querySelector("#drawer video")?.readyState >= 1);
  const video = await portal.$eval("#drawer video", (v) => ({ autoplay: v.autoplay, controls: v.controls, w: v.videoWidth, h: v.videoHeight }));
  assert.deepEqual(video, { autoplay: false, controls: true, w: 320, h: 180 });
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Reel do Instagram aparece pelo player oficial do Instagram", async () => {
  await store.createContent(validateContent({ client_id: padaria.id, title: "Reel do Instagram", scheduled_date: D(16), network: "instagram", format: "reels", media_url: "https://www.instagram.com/padariacentral/reel/Cabc123/", media_kind: "video", status: "aguardando_aprovacao" }).value);
  await portalRefocus();
  await portal.waitForSelector(`.cal__cell[data-day="${D(16)}"] .chip`);
  await portal.click(`.cal__cell[data-day="${D(16)}"] .chip:has-text("Reel do Instagram")`);
  await portal.waitForSelector("#drawer[open] .media--instagram iframe");
  assert.equal(await portal.getAttribute("#drawer .media--instagram iframe", "src"), "https://www.instagram.com/p/Cabc123/embed/");
  assert.equal(await portal.getAttribute("#drawer .media--instagram a.media__open", "href"), "https://www.instagram.com/padariacentral/reel/Cabc123/");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
  // No carrossel de destaques, o post oficial vira a capa (carregado só quando o destaque aparece)
  const i = await portal.$$eval(".slide", (slides) => slides.findIndex((n) => n.textContent.includes("Reel do Instagram")));
  assert.ok(i >= 0, "reel nos destaques");
  await portal.click(`.spot__dot[data-dot="${i}"]`);
  await portal.waitForSelector(".slide.is-active .slide__embed--instagram iframe");
  assert.equal(await portal.getAttribute(".slide.is-active .slide__embed--instagram iframe", "src"), "https://www.instagram.com/p/Cabc123/embed/");
  await portal.click(".slide.is-active .slide__hit");
  await portal.waitForSelector("#drawer[open]");
  assert.equal(await portal.textContent("#drawer-title"), "Reel do Instagram", "clicar na capa abre os detalhes");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Link que não pode ser incorporado e imagem quebrada: aviso amigável com o link original", async () => {
  await store.createContent(validateContent({ client_id: padaria.id, title: "Vídeo do Facebook", scheduled_date: D(14), network: "facebook", format: "reels", media_url: "https://www.facebook.com/watch/?v=123", media_kind: "video", status: "aguardando_aprovacao" }).value);
  await store.createContent(validateContent({ client_id: padaria.id, title: "Arte com link quebrado", scheduled_date: D(15), network: "facebook", format: "post", media_url: "https://cdn.exemplo.com/sumiu.jpg", status: "aguardando_aprovacao" }).value);
  await portalRefocus();
  await portal.waitForSelector(`.cal__cell[data-day="${D(15)}"] .chip`);
  await portal.click(`.cal__cell[data-day="${D(14)}"] .chip`);
  await portal.waitForSelector("#drawer[open] .media-fallback");
  assert.match(await portal.textContent("#drawer .media-fallback"), /Facebook não permite/);
  assert.equal(await portal.getAttribute("#drawer .media-fallback a", "href"), "https://www.facebook.com/watch/?v=123");
  assert.equal(await portal.getAttribute("#drawer .media-fallback a", "rel"), "noopener noreferrer");
  assert.equal(await portal.locator("#drawer iframe").count(), 0, "não presume que o link é incorporável");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
  await portal.click(`.cal__cell[data-day="${D(15)}"] .chip`);
  await portal.waitForSelector("#drawer[open] .media-fallback");
  assert.match(await portal.textContent("#drawer .media-fallback"), /A imagem não carregou/);
  assert.equal(await portal.getAttribute("#drawer .media-fallback a", "href"), "https://cdn.exemplo.com/sumiu.jpg");
  await shot(portal, "p03-link-quebrado");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Data alterada no painel: o conteúdo muda de dia no calendário", async () => {
  await adminEdit("Pão de fermentação natural", { scheduled_date: D(25) });
  await portalRefocus();
  await portal.waitForFunction((iso) => document.querySelector(`.cal__cell[data-day="${iso}"] .chip__title`)?.textContent === "Pão de fermentação natural", D(25));
  assert.deepEqual(await chipsOn(D(10)), []);
});

await step("Data movida para o mês seguinte: some deste mês e aparece no próximo", async () => {
  await adminEdit("Pão de fermentação natural", { scheduled_date: `${NEXT}-05` });
  await portalRefocus();
  await portal.waitForFunction((iso) => !document.querySelector(`.cal__cell[data-day="${iso}"] .chip`), D(25));
  await portal.click('[data-nav="1"]');
  await portal.waitForFunction((iso) => document.querySelector(`.cal__cell[data-day="${iso}"] .chip__title`)?.textContent === "Pão de fermentação natural", `${NEXT}-05`);
  await portal.click('[data-nav="-1"]');
  await portal.waitForSelector(`.cal__cell[data-day="${D(12)}"] .chip`);
});

await step("Título editado e conteúdo excluído no painel refletem no calendário", async () => {
  await adminEdit("Reels dos bastidores", { title: "Reels dos bastidores (versão final)" });
  await portalRefocus();
  await portal.waitForFunction(() => [...document.querySelectorAll(".chip__title")].some((n) => n.textContent === "Reels dos bastidores (versão final)"));
  // Excluir com o painel de detalhes aberto no portal
  await portal.click(`.cal__cell[data-day="${D(13)}"] .chip`);
  await portal.waitForSelector("#drawer[open]");
  await admin.click('.row:has-text("Vídeo do forno") [data-delete-content]');
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await admin.waitForFunction(() => ![...document.querySelectorAll(".row__title")].some((n) => n.textContent === "Vídeo do forno"));
  await portalRefocus();
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
  await portal.waitForFunction(() => /mudou de data ou foi removido/.test(document.querySelector(".toast:last-child")?.textContent || ""));
  assert.ok(!(await chipTitles()).includes("Vídeo do forno"));
});

await step("Atualização automática a cada 30 s, sem nenhuma ação do cliente", async () => {
  const context = await newContext();
  const page = await context.newPage();
  watch(page, "portal-relogio");
  await page.clock.install({ time: new Date() });
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "padaria", "Senha-padaria-123");
  await page.waitForSelector(`.cal__cell[data-day="${D(12)}"] .chip`);
  await adminCreate({ client: "Padaria Central Ltda", title: "Carrossel de dicas", scheduled_date: D(20), network: "facebook", format: "carrossel", status: "aguardando_aprovacao" });
  assert.deepEqual(await chipsOn(D(20), page), [], "ainda não buscou");
  await page.clock.fastForward("00:31");
  await page.waitForFunction((iso) => document.querySelector(`.cal__cell[data-day="${iso}"] .chip__title`)?.textContent === "Carrossel de dicas", D(20));
  await context.close();
});

await step("Botão Atualizar busca de novo e avisa", async () => {
  await portal.click('[data-action="refresh"]');
  await portal.waitForFunction(() => /Calendário atualizado|Tudo em dia/.test(document.querySelector(".toast:last-child")?.textContent || ""));
  await portal.waitForFunction((iso) => document.querySelector(`.cal__cell[data-day="${iso}"] .chip`), D(20));
});

await step("Trocar parâmetros da requisição não dá acesso a outro cliente", async () => {
  const attempts = await portal.evaluate(async ({ url, key, estudioId }) => {
    const session = JSON.parse(localStorage.getItem("dg-portal-sessao"));
    const headers = { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
    const post = (name, body) => fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const get = (q) => fetch(`${url}/rest/v1/${q}`, { headers }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return {
      extraParam: await post("portal_contents", { p_from: "2000-01-01", p_to: "2000-02-01", p_client_id: estudioId }),
      clientIdInBody: await post("portal_profile", { client_id: estudioId }),
      directTable: await get(`contents?select=*&client_id=eq.${estudioId}`),
      clientsTable: await get("clients?select=*"),
      hugeRange: await post("portal_contents", { p_from: "2000-01-01", p_to: "2100-01-01" })
    };
  }, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, estudioId: estudio.id });
  assert.equal(attempts.extraParam.status, 404, "função não aceita id de cliente");
  assert.equal(attempts.clientIdInBody.status, 404);
  assert.deepEqual(attempts.directTable.body, [], "tabela direta: nada");
  assert.deepEqual(attempts.clientsTable.body, []);
  assert.deepEqual(attempts.hugeRange.body, [], "período grande demais: nada");
});

await step("Outro cliente logado vê só o dele", async () => {
  const context = await newContext();
  const page = await context.newPage();
  watch(page, "portal-estudio");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "estudio", "Senha-estudio-123");
  await page.waitForSelector(`.cal__cell[data-day="${D(10)}"] .chip`);
  const titles = await chipTitles(page);
  assert.deepEqual(titles, ["Conteúdo do Estúdio"]);
  assert.equal(await page.textContent("#welcome-hello"), "Olá, Estúdio Luz!");
  await context.close();
});

await step("Clicar numa data: dia livre mostra aviso; dia com conteúdo abre os detalhes", async () => {
  await portal.click(`.cal__cell[data-day="${D(3)}"] .cal__date`);
  await portal.waitForSelector("#drawer[open] .day-empty");
  assert.match(await portal.textContent("#drawer .day-empty"), /Nada programado para este dia/);
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
  await portal.click(`.cal__cell[data-day="${D(12)}"] .cal__date`);
  await portal.waitForSelector("#drawer[open] .media--embed");
  assert.equal(await portal.textContent("#drawer-title"), "Reels dos bastidores (versão final)");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Data com vários conteúdos: lista do dia e volta", async () => {
  await store.createContent(validateContent({ client_id: padaria.id, title: "Stories do almoço", scheduled_date: D(12), scheduled_time: "12:00", network: "instagram", format: "stories", status: "publicado" }).value);
  await portalRefocus();
  await portal.waitForFunction((iso) => document.querySelectorAll(`.cal__cell[data-day="${iso}"] .chip`).length === 2, D(12));
  await portal.click(`.cal__cell[data-day="${D(12)}"] .cal__date`);
  await portal.waitForSelector("#drawer[open] .day-list");
  assert.equal(await portal.locator("#drawer [data-day-item]").count(), 2);
  await portal.click('#drawer [data-day-item]:has-text("Stories do almoço")');
  await portal.waitForSelector("#drawer [data-do='back']");
  assert.match(await portal.textContent("#drawer .drawer__badges"), /Publicado/);
  assert.match(await portal.textContent("#drawer .art-empty"), /em produção/, "sem mídia: aviso de arte em produção");
  await portal.click("#drawer [data-do='back']");
  await portal.waitForSelector("#drawer .day-list");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
});

await step("Semana: alterna, navega e posiciona os conteúdos", async () => {
  await portal.click(`.cal__cell[data-day="${D(12)}"] .cal__date`);
  await portal.waitForSelector("#drawer[open]");
  await portal.click('#drawer [data-do="close"]');
  await portal.waitForSelector("#drawer:not([open])", { state: "attached" });
  await portal.click('[data-view-mode="week"]');
  await portal.waitForSelector(".cal--week");
  assert.equal(await portal.locator(".cal--week .cal__cell").count(), 7);
  assert.equal(await portal.getAttribute('[data-view-mode="week"]', "aria-pressed"), "true");
  assert.match(await portal.textContent("#calendar-title"), / a /);
  assert.equal((await chipsOn(D(12))).length, 2, "os dois conteúdos do dia 12 na semana");
  await shot(portal, "p04-semana");
  const title = await portal.textContent("#calendar-title");
  await portal.click('[data-nav="1"]');
  await portal.waitForFunction((t) => document.querySelector("#calendar-title").textContent !== t, title);
  assert.equal(await portal.getAttribute('[data-nav="1"]', "aria-label"), "Próxima semana");
  await portal.click('[data-nav="-1"]');
  await portal.waitForFunction((t) => document.querySelector("#calendar-title").textContent === t, title);
  await portal.click('[data-view-mode="month"]');
  await portal.waitForSelector(".cal:not(.cal--week)");
});

await step("Carregando e erro com nova tentativa ao trocar de mês", async () => {
  store.delayMs = 600;
  await portal.click('[data-nav="1"]');
  await portal.waitForSelector("#calendar[aria-busy='true'] .skeleton--calendar");
  store.delayMs = 0;
  await portal.waitForSelector(`.cal__cell[data-day="${NEXT}-05"]`);
  fake.offline = true;
  await portal.click('[data-nav="-1"]');
  await portal.waitForSelector(".load-error");
  assert.match(await portal.textContent(".load-error"), /Não foi possível conectar/);
  fake.offline = false;
  // "Tentar de novo" (a atualização automática também pode recuperar sozinha antes do clique)
  await portal.click('[data-action="retry-load"]', { timeout: 3000 }).catch(() => {});
  await portal.waitForSelector(`.cal__cell[data-day="${D(12)}"] .chip`);
  assert.equal(await portal.locator(".load-error").count(), 0, "o erro some quando a conexão volta");
});

await step("Baixar PDF do calendário: grade do mês e lista com dias e títulos", async () => {
  const [download] = await Promise.all([portal.waitForEvent("download"), portal.click('[data-action="pdf"]')]);
  assert.match(download.suggestedFilename(), /^calendario-padaria-central-ltda-\d{4}-\d{2}\.pdf$/);
  const file = await download.path();
  const bytes = (await import("node:fs")).readFileSync(file);
  const text = bytes.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF"), "arquivo PDF válido");
  assert.match(text, /\(Calend\xe1rio de /, "título do mês");
  assert.match(text, /\(Padaria Central Ltda/, "nome do cliente");
  const items = await store.listClientCalendar(padaria.id, { from: `${MONTH}-01`, to: `${MONTH}-31` });
  for (const c of items.slice(0, 5)) assert.ok(text.includes(c.title.slice(0, 12).replace(/[()\\]/g, "")) || text.includes(Buffer.from(c.title.slice(0, 12), "latin1").toString("latin1")), `título "${c.title}" no PDF`);
  assert.ok(!text.includes("SEGREDO"), "observação interna nunca vai para o PDF");
  await toastSays(portal, /PDF de .* gerado/);
});

await step("Celular: agenda do dia e detalhes em folha, sem rolagem lateral", async () => {
  const context = await newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  watch(page, "portal-celular");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "padaria", "Senha-padaria-123");
  await page.waitForSelector(`.cal__cell[data-day="${D(12)}"] .cal__dots`);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 0, "calendário cabe na tela");
  await page.tap(`.cal__cell[data-day="${D(3)}"] .cal__date`);
  await page.waitForSelector(".agenda__empty");
  assert.match(await page.textContent(".agenda__empty"), /Nada programado para este dia\./);
  // Dia vazio aponta o próximo dia com conteúdo
  assert.match(await page.textContent(".agenda__empty [data-agenda-go]"), /Próximo:/);
  await page.tap(`.cal__cell[data-day="${D(12)}"] .cal__date`);
  await page.waitForFunction(() => document.querySelectorAll(".agenda__item").length === 2);
  assert.equal(await page.locator("#day-popover.is-visible").count(), 0, "no toque, o resumo flutuante (de mouse) não aparece");
  await shot(page, "p05-celular-agenda");
  await page.tap('.agenda__item:has-text("Reels dos bastidores")');
  await page.waitForSelector("#drawer[open] .media--embed iframe");
  const frame = await page.$eval("#drawer .media__frame", (f) => { const r = f.getBoundingClientRect(); return { w: r.width, h: r.height, vw: window.innerWidth }; });
  assert.ok(frame.w <= frame.vw - 32 && Math.abs(frame.w / frame.h - 16 / 9) < 0.02, `player ${frame.w}x${frame.h}`);
  await shot(page, "p06-celular-detalhes");
  await page.tap('#drawer [data-do="close"]');
  await page.waitForSelector("#drawer:not([open])", { state: "attached" });
  await page.tap('[data-view-mode="week"]');
  await page.waitForSelector(".cal--week");
  assert.ok(await overflow() <= 0, "semana cabe na tela");
  await context.close();
});

await step("Destaques: carrossel com o que aprovar primeiro, passa sozinho e abre os detalhes", async () => {
  const iso = (delta) => { const d = new Date(); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const cafe = await store.createClient({ name: "Teste Destaques", slug: "teste-destaques", active: true });
  fake.addUser("destaques", "Senha-destaques-123", { kind: "cliente", clientId: cafe.id });
  const add = async (title, delta, status) => {
    const c = await store.createContent(validateContent({ client_id: cafe.id, title, scheduled_date: iso(delta), network: "instagram", format: "post", status: "em_producao" }).value);
    await store.setContentStatus(c.id, status);
  };
  await add("Já foi ao ar", -2, "publicado");
  await add("Segundo para aprovar", 5, "aguardando_aprovacao");
  await add("Primeiro para aprovar", 2, "aguardando_aprovacao");
  await add("Ainda em produção", 3, "em_producao");
  const context = await newContext();
  const page = await context.newPage();
  watch(page, "portal-destaques");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "destaques", "Senha-destaques-123");
  await page.waitForSelector(".spot .slide");
  assert.equal(await page.textContent(".spot__title"), "Você tem 2 conteúdos para aprovar");
  const titles = await page.$$eval(".slide__title", (n) => n.map((x) => x.textContent));
  assert.deepEqual(titles, ["Primeiro para aprovar", "Segundo para aprovar", "Já foi ao ar"], "o que aprovar vem primeiro; o que está em produção não aparece");
  assert.match(await page.textContent(".slide.is-active .slide__cta"), /Ver e aprovar/);
  assert.match(await page.textContent(".mini-stats"), /2\s*para aprovar/);
  // Dia do calendário colorido pelo status (aguardando vence os demais)
  const dayOf = (delta) => page.getAttribute(`.cal__cell[data-day="${iso(delta)}"]`, "class");
  if (iso(2).slice(0, 7) === iso(0).slice(0, 7)) assert.match(await dayOf(2), /day--aguardando/);
  if (iso(-2).slice(0, 7) === iso(0).slice(0, 7)) assert.match(await dayOf(-2), /day--publicado/);
  if (iso(3).slice(0, 7) === iso(0).slice(0, 7)) assert.doesNotMatch(await dayOf(3), /day--/, "em produção não aparece nem colore o dia");
  assert.match(await page.textContent(".spot__queue"), /Segundo para aprovar/);
  // Passa sozinho (com o mouse fora)
  await page.mouse.move(5, 890);
  await page.waitForFunction(() => document.querySelector(".spot__count")?.textContent === "2 de 3", null, { timeout: 9000 });
  // Setas e pontos
  await page.click('[data-spot-nav="1"]');
  await page.waitForFunction(() => document.querySelector(".spot__count")?.textContent === "3 de 3");
  await page.click('.spot__dot[data-dot="0"]');
  await page.waitForFunction(() => document.querySelector(".spot__count")?.textContent === "1 de 3");
  await shot(page, "p08-destaques");
  await page.click(".slide.is-active .slide__cta");
  await page.waitForSelector("#drawer[open]");
  assert.equal(await page.textContent("#drawer-title"), "Primeiro para aprovar");
  await context.close();
});

const portalLogin = async (username, password) => {
  const context = await newContext();
  const page = await context.newPage();
  watch(page, `portal-${username}`);
  await page.goto(`${ORIGIN}/`);
  await signIn(page, username, password);
  await page.waitForFunction(() => !document.querySelector("#app").hidden || !document.querySelector("#login .form-error").hidden);
  const hello = await page.isVisible("#app") ? await page.textContent("#welcome-hello") : null;
  await context.close();
  return hello;
};

let auroraPassword = "";
await step("Equipe cria o acesso do cliente pelo painel e o cliente entra", async () => {
  await store.createClient({ name: "Café Aurora", slug: "cafe-aurora", segment: "Cafeteria", active: true });
  await admin.reload();
  await admin.waitForSelector("#app:not([hidden])");
  await admin.click('[data-route="clientes"]');
  await admin.waitForSelector('.client-card:has-text("Café Aurora") [data-portal-create]');
  assert.match(await admin.textContent('.client-card:has-text("Café Aurora") .client-card__portal'), /Sem acesso ao portal/);
  await admin.click('.client-card:has-text("Café Aurora") [data-portal-create]');
  await admin.waitForSelector("#access-modal[open]");
  assert.equal(await admin.inputValue('#access-modal [name="username"]'), "cafe-aurora", "usuário sugerido pelo identificador");
  await admin.fill('#access-modal [name="password"]', "123");
  await admin.click("#access-modal [type=submit]");
  await admin.waitForSelector("#access-modal .field__error");
  assert.match(await admin.textContent("#access-modal .field__error"), /pelo menos 6/);
  await admin.click('#access-modal [data-access="generate"]');
  auroraPassword = await admin.inputValue('#access-modal [name="password"]');
  assert.equal(auroraPassword.length, 14);
  assert.equal(await admin.getAttribute('#access-modal [name="password"]', "type"), "text", "senha gerada fica visível para copiar");
  await shot(admin, "a01-criar-acesso");
  await admin.click("#access-modal [type=submit]");
  await admin.waitForSelector("#access-modal .access-done:not([hidden])");
  assert.equal(await admin.textContent("[data-done-user]"), "cafe-aurora");
  assert.equal(await admin.textContent("[data-done-password]"), auroraPassword);
  await shot(admin, "a02-acesso-criado");
  await admin.click('[data-access="finish"]');
  await admin.waitForSelector("#access-modal:not([open])", { state: "attached" });
  assert.equal(await admin.textContent("[data-done-password]"), "", "a senha some da página ao fechar");
  await admin.waitForSelector('.client-card:has-text("Café Aurora") .portal-user__name');
  assert.equal(await admin.textContent('.client-card:has-text("Café Aurora") .portal-user__name'), "cafe-aurora");
  assert.equal(await portalLogin("cafe-aurora", auroraPassword), "Olá, Café Aurora!");
});

await step("Usuário repetido é recusado com aviso no campo", async () => {
  await admin.click('.client-card:has-text("Café Aurora") [data-portal-create]');
  await admin.waitForSelector("#access-modal[open]");
  await admin.fill('#access-modal [name="username"]', "padaria");
  await admin.click('#access-modal [data-access="generate"]');
  await admin.click("#access-modal [type=submit]");
  await admin.waitForSelector("#access-modal .field__error");
  assert.match(await admin.textContent("#access-modal .field__error"), /já existe/);
  await admin.click('#access-modal form [data-action="close-modal"]');
  await admin.waitForSelector("#access-modal:not([open])", { state: "attached" });
});

await step("Trocar a senha pelo painel: a antiga para de funcionar", async () => {
  await admin.click('.client-card:has-text("Café Aurora") [data-portal-password="cafe-aurora"]');
  await admin.waitForSelector("#access-modal[open]");
  assert.equal(await admin.getAttribute('#access-modal [name="username"]', "readonly"), "", "usuário não muda ao trocar a senha");
  await admin.fill('#access-modal [name="password"]', "Nova#Senha-Aurora-9");
  await admin.click("#access-modal [type=submit]");
  await admin.waitForSelector("#access-modal .access-done:not([hidden])");
  await admin.click('[data-access="finish"]');
  await admin.waitForSelector("#access-modal:not([open])", { state: "attached" });
  assert.equal(await portalLogin("cafe-aurora", auroraPassword), null, "senha antiga recusada");
  assert.equal(await portalLogin("cafe-aurora", "Nova#Senha-Aurora-9"), "Olá, Café Aurora!");
});

await step("Remover o acesso pelo painel pede confirmação e bloqueia o login", async () => {
  await admin.click('.client-card:has-text("Café Aurora") [data-portal-remove="cafe-aurora"]');
  await admin.waitForSelector("#confirm-modal[open]");
  assert.match(await admin.textContent("#confirm-modal"), /Remover o acesso "cafe-aurora"/);
  await admin.click('#confirm-modal [data-confirm="ok"]');
  await admin.waitForFunction(() => /Sem acesso ao portal/.test([...document.querySelectorAll(".client-card")].find((c) => c.textContent.includes("Café Aurora"))?.querySelector(".client-card__portal")?.textContent || ""));
  assert.equal(await portalLogin("cafe-aurora", "Nova#Senha-Aurora-9"), null);
  await shot(admin, "a03-clientes");
});

await step("Sair do portal volta para a entrada", async () => {
  await portal.click("#profile-button");
  await portal.click('[data-action="sign-out"]');
  await portal.waitForSelector("#login:not([hidden])");
  assert.equal(await portal.textContent("#login .form-error"), "Você saiu do portal.");
  assert.equal(await portal.locator(".chip").count(), 0, "dados apagados da tela");
  assert.equal(await portal.evaluate(() => localStorage.getItem("dg-portal-sessao")), null);
});

await step("Demonstração removida: ?demo só mostra a entrada, sem dados fictícios", async () => {
  await portal.goto(`${ORIGIN}/?demo`);
  await portal.waitForSelector("#login:not([hidden])");
  assert.equal(await portal.isVisible("#app"), false);
  const html = await portal.content();
  assert.ok(!html.includes("Trigo") && !html.includes("demonstração"), "nenhum resto da demonstração na página");
  const demoFile = await portal.evaluate(async () => (await fetch("/js/data/demo-data.js")).status);
  assert.equal(demoFile, 404, "arquivo de dados fictícios não existe mais");
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

await browser.close();
server.close();
console.log(process.exitCode ? "\nAlgum teste falhou." : `\n${results.length} verificações passaram.`);
