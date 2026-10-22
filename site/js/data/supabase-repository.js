/* ==========================================================================
   Repositório REAL do portal do cliente (Supabase)
   --------------------------------------------------------------------------
   Único ponto de contato da tela com os dados. Os dados vêm só de duas
   funções do banco:
     portal_profile()               → o cliente do login atual
     portal_contents(p_from, p_to)  → conteúdos liberados desse cliente
   Nenhuma delas recebe id de cliente: o banco descobre quem é pela sessão.
   Trocar ids ou parâmetros na requisição não dá acesso a outro cliente.
   Aprovações, observações do cliente e ideias ainda não existem no banco
   (features = false): a tela esconde essas ações.

   Métodos (todos assíncronos):
     getClient()                    → Client do login atual
     getPlan(month)                 → null (foco do mês ainda não existe no banco)
     listActivitiesBetween(from, to), listActivities(month) → Activity[]
     listApprovals, listComments, countComments, listIdeas → vazios por enquanto
   ========================================================================== */

import { activityFromContent } from "../domain/content-mapping.js";
import { daysInMonth } from "../lib/dates.js";

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
export function createSupabaseRepository({ url, apiKey, auth, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/rpc`;

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
    if (!response.ok) throw new RepositoryError(502, "Não conseguimos carregar o seu planejamento agora. Tente de novo em instantes.", "server");
    try { return await response.json(); } catch { throw new RepositoryError(502, "Resposta inesperada do servidor. Tente de novo.", "server"); }
  }

  return {
    isDemo: false,
    features: { approvals: false, comments: false, ideas: false, plans: false },

    async getClient() {
      const rows = await rpc("portal_profile");
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) throw new RepositoryError(403, "Este usuário não tem acesso ao portal de clientes.", "no_access");
      return { id: row.client_id, name: row.name, segment: row.segment || "", initials: initials(row.name) };
    },

    /** O "foco do mês" ainda não existe no banco */
    async getPlan() { return null; },

    /** Conteúdos liberados entre duas datas (AAAA-MM-DD, até 62 dias) */
    async listActivitiesBetween(from, to) {
      const rows = await rpc("portal_contents", { p_from: from, p_to: to });
      return (Array.isArray(rows) ? rows : []).map(activityFromContent);
    },

    async listActivities(month) {
      return this.listActivitiesBetween(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`);
    },

    async listApprovals() { return []; },
    async listComments() { return []; },
    async countComments() { return {}; },
    async listIdeas() { return []; }
  };
}
