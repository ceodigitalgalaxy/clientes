/* Central de aprovação: a função pública "aprovacao" (código real) sobre o
   Supabase de mentira, com as regras do banco em memória.
   node admin/test/approval.test.mjs */

import assert from "node:assert/strict";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";
import { pairFromStatus, statusFromPair, whatsappMessage, approvalUrl } from "../../site/js/domain/approvals.js";
import { clientIp } from "../../supabase/functions/aprovacao/handler.js";

let passed = 0;
const ok = (label, fn) => { fn(); passed += 1; };
const okAsync = async (label, fn) => { await fn(); passed += 1; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const team = { id: "u-equipe", member: true, username: "admdg" };
const padaria = await store.createClient({ name: "Padaria Central", slug: "padaria", active: true });
const outro = await store.createClient({ name: "Outro Cliente", slug: "outro", active: true });
const make = async (client, title, extra = {}) => store.createContent(validateContent({ client_id: client.id, title, scheduled_date: "2026-11-10", network: "instagram", format: "post", ...extra }).value);
const c1 = await make(padaria, "Bom dia", { idea: "Primeira fornada", media_url: "https://interno.exemplo.com/REFERENCIA.jpg", internal_notes: "SEGREDO-INTERNO", pillar: "Bastidores",
  caption: "LEGENDA-DA-PRODUCAO", hashtags: "#padaria", planning_notes: "Observação do plano", client_notes: "Observação do final" });
const c2 = await make(padaria, "Promoção", { idea: "Café + pão" });
const cx = await make(outro, "Do outro");
const path = `${padaria.id}/${c1.id}/arte.png`;
fake.files.set(`content-media/${path}`, { type: "image/png", body: Buffer.from("png") });
await store.addAsset({ content_id: c1.id, kind: "image", role: "capa", storage_path: path, position: 0 });

const call = async (body, { origin = "http://localhost:5600", method = "POST", ip } = {}) => {
  const answer = await fake.handle({ method, url: "https://peieimwpkrattuldmjux.supabase.co/functions/v1/aprovacao", headers: { origin, "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) }, body: method === "POST" ? JSON.stringify(body) : undefined });
  return { status: answer.status, data: answer.body ? JSON.parse(answer.body) : null, headers: answer.headers };
};

/* ---------- Status separados ---------- */
ok("status antigo calculado dos dois novos (e vice-versa)", () => {
  assert.equal(statusFromPair("aprovado", "agendado"), "aprovado");
  assert.equal(statusFromPair("rascunho", "em_producao"), "em_producao");
  assert.equal(statusFromPair("reenviado", null), "aguardando_aprovacao");
  assert.equal(statusFromPair("aprovado", "publicado"), "publicado");
  assert.deepEqual(pairFromStatus("publicado"), { approval_status: "aprovado", production_status: "publicado" });
  assert.deepEqual(pairFromStatus("aprovado", "aprovado", "agendado"), { approval_status: "aprovado", production_status: "agendado" });
});
ok("mensagem do WhatsApp com o link no lugar de [LINK]", () => {
  const link = approvalUrl("https://clientes.digitalgalaxy.com.br/", "A".repeat(43));
  assert.equal(link, `https://clientes.digitalgalaxy.com.br/aprovacao/#${"A".repeat(43)}`);
  const msg = whatsappMessage(link);
  assert.ok(msg.includes(link) && !msg.includes("[LINK]") && /não precisa criar conta/.test(msg));
});
ok("IP de quem chama", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp(new Headers({})), "");
});

/* ---------- Equipe monta e envia ---------- */
const batch = await store.createBatch({ client_id: padaria.id, title: "Novembro", month: "2026-11-01" }, team);
await assert.rejects(store.approvalSetItems(team, { p_batch: batch.id, p_contents: [c1.id, cx.id] }), /conteudo_de_outro_cliente/);
await assert.rejects(store.approvalSetItems({ ...team, member: false }, { p_batch: batch.id, p_contents: [c1.id] }), /sem_permissao/);
await store.approvalSetItems(team, { p_batch: batch.id, p_contents: [c1.id, c2.id] });
await assert.rejects(store.approvalPublish(team, { p_batch: batch.id, p_items: [], p_title: "Novembro", p_intro: "", p_mode: "planejamento" }), /nada_para_enviar/);
const { token, sent } = await store.approvalPublish(team, { p_batch: batch.id, p_items: null, p_title: "Planejamento de novembro", p_intro: "Oi!", p_mode: "planejamento" });
ok("link: 43 caracteres aleatórios; mesmo token ao copiar de novo", () => {
  assert.equal(sent, 2);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});
assert.equal((await store.approvalLinkToken(team, { p_batch: batch.id })).token, token);
ok("conteúdo passa a aguardar aprovação (e o calendário vê)", async () => {});
assert.equal((await store.getContent(c1.id)).approval_status, "aguardando_aprovacao");
assert.equal((await store.getContent(c1.id)).status, "aguardando_aprovacao");

/* ---------- Página pública ---------- */
let r = await call({ action: "ver", token });
const view = r.data.view;
await okAsync("planejamento: só a ideia (sem legenda, arte, arquivos ou nada interno)", async () => {
  assert.equal(r.status, 200);
  assert.equal(view.items.length, 2);
  assert.equal(view.batch.mode, "planejamento");
  assert.equal(view.client.name, "Padaria Central");
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes("REFERENCIA") && !text.includes("SEGREDO-INTERNO") && !text.includes("storage_path"), "nada interno");
  assert.ok(!text.includes("Do outro"));
  assert.ok(!text.includes("LEGENDA-DA-PRODUCAO") && !text.includes("#padaria") && !text.includes("Observação do final") && !text.includes("sign/content-media"), "nada da produção");
  assert.deepEqual([view.items[0].content.idea, view.items[0].content.planning_notes, view.items[0].content.assets.length], ["Primeira fornada", "Observação do plano", 0]);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.match(r.headers["x-robots-tag"], /noindex/);
});
const [i1, i2] = view.items;
await okAsync("token errado, outra origem e GET são recusados", async () => {
  assert.equal((await call({ action: "ver", token: token.slice(0, -2) + "xx" })).status, 404);
  assert.equal((await call({ action: "ver", token: "curto" })).status, 404);
  assert.equal((await call({ action: "ver", token }, { origin: "https://site-estranho.com" })).status, 403);
  assert.equal((await call(null, { method: "GET" })).status, 405);
  assert.equal((await call({ action: "apagar", token })).status, 400);
});
await okAsync("aprovar registra; clique repetido não duplica", async () => {
  r = await call({ action: "decidir", token, item: i1.id, version: i1.version_id, decision: "aprovado", name: "Maria", session: "sessao-teste-1" });
  assert.equal(r.status, 200);
  assert.equal(r.data.view.items[0].status, "aprovado");
  r = await call({ action: "decidir", token, item: i1.id, version: i1.version_id, decision: "aprovado", name: "Maria", session: "sessao-teste-1" });
  assert.equal(r.status, 409);
  assert.equal(r.data.reason, "ja_decidido");
  assert.equal((await store.listDecisions({ batch_id: batch.id })).length, 1);
});
await okAsync("ajuste exige comentário e fica ligado à versão", async () => {
  r = await call({ action: "decidir", token, item: i2.id, version: i2.version_id, decision: "ajustes", comment: "   " });
  assert.equal(r.status, 422);
  r = await call({ action: "decidir", token, item: i2.id, version: i2.version_id, decision: "ajustes", comment: "Falar mais de proteção de pintura", name: "Maria", session: "sessao-teste-1" });
  assert.equal(r.status, 200);
  assert.equal((await store.getContent(c2.id)).approval_status, "ajustes");
  const [d] = await store.listDecisions({ content_id: c2.id });
  assert.deepEqual([d.action, d.comment, d.version_id, d.reviewer_name], ["ajustes", "Falar mais de proteção de pintura", i2.version_id, "Maria"]);
});
await okAsync("nova versão: preserva a anterior, volta como 'revisado' e mostra o pedido", async () => {
  await store.updateContent(c2.id, { ...(await store.getContent(c2.id)), idea: "Proteção de pintura" });
  assert.equal(await store.approvalResend(team, { p_batch: batch.id, p_items: [i2.id] }), 1);
  r = await call({ action: "ver", token });
  const item = r.data.view.items[1];
  assert.equal(item.status, "reenviado");
  assert.equal(item.version_number, 2);
  assert.equal(item.content.idea, "Proteção de pintura");
  assert.equal(item.previous_request.comment, "Falar mais de proteção de pintura");
  assert.equal((await store.listVersions({ content_id: c2.id })).length, 2, "versão anterior preservada");
  // A decisão sobre a versão antiga é recusada
  const old = await call({ action: "decidir", token, item: i2.id, version: i2.version_id, decision: "aprovado" });
  assert.equal(old.data.reason, "versao_desatualizada");
});
await okAsync("aprovar todos: só os pendentes, cada um registrado; lote aprovado", async () => {
  const current = (await call({ action: "ver", token })).data.view.items;
  r = await call({ action: "aprovar_todos", token, items: current.map((i) => ({ item: i.id, version: i.version_id })), name: "Maria", session: "sessao-teste-1" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.approved, [i2.id]);
  assert.equal(r.data.skipped[0].reason, "ja_decidido");
  assert.ok(r.data.view.items.every((i) => i.status === "aprovado"));
  assert.equal((await store.listDecisions({ batch_id: batch.id })).filter((d) => d.bulk).length, 1);
  assert.ok(store.approvalEvents.some((e) => e.event_type === "lote_aprovado"));
  const [summary] = await store.listBatchSummary({ client_id: padaria.id });
  assert.deepEqual([summary.overall_status, summary.aprovados, summary.total], ["aprovado", 2, 2]);
  assert.ok((await store.listEvents({ unread: true })).length >= 3, "decisões do cliente viram notificações");
});
await okAsync("regenerar invalida o anterior; desativar bloqueia acesso e arquivos", async () => {
  const { token: novo } = await store.approvalLinkRegenerate(team, { p_batch: batch.id });
  assert.equal((await call({ action: "ver", token })).status, 410);
  r = await call({ action: "ver", token: novo });
  assert.equal(r.status, 200);
  await store.approvalLinkRevoke(team, { p_batch: batch.id });
  r = await call({ action: "ver", token: novo });
  assert.deepEqual([r.status, r.data.reason], [410, "link_desativado"]);
  assert.ok(!JSON.stringify(r.data).includes("sign/content-media"), "nenhum link de arquivo novo");
  assert.equal(await store.approvalLinkToken(team, { p_batch: batch.id }), null);
});
await okAsync("link expirado avisa e registra", async () => {
  const b2 = await store.createBatch({ client_id: padaria.id, title: "Arte final", month: "2026-11-01", approval_mode: "final" }, team);
  await store.approvalSetItems(team, { p_batch: b2.id, p_contents: [c1.id] });
  const t2 = (await store.approvalPublish(team, { p_batch: b2.id, p_items: null, p_title: "Arte final", p_intro: "", p_mode: "final", p_expires: new Date(Date.now() + 86400000).toISOString() })).token;
  const finalView = (await call({ action: "ver", token: t2 })).data.view;
  assert.equal(finalView.batch.mode, "final");
  // Final: arte (link assinado), legenda, hashtags e observação para o cliente; sem a ideia nem nada interno
  const fc = finalView.items[0].content;
  assert.deepEqual([fc.caption, fc.hashtags, fc.client_notes, fc.idea], ["LEGENDA-DA-PRODUCAO", "#padaria", "Observação do final", undefined]);
  assert.match(fc.assets[0].src, /\/storage\/v1\/object\/sign\/content-media\/.+\?token=/, "arquivo por link assinado");
  assert.ok(!JSON.stringify(finalView).includes("SEGREDO-INTERNO"));
  // Ideia e final independentes: a ideia continua aprovada com o final aguardando
  assert.deepEqual([(await store.getContent(c1.id)).approval_status, (await store.getContent(c1.id)).final_status], ["aprovado", "aguardando_aprovacao"]);
  // Mudar só a legenda não pede para reaprovar a ideia; mudar a ideia pede
  await store.updateContent(c1.id, { ...(await store.getContent(c1.id)), caption: "Legenda nova" });
  const staleNow = async (b) => (await store.approvalStale(team, { p_batch: b })).filter((x) => x.stale).map((x) => x.content_id);
  assert.deepEqual(await staleNow(batch.id), []);
  assert.deepEqual(await staleNow(b2.id), [c1.id]);
  // O tipo do lote não muda depois de enviado
  await assert.rejects(store.updateBatch(b2.id, { approval_mode: "planejamento" }), /modo_travado/);
  // Final sem arte nem legenda não vai
  const vazio = await make(padaria, "Sem nada");
  const b4 = await store.createBatch({ client_id: padaria.id, title: "Final vazio", month: "2026-11-01", approval_mode: "final" }, team);
  await store.approvalSetItems(team, { p_batch: b4.id, p_contents: [vazio.id] });
  await assert.rejects(store.approvalPublish(team, { p_batch: b4.id, p_items: null, p_title: "Final vazio", p_intro: "", p_mode: "final" }), /final_sem_conteudo/);
  store.expireLink(b2.id);
  r = await call({ action: "ver", token: t2 });
  assert.deepEqual([r.status, r.data.reason], [410, "link_expirado"]);
  assert.ok(store.approvalEvents.some((e) => e.batch_id === b2.id && e.event_type === "link_expirado"));
  // Item de outro lote não é decidido por este link
  const b3 = await store.createBatch({ client_id: padaria.id, title: "Terceiro", month: "2026-12-01" }, team);
  await store.approvalSetItems(team, { p_batch: b3.id, p_contents: [c2.id] });
  const t3 = (await store.approvalPublish(team, { p_batch: b3.id, p_items: null, p_title: "Terceiro", p_intro: "", p_mode: "planejamento" })).token;
  const foreign = await call({ action: "decidir", token: t3, item: i1.id, version: i1.version_id, decision: "aprovado" });
  assert.equal(foreign.data.reason, "item_nao_encontrado");
});
await okAsync("muitas tentativas com token errado: bloqueio por IP", async () => {
  let last;
  for (let n = 0; n < 25; n += 1) last = await call({ action: "ver", token: "Z".repeat(43) }, { ip: "198.51.100.77" });
  assert.equal(last.status, 429);
});
await okAsync("lote enviado não é apagado (histórico preservado)", async () => {
  assert.deepEqual(await store.deleteBatch(batch.id), []);
});

console.log(`aprovação: ${passed} verificações passaram`);
