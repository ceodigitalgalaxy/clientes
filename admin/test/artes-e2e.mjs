/* Teste de ponta a ponta do gerador de artes:
   painel (identidade do cliente) → portal (aba Criar artes) → arte baixada.
   Tudo sobre o Supabase de mentira em memória (fake-supabase.mjs); nada sai
   para a internet. Rode: node admin/test/artes-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5614;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const PNG = readFileSync(path.join(HERE, "fixtures/arte.png"));
const PNG_FILE = path.join(HERE, "fixtures/arte.png");

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const petshop = await store.createClient({ name: "Pet Shop Aurora", slug: "pet-shop-aurora", segment: "Pet", active: true });
const outro = await store.createClient({ name: "Loja Sem Artes", slug: "loja-sem-artes", segment: "Varejo", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe DG" });
fake.addUser("aurora", "Senha-aurora-123", { kind: "cliente", clientId: petshop.id });
fake.addUser("semartes", "Senha-semartes-123", { kind: "cliente", clientId: outro.id });
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) { results.push(`✘ ${label}: ${error.message.split("\n")[0]}`); process.exitCode = 1; }
  console.log(results.at(-1));
};

const browser = await chromium.launch();
const consoleErrors = [];
async function newPage(name, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, ...options });
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    if (answer === "abort") return route.abort("failed");
    return route.fulfill(answer);
  });
  // Função ler-produto (link do produto): respondida aqui, com o mesmo formato da função real
  await context.route(`${SUPABASE_URL}/functions/v1/ler-produto`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
    if (!/^Bearer \S+/.test(req.headers().authorization || "")) return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Entre de novo."}' });
    const body = JSON.parse(req.postData() || "{}");
    const cors = { "access-control-allow-origin": "*" };
    if (body.imagem) return route.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ nome: "Coleira Seresto Cães acima de 8 kg", descricao: "Proteção de até 8 meses contra pulgas e carrapatos.", preco: "189,90", precoAntigo: "259,90", imagem: "https://loja.exemplo.com/seresto.png", site: "loja.exemplo.com" }) });
  });
  // "Imagem da web" colada por link: respondida aqui (sem internet)
  await context.route("https://loja.exemplo.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
  return page;
}
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); } };
async function login(page, url, username, password) {
  await page.goto(url);
  await page.fill('#login-form [name="username"]', username);
  await page.fill('#login-form [name="password"]', password);
  await page.click("#login-form [type=submit]");
}

const admin = await newPage("painel");
const cliente = await newPage("artes");

await step("Painel: identidade para artes (logos, cores, unidades e campanhas) é salva", async () => {
  await login(admin, `${ORIGIN}/admin/`, "admdg-teste", "Senha-de-teste-123");
  await admin.click('[data-route="clientes"]');
  await admin.click(`[data-brand-client-id="${petshop.id}"]`);
  await admin.waitForSelector("#brand-modal[open]");
  await admin.setInputFiles('#brand-modal [name="logo_emblema"]', PNG_FILE);
  await admin.setInputFiles('#brand-modal [name="logo_principal"]', PNG_FILE);
  await admin.fill('#brand-modal [name="color_primaria"]', "#0b5d3b");
  await admin.fill('#brand-modal [name="unit_0_nome"]', "Centro");
  await admin.fill('#brand-modal [name="unit_0_marca"]', "Pet Shop Aurora");
  await admin.fill('#brand-modal [name="unit_0_endereco"]', "Rua das Flores, 100");
  await admin.fill('#brand-modal [name="unit_0_whatsapp"]', "(51) 99999-1234");
  await admin.click('#brand-modal [data-action="add-unit"]');
  await admin.fill('#brand-modal [name="unit_1_nome"]', "Bairro Alto");
  await admin.fill('#brand-modal [name="unit_1_whatsapp"]', "51988887777");
  await admin.check('#brand-modal [name="campaigns"][value="natal"]');
  for (const m of ["evento", "antesdepois", "frase"]) await admin.check(`#brand-modal [name="model"][value="${m}"]`);
  await shot(admin, "artes-01-painel-identidade");
  await admin.click("#brand-modal [type=submit]");
  await admin.waitForSelector("#brand-modal:not([open])", { state: "attached" });
  const kit = fake.brandKits.get(petshop.id);
  assert.ok(kit, "identidade gravada");
  assert.equal(kit.colors.primaria, "#0B5D3B");
  assert.deepEqual(kit.units.map((u) => [u.id, u.whatsapp]), [["centro", "51999991234"], ["bairro-alto", "51988887777"]]);
  assert.deepEqual(kit.campaigns, ["padrao", "natal"]);
  assert.deepEqual(kit.models, ["oferta", "plano", "evento", "antesdepois", "frase", "aviso"]);
  assert.match(kit.logos.emblema, new RegExp(`^${petshop.id}/marca-emblema-`));
  assert.ok(kit.logos.principal);
});

await step("Painel: reabrir mostra a identidade salva", async () => {
  await admin.click(`[data-brand-client-id="${petshop.id}"]`);
  await admin.waitForSelector("#brand-modal[open]");
  await admin.waitForFunction(() => document.querySelector('#brand-modal [name="unit_1_nome"]')?.value === "Bairro Alto");
  assert.equal(await admin.inputValue('#brand-modal [name="color_primaria"]'), "#0b5d3b");
  assert.equal(await admin.locator("#brand-modal .brand-logo__preview img").count(), 2);
  await admin.click('#brand-modal [data-action="close-modal"]');
});

await step("Painel: unidade com WhatsApp inválido não salva", async () => {
  await admin.click(`[data-brand-client-id="${petshop.id}"]`);
  await admin.waitForFunction(() => document.querySelector('#brand-modal [name="unit_0_nome"]')?.value === "Centro");
  await admin.fill('#brand-modal [name="unit_0_whatsapp"]', "123");
  await admin.click("#brand-modal [type=submit]");
  await admin.waitForSelector('#brand-modal [name="unit_0_whatsapp"][aria-invalid="true"]');
  assert.equal(fake.brandKits.get(petshop.id).units[0].whatsapp, "51999991234");
  await admin.click('#brand-modal [data-action="close-modal"]');
});

await step("Portal: aba Criar artes aparece só para quem tem identidade liberada", async () => {
  await login(cliente, `${ORIGIN}/`, "aurora", "Senha-aurora-123");
  await cliente.waitForSelector("[data-artes-tab]:not([hidden])");
});

await step("Criar artes: abre com a marca do cliente e um exemplo na prévia", async () => {
  await cliente.click("[data-artes-tab]");
  await cliente.waitForSelector("#app:not([hidden])");
  assert.match(await cliente.textContent("#art-client"), /Pet Shop Aurora/);
  assert.deepEqual(await cliente.$$eval("#unidade option", (o) => o.map((x) => x.textContent)), ["Pet Shop Aurora · Centro", "Bairro Alto"]);
  assert.deepEqual(await cliente.$$eval("#tema option", (o) => o.map((x) => x.value)), ["padrao", "natal"]);
  assert.equal(await cliente.inputValue("#c-nome"), "Semana");
  await shot(cliente, "artes-02-exemplo");
});

await step("Criar artes: sem foto e sem preço não gera; mostra o que falta", async () => {
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForSelector(".field.is-invalid");
  assert.match(await cliente.textContent("#status"), /campos obrigatórios/);
  assert.equal(await cliente.isDisabled("#baixar"), true);
});

await step("Criar artes: oferta com foto da web (link), gerar e baixar PNG em stories", async () => {
  await cliente.fill('[data-photo-field="oferta"] .art-paste input', "https://loja.exemplo.com/produto.png");
  await cliente.click('[data-photo-field="oferta"] .art-paste button');
  await cliente.waitForSelector('[data-photo-field="oferta"] .art-drop img:not([hidden])');
  await cliente.fill("#o-produto", "Ração Premium para Gatos Castrados 1,5 kg");
  await cliente.fill("#o-de", "99,90");
  await cliente.fill("#o-por", "79,90");
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForFunction(() => !document.querySelector("#baixar").disabled);
  const [download] = await Promise.all([cliente.waitForEvent("download"), cliente.click("#baixar")]);
  assert.match(download.suggestedFilename(), /^oferta-story-\d{4}-\d{2}-\d{2}\.png$/);
  const file = await download.path();
  const head = readFileSync(file).subarray(0, 24);
  assert.equal(head.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([head.readUInt32BE(16), head.readUInt32BE(20)], [1080, 1920]);
  await shot(cliente, "artes-03-oferta");
});

await step("Criar artes: A4 sai em alta para impressão (2480×3508)", async () => {
  await cliente.click('label[for="fm-a4"]');
  const [download] = await Promise.all([cliente.waitForEvent("download"), cliente.click("#baixar")]);
  const head = readFileSync(await download.path()).subarray(0, 24);
  assert.deepEqual([head.readUInt32BE(16), head.readUInt32BE(20)], [2480, 3508]);
});

await step("Criar artes: aviso com as unidades e o WhatsApp da unidade escolhida", async () => {
  await cliente.selectOption("#unidade", "bairro-alto");
  await cliente.click('label[for="m-aviso"]');
  await cliente.click('label[for="fm-feed"]');
  await cliente.selectOption('[data-unit-status="centro"]', "fechado");
  await cliente.fill('[data-unit-hours="bairro-alto"]', "9h às 13h");
  await cliente.selectOption('[data-unit-status="bairro-alto"]', "reduzido");
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForFunction(() => !document.querySelector("#baixar").disabled);
  assert.match(await cliente.textContent("#unit-contact"), /\(51\) 98888-7777/);
  await shot(cliente, "artes-04-aviso");
});

await step("Criar artes: link do produto preenche nome, descrição, preços e foto", async () => {
  await cliente.click('label[for="m-oferta"]');
  await cliente.fill("#o-link", "https://loja.exemplo.com/seresto/p");
  await cliente.click("#o-buscar");
  await cliente.waitForFunction(() => document.querySelector("#o-produto").value.startsWith("Coleira Seresto"));
  assert.equal(await cliente.inputValue("#o-por"), "189,90");
  assert.equal(await cliente.inputValue("#o-de"), "259,90");
  assert.match(await cliente.inputValue("#o-desc"), /8 meses/);
  await cliente.waitForFunction(() => /Imagem da web/.test(document.querySelector('[data-photo-field="oferta"] .art-drop span').textContent));
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForFunction(() => !document.querySelector("#baixar").disabled);
  await shot(cliente, "artes-06-link-produto");
});

await step("Criar artes: evento, antes e depois e frase (modelos liberados pela agência)", async () => {
  assert.deepEqual(await cliente.$$eval('#model-seg input', (n) => n.map((x) => x.value)), ["oferta", "plano", "evento", "antesdepois", "frase", "aviso"]);
  await cliente.click('label[for="m-evento"]');
  await cliente.fill("#e-titulo", "Aula experimental de jiu-jitsu");
  await cliente.fill("#e-data", "Sábado, 15/11");
  await cliente.fill("#e-horario", "10h");
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForFunction(() => !document.querySelector("#baixar").disabled);
  await shot(cliente, "artes-07-evento");
  await cliente.click('label[for="m-antesdepois"]');
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForSelector('[data-photo-field="antes"].is-invalid');
  await cliente.setInputFiles("#ph-antes", PNG_FILE);
  await cliente.setInputFiles("#ph-depois", PNG_FILE);
  await cliente.fill("#d-titulo", "Lavagem completa");
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForFunction(() => !document.querySelector("#baixar").disabled);
  await shot(cliente, "artes-08-antes-depois");
  await cliente.click('label[for="m-frase"]');
  await cliente.fill("#f-texto", "Treinar me ensinou disciplina dentro e fora do tatame.");
  await cliente.fill("#f-autor", "Rafael");
  await cliente.click("#art-form [type=submit]");
  await cliente.waitForFunction(() => !document.querySelector("#baixar").disabled);
  await shot(cliente, "artes-09-frase");
  await cliente.click('label[for="m-aviso"]');
});

await step("Criar artes: mudar o formulário pede para gerar de novo", async () => {
  await cliente.fill("#a-titulo", "Novo horário");
  await cliente.waitForFunction(() => document.querySelector("#baixar").disabled);
});

await step("Cliente sem identidade liberada: sem aba e com aviso na página", async () => {
  const outroPage = await newPage("sem-artes");
  await login(outroPage, `${ORIGIN}/`, "semartes", "Senha-semartes-123");
  await outroPage.waitForSelector("#app:not([hidden])");
  await outroPage.waitForTimeout(500);
  assert.equal(await outroPage.locator("[data-artes-tab]").isHidden(), true);
  await outroPage.goto(`${ORIGIN}/artes/`);
  await outroPage.waitForSelector("#no-kit:not([hidden])");
});

await step("Celular: o gerador cabe na tela", async () => {
  const phone = await newPage("celular", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await login(phone, `${ORIGIN}/artes/`, "aurora", "Senha-aurora-123");
  await phone.waitForSelector("#app:not([hidden])");
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 390, `largura ${width}`);
  await shot(phone, "artes-05-celular");
});

await step("Sem erros de JavaScript no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(process.exitCode ? "\nAlgum teste falhou." : `\n${results.length} verificações passaram.`);
