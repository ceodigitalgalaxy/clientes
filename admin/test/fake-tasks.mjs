/* Gestão de demandas no Supabase de mentira (SÓ PARA TESTE): as mesmas regras
   da migração 20261116120000_gestao_de_demandas.sql — quem vê, quem cria,
   quem edita, quem pode ser responsável, versão (edição simultânea),
   coluna ↔ status oficial, subtarefa herda o cliente, histórico e a sincronia
   com a aprovação do conteúdo. */

import { randomUUID } from "node:crypto";

const STATUSES = ["a_fazer", "em_andamento", "em_revisao", "aguardando_pessoa", "aguardando_cliente", "ajustes", "concluido"];

export function createFakeTasks({ store, h }) {
  const { sees, editsClient, isAdmin, active, memberName, userById, json, raise, rlsDenied, eq } = h;
  const now = () => new Date().toISOString();
  const columns = [["A fazer", "a_fazer", "cinza"], ["Em andamento", "em_andamento", "azul"], ["Em revisão", "em_revisao", "roxo"],
    ["Aguardando outra pessoa", "aguardando_pessoa", "laranja"], ["Aguardando cliente", "aguardando_cliente", "amarelo"],
    ["Ajustes solicitados", "ajustes", "vermelho"], ["Concluído", "concluido", "verde"]]
    .map(([name, status, color], i) => ({ id: randomUUID(), name, status, color, position: i + 1, hidden: false }));
  const labels = [["Reels", "rosa"], ["Design", "roxo"], ["Captação", "laranja"], ["Edição", "azul"], ["Social media", "verde"],
    ["Cliente prioritário", "amarelo"], ["Aguardando material", "cinza"], ["Ajuste solicitado", "vermelho"]]
    .map(([name, color]) => ({ id: randomUUID(), name, color, archived_at: null }));
  const projects = [];
  const tasks = new Map();
  const assignees = new Map();   // task → Set(user)
  const taskLabels = new Map();  // task → Set(label)
  const events = [];

  const asg = (id) => assignees.get(id) || new Set();
  const seesRow = (u, t) => active(u) && (isAdmin(u) || (t.client_id ? sees(u, t.client_id)
    : (t.created_by === u.id || asg(t.id).has(u.id)
       || [...tasks.values()].some((c) => c.parent_id === t.id && asg(c.id).has(u.id))
       || (t.parent_id && asg(t.parent_id).has(u.id)))));
  const edits = (u, t) => active(u) && (isAdmin(u) || ((!t.client_id || sees(u, t.client_id))
    && (t.created_by === u.id || asg(t.id).has(u.id) || (t.parent_id && tasks.get(t.parent_id)?.created_by === u.id) || (t.client_id && editsClient(u, t.client_id)))));
  const canTake = (target, t) => active(target) && (!t.client_id || sees(target, t.client_id));
  const row = (t) => ({ ...t, task_assignees: [...asg(t.id)].map((user_id) => ({ user_id })), task_labels: [...(taskLabels.get(t.id) || [])].map((label_id) => ({ label_id })) });
  const log = (taskId, type, actor, from = null, to = null, metadata = {}) => events.push({ id: randomUUID(), task_id: taskId, event_type: type, actor_name: actor ? memberName(actor) : (type === "status" ? "Cliente (pelo link)" : "Sistema"), from_value: from, to_value: to, metadata, created_at: now() });

  /** Como private.tasks_prepare: coluna manda no status; mudou só o status, vai para a 1ª coluna daquela etapa */
  function prepare(next, prev, actor) {
    if (next.parent_id) {
      const parent = tasks.get(next.parent_id);
      if (!parent) return "fk";
      if (parent.parent_id) return "subtarefa_de_subtarefa";
      next.client_id = parent.client_id;
      if (!prev && !next.project_id) next.project_id = parent.project_id;
    }
    if (prev) {
      if (next.parent_id !== prev.parent_id) return "nao_pode_mover_subtarefa";
      if ((next.archived_at || null) !== (prev.archived_at || null) && actor && !(isAdmin(actor) || prev.created_by === actor.id)) return "sem_permissao_arquivar";
      next.version = prev.version + 1;
      next.updated_at = now();
      next.created_by = prev.created_by;
    }
    if (next.column_id && (!prev || next.column_id !== prev.column_id)) {
      const col = columns.find((c) => c.id === next.column_id);
      if (col) next.status = col.status;
    } else if (!prev || next.status !== prev.status) {
      next.column_id = [...columns].sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.position - b.position).find((c) => c.status === next.status)?.id || null;
    }
    if (next.status === "concluido" && (!prev || prev.status !== "concluido")) { next.completed_at = now(); next.completed_by = actor?.id || null; }
    else if (next.status !== "concluido") { next.completed_at = null; next.completed_by = null; }
    return null;
  }
  function logChanges(prev, next, actor) {
    const pairs = [["status", "status"], ["due_at", "prazo"], ["priority", "prioridade"], ["title", "titulo"], ["client_id", "cliente"], ["content_id", "conteudo"]];
    for (const [field, type] of pairs) if ((prev[field] ?? null) !== (next[field] ?? null)) log(next.id, type, actor, prev[field] ?? null, next[field] ?? null);
    if ((prev.archived_at || null) !== (next.archived_at || null)) log(next.id, next.archived_at ? "arquivada" : "restaurada", actor);
  }

  /** Como private.sync_tasks_from_content (a aprovação do conteúdo move a demanda ligada) */
  function syncFromContent(before, after) {
    let status = null;
    if (after.final_status === "aprovado" && before.final_status !== "aprovado") status = "concluido";
    else if ((after.approval_status === "ajustes" && before.approval_status !== "ajustes") || (after.final_status === "ajustes" && before.final_status !== "ajustes")) status = "ajustes";
    else if ((["aguardando_aprovacao", "reenviado"].includes(after.approval_status) && before.approval_status !== after.approval_status)
      || (["aguardando_aprovacao", "reenviado"].includes(after.final_status) && before.final_status !== after.final_status)) status = "aguardando_cliente";
    if (!status) return;
    for (const t of tasks.values()) {
      if (t.content_id !== after.id || t.parent_id || t.archived_at || t.status === "concluido" || t.status === status) continue;
      const next = { ...t, status };
      prepare(next, t, null);
      tasks.set(t.id, next);
      logChanges(t, next, null);
    }
  }

  const ids = (params, key) => (params.get(key)?.match(/^in\.\((.*)\)$/)?.[1] || "").split(",").filter(Boolean);

  /** Devolve undefined quando a tabela não é da gestão de demandas */
  async function route(method, table, params, body, user) {
    if (table === "board_columns") {
      if (method === "GET") return [...columns].sort((a, b) => a.position - b.position);
      if (!isAdmin(user)) return method === "POST" ? rlsDenied() : [];
      if (method === "POST") { const c = { id: randomUUID(), hidden: false, position: 0, color: "cinza", ...body }; if (!STATUSES.includes(c.status)) return raise("check"); columns.push(c); return [c]; }
      const id = eq(params, "id");
      const i = columns.findIndex((c) => c.id === id);
      if (i < 0) return [];
      if (method === "PATCH") { columns[i] = { ...columns[i], ...body }; return [columns[i]]; }
      if (method === "DELETE") { columns.splice(i, 1); for (const t of tasks.values()) if (t.column_id === id) t.column_id = null; return []; }
    }
    if (table === "labels") {
      if (method === "GET") return [...labels].sort((a, b) => a.name.localeCompare(b.name));
      if (method === "POST") {
        if (labels.some((l) => l.name.trim().toLowerCase() === String(body.name).trim().toLowerCase())) return { error: json(409, { code: "23505", message: "duplicate key" }) };
        const l = { id: randomUUID(), archived_at: null, ...body }; labels.push(l); return [l];
      }
    }
    if (table === "projects") {
      if (method === "GET") return projects.filter((p) => sees(user, p.client_id));
      if (method === "POST") { if (!editsClient(user, body.client_id)) return rlsDenied(); const p = { id: randomUUID(), status: "ativo", archived_at: null, ...body, created_by: user.id }; projects.push(p); return [p]; }
    }
    if (table === "tasks") {
      if (method === "GET") {
        const id = eq(params, "id");
        const archived = params.get("archived_at");
        return [...tasks.values()].filter((t) => seesRow(user, t) && (!id || t.id === id)
          && (archived === "is.null" ? !t.archived_at : archived === "not.is.null" ? Boolean(t.archived_at) : true))
          .sort((a, b) => a.position - b.position).map(row);
      }
      if (method === "POST") {
        const t = { id: randomUUID(), parent_id: null, client_id: null, project_id: null, content_id: null, description: null, status: "a_fazer", column_id: null, priority: "media", due_at: null, position: 0, completed_at: null, completed_by: null, archived_at: null, created_at: now(), updated_at: now(), ...body, created_by: user.id, version: 1 };
        if (!t.position) t.position = Date.now() / 1000 + Math.random();
        if (!STATUSES.includes(t.status)) return raise("check");
        if (t.client_id && !sees(user, t.client_id)) return rlsDenied();
        if (t.parent_id && !(tasks.get(t.parent_id) && seesRow(user, tasks.get(t.parent_id)))) return rlsDenied();
        const problem = prepare(t, null, user);
        if (problem) return raise(problem);
        if (t.client_id && !sees(user, t.client_id)) return rlsDenied();
        tasks.set(t.id, t);
        log(t.id, "criada", user);
        return [row(t)];
      }
      if (method === "PATCH") {
        const prev = tasks.get(eq(params, "id"));
        const version = params.get("version")?.replace(/^eq\./, "");
        if (!prev || !edits(user, prev) || (version !== undefined && Number(version) !== prev.version)) return [];
        const next = { ...prev, ...body };
        const problem = prepare(next, prev, user);
        if (problem) return raise(problem);
        if (next.client_id && !sees(user, next.client_id) && !isAdmin(user)) return rlsDenied();
        tasks.set(prev.id, next);
        logChanges(prev, next, user);
        return [row(next)];
      }
      if (method === "DELETE") {
        if (!isAdmin(user)) return [];
        const id = eq(params, "id");
        for (const t of [...tasks.values()]) if (t.id === id || t.parent_id === id) tasks.delete(t.id);
        return [];
      }
    }
    if (table === "task_assignees" || table === "task_labels") {
      const isPeople = table === "task_assignees";
      const map = isPeople ? assignees : taskLabels;
      const key = isPeople ? "user_id" : "label_id";
      if (method === "POST") {
        for (const r of [].concat(body)) {
          const t = tasks.get(r.task_id);
          if (!t || !edits(user, t)) return rlsDenied();
          if (isPeople && !canTake(userById(r.user_id), t)) return rlsDenied();
        }
        for (const r of [].concat(body)) {
          const set = map.get(r.task_id) || new Set();
          if (set.has(r[key])) return { error: json(409, { code: "23505", message: "duplicate key" }) };
          set.add(r[key]); map.set(r.task_id, set);
          if (isPeople) log(r.task_id, "responsavel_adicionado", user, null, r.user_id, { name: memberName(userById(r.user_id)) });
        }
        return [];
      }
      if (method === "DELETE") {
        const t = tasks.get(eq(params, "task_id"));
        if (!t || !edits(user, t)) return [];
        for (const id of ids(params, key)) {
          if (map.get(t.id)?.delete(id) && isPeople) log(t.id, "responsavel_removido", user, id, null, { name: memberName(userById(id)) });
        }
        return [];
      }
    }
    if (table === "task_events" && method === "GET") {
      const t = tasks.get(eq(params, "task_id"));
      return t && seesRow(user, t) ? events.filter((e) => e.task_id === t.id).slice().reverse() : [];
    }
    return undefined;
  }

  /** Para os testes: outra pessoa salva a demanda (a versão sobe) */
  function editAsOther(id, patch) {
    const prev = tasks.get(id);
    const next = { ...prev, ...patch };
    prepare(next, prev, null);
    tasks.set(id, next);
    logChanges(prev, next, null);
    return row(next);
  }

  return { route, syncFromContent, editAsOther, all: () => [...tasks.values()].map(row), get: (id) => (tasks.has(id) ? row(tasks.get(id)) : null), columns, labels };
}
