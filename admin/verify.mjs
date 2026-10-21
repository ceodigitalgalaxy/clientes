/* ==========================================================================
   Verificação no banco real (Supabase)
   --------------------------------------------------------------------------
   Rode no computador da agência, depois de preencher admin/.env:
       node admin/verify.mjs
   Cria um cliente e um conteúdo de TESTE, consulta, edita, filtra, confere o
   calendário do cliente, exclui os dois e mostra o resultado de cada passo.
   Nada fica gravado no final (o próprio script apaga o que criou).
   ========================================================================== */

import { loadEnv } from "./server.mjs";
import { createSupabaseStore } from "./lib/store-supabase.mjs";
import { validateClient, validateContent } from "./public/js/domain/rules.js";

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
console.log(ok ? "\nTudo certo: o painel grava, consulta, edita, filtra e exclui no banco." : "\nAlgum passo falhou. Veja as linhas marcadas com ✘.");
process.exit(ok ? 0 : 1);
