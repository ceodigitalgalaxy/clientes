/* Conexão da tela com o banco (Supabase), com a sessão de quem entrou.
   Valida os dados antes de enviar (domain/rules.js); o banco confere de novo
   com as próprias regras e só aceita membros da equipe (RLS). */

import { validateClient, validateContent, validateContentFilters } from "./domain/rules.js";

export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

function requireValid({ value, errors }) {
  if (Object.keys(errors).length) throw new ApiError(422, "Revise os campos destacados.", errors);
  return value;
}

/**
 * @param {object} options
 * @param {ReturnType<import("./data/store.js").createSupabaseStore>} options.store
 * @param {(message: string) => void} options.onSessionLost  chamada quando a sessão acaba (volta para o login)
 */
export function createApi({ store, onSessionLost }) {
  /** Erros viram ApiError; sessão encerrada também leva de volta ao login */
  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Sem internet ao renovar a sessão não é fim de sessão: vira erro de conexão comum
      const status = error?.reason === "offline" ? 503 : error?.status || 0;
      if (status === 401) onSessionLost(error.message);
      throw new ApiError(status, error?.message || "Algo deu errado. Tente de novo.", error?.fields);
    }
  };

  return {
    isAgencyMember: guard((userId) => store.isAgencyMember(userId)),
    listClients: guard(() => store.listClients()),
    createClient: guard((data) => store.createClient(requireValid(validateClient(data)))),
    updateClient: guard((id, data) => store.updateClient(id, requireValid(validateClient(data)))),
    deleteClient: guard((id) => store.deleteClient(id)),
    listContents: guard((filters = {}) => store.listContents(validateContentFilters(filters))),
    getContent: guard((id) => store.getContent(id)),
    createContent: guard((data) => store.createContent(requireValid(validateContent(data)))),
    updateContent: guard((id, data) => store.updateContent(id, requireValid(validateContent(data)))),
    deleteContent: guard((id) => store.deleteContent(id))
  };
}
