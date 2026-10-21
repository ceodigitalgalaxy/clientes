/* Teste de ponta a ponta do painel (tela + servidor), com o armazenamento de
   teste em memória. Precisa do Playwright instalado (npm i -D playwright) ou
   indicado em PLAYWRIGHT=/caminho/para/playwright/index.mjs.
   Rode: node admin/test/e2e.mjs   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import http from "node:http";
import { createAdminServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5611;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;
const store = createMemoryStore();
const server = createAdminServer({ store, port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) { results.push(`✘ ${label}: ${error.message.split("\n")[0]}`); process.exitCode = 1; }
  console.log(results.at(-1));
};

/* ---------- Segurança do servidor ---------- */
const raw = (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers })); });
  req.end(body);
});
await step("Recusa Host desconhecido (DNS rebinding)", async () => assert.equal((await raw("/api/clients", { headers: { Host: "evil.example" } })).status, 421));
await step("Recusa escrita vinda de outro site", async () => {
  const r = await raw("/api/clients", { method: "POST", headers: { Host: `localhost:${PORT}`, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
});
await step("Recusa escrita sem JSON", async () => {
  const r = await raw("/api/clients", { method: "POST", headers: { Host: `localhost:${PORT}`, Origin: BASE, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(r.status, 415);
});
await step("Não expõe arquivos fora das pastas permitidas", async () => {
  for (const p of ["/shared/index.html", "/shared/js/main.js", "/../server.mjs", "/%2e%2e/server.mjs", "/shared/..%2f..%2fadmin%2f.env", "/.env"]) {
    const r = await raw(p, { headers: { Host: `localhost:${PORT}` } });
    assert.equal(r.status, 404, p);
  }
});
await step("Envia CSP e proteções nos cabeçalhos", async () => {
  const r = await raw("/", { headers: { Host: `localhost:${PORT}` } });
  assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
});
await step("Servidor recusa dados inválidos mesmo sem passar pela tela", async () => {
  const r = await raw("/api/contents", { method: "POST", headers: { Host: `localhost:${PORT}`, Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", media_url: "javascript:alert(1)" }) });
  assert.equal(r.status, 422);
  const data = JSON.parse(r.body);
  assert.ok(data.fields.client_id && data.fields.media_url && data.fields.network);
});

/* ---------- Tela ---------- */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.setDefaultTimeout(8000);
const consoleErrors = [];
// Respostas de erro provocadas pelos próprios testes (409, 503, mídia externa) aparecem
// como "Failed to load resource": não são erros de código. Erros de JavaScript contam.
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const toastText = async () => (await page.locator(".toast").last().textContent()).trim();
const fillContent = async (data) => {
  for (const [name, value] of Object.entries(data)) {
    const el = page.locator(`#content-modal [name="${name}"]`).first();
    const tag = await el.evaluate((n) => n.tagName);
    if (tag === "SELECT") await el.selectOption(value); else await el.fill(value);
  }
};

await step("Carregamento e lista vazia de conteúdos sem clientes", async () => {
  store.delayMs = 400;
  await page.goto(BASE);
  await page.waitForSelector(".skeleton");                       // estado de carregamento
  await page.waitForSelector(".state__title");
  assert.equal(await page.textContent(".state__title"), "Cadastre um cliente primeiro");
  assert.equal(await page.textContent(".db-status__text"), "Banco conectado");
  store.delayMs = 0;
  await shot("01-sem-clientes");
});

await step("Lista vazia de clientes", async () => {
  await page.click('.state [data-action="go-clients"]');
  await page.waitForURL(/#\/clientes/);
  await page.waitForSelector("#clients-list .state__title");
  assert.equal(await page.textContent("#clients-list .state__title"), "Nenhum cliente cadastrado");
});

await step("Cadastro de cliente valida campos e cria", async () => {
  await page.click('.view__head [data-action="new-client"]');
  await page.click("#client-modal [type=submit]");
  assert.equal(await page.getAttribute('#client-modal [name="name"]', "aria-invalid"), "true");
  await page.fill('#client-modal [name="name"]', "Padaria Central Ltda");
  assert.equal(await page.inputValue('#client-modal [name="slug"]'), "padaria-central-ltda", "identificador gerado pelo nome");
  await page.fill('#client-modal [name="segment"]', "Alimentação");
  await page.fill('#client-modal [name="contact_email"]', "contato-invalido");
  await page.click("#client-modal [type=submit]");
  assert.match(await page.textContent("#client-modal .field__error"), /e-mail válido/);
  await page.fill('#client-modal [name="contact_email"]', "contato@padariacentral.com.br");
  await shot("02-form-cliente");
  await page.click("#client-modal [type=submit]");
  await page.waitForSelector(".client-card");
  assert.equal(await toastText(), "Cliente cadastrado");
  assert.equal(await page.textContent(".client-card__slug"), "padaria-central-ltda");
});

await step("Identificador repetido é recusado com mensagem", async () => {
  await page.waitForSelector("#client-modal:not([open])", { state: "attached" });
  await page.click('.view__head [data-action="new-client"]');
  await page.fill('#client-modal [name="name"]', "Padaria Central Ltda");
  await page.click("#client-modal [type=submit]");
  await page.waitForSelector("#client-modal .form-error:not([hidden])");
  assert.match(await page.textContent("#client-modal .form-error"), /Já existe um cliente com esse identificador/);
  await page.fill('#client-modal [name="slug"]', "estudio-luz");
  await page.fill('#client-modal [name="name"]', "Estúdio Luz");
  await page.click("#client-modal [type=submit]");
  await page.waitForFunction(() => document.querySelectorAll(".client-card").length === 2);
});

await step("Edição de cliente (inativar)", async () => {
  await page.waitForSelector("#client-modal:not([open])", { state: "attached" });
  await page.click('.client-card:has-text("Estúdio Luz") [data-edit-client]');
  assert.equal(await page.inputValue('#client-modal [name="name"]'), "Estúdio Luz");
  await page.uncheck('#client-modal [name="active"]');
  await page.click("#client-modal [type=submit]");
  await page.waitForSelector(".client-card.is-inactive");
  assert.equal(await toastText(), "Cliente atualizado");
  await shot("03-clientes");
});

await step("Lista vazia de conteúdos com cliente cadastrado", async () => {
  await page.click('[data-route="conteudos"]');
  await page.waitForSelector("#contents-list .state__title");
  assert.equal(await page.textContent("#contents-list .state__title"), "Nenhum conteúdo cadastrado ainda");
});

await step("Cadastro de conteúdo valida e cria", async () => {
  await page.click('.view__head [data-action="new-content"]');
  const options = await page.$$eval('#content-modal [name="client_id"] option', (o) => o.map((x) => x.textContent));
  assert.ok(!options.includes("Estúdio Luz"), "cliente inativo não aparece para novos conteúdos");
  await page.fill('#content-modal [name="title"]', "");
  await page.click("#content-modal [type=submit]");
  assert.ok(await page.locator("#content-modal .field__error").count() >= 3);
  await fillContent({ title: "Lançamento do pão de fermentação natural", scheduled_date: "2026-11-05", scheduled_time: "10:30", network: "instagram", format: "reels", media_url: "https://example.com/video.mp4", caption: "Chegou o pão que você pediu!", internal_notes: "Gravar na quinta de manhã", status: "em_producao" });
  assert.equal(await page.isVisible("[data-media-kind]"), true);
  assert.equal(await page.$eval('#content-modal [name="media_kind"]:checked', (n) => n.value), "video", "reels sugere vídeo");
  assert.match(await page.textContent("#caption-count"), /^28 de 2\.200/);
  await shot("04-form-conteudo");
  await page.click("#content-modal [type=submit]");
  await page.waitForSelector(".row[data-row]");
  assert.equal(await toastText(), "Conteúdo cadastrado");
});

await step("Mais conteúdos para testar filtros", async () => {
  for (const c of [
    { title: "Carrossel de dicas de conservação", scheduled_date: "2026-11-12", network: "instagram", format: "carrossel", status: "aguardando_aprovacao" },
    { title: "Post de Natal", scheduled_date: "2026-12-20", network: "facebook", format: "post", status: "planejado" }
  ]) {
    await page.waitForSelector("#content-modal:not([open])", { state: "attached" });
    await page.click('.view__head [data-action="new-content"]');
    await fillContent(c);
    await page.click("#content-modal [type=submit]");
    await page.waitForFunction((t) => [...document.querySelectorAll(".row__title")].some((n) => n.textContent === t), c.title);
  }
  assert.equal(await page.locator(".row[data-row]").count(), 3);
  await shot("05-lista");
});

await step("Visualizar conteúdo (detalhes e observação interna)", async () => {
  await page.click('.row__title:text("Lançamento do pão de fermentação natural")');
  await page.waitForSelector("#content-drawer[open]");
  assert.equal(await page.textContent("#drawer-title"), "Lançamento do pão de fermentação natural");
  assert.match(await page.textContent(".internal__text"), /Gravar na quinta/);
  assert.match(await page.textContent(".drawer__version"), /Ainda não aparece para o cliente · versão 1/);
  assert.equal(await page.getAttribute(".media-ref video", "src"), "https://example.com/video.mp4");
  await shot("06-detalhes");
});

await step("Editar conteúdo (sobe a versão)", async () => {
  await page.click('#content-drawer [data-edit-content]');
  await page.waitForSelector("#content-modal[open]");
  assert.equal(await page.inputValue('#content-modal [name="scheduled_time"]'), "10:30");
  await page.fill('#content-modal [name="caption"]', "Chegou o pão de fermentação natural!");
  await page.selectOption('#content-modal [name="status"]', "aguardando_aprovacao");
  await page.click("#content-modal [type=submit]");
  await page.waitForFunction(() => document.querySelector(".toast:last-child")?.textContent.includes("Conteúdo atualizado"));
  await page.click('.row__title:text("Lançamento do pão de fermentação natural")');
  await page.waitForSelector("#content-drawer[open]");
  assert.match(await page.textContent(".drawer__version"), /Visível no calendário do cliente · versão 2/);
  assert.match(await page.textContent(".caption-text"), /pão de fermentação natural!/);
  await page.click('#content-drawer [data-action="close-drawer"]');
  await page.waitForSelector("#content-drawer:not([open])", { state: "attached" });
});

await step("Filtrar por status", async () => {
  await page.selectOption('#filters [name="status"]', "aguardando_aprovacao");
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 2);
  assert.match(page.url(), /status=aguardando_aprovacao/);
});

await step("Filtrar por data", async () => {
  await page.selectOption('#filters [name="status"]', "");
  await page.fill('#filters [name="from"]', "2026-12-01");
  await page.dispatchEvent('#filters [name="from"]', "change");
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 1);
  assert.equal(await page.textContent(".row__title"), "Post de Natal");
});

await step("Filtrar por cliente e filtro sem resultado", async () => {
  await page.click('#filters [type="reset"]');
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 3);
  await page.click('[data-route="clientes"]');
  await page.click('.client-card:has-text("Estúdio Luz") [data-client-contents]');
  await page.waitForURL(/client_id=/);
  await page.waitForSelector("#contents-list .state__title");
  assert.equal(await page.textContent("#contents-list .state__title"), "Nenhum conteúdo encontrado");
  await shot("07-filtro-vazio");
  await page.click('#contents-list [data-action="clear-filters"]');
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 3);
});

await step("Filtros sobrevivem ao recarregar a página", async () => {
  await page.selectOption('#filters [name="status"]', "planejado");
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 1);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 1);
  assert.equal(await page.inputValue('#filters [name="status"]'), "planejado");
  await page.click('#filters [type="reset"]');
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 3);
});

await step("Excluir pede confirmação (cancelar mantém)", async () => {
  await page.click('.row:has-text("Post de Natal") [data-delete-content]');
  await page.waitForSelector("#confirm-modal[open]");
  assert.match(await page.textContent("#confirm-text"), /Post de Natal/);
  await shot("08-confirmar-exclusao");
  await page.click('#confirm-modal [data-confirm="cancel"]');
  await page.waitForSelector("#confirm-modal:not([open])", { state: "attached" });
  assert.equal(await page.locator(".row[data-row]").count(), 3);
});

await step("Excluir após confirmar", async () => {
  await page.click('.row:has-text("Post de Natal") [data-delete-content]');
  await page.click('#confirm-modal [data-confirm="ok"]');
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 2);
  assert.equal(await toastText(), "Conteúdo excluído");
  assert.equal((await store.listContents()).length, 2, "removido do armazenamento");
});

await step("Cliente com conteúdos não mostra opção de excluir; sem conteúdos mostra", async () => {
  await page.click('[data-route="clientes"]');
  await page.waitForSelector(".client-card");
  assert.equal(await page.locator('.client-card:has-text("Padaria Central") [data-delete-client]').count(), 0);
  assert.equal(await page.locator('.client-card:has-text("Estúdio Luz") [data-delete-client]').count(), 1);
});

await step("Mensagem de erro e nova tentativa quando o banco falha", async () => {
  store.failNext = 1;
  await page.click('[data-route="conteudos"]');
  await page.waitForSelector(".state--error");
  assert.match(await page.textContent(".state--error .state__text"), /Não foi possível conectar/);
  await shot("09-erro");
  await page.click('[data-action="reload-contents"]');
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 2);
});

await step("Erro ao salvar mantém o formulário aberto com a mensagem", async () => {
  await page.click('.row:has-text("Carrossel") [data-edit-content]');
  await page.waitForSelector("#content-modal[open]");
  store.failNext = 1;
  await page.click("#content-modal [type=submit]");
  await page.waitForSelector("#content-modal .form-error:not([hidden])");
  assert.equal(await page.isVisible("#content-modal"), true);
  await page.click("#content-modal [type=submit]");
  await page.waitForSelector("#content-modal:not([open])", { state: "attached" });
});

await step("Calendário do cliente recebe só o que está visível, sem notas internas", async () => {
  const [client] = (await store.listClients()).filter((c) => c.slug === "padaria-central-ltda");
  const r = await raw(`/api/clients/${client.id}/calendar`, { headers: { Host: `localhost:${PORT}` } });
  const items = JSON.parse(r.body);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => !("internal_notes" in i)));
});

await step("Celular: lista e formulário cabem na tela", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector(".row[data-row]");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `rolagem lateral de ${overflow}px`);
  await shot("10-celular");
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

await browser.close();
server.close();
console.log(process.exitCode ? "\nAlgum teste falhou." : `\n${results.length} verificações passaram.`);
