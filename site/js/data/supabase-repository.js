/* ==========================================================================
   Repositório REAL do portal do cliente (Supabase)
   --------------------------------------------------------------------------
   Único ponto de contato da tela com os dados. Os dados vêm só de funções
   do banco que descobrem o cliente pela sessão (nenhuma recebe id de
   cliente; trocar ids ou parâmetros na requisição não dá acesso a outro):
     portal_client()                 → o cliente do login atual (com a foto)
     portal_calendar(p_from, p_to)   → conteúdos liberados, arte final e decisão
     portal_decide(...)              → aprovar ou pedir ajuste (só a versão atual)
   A arte final em arquivo chega por links assinados do armazenamento
   (o banco só assina para o cliente os arquivos liberados dele).
   Observações do cliente e ideias ainda não existem no banco.

   Métodos (todos assíncronos):
     getClient()                    → Client do login atual
     getPlan(month)                 → null (foco do mês ainda não existe no banco)
     listActivitiesBetween(from, to), listActivities(month) → Activity[]
     listApprovals(ids)             → decisão atual de cada conteúdo
     addApproval({activityId, version, decision, message})
     listComments, countComments, listIdeas → vazios por enquanto
   ========================================================================== */

import { activityFromContent } from "../domain/content-mapping.js";
import { daysInMonth } from "../lib/dates.js";
import { createStorage } from "../lib/storage.js";

/** Respostas de portal_decide → mensagens para o cliente */
const DECISION_ERRORS = {
  versao_desatualizada: "A equipe atualizou este conteúdo enquanto você olhava. Confira a versão nova e responda de novo.",
  nao_aguarda_aprovacao: "Este conteúdo não está mais aguardando aprovação.",
  mensagem_obrigatoria: "Conte o que você gostaria de mudar.",
  mensagem_longa: "A mensagem pode ter até 800 caracteres.",
  conteudo_nao_encontrado: "Conteúdo não encontrado.",
  decisao_invalida: "Resposta inválida."
};
const SIGN_SECONDS = 3600;

export class RepositoryError extends Error {
  constructor(status, message, reason) { super(message); this.status = status; this.reason = reason; }
}

const initials = (name) => name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "·";

/**
 * @param {object} options
 * @param {string} options.url      endereço do Supabase
 * @param {string} options.apiKey   chave PUBLICÁVEL
 * @param {ReturnType<import("../lib/auth.js").createAuth>} options.auth  login do cliente
 */
export function createSupabaseRepository({ url, apiKey, auth, fetchImpl = globalThis.fetch.bind(globalThis), storage = null }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/rpc`;
  const files = storage || createStorage({ url, apiKey, getToken: () => auth.accessToken(), refresh: () => auth.refresh(), fetchImpl });
  const signed = new Map();      // caminho → { url, expires } (reaproveita links ainda válidos)
  const decisions = new Map();   // conteúdo → decisão da versão atual

  /** Links assinados para a arte final (só os que o banco liberar) */
  async function signPaths(paths) {
    const now = Date.now();
    const missing = paths.filter((p) => !(signed.get(p)?.expires > now + 10 * 60 * 1000));
    if (missing.length) {
      try {
        const urls = await files.sign("content-media", missing, SIGN_SECONDS);
        Object.entries(urls).forEach(([path, link]) => signed.set(path, { url: link, expires: now + SIGN_SECONDS * 1000 }));
      } catch { /* sem link: a tela mostra o aviso com "tente de novo" */ }
    }
    return (path) => signed.get(path)?.url || null;
  }

  async function rpc(name, body = {}, retry = true) {
    let token;
    try {
      token = await auth.accessToken();
    } catch (error) {
      if (error.reason === "offline") throw new RepositoryError(503, error.message, "offline");
      throw new RepositoryError(401, error.message, "session");
    }
    let response;
    try {
      response = await fetchImpl(`${base}/${name}`, {
        method: "POST",
        headers: { apikey: apiKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new RepositoryError(503, "Não foi possível conectar. Verifique a internet e tente de novo.", "offline");
    }
    // Token vencido no meio do caminho: renova uma vez e repete
    if (response.status === 401 && retry) {
      try { await auth.refresh(); } catch (error) {
        throw new RepositoryError(error.reason === "offline" ? 503 : 401, error.message, error.reason === "offline" ? "offline" : "session");
      }
      return rpc(name, body, false);
    }
    if (response.status === 401) throw new RepositoryError(401, "Sua sessão expirou. Entre de novo.", "session");
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const key = String(data?.message || "");
      if (DECISION_ERRORS[key]) throw new RepositoryError(409, DECISION_ERRORS[key], key);
      throw new RepositoryError(502, "Não conseguimos carregar o seu planejamento agora. Tente de novo em instantes.", "server");
    }
    try { return await response.json(); } catch { throw new RepositoryError(502, "Resposta inesperada do servidor. Tente de novo.", "server"); }
  }

  return {
    isDemo: false,
    features: { approvals: true, comments: false, ideas: false, plans: false },

    async getClient() {
      const rows = await rpc("portal_client");
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) throw new RepositoryError(403, "Este usuário não tem acesso ao portal de clientes.", "no_access");
      return { id: row.client_id, name: row.name, segment: row.segment || "", initials: initials(row.name), logoUrl: files.publicUrl("client-logos", row.logo_path) };
    },

    /** O "foco do mês" ainda não existe no banco */
    async getPlan() { return null; },

    /** Conteúdos liberados entre duas datas (AAAA-MM-DD, até 62 dias) */
    async listActivitiesBetween(from, to) {
      const rows = await rpc("portal_calendar", { p_from: from, p_to: to });
      const activities = (Array.isArray(rows) ? rows : []).map(activityFromContent);
      const paths = activities.flatMap((a) => a.final.filter((f) => f.storagePath).map((f) => f.storagePath));
      const linkFor = await signPaths(paths);
      activities.forEach((a) => {
        a.final = a.final.map((f) => (f.storagePath ? { ...f, src: linkFor(f.storagePath) } : f));
        if (a.decision) decisions.set(a.id, a.decision); else decisions.delete(a.id);
      });
      return activities;
    },

    async listActivities(month) {
      return this.listActivitiesBetween(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`);
    },

    /** Decisão do cliente sobre a versão atual de cada conteúdo (vem junto do calendário) */
    async listApprovals(activityIds = []) {
      return activityIds.filter((id) => decisions.has(id)).map((id) => ({ activityId: id, ...decisions.get(id) }));
    },

    /** Aprovar ou pedir ajuste (o banco confere cliente, status e versão) */
    async addApproval({ activityId, version, decision, message = "" }) {
      const rows = await rpc("portal_decide", { p_content_id: activityId, p_version: version, p_decision: decision, p_message: message || null });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return { activityId, version, decision, message, status: row?.new_status };
    },
    async listComments() { return []; },
    async countComments() { return {}; },
    async listIdeas() { return []; }
  };
}
