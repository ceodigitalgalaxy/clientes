/* Teste (sem rede e sem navegador) dos avisos no celular:
   - webpush.js: só serviços de push conhecidos; o aviso sai cifrado e o
     "aparelho" (aqui, uma chave de teste) consegue ler (RFC 8291); a assinatura
     VAPID confere com a chave pública.
   - função avisos-push (código real) sobre o Supabase de mentira: quem pode
     pedir a chave, o gancho do banco só com o segredo, cada aviso uma vez só,
     aviso lido não sai, assinatura morta é apagada, cliente não recebe nada.
   Rode: node admin/test/push.test.mjs */

import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_PUBLISHABLE_KEY as KEY } from "../../site/js/config.js";
import { pushOrigin, generateVapidKeys, sendPush, b64url, fromB64url } from "../../supabase/functions/avisos-push/webpush.js";

let failed = 0;
const ok = async (label, fn) => {
  try { await fn(); console.log(`✔ ${label}`); }
  catch (error) { failed += 1; process.exitCode = 1; console.log(`✘ ${label}: ${error.message.split("\n")[0]}`); }
};
const enc = new TextEncoder();
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));

/** Um "aparelho" de teste: par de chaves e segredo, como o navegador cria ao assinar */
async function device(endpoint) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    subscription: { endpoint, p256dh: b64url(publicKey), auth: b64url(auth) },
    /** Lê o corpo cifrado como o navegador leria (RFC 8291 / aes128gcm) */
    async read(body) {
      const salt = body.slice(0, 16);
      const idLen = body[20];
      const asPublic = body.slice(21, 21 + idLen);
      const cipher = body.slice(21 + idLen);
      const peer = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, pair.privateKey, 256));
      const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), publicKey, asPublic), 32);
      const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
      assert.equal(plain.at(-1), 2, "marcador de último registro");
      return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
    }
  };
}

/* ---------------- webpush.js ---------------- */
await ok("só serviços de push conhecidos (nada de endereço qualquer)", () => {
  for (const good of ["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QGx", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-by3p.notify.windows.com/w/?token=x"]) assert.ok(pushOrigin(good), good);
  for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x", "https://127.0.0.1/x", "https://peieimwpkrattuldmjux.supabase.co/rest/v1/", "javascript:alert(1)", ""]) assert.equal(pushOrigin(bad), null, bad);
});

await ok("o aviso sai cifrado para o aparelho e assinado pela agência", async () => {
  const phone = await device("https://fcm.googleapis.com/fcm/send/aparelho-1");
  const keys = await generateVapidKeys();
  let sent = null;
  const result = await sendPush(phone.subscription, { title: "Bruna te passou uma demanda", body: "Campanha de Natal · ação ✓" }, keys, { subject: "https://exemplo.test", fetchImpl: async (url, init) => { sent = { url, init }; return new Response(null, { status: 201 }); } });
  assert.equal(result, "ok");
  assert.equal(sent.url, phone.subscription.endpoint);
  assert.equal(sent.init.headers["Content-Encoding"], "aes128gcm");
  const body = new Uint8Array(sent.init.body);
  assert.ok(!new TextDecoder().decode(body).includes("Campanha"), "o texto não vai às claras");
  assert.deepEqual(await phone.read(body), { title: "Bruna te passou uma demanda", body: "Campanha de Natal · ação ✓" });
  const other = await device("https://fcm.googleapis.com/fcm/send/aparelho-2");
  await assert.rejects(other.read(body), "outro aparelho não lê");
  // VAPID: JWT ES256 com aud = origem do serviço, assinado pela chave privada da agência
  const [, token, k] = sent.init.headers.Authorization.match(/^vapid t=(\S+), k=(\S+)$/);
  assert.equal(k, keys.public);
  const [head, claims, signature] = token.split(".");
  const publicKey = await crypto.subtle.importKey("raw", fromB64url(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(signature), enc.encode(`${head}.${claims}`)), "assinatura confere");
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(claims)));
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.ok(payload.exp > Date.now() / 1000 && payload.exp <= Date.now() / 1000 + 24 * 3600);
});

await ok("assinatura morta (410) ou endereço estranho → apagar; erro passageiro → manter", async () => {
  const phone = await device("https://fcm.googleapis.com/fcm/send/aparelho-1");
  const keys = await generateVapidKeys();
  const withStatus = (status) => sendPush(phone.subscription, { title: "x" }, keys, { subject: "https://exemplo.test", fetchImpl: async () => new Response(null, { status }) });
  assert.equal(await withStatus(410), "gone");
  assert.equal(await withStatus(404), "gone");
  assert.equal(await withStatus(500), "fail");
  assert.equal(await withStatus(429), "fail");
  assert.equal(await sendPush({ ...phone.subscription, endpoint: "https://evil.example.com/x" }, { title: "x" }, keys, { subject: "s", fetchImpl: async () => { throw new Error("não devia chamar"); } }), "gone");
  assert.equal(await sendPush(phone.subscription, { title: "x" }, keys, { subject: "s", fetchImpl: async () => { throw new TypeError("rede"); } }), "fail");
});

/* ---------------- função avisos-push sobre o Supabase de mentira ---------------- */
const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: KEY });
const padaria = await store.createClient({ name: "Padaria", slug: "padaria", active: true });
const bruna = fake.addUser("bruna", "Senha-da-Bruna-123", { name: "Bruna Admin" });
const ana = fake.addUser("ana", "Senha-da-Ana-12345", { name: "Ana Designer", profile: { role: "colaborador", all_clients: true } });
fake.addUser("padaria", "Senha-cliente-12345", { kind: "cliente", clientId: padaria.id });
const BASE = "https://peieimwpkrattuldmjux.supabase.co";
const signIn = async (email, password) => JSON.parse((await fake.handle({ method: "POST", url: `${BASE}/auth/v1/token?grant_type=password`, headers: { apikey: KEY }, body: JSON.stringify({ email, password }) })).body).access_token;
const tBruna = await signIn("equipe+bruna@digitalgalaxy.com.br", "Senha-da-Bruna-123");
const tAna = await signIn("equipe+ana@digitalgalaxy.com.br", "Senha-da-Ana-12345");
const tCliente = await signIn("cliente+padaria@digitalgalaxy.com.br", "Senha-cliente-12345");
const fn = async (body, { token, headers = {} } = {}) => {
  const r = await fake.handle({ method: "POST", url: `${BASE}/functions/v1/avisos-push`, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}`, origin: "http://localhost:5691" } : {}), ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: r.body ? JSON.parse(r.body) : null };
};
const rpc = (name, body, token) => fake.handle({ method: "POST", url: `${BASE}/rest/v1/rpc/${name}`, headers: { apikey: KEY, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const phoneAna = await device("https://fcm.googleapis.com/fcm/send/celular-da-ana");

await ok("chave pública: só a equipe ativa pede; é sempre a mesma", async () => {
  assert.equal((await fn({ action: "chave" })).status, 401, "sem login");
  assert.equal((await fn({ action: "chave" }, { token: tCliente })).status, 403, "cliente não");
  const first = await fn({ action: "chave" }, { token: tAna });
  assert.equal(first.status, 200);
  assert.match(first.body.public_key, /^[A-Za-z0-9_-]{87}$/);
  assert.equal(fromB64url(first.body.public_key).length, 65);
  assert.equal((await fn({ action: "chave" }, { token: tBruna })).body.public_key, first.body.public_key);
  assert.ok(!JSON.stringify(first.body).includes('"d"'), "a chave privada nunca sai");
});

await ok("ativar grava o aparelho só para a própria pessoa; as funções do servidor são negadas ao navegador", async () => {
  assert.equal((await rpc("push_subscribe", { p_endpoint: "https://evil.example.com/x", p_p256dh: phoneAna.subscription.p256dh, p_auth: phoneAna.subscription.auth }, tAna)).status, 400, "endereço estranho");
  assert.equal((await rpc("push_subscribe", { p_endpoint: phoneAna.subscription.endpoint, p_p256dh: phoneAna.subscription.p256dh, p_auth: phoneAna.subscription.auth, p_agent: "Teste" }, tAna)).status, 200);
  assert.equal((await rpc("push_subscribe", { p_endpoint: "https://fcm.googleapis.com/fcm/send/x", p_p256dh: phoneAna.subscription.p256dh, p_auth: phoneAna.subscription.auth }, tCliente)).status, 400, "cliente não ativa");
  assert.equal(fake.pushSubs.length, 1);
  assert.equal(fake.pushSubs[0].user_id, ana.id);
  for (const name of ["push_config", "push_claim", "push_targets", "push_report"]) assert.equal((await rpc(name, {}, tAna)).status, 403, name);
  const list = JSON.parse((await fake.handle({ method: "GET", url: `${BASE}/rest/v1/push_subscriptions?select=id,endpoint`, headers: { apikey: KEY, authorization: `Bearer ${tBruna}` } })).body);
  assert.deepEqual(list, [], "a Bruna não vê o aparelho da Ana");
});

await ok("aviso de teste chega só no aparelho de quem pediu", async () => {
  assert.equal((await fn({ action: "teste" }, { token: tBruna })).status, 409, "a Bruna não ativou nenhum aparelho");
  const r = await fn({ action: "teste" }, { token: tAna });
  assert.equal(r.status, 200);
  assert.equal(r.body.sent, 1);
  assert.equal(fake.pushes.length, 1);
  assert.equal((await phoneAna.read(fake.pushes[0].body)).title, "Avisos ativados");
});

await ok("aviso novo no sininho vai para o celular, uma vez só, com o endereço da demanda", async () => {
  fake.pushes.length = 0;
  const taskId = "11111111-2222-4333-8444-555555555555";
  store.pushNotification({ user_id: ana.id, kind: "tarefa_atribuida", task_id: taskId, actor_name: "Bruna Admin", body: "Campanha de Natal" });
  await fake.pushSettled;
  assert.equal(fake.pushes.length, 1);
  const message = await phoneAna.read(fake.pushes[0].body);
  assert.equal(message.title, "Bruna Admin te passou uma demanda");
  assert.equal(message.body, "Campanha de Natal");
  assert.equal(message.url, `/admin/?abrir=demanda.${taskId}`);
  const n = store.listNotifications(ana.id)[0];
  assert.ok(n.pushed_at);
  // O gancho repetido (ou alguém reenviando o mesmo pedido) não manda de novo
  const again = await fn({ action: "enviar", id: n.id }, { headers: { "x-hook-secret": fake.pushHookFor(n.id) } });
  assert.deepEqual(again.body, { sent: 0 });
  assert.equal(fake.pushes.length, 1);
  // Quem não ativou aparelho não gera envio nenhum
  store.pushNotification({ user_id: bruna.id, kind: "tarefa_mencao", task_id: taskId, actor_name: "Ana Designer", body: "oi" });
  await fake.pushSettled;
  assert.equal(fake.pushes.length, 1);
});

await ok("o gancho só vale com o segredo do banco; aviso já lido não sai", async () => {
  fake.pushes.length = 0;
  store.onNotification = null;   // sem o gancho automático: os pedidos abaixo são feitos à mão
  store.pushNotification({ user_id: ana.id, kind: "tarefa_mencao", task_id: null, actor_name: "Bruna Admin", body: "segredo interno" });
  const n = store.listNotifications(ana.id)[0];
  const outro = "99999999-2222-4333-8444-555555555555";
  // Nem o segredo inteiro do banco serve como código, nem o código de outro aviso
  for (const secret of ["", "curto", "x".repeat(64), fake.pushHookSecret, fake.pushHookFor(outro)]) {
    const r = await fn({ action: "enviar", id: n.id }, { headers: { "x-hook-secret": secret } });
    assert.ok(r.status === 403 || (r.status === 200 && r.body.sent === 0), `segredo "${secret.slice(0, 5)}"`);
  }
  assert.equal((await fn({ action: "enviar", id: n.id })).status, 401, "sem segredo e sem login");
  assert.equal((await fn({ action: "enviar", id: n.id }, { token: tAna })).status, 400, "pessoa logada não dispara envio");
  assert.equal(fake.pushes.length, 0);
  assert.equal(n.pushed_at, null, "continua sem enviar");
  store.markNotificationsRead(ana.id, [n.id]);
  assert.deepEqual((await fn({ action: "enviar", id: n.id }, { headers: { "x-hook-secret": fake.pushHookFor(n.id) } })).body, { sent: 0 }, "lido não sai");
  assert.equal(fake.pushes.length, 0);
});

await ok("aparelho que não existe mais (410) é apagado; desativar remove só o próprio", async () => {
  await rpc("push_unsubscribe", { p_endpoint: phoneAna.subscription.endpoint }, tBruna);
  assert.equal(fake.pushSubs.length, 1, "a Bruna não desativa o aparelho da Ana");
  fake.pushStatus = () => 410;
  store.pushNotification({ user_id: ana.id, kind: "tarefa_comentario", task_id: null, actor_name: "Bruna Admin", body: "x" });
  const n = store.listNotifications(ana.id)[0];
  const r = await fn({ action: "enviar", id: n.id }, { headers: { "x-hook-secret": fake.pushHookFor(n.id) } });
  assert.deepEqual(r.body, { sent: 0, gone: 1, failed: 0 });
  assert.equal(fake.pushSubs.length, 0);
});

/* ---------------- receptor do navegador (site/admin/sw.js) ---------------- */
await ok("receptor: mostra o aviso e, ao tocar, só abre endereço do próprio painel", async () => {
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(new URL("../../site/admin/sw.js", import.meta.url), "utf8");
  const listeners = {};
  const shown = [];
  const opened = [];
  const posted = [];
  let windows = [];
  const self = {
    location: { origin: "https://clientes.digitalgalaxy.com.br" },
    registration: { scope: "https://clientes.digitalgalaxy.com.br/admin/", showNotification: async (title, options) => { shown.push({ title, ...options }); } },
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async (url) => { opened.push(url); } },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  new Function("self", code)(self);
  const fire = async (type, event) => { let wait = null; listeners[type]({ ...event, waitUntil: (p) => { wait = p; } }); await wait; };
  await fire("push", { data: { json: () => ({ title: "Bruna te passou uma demanda", body: "Campanha", url: "/admin/?abrir=demanda.abc", tag: "n1" }) } });
  assert.equal(shown[0].title, "Bruna te passou uma demanda");
  assert.equal(shown[0].data.url, "https://clientes.digitalgalaxy.com.br/admin/?abrir=demanda.abc");
  await fire("push", { data: { json: () => { throw new Error("lixo"); } } });
  assert.equal(shown[1].title, "Painel Digital Galaxy", "aviso ilegível ainda aparece, sem quebrar");
  for (const bad of ["https://evil.example.com/admin/", "//evil.example.com", "/aprovacao/", "javascript:alert(1)"]) {
    await fire("push", { data: { json: () => ({ title: "x", url: bad }) } });
    assert.equal(shown.at(-1).data.url, "https://clientes.digitalgalaxy.com.br/admin/", bad);
  }
  const click = (url) => fire("notificationclick", { notification: { close: () => {}, data: { url } } });
  await click("https://clientes.digitalgalaxy.com.br/admin/?abrir=demanda.abc");
  assert.deepEqual(opened, ["https://clientes.digitalgalaxy.com.br/admin/?abrir=demanda.abc"], "painel fechado: abre");
  await click("https://evil.example.com/");
  assert.equal(opened.at(-1), "https://clientes.digitalgalaxy.com.br/admin/", "endereço de fora vira o painel");
  windows = [{ url: "https://clientes.digitalgalaxy.com.br/admin/#/inicio", postMessage: (m) => posted.push(m), focus: async () => {} }];
  await click("https://clientes.digitalgalaxy.com.br/admin/?abrir=demanda.abc");
  assert.equal(opened.length, 2, "painel aberto: não abre outra janela");
  assert.equal(posted[0].type, "abrir-aviso");
});

console.log(failed ? `\n${failed} falha(s)` : "\nAvisos no celular: tudo certo");
