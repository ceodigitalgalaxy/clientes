/* Conexão da tela com o banco (Supabase), com a sessão de quem entrou.
   Valida os dados antes de enviar (domain/rules.js); o banco confere de novo
   com as próprias regras e só aceita membros da equipe (RLS). */

import { validateClient, validateContent, validateContentFilters, parseUsername, passwordProblem } from "./domain/rules.js";

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
 * @param {object} [options.access]  função acesso-cliente (logins de cliente), com a sessão da equipe
 * @param {string} options.access.url        endereço da função
 * @param {string} options.access.apiKey     chave publicável
 * @param {() => Promise<string>} options.access.getToken
 * @param {() => Promise<unknown>} options.access.refresh
 */
export function createApi({ store, onSessionLost, access = null }) {
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

  /* Logins de cliente: pela função acesso-cliente (a chave secreta fica no servidor) */
  async function callAccess(body, retry = true) {
    if (!access) throw new ApiError(500, "Gerenciar acessos não está disponível aqui.");
    const token = await access.getToken();
    let response;
    try {
      response = await fetch(access.url, {
        method: "POST",
        headers: { apikey: access.apiKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      throw new ApiError(503, "Não foi possível conectar. Verifique a internet e tente de novo.");
    }
    if (response.status === 401 && retry) { await access.refresh(); return callAccess(body, false); }
    const data = await response.json().catch(() => null);
    if (response.status === 401) throw Object.assign(new Error(data?.error || "Sua sessão expirou. Entre de novo."), { status: 401 });
    if (!response.ok) throw new ApiError(response.status, data?.error || "Não foi possível concluir agora. Tente de novo.", data?.fields);
    return data;
  }

  /** Mesmas regras da função, antes de enviar */
  function checkAccess({ username, password }, { needUsername = true } = {}) {
    const fields = {};
    const user = parseUsername(username);
    if (needUsername && !user) fields.username = "Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.";
    const problem = passwordProblem(password, user || "");
    if (problem) fields.password = problem;
    if (Object.keys(fields).length) throw new ApiError(422, "Revise os campos destacados.", fields);
    return user;
  }

  return {
    createClientAccess: guard((clientId, data) => callAccess({ action: "criar", client_id: clientId, username: checkAccess(data), password: data.password })),
    setClientPassword: guard((username, password) => callAccess({ action: "senha", username: checkAccess({ username, password }), password })),
    removeClientAccess: guard((username) => callAccess({ action: "remover", username })),
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
