/* ==========================================================================
   Armazenamento no Supabase (PostgreSQL), via API REST (PostgREST)
   --------------------------------------------------------------------------
   Dois modos, com o mesmo código:
   - Navegador (painel publicado): chave PUBLICÁVEL + sessão de quem entrou
     (getToken). O banco só entrega dados a membros da equipe (RLS).
   - Comandos locais (admin/verify.mjs): chave SECRETA, que ignora o RLS.
     Ela fica só em admin/.env, no computador da agência, nunca no navegador.

   Todos os métodos recebem dados já validados (rules.js) e devolvem objetos
   simples. Erros do banco viram StoreError com status HTTP e mensagem em
   português.
   ========================================================================== */

export class StoreError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CLIENT_FIELDS = "id,name,slug,segment,contact_name,contact_email,notes,active,logo_path,created_at,updated_at";
const AD_FIELDS = "id,client_id,title,campaign_context,objective,platform,platform_other,format,creative_stage,primary_text,headline,description,cta,destination_url,client_notes,internal_notes,status,version,submitted_at,submitted_by,first_submitted_at,created_by,created_at,updated_at";
const TASK_FIELDS = "id,parent_id,client_id,project_id,content_id,title,description,status,column_id,priority,due_at,position,created_by,completed_at,completed_by,archived_at,version,created_at,updated_at";
const MEMBER_FIELDS = "user_id,role,active,name,email,job_title,all_clients,edit_scope,can_send_approval";
const AD_ASSET_FIELDS = "id,ad_id,kind,storage_path,url,position,created_at";

/** Recusas das funções do fluxo de anúncios (raise exception) em português */
export const AD_ERRORS = {
  sem_criativo: "Arte final precisa de pelo menos um arquivo ou link. Para mandar só a ideia, marque como Referência e escreva o escopo.",
  sem_escopo: "Escreva o escopo, a ideia e as referências (ou anexe um arquivo/link) antes de enviar.",
  anuncio_bloqueado: "Este anúncio está com o cliente (ou já foi aprovado/arquivado). Recolha ou reabra para editar.",
  use_fluxo_do_anuncio: "O status muda só pelos botões do anúncio.",
  cliente_fixo: "Depois do primeiro envio, o anúncio não muda de cliente.",
  anuncio_com_historico: "Este anúncio já foi enviado ao cliente e tem histórico. Arquive em vez de excluir.",
  transicao_invalida: "Esta ação não vale para o status atual do anúncio. Atualize a página.",
  anuncio_nao_encontrado: "Anúncio não encontrado. Ele pode ter sido excluído.",
  sem_permissao: "Seu usuário não tem permissão para fazer isso.",
  sem_permissao_aprovacao: "Seu usuário não pode mudar o status de aprovação. Peça a um administrador.",
  sem_permissao_arquivar: "Só quem criou a demanda ou um administrador pode arquivá-la.",
  subtarefa_de_subtarefa: "Uma subtarefa não pode ter outra subtarefa dentro.",
  nao_pode_proprio_acesso: "Você não pode tirar o seu próprio acesso de administrador.",
  ultimo_admin: "A agência precisa de pelo menos um administrador ativo.",
  mensagem_longa: "A mensagem passou do limite de 1000 caracteres.",
  // Central de aprovação
  lote_nao_encontrado: "Lote não encontrado. Ele pode ter sido apagado.",
  lote_arquivado: "Este lote está arquivado. Reative para mexer nele.",
  nada_para_enviar: "Escolha pelo menos um conteúdo para o cliente revisar.",
  final_sem_conteudo: "Para a aprovação final, cada conteúdo precisa de arte (ou vídeo/arquivo) ou legenda. Complete o que falta e envie de novo.",
  modo_travado: "Este lote já foi enviado: o tipo de aprovação (ideia ou final) não muda mais. Crie outro lote para a outra etapa.",
  conteudo_de_outro_cliente: "Só dá para incluir conteúdos do mesmo cliente do lote.",
  conteudos_demais: "Use até 200 conteúdos por lote.",
  expiracao_no_passado: "A data de expiração precisa ser no futuro."
};
const CONTENT_FIELDS = "id,client_id,title,scheduled_date,scheduled_time,network,format,media_url,media_kind,pillar,idea,content_plan,art_text,objective,caption,hashtags,cta,internal_notes,client_notes,planning_notes,status,approval_status,final_status,production_status,due_date,priority,version,created_at,updated_at";
const ASSET_FIELDS = "id,content_id,kind,role,name,storage_path,url,position,created_at";

/** Traduz erros do PostgREST/PostgreSQL para mensagens do painel */
function translate(status, body, withSession) {
  const code = body && body.code;
  if (code === "P0001" && AD_ERRORS[body.message]) return new StoreError(409, AD_ERRORS[body.message], body.message);
  if (code === "23505") return new StoreError(409, "Já existe um cliente com esse identificador. Escolha outro.", code);
  if (code === "23503") return new StoreError(409, "Este cliente tem conteúdos ou anúncios cadastrados e não pode ser excluído. Você pode inativá-lo.", code);
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") return new StoreError(400, "Algum campo está fora do formato aceito. Revise e tente de novo.", code);
  if (code === "PGRST116") return new StoreError(404, "Registro não encontrado. Ele pode ter sido excluído.", code);
  if (withSession && status === 401) return new StoreError(401, "Sua sessão expirou. Entre de novo.", "session_expired");
  if (withSession && (status === 403 || code === "42501")) return new StoreError(403, "Seu usuário não tem permissão para fazer isso.", code);
  if (status === 401 || status === 403) return new StoreError(502, "O banco recusou o acesso. Confira a chave secreta em admin/.env.", code);
  return new StoreError(502, "O banco de dados não respondeu como esperado. Tente de novo em instantes.", code);
}

/**
 * @param {object} options
 * @param {string} options.url        endereço do projeto Supabase
 * @param {string} options.apiKey     chave publicável (navegador) ou secreta (comandos locais)
 * @param {() => Promise<string>} [options.getToken]   sessão de quem entrou (só no navegador)
 * @param {() => Promise<unknown>} [options.onUnauthorized]  renova a sessão depois de um 401
 */
export function createSupabaseStore({ url, apiKey, secretKey, getToken, onUnauthorized, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const key = apiKey || secretKey;
  if (!key) throw new Error("createSupabaseStore: informe a chave (apiKey).");
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const withSession = typeof getToken === "function";
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Chave legada (JWT "service_role") também vai no Authorization
  if (!withSession && key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  async function request(path, { method = "GET", body, single = false, prefer } = {}, retry = true) {
    // Sem sessão válida, getToken falha antes de qualquer pedido ao banco
    const auth = withSession ? { Authorization: `Bearer ${await getToken()}` } : {};
    let response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method,
        headers: {
          ...headers,
          ...auth,
          ...(single ? { Accept: "application/vnd.pgrst.object+json" } : {}),
          ...(prefer ? { Prefer: prefer } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new StoreError(503, "Não foi possível conectar ao banco de dados. Verifique a internet e tente de novo.");
    }
    // Sessão vencida no meio do caminho: renova uma vez e repete o pedido
    if (response.status === 401 && withSession && retry && onUnauthorized) {
      await onUnauthorized();
      return request(path, { method, body, single, prefer }, false);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw translate(response.status, data, withSession);
    return data;
  }

  const enc = encodeURIComponent;

  return {
    kind: "supabase",

    async listClients() {
      // contents(count): quantidade de conteúdos de cada cliente; client_members: logins do portal
      const rows = await request(`clients?select=${CLIENT_FIELDS},contents(count),client_members(username)&order=name.asc`);
      return rows.map(({ contents, client_members: members, ...client }) => ({
        ...client,
        contents_count: contents?.[0]?.count ?? 0,
        portal_users: (members || []).map((m) => m.username).sort()
      }));
    },

    async getClient(id) {
      return request(`clients?select=${CLIENT_FIELDS}&id=eq.${enc(id)}`, { single: true });
    },

    async createClient(value) {
      return request(`clients?select=${CLIENT_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },

    async updateClient(id, value) {
      return request(`clients?select=${CLIENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },

    async deleteClient(id) {
      await request(`clients?select=id&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },

    async listContents(filters = {}) {
      // content_assets(count): quantos itens de arte final cada conteúdo tem
      const query = [`select=${CONTENT_FIELDS},content_assets(count),content_assignees(user_id)`, "order=scheduled_date.asc,scheduled_time.asc.nullslast,created_at.asc"];
      if (filters.client_id) query.push(`client_id=eq.${enc(filters.client_id)}`);
      if (filters.status) query.push(`status=eq.${enc(filters.status)}`);
      if (filters.from) query.push(`scheduled_date=gte.${enc(filters.from)}`);
      if (filters.to) query.push(`scheduled_date=lte.${enc(filters.to)}`);
      const rows = await request(`contents?${query.join("&")}`);
      return rows.map(({ content_assets: assets, content_assignees: people, ...row }) => ({ ...row, assets_count: assets?.[0]?.count ?? 0, assignees: (people || []).map((p) => p.user_id) }));
    },

    /** Vários conteúdos de uma vez (importação): tudo ou nada, numa única gravação */
    async createContents(values) {
      return request(`contents?select=${CONTENT_FIELDS}`, { method: "POST", body: values, prefer: "return=representation" });
    },

    /** Só o status (ex.: "Enviar para aprovação"); não muda a versão */
    async setContentStatus(id, status) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { status }, single: true, prefer: "return=representation" });
    },

    /** Mesmo status para vários conteúdos de uma vez (uma gravação só) */
    async setContentsStatus(ids, status) {
      return request(`contents?select=${CONTENT_FIELDS}&id=in.(${ids.map(enc).join(",")})`, { method: "PATCH", body: { status }, prefer: "return=representation" });
    },

    /** Foto do cliente (caminho no bucket client-logos, ou null para tirar) */
    async setClientLogo(id, logoPath) {
      return request(`clients?select=${CLIENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { logo_path: logoPath }, single: true, prefer: "return=representation" });
    },

    /* Identidade do cliente para o gerador de artes (brand_kits) */
    async getBrandKit(clientId) {
      const rows = await request(`brand_kits?select=client_id,enabled,colors,logos,units,campaigns,models,legal,updated_at&client_id=eq.${enc(clientId)}`);
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    },
    async saveBrandKit(row) {
      return request("brand_kits?on_conflict=client_id", { method: "POST", body: row, single: true, prefer: "resolution=merge-duplicates,return=representation" });
    },

    /* Arte final (content_assets): arquivos ou links, na ordem do carrossel */
    async listAssets(contentId) {
      return request(`content_assets?select=${ASSET_FIELDS}&content_id=eq.${enc(contentId)}&order=position.asc,created_at.asc`);
    },
    async addAsset(value) {
      return request(`content_assets?select=${ASSET_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async setAssetRole(id, role) {
      return request(`content_assets?select=${ASSET_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { role }, single: true, prefer: "return=representation" });
    },
    async setContentProduction(id, production) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { production_status: production }, single: true, prefer: "return=representation" });
    },
    /** Só a data (arrastar no calendário): o resto do conteúdo não muda */
    async moveContent(id, date) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: { scheduled_date: date }, single: true, prefer: "return=representation" });
    },
    async moveAsset(id, position) {
      return request(`content_assets?select=id,position&id=eq.${enc(id)}`, { method: "PATCH", body: { position }, single: true, prefer: "return=representation" });
    },
    async deleteAsset(id) {
      return request(`content_assets?select=id,storage_path&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },

    /** Histórico de decisões do cliente, mais recente primeiro */
    async listApprovals(contentId) {
      return request(`content_approvals?select=id,version,decision,message,created_at&content_id=eq.${enc(contentId)}&order=created_at.desc`);
    },

    async getContent(id) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { single: true });
    },

    async createContent(value) {
      return request(`contents?select=${CONTENT_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },

    async updateContent(id, value) {
      return request(`contents?select=${CONTENT_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },

    /** Exclusão em lote: devolve o que o banco realmente apagou (o RLS só deixa o administrador) */
    async deleteContents(ids) {
      return request(`contents?select=id&id=in.(${ids.map(enc).join(",")})`, { method: "DELETE", prefer: "return=representation" });
    },
    async deleteContent(id) {
      await request(`contents?select=id&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },

    /** Calendário do cliente: só o que ele pode ver (view sem observações internas) */
    async listClientCalendar(clientId, { from, to } = {}) {
      const query = ["select=*", `client_id=eq.${enc(clientId)}`, "order=scheduled_date.asc,scheduled_time.asc.nullslast"];
      if (from) query.push(`scheduled_date=gte.${enc(from)}`);
      if (to) query.push(`scheduled_date=lte.${enc(to)}`);
      return request(`client_calendar_items?${query.join("&")}`);
    },

    /* ---------- Anúncios (aprovação de criativos pagos) ---------- */
    async listAds(filters = {}) {
      const query = [`select=${AD_FIELDS},ad_assets(${AD_ASSET_FIELDS})`, "order=updated_at.desc", "ad_assets.order=position.asc,created_at.asc"];
      if (filters.client_id) query.push(`client_id=eq.${enc(filters.client_id)}`);
      if (filters.status) query.push(`status=eq.${enc(filters.status)}`);
      const rows = await request(`ads?${query.join("&")}`);
      return rows.map(({ ad_assets: assets, ...ad }) => ({ ...ad, assets: assets || [] }));
    },
    async getAd(id) {
      const row = await request(`ads?select=${AD_FIELDS},ad_assets(${AD_ASSET_FIELDS})&id=eq.${enc(id)}&ad_assets.order=position.asc,created_at.asc`, { single: true });
      const { ad_assets: assets, ...ad } = row;
      return { ...ad, assets: assets || [] };
    },
    async createAd(value) {
      return request(`ads?select=${AD_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async updateAd(id, value) {
      return request(`ads?select=${AD_FIELDS}&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },
    /** Só o tipo do criativo, para vários (o banco recusa se algum não estiver editável) */
    async setAdsStage(ids, stage) {
      return request(`ads?select=id,creative_stage&id=in.(${ids.map(enc).join(",")})`, { method: "PATCH", body: { creative_stage: stage }, prefer: "return=representation" });
    },
    async deleteAd(id) {
      await request(`ads?select=id&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },
    /** enviar | recolher | reabrir | arquivar | reativar (o banco confere o status e grava o histórico) */
    async adTransition(id, action, message = null) {
      const rows = await request("rpc/ad_transition", { method: "POST", body: { p_ad_id: id, p_action: action, p_message: message } });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async addAdAsset(value) {
      return request(`ad_assets?select=${AD_ASSET_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async moveAdAsset(id, position) {
      return request(`ad_assets?select=id,position&id=eq.${enc(id)}`, { method: "PATCH", body: { position }, single: true, prefer: "return=representation" });
    },
    async deleteAdAsset(id) {
      return request(`ad_assets?select=id,storage_path&id=eq.${enc(id)}`, { method: "DELETE", single: true, prefer: "return=representation" });
    },
    /** Histórico (mais antigo primeiro) e versões enviadas (mais nova primeiro) */
    async listAdEvents(id) {
      return request(`ad_events?select=id,version,event,from_status,to_status,actor_role,actor_username,message,created_at&ad_id=eq.${enc(id)}&order=created_at.asc`);
    },
    async listAdVersions(id) {
      return request(`ad_versions?select=id,version,snapshot,submitted_at&ad_id=eq.${enc(id)}&order=version.desc`);
    },

    /* ---------- Central de aprovação (lotes, versões, links, decisões) ---------- */
    async listBatches(filters = {}) {
      const query = ["select=*", "order=month.desc,created_at.desc"];
      if (filters.client_id) query.push(`client_id=eq.${enc(filters.client_id)}`);
      return request(`approval_batch_summary?${query.join("&")}`);
    },
    async createBatch(value) {
      return request("approval_batches?select=*", { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async updateBatch(id, value) {
      return request(`approval_batches?select=*&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },
    /** Exclui o lote (mesmo enviado): link desativado, histórico do lote apagado,
        pendentes voltam para rascunho (função approval_batch_delete) */
    async deleteBatch(id) {
      await request("rpc/approval_batch_delete", { method: "POST", body: { p_batch: id } });
      return true;
    },
    async listBatchItems(batchId) {
      return request(`approval_items?select=*&batch_id=eq.${enc(batchId)}&order=display_order.asc,created_at.asc`);
    },
    async listVersions({ contentId, ids } = {}) {
      const query = ["select=id,content_id,version_number,content_version,snapshot,stage,created_at", "order=version_number.desc"];
      if (contentId) query.push(`content_id=eq.${enc(contentId)}`);
      if (ids) { if (!ids.length) return []; query.push(`id=in.(${ids.map(enc).join(",")})`); }
      return request(`content_versions?${query.join("&")}`);
    },
    async listDecisions({ batchId, contentId } = {}) {
      const query = ["select=*", "order=created_at.desc"];
      if (batchId) query.push(`batch_id=eq.${enc(batchId)}`);
      if (contentId) query.push(`content_id=eq.${enc(contentId)}`);
      return request(`approval_decisions?${query.join("&")}`);
    },
    async listEvents({ batchId, contentId, unread } = {}) {
      const query = ["select=*", "order=created_at.desc", "limit=300"];
      if (batchId) query.push(`batch_id=eq.${enc(batchId)}`);
      if (contentId) query.push(`content_id=eq.${enc(contentId)}`);
      if (unread) query.push("read_at=is.null", "actor_type=neq.equipe");
      return request(`approval_events?${query.join("&")}`);
    },
    async approvalRpc(name, body) {
      return request(`rpc/${name}`, { method: "POST", body });
    },

    /** Cadastro da pessoa logada na equipe (perfil e permissões) ou null */
    async getProfile(userId) {
      const rows = await request(`agency_members?select=${MEMBER_FIELDS}&user_id=eq.${enc(userId)}`);
      return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    },
    async isAgencyMember(userId) {
      const profile = await this.getProfile(userId);
      return Boolean(profile && profile.active !== false);
    },

    /* ---------- Ajustes da agência (limites das cores de alerta) ---------- */
    async getSettings() {
      const rows = await request("agency_settings?select=alert_soon_days,alert_urgent_days&id=eq.true");
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async updateSettings(value) {
      return request("agency_settings?select=alert_soon_days,alert_urgent_days&id=eq.true", { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },

    /* ---------- Equipe e tarefas ---------- */
    async teamDirectory() {
      return request("rpc/team_directory", { method: "POST", body: {} });
    },
    async updateMember(userId, value) {
      return request(`agency_members?select=${MEMBER_FIELDS}&user_id=eq.${enc(userId)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },
    /** Troca os clientes liberados (apaga os que saíram e grava os novos) */
    async setMemberClients(userId, clientIds, current = []) {
      const remove = current.filter((id) => !clientIds.includes(id));
      const add = clientIds.filter((id) => !current.includes(id));
      if (remove.length) await request(`agency_member_clients?user_id=eq.${enc(userId)}&client_id=in.(${remove.map(enc).join(",")})`, { method: "DELETE", prefer: "return=minimal" });
      if (add.length) await request("agency_member_clients", { method: "POST", body: add.map((client_id) => ({ user_id: userId, client_id })), prefer: "return=minimal" });
    },
    async listAssignees(contentId) {
      const rows = await request(`content_assignees?select=user_id&content_id=eq.${enc(contentId)}`);
      return rows.map((r) => r.user_id);
    },
    async addAssignees(contentId, userIds) {
      if (!userIds.length) return;
      await request("content_assignees", { method: "POST", body: userIds.map((user_id) => ({ content_id: contentId, user_id })), prefer: "return=minimal" });
    },
    async removeAssignees(contentId, userIds) {
      if (!userIds.length) return;
      await request(`content_assignees?content_id=eq.${enc(contentId)}&user_id=in.(${userIds.map(enc).join(",")})`, { method: "DELETE", prefer: "return=minimal" });
    },
    async listContentEvents(contentId) {
      return request(`content_events?select=id,event_type,actor_name,from_value,to_value,metadata,created_at&content_id=eq.${enc(contentId)}&order=created_at.desc&limit=100`);
    },

    /** Atividade recente (de todos os conteúdos que a pessoa enxerga) */
    async recentEvents(limit = 10) {
      return request(`content_events?select=id,content_id,event_type,actor_name,from_value,to_value,metadata,created_at,contents(title,client_id)&order=created_at.desc&limit=${Number(limit) || 10}`);
    },

    /* ---------- Gestão de demandas (tarefas e subtarefas) ---------- */
    async listTasks({ archived = false } = {}) {
      const query = [`select=${TASK_FIELDS},task_assignees(user_id),task_labels(label_id)`, archived ? "archived_at=not.is.null" : "archived_at=is.null", "order=position.asc", "limit=2000"];
      return request(`tasks?${query.join("&")}`);
    },
    async getTask(id) {
      return request(`tasks?select=${TASK_FIELDS},task_assignees(user_id),task_labels(label_id)&id=eq.${enc(id)}`, { single: true });
    },
    async createTask(value) {
      return request(`tasks?select=${TASK_FIELDS}`, { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    /** Grava só se ninguém salvou antes (version); se outra pessoa salvou, avisa */
    async updateTask(id, version, value) {
      const rows = await request(`tasks?select=${TASK_FIELDS}&id=eq.${enc(id)}&version=eq.${Number(version)}`, { method: "PATCH", body: value, prefer: "return=representation" });
      if (!Array.isArray(rows) || !rows.length) throw new StoreError(409, "Outra pessoa alterou esta demanda agora há pouco. Recarregamos a versão mais nova.", "conflito");
      return rows[0];
    },
    async deleteTask(id) {
      await request(`tasks?id=eq.${enc(id)}`, { method: "DELETE", prefer: "return=minimal" });
    },
    async addTaskAssignees(taskId, ids) {
      if (!ids.length) return;
      await request("task_assignees", { method: "POST", body: ids.map((user_id) => ({ task_id: taskId, user_id })), prefer: "return=minimal" });
    },
    async removeTaskAssignees(taskId, ids) {
      if (!ids.length) return;
      await request(`task_assignees?task_id=eq.${enc(taskId)}&user_id=in.(${ids.map(enc).join(",")})`, { method: "DELETE", prefer: "return=minimal" });
    },
    async addTaskLabels(taskId, ids) {
      if (!ids.length) return;
      await request("task_labels", { method: "POST", body: ids.map((label_id) => ({ task_id: taskId, label_id })), prefer: "return=minimal" });
    },
    async removeTaskLabels(taskId, ids) {
      if (!ids.length) return;
      await request(`task_labels?task_id=eq.${enc(taskId)}&label_id=in.(${ids.map(enc).join(",")})`, { method: "DELETE", prefer: "return=minimal" });
    },
    async listTaskEvents(taskId) {
      return request(`task_events?select=id,event_type,actor_name,from_value,to_value,metadata,created_at&task_id=eq.${enc(taskId)}&order=created_at.desc&limit=200`);
    },
    async listColumns() {
      return request("board_columns?select=id,name,status,color,position,hidden&order=position.asc");
    },
    async createColumn(value) {
      return request("board_columns?select=id,name,status,color,position,hidden", { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async updateColumn(id, value) {
      return request(`board_columns?select=id,name,status,color,position,hidden&id=eq.${enc(id)}`, { method: "PATCH", body: value, single: true, prefer: "return=representation" });
    },
    async deleteColumn(id) {
      await request(`board_columns?id=eq.${enc(id)}`, { method: "DELETE", prefer: "return=minimal" });
    },
    async listLabels() {
      return request("labels?select=id,name,color,archived_at&order=name.asc");
    },
    async createLabel(value) {
      return request("labels?select=id,name,color,archived_at", { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async listProjects() {
      return request("projects?select=id,client_id,name,status,archived_at&order=name.asc");
    },
    async createProject(value) {
      return request("projects?select=id,client_id,name,status,archived_at", { method: "POST", body: value, single: true, prefer: "return=representation" });
    },

    /* ---------- Comentários internos e avisos ---------- */
    async listComments(contentId) {
      return request(`content_comments?select=id,author_id,author_name,body,mentions,created_at&content_id=eq.${enc(contentId)}&order=created_at.asc&limit=200`);
    },
    async addComment(value) {
      return request("content_comments?select=id,author_id,author_name,body,mentions,created_at", { method: "POST", body: value, single: true, prefer: "return=representation" });
    },
    async deleteComment(id) {
      await request(`content_comments?id=eq.${enc(id)}`, { method: "DELETE", prefer: "return=minimal" });
    },
    async listNotifications(limit = 30) {
      return request(`notifications?select=id,kind,content_id,actor_name,body,read_at,created_at&order=created_at.desc&limit=${Number(limit) || 30}`);
    },
    async markNotificationsRead(ids = null) {
      const filter = ids ? `id=in.(${ids.map(enc).join(",")})` : "read_at=is.null";
      await request(`notifications?${filter}`, { method: "PATCH", body: { read_at: new Date().toISOString() }, prefer: "return=minimal" });
    },

    async ping() {
      await request("clients?select=id&limit=1");
      return true;
    }
  };
}
