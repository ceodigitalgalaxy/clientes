/* ==========================================================================
   Página pública de aprovação: clientes.digitalgalaxy.com.br/aprovacao/#<código>
   --------------------------------------------------------------------------
   - Sem login: o código do link (depois do #) vai só no corpo dos pedidos à
     função "aprovacao" do Supabase, que confere tudo no banco. O # nunca é
     enviado ao servidor do site nem aparece em registros de acesso.
   - "Visualizar como cliente" (#previa=<lote>): a equipe, já logada no painel,
     vê a mesma página só para leitura (função approval_preview).
   ========================================================================== */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=887272bbb7";
import { createApprovalPage, renderLinkProblem } from "./ui/approval-page.js?v=887272bbb7";
import { createAuth } from "./lib/auth.js?v=887272bbb7";
import { createStorage } from "./lib/storage.js?v=887272bbb7";

/* A página não abre dentro de outro site (clique disfarçado) */
if (window.top !== window.self) throw new Error("Esta página não pode ser aberta dentro de outra.");

const root = document.getElementById("aprovacao");
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/aprovacao`;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROBLEMS = {
  link_invalido: { title: "Link não encontrado", text: "Este link de aprovação não existe ou está incompleto. Confira se copiou o endereço inteiro ou peça um novo link à Digital Galaxy.", iconName: "link" },
  link_desativado: { title: "Link desativado", text: "Este link foi desativado pela nossa equipe. Peça o link atualizado à Digital Galaxy.", iconName: "lock" },
  link_expirado: { title: "Link expirado", text: "O prazo deste link terminou. Peça um novo link à Digital Galaxy.", iconName: "clock" },
  muitas_tentativas: { title: "Muitas tentativas", text: "Espere um minuto e abra o link de novo.", iconName: "clock" }
};

class LinkError extends Error {
  constructor(message, { reason, view, status } = {}) { super(message); this.reason = reason; this.view = view; this.status = status; }
}

async function callFunction(body) {
  let response;
  try {
    response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
  } catch {
    throw new LinkError("Não foi possível conectar. Verifique a internet e tente de novo.", { reason: "offline" });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new LinkError(data?.error || "Não foi possível concluir agora. Tente de novo.", { reason: data?.reason, view: data?.view, status: response.status });
  return data;
}

function showRetry(message) {
  root.innerHTML = "";
  renderLinkProblem(root, { title: "Não foi possível carregar", text: message, iconName: "refresh" });
  const retry = document.createElement("button");
  retry.className = "btn btn--primary";
  retry.type = "button";
  retry.textContent = "Tentar de novo";
  retry.addEventListener("click", () => start());
  root.querySelector(".ap-problem").append(retry);
}

async function startPublic(token) {
  const page = createApprovalPage(root, {
    decide: (payload) => callFunction({ action: "decidir", token, ...payload }),
    approveAll: (payload) => callFunction({ action: "aprovar_todos", token, ...payload })
  });
  try {
    const { view } = await callFunction({ action: "ver", token });
    document.title = `${view.batch.title} · ${view.client.name} · Aprovação`;
    page.show(view);
  } catch (error) {
    if (PROBLEMS[error.reason]) renderLinkProblem(root, PROBLEMS[error.reason]);
    else showRetry(error.message);
  }
}

/** Equipe: pré-visualização com a sessão do painel (sem decidir) */
async function startPreview(batchId) {
  const auth = createAuth({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "equipe" });
  if (!auth.session) {
    renderLinkProblem(root, { title: "Entre no painel", text: "A pré-visualização é só para a equipe. Entre no painel da agência e abra de novo por lá.", iconName: "lock" });
    return;
  }
  try {
    const token = await auth.accessToken();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approval_preview`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_batch: batchId })
    });
    if (!response.ok) throw new Error("Não foi possível abrir a pré-visualização (é preciso ser da equipe).");
    const raw = await response.json();
    const storage = createStorage({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, getToken: () => auth.accessToken(), refresh: () => auth.refresh() });
    const paths = (raw.items || []).flatMap((i) => (i.content?.assets || []).map((a) => a.storage_path)).filter(Boolean);
    const signed = paths.length ? await storage.sign("content-media", [...new Set(paths)]).catch(() => ({})) : {};
    const view = {
      ...raw,
      client: { name: raw.client?.name || "", logo: raw.client?.logo_path ? storage.publicUrl("client-logos", raw.client.logo_path) : null },
      items: (raw.items || []).map((i) => ({ ...i, content: i.content ? { ...i.content, assets: (i.content.assets || []).map(({ storage_path, url, ...a }) => ({ ...a, src: url || signed[storage_path] || null })) } : null }))
    };
    document.title = `Pré-visualização · ${view.batch.title}`;
    createApprovalPage(root, { preview: true }).show(view);
  } catch (error) {
    showRetry(error.message);
  }
}

function start() {
  root.setAttribute("aria-busy", "true");
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const preview = hash.match(/^previa=(.+)$/);
  const run = preview && UUID.test(preview[1]) ? startPreview(preview[1]) : TOKEN.test(hash) ? startPublic(hash) : Promise.resolve(renderLinkProblem(root, PROBLEMS.link_invalido));
  run.finally(() => root.setAttribute("aria-busy", "false"));
}

window.addEventListener("hashchange", () => location.reload());
start();
