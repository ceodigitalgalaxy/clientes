/* Confere as chamadas ao Supabase (sem rede): endereço, filtros, cabeçalhos,
   tradução de erros, sessão do navegador e login. Também testa o comando de
   equipe (admin/equipe.mjs). Rode: node admin/test/store.test.mjs */

import assert from "node:assert/strict";
import { createSupabaseStore } from "../../site/admin/js/data/store.js";
import { createAuth } from "../../site/js/lib/auth.js";
import { createTeamAdmin } from "../equipe.mjs";

const calls = [];
let nextResponse = { status: 200, body: [] };
const fakeFetch = async (url, init) => {
  calls.push({ url, ...init, headers: init.headers });
  const { status, body } = nextResponse;
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
};
const store = createSupabaseStore({ url: "https://exemplo.supabase.co/", secretKey: "sb_secret_TESTE", fetchImpl: fakeFetch });
const id = "11111111-2222-4333-8444-555555555555";

await store.listContents({ client_id: id, from: "2026-11-01", to: "2026-11-30", status: "aprovado" });
let call = calls.at(-1);
assert.ok(call.url.startsWith("https://exemplo.supabase.co/rest/v1/contents?select="), "endereço da tabela");
for (const part of [`client_id=eq.${id}`, "status=eq.aprovado", "scheduled_date=gte.2026-11-01", "scheduled_date=lte.2026-11-30", "order=scheduled_date.asc"]) assert.ok(call.url.includes(part), part);
assert.equal(call.headers.apikey, "sb_secret_TESTE");
assert.equal(call.headers.Authorization, undefined, "chave sb_secret_ não vai no Authorization");

nextResponse = { status: 201, body: { id } };
await store.createContent({ title: "x" });
call = calls.at(-1);
assert.equal(call.method, "POST");
assert.equal(call.headers.Prefer, "return=representation");
assert.equal(call.headers.Accept, "application/vnd.pgrst.object+json");
assert.deepEqual(JSON.parse(call.body), { title: "x" });

nextResponse = { status: 200, body: { id } };
await store.updateContent(id, { title: "y" });
assert.equal(calls.at(-1).method, "PATCH");
assert.ok(calls.at(-1).url.includes(`id=eq.${id}`));
await store.deleteContent(id);
assert.equal(calls.at(-1).method, "DELETE");

nextResponse = { status: 200, body: [{ id, name: "A", contents: [{ count: 3 }] }] };
const clients = await store.listClients();
assert.equal(clients[0].contents_count, 3, "contagem de conteúdos por cliente");
assert.ok(!("contents" in clients[0]));

nextResponse = { status: 409, body: { code: "23505" } };
await assert.rejects(store.createClient({}), (e) => e.status === 409 && /identificador/.test(e.message));
nextResponse = { status: 409, body: { code: "23503" } };
await assert.rejects(store.deleteClient(id), (e) => e.status === 409 && /inativá-lo/.test(e.message));
nextResponse = { status: 406, body: { code: "PGRST116" } };
await assert.rejects(store.getContent(id), (e) => e.status === 404);
nextResponse = { status: 401, body: { message: "Invalid API key" } };
await assert.rejects(store.listClients(), (e) => e.status === 502 && /chave secreta/.test(e.message));

nextResponse = { status: 200, body: [] };
await store.listClientCalendar(id, { from: "2026-11-01" });
assert.ok(calls.at(-1).url.includes("/client_calendar_items?"), "calendário usa a view sem observações internas");

const legacy = createSupabaseStore({ url: "https://exemplo.supabase.co", secretKey: "eyJhbGciOi.TESTE", fetchImpl: fakeFetch });
nextResponse = { status: 200, body: [] };
await legacy.listContents();
assert.equal(calls.at(-1).headers.Authorization, "Bearer eyJhbGciOi.TESTE", "chave legada vai no Authorization");

/* ---------- Navegador: chave publicável + sessão ---------- */
let tokenCalls = 0; let refreshCalls = 0;
const browserStore = createSupabaseStore({
  url: "https://exemplo.supabase.co", apiKey: "sb_publishable_TESTE", fetchImpl: fakeFetch,
  getToken: async () => { tokenCalls += 1; return `token-${tokenCalls}`; },
  onUnauthorized: async () => { refreshCalls += 1; }
});
nextResponse = { status: 200, body: [] };
await browserStore.listContents();
call = calls.at(-1);
assert.equal(call.headers.apikey, "sb_publishable_TESTE");
assert.equal(call.headers.Authorization, "Bearer token-1", "sessão vai no Authorization");

// 401 no meio do caminho: renova uma vez e repete; se continuar 401, avisa que a sessão expirou
nextResponse = { status: 401, body: { code: "PGRST303" } };
const before = calls.length;
await assert.rejects(browserStore.listClients(), (e) => e.status === 401 && /sessão expirou/.test(e.message));
assert.equal(refreshCalls, 1, "tentou renovar uma vez");
assert.equal(calls.length - before, 2, "repetiu o pedido só uma vez");
nextResponse = { status: 403, body: { code: "42501" } };
await assert.rejects(browserStore.createClient({}), (e) => e.status === 403 && /permissão/.test(e.message));
nextResponse = { status: 200, body: [{ user_id: id }] };
assert.equal(await browserStore.isAgencyMember(id), true);
assert.ok(calls.at(-1).url.includes(`agency_members?select=user_id&user_id=eq.${id}`));
nextResponse = { status: 200, body: [] };
assert.equal(await browserStore.isAgencyMember(id), false);

/* ---------- Login (auth.js) ---------- */
const memory = new Map();
const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
let clock = 1_000_000_000_000;
const authCalls = [];
let authResponse = { status: 200, body: {} };
const authFetch = async (url, init) => {
  authCalls.push({ url, ...init, body: JSON.parse(init.body || "{}") });
  const { status, body } = typeof authResponse === "function" ? authResponse(url) : authResponse;
  return { ok: status < 400, status, json: async () => body };
};
const auth = createAuth({ url: "https://exemplo.supabase.co", apiKey: "sb_publishable_TESTE", storage, fetchImpl: authFetch, now: () => clock });
const tokens = (n) => ({ access_token: `acesso-${n}`, refresh_token: `renova-${n}`, expires_in: 3600, user: { id, email: "equipe+admdg@digitalgalaxy.com.br", user_metadata: { name: "Admin DG" } } });

authResponse = { status: 400, body: { error: "invalid_grant" } };
await assert.rejects(auth.signIn("admdg", "errada"), (e) => e.message === "Usuário ou senha incorretos.");
assert.deepEqual(authCalls.at(-1).body, { email: "equipe+admdg@digitalgalaxy.com.br", password: "errada" }, "usuário vira o endereço interno");
assert.ok(authCalls.at(-1).url.endsWith("/auth/v1/token?grant_type=password"));
const callsBefore = authCalls.length;
await assert.rejects(auth.signIn("a", "x"), (e) => e.message === "Usuário ou senha incorretos.");
assert.equal(authCalls.length, callsBefore, "usuário em formato impossível nem chega ao Supabase");
authResponse = { status: 429, body: {} };
await assert.rejects(auth.signIn("admdg", "x"), (e) => /Muitas tentativas/.test(e.message));
assert.equal(auth.session, null);

authResponse = { status: 200, body: tokens(1) };
const user = await auth.signIn("  AdmDG ", "certa");
assert.deepEqual(user, { id, username: "admdg", name: "Admin DG" });
assert.ok(!memory.values().next().value.includes("certa"), "a senha não é guardada");
assert.equal(await auth.accessToken(), "acesso-1");

// Perto de vencer: renova sozinho (uma vez só, mesmo com pedidos simultâneos)
clock += 3550 * 1000;
authResponse = { status: 200, body: tokens(2) };
const [a, b] = await Promise.all([auth.accessToken(), auth.accessToken()]);
assert.equal(a, "acesso-2"); assert.equal(b, "acesso-2");
assert.equal(authCalls.filter((c) => c.url.includes("refresh_token")).length, 1);
assert.deepEqual(authCalls.at(-1).body, { refresh_token: "renova-1" });

// Sem internet na renovação: não derruba a sessão
clock += 3550 * 1000;
authResponse = { status: 503, body: {} };
await assert.rejects(auth.accessToken(), (e) => e.reason === "offline");
assert.ok(auth.session, "sessão mantida");
// Renovação recusada: sessão encerrada
authResponse = { status: 400, body: { error_code: "refresh_token_not_found" } };
await assert.rejects(auth.accessToken(), (e) => e.reason === "expired" && /expirou/.test(e.message));
assert.equal(auth.session, null);
assert.equal(memory.size, 0, "sessão apagada do navegador");
await assert.rejects(auth.accessToken(), (e) => e.reason === "signed_out");

// Sair: apaga aqui e encerra no Supabase
authResponse = { status: 200, body: tokens(3) };
await auth.signIn("admdg", "certa");
authResponse = { status: 204, body: null };
await auth.signOut();
assert.equal(auth.session, null);
assert.ok(authCalls.at(-1).url.endsWith("/auth/v1/logout?scope=local"));
assert.equal(authCalls.at(-1).headers.Authorization, "Bearer acesso-3");

// Sessão guardada sobrevive a recarregar a página
authResponse = { status: 200, body: tokens(4) };
await auth.signIn("admdg", "certa");
const reloaded = createAuth({ url: "https://exemplo.supabase.co", apiKey: "sb_publishable_TESTE", storage, fetchImpl: authFetch, now: () => clock });
assert.equal(reloaded.user.username, "admdg");

/* ---------- Comando de equipe (admin/equipe.mjs) ---------- */
const teamCalls = [];
const userId = "99999999-2222-4333-8444-555555555555";
const routes = {
  "POST /auth/v1/admin/users": { status: 200, body: { id: userId } },
  "POST /rest/v1/agency_members": { status: 201, body: null },
  "GET /auth/v1/admin/users": { status: 200, body: { users: [{ id: userId, email: "equipe+admdg@digitalgalaxy.com.br", user_metadata: { name: "Admin DG" } }] } },
  "GET /rest/v1/agency_members": { status: 200, body: [{ user_id: userId }] },
  "GET /auth/v1/settings": { status: 200, body: { disable_signup: true } }
};
const teamFetch = async (url, init) => {
  const { pathname } = new URL(url);
  const key = `${init.method} ${pathname}`;
  teamCalls.push({ key, url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
  const r = routes[key] || { status: 200, body: null };
  return { ok: r.status < 400, status: r.status, text: async () => (r.body === null ? "" : JSON.stringify(r.body)) };
};
const team = createTeamAdmin({ url: "https://exemplo.supabase.co", secretKey: "sb_secret_TESTE", fetchImpl: teamFetch });
await team.create({ username: "admdg", name: "Admin DG", password: "Galaxia#Roxa-77" });
assert.deepEqual(teamCalls[0].body, { email: "equipe+admdg@digitalgalaxy.com.br", password: "Galaxia#Roxa-77", email_confirm: true, user_metadata: { name: "Admin DG" } });
assert.equal(teamCalls[0].headers.apikey, "sb_secret_TESTE");
assert.deepEqual(teamCalls[1].body, { user_id: userId }, "vinculado à equipe");

// Falha ao vincular à equipe: a conta criada é desfeita
routes["POST /rest/v1/agency_members"] = { status: 500, body: {} };
teamCalls.length = 0;
await assert.rejects(team.create({ username: "outra", password: "Galaxia#Roxa-77" }));
assert.ok(teamCalls.some((c) => c.key === `DELETE /auth/v1/admin/users/${userId}`), "conta desfeita");

routes["POST /auth/v1/admin/users"] = { status: 422, body: { error_code: "email_exists" } };
await assert.rejects(team.create({ username: "admdg", password: "Galaxia#Roxa-77" }), (e) => /já existe/.test(e.message));

const list = await team.list();
assert.deepEqual(list.map((u) => [u.username, u.member]), [["admdg", true]]);
await team.setPassword("admdg", "Outra#Senha-88");
assert.deepEqual(teamCalls.at(-1).body, { password: "Outra#Senha-88" });
assert.equal(teamCalls.at(-1).key, `PUT /auth/v1/admin/users/${userId}`);
await assert.rejects(team.setPassword("ninguem", "Outra#Senha-88"), (e) => /não encontrado/.test(e.message));
await team.remove("admdg");
assert.equal(teamCalls.at(-1).key, `DELETE /auth/v1/admin/users/${userId}`);
assert.equal(await team.signupDisabled(), true);
routes["GET /auth/v1/settings"] = { status: 401, body: {} };
await assert.rejects(team.signupDisabled(), (e) => /recusou a chave/.test(e.message));

console.log("store, login e equipe: todas as verificações passaram");
