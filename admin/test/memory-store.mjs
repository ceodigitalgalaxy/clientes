/* SÓ PARA TESTES AUTOMÁTICOS: imita as regras do banco (supabase/migrations)
   em memória, para testar a tela sem acesso ao Supabase (veja
   fake-supabase.mjs). Nunca é usado pelo painel de verdade. */

import { randomUUID } from "node:crypto";
import { StoreError } from "../../site/admin/js/data/store.js";
import { createAdsMemory } from "./memory-ads.mjs";
import { createApprovalsMemory } from "./memory-approvals.mjs";
import { pairFromStatus, statusFromPair } from "../../site/js/domain/approvals.js";
import { CLIENT_VISIBLE_STATUS } from "../../site/admin/js/domain/rules.js";

const VISIBLE_FIELDS = ["title", "scheduled_date", "scheduled_time", "network", "format", "caption", "client_notes", "idea", "content_plan", "art_text", "objective", "pillar", "cta", "planning_notes", "hashtags"];

/** Gatilho contents_a_status: status antigo calculado dos dois novos (e vice-versa) */
function syncStatus(next, old = null) {
  const pairGiven = "approval_status" in next || "production_status" in next;
  if (!old) {
    const a = next.approval_status ?? "rascunho"; const p = next.production_status ?? null;
    const pair = a === "rascunho" && !p && next.status && next.status !== "planejado" ? pairFromStatus(next.status) : { approval_status: a, production_status: p };
    return { ...next, ...pair, status: statusFromPair(pair.approval_status, pair.production_status) };
  }
  let pair = { approval_status: old.approval_status, production_status: old.production_status };
  if (pairGiven && ((next.approval_status ?? old.approval_status) !== old.approval_status || (next.production_status ?? null) !== (old.production_status ?? null))) {
    pair = { approval_status: next.approval_status ?? old.approval_status, production_status: "production_status" in next ? next.production_status ?? null : old.production_status };
  } else if (next.status && next.status !== old.status) {
    pair = pairFromStatus(next.status, old.approval_status, old.production_status);
  }
  return { ...next, ...pair, status: statusFromPair(pair.approval_status, pair.production_status) };
}

export function createMemoryStore() {
  const clients = new Map();
  const contents = new Map();
  const members = new Map();   // userId → { clientId, username } (logins do portal)
  const assets = new Map();    // arte final (content_assets)
  const approvals = [];        // decisões do cliente (content_approvals)
  const bump = (contentId) => { const c = contents.get(contentId); if (c) { c.version += 1; c.updated_at = now(); } };
  const ASSET_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/;
  const decisionFor = (c) => {
    const last = approvals.filter((a) => a.content_id === c.id && a.version === c.version).at(-1);
    return last ? { decision: last.decision, message: last.message, version: last.version, created_at: last.created_at } : null;
  };
  const assetsOf = (contentId) => [...assets.values()].filter((a) => a.content_id === contentId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const now = () => new Date().toISOString();
  const assignees = new Map();  // content_id → Set(user_id)   (content_assignees)
  const contentEvents = [];      // histórico da demanda          (content_events)
  const comments = [];           // comentários internos          (content_comments)
  const notifications = [];      // avisos de cada pessoa         (notifications)
  const settings = { alert_soon_days: 3, alert_urgent_days: 1 };
  const store = {
    /** Decisão do cliente pelo link (como as funções approval_public_*): muda a etapa e dispara o aviso de ajuste */
    setContentApproval(id, approval, mode = "planejamento") {
      const c = contents.get(id);
      if (!c) return;
      const before = { ...c };
      if (mode === "final") c.final_status = approval;
      else Object.assign(c, syncStatus({ approval_status: approval }, c));
      store.notifyAdjustment(before, c, {});
    },
    /* Ajustes da agência (agency_settings: uma linha) */
    getSettings() { return { ...settings }; },
    updateSettings(value) {
      const next = { ...settings, ...value };
      if (!(next.alert_urgent_days < next.alert_soon_days)) throw new StoreError(400, "check", "23514");
      Object.assign(settings, next);
      return { ...settings };
    },
    kind: "memory",
    failNext: 0,       // quantos pedidos devem falhar (simula banco fora do ar)
    delayMs: 0,        // atraso artificial (para ver o "carregando")
    async tick() {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.failNext > 0) { this.failNext -= 1; throw new StoreError(503, "Não foi possível conectar ao banco de dados. Verifique a internet e tente de novo.", "offline"); }
    },
    async ping() { await this.tick(); return true; },
    async listClients() {
      await this.tick();
      return [...clients.values()].sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          ...c,
          contents_count: [...contents.values()].filter((x) => x.client_id === c.id).length,
          portal_users: [...members.values()].filter((m) => m.clientId === c.id).map((m) => m.username).sort()
        }));
    },
    async getClient(id) { await this.tick(); const c = clients.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116"); return { ...c }; },
    async createClient(value) {
      await this.tick();
      if ([...clients.values()].some((c) => c.slug === value.slug)) throw new StoreError(409, "Já existe um cliente com esse identificador. Escolha outro.", "23505");
      const c = { id: randomUUID(), logo_path: null, ...value, created_at: now(), updated_at: now() };
      clients.set(c.id, c);
      return { ...c };
    },
    async updateClient(id, value) {
      await this.tick();
      const c = clients.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      if ([...clients.values()].some((o) => o.slug === value.slug && o.id !== id)) throw new StoreError(409, "Já existe um cliente com esse identificador. Escolha outro.", "23505");
      Object.assign(c, value, { updated_at: now() });
      return { ...c };
    },
    async deleteClient(id) {
      await this.tick();
      if (!clients.has(id)) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      if ([...contents.values()].some((x) => x.client_id === id) || store.hasAds(id)) throw new StoreError(409, "Este cliente tem conteúdos cadastrados e não pode ser excluído. Você pode inativá-lo.", "23503");
      clients.delete(id);
    },
    async listContents(f = {}) {
      await this.tick();
      return [...contents.values()]
        .filter((c) => (!f.client_id || c.client_id === f.client_id) && (!f.status || c.status === f.status) && (!f.from || c.scheduled_date >= f.from) && (!f.to || c.scheduled_date <= f.to))
        .sort((a, b) => (a.scheduled_date + (a.scheduled_time || "99")).localeCompare(b.scheduled_date + (b.scheduled_time || "99")))
        .map((c) => ({ ...c, assets_count: assetsOf(c.id).length, assignees: [...(assignees.get(c.id) || [])] }));
    },
    /* ---- Tarefa: responsáveis e histórico (as permissões ficam no fake-supabase, como o RLS) ---- */
    listAssignees(contentId) { return [...(assignees.get(contentId) || [])]; },
    addAssignee(contentId, userId, actorName, name, actorId = null) {
      if (!contents.has(contentId)) throw new StoreError(409, "Conteúdo não encontrado.", "23503");
      const set = assignees.get(contentId) || new Set();
      if (set.has(userId)) throw new StoreError(409, "duplicado", "23505");
      set.add(userId); assignees.set(contentId, set);
      this.logEvent(contentId, "responsavel_adicionado", actorName, null, userId, { name });
      this.notify(userId, "atribuicao", contentId, contents.get(contentId).title, { id: actorId, name: actorName });
    },

    /* ---- Comentários e avisos: as mesmas regras dos gatilhos do banco ---- */
    canReceive: () => true,          // o emulador troca por "ativo e enxerga o cliente"
    adminIds: () => [],              // administradores ativos (aviso de ajuste sem responsável)
    notify(userId, kind, contentId, body, actor = {}) {
      const c = contents.get(contentId);
      if (!userId || !c || userId === actor.id || !this.canReceive(userId, c.client_id)) return;
      notifications.push({ id: randomUUID(), user_id: userId, kind, content_id: contentId, actor_name: actor.name || "Cliente (pelo link)", body: String(body || "").slice(0, 280), read_at: null, created_at: now() });
    },
    listComments(contentId) { return comments.filter((x) => x.content_id === contentId); },
    addComment({ content_id, body, mentions = [] }, actor) {
      const c = contents.get(content_id);
      if (!c) throw new StoreError(409, "Conteúdo não encontrado.", "23503");
      const text = String(body || "").trim();
      if (!text || text.length > 2000) throw new StoreError(400, "check", "23514");
      const ok = [...new Set(mentions)].filter((m) => m !== actor.id && this.canReceive(m, c.client_id));
      const row = { id: randomUUID(), content_id, author_id: actor.id, author_name: actor.name, body: text, mentions: ok, created_at: now() };
      comments.push(row);
      ok.forEach((m) => this.notify(m, "mencao", content_id, text, actor));
      [...(assignees.get(content_id) || [])].filter((u) => !ok.includes(u)).forEach((u) => this.notify(u, "comentario", content_id, text, actor));
      return { ...row };
    },
    deleteComment(id) { const i = comments.findIndex((x) => x.id === id); if (i >= 0) comments.splice(i, 1); },
    commentAuthor(id) { return comments.find((x) => x.id === id)?.author_id ?? null; },
    listNotifications(userId) { return notifications.filter((n) => n.user_id === userId).slice().reverse(); },
    markNotificationsRead(userId, ids = null) {
      notifications.forEach((n) => { if (n.user_id === userId && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = now(); });
    },
    /** Como o gatilho notify_adjustment: ajuste pedido avisa responsáveis (ou administradores) */
    notifyAdjustment(before, after, actor = {}) {
      const stage = after.approval_status === "ajustes" && before.approval_status !== "ajustes" ? "na ideia"
        : after.final_status === "ajustes" && before.final_status !== "ajustes" ? "no conteúdo final" : null;
      if (!stage) return;
      const people = [...(assignees.get(after.id) || [])];
      (people.length ? people : this.adminIds()).forEach((u) => this.notify(u, "ajuste", after.id, `Ajuste pedido ${stage}: ${after.title}`, actor));
    },
    removeAssignee(contentId, userId, actorName, name) {
      if (assignees.get(contentId)?.delete(userId)) this.logEvent(contentId, "responsavel_removido", actorName, userId, null, { name });
    },
    logEvent(contentId, type, actorName, from = null, to = null, metadata = {}) {
      contentEvents.push({ id: randomUUID(), content_id: contentId, event_type: type, actor_name: actorName, from_value: from, to_value: to, metadata, created_at: now() });
    },
    /** Como o gatilho contents_log: registra o que mudou */
    logChanges(before, after, actorName) {
      if (!before) { this.logEvent(after.id, "criado", actorName); return; }
      const pairs = [["production_status", "producao"], ["due_date", "prazo"], ["priority", "prioridade"], ["approval_status", "ideia"], ["final_status", "final"]];
      for (const [field, type] of pairs) if ((before[field] ?? null) !== (after[field] ?? null)) this.logEvent(after.id, type, actorName, before[field] ?? null, after[field] ?? null);
    },
    allContentEvents() { return contentEvents.slice().reverse(); },
    listContentEvents(contentId) { return contentEvents.filter((e) => e.content_id === contentId).slice().reverse(); },
    /** Importação: todos ou nenhum */
    async createContents(values) {
      await this.tick();
      if (values.some((v) => !clients.has(v.client_id))) throw new StoreError(409, "Cliente não encontrado.", "23503");
      const created = [];
      for (const v of values) created.push(await this.createContent(v));
      return created;
    },
    async setContentStatus(id, status) {
      await this.tick();
      const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      Object.assign(c, syncStatus({ status }, c), { updated_at: now() });
      return { ...c };
    },
    async moveContent(id, date) {
      await this.tick();
      const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      const changed = c.scheduled_date !== date && VISIBLE_FIELDS.includes("scheduled_date");
      Object.assign(c, { scheduled_date: date, version: c.version + (changed ? 1 : 0), updated_at: now() });
      return { ...c };
    },
    async setContentProduction(id, production) {
      await this.tick();
      const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      Object.assign(c, syncStatus({ production_status: production }, c), { updated_at: now() });
      return { ...c };
    },
    async setAssetRole(id, role) {
      await this.tick();
      const a = assets.get(id); if (!a) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      if (!["midia", "capa", "thumbnail"].includes(role)) throw new StoreError(400, "inválido", "23514");
      a.role = role; bump(a.content_id);
      return { ...a };
    },
    async setClientLogo(id, logoPath) {
      await this.tick();
      const c = clients.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      c.logo_path = logoPath; c.updated_at = now();
      return { ...c };
    },
    async listAssets(contentId) { await this.tick(); return assetsOf(contentId).map((a) => ({ ...a })); },
    async addAsset(value) {
      await this.tick();
      if (!contents.has(value.content_id)) throw new StoreError(409, "Conteúdo não encontrado.", "23503");
      if (Boolean(value.storage_path) === Boolean(value.url) || (value.storage_path && !ASSET_PATH.test(value.storage_path))) throw new StoreError(400, "inválido", "23514");
      if (!["image", "video", "pdf"].includes(value.kind) || !["midia", "capa", "thumbnail", undefined].includes(value.role)) throw new StoreError(400, "inválido", "23514");
      const a = { id: randomUUID(), kind: value.kind, role: value.role || "midia", name: value.name ?? null, storage_path: value.storage_path || null, url: value.url || null, position: value.position ?? 0, content_id: value.content_id, created_at: now() };
      assets.set(a.id, a);
      bump(a.content_id);
      return { ...a };
    },
    async moveAsset(id, position) {
      await this.tick();
      const a = assets.get(id); if (!a) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      a.position = position; bump(a.content_id);
      return { id, position };
    },
    async deleteAsset(id) {
      await this.tick();
      const a = assets.get(id); if (!a) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      assets.delete(id); bump(a.content_id);
      return { id, storage_path: a.storage_path };
    },
    async listApprovals(contentId) {
      await this.tick();
      return approvals.filter((a) => a.content_id === contentId).slice().reverse().map(({ id, version, decision, message, created_at }) => ({ id, version, decision, message, created_at }));
    },
    /* Mesmas regras de portal_decide */
    async portalDecide(userId, { p_content_id, p_version, p_decision, p_message }) {
      await this.tick();
      const message = String(p_message ?? "").trim() || null;
      if (!["aprovado", "ajustes"].includes(p_decision)) throw new StoreError(400, "decisao_invalida", "P0001");
      if (p_decision === "ajustes" && !message) throw new StoreError(400, "mensagem_obrigatoria", "P0001");
      const m = members.get(userId);
      const c = contents.get(p_content_id);
      const client = c && clients.get(c.client_id);
      if (!m || !c || c.client_id !== m.clientId || !client?.active) throw new StoreError(400, "conteudo_nao_encontrado", "P0001");
      if (c.status !== "aguardando_aprovacao") throw new StoreError(400, "nao_aguarda_aprovacao", "P0001");
      if (c.version !== p_version) throw new StoreError(400, "versao_desatualizada", "P0001");
      approvals.push({ id: randomUUID(), content_id: c.id, version: c.version, decision: p_decision, message, user_id: userId, created_at: now() });
      Object.assign(c, syncStatus({ status: p_decision === "aprovado" ? "aprovado" : "ajustes" }, c));
      return [{ new_status: c.status, new_version: c.version }];
    },
    /** O cliente pode ler este arquivo da arte final? (private.client_can_read_media) */
    canReadMedia(userId, path) {
      const m = members.get(userId);
      const a = [...assets.values()].find((x) => x.storage_path === path);
      const c = a && contents.get(a.content_id);
      return Boolean(m && c && c.client_id === m.clientId && clients.get(c.client_id)?.active && CLIENT_VISIBLE_STATUS.includes(c.status));
    },
    setFinalStatus(id, status) { const c = contents.get(id); if (c) c.final_status = status; },
    /** Leitura sem atraso nem falha simulada (para as regras de permissão do emulador) */
    peekContent(id) { const c = contents.get(id); return c ? { ...c } : null; },
    async getContent(id) { await this.tick(); const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116"); return { ...c }; },
    async createContent(value) {
      await this.tick();
      if (!clients.has(value.client_id)) throw new StoreError(409, "Cliente não encontrado.", "23503");
      const c = { id: randomUUID(), pillar: null, cta: null, planning_notes: null, hashtags: null, final_status: "rascunho", due_date: null, priority: "media", ...syncStatus(value), scheduled_time: value.scheduled_time ? `${value.scheduled_time}:00` : null, version: 1, created_at: now(), updated_at: now() };
      contents.set(c.id, c);
      return { ...c };
    },
    async updateContent(id, value) {
      await this.tick();
      const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      const next = { ...value, scheduled_time: value.scheduled_time ? `${value.scheduled_time}:00` : null };
      const changed = VISIBLE_FIELDS.some((k) => k in next && (c[k] ?? null) !== (next[k] ?? null));
      Object.assign(c, syncStatus(next, c), { version: c.version + (changed ? 1 : 0), updated_at: now() });
      return { ...c };
    },
    async deleteContent(id) { await this.tick(); if (!contents.delete(id)) throw new StoreError(404, "Registro não encontrado.", "PGRST116"); assignees.delete(id); },
    /* Portal do cliente: o mesmo que as funções portal_profile() e portal_contents() */
    addMember(userId, clientId, username) {
      if ([...members.values()].some((m) => m.username === username)) throw new StoreError(409, "duplicado", "23505");
      members.set(userId, { clientId, username });
    },
    removeMember(userId) { members.delete(userId); },
    findMembers({ username, userId } = {}) {
      return [...members.entries()]
        .filter(([id, m]) => (!username || m.username === username) && (!userId || id === userId))
        .map(([id, m]) => ({ user_id: id, client_id: m.clientId, username: m.username }));
    },
    async portalProfile(userId) {
      await this.tick();
      const m = members.get(userId);
      const c = m && clients.get(m.clientId);
      return c && c.active ? [{ client_id: c.id, name: c.name, segment: c.segment, logo_path: c.logo_path || null }] : [];
    },
    async portalContents(userId, from, to) {
      await this.tick();
      const m = members.get(userId);
      const c = m && clients.get(m.clientId);
      const days = (Date.parse(to) - Date.parse(from)) / 86400000;
      if (!c || !c.active || !(days >= 0 && days <= 62)) return [];
      return [...contents.values()]
        .filter((x) => x.client_id === c.id && CLIENT_VISIBLE_STATUS.includes(x.status) && x.scheduled_date >= from && x.scheduled_date <= to)
        .sort((a, b) => (a.scheduled_date + (a.scheduled_time || "99")).localeCompare(b.scheduled_date + (b.scheduled_time || "99")))
        .map(({ client_id, internal_notes, created_at, assets_changed_at, ...rest }) => ({
          ...rest,
          assets: assetsOf(rest.id).map((a) => ({ kind: a.kind, storage_path: a.storage_path, url: a.url })),
          decision: decisionFor({ id: rest.id, version: rest.version })
        }));
    },
    /** portal_agenda(): sem referência e sem decisão, com os campos guiados */
    async portalAgenda(userId, from, to) {
      const rows = await this.portalContents(userId, from, to);
      // Como no banco: legenda, arte e arquivos só depois do envio para a aprovação final
      return rows.map(({ media_url, media_kind, decision, planning_notes, hashtags, final_status, ...rest }) => {
        const final = final_status && final_status !== "rascunho";
        return {
          idea: null, content_plan: null, objective: null, ...rest,
          art_text: final ? rest.art_text ?? null : null,
          caption: final ? [rest.caption, hashtags].filter(Boolean).join("\n\n") || null : null,
          client_notes: final ? rest.client_notes || planning_notes || null : planning_notes || null,
          assets: final ? rest.assets : []
        };
      });
    },
    async listClientCalendar(clientId, { from, to } = {}) {
      return (await this.listContents({ client_id: clientId, from, to }))
        .filter((c) => CLIENT_VISIBLE_STATUS.includes(c.status))
        .map(({ internal_notes, created_at, ...rest }) => rest);
    }
  };
  Object.assign(store, createAdsMemory({ clients, members, now, tick: () => store.tick() }));
  Object.assign(store, createApprovalsMemory({
    clients, contents, assetsOf, now, tick: () => store.tick(),
    setContentApproval: (id, approval, mode) => store.setContentApproval(id, approval, mode)
  }));
  return store;
}
