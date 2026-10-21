/* ==========================================================================
   Verificação no banco real (Supabase)
   --------------------------------------------------------------------------
   Rode no computador da agência, depois de preencher admin/.env:
       node admin/verify.mjs
   Cria um cliente e um conteúdo de TESTE, consulta, edita, filtra, confere o
   calendário do cliente, exclui os dois e mostra o resultado de cada passo.
   Nada fica gravado no final (o próprio script apaga o que criou).
   Também confere a proteção do painel publicado: visitante sem login não lê
   nada e ninguém consegue criar conta sozinho.
   Portal do cliente: cria dois clientes e dois logins de TESTE, entra como
   cada um (como o navegador faz) e confere que cada um vê só o que é dele,
   que trocar parâmetros não dá acesso a outro cliente e que mudanças feitas
   pela agência aparecem. Tudo de teste é apagado no final.
   ========================================================================== */

import { loadEnv } from "./server.mjs";
import { createSupabaseStore } from "../site/admin/js/data/store.js";
import { validateClient, validateContent } from "../site/admin/js/domain/rules.js";
import { SUPABASE_PUBLISHABLE_KEY } from "../site/js/config.js";
import { createTeamAdmin } from "./equipe.mjs";
import { createAuth } from "../site/js/lib/auth.js";
import { createSupabaseRepository } from "../site/js/data/supabase-repository.js";
import { randomBytes } from "node:crypto";

const env = loadEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error("Preencha SUPABASE_URL e SUPABASE_SECRET_KEY em admin/.env (veja admin/.env.example).");
  process.exit(1);
}
const store = createSupabaseStore({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY });
const stamp = Date.now().toString(36);
let ok = true;
const check = (label, condition, detail = "") => {
  ok = ok && condition;
  console.log(`${condition ? "✔" : "✘"} ${label}${detail ? ` (${detail})` : ""}`);
};

let client, content;
try {
  await store.ping();
  check("Conexão com o banco", true);

  // Visitante sem login (só a chave publicável, que fica no site): nenhum dado
  for (const table of ["clients", "contents", "agency_members", "client_calendar_items"]) {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    const body = await response.json().catch(() => null);
    check(`Sem login não lê ${table}`, !response.ok || (Array.isArray(body) && body.length === 0), `resposta ${response.status}`);
  }
  const signupOff = await createTeamAdmin({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY }).signupDisabled();
  check("Cadastro aberto desligado (só a agência cria usuários)", signupOff, signupOff ? "" : "desligue em Authentication → Sign In / Providers");

  client = await store.createClient(validateClient({ name: "Verificação automática", slug: `verificacao-${stamp}` }).value);
  check("Criar cliente", Boolean(client.id), client.slug);

  const input = { client_id: client.id, title: "Conteúdo de verificação", scheduled_date: "2099-01-15", scheduled_time: "10:00", network: "instagram", format: "post", media_url: "https://example.com/referencia.jpg", caption: "Legenda de teste", internal_notes: "Nota interna de teste", status: "planejado" };
  content = await store.createContent(validateContent(input).value);
  check("Criar conteúdo", content.client_id === client.id && content.version === 1, `versão ${content.version}`);

  const read = await store.getContent(content.id);
  check("Consultar conteúdo", read.title === input.title && read.internal_notes === input.internal_notes);

  const edited = await store.updateContent(content.id, validateContent({ ...input, caption: "Legenda editada", status: "aguardando_aprovacao" }).value);
  check("Editar conteúdo (sobe a versão)", edited.caption === "Legenda editada" && edited.version === 2, `versão ${edited.version}`);

  const byFilters = await store.listContents({ client_id: client.id, from: "2099-01-01", to: "2099-01-31", status: "aguardando_aprovacao" });
  check("Filtrar por cliente, data e status", byFilters.length === 1 && byFilters[0].id === content.id);
  const otherStatus = await store.listContents({ client_id: client.id, status: "publicado" });
  check("Filtro de status exclui os outros", otherStatus.length === 0);

  const calendar = await store.listClientCalendar(client.id, { from: "2099-01-01", to: "2099-01-31" });
  check("Calendário do cliente recebe o conteúdo", calendar.length === 1, "status aguardando aprovação");
  check("Calendário do cliente sem observações internas", calendar[0] && !("internal_notes" in calendar[0]));

  try { await store.deleteClient(client.id); check("Cliente com conteúdo protegido contra exclusão", false); }
  catch (error) { check("Cliente com conteúdo protegido contra exclusão", error.status === 409); }

  await store.deleteContent(content.id);
  content = null;
  const after = await store.listContents({ client_id: client.id });
  check("Excluir conteúdo", after.length === 0);
} catch (error) {
  check(`Erro inesperado: ${error.message}`, false);
} finally {
  // Limpeza: nada de teste fica no banco
  if (content) await store.deleteContent(content.id).catch(() => {});
  if (client) {
    await store.deleteClient(client.id).then(() => check("Limpeza: cliente de teste apagado", true)).catch((e) => check("Limpeza: cliente de teste apagado", false, e.message));
  }
}

/* ---------- Portal do cliente com logins de verdade ---------- */
console.log("\nPortal do cliente:");
const team = createTeamAdmin({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY });
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const password = `Teste-${randomBytes(12).toString("base64url")}`;
const created = { clients: [], contents: [], users: [] };
try {
  const a = await store.createClient(validateClient({ name: "Verificação portal A", slug: `verif-portal-a-${stamp}` }).value);
  const b = await store.createClient(validateClient({ name: "Verificação portal B", slug: `verif-portal-b-${stamp}` }).value);
  created.clients.push(a, b);
  const base = { scheduled_date: "2099-05-10", network: "instagram", format: "post" };
  const visible = await store.createContent(validateContent({ ...base, client_id: a.id, title: "A liberado", status: "aguardando_aprovacao", internal_notes: "SEGREDO-A", client_notes: "Nota para A", media_url: "https://example.com/a.jpg" }).value);
  const hidden = await store.createContent(validateContent({ ...base, client_id: a.id, title: "A em produção", status: "em_producao" }).value);
  const other = await store.createContent(validateContent({ ...base, client_id: b.id, title: "B liberado", status: "aprovado" }).value);
  created.contents.push(visible, hidden, other);
  const userA = `verif-a-${stamp}`.slice(0, 32);
  const userB = `verif-b-${stamp}`.slice(0, 32);
  created.users.push(await team.createClientAccess({ username: userA, clientId: a.id, clientName: a.name, password }));
  created.users.push(await team.createClientAccess({ username: userB, clientId: b.id, clientName: b.name, password }));
  check("Logins de cliente criados e ligados a um cliente cada", true);

  // Entra como o navegador do cliente A entra
  const authA = createAuth({ url: env.SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "cliente", storage: memoryStorage() });
  await authA.signIn(userA, password);
  const portalA = createSupabaseRepository({ url: env.SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, auth: authA });
  const profileA = await portalA.getClient();
  check("Cliente A entra e o portal reconhece o cliente", profileA.name === a.name);
  let itemsA = await portalA.listActivitiesBetween("2099-05-01", "2099-05-31");
  check("Cliente A vê só o conteúdo liberado dele", itemsA.length === 1 && itemsA[0].title === "A liberado", itemsA.map((i) => i.title).join(", "));
  check("Observação para o cliente chega; a interna não", itemsA[0]?.notes === "Nota para A" && !JSON.stringify(itemsA).includes("SEGREDO"));

  // Tentativas de burlar com a sessão do cliente A
  const token = await authA.accessToken();
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const rpc = (name, body) => fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  const get = (q) => fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }));
  check("Função não aceita id de outro cliente", !(await rpc("portal_contents", { p_from: "2099-05-01", p_to: "2099-05-31", p_client_id: b.id })).ok);
  for (const q of [`contents?select=*&client_id=eq.${b.id}`, `contents?select=internal_notes`, "clients?select=*", "client_members?select=*", "client_calendar_items?select=*"]) {
    const r = await get(q);
    check(`Sem acesso direto: ${q.split("?")[0]}`, !r.ok || (Array.isArray(r.body) && r.body.length === 0));
  }
  const write = await fetch(`${env.SUPABASE_URL}/rest/v1/contents?id=eq.${other.id}`, { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ title: "invadido" }) });
  const writeBody = await write.json().catch(() => null);
  check("Cliente não altera conteúdos", !write.ok || (Array.isArray(writeBody) && writeBody.length === 0));
  const join = await fetch(`${env.SUPABASE_URL}/rest/v1/client_members`, { method: "POST", headers, body: JSON.stringify({ user_id: created.users[0].id, client_id: b.id, username: "invasao" }) });
  check("Cliente não se liga a outro cliente", !join.ok);

  // Cliente B vê só o dele
  const authB = createAuth({ url: env.SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "cliente", storage: memoryStorage() });
  await authB.signIn(userB, password);
  const itemsB = await createSupabaseRepository({ url: env.SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, auth: authB }).listActivitiesBetween("2099-05-01", "2099-05-31");
  check("Cliente B vê só o dele", itemsB.length === 1 && itemsB[0].title === "B liberado");

  // Agência muda a data, edita e exclui: o cliente vê na próxima consulta
  await store.updateContent(visible.id, validateContent({ ...base, client_id: a.id, title: "A liberado (editado)", status: "aguardando_aprovacao", scheduled_date: "2099-05-20", client_notes: "Nota para A" }).value);
  itemsA = await portalA.listActivitiesBetween("2099-05-01", "2099-05-31");
  check("Data e título alterados pela agência aparecem para o cliente", itemsA[0]?.date === "2099-05-20" && itemsA[0]?.title === "A liberado (editado)");
  await store.deleteContent(visible.id);
  created.contents = created.contents.filter((c) => c.id !== visible.id);
  itemsA = await portalA.listActivitiesBetween("2099-05-01", "2099-05-31");
  check("Conteúdo excluído pela agência some do calendário do cliente", itemsA.length === 0);

  // O cliente é sempre o da sessão: a mesma sessão dá sempre o mesmo cliente
  const again = await createSupabaseRepository({ url: env.SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, auth: { accessToken: async () => token, refresh: async () => {} } }).getClient();
  check("Perfil do portal vem só da sessão", again.name === a.name);
  await authA.signOut();
  await authB.signOut();
} catch (error) {
  check(`Erro inesperado no portal: ${error.message}`, false);
} finally {
  for (const user of created.users) await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } }).catch(() => {});
  for (const item of created.contents) await store.deleteContent(item.id).catch(() => {});
  let cleaned = true;
  for (const c of created.clients) await store.deleteClient(c.id).catch(() => { cleaned = false; });
  if (created.clients.length) check("Limpeza: clientes, conteúdos e logins de teste apagados", cleaned);
}

console.log(ok ? "\nTudo certo: o painel grava, consulta, edita, filtra e exclui no banco, e cada cliente vê só o que é dele." : "\nAlgum passo falhou. Veja as linhas marcadas com ✘.");
process.exit(ok ? 0 : 1);
