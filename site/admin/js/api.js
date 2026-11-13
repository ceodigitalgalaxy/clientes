/* Conexão da tela com o banco (Supabase), com a sessão de quem entrou.
   Valida os dados antes de enviar (domain/rules.js); o banco confere de novo
   com as próprias regras e só aceita membros da equipe (RLS). */

import { validateClient, validateContent, validateContentFilters, parseUsername, passwordProblem, CONTENT_STATUS, PRODUCTION_STATUS, isUuid, validateAd, validateAdFilters, AD_LIMITS, validateBrandKit, validateBatch, validateMember } from "./domain/rules.js?v=b28509c2bb";
import { UPLOAD_LIMITS, fileName, fileProblem, resizeImage } from "../../js/lib/storage.js?v=b28509c2bb";

export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

function requireValidMember(result) {
  requireValid(result);
  return result;
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
export function createApi({ store, onSessionLost, access = null, storage = null, team = null }) {
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
  const callAccess = (body) => callFunction(access, body);
  /* Logins da equipe: pela função equipe (só administrador) */
  const callTeam = (body) => callFunction(team, body);
  async function callFunction(access, body, retry = true) {
    if (!access) throw new ApiError(500, "Esta ação não está disponível aqui.");
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
    if (response.status === 401 && retry) { await access.refresh(); return callFunction(access, body, false); }
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

  /* ---------- Anúncios ---------- */
  const AD_BUCKET = "ad-media";
  /** Links assinados (1 hora) para os arquivos do criativo */
  async function signAdPaths(paths) {
    const list = [...new Set(paths.filter(Boolean))];
    return storage && list.length ? storage.sign(AD_BUCKET, list) : {};
  }
  const withSrc = (assets, signed) => assets.map((a) => ({ ...a, src: a.url || signed[a.storage_path] || null }));

  async function adWithSources(ad) {
    const signed = await signAdPaths(ad.assets.map((a) => a.storage_path));
    return { ...ad, assets: withSrc(ad.assets, signed) };
  }

  const ads = {
    /** Lista com a capa (primeiro item do criativo) já com link */
    listAds: guard(async (filters = {}) => {
      const rows = await store.listAds(validateAdFilters(filters));
      const signed = await signAdPaths(rows.map((ad) => ad.assets[0]?.storage_path));
      return rows.map((ad) => ({ ...ad, assets: withSrc(ad.assets, signed) }));
    }),
    getAd: guard(async (id) => adWithSources(await store.getAd(id))),
    createAd: guard((data) => store.createAd(requireValid(validateAd(data)))),
    updateAd: guard((id, data) => store.updateAd(id, requireValid(validateAd(data)))),
    /** Só rascunhos nunca enviados (o banco recusa os demais); apaga os arquivos depois */
    deleteAd: guard(async (ad) => {
      await store.deleteAd(ad.id);
      const paths = (ad.assets || []).map((a) => a.storage_path).filter(Boolean);
      if (paths.length) await storage.remove(AD_BUCKET, paths).catch(() => {});
    }),
    setAdsStage: guard((ids, stage) => {
      if (!["referencia", "final"].includes(stage)) throw new ApiError(422, "Tipo de criativo inválido.");
      const unique = [...new Set(ids)];
      if (!unique.length || unique.length > 500 || !unique.every(isUuid)) throw new ApiError(422, "Seleção inválida.");
      return store.setAdsStage(unique, stage);
    }),
    adTransition: guard((id, action, message = "") => {
      const text = String(message || "").trim();
      if (text.length > AD_LIMITS.message) throw new ApiError(422, `Use até ${AD_LIMITS.message} caracteres.`);
      return store.adTransition(id, action, text || null);
    }),
    addAdAssetFile: guard(async (ad, file, { position, onProgress } = {}) => {
      const problem = fileProblem(file, { types: UPLOAD_LIMITS.mediaTypes, maxBytes: UPLOAD_LIMITS.mediaBytes });
      if (problem) throw new ApiError(422, problem);
      const path = `${ad.client_id}/${ad.id}/${fileName(file.type)}`;
      await storage.upload(AD_BUCKET, path, file, { onProgress });
      try {
        return await store.addAdAsset({ ad_id: ad.id, kind: file.type.startsWith("video/") ? "video" : "image", storage_path: path, position });
      } catch (error) {
        await storage.remove(AD_BUCKET, [path]).catch(() => {});
        throw error;
      }
    }),
    addAdAssetLink: guard(async (ad, { url, kind, position }) => {
      const value = String(url || "").trim();
      if (!isLink(value)) throw new ApiError(422, "Use um link que comece com https://", { asset_url: "Use um link que comece com https://" });
      return store.addAdAsset({ ad_id: ad.id, kind: kind === "video" ? "video" : "image", url: value, position });
    }),
    swapAdAssets: guard(async (a, b) => {
      await store.moveAdAsset(a.id, b.position);
      await store.moveAdAsset(b.id, a.position);
    }),
    /** Anúncio já enviado: o arquivo fica guardado (as versões antigas continuam com a prévia) */
    deleteAdAsset: guard(async (ad, asset) => {
      const removed = await store.deleteAdAsset(asset.id);
      const path = removed?.storage_path || asset.storage_path;
      if (path && !ad.first_submitted_at) await storage.remove(AD_BUCKET, [path]).catch(() => {});
    }),
    /**
     * Importação de anúncios (planilha): cria cada um como rascunho, liga os links do
     * criativo e envia para aprovação os marcados. Um por vez; o que falhar é informado.
     * @param {Array<{line: number, value: object, creative: Array<{url, kind}>, send: boolean}>} items
     */
    importAds: guard(async (items, { onProgress } = {}) => {
      const report = { created: 0, sent: 0, problems: [] };
      for (const [n, item] of items.entries()) {
        let ad = null;
        try {
          ad = await store.createAd(requireValid(validateAd(item.value)));
          report.created += 1;
          for (const [position, c] of item.creative.entries()) {
            if (!isLink(c.url)) throw new ApiError(422, "Link do criativo inválido.");
            await store.addAdAsset({ ad_id: ad.id, kind: c.kind === "video" ? "video" : "image", url: c.url, position });
          }
          if (item.send && item.creative.length) { await store.adTransition(ad.id, "enviar", null); report.sent += 1; }
        } catch (error) {
          if (error?.status === 401) throw error;
          report.problems.push({ line: item.line, title: item.value.title, message: ad ? `Criado como rascunho, mas: ${error.message}` : error.message });
        }
        onProgress?.((n + 1) / items.length);
      }
      return report;
    }),
    /** Histórico e versões (com links para a prévia de cada versão) */
    adHistory: guard(async (id) => {
      const [events, versions] = await Promise.all([store.listAdEvents(id), store.listAdVersions(id)]);
      const signed = await signAdPaths(versions.flatMap((v) => (v.snapshot?.assets || []).map((a) => a.storage_path)));
      return { events, versions: versions.map((v) => ({ ...v, snapshot: { ...v.snapshot, assets: withSrc(v.snapshot?.assets || [], signed) } })) };
    })
  };

  /* ---------- Central de aprovação ---------- */
  const ids = (list, label = "Seleção inválida.") => {
    const unique = [...new Set(list || [])];
    if (unique.length > 200 || !unique.every(isUuid)) throw new ApiError(422, label);
    return unique;
  };
  const expiresOf = (date) => {
    if (!date) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(422, "Data de expiração inválida.", { expires_at: "Data inválida." });
    const end = new Date(`${date}T23:59:59`);
    if (!(end > new Date())) throw new ApiError(422, "A data de expiração precisa ser no futuro.", { expires_at: "Escolha uma data no futuro." });
    return end.toISOString();
  };
  /** Arquivos das versões enviadas, com link assinado (equipe) */
  async function signView(view) {
    const paths = (view.items || []).flatMap((i) => (i.content?.assets || []).map((a) => a.storage_path)).filter(Boolean);
    const signed = storage && paths.length ? await storage.sign("content-media", [...new Set(paths)]) : {};
    return {
      ...view,
      client: { name: view.client?.name || "", logo: view.client?.logo_path && storage ? storage.publicUrl("client-logos", view.client.logo_path) : null },
      items: (view.items || []).map((i) => ({ ...i, content: i.content ? { ...i.content, assets: (i.content.assets || []).map(({ storage_path, url, ...a }) => ({ ...a, src: url || signed[storage_path] || null, file: Boolean(storage_path) })) } : null }))
    };
  }
  const approvals = {
    listBatches: guard((filters = {}) => store.listBatches(isUuid(filters.client_id) ? { client_id: filters.client_id } : {})),
    createBatch: guard((data) => store.createBatch(requireValid(validateBatch(data)))),
    updateBatch: guard((id, data) => store.updateBatch(id, requireValid(validateBatch(data, { requireClient: false })))),
    setBatchOptions: guard((id, { allow_individual, allow_bulk }) => {
      if (!allow_individual && !allow_bulk) throw new ApiError(422, "Deixe o cliente aprovar de pelo menos um jeito (individual ou em lote).");
      return store.updateBatch(id, { allow_individual: Boolean(allow_individual), allow_bulk: Boolean(allow_bulk) });
    }),
    archiveBatch: guard((id, archived) => store.updateBatch(id, { archived_at: archived ? new Date().toISOString() : null })),
    deleteBatch: guard((id) => store.deleteBatch(id)),
    /** Tudo do lote para gerenciar: itens, versões enviadas, decisões e histórico */
    batchDetail: guard(async (batchId) => {
      const [items, decisions, events, staleRows] = await Promise.all([store.listBatchItems(batchId), store.listDecisions({ batchId }), store.listEvents({ batchId }),
        store.approvalRpc("approval_stale", { p_batch: batchId }).catch(() => [])]);
      const versions = await store.listVersions({ ids: [...new Set(items.map((i) => i.version_id).filter(Boolean))] });
      // Itens cujo conteúdo mudou (só nos campos daquela etapa) depois do envio
      const stale = new Set((staleRows || []).filter((r) => r.stale).map((r) => r.item_id));
      return { items, decisions, events, versions, stale };
    }),
    setBatchItems: guard((batchId, contentIds) => store.approvalRpc("approval_set_items", { p_batch: batchId, p_contents: ids(contentIds, "Seleção de conteúdos inválida.") })),
    /** "Gerar link para aprovação": envia os escolhidos e devolve o token do link */
    publishBatch: guard(async (batchId, { items, title, intro, mode, expiresOn = null, allowIndividual = true, allowBulk = true, regenerate = false }) => {
      const fields = {};
      const chosen = ids(items, "Seleção de conteúdos inválida.");
      if (!chosen.length) fields.items = "Escolha pelo menos um conteúdo.";
      if (!String(title || "").trim()) fields.title = "Dê um título ao lote.";
      if (String(intro || "").length > 1000) fields.intro = "Use até 1.000 caracteres.";
      if (!allowIndividual && !allowBulk) fields.allow_individual = "Deixe o cliente aprovar de pelo menos um jeito.";
      if (Object.keys(fields).length) throw new ApiError(422, "Revise os campos destacados.", fields);
      return store.approvalRpc("approval_publish", { p_batch: batchId, p_items: chosen, p_title: String(title).trim().slice(0, 120), p_intro: String(intro || "").trim() || null,
        p_mode: mode === "final" ? "final" : "planejamento", p_expires: expiresOf(expiresOn), p_allow_individual: Boolean(allowIndividual), p_allow_bulk: Boolean(allowBulk), p_regenerate: Boolean(regenerate) });
    }),
    resendItems: guard((batchId, itemIds) => store.approvalRpc("approval_resend", { p_batch: batchId, p_items: ids(itemIds) })),
    linkToken: guard((batchId) => store.approvalRpc("approval_link_token", { p_batch: batchId })),
    regenerateLink: guard((batchId, expiresOn = null) => store.approvalRpc("approval_link_regenerate", { p_batch: batchId, p_expires: expiresOf(expiresOn) })),
    revokeLink: guard((batchId) => store.approvalRpc("approval_link_revoke", { p_batch: batchId })),
    previewBatch: guard(async (batchId) => signView(await store.approvalRpc("approval_preview", { p_batch: batchId }))),
    unreadEvents: guard(() => store.listEvents({ unread: true })),
    markRead: guard((eventIds = null) => store.approvalRpc("approval_mark_read", { p_ids: eventIds ? ids(eventIds) : null }))
  };

  return {
    ...ads,
    ...approvals,
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
    /* ---------- Gerador de artes: identidade do cliente ---------- */
    brandKit: guard((clientId) => store.getBrandKit(clientId)),
    saveBrandKit: guard(async (client, input) => store.saveBrandKit({ client_id: client.id, ...requireValid(validateBrandKit(input)) })),
    /** Logo da identidade: mantém a transparência, até 1200 px, no bucket público client-logos */
    uploadBrandLogo: guard(async (client, slot, file) => {
      const problem = fileProblem(file, { types: UPLOAD_LIMITS.logoTypes, maxBytes: 10 * 1024 * 1024 });
      if (problem) throw new ApiError(422, problem, { [`logo_${slot}`]: problem });
      const small = await resizeImage(file, 1200);
      const path = `${client.id}/marca-${slot}-${fileName(small.type)}`;
      await storage.upload("client-logos", path, small);
      return path;
    }),
    removeBrandFiles: guard(async (paths) => { if (paths.length) await storage.remove("client-logos", paths).catch(() => {}); }),
    removeClientLogo: guard(async (client) => {
      await store.setClientLogo(client.id, null);
      if (client.logo_path) await storage.remove("client-logos", [client.logo_path]).catch(() => {});
    }),

    listAssets: guard((contentId) => assetsWithSources(contentId)),
    /** Envia um arquivo da arte final (imagem ou vídeo) para o fim do carrossel */
    addAssetFile: guard(async (content, file, { position, onProgress, role = "midia" } = {}) => {
      const problem = fileProblem(file, { types: UPLOAD_LIMITS.contentTypes, maxBytes: UPLOAD_LIMITS.mediaBytes });
      if (problem) throw new ApiError(422, problem);
      const path = `${content.client_id}/${content.id}/${fileName(file.type)}`;
      await storage.upload("content-media", path, file, { onProgress });
      const kind = file.type === "application/pdf" ? "pdf" : file.type.startsWith("video/") ? "video" : "image";
      const name = String(file.name || "").replace(/[\u0000-\u001f]/g, "").slice(0, 160) || null;
      try {
        return await store.addAsset({ content_id: content.id, kind, role: kind === "pdf" ? "midia" : role, name, storage_path: path, position });
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
    /** Capa, thumbnail do vídeo ou mídia comum (galeria/carrossel) */
    setAssetRole: guard((asset, role) => {
      if (!["midia", "capa", "thumbnail"].includes(role)) throw new ApiError(422, "Papel do arquivo inválido.");
      return store.setAssetRole(asset.id, role);
    }),
    /** O arquivo só sai do armazenamento se nenhuma versão enviada ao cliente usar */
    deleteAsset: guard(async (asset) => {
      const removed = await store.deleteAsset(asset.id);
      const path = removed?.storage_path || asset.storage_path;
      if (!path) return;
      const inHistory = await store.approvalRpc("media_in_history", { p_path: path }).catch(() => true);
      if (!inHistory) await storage.remove("content-media", [path]).catch(() => {});
    }),
    moveContent: guard((contentId, date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new ApiError(422, "Data inválida.");
      return store.moveContent(contentId, date);
    }),
    setContentProduction: guard((contentId, production) => {
      if (production !== null && !PRODUCTION_STATUS[production]) throw new ApiError(422, "Etapa de produção inválida.");
      return store.setContentProduction(contentId, production);
    }),
    /** Versões enviadas e decisões do cliente pelo link (mais recentes primeiro) */
    contentApprovalHistory: guard(async (contentId) => {
      const [versions, decisions, legacy, stale] = await Promise.all([
        store.listVersions({ contentId }), store.listDecisions({ contentId }), store.listApprovals(contentId).catch(() => []),
        store.approvalRpc("approval_stale", { p_content: contentId }).catch(() => [])
      ]);
      return { versions, decisions, legacy, stale: stale || [] };
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
    getProfile: guard((userId) => store.getProfile(userId)),

    /* ---------- Equipe (só administrador; o banco e a função conferem) ---------- */
    teamDirectory: guard(() => store.teamDirectory()),
    createMember: guard((data) => {
      const { value, clientIds, errors } = validateMember(data);
      const username = parseUsername(data.username);
      if (!username) errors.username = "Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.";
      const problem = passwordProblem(data.password, username || "");
      if (problem) errors.password = problem;
      requireValid({ value, errors });
      return callTeam({ action: "criar", username, password: data.password, ...value, client_ids: clientIds });
    }),
    updateMember: guard(async (userId, data, currentClientIds = []) => {
      const { value, clientIds } = requireValidMember(validateMember(data));
      const saved = await store.updateMember(userId, value);
      await store.setMemberClients(userId, value.all_clients ? [] : clientIds, currentClientIds);
      return saved;
    }),
    setMemberActive: guard((userId, active) => callTeam({ action: "acesso", user_id: userId, active: Boolean(active) })),
    setMemberPassword: guard((userId, password) => {
      const problem = passwordProblem(password, "");
      if (problem) throw new ApiError(422, "Revise os campos destacados.", { password: problem });
      return callTeam({ action: "senha", user_id: userId, password });
    }),

    /* ---------- Tarefa: responsáveis e histórico ---------- */
    /** Grava só a diferença entre os responsáveis atuais e os escolhidos */
    setAssignees: guard(async (contentId, next = [], current = []) => {
      const wanted = [...new Set(next)].filter(isUuid);
      await store.removeAssignees(contentId, current.filter((id) => !wanted.includes(id)));
      await store.addAssignees(contentId, wanted.filter((id) => !current.includes(id)));
      return wanted;
    }),
    listAssignees: guard((contentId) => store.listAssignees(contentId)),
    contentEvents: guard((contentId) => store.listContentEvents(contentId)),
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
