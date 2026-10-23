/* SÓ PARA TESTES AUTOMÁTICOS: imita as regras do banco (supabase/migrations)
   em memória, para testar a tela sem acesso ao Supabase (veja
   fake-supabase.mjs). Nunca é usado pelo painel de verdade. */

import { randomUUID } from "node:crypto";
import { StoreError } from "../../site/admin/js/data/store.js";
import { createAdsMemory } from "./memory-ads.mjs";
import { CLIENT_VISIBLE_STATUS } from "../../site/admin/js/domain/rules.js";

const VISIBLE_FIELDS = ["title", "scheduled_date", "scheduled_time", "network", "format", "media_url", "media_kind", "caption", "client_notes"];

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
  const store = {
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
        .map((c) => ({ ...c, assets_count: assetsOf(c.id).length }));
    },
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
      c.status = status; c.updated_at = now();
      return { ...c };
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
      const a = { id: randomUUID(), kind: value.kind, storage_path: value.storage_path || null, url: value.url || null, position: value.position ?? 0, content_id: value.content_id, created_at: now() };
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
      c.status = p_decision === "aprovado" ? "aprovado" : "ajustes";
      return [{ new_status: c.status, new_version: c.version }];
    },
    /** O cliente pode ler este arquivo da arte final? (private.client_can_read_media) */
    canReadMedia(userId, path) {
      const m = members.get(userId);
      const a = [...assets.values()].find((x) => x.storage_path === path);
      const c = a && contents.get(a.content_id);
      return Boolean(m && c && c.client_id === m.clientId && clients.get(c.client_id)?.active && CLIENT_VISIBLE_STATUS.includes(c.status));
    },
    async getContent(id) { await this.tick(); const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116"); return { ...c }; },
    async createContent(value) {
      await this.tick();
      if (!clients.has(value.client_id)) throw new StoreError(409, "Cliente não encontrado.", "23503");
      const c = { id: randomUUID(), ...value, scheduled_time: value.scheduled_time ? `${value.scheduled_time}:00` : null, version: 1, created_at: now(), updated_at: now() };
      contents.set(c.id, c);
      return { ...c };
    },
    async updateContent(id, value) {
      await this.tick();
      const c = contents.get(id); if (!c) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      const next = { ...value, scheduled_time: value.scheduled_time ? `${value.scheduled_time}:00` : null };
      const changed = VISIBLE_FIELDS.some((k) => (c[k] ?? null) !== (next[k] ?? null));
      Object.assign(c, next, { version: c.version + (changed ? 1 : 0), updated_at: now() });
      return { ...c };
    },
    async deleteContent(id) { await this.tick(); if (!contents.delete(id)) throw new StoreError(404, "Registro não encontrado.", "PGRST116"); },
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
    async listClientCalendar(clientId, { from, to } = {}) {
      return (await this.listContents({ client_id: clientId, from, to }))
        .filter((c) => CLIENT_VISIBLE_STATUS.includes(c.status))
        .map(({ internal_notes, created_at, ...rest }) => rest);
    }
  };
  Object.assign(store, createAdsMemory({ clients, members, now, tick: () => store.tick() }));
  return store;
}
