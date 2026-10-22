/* Portal do cliente (sem rede): links de mídia, repositório real, contas de
   cliente e conversão do banco para o calendário.
   Rode: node admin/test/portal.test.mjs */

import assert from "node:assert/strict";
import { describeMedia } from "../../site/js/ui/media.js";
import { createSupabaseRepository } from "../../site/js/data/supabase-repository.js";
import { activityFromContent } from "../../site/js/domain/content-mapping.js";
import { statusOf } from "../../site/js/domain/status.js";
import { loginEmail, usernameFromEmail, accountKind } from "../../site/js/domain/accounts.js";
import { weekDays, weekLabel, addDays } from "../../site/js/lib/dates.js";
import { createAuth } from "../../site/js/lib/auth.js";
import { createTeamAdmin } from "../equipe.mjs";
import { readFileSync } from "node:fs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { createHandler, keysFromEnv } from "../../supabase/functions/acesso-cliente/handler.js";
import { generatePassword } from "../../site/admin/js/views/access.js";
import { passwordProblem } from "../../site/js/domain/accounts.js";

let checks = 0;
const ok = (label, fn) => { fn(); checks += 1; };

/* ---------- Links de mídia ---------- */
const m = (url, kind) => describeMedia(url, kind);
ok("imagem direta", () => assert.deepEqual([m("https://cdn.exemplo.com/arte.jpg").type, m("https://cdn.exemplo.com/arte.jpg").src], ["image", "https://cdn.exemplo.com/arte.jpg"]));
ok("imagem sem extensão continua imagem", () => assert.equal(m("https://images.exemplo.com/foto?id=1", "image").type, "image"));
for (const url of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=10", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ"]) {
  ok(`YouTube ${url}`, () => {
    const r = m(url, "video");
    assert.equal(r.type, "embed");
    assert.equal(r.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0", "player oficial, modo privacidade");
    assert.equal(r.ratio, "wide");
  });
}
ok("YouTube Shorts fica em pé", () => assert.equal(m("https://youtube.com/shorts/abcdefghijk", "video").ratio, "vertical"));
ok("YouTube sem vídeo vira link", () => assert.equal(m("https://www.youtube.com/@canal", "video").type, "link"));
ok("YouTube com id inválido não é incorporado", () => assert.equal(m("https://www.youtube.com/watch?v=<script>", "video").type, "link"));
ok("Vimeo", () => assert.equal(m("https://vimeo.com/123456789", "video").src, "https://player.vimeo.com/video/123456789"));
ok("Vimeo não listado", () => assert.equal(m("https://vimeo.com/123456789/abc123def0", "video").src, "https://player.vimeo.com/video/123456789?h=abc123def0"));
ok("Vimeo player", () => assert.equal(m("https://player.vimeo.com/video/123456789?h=ff00aa11", "video").src, "https://player.vimeo.com/video/123456789?h=ff00aa11"));
ok("TikTok vídeo", () => {
  const r = m("https://www.tiktok.com/@marca/video/7301234567890123456?lang=pt", "video");
  assert.deepEqual([r.type, r.src, r.ratio], ["embed", "https://www.tiktok.com/player/v1/7301234567890123456", "vertical"]);
});
ok("TikTok link curto não é incorporado", () => assert.equal(m("https://vm.tiktok.com/ZMabc/", "video").type, "link"));
ok("Google Drive arquivo", () => assert.equal(m("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing", "video").src, "https://drive.google.com/file/d/1AbCdEfGhIjKlMn/preview"));
ok("Google Drive pasta vira link", () => assert.equal(m("https://drive.google.com/drive/folders/1Abc", "video").type, "link"));
ok("arquivo de vídeo", () => {
  for (const ext of ["mp4", "webm", "ogv", "m4v", "mov", "MP4"]) assert.equal(m(`https://cdn.exemplo.com/v/video.${ext}?x=1`, "video").type, "video", ext);
});
ok("arquivo de vídeo marcado como imagem continua vídeo", () => assert.equal(m("https://cdn.exemplo.com/video.mp4", "image").type, "video"));
ok("Instagram não é incorporado", () => {
  const r = m("https://www.instagram.com/reel/Cabc123/", "video");
  assert.equal(r.type, "link");
  assert.equal(r.original, "https://www.instagram.com/reel/Cabc123/");
  assert.match(r.reason, /Instagram/);
});
ok("Facebook e outros não são incorporados", () => {
  for (const url of ["https://www.facebook.com/watch/?v=1", "https://fb.watch/abc/", "https://www.canva.com/design/x/view"]) assert.equal(m(url, "image").type, "link", url);
});
ok("página qualquer marcada como vídeo não é incorporada", () => assert.equal(m("https://exemplo.com/pagina-do-video", "video").type, "link"));
ok("links perigosos ou quebrados", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,oi", "ftp://x/y.mp4", "não é link", ""]) assert.equal(m(url, "video").type, "invalid", url);
});

/* ---------- Contas ---------- */
ok("contas de cliente", () => {
  assert.equal(loginEmail("padaria", "cliente"), "cliente+padaria@digitalgalaxy.com.br");
  assert.equal(usernameFromEmail("cliente+padaria@digitalgalaxy.com.br"), "padaria");
  assert.equal(accountKind("cliente+padaria@digitalgalaxy.com.br"), "cliente");
  assert.equal(accountKind("equipe+admdg@digitalgalaxy.com.br"), "equipe");
  assert.equal(accountKind("alguem@gmail.com"), null);
  assert.throws(() => loginEmail("x", "admin"));
});

/* ---------- Semana ---------- */
ok("semana de domingo a sábado", () => {
  assert.deepEqual(weekDays("2026-10-21").map((d) => d.iso), ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  assert.equal(weekLabel("2026-10-01"), "27 de setembro a 3 de outubro de 2026");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

/* ---------- Do banco para o calendário ---------- */
ok("status vem da agência e observação liberada", () => {
  const a = activityFromContent({ id: "1", title: "T", scheduled_date: "2026-11-05", scheduled_time: "10:30:00", network: "instagram", format: "reels", media_url: "https://youtu.be/dQw4w9WgXcQ", media_kind: "video", caption: "L", client_notes: "Nota", status: "publicado", version: 3, updated_at: "2026-10-21T10:00:00Z" });
  assert.equal(a.time, "10:30");
  assert.equal(a.status, "publicado");
  assert.equal(statusOf(a, []), "publicado");
  assert.equal(a.notes, "Nota");
  assert.deepEqual(a.media, [{ kind: "video", src: "https://youtu.be/dQw4w9WgXcQ", alt: "T" }]);
  assert.ok(!("internal_notes" in a));
});
ok("sem status da agência, o status vem do histórico de aprovações (próxima etapa)", () => {
  assert.equal(statusOf({ id: "x", version: 1, requiresApproval: true }, [{ activityId: "x", version: 1, decision: "ajustes", createdAt: "1" }]), "ajustes");
});

/* ---------- Repositório real ---------- */
const calls = [];
let responses = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
  const { status, body } = responses.shift() || { status: 200, body: [] };
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
};
let refreshes = 0;
const fakeAuth = { accessToken: async () => "token-cliente", refresh: async () => { refreshes += 1; } };
const repo = createSupabaseRepository({ url: "https://exemplo.supabase.co", apiKey: "sb_publishable_TESTE", auth: fakeAuth, fetchImpl: fakeFetch });

responses = [{ status: 200, body: [{ client_id: "c1", name: "Padaria Central Ltda", segment: "Alimentação" }] }];
const client = await repo.getClient();
ok("perfil do cliente", () => {
  assert.deepEqual(client, { id: "c1", name: "Padaria Central Ltda", segment: "Alimentação", initials: "PC" });
  assert.equal(calls.at(-1).url, "https://exemplo.supabase.co/rest/v1/rpc/portal_profile");
  assert.deepEqual(calls.at(-1).body, {}, "não envia id de cliente");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer token-cliente");
  assert.equal(calls.at(-1).headers.apikey, "sb_publishable_TESTE");
});
responses = [{ status: 200, body: [] }];
await assert.rejects(repo.getClient(), (e) => e.reason === "no_access");

responses = [{ status: 200, body: [{ id: "a", title: "T", scheduled_date: "2026-02-03", scheduled_time: null, network: "instagram", format: "post", media_url: null, media_kind: null, caption: null, client_notes: null, status: "aprovado", version: 1, updated_at: "x" }] }];
const items = await repo.listActivities("2026-02");
ok("conteúdos do mês", () => {
  assert.equal(calls.at(-1).url, "https://exemplo.supabase.co/rest/v1/rpc/portal_contents");
  assert.deepEqual(calls.at(-1).body, { p_from: "2026-02-01", p_to: "2026-02-28" }, "só o período; o cliente vem do login");
  assert.equal(items[0].status, "aprovado");
});
responses = [{ status: 401, body: {} }, { status: 200, body: [] }];
await repo.listActivitiesBetween("2026-02-01", "2026-03-31");
ok("401 renova a sessão e repete uma vez", () => assert.equal(refreshes, 1));
responses = [{ status: 401, body: {} }, { status: 401, body: {} }];
await assert.rejects(repo.listActivities("2026-02"), (e) => e.status === 401 && e.reason === "session");
responses = [{ status: 500, body: {} }];
await assert.rejects(repo.listActivities("2026-02"), (e) => e.status === 502);
const offline = createSupabaseRepository({ url: "https://exemplo.supabase.co", apiKey: "k", auth: fakeAuth, fetchImpl: async () => { throw new TypeError("rede"); } });
await assert.rejects(offline.listActivities("2026-02"), (e) => e.reason === "offline");
ok("recursos que ainda não existem no banco ficam desligados", () => assert.deepEqual(repo.features, { approvals: false, comments: false, ideas: false, plans: false }));

/* ---------- Sessões separadas: equipe x cliente ---------- */
{
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  let sent = null;
  const authFetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ access_token: "a", refresh_token: "r", expires_in: 3600, user: { id: "u", email: sent.email, user_metadata: {} } }) }; };
  const portal = createAuth({ url: "https://exemplo.supabase.co", apiKey: "k", kind: "cliente", storage, fetchImpl: authFetch });
  await portal.signIn("padaria", "senha-qualquer");
  ok("login do portal usa conta de cliente", () => assert.equal(sent.email, "cliente+padaria@digitalgalaxy.com.br"));
  const panel = createAuth({ url: "https://exemplo.supabase.co", apiKey: "k", kind: "equipe", storage, fetchImpl: authFetch });
  ok("sessão de cliente não vale no painel da equipe", () => assert.equal(panel.session, null));
  // Sessão de equipe gravada à força na chave do portal não é aceita
  memory.set("dg-portal-sessao", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at_ms: Date.now() + 1e6, user: { id: "u", email: "equipe+admdg@digitalgalaxy.com.br" } }));
  const portal2 = createAuth({ url: "https://exemplo.supabase.co", apiKey: "k", kind: "cliente", storage, fetchImpl: authFetch });
  ok("sessão de equipe não vale no portal", () => assert.equal(portal2.session, null));
}

/* ---------- Login de cliente (admin/equipe.mjs) ---------- */
{
  const teamCalls = [];
  const routes = {
    "POST /auth/v1/admin/users": { status: 200, body: { id: "user-1" } },
    "POST /rest/v1/client_members": { status: 201, body: null },
    "GET /auth/v1/admin/users": { status: 200, body: { users: [{ id: "user-1", email: "cliente+padaria@digitalgalaxy.com.br" }, { id: "user-2", email: "equipe+padaria@digitalgalaxy.com.br" }] } }
  };
  const teamFetch = async (url, init) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    teamCalls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes[key] || { status: 200, body: null };
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === null ? "" : JSON.stringify(r.body)) };
  };
  const team = createTeamAdmin({ url: "https://exemplo.supabase.co", secretKey: "sb_secret_TESTE", fetchImpl: teamFetch });
  await team.createClientAccess({ username: "padaria", clientId: "c1", clientName: "Padaria Central", password: "Galaxia#Roxa-77" });
  ok("cria a conta de cliente e liga ao cliente", () => {
    assert.equal(teamCalls[0].body.email, "cliente+padaria@digitalgalaxy.com.br");
    assert.deepEqual(teamCalls[1], { key: "POST /rest/v1/client_members", body: { user_id: "user-1", client_id: "c1", username: "padaria" } });
  });
  await assert.rejects(team.setPassword("padaria", "Outra#Senha-88"), (e) => /equipe e um de cliente/.test(e.message));
  await team.setPassword("padaria", "Outra#Senha-88", "cliente");
  ok("troca a senha da conta certa quando o nome se repete", () => assert.equal(teamCalls.at(-1).key, "PUT /auth/v1/admin/users/user-1"));
}

/* ---------- Função acesso-cliente (código real sobre o Supabase de teste) ---------- */
{
  ok("cópia das regras de conta na função é idêntica à do site", () => {
    assert.equal(readFileSync(new URL("../../supabase/functions/acesso-cliente/accounts.js", import.meta.url), "utf8"), readFileSync(new URL("../../site/js/domain/accounts.js", import.meta.url), "utf8"));
  });
  ok("chaves lidas do ambiente da função (novas e legadas)", () => {
    const env = { SUPABASE_URL: "u", SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}', SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_y"}' };
    assert.deepEqual(keysFromEnv((k) => env[k]), { url: "u", secret: "sb_secret_x", publishable: "sb_publishable_y" });
    const legacy = { SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "eyJs", SUPABASE_ANON_KEY: "eyJa" };
    assert.deepEqual(keysFromEnv((k) => legacy[k]), { url: "u", secret: "eyJs", publishable: "eyJa" });
  });
  ok("senha gerada é forte e varia", () => {
    const a = generatePassword("loja"); const b = generatePassword("loja");
    assert.equal(a.length, 14); assert.notEqual(a, b); assert.equal(passwordProblem(a, "loja"), null);
  });

  const KEY = "sb_publishable_TESTE";
  const store = createMemoryStore();
  const fake = createFakeSupabase({ store, publishableKey: KEY });
  const loja = await store.createClient({ name: "Loja Teste", slug: "loja-teste", active: true });
  const inativa = await store.createClient({ name: "Loja Inativa", slug: "loja-inativa", active: false });
  fake.addUser("equipe1", "Senha-equipe-123");
  fake.addUser("fora", "Senha-fora-12345", { member: false });
  fake.addUser("cliente1", "Senha-cliente-123", { kind: "cliente", clientId: loja.id });
  const URL_FN = "https://peieimwpkrattuldmjux.supabase.co/functions/v1/acesso-cliente";
  const signIn = async (email, password) => JSON.parse((await fake.handle({ method: "POST", url: "https://peieimwpkrattuldmjux.supabase.co/auth/v1/token?grant_type=password", headers: { apikey: KEY }, body: JSON.stringify({ email, password }) })).body).access_token;
  const team = await signIn("equipe+equipe1@digitalgalaxy.com.br", "Senha-equipe-123");
  const outsider = await signIn("equipe+fora@digitalgalaxy.com.br", "Senha-fora-12345");
  const customer = await signIn("cliente+cliente1@digitalgalaxy.com.br", "Senha-cliente-123");
  const fn = async (body, { token = team, origin = "http://localhost:5612", method = "POST" } = {}) => {
    const r = await fake.handle({ method, url: URL_FN, headers: { apikey: KEY, origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
  };
  const login = async (user, pass) => (await fake.handle({ method: "POST", url: "https://peieimwpkrattuldmjux.supabase.co/auth/v1/token?grant_type=password", headers: { apikey: KEY }, body: JSON.stringify({ email: `cliente+${user}@digitalgalaxy.com.br`, password: pass }) })).status;

  const results = {
    semToken: await fn({ action: "criar" }, { token: null }),
    chaveNoLugarDoToken: await fn({ action: "criar" }, { token: "sb_publishable_TESTE" }),
    tokenFalso: await fn({ action: "criar" }, { token: "eyJ.falso.x" }),
    foraDaEquipe: await fn({ action: "criar", client_id: loja.id, username: "x-loja", password: "Galaxia#Roxa-77" }, { token: outsider }),
    cliente: await fn({ action: "remover", username: "cliente1" }, { token: customer }),
    outraOrigem: await fn({ action: "criar" }, { origin: "https://evil.example" }),
    get: await fn({}, { method: "GET" }),
    acaoDesconhecida: await fn({ action: "__proto__" }),
    senhaFraca: await fn({ action: "criar", client_id: loja.id, username: "nova-loja", password: "123" }),
    usuarioInvalido: await fn({ action: "criar", client_id: loja.id, username: "a", password: "Galaxia#Roxa-77" }),
    clienteInativo: await fn({ action: "criar", client_id: inativa.id, username: "inativa", password: "Galaxia#Roxa-77" }),
    usuarioRepetido: await fn({ action: "criar", client_id: loja.id, username: "cliente1", password: "Galaxia#Roxa-77" }),
    criar: await fn({ action: "criar", client_id: loja.id, username: "Nova.Loja", password: "Galaxia#Roxa-77" })
  };
  ok("sem login, com chave no lugar do token ou com token falso: recusado", () => {
    for (const k of ["semToken", "chaveNoLugarDoToken", "tokenFalso"]) assert.equal(results[k].status, 401, k);
  });
  ok("só a equipe usa a função (nem cliente, nem conta fora da equipe)", () => {
    assert.equal(results.foraDaEquipe.status, 403);
    assert.equal(results.cliente.status, 403);
  });
  ok("outra origem, outro método e ação desconhecida: recusados", () => {
    assert.equal(results.outraOrigem.status, 403);
    assert.equal(results.get.status, 405);
    assert.equal(results.acaoDesconhecida.status, 400);
  });
  ok("validações: senha fraca, usuário inválido, cliente inativo, usuário repetido", () => {
    assert.equal(results.senhaFraca.status, 422); assert.ok(results.senhaFraca.body.fields.password);
    assert.equal(results.usuarioInvalido.status, 422); assert.ok(results.usuarioInvalido.body.fields.username);
    assert.equal(results.clienteInativo.status, 409);
    assert.equal(results.usuarioRepetido.status, 409); assert.ok(results.usuarioRepetido.body.fields.username);
  });
  ok("cria o login do cliente ligado ao cliente certo", () => {
    assert.deepEqual(results.criar, { status: 200, body: { ok: true, username: "nova.loja", client_id: loja.id }, headers: results.criar.headers });
    assert.equal(results.criar.headers["Access-Control-Allow-Origin"] || results.criar.headers["access-control-allow-origin"], "http://localhost:5612");
    assert.deepEqual(store.findMembers({ username: "nova.loja" }).map((m) => m.client_id), [loja.id]);
    assert.ok(!JSON.stringify(results.criar.body).includes("Galaxia"), "a resposta não devolve a senha");
  });
  assert.equal(await login("nova.loja", "Galaxia#Roxa-77"), 200);
  const troca = await fn({ action: "senha", username: "nova.loja", password: "Outra#Senha-88" });
  const [antiga, nova] = [await login("nova.loja", "Galaxia#Roxa-77"), await login("nova.loja", "Outra#Senha-88")];
  ok("troca a senha: a antiga para de funcionar", () => assert.deepEqual([troca.status, antiga, nova], [200, 400, 200]));
  const equipeComoCliente = await fn({ action: "senha", username: "equipe1", password: "Outra#Senha-88" });
  const removerEquipe = await fn({ action: "remover", username: "equipe1" });
  ok("nunca mexe em contas da equipe", () => {
    assert.equal(equipeComoCliente.status, 404);
    assert.equal(removerEquipe.status, 404);
  });
  assert.equal((await signIn("equipe+equipe1@digitalgalaxy.com.br", "Senha-equipe-123")) !== undefined, true, "senha da equipe intacta");
  const remover = await fn({ action: "remover", username: "nova.loja" });
  ok("remove o acesso: login e vínculo apagados", () => {
    assert.equal(remover.status, 200);
    assert.deepEqual(store.findMembers({ username: "nova.loja" }), []);
  });
  const depois = await login("nova.loja", "Outra#Senha-88");
  ok("depois de removido, o login não entra mais", () => assert.equal(depois, 400));
  const semConfig = await createHandler({ url: "", secret: "", publishable: "" })(new Request(URL_FN, { method: "POST", headers: { authorization: "Bearer x" } }));
  ok("sem configuração a função recusa", () => assert.equal(semConfig.status, 500));
}

console.log(`portal: ${checks} verificações passaram`);
