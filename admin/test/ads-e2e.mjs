/* Teste de ponta a ponta: Aprovação de anúncios.
   Painel da agência e portal do cliente lado a lado, sobre o Supabase de
   mentira (banco + arquivos em memória, com as mesmas regras do banco).
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/ads-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5614;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const FIX = (name) => readFileSync(path.join(HERE, "fixtures", name));

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", active: true });
const estudio = await store.createClient({ name: "Estúdio Luz", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe DG" });
fake.addUser("padaria", "Senha-padaria-123", { kind: "cliente", clientId: padaria.id });
fake.addUser("estudio", "Senha-estudio-123", { kind: "cliente", clientId: estudio.id });
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
  return context;
}
const watch = (page, name) => {
  page.setDefaultTimeout(8000);
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
};
const shot = async (page, name) => { if (!SHOTS) return; await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const signIn = async (page, username, password) => {
  await page.fill('#login-form [name="username"]', username);
  await page.fill('#login-form [name="password"]', password);
  await page.click("#login-form [type=submit]");
  await page.waitForSelector("#app:not([hidden])");
};
const toastSays = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll(".toast")].some((t) => new RegExp(src).test(t.textContent)), re.source);
const portalAds = async (page = portal) => {
  await page.evaluate(() => { location.hash = "#/anuncios"; window.dispatchEvent(new Event("focus")); });
  await page.waitForSelector("#anuncios:not([hidden]) [data-ads-grid][aria-busy='false']");
};
/** Confirma no modal e espera ele fechar (o painel embaixo só volta a aceitar digitação depois) */
const confirmOk = async (page = admin) => {
  await page.click('#confirm-modal [data-confirm="ok"]');
  await page.waitForSelector("#confirm-modal:not([open])", { state: "attached" });
};
const adOf = async () => (await store.listAds({ client_id: padaria.id }))[0];

const adminContext = await newContext();
admin = await adminContext.newPage();
watch(admin, "painel");
const portalContext = await newContext();
portal = await portalContext.newPage();
watch(portal, "portal");

/* ============================== Testes ============================== */

await step("Entrar no painel e no portal; abas vazias", async () => {
  await admin.goto(`${ORIGIN}/admin/`);
  await signIn(admin, "admdg-teste", "Senha-de-teste-123");
  await admin.click('[data-route="anuncios"]');
  await admin.waitForSelector("#ads-list .state__title");
  assert.match(await admin.textContent("#ads-list"), /Nenhum anúncio cadastrado ainda/);
  await portal.goto(`${ORIGIN}/`);
  await signIn(portal, "padaria", "Senha-padaria-123");
  await portalAds();
  assert.match(await portal.textContent("[data-ads-grid]"), /Nenhum anúncio por aqui ainda/);
  assert.ok(await portal.isHidden("[data-ads-pending]"), "sem selo de pendentes");
});

await step("1-2. Equipe cadastra o anúncio e salva como rascunho (com validação)", async () => {
  await admin.click('#view-anuncios [data-action="new-ad"]');
  await admin.waitForSelector("#ad-modal[open]");
  await admin.selectOption('#ad-modal [name="client_id"]', "");
  await admin.click("#ad-modal [type=submit]");
  await admin.waitForSelector("#ad-modal .field__error");
  assert.match(await admin.textContent("#ad-modal"), /Escolha o cliente.*Informe o título do anúncio/s);
  await admin.selectOption('#ad-modal [name="client_id"]', padaria.id);
  await admin.fill('#ad-modal [name="title"]', "Promoção de inverno");
  await admin.fill('#ad-modal [name="campaign_context"]', "Público que já comprou café da manhã. Período: julho.");
  await admin.selectOption('#ad-modal [name="objective"]', "vendas");
  await admin.selectOption('#ad-modal [name="platform"]', "outra");
  assert.ok(await admin.isVisible("#ad-modal [data-platform-other]"), "campo 'qual plataforma' aparece");
  await admin.selectOption('#ad-modal [name="platform"]', "meta");
  await admin.selectOption('#ad-modal [name="format"]', "carrossel");
  await admin.fill('#ad-modal [name="primary_text"]', "Pão quentinho e café por R$ 9,90 até domingo!");
  await admin.fill('#ad-modal [name="headline"]', "Café da manhã completo");
  await admin.fill('#ad-modal [name="description"]', "Só nas lojas do centro");
  await admin.fill('#ad-modal [name="cta"]', "Ver oferta");
  await admin.fill('#ad-modal [name="destination_url"]', "javascript:alert(1)");
  await admin.click("#ad-modal [type=submit]");
  await admin.waitForSelector('#ad-modal [name="destination_url"][aria-invalid="true"]');
  await admin.fill('#ad-modal [name="destination_url"]', "https://padariacentral.com.br/inverno");
  await admin.fill('#ad-modal [name="client_notes"]', "Confira o preço com a loja antes de aprovar.");
  await admin.fill('#ad-modal [name="internal_notes"]', "SEGREDO: verba de R$ 500");
  await admin.click("#ad-modal [type=submit]");
  await admin.waitForSelector("#ad-drawer[open] #ad-drawer-title");
  assert.equal(await admin.textContent("#ad-drawer-title"), "Promoção de inverno");
  assert.match(await admin.textContent("#ad-drawer [data-ad-badges]"), /Rascunho/);
  const ad = await adOf();
  assert.equal(ad.status, "rascunho");
  await shot(admin, "a01-rascunho");
});

await step("Rascunho não aparece para o cliente", async () => {
  await portalAds();
  assert.equal(await portal.locator(".ad-card").count(), 0);
  const [{ user_id }] = store.findMembers({ username: "padaria" });
  assert.equal((await store.portalAds(user_id)).length, 0, "a função do portal também não entrega");
});

await step("Criativo: enviar sem arquivo é bloqueado; imagem e vídeo; tipo inválido recusado", async () => {
  await admin.click('#ad-drawer [data-ad-action="enviar"]');
  await toastSays(admin, /pelo menos um arquivo/);
  await admin.setInputFiles("#ad-drawer [data-ad-files]", [
    { name: "capa.png", mimeType: "image/png", buffer: FIX("arte.png") },
    { name: "video.webm", mimeType: "video/webm", buffer: FIX("video.webm") }
  ]);
  await toastSays(admin, /2 arquivos enviados/);
  await admin.waitForFunction(() => document.querySelectorAll("#ad-drawer .final-item").length === 2);
  assert.equal([...fake.files.keys()].filter((k) => k.startsWith("ad-media/")).length, 2, "arquivos no bucket privado de anúncios");
  await admin.setInputFiles("#ad-drawer [data-ad-files]", { name: "contrato.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await admin.waitForSelector("#ad-drawer .upload.is-error");
  assert.match(await admin.textContent("#ad-drawer .upload.is-error"), /Formato não aceito/);
  await admin.waitForSelector("#ad-drawer .admock");
  assert.match(await admin.textContent("#ad-drawer .admock"), /Padaria Central Ltda.*Patrocinado · Meta Ads.*Pão quentinho.*padariacentral\.com\.br.*Café da manhã completo.*Ver oferta/s);
});

await step("3. Equipe envia para aprovação (com confirmação)", async () => {
  await admin.click('#ad-drawer [data-ad-action="enviar"]');
  await admin.waitForSelector("#confirm-modal[open]");
  assert.match(await admin.textContent("#confirm-modal"), /Padaria Central Ltda passa a ver o anúncio/);
  await confirmOk();
  await toastSays(admin, /O cliente já vê o anúncio/);
  await admin.waitForFunction(() => /Aguardando aprovação/.test(document.querySelector("#ad-drawer [data-ad-badges]")?.textContent || ""));
  assert.equal(await admin.locator("#ad-drawer [data-ad-files]").count(), 0, "criativo travado enquanto o cliente avalia");
  const ad = await adOf();
  assert.deepEqual([ad.status, ad.version], ["aguardando_aprovacao", 1]);
  assert.ok(ad.submitted_at && ad.submitted_by, "data e autor do envio registrados");
  await shot(admin, "a02-enviado");
});

await step("4. Cliente vê o anúncio na aba exclusiva, com contador e prévia", async () => {
  await portalAds();
  await portal.waitForSelector(".ad-card");
  assert.equal(await portal.textContent("[data-ads-pending]"), "1", "selo de pendentes na aba");
  assert.match(await portal.textContent("[data-ads-callout]"), /1 anúncio espera a sua aprovação/);
  assert.match(await portal.textContent(".ad-card"), /Aguardando aprovação.*Promoção de inverno.*Meta Ads · Carrossel.*Público que já comprou.*Enviado em.*Ver e aprovar/s);
  assert.match(await portal.textContent('[data-ads-tab="aguardando_aprovacao"]'), /1/);
  await portal.waitForFunction(() => document.querySelector(".ad-card__media img")?.naturalWidth > 0);
  await shot(portal, "a03-portal-lista");
  await portal.click(".ad-card__open");
  await portal.waitForSelector("#ad-detail[open] .admock");
  const text = await portal.textContent("#ad-detail");
  for (const part of ["Promoção de inverno", "Meta Ads (Facebook e Instagram)", "Pão quentinho e café", "Café da manhã completo", "Só nas lojas do centro", "Ver oferta", "https://padariacentral.com.br/inverno", "Confira o preço com a loja", "Sobre a campanha", "Vendas"]) assert.ok(text.includes(part), part);
  assert.ok(!text.includes("SEGREDO"), "observação interna nunca chega ao cliente");
  assert.equal(await portal.getAttribute('#ad-detail .ad-text a[href^="https://padariacentral"]', "rel"), "noopener noreferrer");
  // Carrossel com imagem e vídeo (vídeo toca: tem controles e carrega)
  assert.equal(await portal.locator("#ad-detail .carousel__slide").count(), 2);
  await portal.click('#ad-detail [data-carousel-step="1"]');
  await portal.waitForFunction(() => document.querySelector("#ad-detail video")?.readyState >= 1);
  assert.equal(await portal.getAttribute("#ad-detail video", "controls"), "");
  assert.ok(await portal.isVisible('#ad-detail [data-ad-do="confirm"]') && await portal.isVisible('#ad-detail [data-ad-do="request"]'));
  await shot(portal, "a04-portal-detalhe");
});

await step("5. Cliente solicita alterações (comentário obrigatório)", async () => {
  await portal.click('#ad-detail [data-ad-do="request"]');
  await portal.click("#ad-detail [data-ad-request] [type=submit]");
  await portal.waitForSelector('#ad-detail textarea[aria-invalid="true"]');
  assert.equal((await adOf()).status, "aguardando_aprovacao", "sem comentário nada é gravado");
  await portal.fill('#ad-detail textarea[name="message"]', "Trocar a foto da capa por uma do balcão");
  await portal.click("#ad-detail [data-ad-request] [type=submit]");
  await toastSays(portal, /Pedido de alteração enviado/);
  await portal.waitForSelector("#ad-detail .decision--ajustes");
  assert.match(await portal.textContent("#ad-detail .decision--ajustes"), /Trocar a foto da capa/);
  assert.equal(await portal.locator('#ad-detail [data-ad-do="confirm"]').count(), 0, "sem botões enquanto a equipe ajusta");
  assert.equal((await adOf()).status, "alteracoes_solicitadas");
  assert.ok(await portal.isHidden("[data-ads-pending]"), "selo some");
  await portal.click('#ad-detail [data-ad-do="close"]');
});

await step("6. Equipe recebe a atualização (aviso no menu) e edita o criativo", async () => {
  await admin.click('#ad-drawer [data-action="close-drawer"]');
  await admin.reload();
  await admin.waitForSelector("[data-ads-attention]:not([hidden])");
  assert.equal(await admin.textContent("[data-ads-attention]"), "1");
  await admin.waitForSelector(".ad-card.needs-attention");
  await admin.click(".ad-card__open");
  await admin.waitForSelector("#ad-drawer[open] .decision--ajustes");
  assert.match(await admin.textContent("#ad-drawer .decision--ajustes"), /Trocar a foto da capa/);
  await admin.click("#ad-drawer [data-ad-edit]");
  await admin.waitForSelector("#ad-modal[open]");
  assert.ok(await admin.isDisabled('#ad-modal [name="client_id"]'), "cliente fixo depois do envio");
  await admin.fill('#ad-modal [name="headline"]', "Café da manhã no balcão");
  await admin.click("#ad-modal [type=submit]");
  await toastSays(admin, /Anúncio atualizado/);
  await admin.waitForFunction(() => /Café da manhã no balcão/.test(document.querySelector("#ad-drawer .admock")?.textContent || ""));
  // Troca a capa: remove a 1ª e envia outra
  await admin.click("#ad-drawer .final-item:nth-child(1) [data-ad-asset-delete]");
  await confirmOk();
  await admin.waitForFunction(() => document.querySelectorAll("#ad-drawer .final-item").length === 1);
  assert.equal([...fake.files.keys()].filter((k) => k.startsWith("ad-media/")).length, 2, "arquivo da versão 1 guardado para o histórico");
  await admin.setInputFiles("#ad-drawer [data-ad-files]", { name: "balcao.png", mimeType: "image/png", buffer: FIX("arte2.png") });
  await admin.waitForFunction(() => document.querySelectorAll("#ad-drawer .final-item").length === 2);
});

await step("7. Nova versão enviada volta a Aguardando aprovação", async () => {
  await admin.fill("#ad-drawer [data-ad-message]", "Nova foto do balcão e headline ajustada");
  await admin.click('#ad-drawer [data-ad-action="enviar"]');
  assert.match(await admin.textContent("#confirm-modal"), /Enviar a versão 2/);
  await confirmOk();
  await toastSays(admin, /O cliente já vê o anúncio/);
  const ad = await adOf();
  assert.deepEqual([ad.status, ad.version], ["aguardando_aprovacao", 2]);
  const sent = (await store.listAdEvents(ad.id)).filter((e) => e.event === "enviado").at(-1);
  assert.equal(sent.message, "Nova foto do balcão e headline ajustada", "nota da nova versão registrada");
  await admin.waitForSelector('#ad-drawer .ad-version[data-version="2"]');
  assert.equal(await admin.locator("#ad-drawer .ad-version").count(), 2, "as duas versões guardadas");
  await shot(admin, "a05-versao-2");
});

await step("Versão desatualizada: aprovar a versão antiga é recusado", async () => {
  // O cliente estava com a versão 1 aberta (simula a tela antiga)
  const [{ user_id }] = store.findMembers({ username: "padaria" });
  await assert.rejects(store.portalAdDecide({ id: user_id, username: "padaria" }, { p_ad_id: (await adOf()).id, p_version: 1, p_decision: "aprovado" }), /versao_desatualizada/);
});

await step("8. Cliente aprova (com confirmação) e o histórico anterior continua", async () => {
  await portalAds();
  await portal.waitForSelector(".ad-card.needs-attention");
  await portal.click(".ad-card__open");
  await portal.waitForSelector("#ad-detail[open] .decision--aguardando");
  assert.match(await portal.textContent("#ad-detail .decision--aguardando"), /Nova versão \(versão 2\)/);
  assert.match(await portal.textContent("#ad-detail .admock"), /Café da manhã no balcão/);
  await portal.click('#ad-detail [data-ad-do="confirm"]');
  await portal.waitForSelector("#ad-detail .ad-decide--confirm");
  assert.equal((await adOf()).status, "aguardando_aprovacao", "nada gravado antes de confirmar");
  await portal.click('#ad-detail [data-ad-do="cancel"]');
  await portal.click('#ad-detail [data-ad-do="confirm"]');
  await portal.click('#ad-detail [data-ad-do="approve"]');
  await toastSays(portal, /Anúncio aprovado/);
  await portal.waitForSelector("#ad-detail .decision--aprovado");
  assert.equal((await adOf()).status, "aprovado");
  const history = await portal.textContent("#ad-detail .ad-history");
  assert.match(history, /Aprovado.*versão 2.*Você \(padaria\).*Enviado para aprovação.*versão 2.*Nova foto do balcão.*Alterações solicitadas.*versão 1.*Trocar a foto da capa.*Enviado para aprovação.*versão 1/s);
  await shot(portal, "a06-portal-aprovado");
  await portal.click('#ad-detail [data-ad-do="close"]');
  await portal.click('[data-ads-tab="aprovado"]');
  assert.equal(await portal.locator(".ad-card").count(), 1);
});

await step("Painel: histórico completo e versão 1 preservada", async () => {
  await admin.click('#ad-drawer [data-action="close-drawer"]');
  await admin.click('[data-ad-tab="aprovado"]');
  await admin.waitForSelector(".ad-card");
  await admin.click(".ad-card__open");
  await admin.waitForSelector("#ad-drawer[open] .decision--aprovado");
  const h = await admin.textContent("#ad-drawer .ad-history");
  assert.match(h, /Aprovado.*Cliente \(padaria\).*Enviado para aprovação.*Equipe \(admdg-teste\).*Alterações solicitadas.*Enviado para aprovação.*Rascunho criado/s);
  await admin.click('#ad-drawer .ad-version[data-version="1"] summary');
  await admin.waitForSelector('#ad-drawer .ad-version[data-version="1"] .admock');
  assert.match(await admin.textContent('#ad-drawer .ad-version[data-version="1"]'), /Café da manhã completo/, "textos da versão 1");
  await admin.waitForFunction(() => document.querySelector('#ad-drawer .ad-version[data-version="1"] img')?.naturalWidth > 0);
  assert.ok(await admin.isVisible('#ad-drawer [data-ad-action="reabrir"]'));
  assert.equal(await admin.locator("#ad-drawer [data-ad-edit]").count(), 0, "aprovado não se edita sem reabrir");
});

await step("Isolamento: outro cliente não vê, não aprova e não abre os arquivos", async () => {
  const other = await newContext();
  const page = await other.newPage();
  watch(page, "portal-estudio");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "estudio", "Senha-estudio-123");
  await portalAds(page);
  assert.equal(await page.locator(".ad-card").count(), 0);
  const ad = await adOf();
  const path0 = (await store.getAd(ad.id)).ad_assets[0].storage_path;
  const attempts = await page.evaluate(async ({ url, key, adId, path }) => {
    const session = JSON.parse(localStorage.getItem("dg-portal-sessao"));
    const headers = { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
    const post = (p, body) => fetch(`${url}${p}`, { method: "POST", headers, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return {
      decide: await post("/rest/v1/rpc/portal_ad_decide", { p_ad_id: adId, p_version: 2, p_decision: "alteracoes_solicitadas", p_message: "invasão" }),
      transition: await post("/rest/v1/rpc/ad_transition", { p_ad_id: adId, p_action: "arquivar" }),
      table: await fetch(`${url}/rest/v1/ads?select=*`, { headers }).then((r) => r.json()),
      events: await fetch(`${url}/rest/v1/ad_events?select=*`, { headers }).then((r) => r.json()),
      sign: await post("/storage/v1/object/sign/ad-media", { paths: [path], expiresIn: 60 }),
      extraParam: await post("/rest/v1/rpc/portal_ads", { p_client_id: "x" })
    };
  }, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, adId: ad.id, path: path0 });
  assert.equal(attempts.decide.body.message, "anuncio_nao_encontrado");
  assert.equal(attempts.transition.body.message, "sem_permissao");
  assert.deepEqual(attempts.table, []);
  assert.deepEqual(attempts.events, []);
  assert.equal(attempts.sign.body[0].signedURL, null);
  assert.equal(attempts.extraParam.status, 404, "função não aceita id de cliente");
  assert.equal((await adOf()).status, "aprovado", "nada mudou");
  await other.close();
});

await step("Arquivar e reativar; rascunho some do cliente, arquivado aparece na aba Arquivados", async () => {
  await admin.click('#ad-drawer [data-ad-action="arquivar"]');
  await confirmOk();
  await toastSays(admin, /Anúncio arquivado/);
  await portalAds();
  await portal.click('[data-ads-tab="arquivado"]');
  await portal.waitForSelector(".ad-card");
  await portal.click(".ad-card__open");
  await portal.waitForSelector("#ad-detail .decision--info");
  assert.equal(await portal.locator("#ad-detail .ad-decide").count(), 0, "arquivado não pede resposta");
  await portal.click('#ad-detail [data-ad-do="close"]');
  await admin.waitForSelector('#ad-drawer [data-ad-action="reativar"]');
  await admin.click('#ad-drawer [data-ad-action="reativar"]');
  await confirmOk();
  await toastSays(admin, /reativado como rascunho/);
  await portalAds();
  await portal.click('[data-ads-tab=""]');
  assert.equal(await portal.locator(".ad-card").count(), 0, "rascunho (mesmo já enviado antes) não aparece");
});

await step("Excluir: rascunho nunca enviado pode; enviado não (arquivar)", async () => {
  assert.equal(await admin.locator("#ad-drawer [data-ad-delete]").count(), 0, "anúncio com histórico não mostra excluir");
  await admin.click('#ad-drawer [data-action="close-drawer"]');
  await admin.click('#view-anuncios [data-action="new-ad"]');
  await admin.selectOption('#ad-modal [name="client_id"]', estudio.id);
  await admin.fill('#ad-modal [name="title"]', "Rascunho descartável");
  await admin.selectOption('#ad-modal [name="format"]', "video");
  await admin.click("#ad-modal [type=submit]");
  await admin.waitForSelector("#ad-drawer[open] [data-ad-delete]");
  await admin.click("#ad-drawer [data-ad-delete]");
  await confirmOk();
  await toastSays(admin, /Rascunho excluído/);
  assert.equal((await store.listAds({ client_id: estudio.id })).length, 0);
});

await step("Celular: aba, cards e decisão presa embaixo, sem rolagem lateral", async () => {
  // Põe um anúncio aguardando de novo para ver os botões
  const ad = await adOf();
  const team = { id: "equipe", role: "equipe", username: "admdg-teste" };
  await store.adTransition(team, { p_ad_id: ad.id, p_action: "enviar" });
  const context = await newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  watch(page, "portal-celular");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "padaria", "Senha-padaria-123");
  await page.tap('[data-portal-tab="anuncios"]');
  await page.waitForSelector(".ad-card");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 0, `rolagem lateral ${await overflow()}px`);
  await shot(page, "a07-celular-lista");
  await page.tap(".ad-card__open");
  await page.waitForSelector("#ad-detail[open] .ad-decide");
  await page.waitForFunction(() => document.querySelector("#ad-detail .drawer__panel").getAnimations().length === 0);
  const bar = await page.$eval("#ad-detail .ad-decide", (n) => { const r = n.getBoundingClientRect(); return { bottom: r.bottom, vh: window.innerHeight }; });
  assert.ok(Math.abs(bar.bottom - bar.vh) <= 2, `botões presos embaixo (${bar.bottom} de ${bar.vh})`);
  assert.ok(await overflow() <= 0);
  await shot(page, "a08-celular-detalhe");
  await context.close();
});

await step("Erro ao carregar mostra aviso e 'Tentar de novo'", async () => {
  const context = await newContext();
  const page = await context.newPage();
  watch(page, "portal-erro");
  await page.goto(`${ORIGIN}/`);
  await signIn(page, "estudio", "Senha-estudio-123");
  fake.offline = true;
  await page.evaluate(() => { location.hash = "#/anuncios"; });
  await page.waitForSelector("[data-ads-grid] .load-error");
  fake.offline = false;
  await page.click("[data-ads-retry]");
  await page.waitForSelector("[data-ads-grid] .ads-empty");
  await context.close();
});

await step("Importar anúncios por planilha: prévia, rascunhos, envio dos marcados e criativo por link", async () => {
  await admin.click('[data-route="importar"]');
  await admin.waitForSelector("#view-importar:not([hidden])");
  await admin.click('.import-kind__opt:has-text("Anúncios")');
  assert.ok(await admin.isChecked('#import-form [name="kind"][value="ads"]'));
  assert.equal(await admin.getAttribute("[data-import-template]", "href"), "modelo-importacao-anuncios.xlsx");
  const template = await admin.evaluate(async () => { const r = await fetch("modelo-importacao-anuncios.xlsx"); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, zip: b[0] === 0x50 && b[1] === 0x4b }; });
  assert.deepEqual(template, { status: 200, zip: true });
  await admin.selectOption('#import-form [name="client_id"]', padaria.id);
  await admin.setInputFiles('#import-form [name="file"]', { name: "anuncios.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: FIX("importacao-anuncios.xlsx") });
  await admin.waitForSelector("#import-preview .imp-row--ads:not(.imp-row--head)");
  const summary = (await admin.textContent("#import-preview .imp-summary")).replace(/\s+/g, " ");
  assert.match(summary, /4 prontos.*2 com erro.*1 parece repetido.*1 vai direto para aprovação/, summary);
  assert.equal(await admin.locator("#import-preview [data-imp-line]:checked").count(), 3, "repetido e com erro ficam de fora");
  await shot(admin, "a09-importar-anuncios");
  await admin.click("#import-preview [data-imp-run]");
  await admin.waitForSelector("#import-preview .state__title");
  assert.match(await admin.textContent("#import-preview .state"), /3 anúncios importados para Padaria Central Ltda.*1 já foi enviado/s);
  const all = await store.listAds({ client_id: padaria.id });
  const by = (t) => all.find((a) => a.title === t);
  assert.deepEqual([by("Carrossel de julho").status, by("Carrossel de julho").ad_assets.length, by("Carrossel de julho").internal_notes], ["aguardando_aprovacao", 2, "INTERNO-X"]);
  assert.deepEqual([by("Vídeo da fornada").status, by("Vídeo da fornada").ad_assets[0].kind], ["rascunho", "video"]);
  assert.deepEqual([by("Post LinkedIn").status, by("Post LinkedIn").platform_other], ["rascunho", "LinkedIn Ads"]);
  assert.equal(all.filter((a) => a.title === "Promoção de inverno").length, 1, "repetido não foi importado de novo");
  // O cliente já vê o que foi enviado; rascunhos não
  await portalAds();
  await portal.waitForFunction(() => [...document.querySelectorAll(".ad-card__title")].some((n) => n.textContent === "Carrossel de julho"));
  const titles = await portal.$$eval(".ad-card__title", (n) => n.map((x) => x.textContent));
  assert.ok(!titles.includes("Vídeo da fornada") && !titles.includes("Post LinkedIn"));
  await admin.click("#import-preview [data-imp-see]");
  await admin.waitForURL(/#\/anuncios/);
  await admin.waitForFunction(() => [...document.querySelectorAll(".ad-card__title")].some((n) => n.textContent === "Vídeo da fornada"));
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

await browser.close();
server.close();
console.log(process.exitCode ? "\nAlgum teste falhou." : `\n${results.length} verificações passaram.`);
