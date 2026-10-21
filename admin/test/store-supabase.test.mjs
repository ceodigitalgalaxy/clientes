/* Confere as chamadas que o servidor faz ao Supabase (sem rede): endereço,
   filtros, cabeçalhos e tradução de erros. Rode: node admin/test/store-supabase.test.mjs */

import assert from "node:assert/strict";
import { createSupabaseStore } from "../lib/store-supabase.mjs";

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

console.log("store-supabase: todas as verificações passaram");
