/* SÓ PARA TESTES AUTOMÁTICOS: um Supabase de mentira (login + API do banco)
   que responde aos mesmos pedidos que o painel faz, usando o armazenamento em
   memória (memory-store.mjs). O teste de ponta a ponta intercepta os pedidos
   do navegador ao endereço do Supabase e responde por aqui.
   Imita as regras que importam para a tela: sem login → recusa; quem não é da
   equipe → não vê nada; token vencido → 401; token de renovação gira a cada uso.
   Portal do cliente: rpc/portal_profile e rpc/portal_contents só devolvem o
   cliente ligado ao login e não aceitam outros parâmetros (como o PostgREST).
   Função acesso-cliente: roda o código REAL (supabase/functions/acesso-cliente)
   com a chave secreta de mentira, sobre a API de administração de logins daqui. */

import { randomUUID, randomBytes } from "node:crypto";
import { loginEmail, usernameFromEmail } from "../../site/admin/js/domain/rules.js";
import { createHandler } from "../../supabase/functions/acesso-cliente/handler.js";
import { createHandler as createTeamHandler } from "../../supabase/functions/equipe/handler.js";
import { pairFromStatus } from "../../site/js/domain/approvals.js";
import { createHandler as createApprovalHandler } from "../../supabase/functions/aprovacao/handler.js";

/** Chave secreta de mentira: só o "servidor" (a função) conhece */
export const FAKE_SECRET = "sb_secret_FAKE_SERVIDOR";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS"
};

const json = (status, body) => ({ status, headers: { "content-type": "application/json", ...CORS }, body: body === undefined ? "" : JSON.stringify(body) });

export function createFakeSupabase({ store, publishableKey }) {
  const users = new Map();          // email → { id, email, password, name, member }
  const accessTokens = new Map();   // token → userId
  const refreshTokens = new Map();  // token → userId
  const log = [];
  const brandKits = new Map();      // client_id → identidade para artes (tabela brand_kits)

  const token = () => randomBytes(24).toString("base64url");
  function issue(user) {
    const access = token(); const refresh = token();
    accessTokens.set(access, user.id);
    refreshTokens.set(refresh, user.id);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: { id: user.id, email: user.email, user_metadata: { name: user.name } } };
  }
  const userById = (id) => [...users.values()].find((u) => u.id === id);

  /* ---- Perfis da equipe: as mesmas regras do banco (RLS e funções) ---- */
  const teamMembers = () => [...users.values()].filter((u) => u.member);
  const active = (u) => Boolean(u?.member && u.profile?.active !== false);
  const isAdmin = (u) => active(u) && u.profile.role === "admin";
  const sees = (u, clientId) => active(u) && (u.profile.role === "admin" || u.profile.all_clients || u.profile.client_ids.includes(clientId));
  const editsClient = (u, clientId) => active(u) && (u.profile.role === "admin" || (u.profile.edit_scope === "todos" && sees(u, clientId)));
  const sends = (u, clientId) => active(u) && (u.profile.role === "admin" || (u.profile.can_send_approval && sees(u, clientId)));
  const editsContent = (u, c) => Boolean(c) && (editsClient(u, c.client_id) || (sees(u, c.client_id) && store.listAssignees(c.id).includes(u.id)));
  const memberName = (u) => u?.profile?.name || usernameFromEmail(u?.email) || "Sistema";
  const memberRow = (u) => ({ user_id: u.id, role: u.profile.role, active: u.profile.active !== false, name: u.profile.name ?? null, email: u.profile.email ?? null,
    job_title: u.profile.job_title ?? null, all_clients: u.profile.all_clients, edit_scope: u.profile.edit_scope, can_send_approval: u.profile.can_send_approval });
  const rlsDenied = () => ({ error: json(403, { code: "42501", message: "new row violates row-level security policy" }) });
  const raise = (key) => ({ error: json(400, { code: "P0001", message: key }) });
  // Avisos: só para quem está ativo e enxerga o cliente (como private.notify)
  store.canReceive = (userId, clientId) => sees(userById(userId), clientId);
  store.adminIds = () => teamMembers().filter((u) => isAdmin(u)).map((u) => u.id);
  const defaultProfile = (extra = {}) => ({ role: "admin", active: true, all_clients: true, client_ids: [], edit_scope: "todos", can_send_approval: true, name: null, email: null, job_title: null, ...extra });
  /** Como o gatilho agency_members_guard */
  function memberGuard(target, next, actorId) {
    if (actorId && target.id === actorId && (next.role !== "admin" || next.active === false)) return "nao_pode_proprio_acesso";
    const wasAdmin = target.profile.role === "admin" && target.profile.active !== false;
    const staysAdmin = next.role === "admin" && next.active !== false;
    if (wasAdmin && !staysAdmin && !teamMembers().some((u) => u.id !== target.id && u.profile.role === "admin" && u.profile.active !== false)) return "ultimo_admin";
    return null;
  }

  function eq(params, column, op = "eq") {
    const value = params.get(column);
    return value && value.startsWith(`${op}.`) ? decodeURIComponent(value.slice(op.length + 1)) : undefined;
  }
  function range(params, column) {
    const out = {};
    for (const value of params.getAll(column)) {
      if (value.startsWith("gte.")) out.from = value.slice(4);
      if (value.startsWith("lte.")) out.to = value.slice(4);
    }
    return out;
  }

  /** Funções do portal: o cliente vem da sessão, nunca de um parâmetro */
  async function rpc(name, body, user) {
    const keys = Object.keys(body || {}).sort().join(",");
    if (name === "portal_profile" && keys === "") return store.portalProfile(user.id);
    if (name === "portal_contents" && keys === "p_from,p_to") return (await store.portalContents(user.id, body.p_from, body.p_to)).map(({ assets, decision, ...row }) => row);
    if (name === "portal_client" && keys === "") return store.portalProfile(user.id);
    if (name === "portal_calendar" && keys === "p_from,p_to") return store.portalContents(user.id, body.p_from, body.p_to);
    if (name === "portal_agenda" && keys === "p_from,p_to") return store.portalAgenda(user.id, body.p_from, body.p_to);
    if (name === "portal_brand_kit" && keys === "") {
      // Como a função: cliente da sessão, ativo, com identidade liberada (senão null)
      const member = store.findMembers({ userId: user.id })[0];
      const profile = member ? (await store.portalProfile(user.id))[0] : null;
      const kit = member && brandKits.get(member.client_id);
      return profile && kit?.enabled ? { client: profile.name, colors: kit.colors, logos: kit.logos, units: kit.units, campaigns: kit.campaigns, models: kit.models || ["oferta", "plano", "aviso"], legal: kit.legal } : null;
    }
    const actor = { id: user.id, role: user.member ? "equipe" : "cliente", username: usernameFromEmail(user.email) };
    if (name === "ad_transition" && ["p_action,p_ad_id", "p_action,p_ad_id,p_message"].includes(keys)) return store.adTransition(actor, body);
    if (name === "portal_ads" && keys === "") return (await store.portalAds(user.id)).map(({ creative_stage, ...row }) => row);
    if (name === "portal_ad_list" && keys === "") return store.portalAds(user.id);
    if (name === "portal_ad_decide" && ["p_ad_id,p_decision,p_message,p_version", "p_ad_id,p_decision,p_version"].includes(keys)) return store.portalAdDecide(actor, body);
    if (name === "portal_decide" && ["p_content_id,p_decision,p_message,p_version", "p_content_id,p_decision,p_version"].includes(keys)) return store.portalDecide(user.id, body);
    if (name === "team_directory" && keys === "") {
      if (!active(user)) return [];
      return teamMembers().filter((u) => u.profile.active !== false || isAdmin(user)).map((u) => ({
        user_id: u.id, username: usernameFromEmail(u.email), name: u.profile.name, job_title: u.profile.job_title, role: u.profile.role, active: u.profile.active !== false,
        all_clients: u.profile.all_clients, client_ids: [...u.profile.client_ids], edit_scope: u.profile.edit_scope, can_send_approval: u.profile.can_send_approval,
        email: isAdmin(user) ? u.profile.email : null
      }));
    }
    /* Central de aprovação (equipe): as funções conferem cliente e permissão (assert_batch) */
    const team = { id: user.id, member: active(user), username: usernameFromEmail(user.email) };
    if (name.startsWith("approval_") && !name.startsWith("approval_public_") && body?.p_batch) {
      const client = store.batchClient(body.p_batch);
      if (client) {
        const need = name === "approval_batch_delete" ? isAdmin(user) : ["approval_link_token", "approval_preview", "approval_stale"].includes(name) ? sees(user, client) : sends(user, client);
        if (!need) return raise("sem_permissao");
      }
    }
    const approvalRpc = {
      approval_set_items: ["p_batch,p_contents", "approvalSetItems"],
      approval_publish: [null, "approvalPublish"],
      approval_resend: ["p_batch,p_items", "approvalResend"],
      approval_link_token: ["p_batch", "approvalLinkToken"],
      approval_link_regenerate: [null, "approvalLinkRegenerate"],
      approval_link_revoke: ["p_batch", "approvalLinkRevoke"],
      approval_preview: ["p_batch", "approvalPreview"],
      approval_mark_read: [null, "approvalMarkRead"],
      approval_batch_delete: ["p_batch", "approvalBatchDelete"],
      approval_stale: [null, "approvalStale"],
      media_in_history: ["p_path", "mediaInHistory"]
    }[name];
    if (approvalRpc && (!approvalRpc[0] || approvalRpc[0] === keys)) return store[approvalRpc[1]](team, body || {});
    // As públicas só a chave secreta executa (como o GRANT para service_role)
    if (name.startsWith("approval_public_")) return { error: json(404, { code: "PGRST202", message: "Could not find the function" }) };
    return { error: json(404, { code: "PGRST202", message: "Could not find the function with the given parameters" }) };
  }

  async function rest(method, table, params, body, user, single) {
    if (table.startsWith("rpc/") && method === "POST") return rpc(table.slice(4), body, user);
    if (table === "agency_members") {
      const id = eq(params, "user_id");
      if (method === "GET") {
        if (!user.member) return [];
        if (id === user.id) return [memberRow(user)];
        return isAdmin(user) ? teamMembers().filter((u) => !id || u.id === id).map(memberRow) : [];
      }
      if (method === "PATCH") {
        const target = userById(id);
        if (!isAdmin(user) || !target?.member) return [];
        const next = { ...target.profile, ...body };
        const problem = memberGuard(target, next, user.id);
        if (problem) return raise(problem);
        target.profile = next;
        if (next.active === false) for (const map of [accessTokens, refreshTokens]) for (const [t, uid] of map) if (uid === target.id) map.delete(t);
        return [memberRow(target)];
      }
      return rlsDenied();
    }
    if (table === "agency_settings") {
      if (!active(user)) return method === "GET" ? [] : rlsDenied();
      if (method === "GET") return [store.getSettings()];
      if (method === "PATCH") return isAdmin(user) ? [store.updateSettings(body)] : [];
    }
    if (table === "agency_member_clients") {
      if (!isAdmin(user)) return method === "GET" ? [] : rlsDenied();
      if (method === "POST") { for (const row of [].concat(body)) userById(row.user_id)?.profile.client_ids.push(row.client_id); return []; }
      if (method === "DELETE") {
        const target = userById(eq(params, "user_id"));
        const out = (params.get("client_id")?.match(/^in\.\((.*)\)$/)?.[1] || "").split(",");
        if (target) target.profile.client_ids = target.profile.client_ids.filter((c) => !out.includes(c));
        return [];
      }
    }
    // Quem não é da equipe (ou está desativado) não enxerga nada nas tabelas e não grava nada (como o RLS)
    if (!active(user)) {
      if (method === "GET") return [];
      return { error: json(403, { code: "42501", message: "new row violates row-level security policy" }) };
    }
    const id = eq(params, "id");
    if (table === "brand_kits") {
      if (method === "GET") { const kit = brandKits.get(eq(params, "client_id")); return kit ? [kit] : []; }
      if (method === "POST") {
        await store.getClient(body.client_id);
        const kit = { ...body, updated_at: new Date().toISOString() };
        brandKits.set(body.client_id, kit);
        return [kit];
      }
    }
    if (table === "clients") {
      if (method === "GET" && id) return sees(user, id) ? [await store.getClient(id)] : [];
      if (method === "GET") return (await store.listClients()).filter((c) => sees(user, c.id)).map(({ contents_count, portal_users, ...c }) => ({ ...c, contents: [{ count: contents_count }], client_members: isAdmin(user) ? portal_users.map((username) => ({ username })) : [] }));
      if (!isAdmin(user)) return method === "POST" ? rlsDenied() : [];
      if (method === "POST") return [await store.createClient(body)];
      if (method === "PATCH" && Object.keys(body).join() === "logo_path") return [await store.setClientLogo(id, body.logo_path)];
      if (method === "PATCH") return [await store.updateClient(id, body)];
      if (method === "DELETE") { await store.deleteClient(id); return [{ id }]; }
    }
    if (table === "content_assets") {
      if (method === "GET") return store.listAssets(eq(params, "content_id"));
      if (method === "POST") {
        if (!editsContent(user, store.peekContent(body.content_id))) return rlsDenied();
        return [await store.addAsset(body)];
      }
      if (method === "PATCH" && Object.keys(body).join() === "role") return [await store.setAssetRole(id, body.role)];
      if (method === "PATCH") return [await store.moveAsset(id, body.position)];
      if (method === "DELETE") return [await store.deleteAsset(id)];
    }
    if (table === "ads") {
      const actor = { id: user.id, role: "equipe", username: usernameFromEmail(user.email) };
      if (method === "GET" && id) return [await store.getAd(id)];
      if (method === "GET") return store.listAds({ client_id: eq(params, "client_id"), status: eq(params, "status") });
      if (method === "POST") return [await store.createAd(body, actor)];
      const many = params.get("id")?.match(/^in\.\((.*)\)$/)?.[1];
      if (method === "PATCH" && many !== undefined && Object.keys(body).join() === "creative_stage") return store.setAdsStage(many.split(",").filter(Boolean), body.creative_stage);
      if (method === "PATCH") return [await store.updateAd(id, body)];
      if (method === "DELETE") { await store.deleteAd(id); return [{ id }]; }
    }
    if (table === "ad_assets") {
      if (method === "POST") return [await store.addAdAsset(body)];
      if (method === "PATCH") return [await store.moveAdAsset(id, body.position)];
      if (method === "DELETE") return [await store.deleteAdAsset(id)];
    }
    if (table === "ad_events" && method === "GET") return store.listAdEvents(eq(params, "ad_id"));
    if (table === "ad_versions" && method === "GET") return store.listAdVersions(eq(params, "ad_id"));
    if (table === "content_approvals" && method === "GET") return store.listApprovals(eq(params, "content_id"));
    /* Central de aprovação (RLS: equipe lê; lotes com colunas liberadas) */
    if (table === "approval_batch_summary" && method === "GET") return (await store.listBatchSummary({ client_id: eq(params, "client_id") })).filter((b) => sees(user, b.client_id));
    if (table === "approval_batches") {
      const actor = { id: user.id, member: true, username: usernameFromEmail(user.email) };
      if (method === "POST") return sends(user, body.client_id) ? [await store.createBatch(body, actor)] : rlsDenied();
      if (method === "PATCH") return sends(user, store.batchClient(id)) ? [await store.updateBatch(id, body)] : [];
      if (method === "DELETE") return isAdmin(user) ? store.deleteBatch(id) : [];
    }
    if (table === "approval_items" && method === "GET") return store.listItems(eq(params, "batch_id"));
    if (table === "content_versions" && method === "GET") {
      const ids = params.get("id")?.match(/^in\.\((.*)\)$/)?.[1];
      return store.listVersions({ content_id: eq(params, "content_id"), ids: ids === undefined ? undefined : ids.split(",").filter(Boolean) });
    }
    if (table === "approval_decisions" && method === "GET") return store.listDecisions({ batch_id: eq(params, "batch_id"), content_id: eq(params, "content_id") });
    if (table === "approval_events" && method === "GET") return store.listEvents({ batch_id: eq(params, "batch_id"), content_id: eq(params, "content_id"), unread: params.get("read_at") === "is.null" });
    if (table === "content_assignees") {
      const contentId = eq(params, "content_id");
      if (method === "GET") { const c = store.peekContent(contentId); return c && sees(user, c.client_id) ? store.listAssignees(contentId).map((user_id) => ({ user_id })) : []; }
      if (method === "POST") {
        for (const row of [].concat(body)) {
          const c = store.peekContent(row.content_id);
          const target = userById(row.user_id);
          if (!c || !editsClient(user, c.client_id) || !target || !sees(target, c.client_id)) return rlsDenied();
        }
        for (const row of [].concat(body)) store.addAssignee(row.content_id, row.user_id, memberName(user), memberName(userById(row.user_id)), user.id);
        return [];
      }
      if (method === "DELETE") {
        const c = store.peekContent(contentId);
        if (!c || !editsClient(user, c.client_id)) return [];
        const out = (params.get("user_id")?.match(/^in\.\((.*)\)$/)?.[1] || "").split(",").filter(Boolean);
        out.forEach((uid) => store.removeAssignee(contentId, uid, memberName(user), memberName(userById(uid))));
        return [];
      }
    }
    if (table === "content_events" && method === "GET") {
      const contentId = eq(params, "content_id");
      if (!contentId) {
        // Atividade recente: todos os conteúdos que a pessoa enxerga, com título e cliente
        const limit = Number(params.get("limit")) || 10;
        return store.allContentEvents().map((e) => ({ e, c: store.peekContent(e.content_id) })).filter(({ c }) => c && sees(user, c.client_id))
          .slice(0, limit).map(({ e, c }) => ({ ...e, contents: { title: c.title, client_id: c.client_id } }));
      }
      const c = store.peekContent(contentId);
      return c && sees(user, c.client_id) ? store.listContentEvents(c.id) : [];
    }
    if (table === "content_comments") {
      if (method === "GET") { const c = store.peekContent(eq(params, "content_id")); return c && sees(user, c.client_id) ? store.listComments(c.id) : []; }
      if (method === "POST") {
        const c = store.peekContent(body.content_id);
        if (!c || !sees(user, c.client_id)) return rlsDenied();
        return [store.addComment(body, { id: user.id, name: memberName(user) })];
      }
      if (method === "DELETE") {
        const cid = eq(params, "id");
        if (store.commentAuthor(cid) === user.id || isAdmin(user)) store.deleteComment(cid);
        return [];
      }
    }
    if (table === "notifications") {
      if (method === "GET") return store.listNotifications(user.id).slice(0, Number(params.get("limit")) || 30);
      if (method === "PATCH") {
        const ids = params.get("id")?.match(/^in\.\((.*)\)$/)?.[1]?.split(",");
        store.markNotificationsRead(user.id, ids || null);
        return [];
      }
    }
    if (table === "contents") {
      // Status de aprovação: só quem pode enviar para aprovação (gatilho contents_guard_approval)
      const approvalBlocked = (c, next) => {
        if (sends(user, c.client_id)) return false;
        const pair = "status" in next && !("approval_status" in next) ? pairFromStatus(next.status, c.approval_status, c.production_status) : next;
        return ("approval_status" in pair && (pair.approval_status ?? "rascunho") !== c.approval_status) || ("final_status" in next && next.final_status !== (c.final_status || "rascunho"));
      };
      if (method === "GET" && id) { const c = store.peekContent(id); if (c && !sees(user, c.client_id)) return []; return [await store.getContent(id)]; }
      if (method === "GET") return (await store.listContents({ client_id: eq(params, "client_id"), status: eq(params, "status"), ...range(params, "scheduled_date") })).filter((c) => sees(user, c.client_id)).map(({ assets_count, assignees, ...c }) => ({ ...c, content_assets: [{ count: assets_count }], content_assignees: assignees.map((user_id) => ({ user_id })) }));
      if (method === "POST") {
        const rows = [].concat(body);
        if (rows.some((r) => !editsClient(user, r.client_id))) return rlsDenied();
        if (rows.some((r) => approvalBlocked({ client_id: r.client_id, approval_status: "rascunho", final_status: "rascunho", production_status: null }, r))) return raise("sem_permissao_aprovacao");
        const created = Array.isArray(body) ? await store.createContents(body) : [await store.createContent(body)];
        created.forEach((c) => store.logChanges(null, c, memberName(user)));
        return created;
      }
      if (method === "PATCH" || method === "DELETE") {
        const inIds = params.get("id")?.match(/^in\.\((.*)\)$/)?.[1];
        const targets = await Promise.all((inIds !== undefined ? inIds.split(",").filter(Boolean) : [id]).map((one) => store.peekContent(one)));
        if (method === "DELETE" && !isAdmin(user)) return [];
        if (method === "PATCH") {
          if (targets.some((c) => c && !editsContent(user, c))) return [];
          if (targets.some((c) => c && approvalBlocked(c, body))) return raise("sem_permissao_aprovacao");
          const result = await patchContents(params, body, id);
          for (const after of result) {
            const before = targets.find((t) => t?.id === after.id);
            store.logChanges(before, after, memberName(user));
            if (before) store.notifyAdjustment(before, after, { id: user.id, name: memberName(user) });
          }
          return result;
        }
      }
    }
    if (table === "contents") return patchContents(params, body, id, method);
    if (table === "client_calendar_items" && method === "GET") {
      return store.listClientCalendar(eq(params, "client_id"), range(params, "scheduled_date"));
    }
    return { error: json(404, { code: "PGRST205", message: "not found" }) };
  }

  /** Gravações em conteúdos (depois das permissões) */
  async function patchContents(params, body, id, method = "PATCH") {
    {
      const inIds = params.get("id")?.match(/^in\.\((.*)\)$/)?.[1];
      if (method === "PATCH" && inIds !== undefined && Object.keys(body).join() === "status") {
        const ids = inIds.split(",").filter(Boolean);
        const found = [];
        for (const one of ids) { if (await store.getContent(one).catch(() => null)) found.push(await store.setContentStatus(one, body.status)); }
        return found;
      }
      if (method === "PATCH" && Object.keys(body).join() === "status") return [await store.setContentStatus(id, body.status)];
      if (method === "PATCH" && Object.keys(body).join() === "scheduled_date") return [await store.moveContent(id, body.scheduled_date)];
      if (method === "PATCH" && Object.keys(body).join() === "production_status") return [await store.setContentProduction(id, body.production_status)];
      if (method === "PATCH") return [await store.updateContent(id, body)];
      if (method === "DELETE") { await store.deleteContent(id); return [{ id }]; }
    }
    return [];
  }

  /* ---- Armazenamento de arquivos (Storage), com as mesmas regras dos buckets ---- */
  const files = new Map();        // "bucket/caminho" → { type, body }
  const signTokens = new Map();   // token → "bucket/caminho"
  const BUCKETS = {
    "client-logos": { public: true, max: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
    "ad-media": { public: false, max: 50 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"] },
    "content-media": { public: false, max: 50 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "application/pdf"] }
  };
  const serve = (key) => {
    const file = files.get(key);
    return file ? { status: 200, headers: { "content-type": file.type, ...CORS }, body: file.body } : json(404, { message: "Object not found" });
  };
  function storageRoute({ method, pathname, searchParams, headers, body, bodyBuffer }) {
    const rest = pathname.slice("/storage/v1/object/".length).split("/").map(decodeURIComponent);
    // Links públicos e assinados não levam chave nem login (como no Supabase)
    if (method === "GET" && rest[0] === "public" && BUCKETS[rest[1]]?.public) return serve(rest.slice(1).join("/"));
    if (method === "GET" && rest[0] === "sign") {
      const key = rest.slice(1).join("/");
      return signTokens.get(searchParams.get("token")) === key ? serve(key) : json(400, { message: "Invalid signature" });
    }
    // Chave secreta (só a função "aprovacao"): assina os arquivos que o banco liberou
    if (headers.apikey === FAKE_SECRET && method === "POST" && rest[0] === "sign") {
      const bucket = rest[1];
      const { paths = [] } = JSON.parse(body || "{}");
      return json(200, paths.map((path) => {
        const key = `${bucket}/${path}`;
        if (!files.has(key)) return { path, signedURL: null, error: "not found" };
        const token = randomBytes(12).toString("hex");
        signTokens.set(token, key);
        return { path, signedURL: `/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}?token=${token}`, error: null };
      }));
    }
    if (headers.apikey !== publishableKey) return json(401, { message: "Invalid API key" });
    const user = userById(accessTokens.get((headers.authorization || "").slice(7)));
    if (!user) return json(400, { statusCode: "403", message: "jwt expired" });
    if (method === "POST" && rest[0] === "sign") {
      const bucket = rest[1];
      const { paths = [] } = JSON.parse(body || "{}");
      return json(200, paths.map((path) => {
        const key = `${bucket}/${path}`;
        const allowed = user.member || (bucket === "content-media" && store.canReadMedia(user.id, path)) || (bucket === "ad-media" && store.canReadAdMedia(user.id, path));
        if (!allowed || !files.has(key)) return { path, signedURL: null, error: "Either the object does not exist or you do not have access to it" };
        const token = randomBytes(12).toString("hex");
        signTokens.set(token, key);
        return { path, signedURL: `/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}?token=${token}`, error: null };
      }));
    }
    const bucket = BUCKETS[rest[0]];
    if (!bucket) return json(404, { message: "Bucket not found" });
    if (!user.member) return json(403, { statusCode: "403", message: "new row violates row-level security policy" });
    if (method === "POST") {
      const key = rest.join("/");
      const type = headers["content-type"] || "";
      const data = bodyBuffer || Buffer.from(body || "");
      if (!bucket.types.includes(type)) return json(415, { statusCode: "415", message: `mime type ${type} is not supported` });
      if (data.length > bucket.max) return json(413, { statusCode: "413", message: "The object exceeded the maximum allowed size" });
      if (files.has(key)) return json(409, { statusCode: "409", message: "The resource already exists" });
      files.set(key, { type, body: data });
      return json(200, { Key: key });
    }
    if (method === "DELETE") {
      const { prefixes = [] } = JSON.parse(body || "{}");
      prefixes.forEach((p) => files.delete(`${rest[0]}/${p}`));
      return json(200, prefixes.map((name) => ({ name })));
    }
    return json(405, { message: "Method not allowed" });
  }

  /** Pedidos feitos com a chave secreta (só a função): sem RLS */
  async function serviceRest(method, table, params, body) {
    if (table === "agency_members") {
      const id = eq(params, "user_id");
      const user = userById(id);
      if (method === "GET") return user && user.member ? [memberRow(user)] : [];
      if (method === "POST") {
        const target = userById(body.user_id);
        if (!target) return { error: json(409, { code: "23503", message: "foreign key" }) };
        const { user_id, ...fields } = body;
        target.member = true;
        target.profile = defaultProfile({ ...fields });
        return [];
      }
      if (method === "PATCH") {
        if (!user?.member) return [];
        const next = { ...user.profile, ...body };
        const problem = memberGuard(user, next, null);
        if (problem) return raise(problem);
        user.profile = next;
        return [];
      }
    }
    if (table === "agency_member_clients" && method === "POST") {
      for (const row of [].concat(body)) userById(row.user_id)?.profile.client_ids.push(row.client_id);
      return [];
    }
    if (table === "clients" && method === "GET") {
      const id = eq(params, "id");
      try { const c = await store.getClient(id); return [{ id: c.id, name: c.name, active: c.active }]; } catch { return []; }
    }
    if (table === "client_members" && method === "GET") return store.findMembers({ username: eq(params, "username"), userId: eq(params, "user_id") });
    if (table === "client_members" && method === "POST") {
      try { store.addMember(body.user_id, body.client_id, body.username); return []; }
      catch { return { error: json(409, { code: "23505", message: "duplicate key" }) }; }
    }
    return { error: json(404, { code: "PGRST205", message: "not found" }) };
  }

  const fake = {
    brandKits,
    log,
    files,
    failAuthNext: 0,   // pedidos de login que devem dar "muitas tentativas"
    offline: false,    // simula internet caída (todo pedido falha)

    /** kind "equipe" (member = acesso ao painel) ou "cliente" (clientId = cliente do portal) */
    addUser(username, password, { name = username, member = true, kind = "equipe", clientId = null, profile = {} } = {}) {
      const user = { id: randomUUID(), email: loginEmail(username, kind), password, name, member: kind === "equipe" && member };
      if (user.member) user.profile = defaultProfile({ name, ...profile });
      users.set(user.email, user);
      if (kind === "cliente" && clientId) store.addMember(user.id, clientId, username);
      return user;
    },
    /** Todos os tokens de acesso vencem (a renovação ainda funciona) */
    expireAccessTokens() { accessTokens.clear(); },
    /** Sessões encerradas no servidor (ex.: senha trocada): nem a renovação funciona */
    revokeAll() { accessTokens.clear(); refreshTokens.clear(); },

    async handle({ method, url, headers, body, bodyBuffer }) {
      const { pathname, searchParams } = new URL(url);
      if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
      if (this.offline) return "abort";
      const authorization = headers.authorization || "";
      log.push({ method, path: pathname, query: searchParams.toString(), hasToken: authorization.startsWith("Bearer ") });
      if (pathname.startsWith("/storage/v1/object/")) return storageRoute({ method, pathname, searchParams, headers, body, bodyBuffer });
      // Funções do Supabase: não exigem apikey (a função confere quem chama)
      if (pathname === "/functions/v1/acesso-cliente") return this.callFunction({ method, url, headers, body });
      if (pathname === "/functions/v1/aprovacao") return this.callApproval({ method, url, headers, body });
      if (pathname === "/functions/v1/equipe") return this.callTeam({ method, url, headers, body });
      const secret = headers.apikey === FAKE_SECRET;
      if (!secret && headers.apikey !== publishableKey) return json(401, { message: "Invalid API key" });
      const data = body ? JSON.parse(body) : undefined;

      /* ---- Administração de logins (só com a chave secreta) ---- */
      if (pathname === "/auth/v1/user" && method === "GET") {
        const userId = accessTokens.get(authorization.slice(7));
        const user = userId && userById(userId);
        return user ? json(200, { id: user.id, email: user.email }) : json(401, { msg: "invalid JWT" });
      }
      if (pathname.startsWith("/auth/v1/admin/")) {
        if (!secret) return json(401, { msg: "This endpoint requires a valid service role key" });
        const id = pathname.split("/")[5];
        if (method === "POST" && !id) {
          if (users.has(data.email)) return json(422, { error_code: "email_exists", msg: "already registered" });
          const user = { id: randomUUID(), email: data.email, password: data.password, name: data.user_metadata?.name || "", member: false };
          users.set(user.email, user);
          return json(200, { id: user.id, email: user.email });
        }
        const user = userById(id);
        if (!user) return json(404, { error_code: "user_not_found" });
        if (method === "PUT" && "ban_duration" in data) {
          user.banned = data.ban_duration !== "none";
          if (user.banned) for (const map of [accessTokens, refreshTokens]) for (const [t, uid] of map) if (uid === id) map.delete(t);
          return json(200, { id });
        }
        if (method === "PUT") {
          user.password = data.password;
          for (const [t, uid] of refreshTokens) if (uid === id) refreshTokens.delete(t);
          return json(200, { id });
        }
        if (method === "DELETE") {
          users.delete(user.email);
          store.removeMember(id);
          for (const map of [accessTokens, refreshTokens]) for (const [t, uid] of map) if (uid === id) map.delete(t);
          return json(200, {});
        }
      }
      // Funções públicas de aprovação: só com a chave secreta (a função "aprovacao")
      const publicRpc = { "/rest/v1/rpc/approval_public_view": "approvalPublicView", "/rest/v1/rpc/approval_public_decide": "approvalPublicDecide", "/rest/v1/rpc/approval_public_approve_all": "approvalPublicApproveAll" }[pathname];
      if (secret && publicRpc && method === "POST") return json(200, await store[publicRpc](data));
      if (secret && pathname.startsWith("/rest/v1/")) {
        const result = await serviceRest(method, pathname.slice("/rest/v1/".length), searchParams, data);
        if (result?.error) return result.error;
        return json(method === "POST" ? 201 : 200, result);
      }

      /* ---- Login ---- */
      if (pathname === "/auth/v1/token" && method === "POST") {
        const grant = searchParams.get("grant_type");
        if (grant === "password") {
          if (this.failAuthNext > 0) { this.failAuthNext -= 1; return json(429, { error_code: "over_request_rate_limit", msg: "Too many requests" }); }
          const user = users.get(String(data?.email || "").toLowerCase());
          if (!user || user.password !== data?.password) return json(400, { error: "invalid_grant", error_code: "invalid_credentials", error_description: "Invalid login credentials" });
          if (user.banned) return json(400, { error_code: "user_banned", msg: "User is banned" });
          return json(200, issue(user));
        }
        if (grant === "refresh_token") {
          const userId = refreshTokens.get(data?.refresh_token);
          if (!userId) return json(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
          refreshTokens.delete(data.refresh_token);   // gira a cada uso
          return json(200, issue(userById(userId)));
        }
      }
      if (pathname === "/auth/v1/logout" && method === "POST") {
        const userId = accessTokens.get(authorization.slice(7));
        if (userId) for (const [t, id] of refreshTokens) if (id === userId) refreshTokens.delete(t);
        return { status: 204, headers: CORS, body: "" };
      }

      /* ---- API do banco ---- */
      if (pathname.startsWith("/rest/v1/")) {
        const userId = accessTokens.get(authorization.slice(7));
        if (!authorization.startsWith("Bearer ")) return json(401, { code: "42501", message: "permission denied" });
        if (!userId) return json(401, { code: "PGRST303", message: "JWT expired" });
        const single = (headers.accept || "").includes("vnd.pgrst.object");
        let result;
        try {
          result = await rest(method, pathname.slice("/rest/v1/".length), searchParams, data, userById(userId), single);
        } catch (error) {
          if (error.code === "offline") return "abort";
          const status = error.code === "PGRST116" ? 406 : error.status || 500;
          return json(status, { code: error.code, message: error.message });
        }
        if (result?.error) return result.error;
        const isRpc = pathname.startsWith("/rest/v1/rpc/");
        if (single) return result.length === 1 ? json(method === "POST" ? 201 : 200, result[0]) : json(406, { code: "PGRST116", message: "0 rows" });
        return json(method === "POST" && !isRpc ? 201 : 200, result);
      }
      return json(404, { message: "not found" });
    }
  };

  // A função de verdade, com a chave secreta de mentira, falando com este Supabase
  const functionHandler = createHandler(
    { url: "https://peieimwpkrattuldmjux.supabase.co", secret: FAKE_SECRET, publishable: publishableKey },
    async (url, init = {}) => {
      const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      const answer = await fake.handle({ method: init.method || "GET", url, headers, body: init.body });
      if (answer === "abort") throw new TypeError("rede");
      return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
    },
    { allowedOrigins: ["http://localhost:5611", "http://localhost:5612", "http://localhost:5600"] }
  );
  // A função pública "aprovacao" de verdade, com a chave secreta de mentira
  const approvalFetch = async (url, init = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const answer = await fake.handle({ method: init.method || "GET", url, headers, body: init.body });
    if (answer === "abort") throw new TypeError("rede");
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
  const approvalHandler = createApprovalHandler({ url: "https://peieimwpkrattuldmjux.supabase.co", secret: FAKE_SECRET }, approvalFetch,
    { allowedOrigins: ["http://localhost:5611", "http://localhost:5612", "http://localhost:5600", "http://localhost:5613", "http://localhost:5621", "http://localhost:5631"] });
  fake.callApproval = async ({ method, url, headers, body }) => {
    const response = await approvalHandler(new Request(url, { method, headers: { ...headers, "x-forwarded-for": headers["x-forwarded-for"] || "203.0.113.7" }, body: method === "GET" || method === "HEAD" ? undefined : body }));
    return { status: response.status, headers: Object.fromEntries(response.headers), body: response.status === 204 ? "" : await response.text() };
  };
  const teamHandler = createTeamHandler({ url: "https://peieimwpkrattuldmjux.supabase.co", secret: FAKE_SECRET, publishable: publishableKey }, approvalFetch,
    { allowedOrigins: ["http://localhost:5611", "http://localhost:5612", "http://localhost:5600", "http://localhost:5641"] });
  fake.callTeam = async ({ method, url, headers, body }) => {
    const response = await teamHandler(new Request(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body }));
    return { status: response.status, headers: Object.fromEntries(response.headers), body: response.status === 204 ? "" : await response.text() };
  };
  fake.callFunction = async ({ method, url, headers, body }) => {
    const response = await functionHandler(new Request(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body }));
    return { status: response.status, headers: Object.fromEntries(response.headers), body: response.status === 204 ? "" : await response.text() };
  };
  return fake;
}
