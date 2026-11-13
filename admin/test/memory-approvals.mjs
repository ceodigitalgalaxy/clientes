/* SÓ PARA TESTES AUTOMÁTICOS: a central de aprovação do banco
   (supabase/migrations/20261110120000_central_de_aprovacao.sql) em memória.
   Mesmos nomes de erro e as mesmas regras: versão congelada no envio, uma
   decisão por versão, link guardado só como SHA-256, limite de tentativas. */

import { randomUUID, randomBytes, createHash } from "node:crypto";
import { StoreError } from "../../site/admin/js/data/store.js";

const fail = (key) => new StoreError(400, key, "P0001");
const sha = (token) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

export function createApprovalsMemory({ clients, contents, assetsOf, setContentApproval, now, tick }) {
  const batches = new Map();
  const items = new Map();
  const versions = new Map();
  const links = new Map();
  const vault = new Map();      // secret_id → token (o "Vault")
  const decisions = [];
  const events = [];
  const hits = new Map();       // limite de tentativas
  let clock = 0;
  const stamp = () => { clock += 1; return new Date(Date.now() + clock).toISOString(); };
  const team = (actor) => { if (!actor?.member) throw new StoreError(403, "sem_permissao", "P0001"); return actor.username || "equipe"; };

  function event(batchId, type, actorType, ref, extra = {}) {
    events.push({ id: randomUUID(), batch_id: batchId, item_id: null, content_id: null, version_id: null, event_type: type, actor_type: actorType,
      actor_reference: ref ? String(ref).slice(0, 120) : null, from_status: null, to_status: null, metadata: {}, read_at: actorType === "equipe" ? now() : null,
      created_at: stamp(), ...extra });
  }
  function rateOk(bucket, max, windowSeconds) {
    const key = `${bucket}|${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= max;
  }
  const snapshot = (contentId) => {
    const c = contents.get(contentId);
    return {
      title: c.title, scheduled_date: c.scheduled_date, scheduled_time: c.scheduled_time ? c.scheduled_time.slice(0, 5) : null,
      network: c.network, format: c.format, pillar: c.pillar ?? null, objective: c.objective ?? null, idea: c.idea ?? null,
      content_plan: c.content_plan ?? null, art_text: c.art_text ?? null, caption: c.caption ?? null, hashtags: c.hashtags ?? null, cta: c.cta ?? null, client_notes: c.client_notes ?? null,
      planning_notes: c.planning_notes ?? null,
      assets: assetsOf(contentId).map((a) => ({ kind: a.kind, role: a.role || "midia", name: a.name ?? null, storage_path: a.storage_path, url: a.url }))
    };
  };
  const activeItems = (batchId) => [...items.values()].filter((i) => i.batch_id === batchId && !i.removed_at)
    .sort((a, b) => a.display_order - b.display_order || a.created_at.localeCompare(b.created_at));
  const activeLink = (batchId) => [...links.values()].find((l) => l.batch_id === batchId && !l.revoked_at) || null;
  const modeOf = (batchId) => batches.get(batchId)?.approval_mode || "planejamento";
  const setApproval = (contentId, status, mode) => setContentApproval(contentId, status, mode);
  const stageStatus = (contentId, mode) => { const c = contents.get(contentId); return c ? (mode === "final" ? c.final_status || "rascunho" : c.approval_status) : null; };
  /** Como private.approval_view: o recorte do que cada etapa mostra ao cliente */
  const view = (snap, mode) => {
    if (!snap) return null;
    const base = { title: snap.title, scheduled_date: snap.scheduled_date, scheduled_time: snap.scheduled_time, network: snap.network, format: snap.format };
    return mode === "final"
      ? { ...base, caption: snap.caption ?? null, hashtags: snap.hashtags ?? null, cta: snap.cta ?? null, client_notes: snap.client_notes ?? null, assets: snap.assets || [] }
      : { ...base, idea: snap.idea ?? null, content_plan: snap.content_plan ?? null, planning_notes: snap.planning_notes ?? null, assets: [] };
  };
  const staleItem = (item) => {
    const v = item.version_id && versions.get(item.version_id);
    if (!v || !contents.has(item.content_id)) return false;
    return JSON.stringify(view(v.snapshot, modeOf(item.batch_id))) !== JSON.stringify(view(snapshot(item.content_id), modeOf(item.batch_id)));
  };

  function batchJson(batchId, linkId, preview = false) {
    const b = batches.get(batchId);
    const c = clients.get(b.client_id);
    return {
      batch: { id: b.id, title: b.title, month: b.month.slice(0, 7), mode: b.approval_mode, intro: b.intro_message, allow_individual: b.allow_individual,
               allow_bulk: b.allow_bulk, expires_at: linkId ? links.get(linkId)?.expires_at ?? null : null, preview },
      client: { name: c.name, logo_path: c.logo_path || null },
      items: activeItems(batchId)
        .filter((i) => preview || (i.version_id && i.status !== "rascunho"))
        .filter((i) => i.version_id || i.content_id)
        .map((i) => {
          const v = i.version_id ? versions.get(i.version_id) : null;
          const d = decisions.find((x) => x.item_id === i.id && x.version_id === i.version_id);
          const prev = decisions.filter((x) => x.item_id === i.id && x.action === "ajustes" && x.version_id !== i.version_id).at(-1);
          return {
            id: i.id, status: i.status, version_id: i.version_id, version_number: v?.version_number ?? null,
            content: view(v ? structuredClone(v.snapshot) : preview && contents.has(i.content_id) ? snapshot(i.content_id) : null, b.approval_mode),
            decision: d ? { action: d.action, comment: d.comment, reviewer_name: d.reviewer_name, created_at: d.created_at, bulk: d.bulk } : null,
            previous_request: prev ? { comment: prev.comment, reviewer_name: prev.reviewer_name, created_at: prev.created_at } : null
          };
        })
    };
  }

  function linkCheck(token, ip) {
    if (!rateOk(`ip:${ip || "?"}`, 120, 60)) return { problem: "muitas_tentativas" };
    const link = TOKEN.test(String(token || "")) ? [...links.values()].find((l) => l.token_hash === sha(token)) : null;
    if (!link) return { problem: rateOk(`falha:${ip || "?"}`, 20, 600) ? "link_invalido" : "muitas_tentativas" };
    const b = batches.get(link.batch_id);
    if (link.revoked_at || b.archived_at) return { problem: "link_desativado" };
    if (link.expires_at && link.expires_at <= now()) {
      if (!events.some((e) => e.batch_id === b.id && e.event_type === "link_expirado" && e.metadata.link_id === link.id)) event(b.id, "link_expirado", "sistema", null, { metadata: { link_id: link.id } });
      return { problem: "link_expirado" };
    }
    link.last_used_at = now();
    return { link };
  }

  function apply(link, itemId, versionId, action, comment, name, session, bulk) {
    const text = String(comment ?? "").trim() || null;
    const reviewer = String(name ?? "").trim().slice(0, 80) || null;
    if (!["aprovado", "ajustes"].includes(action)) return { error: "acao_invalida" };
    if (action === "ajustes" && !text) return { error: "comentario_obrigatorio" };
    if (text && text.length > 1000) return { error: "comentario_longo" };
    const item = items.get(itemId);
    if (!item || item.batch_id !== link.batch_id || item.removed_at || item.status === "rascunho") return { error: "item_nao_encontrado" };
    if (item.version_id !== versionId) return { error: "versao_desatualizada", item: itemId };
    if (!["aguardando_aprovacao", "reenviado"].includes(item.status)) return { error: "ja_decidido", item: itemId, status: item.status };
    decisions.push({ id: randomUUID(), batch_id: link.batch_id, item_id: item.id, content_id: item.content_id, version_id: item.version_id, link_id: link.id,
      action, comment: text, reviewer_name: reviewer, session_id: session ? String(session).slice(0, 64) : null, bulk, created_at: stamp() });
    const from = item.status;
    item.status = action; item.decided_at = now();
    setApproval(item.content_id, action, modeOf(link.batch_id));
    event(link.batch_id, action, "cliente", reviewer || "Cliente (sem nome)", { item_id: item.id, content_id: item.content_id, version_id: item.version_id,
      from_status: from, to_status: action, metadata: { comment: text, session, link_id: link.id, bulk, stage: modeOf(link.batch_id) } });
    return { ok: true, item: item.id, status: action };
  }
  function afterClient(batchId, name) {
    batches.get(batchId).last_client_action_at = now();
    const sent = activeItems(batchId).filter((i) => i.status !== "rascunho");
    const drafts = activeItems(batchId).some((i) => i.status === "rascunho");
    if (sent.length && sent.every((i) => i.status === "aprovado") && !drafts) {
      event(batchId, "lote_aprovado", "cliente", String(name ?? "").trim() || "Cliente (sem nome)", { metadata: { total: sent.length } });
    }
  }

  function send(batchId, itemIds, actor) {
    let count = 0;
    const mode = modeOf(batchId);
    for (const item of activeItems(batchId)) {
      if (itemIds && !itemIds.includes(item.id)) continue;
      const c = contents.get(item.content_id);
      if (!c) continue;
      const sent = item.version_id ? versions.get(item.version_id) : null;
      if (!(!sent || item.status === "ajustes" || staleItem(item))) continue;
      if (mode === "final" && !assetsOf(c.id).length && !String(c.caption || "").trim()) throw fail("final_sem_conteudo");
      const number = [...versions.values()].filter((v) => v.content_id === c.id).length + 1;
      const v = { id: randomUUID(), content_id: c.id, client_id: c.client_id, version_number: number, content_version: c.version, snapshot: view(snapshot(c.id), mode), stage: mode, created_by: actor.id, created_at: stamp() };
      versions.set(v.id, v);
      const to = sent ? "reenviado" : "aguardando_aprovacao";
      const from = item.status;
      Object.assign(item, { version_id: v.id, status: to, decided_at: null });
      setApproval(c.id, to, mode);
      event(batchId, to === "reenviado" ? "nova_versao" : "enviado", "equipe", actor.username, { item_id: item.id, content_id: c.id, version_id: v.id, from_status: from, to_status: to, metadata: { version_number: number, stage: mode } });
      count += 1;
    }
    if (count) { const b = batches.get(batchId); b.sent_at ||= now(); }
    return count;
  }
  function newLink(batchId, expires, reason, actor) {
    for (const old of [...links.values()].filter((l) => l.batch_id === batchId && !l.revoked_at)) {
      Object.assign(old, { revoked_at: now(), revoked_reason: reason });
      vault.delete(old.secret_id);
      event(batchId, "link_desativado", "equipe", actor.username, { metadata: { link_id: old.id, motivo: reason } });
    }
    const token = randomBytes(32).toString("base64url");
    const secretId = randomUUID();
    vault.set(secretId, token);
    const link = { id: randomUUID(), batch_id: batchId, token_hash: sha(token), secret_id: secretId, created_by: actor.id, created_at: now(), expires_at: expires || null, revoked_at: null, revoked_reason: null, last_used_at: null };
    links.set(link.id, link);
    event(batchId, "link_gerado", "equipe", actor.username, { metadata: { link_id: link.id, expires_at: expires || null } });
    return token;
  }
  const getBatch = (id) => { const b = batches.get(id); if (!b) throw fail("lote_nao_encontrado"); return b; };
  const openBatch = (id) => { const b = getBatch(id); if (b.archived_at) throw fail("lote_arquivado"); return b; };

  function summary(b) {
    const list = activeItems(b.id);
    const count = (fn) => list.filter(fn).length;
    const link = activeLink(b.id);
    const sentCount = count((i) => i.status !== "rascunho");
    let overall = "aguardando";
    if (b.archived_at) overall = "arquivado";
    else if (!sentCount) overall = "rascunho";
    else if (count((i) => i.status === "ajustes")) overall = "com_ajustes";
    else if (count((i) => i.status === "aprovado") === list.length) overall = "aprovado";
    else if (count((i) => i.status === "aprovado")) overall = "parcial";
    return {
      ...b, total: list.length, aprovados: count((i) => i.status === "aprovado"), aguardando: count((i) => ["aguardando_aprovacao", "reenviado"].includes(i.status)),
      ajustes: count((i) => i.status === "ajustes"), rascunhos: count((i) => i.status === "rascunho"),
      link_id: link?.id ?? null, link_created_at: link?.created_at ?? null, link_expires_at: link?.expires_at ?? null, link_last_used_at: link?.last_used_at ?? null,
      overall_status: overall
    };
  }

  return {
    approvalTokenOf(batchId) { const l = activeLink(batchId); return l ? vault.get(l.secret_id) : null; },
    approvalEvents: events,

    /* ---- Equipe (RLS: membro da agência) ---- */
    /** Cliente do lote (o fake-supabase confere a permissão, como assert_batch) */
    batchClient(id) { return batches.get(id)?.client_id ?? null; },
    async listBatchSummary({ client_id } = {}) {
      await tick();
      return [...batches.values()].filter((b) => !client_id || b.client_id === client_id)
        .sort((a, b) => b.month.localeCompare(a.month) || b.created_at.localeCompare(a.created_at)).map(summary);
    },
    async createBatch(value, actor) {
      await tick();
      if (!clients.has(value.client_id)) throw new StoreError(409, "Cliente não encontrado.", "23503");
      if (!/^\d{4}-\d{2}-01$/.test(String(value.month))) throw new StoreError(400, "mês inválido", "23514");
      const b = { id: randomUUID(), client_id: value.client_id, title: value.title, month: value.month, approval_mode: value.approval_mode || "planejamento",
        intro_message: value.intro_message ?? null, allow_individual: value.allow_individual ?? true, allow_bulk: value.allow_bulk ?? true,
        sent_at: null, last_client_action_at: null, archived_at: null, created_by: actor.id, created_at: now(), updated_at: now() };
      batches.set(b.id, b);
      event(b.id, "lote_criado", "equipe", actor.username);
      return { ...b };
    },
    async updateBatch(id, value) {
      await tick();
      const b = getBatch(id);
      const allowed = ["title", "month", "approval_mode", "intro_message", "allow_individual", "allow_bulk", "archived_at"];
      if (Object.keys(value).some((k) => !allowed.includes(k))) throw new StoreError(403, "permission denied", "42501");
      if (b.sent_at && value.approval_mode && value.approval_mode !== b.approval_mode) throw fail("modo_travado");
      Object.assign(b, value, { updated_at: now() });
      return { ...b };
    },
    async deleteBatch(id) {
      await tick();
      const b = getBatch(id);
      if (b.sent_at) return [];    // RLS: só lote nunca enviado (nada é apagado)
      for (const [k, i] of items) if (i.batch_id === id) items.delete(k);
      batches.delete(id);
      return [{ id }];
    },
    async listItems(batchId) {
      await tick();
      return [...items.values()].filter((i) => i.batch_id === batchId)
        .sort((a, b) => a.display_order - b.display_order || a.created_at.localeCompare(b.created_at)).map((i) => ({ ...i }));
    },
    async listVersions({ content_id, ids } = {}) {
      await tick();
      return [...versions.values()].filter((v) => (!content_id || v.content_id === content_id) && (!ids || ids.includes(v.id)))
        .sort((a, b) => b.version_number - a.version_number).map((v) => structuredClone(v));
    },
    async listDecisions({ batch_id, content_id } = {}) {
      await tick();
      return decisions.filter((d) => (!batch_id || d.batch_id === batch_id) && (!content_id || d.content_id === content_id)).slice().reverse().map((d) => ({ ...d }));
    },
    async listEvents({ batch_id, content_id, unread } = {}) {
      await tick();
      return events.filter((e) => (!batch_id || e.batch_id === batch_id) && (!content_id || e.content_id === content_id) && (!unread || (!e.read_at && e.actor_type !== "equipe")))
        .slice().reverse().map((e) => ({ ...e, metadata: { ...e.metadata } }));
    },
    async approvalSetItems(actor, { p_batch, p_contents }) {
      await tick(); team(actor);
      const b = openBatch(p_batch);
      const ids = p_contents || [];
      if (ids.length > 200) throw fail("conteudos_demais");
      if (ids.some((id) => contents.get(id)?.client_id !== b.client_id)) throw fail("conteudo_de_outro_cliente");
      for (const item of activeItems(b.id)) {
        if (!ids.includes(item.content_id)) { item.removed_at = now(); event(b.id, "conteudo_removido", "equipe", actor.username, { item_id: item.id, content_id: item.content_id }); }
      }
      ids.forEach((id, index) => {
        const existing = activeItems(b.id).find((i) => i.content_id === id);
        if (existing) { existing.display_order = index + 1; return; }
        const item = { id: randomUUID(), batch_id: b.id, content_id: id, version_id: null, display_order: index + 1, status: "rascunho", decided_at: null, removed_at: null, created_at: stamp() };
        items.set(item.id, item);
        event(b.id, "conteudo_adicionado", "equipe", actor.username, { item_id: item.id, content_id: id });
      });
      return null;
    },
    async approvalPublish(actor, { p_batch, p_items, p_title, p_intro, p_mode, p_expires = null, p_allow_individual = true, p_allow_bulk = true, p_regenerate = false }) {
      await tick(); team(actor);
      const b = openBatch(p_batch);
      if (p_expires && p_expires <= now()) throw fail("expiracao_no_passado");
      if (b.sent_at && p_mode && p_mode !== b.approval_mode) throw fail("modo_travado");
      Object.assign(b, { title: String(p_title || "").trim() || b.title, intro_message: String(p_intro || "").trim() || null, approval_mode: p_mode || b.approval_mode,
        allow_individual: p_allow_individual, allow_bulk: p_allow_bulk, updated_at: now() });
      const sent = send(b.id, p_items || null, actor);
      if (!activeItems(b.id).some((i) => i.status !== "rascunho")) throw fail("nada_para_enviar");
      const link = activeLink(b.id);
      let token;
      if (!link || p_regenerate) token = newLink(b.id, p_expires, "regenerado", actor);
      else { link.expires_at = p_expires || null; token = vault.get(link.secret_id); }
      return { token, sent };
    },
    async approvalResend(actor, { p_batch, p_items }) { await tick(); team(actor); openBatch(p_batch); return send(p_batch, p_items || null, actor); },
    async approvalLinkToken(actor, { p_batch }) {
      await tick(); team(actor);
      const l = activeLink(p_batch);
      return l ? { token: vault.get(l.secret_id), created_at: l.created_at, expires_at: l.expires_at, expired: Boolean(l.expires_at && l.expires_at <= now()) } : null;
    },
    async approvalLinkRegenerate(actor, { p_batch, p_expires = null }) {
      await tick(); team(actor);
      openBatch(p_batch);
      if (!activeItems(p_batch).some((i) => i.status !== "rascunho")) throw fail("nada_para_enviar");
      if (p_expires && p_expires <= now()) throw fail("expiracao_no_passado");
      return { token: newLink(p_batch, p_expires, "regenerado", actor) };
    },
    async approvalLinkRevoke(actor, { p_batch }) {
      await tick(); team(actor);
      for (const l of [...links.values()].filter((x) => x.batch_id === p_batch && !x.revoked_at)) {
        Object.assign(l, { revoked_at: now(), revoked_reason: "desativado" });
        vault.delete(l.secret_id);
        event(p_batch, "link_desativado", "equipe", actor.username, { metadata: { link_id: l.id, motivo: "desativado" } });
      }
      return null;
    },
    /** Como approval_batch_delete: link e histórico do lote apagados; pendentes só deste lote voltam a rascunho */
    async approvalBatchDelete(actor, { p_batch }) {
      await tick(); team(actor);
      getBatch(p_batch);
      for (const i of activeItems(p_batch)) {
        if (!i.content_id || !["aguardando_aprovacao", "reenviado"].includes(i.status)) continue;
        const mode = modeOf(p_batch);
        const elsewhere = [...items.values()].some((o) => o.content_id === i.content_id && o.batch_id !== p_batch && !o.removed_at
          && !batches.get(o.batch_id)?.archived_at && modeOf(o.batch_id) === mode && ["aguardando_aprovacao", "reenviado"].includes(o.status));
        if (["aguardando_aprovacao", "reenviado"].includes(stageStatus(i.content_id, mode)) && !elsewhere) setApproval(i.content_id, "rascunho", mode);
      }
      for (const [id, l] of links) if (l.batch_id === p_batch) { vault.delete(l.secret_id); links.delete(id); }
      for (let k = decisions.length - 1; k >= 0; k -= 1) if (decisions[k].batch_id === p_batch) decisions.splice(k, 1);
      for (let k = events.length - 1; k >= 0; k -= 1) if (events[k].batch_id === p_batch) events.splice(k, 1);
      for (const [id, i] of items) if (i.batch_id === p_batch) items.delete(id);
      batches.delete(p_batch);
      return null;
    },
    /** Como approval_stale: itens que mudaram (só nos campos da etapa) depois do envio */
    async approvalStale(actor, { p_batch = null, p_content = null } = {}) {
      await tick();
      if (!actor?.member || (!p_batch && !p_content)) return [];
      return [...items.values()].filter((i) => !i.removed_at && i.content_id && (!p_batch || i.batch_id === p_batch) && (!p_content || i.content_id === p_content))
        .map((i) => ({ item_id: i.id, batch_id: i.batch_id, content_id: i.content_id, mode: modeOf(i.batch_id), stale: staleItem(i) }));
    },
    async approvalPreview(actor, { p_batch }) { await tick(); team(actor); getBatch(p_batch); return batchJson(p_batch, null, true); },
    async approvalMarkRead(actor, { p_ids = null } = {}) {
      await tick(); team(actor);
      let n = 0;
      events.forEach((e) => { if (!e.read_at && (!p_ids || p_ids.includes(e.id))) { e.read_at = now(); n += 1; } });
      return n;
    },
    async mediaInHistory(actor, { p_path }) {
      await tick();
      return Boolean(actor?.member) && [...versions.values()].some((v) => v.snapshot.assets.some((a) => a.storage_path === p_path));
    },

    /* ---- Funções públicas (só a função "aprovacao", com a chave secreta) ---- */
    async approvalPublicView({ p_token, p_ip }) {
      await tick();
      const { link, problem } = linkCheck(p_token, p_ip);
      if (problem) return { error: problem };
      return batchJson(link.batch_id, link.id);
    },
    async approvalPublicDecide({ p_token, p_ip, p_item, p_version, p_action, p_comment = null, p_name = null, p_session = null }) {
      await tick();
      const { link, problem } = linkCheck(p_token, p_ip);
      if (problem) return { error: problem };
      if (!rateOk(`decisao:${link.id}`, 60, 60)) return { error: "muitas_tentativas" };
      if (!batches.get(link.batch_id).allow_individual) return { error: "nao_permitido" };
      const result = apply(link, p_item, p_version, p_action, p_comment, p_name, p_session, false);
      if (!result.error) afterClient(link.batch_id, p_name);
      return { ...result, view: batchJson(link.batch_id, link.id) };
    },
    async approvalPublicApproveAll({ p_token, p_ip, p_items, p_name = null, p_session = null }) {
      await tick();
      const { link, problem } = linkCheck(p_token, p_ip);
      if (problem) return { error: problem };
      if (!rateOk(`decisao:${link.id}`, 60, 60)) return { error: "muitas_tentativas" };
      if (!batches.get(link.batch_id).allow_bulk) return { error: "nao_permitido" };
      if (!Array.isArray(p_items) || !p_items.length || p_items.length > 200) return { error: "nada_para_aprovar" };
      const approved = []; const skipped = [];
      for (const entry of p_items) {
        const r = apply(link, entry.item, entry.version, "aprovado", null, p_name, p_session, true);
        if (r.error) skipped.push(r); else approved.push(r.item);
      }
      if (approved.length) afterClient(link.batch_id, p_name);
      return { ok: true, approved, skipped, view: batchJson(link.batch_id, link.id) };
    },
    /** Teste: o link passa a ter vencido */
    expireLink(batchId) { const l = activeLink(batchId); if (l) l.expires_at = new Date(Date.now() - 1000).toISOString(); }
  };
}
