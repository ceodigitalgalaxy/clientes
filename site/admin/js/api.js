/* Conexão da tela com o banco (Supabase), com a sessão de quem entrou.
   Valida os dados antes de enviar (domain/rules.js); o banco confere de novo
   com as próprias regras e só aceita membros da equipe (RLS). */

import { validateClient, validateContent, validateContentFilters, parseUsername, passwordProblem, CONTENT_STATUS, isUuid } from "./domain/rules.js";
import { UPLOAD_LIMITS, fileName, fileProblem, resizeImage } from "../../js/lib/storage.js";

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
 * @param {ReturnType<import("../../js/lib/storage.js").createStorage>} [options.storage]  arquivos (foto e arte final)
 */
export function createApi({ store, onSessionLost, access = null, storage = null }) {
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

  const isLink = (value) => { try { return ["http:", "https:"].includes(new URL(value).protocol) && value.length <= 2000; } catch { return false; } };

  /** Arte final com os links (assinados) para mostrar no painel */
  async function assetsWithSources(contentId) {
    const assets = await store.listAssets(contentId);
    const signed = storage ? await storage.sign("content-media", assets.map((a) => a.storage_path)) : {};
    return assets.map((a) => ({ ...a, src: a.url || signed[a.storage_path] || null }));
  }

  return {
    logoUrl: (path) => (storage && path ? storage.publicUrl("client-logos", path) : null),

    /** Foto do cliente: diminui no navegador, envia e troca a antiga */
    setClientLogo: guard(async (client, file) => {
      const problem = fileProblem(file, { types: UPLOAD_LIMITS.logoTypes, maxBytes: 10 * 1024 * 1024 });
      if (problem) throw new ApiError(422, problem, { logo: problem });
      const small = await resizeImage(file, 512);
      const path = `${client.id}/${fileName(small.type)}`;
      await storage.upload("client-logos", path, small);
      try {
        await store.setClientLogo(client.id, path);
      } catch (error) {
        await storage.remove("client-logos", [path]).catch(() => {});
        throw error;
      }
      if (client.logo_path) await storage.remove("client-logos", [client.logo_path]).catch(() => {});
      return path;
    }),
    removeClientLogo: guard(async (client) => {
      await store.setClientLogo(client.id, null);
      if (client.logo_path) await storage.remove("client-logos", [client.logo_path]).catch(() => {});
    }),

    listAssets: guard((contentId) => assetsWithSources(contentId)),
    /** Envia um arquivo da arte final (imagem ou vídeo) para o fim do carrossel */
    addAssetFile: guard(async (content, file, { position, onProgress } = {}) => {
      const problem = fileProblem(file, { types: UPLOAD_LIMITS.mediaTypes, maxBytes: UPLOAD_LIMITS.mediaBytes });
      if (problem) throw new ApiError(422, problem);
      const path = `${content.client_id}/${content.id}/${fileName(file.type)}`;
      await storage.upload("content-media", path, file, { onProgress });
      try {
        return await store.addAsset({ content_id: content.id, kind: file.type.startsWith("video/") ? "video" : "image", storage_path: path, position });
      } catch (error) {
        await storage.remove("content-media", [path]).catch(() => {});
        throw error;
      }
    }),
    addAssetLink: guard(async (content, { url, kind, position }) => {
      const value = String(url || "").trim();
      if (!isLink(value)) throw new ApiError(422, "Use um link que comece com https://", { asset_url: "Use um link que comece com https://" });
      return store.addAsset({ content_id: content.id, kind: kind === "video" ? "video" : "image", url: value, position });
    }),
    /** Troca a posição de dois itens do carrossel */
    swapAssets: guard(async (a, b) => {
      await store.moveAsset(a.id, b.position);
      await store.moveAsset(b.id, a.position);
    }),
    deleteAsset: guard(async (asset) => {
      const removed = await store.deleteAsset(asset.id);
      const path = removed?.storage_path || asset.storage_path;
      if (path) await storage.remove("content-media", [path]).catch(() => {});
    }),
    listApprovals: guard((contentId) => store.listApprovals(contentId)),
    sendForApproval: guard((contentId) => store.setContentStatus(contentId, "aguardando_aprovacao")),
    setContentStatus: guard((contentId, status) => store.setContentStatus(contentId, status)),
    /** Troca em massa: só status conhecido e ids válidos (até 500 por vez) */
    setContentsStatus: guard((ids, status) => {
      const unique = [...new Set(ids)];
      if (!CONTENT_STATUS[status]) throw new ApiError(422, "Escolha um status válido.");
      if (!unique.length) throw new ApiError(422, "Selecione pelo menos um conteúdo.");
      if (unique.length > 500 || !unique.every(isUuid)) throw new ApiError(422, "Seleção inválida. Recarregue a lista e tente de novo.");
      return store.setContentsStatus(unique, status);
    }),
    /** Importação: todos válidos ou nada (uma gravação só) */
    createContents: guard((rows) => store.createContents(rows.map((row) => requireValid(validateContent(row))))),

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
