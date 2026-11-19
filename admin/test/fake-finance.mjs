/* Financeiro no Supabase de mentira (SÓ PARA TESTE): as mesmas regras da
   migração 20261121120000_financeiro_base.sql — quem vê (admin ou acesso
   "ver"), quem muda (só admin), nada se apaga, envio repetido (request_id)
   recusado com 23505, baixa parcial sem passar do valor, estorno uma vez só,
   cancelamento só sem baixa ativa, versão (edição simultânea), status e
   saldos calculados como nas visões, e a trilha de auditoria. */

import { randomUUID } from "node:crypto";
import { todayBR } from "../../site/admin/js/domain/finance.js";

const ENTRY_COLS = ["direction", "description", "amount_cents", "category_id", "account_id", "client_id", "revenue_kind", "counterparty",
  "competence_date", "due_date", "confirmed", "invoice_number", "notes", "request_id"];
const ENTRY_UPDATE = ["description", "amount_cents", "category_id", "account_id", "client_id", "revenue_kind", "counterparty",
  "competence_date", "due_date", "confirmed", "invoice_number", "notes", "cancelled_at", "cancel_reason", "version"];

export function createFakeFinance({ h }) {
  const { isAdmin, active, memberName, json, raise, rlsDenied, eq } = h;
  const now = () => new Date().toISOString();
  const sees = (u) => active(u) && (isAdmin(u) || u.profile.finance_access === "ver");
  const manages = (u) => isAdmin(u);
  const conflict = () => ({ error: json(409, { code: "23505", message: "duplicate key value violates unique constraint" }) });
  const checkErr = () => ({ error: json(400, { code: "23514", message: "check constraint" }) });
  const denied = (table) => ({ error: json(403, { code: "42501", message: `permission denied for table ${table}` }) });

  const settings = { history_start: null, updated_at: now() };
  const accounts = [{ id: randomUUID(), name: "Conta Inter", kind: "conta", opening_balance_cents: null, opening_date: null, active: true, notes: null, created_at: now(), updated_at: now() }];
  const categories = [
    ...["Mensalidade de cliente", "Projeto avulso", "Comissão", "Reembolso recebido", "Outras receitas"].map((name, i) => ({ direction: "receita", name, position: i + 1 })),
    ...["Ferramentas e assinaturas", "Impostos (DAS)", "Freelancers e terceiros", "Equipamentos", "Marketing da agência", "Tarifas bancárias", "Outras despesas"].map((name, i) => ({ direction: "despesa", name, position: i + 1 }))
  ].map((c) => ({ id: randomUUID(), active: true, ...c }));
  const entries = [];
  const settlements = [];
  const audit = [];
  let auditId = 0;

  const log = (table, rowId, action, user, before, after) => audit.push({ id: ++auditId, table_name: table, row_id: String(rowId), action, actor: user?.id || null, actor_name: user ? memberName(user) : "Sistema", at: now(), before, after });
  const settled = (entryId) => settlements.filter((s) => s.entry_id === entryId && !s.voided_at);
  const settledSum = (entryId) => settled(entryId).reduce((t, s) => t + s.amount_cents, 0);

  /** Como a visão fin_entries_view */
  function view(e) {
    const paid = settledSum(e.id);
    const today = todayBR();
    const last = settled(e.id).map((s) => s.paid_on).sort().at(-1) || null;
    const status = e.cancelled_at ? "cancelado" : paid >= e.amount_cents ? "quitado" : paid > 0 && e.due_date < today ? "vencido"
      : paid > 0 ? "parcial" : !e.confirmed ? "previsto" : e.due_date < today ? "vencido" : "aberto";
    return { ...e, settled_cents: paid, open_cents: e.amount_cents - paid, last_paid_on: last, status };
  }
  /** Como a visão fin_account_balances */
  function balance(a) {
    const mine = settlements.filter((s) => s.account_id === a.id && !s.voided_at && (!a.opening_date || s.paid_on >= a.opening_date));
    const dirOf = (s) => entries.find((e) => e.id === s.entry_id)?.direction;
    const inflow = mine.filter((s) => dirOf(s) === "receita").reduce((t, s) => t + s.amount_cents, 0);
    const outflow = mine.filter((s) => dirOf(s) === "despesa").reduce((t, s) => t + s.amount_cents, 0);
    return { id: a.id, name: a.name, kind: a.kind, active: a.active, opening_balance_cents: a.opening_balance_cents, opening_date: a.opening_date,
      inflow_cents: inflow, outflow_cents: outflow, balance_cents: (a.opening_balance_cents || 0) + inflow - outflow, opening_known: a.opening_balance_cents != null };
  }

  /** Filtros do PostgREST que o painel usa: eq, gte, lte, in, is.null */
  function matches(row, params) {
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const v = decodeURIComponent(raw);
      const val = row[key];
      if (v.startsWith("eq.")) { if (String(val) !== v.slice(3)) return false; }
      else if (v.startsWith("gte.")) { if (!(val >= v.slice(4))) return false; }
      else if (v.startsWith("lte.")) { if (!(val <= v.slice(4))) return false; }
      else if (v.startsWith("in.(")) { if (!v.slice(4, -1).split(",").includes(String(val))) return false; }
      else if (v === "is.null") { if (val != null) return false; }
    }
    return true;
  }
  const pick = (obj, cols) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => cols.includes(k)));
  const extra = (obj, cols) => Object.keys(obj || {}).some((k) => !cols.includes(k));
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && s >= "2000-01-01" && s <= "2100-12-31";

  /** Como o gatilho fin_entries_guard + checks da tabela */
  function guardEntry(next, prev, user) {
    if (!["receita", "despesa"].includes(next.direction)) return checkErr();
    if (!String(next.description || "").trim() || String(next.description).length > 200) return checkErr();
    if (!Number.isSafeInteger(next.amount_cents) || next.amount_cents < 1 || next.amount_cents > 100000000000) return checkErr();
    if (!validDate(next.due_date) || !validDate(next.competence_date)) return checkErr();
    if ((next.revenue_kind || next.client_id) && next.direction !== "receita") return checkErr();
    if ((next.cancelled_at == null) !== (next.cancel_reason == null)) return checkErr();
    if (prev) {
      if (prev.cancelled_at) return raise("lancamento_cancelado");
      if (next.version !== prev.version) return raise("versao_desatualizada");
    }
    const cat = categories.find((c) => c.id === next.category_id);
    if (!cat) return raise("categoria_invalida");
    if (cat.direction !== next.direction) return raise("categoria_de_outro_tipo");
    if ((!prev || prev.category_id !== next.category_id) && !cat.active) return raise("categoria_inativa");
    if (next.account_id && (!prev || prev.account_id !== next.account_id) && !accounts.find((a) => a.id === next.account_id)?.active) return raise("conta_inativa");
    if (prev) {
      const paid = settledSum(prev.id);
      if (next.cancelled_at && paid > 0) return raise("tem_baixas_ativas");
      if (next.amount_cents < paid) return raise("valor_menor_que_baixas");
    }
    return null;
  }

  function route(method, table, params, body, user) {
    const canSee = sees(user);
    const list = (rows) => (canSee ? rows.filter((r) => matches(r, params)) : []);

    if (table === "fin_settings") {
      if (method === "GET") return canSee ? [{ ...settings }] : [];
      if (method === "PATCH") {
        if (extra(body, ["history_start"])) return denied(table);
        if (!manages(user)) return [];
        const before = { ...settings };
        Object.assign(settings, body, { updated_at: now() });
        log(table, "config", "alterou", user, before, { ...settings });
        return [{ ...settings }];
      }
    }
    if (table === "fin_account_balances" && method === "GET") return list(accounts.map(balance)).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    if (table === "fin_accounts") {
      const cols = ["name", "kind", "opening_balance_cents", "opening_date", "active", "notes"];
      if (method === "GET") return list(accounts);
      if (extra(body, cols)) return denied(table);
      if (method === "POST") {
        if (!manages(user)) return rlsDenied();
        if (accounts.some((a) => a.name.trim().toLowerCase() === String(body.name).trim().toLowerCase())) return conflict();
        if ((body.opening_balance_cents == null) !== (body.opening_date == null)) return checkErr();
        const a = { id: randomUUID(), kind: "conta", opening_balance_cents: null, opening_date: null, active: true, notes: null, ...body, created_at: now(), updated_at: now() };
        accounts.push(a); log(table, a.id, "criou", user, null, { ...a });
        return [{ ...a }];
      }
      if (method === "PATCH") {
        if (!manages(user)) return [];
        const a = accounts.find((x) => matches(x, params));
        if (!a) return [];
        const next = { ...a, ...body };
        if (body.name && accounts.some((x) => x.id !== a.id && x.name.trim().toLowerCase() === body.name.trim().toLowerCase())) return conflict();
        if ((next.opening_balance_cents == null) !== (next.opening_date == null)) return checkErr();
        const before = { ...a }; Object.assign(a, body, { updated_at: now() }); log(table, a.id, "alterou", user, before, { ...a });
        return [{ ...a }];
      }
      if (method === "DELETE") return denied(table);
    }
    if (table === "fin_categories") {
      if (method === "GET") return list(categories).sort((a, b) => a.direction.localeCompare(b.direction) || a.position - b.position);
      if (method === "POST") {
        if (extra(body, ["direction", "name", "active", "position"])) return denied(table);
        if (!manages(user)) return rlsDenied();
        if (categories.some((c) => c.direction === body.direction && c.name.trim().toLowerCase() === String(body.name).trim().toLowerCase())) return conflict();
        const c = { id: randomUUID(), active: true, position: 0, ...body }; categories.push(c); log(table, c.id, "criou", user, null, { ...c });
        return [{ ...c }];
      }
      if (method === "PATCH") {
        if (extra(body, ["name", "active", "position"])) return denied(table);
        if (!manages(user)) return [];
        const c = categories.find((x) => matches(x, params));
        if (!c) return [];
        if (body.name && categories.some((x) => x.id !== c.id && x.direction === c.direction && x.name.trim().toLowerCase() === body.name.trim().toLowerCase())) return conflict();
        const before = { ...c }; Object.assign(c, body); log(table, c.id, "alterou", user, before, { ...c });
        return [{ ...c }];
      }
      if (method === "DELETE") return denied(table);
    }
    if (table === "fin_entries_view" && method === "GET") return list(entries.map(view)).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
    if (table === "fin_entries") {
      if (method === "GET") return list(entries);
      if (method === "DELETE") return denied(table);
      if (method === "POST") {
        if (extra(body, ENTRY_COLS)) return denied(table);
        if (!manages(user)) return rlsDenied();
        if (!body.request_id) return checkErr();
        if (entries.some((e) => e.request_id === body.request_id)) return conflict();
        const e = { id: randomUUID(), account_id: null, client_id: null, revenue_kind: null, counterparty: null, confirmed: true, invoice_number: null, notes: null, ...body,
          cancelled_at: null, cancelled_by: null, cancel_reason: null, version: 1, created_by: user.id, created_at: now(), updated_at: now() };
        const problem = guardEntry(e, null, user);
        if (problem) return problem;
        entries.push(e); log(table, e.id, "criou", user, null, { ...e });
        return [{ ...e }];
      }
      if (method === "PATCH") {
        if (extra(body, ENTRY_UPDATE)) return denied(table);
        if (!manages(user)) return [];
        const e = entries.find((x) => matches(x, params));
        if (!e) return [];
        const next = { ...e, ...body };
        const problem = guardEntry(next, e, user);
        if (problem) return problem;
        const cancelling = !e.cancelled_at && next.cancelled_at;
        if (cancelling) { next.cancelled_at = now(); next.cancelled_by = user.id; }
        const before = { ...e };
        Object.assign(e, next, { version: e.version + 1, updated_at: now() });
        log(table, e.id, cancelling ? "cancelou" : "alterou", user, before, { ...e });
        return [{ ...e }];
      }
    }
    if (table === "fin_settlements") {
      if (method === "GET") return list(settlements).sort((a, b) => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : 0));
      if (method === "DELETE") return denied(table);
      if (method === "POST") {
        if (extra(body, ["entry_id", "account_id", "amount_cents", "paid_on", "method", "notes", "request_id"])) return denied(table);
        if (!manages(user)) return rlsDenied();
        if (!body.request_id) return checkErr();
        if (settlements.some((s) => s.request_id === body.request_id)) return conflict();
        if (!Number.isSafeInteger(body.amount_cents) || body.amount_cents < 1) return checkErr();
        if (!validDate(body.paid_on)) return checkErr();
        const e = entries.find((x) => x.id === body.entry_id);
        if (!e) return raise("lancamento_nao_encontrado");
        if (e.cancelled_at) return raise("lancamento_cancelado");
        if (!accounts.find((a) => a.id === body.account_id)?.active) return raise("conta_inativa");
        if (settledSum(e.id) + body.amount_cents > e.amount_cents) return raise("baixa_maior_que_saldo");
        const s = { id: randomUUID(), method: null, notes: null, ...body, voided_at: null, voided_by: null, void_reason: null, created_by: user.id, created_at: now() };
        settlements.push(s); log(table, s.id, "criou", user, null, { ...s });
        return [{ ...s }];
      }
      if (method === "PATCH") {
        if (extra(body, ["voided_at", "void_reason"])) return denied(table);
        if (!manages(user)) return [];
        const s = settlements.find((x) => matches(x, params));
        if (!s) return [];
        if (s.voided_at) return raise("baixa_ja_estornada");
        if (!body.voided_at || !String(body.void_reason || "").trim()) return raise("baixa_imutavel");
        const before = { ...s };
        Object.assign(s, { voided_at: now(), voided_by: user.id, void_reason: body.void_reason });
        log(table, s.id, "estornou", user, before, { ...s });
        return [{ ...s }];
      }
    }
    if (table === "fin_audit") {
      if (method === "GET") return list(audit).sort((a, b) => b.id - a.id);
      return denied(table);
    }
    return json(405, { message: "Method not allowed" });
  }

  return { route, tables: ["fin_settings", "fin_accounts", "fin_account_balances", "fin_categories", "fin_entries", "fin_entries_view", "fin_settlements", "fin_audit"],
    entries, settlements, accounts, categories, audit, settings };
}
