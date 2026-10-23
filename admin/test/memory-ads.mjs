/* SÓ PARA TESTES AUTOMÁTICOS: as regras de anúncios do banco
   (supabase/migrations/20261025120000_aprovacao_de_anuncios.sql) em memória.
   Mesmos nomes de erro (raise exception) e mesmas regras de quem vê o quê. */

import { randomUUID } from "node:crypto";
import { StoreError } from "../../site/admin/js/data/store.js";

const EDITABLE = ["rascunho", "alteracoes_solicitadas"];
const CLIENT_STATUS = ["aguardando_aprovacao", "alteracoes_solicitadas", "aprovado", "arquivado"];
const FIELDS = ["client_id", "title", "campaign_context", "objective", "platform", "platform_other", "format", "creative_stage", "primary_text", "headline", "description", "cta", "destination_url", "client_notes", "internal_notes"];
const fail = (key) => new StoreError(400, key, "P0001");

export function createAdsMemory({ clients, members, now, tick }) {
  const ads = new Map();
  const assets = new Map();
  const versions = [];
  const events = [];
  let clock = 0;
  const stamp = () => { clock += 1; return new Date(Date.now() + clock).toISOString(); };   // ordem estável

  const assetsOf = (adId) => [...assets.values()].filter((a) => a.ad_id === adId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const withAssets = (ad) => ({ ...ad, ad_assets: assetsOf(ad.id).map((a) => ({ ...a })) });
  const event = (ad, name, actor, extra = {}) => events.push({ id: randomUUID(), ad_id: ad.id, version: ad.version, event: name, actor_id: actor.id, actor_role: actor.role, actor_username: actor.username, message: null, created_at: stamp(), ...extra });
  const getAdOrFail = (id) => { const ad = ads.get(id); if (!ad) throw new StoreError(404, "Registro não encontrado.", "PGRST116"); return ad; };

  return {
    /* ---- Equipe (RLS: membro da agência) ---- */
    async listAds({ client_id, status } = {}) {
      await tick();
      return [...ads.values()]
        .filter((a) => (!client_id || a.client_id === client_id) && (!status || a.status === status))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(withAssets);
    },
    async getAd(id) { await tick(); return withAssets(getAdOrFail(id)); },
    async createAd(value, actor) {
      await tick();
      if (!clients.has(value.client_id)) throw new StoreError(409, "Cliente não encontrado.", "23503");
      const ad = { id: randomUUID(), ...Object.fromEntries(FIELDS.map((f) => [f, value[f] ?? null])), creative_stage: value.creative_stage || "final", status: "rascunho", version: 1, submitted_at: null, submitted_by: null, first_submitted_at: null, created_by: actor.id, created_at: now(), updated_at: now() };
      ads.set(ad.id, ad);
      event(ad, "criado", actor, { to_status: "rascunho" });
      return { ...ad };
    },
    async updateAd(id, value) {
      await tick();
      const ad = getAdOrFail(id);
      if (["status", "version", "submitted_at", "first_submitted_at"].some((k) => k in value)) throw fail("use_fluxo_do_anuncio");
      if (!EDITABLE.includes(ad.status)) throw fail("anuncio_bloqueado");
      if (value.client_id && value.client_id !== ad.client_id && ad.first_submitted_at) throw fail("cliente_fixo");
      FIELDS.forEach((f) => { if (f in value) ad[f] = value[f] ?? null; });
      ad.updated_at = now();
      return { ...ad };
    },
    /** PATCH de vários (uma instrução só: se algum não puder, nenhum muda) */
    async setAdsStage(ids, stage) {
      await tick();
      const list = ids.map((id) => ads.get(id)).filter(Boolean);
      if (list.some((ad) => !EDITABLE.includes(ad.status))) throw fail("anuncio_bloqueado");
      list.forEach((ad) => { ad.creative_stage = stage; ad.updated_at = now(); });
      return list.map(({ id, creative_stage }) => ({ id, creative_stage }));
    },
    async deleteAd(id) {
      await tick();
      const ad = getAdOrFail(id);
      if (ad.first_submitted_at) throw fail("anuncio_com_historico");
      ads.delete(id);
      for (const [k, a] of assets) if (a.ad_id === id) assets.delete(k);
    },
    async addAdAsset(value) {
      await tick();
      const ad = getAdOrFail(value.ad_id);
      if (!EDITABLE.includes(ad.status)) throw fail("anuncio_bloqueado");
      const a = { id: randomUUID(), ad_id: ad.id, kind: value.kind, storage_path: value.storage_path ?? null, url: value.url ?? null, position: value.position ?? 0, created_at: stamp() };
      assets.set(a.id, a);
      return { ...a };
    },
    async moveAdAsset(id, position) {
      await tick();
      const a = assets.get(id); if (!a) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      if (!EDITABLE.includes(ads.get(a.ad_id).status)) throw fail("anuncio_bloqueado");
      a.position = position;
      return { id, position };
    },
    async deleteAdAsset(id) {
      await tick();
      const a = assets.get(id); if (!a) throw new StoreError(404, "Registro não encontrado.", "PGRST116");
      if (!EDITABLE.includes(ads.get(a.ad_id).status)) throw fail("anuncio_bloqueado");
      assets.delete(id);
      return { id, storage_path: a.storage_path };
    },
    async listAdEvents(adId) { await tick(); return events.filter((e) => e.ad_id === adId).map((e) => ({ ...e })); },
    async listAdVersions(adId) { await tick(); return versions.filter((v) => v.ad_id === adId).sort((a, b) => b.version - a.version).map((v) => ({ ...v })); },

    /** ad_transition (equipe) */
    async adTransition(actor, { p_ad_id, p_action, p_message }) {
      await tick();
      if (actor.role !== "equipe") throw fail("sem_permissao");
      const ad = ads.get(p_ad_id);
      if (!ad) throw fail("anuncio_nao_encontrado");
      const message = String(p_message ?? "").trim() || null;
      const from = ad.status;
      let to; let name; let version = ad.version;
      if (p_action === "enviar") {
        if (!EDITABLE.includes(from)) throw fail("transicao_invalida");
        if (!assetsOf(ad.id).length) {
          if (ad.creative_stage !== "referencia") throw fail("sem_criativo");
          if (!String(ad.campaign_context ?? "").trim()) throw fail("sem_escopo");
        }
        if (ad.first_submitted_at) version += 1;
        to = "aguardando_aprovacao"; name = "enviado";
      } else if (p_action === "recolher") { if (from !== "aguardando_aprovacao") throw fail("transicao_invalida"); to = "rascunho"; name = "recolhido"; }
      else if (p_action === "reabrir") { if (from !== "aprovado") throw fail("transicao_invalida"); to = "rascunho"; name = "reaberto"; }
      else if (p_action === "arquivar") { if (from === "arquivado") throw fail("transicao_invalida"); to = "arquivado"; name = "arquivado"; }
      else if (p_action === "reativar") { if (from !== "arquivado") throw fail("transicao_invalida"); to = "rascunho"; name = "reativado"; }
      else throw fail("acao_invalida");
      ad.status = to; ad.version = version; ad.updated_at = now();
      if (p_action === "enviar") {
        ad.submitted_at = now(); ad.submitted_by = actor.id; ad.first_submitted_at ||= ad.submitted_at;
        const snapshot = { ...Object.fromEntries(FIELDS.filter((f) => !["client_id", "internal_notes"].includes(f)).map((f) => [f, ad[f]])), assets: assetsOf(ad.id).map(({ kind, storage_path, url }) => ({ kind, storage_path, url })) };
        const i = versions.findIndex((v) => v.ad_id === ad.id && v.version === version);
        const row = { id: randomUUID(), ad_id: ad.id, version, snapshot, submitted_by: actor.id, submitted_at: now() };
        if (i >= 0) versions[i] = row; else versions.push(row);
      }
      event(ad, name, actor, { from_status: from, to_status: to, message });
      return [{ ...ad }];
    },

    /* ---- Cliente (portal_ads / portal_ad_decide) ---- */
    async portalAds(userId) {
      await tick();
      const m = members.get(userId);
      const client = m && clients.get(m.clientId);
      if (!client || !client.active) return [];
      return [...ads.values()]
        .filter((a) => a.client_id === client.id && a.first_submitted_at && CLIENT_STATUS.includes(a.status))
        .sort((a, b) => (b.status === "aguardando_aprovacao") - (a.status === "aguardando_aprovacao") || String(b.submitted_at).localeCompare(String(a.submitted_at)))
        .map(({ client_id, internal_notes, submitted_by, created_by, created_at, ...rest }) => ({
          ...rest,
          assets: assetsOf(rest.id).map(({ kind, storage_path, url }) => ({ kind, storage_path, url })),
          history: events.filter((e) => e.ad_id === rest.id && ["enviado", "aprovado", "alteracoes_solicitadas", "arquivado"].includes(e.event))
            .map(({ event: ev, version, actor_role, actor_username, message, created_at: at }) => ({ event: ev, version, actor_role, actor_username, message, created_at: at }))
        }));
    },
    async portalAdDecide(actor, { p_ad_id, p_version, p_decision, p_message }) {
      await tick();
      const message = String(p_message ?? "").trim() || null;
      if (!["aprovado", "alteracoes_solicitadas"].includes(p_decision)) throw fail("decisao_invalida");
      if (p_decision === "alteracoes_solicitadas" && !message) throw fail("mensagem_obrigatoria");
      if (message && message.length > 1000) throw fail("mensagem_longa");
      const m = members.get(actor.id);
      const ad = ads.get(p_ad_id);
      if (!m || !ad || ad.client_id !== m.clientId || !ad.first_submitted_at || !clients.get(ad.client_id)?.active) throw fail("anuncio_nao_encontrado");
      if (ad.status !== "aguardando_aprovacao") throw fail("nao_aguarda_aprovacao");
      if (ad.version !== p_version) throw fail("versao_desatualizada");
      const from = ad.status;
      ad.status = p_decision; ad.updated_at = now();
      event(ad, p_decision, { id: actor.id, role: "cliente", username: actor.username }, { from_status: from, to_status: p_decision, message });
      return [{ new_status: p_decision, new_version: ad.version }];
    },
    /** private.client_can_read_ad_media */
    canReadAdMedia(userId, path) {
      const m = members.get(userId);
      const a = [...assets.values()].find((x) => x.storage_path === path);
      const ad = a && ads.get(a.ad_id);
      return Boolean(m && ad && ad.client_id === m.clientId && ad.first_submitted_at && CLIENT_STATUS.includes(ad.status) && clients.get(ad.client_id)?.active);
    },
    hasAds(clientId) { return [...ads.values()].some((a) => a.client_id === clientId); }
  };
}
