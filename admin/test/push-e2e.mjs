/* Teste de ponta a ponta: avisos no celular (Web Push) pelo painel.
   O navegador de teste não fala com o Google/Apple, então o "receptor" do
   navegador (service worker + PushManager) é trocado por um de mentira que
   guarda a assinatura; o resto é de verdade: a tela, as regras do banco (no
   emulador) e a função avisos-push, que cifra o aviso para a chave do aparelho
   — aqui o teste decifra e confere o que chegaria.
   Confere também o receptor de verdade (sw.js) e o manifesto do aplicativo.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/push-e2e.mjs
   (capturas opcionais em ADMIN_SHOTS=pasta) */

import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { b64url } from "../../supabase/functions/avisos-push/webpush.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5691;
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = process.env.ADMIN_SHOTS;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana.design", "Senha-da-Ana-123", { name: "Ana Designer", profile: { role: "colaborador", all_clients: false, client_ids: [padaria.id], edit_scope: "atribuidos", can_send_approval: false, job_title: "Designer" } });
fake.addUser("caio.video", "Senha-do-Caio-123", { name: "Caio Videomaker", profile: { role: "colaborador", all_clients: true, edit_scope: "atribuidos", can_send_approval: false } });

/* O "celular da Ana": as chaves que o navegador criaria ao ativar os avisos */
const enc = new TextEncoder();
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));
const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const phonePublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const phoneAuth = crypto.getRandomValues(new Uint8Array(16));
const PHONE = { endpoint: "https://fcm.googleapis.com/fcm/send/celular-da-ana", p256dh: b64url(phonePublic), auth: b64url(phoneAuth) };
async function readPush(body) {
  const salt = body.slice(0, 16);
  const asPublic = body.slice(21, 21 + body[20]);
  const peer = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, pair.privateKey, 256));
  const ikm = await hkdf(phoneAuth, shared, concat(enc.encode("WebPush: info\0"), phonePublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), body.slice(21 + body[20])));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}
const lastPush = async () => { await fake.pushSettled; return readPush(fake.pushes.at(-1).body); };

/** Receptor de mentira no navegador (a assinatura fica guardada como o navegador guardaria) */
function fakeReceiver({ phone, grant }) {
  const KEY = "__assinatura_de_teste";
  const sub = () => (localStorage.getItem(KEY) ? { endpoint: phone.endpoint, toJSON: () => ({ endpoint: phone.endpoint, keys: { p256dh: phone.p256dh, auth: phone.auth } }), unsubscribe: async () => { localStorage.removeItem(KEY); return true; } } : null);
  const registration = { scope: `${location.origin}/admin/`, pushManager: {
    getSubscription: async () => sub(),
    subscribe: async (options) => { window.__chaveDoServidor = options.applicationServerKey.length; localStorage.setItem(KEY, "1"); return sub(); }
  } };
  window.__ouvintes = [];
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async (url, options) => { window.__registrou = [url, options?.scope]; return registration; }, ready: Promise.resolve(registration), addEventListener: (type, fn) => window.__ouvintes.push(fn) } });
  window.PushManager = window.PushManager || function PushManager() {};
  window.Notification = { permission: localStorage.getItem("__permissao") || "default", requestPermission: async () => { window.Notification.permission = grant; localStorage.setItem("__permissao", grant); return grant; } };
}

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
let page = null;
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) {
    results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    process.exitCode = 1;
    if (SHOTS) await page?.screenshot({ path: `${SHOTS}/falha-push-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => {});
  }
  console.log(results.at(-1));
};
const browser = await chromium.launch();
const consoleErrors = [];
async function newPage(options, name, init = null) {
  const context = await browser.newContext(options);
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
  });
  if (init) await context.addInitScript(...init);
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
const openBell = async () => { if (await page.isHidden("#inbox")) await page.click('[data-action="toggle-inbox"]'); await page.waitForSelector("#inbox .inbox__push"); };

/* ============================== Ana ativa no "celular" ============================== */
page = await newPage({ ...devices["Pixel 7"] }, "ana", [fakeReceiver, { phone: PHONE, grant: "granted" }]);
const anaPage = page;

await step("O sininho oferece ativar os avisos neste aparelho", async () => {
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("ana.design", "Senha-da-Ana-123");
  await openBell();
  assert.match(await page.textContent("#inbox .inbox__push"), /Receba estes avisos no celular/);
  assert.ok(await page.isVisible('[data-push="ativar"]'));
  assert.deepEqual(await page.evaluate(() => window.__registrou), ["./sw.js", "./"], "receptor registrado só para o painel");
  assert.equal(fake.pushSubs.length, 0, "nada é ativado sem a pessoa pedir");
  await shot("push-01-ativar");
});

await step("Ativar: pede a permissão, grava o aparelho da própria pessoa e manda um aviso de teste", async () => {
  await page.click('[data-push="ativar"]');
  await toastSays(/Avisos ativados neste aparelho/);
  await page.waitForSelector(".inbox__push--ativo");
  assert.equal(await page.isVisible("#inbox"), true, "o painel de avisos continua aberto");
  assert.equal(await page.evaluate(() => window.__chaveDoServidor), 65, "assinou com a chave pública da agência");
  assert.equal(fake.pushSubs.length, 1);
  assert.equal(fake.pushSubs[0].user_id, ana.id);
  assert.equal(fake.pushSubs[0].endpoint, PHONE.endpoint);
  await page.waitForFunction(() => true);
  await fake.pushSettled;
  const deadline = Date.now() + 4000;
  while (!fake.pushes.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await readPush(fake.pushes.at(-1).body)).title, "Avisos ativados");
  await shot("push-02-ativado");
});

/* ============================== Bruna passa uma demanda ============================== */
let taskId = null;
await step("Demanda passada para a Ana chega no celular dela, cifrada, com resumo curto", async () => {
  fake.pushes.length = 0;
  page = await newPage({ viewport: { width: 1440, height: 1000 } }, "bruna");
  await page.goto(`${ORIGIN}/admin/#/gestao`);
  await signIn("admdg-teste", "Senha-de-teste-123");
  await page.waitForSelector("#view-gestao:not([hidden]) .tcol");
  await page.click('#view-gestao [data-action="new-task"]');
  await page.selectOption("[data-task-new] [name=client_id]", padaria.id);
  await page.fill("[data-task-new] [name=title]", "Arte do cardápio de Natal");
  await page.click(`[data-task-new] .pick-person:has([value="${ana.id}"])`);
  await page.click("[data-task-new] .btn--primary[type=submit]");
  await toastSays(/Demanda criada/);
  const deadline = Date.now() + 4000;
  while (!fake.pushes.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const message = await lastPush();
  taskId = fake.tasks.all().find((t) => t.title === "Arte do cardápio de Natal").id;
  assert.equal(message.title, "Bruna Admin te passou uma demanda");
  assert.equal(message.body, "Arte do cardápio de Natal");
  assert.equal(message.url, `/admin/?abrir=demanda.${taskId}`);
  assert.equal(fake.pushes.length, 1, "um aviso só");
  assert.equal(fake.pushes[0].endpoint, PHONE.endpoint);
  assert.ok(!new TextDecoder().decode(fake.pushes[0].body).includes("Natal"), "o texto não trafega às claras");
});

await step("Tocar no aviso com o painel aberto abre a demanda", async () => {
  page = anaPage;
  await page.evaluate((url) => window.__ouvintes.forEach((fn) => fn({ data: { type: "abrir-aviso", url } })), `${ORIGIN}/admin/?abrir=demanda.${taskId}`);
  await page.waitForSelector("#task-drawer[open] .task-props");
  assert.equal(await page.inputValue(".task-title"), "Arte do cardápio de Natal");
  await shot("push-03-abriu-a-demanda");
});

await step("Tocar no aviso com o painel fechado abre direto na demanda (e o endereço fica limpo)", async () => {
  await page.goto(`${ORIGIN}/admin/?abrir=demanda.${taskId}`);
  await page.waitForSelector("#task-drawer[open] .task-props");
  assert.equal(await page.inputValue(".task-title"), "Arte do cardápio de Natal");
  await page.waitForFunction(() => location.search === "", null, { timeout: 4000 });
  // Endereço mexido não abre nada nem quebra
  await page.goto(`${ORIGIN}/admin/?abrir=demanda.<script>alert(1)</script>`);
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => location.search === "", null, { timeout: 4000 });
  assert.equal(await page.locator("#task-drawer[open]").count(), 0);
});

await step("Recarregar mantém ativado; \"Enviar um teste\" manda de novo", async () => {
  fake.pushes.length = 0;
  await openBell();
  await page.waitForSelector(".inbox__push--ativo");
  await page.click('[data-push="teste"]');
  await toastSays(/Teste enviado/);
  assert.equal((await lastPush()).title, "Avisos ativados");
  assert.equal(fake.pushSubs.length, 1);
});

await step("Sair desliga os avisos deste aparelho; outra pessoa no mesmo aparelho não herda", async () => {
  await page.click("[data-me-toggle]"); await page.click('[data-action="sign-out"]');
  await page.waitForSelector("#login:not([hidden])");
  assert.equal(fake.pushSubs.length, 0, "saiu: o servidor não manda mais para este aparelho");
  await signIn("caio.video", "Senha-do-Caio-123");
  await openBell();
  assert.ok(await page.isVisible('[data-push="ativar"]'), "o Caio precisa ativar por conta própria");
  assert.equal(fake.pushSubs.length, 0);
  await page.click("[data-me-toggle]"); await page.click('[data-action="sign-out"]');
  await page.waitForSelector("#login:not([hidden])");
  await signIn("ana.design", "Senha-da-Ana-123");
  await openBell();
  await page.waitForSelector(".inbox__push--ativo");
  assert.equal(fake.pushSubs.length, 1, "a Ana voltou: os avisos dela voltam sozinhos");
  assert.equal(fake.pushSubs[0].user_id, ana.id);
});

await step("Desativar para de enviar para este aparelho", async () => {
  await page.click('[data-push="desativar"]');
  await toastSays(/Avisos desativados/);
  await page.waitForSelector('[data-push="ativar"]');
  assert.equal(fake.pushSubs.length, 0);
  fake.pushes.length = 0;
  store.pushNotification({ user_id: ana.id, kind: "tarefa_mencao", task_id: taskId, actor_name: "Bruna Admin", body: "oi" });
  await fake.pushSettled;
  assert.equal(fake.pushes.length, 0);
});

/* ============================== Outros aparelhos ============================== */
await step("Permissão negada: explica como liberar, sem ativar nada", async () => {
  page = await newPage({ ...devices["Pixel 7"] }, "negado", [fakeReceiver, { phone: PHONE, grant: "denied" }]);
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("ana.design", "Senha-da-Ana-123");
  await openBell();
  await page.click('[data-push="ativar"]');
  await page.waitForSelector(".inbox__push--bloqueado");
  assert.match(await page.textContent(".inbox__push"), /bloqueados neste navegador/);
  assert.equal(fake.pushSubs.length, 0);
});

await step("iPhone fora da Tela de Início: mostra o passo a passo da Apple", async () => {
  page = await newPage({ ...devices["iPhone 13"] }, "iphone", [() => { delete window.PushManager; }]);
  await page.goto(`${ORIGIN}/admin/`);
  await signIn("ana.design", "Senha-da-Ana-123");
  await openBell();
  assert.match(await page.textContent(".inbox__push"), /Adicionar à Tela de Início/);
  assert.equal(await page.locator('[data-push="ativar"]').count(), 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `a página passou ${overflow}px da tela`);
  await shot("push-04-iphone");
});

/* ============================== Arquivos de verdade ============================== */
await step("Aplicativo instalável: manifesto, ícones e receptor de verdade (sw.js) carregam sem erro", async () => {
  page = await newPage({ viewport: { width: 1280, height: 900 } }, "real");
  await page.goto(`${ORIGIN}/admin/`);
  const manifest = await page.evaluate(async () => { const r = await fetch(document.querySelector('link[rel="manifest"]').href); return { type: r.headers.get("content-type"), json: await r.json(), base: r.url }; });
  assert.match(manifest.type, /manifest\+json/);
  assert.equal(manifest.json.display, "standalone");
  assert.deepEqual(manifest.json.icons.map((i) => i.sizes), ["192x192", "512x512", "512x512"]);
  for (const icon of manifest.json.icons) assert.equal(await page.evaluate(async (u) => (await fetch(u)).status, new URL(icon.src, manifest.base).href), 200, icon.src);
  const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" }); await navigator.serviceWorker.ready; return { scope: reg.scope, active: Boolean(reg.active || reg.installing || reg.waiting) }; });
  assert.equal(sw.scope, `${ORIGIN}/admin/`);
  assert.ok(sw.active);
});

await step("Sem erros no console", async () => {
  assert.deepEqual(consoleErrors, []);
});

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);
