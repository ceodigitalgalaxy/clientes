/* Teste de ponta a ponta do painel (login + tela), com um Supabase de mentira
   em memória (fake-supabase.mjs). Precisa do Playwright instalado
   (npm i -D playwright) ou indicado em PLAYWRIGHT=/caminho/para/playwright/index.mjs.
   Rode: node admin/test/e2e.mjs   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import http from "node:http";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5611;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/admin/`;
const SHOTS = process.env.ADMIN_SHOTS;
const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const TEAM = { username: "admdg-teste", password: "Senha-de-teste-123" };
fake.addUser(TEAM.username, TEAM.password, { name: "Equipe DG" });
fake.addUser("visitante", "Outra-senha-456", { member: false });
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const results = [];
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) { results.push(`✘ ${label}: ${error.message.split("\n")[0]}`); process.exitCode = 1; }
  console.log(results.at(-1));
};

/* ---------- Segurança da prévia local ---------- */
const raw = (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers })); });
  req.end(body);
});
const host = { Host: `localhost:${PORT}` };
await step("Prévia local recusa Host desconhecido (DNS rebinding)", async () => assert.equal((await raw("/admin/", { headers: { Host: "evil.example" } })).status, 421));
await step("Prévia local só aceita leitura", async () => assert.equal((await raw("/admin/", { method: "POST", headers: host, body: "{}" })).status, 405));
await step("Prévia local não expõe arquivos fora de site/ (nem o admin/.env)", async () => {
  for (const p of ["/../admin/.env", "/%2e%2e/admin/.env", "/..%2fadmin%2f.env", "/admin/..%2f..%2fadmin%2fequipe.mjs", "/..%2fREADME.md", "/.env"]) {
    const r = await raw(p, { headers: host });
    assert.equal(r.status, 404, p);
  }
});
await step("Página do painel tem CSP, noindex e nenhuma chave secreta", async () => {
  const r = await raw("/admin/", { headers: host });
  assert.equal(r.status, 200);
  assert.match(r.body, /Content-Security-Policy" content="default-src 'self'; script-src 'self'/);
  assert.match(r.body, /connect-src 'self' https:\/\/peieimwpkrattuldmjux\.supabase\.co;/);
  assert.match(r.body, /noindex/);
  assert.equal(r.headers["x-frame-options"], "DENY");
  const config = await raw("/js/config.js", { headers: host });
  assert.doesNotMatch(config.body, /sb_secret_[A-Za-z0-9]|service_role|eyJ[A-Za-z0-9]/, "só a chave publicável vai para o navegador");
  assert.match(config.body, /sb_publishable_[A-Za-z0-9]/);
});

/* ---------- Tela ---------- */
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
// Pedidos ao Supabase respondidos pelo Supabase de mentira (nada sai para a internet)
await context.route(`${SUPABASE_URL}/**`, async (route) => {
  const req = route.request();
  const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData() });
  if (answer === "abort") return route.abort("failed");
  return route.fulfill(answer);
});
const page = await context.newPage();
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

const loginError = async () => { await page.waitForSelector("#login .form-error:not([hidden])"); return (await page.textContent("#login .form-error")).trim(); };
const signIn = async (username, password) => {
  await page.fill('#login-form [name="username"]', username);
  await page.fill('#login-form [name="password"]', password);
  await page.click("#login-form [type=submit]");
};
const sessionStored = () => page.evaluate(() => localStorage.getItem("dg-painel-sessao"));

await step("Sem login: só a tela de entrada, nenhum dado pedido ao banco", async () => {
  await page.goto(BASE);
  await page.waitForSelector("#login:not([hidden])");
  assert.equal(await page.isVisible("#app"), false);
  assert.equal(await page.textContent("#login-title"), "Painel da agência");
  assert.equal(fake.log.filter((r) => r.path.startsWith("/rest/")).length, 0);
  await shot("00-entrar");
});

await step("Campos vazios são apontados", async () => {
  await page.click("#login-form [type=submit]");
  assert.equal(await page.getAttribute('#login-form [name="username"]', "aria-invalid"), "true");
  assert.equal(await page.getAttribute('#login-form [name="password"]', "aria-invalid"), "true");
});

await step("Senha errada ou usuário inexistente: a mesma mensagem", async () => {
  await signIn(TEAM.username, "senha-errada-000");
  assert.equal(await loginError(), "Usuário ou senha incorretos.");
  assert.equal(await page.inputValue('#login-form [name="password"]'), "", "a senha digitada é apagada");
  await signIn("ninguem", "qualquer-senha-1");
  await page.waitForFunction(() => !document.querySelector("#login-form [type=submit]").disabled);
  assert.equal(await loginError(), "Usuário ou senha incorretos.");
  assert.equal(await sessionStored(), null);
});

await step("Muitas tentativas: pede para aguardar", async () => {
  fake.failAuthNext = 1;
  await signIn(TEAM.username, TEAM.password);
  await page.waitForFunction(() => document.querySelector("#login .form-error").textContent.includes("Muitas tentativas"));
});

await step("Usuário fora da equipe é recusado e a sessão é apagada", async () => {
  await signIn("visitante", "Outra-senha-456");
  await page.waitForFunction(() => document.querySelector("#login .form-error").textContent.includes("não tem acesso"));
  assert.equal(await page.isVisible("#app"), false);
  assert.equal(await sessionStored(), null);
  await shot("00-sem-acesso");
});

await step("Login da equipe abre o painel (usuário aceita maiúsculas)", async () => {
  store.delayMs = 400;
  await signIn("AdmDG-Teste", TEAM.password);
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForSelector(".skeleton");                       // estado de carregamento
  assert.equal(await page.isVisible("#login"), false, "tela de entrada some depois do login");
  assert.match(await page.textContent("#user-name"), /Equipe DG/);
  assert.ok(await sessionStored(), "sessão guardada no navegador");
  assert.equal(await page.evaluate(() => document.body.innerHTML.includes("Senha-de-teste-123")), false, "a senha não fica na página");
  assert.ok(!(await sessionStored()).includes(TEAM.password), "a senha não é guardada");
});

await step("Carregamento e lista vazia de conteúdos sem clientes", async () => {
  await page.waitForSelector(".state__title");
  assert.equal(await page.textContent(".state__title"), "Cadastre um cliente primeiro");
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

await step("Recarregar a página mantém o login", async () => {
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  assert.equal(await page.isVisible("#login"), false);
  await page.waitForSelector(".row[data-row]");
});

await step("Sem internet ao abrir: avisa, sem tela em branco e sem perder a sessão", async () => {
  fake.offline = true;
  await page.reload();
  assert.match(await loginError(), /Não foi possível conectar/);
  assert.ok(await sessionStored(), "sessão mantida para quando a internet voltar");
  fake.offline = false;
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForSelector(".row[data-row]");
});

const refreshCount = () => fake.log.filter((r) => r.query.includes("grant_type=refresh_token")).length;
const waitFor = async (condition, label) => {
  for (let i = 0; i < 80; i += 1) { if (condition()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`esperando: ${label}`);
};

await step("Token vencido é renovado sozinho, sem perder o que estava na tela", async () => {
  fake.expireAccessTokens();
  const before = refreshCount();
  await page.selectOption('#filters [name="status"]', "planejado");      // pede dados ao banco
  await waitFor(() => refreshCount() > before, "pedido de token novo");
  await page.waitForFunction(() => document.querySelector("#contents-list .state__title")?.textContent === "Nenhum conteúdo encontrado");
  await page.click('#filters [type="reset"]');
  await page.waitForFunction(() => document.querySelectorAll(".row[data-row]").length === 2);
  assert.equal(await page.isVisible("#app"), true);
});

await step("Sessão encerrada no servidor volta para a entrada e limpa os dados da tela", async () => {
  fake.revokeAll();
  await page.selectOption('#filters [name="status"]', "planejado");
  assert.equal(await loginError(), "Sua sessão expirou. Entre de novo.");
  assert.equal(await page.isVisible("#app"), false);
  assert.equal(await page.locator(".client-card, .row[data-row]").count(), 0, "dados apagados da tela");
  assert.equal(await sessionStored(), null);
  await page.evaluate(() => { location.hash = "#/conteudos"; });
});

await step("Sair encerra a sessão (e continua fora depois de recarregar)", async () => {
  await signIn(TEAM.username, TEAM.password);
  await page.waitForSelector("#app:not([hidden])");
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector("#login:not([hidden])");
  assert.equal(await page.textContent("#login .form-error"), "Você saiu do painel.");
  assert.equal(await sessionStored(), null);
  assert.ok(fake.log.some((r) => r.path === "/auth/v1/logout"), "sessão encerrada no Supabase");
  await page.reload();
  await page.waitForSelector("#login:not([hidden])");
  assert.equal(await page.isVisible("#app"), false);
});

await step("Painel não aparece dentro de outro site (iframe)", async () => {
  const other = await context.newPage();
  // A prévia local já bloqueia iframes pelo cabeçalho X-Frame-Options; o GitHub Pages não
  // manda esse cabeçalho, então aqui ele é tirado para testar a proteção da própria página.
  await other.route(`${ORIGIN}/**`, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["x-frame-options"];
    await route.fulfill({ response, headers });
  });
  await other.setContent(`<iframe src="${BASE}" width="800" height="600"></iframe>`);
  const frame = await (await other.waitForSelector("iframe")).contentFrame();
  await frame.waitForLoadState("load");
  await other.waitForTimeout(300);
  assert.equal(await frame.evaluate(() => document.querySelector("#login-title") !== null), true, "a página carregou no iframe");
  assert.equal(await frame.evaluate(() => getComputedStyle(document.body).visibility), "hidden");
  await other.close();
});

await step("Entrar de novo para os testes de celular", async () => {
  await signIn(TEAM.username, TEAM.password);
  await page.waitForSelector("#app:not([hidden])");
});

await step("Celular: lista e formulário cabem na tela", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector(".row[data-row]");
  await page.click('[data-action="sign-out"]');
  await page.waitForSelector("#login:not([hidden])");
  const loginOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(loginOverflow <= 0, `entrada com rolagem lateral de ${loginOverflow}px`);
  await shot("11-entrar-celular");
  await signIn(TEAM.username, TEAM.password);
  await page.waitForSelector(".row[data-row]");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `rolagem lateral de ${overflow}px`);
  await shot("10-celular");
});

await step("Sem erros de JavaScript no console", async () => assert.deepEqual(consoleErrors, [], JSON.stringify(consoleErrors)));

await browser.close();
server.close();
console.log(process.exitCode ? "\nAlgum teste falhou." : `\n${results.length} verificações passaram.`);
