/* Financeiro (Fase A): lançamentos do mês, contas e categorias.
   - Só aparece para o administrador (gerencia) e para quem tem acesso "ver"
     (só consulta). O banco aplica as mesmas regras (RLS): esconder botão não
     é a proteção.
   - Valores sempre em centavos; status e saldos vêm calculados do banco.
   - Cada formulário ganha um código de envio (request_id) ao abrir: clicar
     duas vezes ou reenviar depois de cair a internet não duplica nada.
   - Nada é apagado: lançamento é cancelado e recebimento/pagamento é estornado,
     sempre com motivo, e tudo fica no histórico. */

import { $, esc, on } from "../../../js/lib/dom.js?v=7a96e4cef6";
import { icon } from "../../../js/lib/icons.js?v=7a96e4cef6";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=7a96e4cef6";
import { stateBlock, loadingRows } from "../ui/states.js?v=7a96e4cef6";
import {
  STATUS, statusLabel, METHODS, ACCOUNT_KINDS, REVENUE_KINDS, formatMoney, moneyInput, todayBR, monthRange, shiftMonth, monthLabel, monthTitle, shortDate,
  validateEntry, validateSettlement, validateAccount, validateCategory, validateReason, validateEntryFilters, entryTotals, newRequestId,
  GOAL_KINDS, GOAL_BASIS, validateGoal, goalReading, meiReading, percent
} from "../domain/finance.js?v=7a96e4cef6";

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const AUDIT_ACTIONS = { criou: "criou", alterou: "alterou", cancelou: "cancelou", estornou: "estornou" };
const AUDIT_TABLES = { fin_entries: "o lançamento", fin_settlements: "um recebimento/pagamento", fin_accounts: "a conta", fin_categories: "a categoria", fin_settings: "os ajustes" };

export function setupFinance({ api, state, toast, confirm }) {
  const view = $("#view-financeiro");
  const list = $("#fin-list");
  const sums = $("#fin-sums");
  const filtersForm = $("#fin-filters");
  const drawer = $("#fin-drawer");
  const modal = $("#fin-modal");
  const form = modal.querySelector("form");
  const submit = form.querySelector("[type=submit]");

  const st = {
    tab: "lancamentos", month: todayBR().slice(0, 7), basis: "vencimento", filters: {},
    rows: [], accounts: [], categories: [], settings: null, ready: false, open: null, seq: 0
  };
  let mode = null;       // formulário aberto: { kind, ... }
  let saving = false;

  wireDialog(drawer);
  wireDialog(modal, { canClose: () => !saving });
  drawer.addEventListener("close", () => { st.open = null; });

  const manages = () => state.can.finmanage;
  const category = (id) => st.categories.find((c) => c.id === id);
  const account = (id) => st.accounts.find((a) => a.id === id);
  const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "";
  const tone = (row) => STATUS[row.status]?.tone || "neutral";
  const chip = (row) => `<span class="fin-chip fin-chip--${tone(row)}">${esc(statusLabel(row))}</span>`;
  const signed = (row, cents) => `${row.direction === "despesa" ? "−" : "+"} ${formatMoney(cents)}`;

  /* ---------- Endereço: #/financeiro?mes=2026-11&base=competencia&... ---------- */
  function writeAddress() {
    const params = new URLSearchParams();
    if (st.tab !== "lancamentos") params.set("aba", st.tab);
    if (st.month !== todayBR().slice(0, 7)) params.set("mes", st.month);
    if (st.basis !== "vencimento") params.set("base", st.basis);
    for (const [k, v] of Object.entries(st.filters)) if (v) params.set(k, v);
    const q = params.toString();
    history.replaceState(null, "", `#/financeiro${q ? `?${q}` : ""}`);
  }
  function readAddress(query = {}) {
    st.tab = ["metas", "contas", "categorias"].includes(query.aba) && (query.aba !== "categorias" || manages()) ? query.aba : "lancamentos";
    st.month = monthRange(query.mes) ? query.mes : todayBR().slice(0, 7);
    st.basis = query.base === "competencia" ? "competencia" : "vencimento";
    const f = validateEntryFilters(query);
    delete f.month; delete f.basis;
    st.filters = f;
  }

  /* ---------- Carregar ---------- */
  async function loadRefs() {
    const [accounts, categories, settings] = await Promise.all([api.finAccounts(), api.finCategories(), api.finSettings()]);
    st.accounts = accounts; st.categories = categories; st.settings = settings;
    fillFilterOptions();
  }
  async function loadEntries() {
    const seq = ++st.seq;
    list.setAttribute("aria-busy", "true");
    if (!st.rows.length) list.innerHTML = loadingRows(4);
    try {
      const rows = await api.finEntries({ ...st.filters, q: undefined, month: st.month, basis: st.basis });
      if (seq !== st.seq) return;
      st.rows = rows;
      renderEntries();
    } catch (error) {
      if (seq !== st.seq) return;
      list.setAttribute("aria-busy", "false");
      sums.innerHTML = "";
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar os lançamentos", text: error.message });
    }
  }
  async function load(query = {}) {
    readAddress(query);
    view.querySelector("[data-fin-readonly]").hidden = manages();
    syncTabs();
    try {
      await loadRefs();
      st.ready = true;
    } catch (error) {
      list.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível abrir o financeiro", text: error.message });
      return;
    }
    if (st.tab === "lancamentos") await loadEntries();
    if (st.tab === "metas") await loadGoals();
    renderAccounts();
    renderCategories();
  }

  /* ---------- Abas ---------- */
  function syncTabs() {
    view.querySelectorAll("[data-fin-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.finTab === st.tab)));
    view.querySelectorAll("[data-fin-panel]").forEach((p) => { p.hidden = p.dataset.finPanel !== st.tab; });
    view.querySelector("[data-fin-month-label]").textContent = monthTitle(st.month);
    view.querySelectorAll("[data-fin-basis]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.finBasis === st.basis)));
    // O mês vale para Lançamentos e Metas; vencimento × competência, só para Lançamentos
    view.querySelector("[data-fin-monthbar]").hidden = !["lancamentos", "metas"].includes(st.tab);
    view.querySelector("[data-fin-basis-wrap]").hidden = st.tab !== "lancamentos";
  }
  on(view, "click", "[data-fin-tab]", async (event, b) => {
    st.tab = b.dataset.finTab;
    syncTabs(); writeAddress();
    if (st.tab === "lancamentos") await loadEntries();
    else if (st.tab === "metas") await loadGoals();
    else { await loadRefs().catch(() => {}); renderAccounts(); renderCategories(); }
  });
  on(view, "click", "[data-fin-month]", (event, b) => {
    st.month = shiftMonth(st.month, Number(b.dataset.finMonth));
    syncTabs(); writeAddress();
    if (st.tab === "metas") loadGoals(); else loadEntries();
  });
  on(view, "click", "[data-fin-basis]", (event, b) => { st.basis = b.dataset.finBasis; syncTabs(); writeAddress(); loadEntries(); });

  /* ---------- Filtros ---------- */
  function fillFilterOptions() {
    const set = (name, options, all) => {
      const select = filtersForm.elements[name];
      select.innerHTML = `<option value="">${esc(all)}</option>${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}`;
      select.value = st.filters[name] || "";
    };
    set("category_id", st.categories.map((c) => [c.id, `${c.direction === "receita" ? "Receita" : "Despesa"} · ${c.name}${c.active ? "" : " (inativa)"}`]), "Todas");
    set("account_id", st.accounts.map((a) => [a.id, a.name]), "Todas");
    set("client_id", state.clients.map((c) => [c.id, c.name]), "Todos");
    for (const k of ["direction", "status", "q"]) filtersForm.elements[k].value = st.filters[k] || "";
  }
  filtersForm.addEventListener("change", (event) => {
    if (event.target.name === "q") return;
    st.filters = validateEntryFilters(Object.fromEntries(new FormData(filtersForm)));
    delete st.filters.month; delete st.filters.basis;
    writeAddress(); loadEntries();
  });
  let typing = null;
  filtersForm.elements.q.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => { st.filters.q = filtersForm.elements.q.value.trim().slice(0, 80) || undefined; writeAddress(); renderEntries(); }, 150);
  });
  filtersForm.addEventListener("submit", (event) => event.preventDefault());

  /* ---------- Lista ---------- */
  const visibleRows = () => {
    const q = norm(st.filters.q).trim();
    if (!q) return st.rows;
    const words = q.split(/\s+/);
    return st.rows.filter((r) => { const t = norm(`${r.description} ${r.counterparty || ""} ${r.invoice_number || ""} ${r.notes || ""} ${clientName(r.client_id)} ${category(r.category_id)?.name || ""}`); return words.every((w) => t.includes(w)); });
  };

  function notice() {
    const box = view.querySelector("[data-fin-notice]");
    const start = st.settings?.history_start;
    const range = monthRange(st.month);
    const missingOpening = st.accounts.filter((a) => a.active && !a.opening_known);
    const lines = [];
    if (!start) lines.push(manages() ? "Defina a data de início do histórico (aba Contas). Até lá, os totais mostram só o que já foi lançado." : "O início do histórico ainda não foi definido: os totais mostram só o que já foi lançado.");
    else if (range.to < start) lines.push(`Este mês é anterior ao início do histórico (${shortDate(start)}): os números podem estar incompletos.`);
    if (missingOpening.length) lines.push(`Saldo inicial não informado: ${missingOpening.map((a) => a.name).join(", ")}. O saldo da conta mostra só o que foi registrado.`);
    box.hidden = !lines.length;
    box.innerHTML = lines.map((l) => `<p>${icon("lightbulb")}<span>${esc(l)}</span></p>`).join("");
  }

  function renderSums(rows) {
    const t = entryTotals(rows);
    const item = (cls, label, value, sub) => `<li class="fin-sum fin-sum--${cls}"><span class="fin-sum__label">${esc(label)}</span><span class="fin-sum__value">${esc(value)}</span>${sub ? `<span class="fin-sum__sub">${esc(sub)}</span>` : ""}</li>`;
    const result = t.revenue - t.expense;
    sums.innerHTML = [
      item("in", "Receitas", formatMoney(t.revenue), `recebido ${formatMoney(t.received)} · falta ${formatMoney(t.toReceive)}`),
      item("out", "Despesas", formatMoney(t.expense), `pago ${formatMoney(t.paid)} · falta ${formatMoney(t.toPay)}`),
      item(result < 0 ? "neg" : "res", "Resultado", formatMoney(result), "receitas − despesas"),
      item(t.overdue ? "late" : "ok", "Vencido", formatMoney(t.overdue), t.overdue ? "em aberto, já passou do vencimento" : "nada vencido")
    ].join("");
  }

  function rowHtml(r) {
    const cat = category(r.category_id);
    const meta = [cat?.name, r.direction === "receita" ? clientName(r.client_id) : r.counterparty, account(r.account_id)?.name].filter(Boolean).join(" · ");
    const date = st.basis === "competencia" ? `venc. ${shortDate(r.due_date).slice(0, 5)}` : shortDate(r.due_date).slice(0, 5);
    const partial = r.status !== "cancelado" && r.settled_cents > 0 && r.open_cents > 0;
    return `
      <li><button class="fin-row${r.status === "cancelado" ? " is-cancelled" : ""}" type="button" data-fin-open="${esc(r.id)}">
        <span class="fin-row__date">${esc(date)}</span>
        <span class="fin-row__main"><span class="fin-row__title">${esc(r.description)}</span>${meta ? `<span class="fin-row__meta">${esc(meta)}</span>` : ""}</span>
        ${chip(r)}
        <span class="fin-row__amount fin-row__amount--${r.direction}">${esc(signed(r, r.amount_cents))}${partial ? `<small>falta ${esc(formatMoney(r.open_cents))}</small>` : ""}</span>
      </button></li>`;
  }

  function renderEntries() {
    list.setAttribute("aria-busy", "false");
    notice();
    const rows = visibleRows();
    renderSums(rows);
    if (!rows.length) {
      const filtered = Object.values(st.filters).some(Boolean);
      list.innerHTML = stateBlock({
        iconName: "wallet",
        title: filtered ? "Nada com esses filtros" : `Nenhum lançamento em ${monthLabel(st.month)}`,
        text: filtered ? "Limpe os filtros ou troque de mês." : manages() ? "Registre as receitas e despesas deste mês pelos botões acima." : "Quando o administrador lançar, aparece aqui."
      });
      return;
    }
    list.innerHTML = `<ul class="fin-rows" aria-label="Lançamentos de ${esc(monthLabel(st.month))}">${rows.map(rowHtml).join("")}</ul>`;
  }

  /* ---------- Contas ---------- */
  function renderAccounts() {
    const root = $("#fin-accounts");
    const history = view.querySelector("[data-fin-history]");
    if (history) history.elements.history_start.value = st.settings?.history_start || "";
    if (!st.accounts.length) { root.innerHTML = stateBlock({ iconName: "wallet", title: "Nenhuma conta", text: "Cadastre onde o dinheiro da agência fica." }); return; }
    root.innerHTML = st.accounts.map((a) => `
      <article class="fin-account${a.active ? "" : " is-off"}">
        <div class="fin-account__head">
          <span class="fin-account__icon">${icon("wallet")}</span>
          <div><p class="fin-account__name">${esc(a.name)}</p><p class="fin-account__kind">${esc(ACCOUNT_KINDS[a.kind] || a.kind)}${a.active ? "" : " · desativada"}</p></div>
          ${manages() ? `<button class="icon-btn" type="button" data-fin-account-edit="${esc(a.id)}" aria-label="Editar ${esc(a.name)}" title="Editar">${icon("edit")}</button>` : ""}
        </div>
        <p class="fin-account__balance${a.balance_cents < 0 ? " is-neg" : ""}">${esc(formatMoney(a.balance_cents))}</p>
        <p class="fin-account__sub">${a.opening_known ? `Saldo inicial ${esc(formatMoney(a.opening_balance_cents))} em ${esc(shortDate(a.opening_date))}` : '<span class="fin-warn">Saldo inicial não informado</span> · mostra só a movimentação registrada'}</p>
        <p class="fin-account__sub">Entradas ${esc(formatMoney(a.inflow_cents))} · Saídas ${esc(formatMoney(a.outflow_cents))}</p>
      </article>`).join("");
  }

  /* ---------- Categorias ---------- */
  function renderCategories() {
    const root = $("#fin-categories");
    if (!manages()) { root.innerHTML = ""; return; }
    const col = (dir, title) => `
      <section class="fin-cats"><h2 class="detail__title">${esc(title)}</h2><ul>${st.categories.filter((c) => c.direction === dir).map((c) => `
        <li class="${c.active ? "" : "is-off"}"><span>${esc(c.name)}${c.active ? "" : ' <span class="field__optional">(desativada)</span>'}</span>
          <button class="icon-btn" type="button" data-fin-category-edit="${esc(c.id)}" aria-label="Editar ${esc(c.name)}" title="Editar">${icon("edit")}</button></li>`).join("")}</ul></section>`;
    root.innerHTML = col("receita", "Receitas") + col("despesa", "Despesas");
  }

  /* ---------- Metas ----------
     Valores e metas só o administrador define; o realizado vem do banco. */
  const goalsRoot = $("#fin-goals");
  const gs = { year: null, goals: [], revenue: null, seq: 0 };
  async function loadGoals() {
    const year = st.month.slice(0, 4);
    const seq = ++gs.seq;
    goalsRoot.setAttribute("aria-busy", "true");
    if (gs.year !== year || !gs.goals.length) goalsRoot.innerHTML = loadingRows(3);
    try {
      const { goals, revenue } = await api.finGoals(year);
      if (seq !== gs.seq) return;
      Object.assign(gs, { year, goals, revenue });
      renderGoals();
    } catch (error) {
      if (seq !== gs.seq) return;
      goalsRoot.setAttribute("aria-busy", "false");
      goalsRoot.innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível carregar as metas", text: error.message });
    }
  }
  const goalName = (g) => (g.kind === "limite_categoria" ? `Gasto com ${category(g.category_id)?.name || "categoria"}` : GOAL_KINDS[g.kind]?.short || g.kind);
  const goalValue = (g, v) => (GOAL_KINDS[g.kind]?.money ? formatMoney(v) : `${v} ${Number(v) === 1 ? "cliente" : "clientes"}`);
  const TONE_CHIP = { success: "success", warn: "info", danger: "danger", neutral: "muted" };

  function goalCard(g) {
    const k = GOAL_KINDS[g.kind];
    const r = goalReading(g);
    const lines = [];
    if (k.higher) lines.push(r.remaining > 0 ? `Falta ${goalValue(g, r.remaining)}` : g.actual > g.target ? `${goalValue(g, g.actual - g.target)} acima da meta` : "Meta atingida");
    else lines.push(r.remaining >= 0 ? `Ainda cabe ${goalValue(g, r.remaining)}` : `${goalValue(g, -r.remaining)} acima do teto`);
    if (r.pace != null) lines.push(`no ritmo atual, ${formatMoney(r.pace)} até o fim do ${g.period === "mes" ? "mês" : "ano"}`);
    const extra = k.money && r.phase !== "passado" && Number(g.forecast) !== Number(g.actual)
      ? `Contando o que está lançado e ainda não ${g.basis === "caixa" ? "foi recebido/pago" : "está confirmado"}: ${formatMoney(g.forecast)}` : "";
    const basis = g.kind === "clientes_ativos" ? "contagem de agora" : g.basis === "caixa" ? "pelo caixa" : "por competência";
    return `
      <article class="fin-goal fin-goal--${r.tone}" data-goal="${esc(g.id)}">
        <div class="fin-goal__head">
          <div class="fin-goal__title"><p class="fin-goal__name">${esc(goalName(g))}</p><span class="fin-chip fin-chip--${TONE_CHIP[r.tone]}">${esc(r.label)}</span></div>
          ${manages() ? `<span class="fin-goal__tools"><button class="icon-btn" type="button" data-goal-edit="${esc(g.id)}" aria-label="Editar meta ${esc(goalName(g))}" title="Editar">${icon("edit")}</button><button class="icon-btn" type="button" data-goal-archive="${esc(g.id)}" aria-label="Desativar meta ${esc(goalName(g))}" title="Desativar">${icon("close")}</button></span>` : ""}
        </div>
        <p class="fin-goal__nums"><b>${esc(goalValue(g, g.actual))}</b><span>${k.higher ? "de" : "de no máximo"} ${esc(goalValue(g, g.target))}</span><span class="fin-goal__pct">${esc(percent(r.pct))}</span></p>
        <div class="fin-goal__bar" role="progressbar" aria-label="${esc(goalName(g))}: ${esc(percent(r.pct))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(r.pct * 100))}" data-pct="${Math.min(100, Math.round(r.pct * 100))}"${r.phase === "atual" ? ` data-elapsed="${Math.round(r.elapsed * 100)}"` : ""}><span class="fin-goal__fill"></span>${r.phase === "atual" && k.money ? '<span class="fin-goal__today" title="Onde o mês/ano está hoje"></span>' : ""}</div>
        <p class="fin-goal__meta">${esc(lines.join(" · "))}</p>
        ${extra ? `<p class="fin-goal__meta">${esc(extra)}</p>` : ""}
        <p class="fin-goal__basis">${esc(basis)}${g.notes ? ` · ${esc(g.notes)}` : ""}</p>
      </article>`;
  }

  function meiCard() {
    const limit = st.settings?.mei_annual_limit_cents;
    const year = gs.year;
    if (!limit) return manages() ? `<p class="fin-mei-empty"><button class="link-btn" type="button" data-mei-edit>${icon("target")}<span>Definir o limite anual do MEI</span></button> <span class="field__hint">para acompanhar quanto do teto já foi faturado.</span></p>` : "";
    const billed = Number(gs.revenue?.billed_cents) || 0;
    const r = meiReading(limit, billed);
    const width = Math.min(100, Math.round(r.pct * 100));
    return `
      <article class="fin-goal fin-goal--${r.tone} fin-mei">
        <div class="fin-goal__head"><div class="fin-goal__title"><p class="fin-goal__name">Limite do MEI em ${esc(year)}</p>
          <span class="fin-chip fin-chip--${TONE_CHIP[r.tone]}">${r.pct >= 1 ? "Passou do limite" : r.pct >= 0.8 ? "Perto do limite" : "Dentro do limite"}</span></div>
          ${manages() ? `<span class="fin-goal__tools"><button class="icon-btn" type="button" data-mei-edit aria-label="Editar o limite do MEI" title="Editar">${icon("edit")}</button></span>` : ""}</div>
        <p class="fin-goal__nums"><b>${esc(formatMoney(billed))}</b><span>de ${esc(formatMoney(limit))}</span><span class="fin-goal__pct">${esc(percent(r.pct))}</span></p>
        <div class="fin-goal__bar" role="progressbar" aria-label="Limite do MEI: ${esc(percent(r.pct))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}" data-pct="${width}"><span class="fin-goal__fill"></span></div>
        <p class="fin-goal__meta">${r.remaining >= 0 ? `Ainda cabe ${esc(formatMoney(r.remaining))}` : `${esc(formatMoney(-r.remaining))} acima do limite`} · recebido no ano: ${esc(formatMoney(gs.revenue?.received_cents || 0))}</p>
        <p class="fin-goal__basis">Faturamento lançado no ano (sem reembolsos). É uma estimativa: confirme sempre com o contador.</p>
      </article>`;
  }

  function historyTable(monthly) {
    const groups = new Map();
    for (const g of monthly) {
      const key = `${g.kind}|${g.basis}|${g.category_id || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    if (!groups.size) return "";
    const tables = [...groups.values()].map((rows) => {
      const first = rows[0];
      const body = rows.map((g) => { const r = goalReading(g); return `<tr><th scope="row">${esc(monthLabel(g.period_start.slice(0, 7)).replace(/ de \d+$/, ""))}</th><td>${esc(goalValue(g, g.target))}</td><td>${esc(goalValue(g, g.actual))}</td><td><span class="fin-chip fin-chip--${TONE_CHIP[r.tone]}">${esc(percent(r.pct))}</span></td></tr>`; }).join("");
      return `<div class="fin-hist"><p class="fin-hist__title">${esc(goalName(first))} <span class="field__optional">· ${first.kind === "clientes_ativos" ? "contagem de agora" : first.basis === "caixa" ? "caixa" : "competência"}</span></p>
        <table class="fin-hist__table"><thead><tr><th scope="col">Mês</th><th scope="col">Meta</th><th scope="col">Realizado</th><th scope="col">%</th></tr></thead><tbody>${body}</tbody></table></div>`;
    }).join("");
    return `<details class="detail history-toggle fin-hist-wrap"><summary class="history-toggle__summary">${icon("calendar")}<span>Mês a mês em ${esc(gs.year)}</span><span class="history-toggle__hint">meta × realizado</span></summary>${tables}</details>`;
  }

  function renderGoals() {
    goalsRoot.setAttribute("aria-busy", "false");
    const start = `${st.month}-01`;
    const monthly = gs.goals.filter((g) => g.period === "mes");
    const ofMonth = monthly.filter((g) => g.period_start === start);
    const ofYear = gs.goals.filter((g) => g.period === "ano");
    const prev = shiftMonth(st.month, -1);
    const prevGoals = prev.slice(0, 4) === gs.year ? monthly.filter((g) => g.period_start === `${prev}-01`) : [];
    const head = (title, extra = "") => `<div class="fin-goals__head"><h2 class="detail__title">${esc(title)}</h2>${extra}</div>`;
    const newBtn = manages() ? `<button class="btn btn--ghost btn--sm" type="button" data-goal-new="mes">${icon("sparkle")}<span>Nova meta</span></button>` : "";
    const copyBtn = manages() && !ofMonth.length && prevGoals.length ? `<button class="btn btn--ghost btn--sm" type="button" data-goal-copy>${icon("refresh")}<span>Repetir as metas de ${esc(monthLabel(prev).replace(/ de \d+$/, ""))}</span></button>` : "";
    const empty = (text) => `<p class="fin-goals__empty">${esc(text)}</p>`;
    goalsRoot.innerHTML = `
      ${meiCard()}
      <section class="fin-goals__section" aria-label="Metas do mês">
        ${head(`Metas de ${monthLabel(st.month)}`, `<span class="fin-goals__actions">${copyBtn}${newBtn}</span>`)}
        ${ofMonth.length ? `<div class="fin-goals__grid">${ofMonth.map(goalCard).join("")}</div>` : empty(manages() ? "Nenhuma meta para este mês. Crie em Nova meta: faturamento, resultado, teto de despesas, gasto por categoria ou clientes ativos." : "Nenhuma meta para este mês.")}
      </section>
      <section class="fin-goals__section" aria-label="Metas do ano">
        ${head(`Metas de ${gs.year}`, manages() ? `<button class="btn btn--ghost btn--sm" type="button" data-goal-new="ano">${icon("sparkle")}<span>Meta do ano</span></button>` : "")}
        ${ofYear.length ? `<div class="fin-goals__grid">${ofYear.map(goalCard).join("")}</div>` : empty("Nenhuma meta anual.")}
      </section>
      ${historyTable(monthly)}`;
    // Largura das barras pelo CSSOM (a política de segurança não aceita style="" no HTML)
    goalsRoot.querySelectorAll("[data-pct]").forEach((bar) => {
      bar.style.setProperty("--pct", `${bar.dataset.pct}%`);
      if (bar.dataset.elapsed) bar.style.setProperty("--elapsed", `${bar.dataset.elapsed}%`);
    });
  }

  function goalForm(period = "mes", g = null) {
    const kind = g?.kind || "faturamento";
    const cats = st.categories.filter((c) => c.direction === "despesa" && (c.active || c.id === g?.category_id)).map((c) => [c.id, c.name]);
    const targetValue = g ? (GOAL_KINDS[g.kind].money ? moneyInput(g.target) : String(g.target)) : "";
    const fields = [
      g ? `<p class="field form-grid__wide fin-goal-fixed"><span class="field__label">Meta</span><span>${esc(goalName(g))} · ${esc(g.period === "mes" ? monthLabel(g.period_start.slice(0, 7)) : `ano de ${g.period_start.slice(0, 4)}`)}</span></p>`
        : f("kind", "Tipo de meta", select("kind", Object.entries(GOAL_KINDS).map(([k, v]) => [k, v.label]), kind, null), { wide: true, hint: GOAL_KINDS[kind].hint }),
      g ? "" : `<fieldset class="field radio-row"><legend class="field__label">Período</legend>
        <label class="check"><input type="radio" name="period" value="mes"${period === "mes" ? " checked" : ""}><span>Mês</span></label>
        <label class="check"><input type="radio" name="period" value="ano"${period === "ano" ? " checked" : ""}><span>Ano inteiro</span></label></fieldset>`,
      g ? "" : `<div data-goal-period="mes">${f("month", "Mês", text("month", st.month, 'type="month"'))}</div><div data-goal-period="ano">${f("year", "Ano", text("year", st.month.slice(0, 4), 'type="number" min="2000" max="2100" step="1" inputmode="numeric"'))}</div>`,
      `<div data-goal-money>${f("target", "Valor da meta", money("target", GOAL_KINDS[kind].money ? targetValue : ""))}</div>`,
      `<div data-goal-count>${f("target_count", "Quantidade", text("target_count", GOAL_KINDS[kind].money ? "" : targetValue, 'type="number" min="0" max="999999" step="1" inputmode="numeric" placeholder="Ex.: 10"'))}</div>`,
      `<div data-goal-cat>${f("category_id", "Categoria de despesa", select("category_id", cats, g?.category_id || "", "Escolha…"))}</div>`,
      `<div data-goal-basis>${f("basis", "Contar por", select("basis", Object.entries(GOAL_BASIS), g?.basis || "competencia", null))}</div>`,
      f("notes", "Observação", area("notes", g?.notes, 500), { wide: true, optional: true })
    ].join("");
    openModal({ kind: "goal", goal: g }, {
      title: g ? "Editar meta" : period === "ano" ? "Nova meta do ano" : "Nova meta",
      text: "Você define o valor; o realizado é calculado pelos lançamentos.", iconName: "target", fields, submitLabel: "Salvar meta"
    });
    const sync = () => {
      const k = g?.kind || form.elements.kind.value;
      const per = g ? g.period : form.querySelector("[name=period]:checked")?.value;
      form.querySelectorAll("[data-goal-period]").forEach((el) => { el.hidden = el.dataset.goalPeriod !== per; });
      form.querySelector("[data-goal-money]").hidden = !GOAL_KINDS[k].money;
      form.querySelector("[data-goal-count]").hidden = GOAL_KINDS[k].money;
      form.querySelector("[data-goal-cat]").hidden = k !== "limite_categoria";
      form.querySelector("[data-goal-basis]").hidden = k === "clientes_ativos";
      const hint = form.elements.kind?.closest(".field")?.querySelector(".field__hint");
      if (hint) hint.textContent = GOAL_KINDS[k].hint;
    };
    form.elements.kind?.addEventListener("change", sync);
    form.querySelectorAll("[name=period]").forEach((r) => r.addEventListener("change", sync));
    sync();
  }

  function meiForm() {
    const limit = st.settings?.mei_annual_limit_cents;
    openModal({ kind: "mei" }, {
      title: "Limite anual do MEI", iconName: "target", submitLabel: "Salvar",
      text: "O teto de faturamento do MEI muda por lei: confira o valor do ano com o contador. Deixe em branco para não acompanhar.",
      fields: f("mei_limit", "Limite do ano", money("mei_limit", limit ? moneyInput(limit) : ""), { wide: true, optional: true })
    });
  }

  on(goalsRoot, "click", "[data-goal-new]", (event, b) => manages() && goalForm(b.dataset.goalNew));
  on(goalsRoot, "click", "[data-goal-edit]", (event, b) => { const g = gs.goals.find((x) => x.id === b.dataset.goalEdit); if (g && manages()) goalForm(g.period, g); });
  on(goalsRoot, "click", "[data-mei-edit]", () => manages() && meiForm());
  on(goalsRoot, "click", "[data-goal-archive]", async (event, b) => {
    const g = gs.goals.find((x) => x.id === b.dataset.goalArchive);
    if (!g || !manages()) return;
    const ok = await confirm({ title: `Desativar a meta "${goalName(g)}"?`, text: "Ela sai da tela. O registro continua no histórico do financeiro.", confirmLabel: "Desativar" });
    if (!ok) return;
    try { await api.finArchiveGoal(g.id); toast("Meta desativada"); await loadGoals(); } catch (error) { toast(error.message, "error"); }
  });
  on(goalsRoot, "click", "[data-goal-copy]", async (event, b) => {
    const prev = shiftMonth(st.month, -1);
    const list = gs.goals.filter((g) => g.period === "mes" && g.period_start === `${prev}-01`);
    setBusy(b, true);
    try { const n = await api.finCopyGoals(list, st.month); toast(n === 1 ? "1 meta repetida" : `${n} metas repetidas`); await loadGoals(); }
    catch (error) { toast(error.message, "error"); setBusy(b, false); }
  });

  /* ---------- Detalhe do lançamento ---------- */
  async function openEntry(id) {
    st.open = id;
    $("#fin-badges").innerHTML = "";
    $("#fin-body").innerHTML = '<p class="field__hint">Carregando…</p>';
    if (!drawer.open) drawer.showModal();
    try {
      const [entry, settlements] = await Promise.all([api.finEntry(id), api.finSettlements(id)]);
      if (st.open !== id) return;
      renderDrawer(entry, settlements);
    } catch (error) {
      $("#fin-body").innerHTML = stateBlock({ iconName: "message", tone: "error", title: "Não foi possível abrir", text: error.message });
    }
  }

  function renderDrawer(e, settlements) {
    const live = e.status !== "cancelado";
    const word = e.direction === "despesa" ? { act: "pagamento", done: "Pago", verb: "Registrar pagamento" } : { act: "recebimento", done: "Recebido", verb: "Registrar recebimento" };
    const cat = category(e.category_id);
    $("#fin-badges").innerHTML = `<span class="fin-chip fin-chip--${e.direction === "receita" ? "in" : "out"}">${e.direction === "receita" ? "Receita" : "Despesa"}</span>${chip(e)}`;
    const prop = (ic, label, value) => (value ? `<div class="props__row"><span class="props__label">${icon(ic)}${esc(label)}</span><span>${value}</span></div>` : "");
    const active = settlements.filter((s) => !s.voided_at);
    $("#fin-body").innerHTML = `
      <h2 class="drawer__title" id="fin-drawer-title">${esc(e.description)}</h2>
      <p class="drawer__sub">${esc([cat?.name, e.direction === "receita" ? clientName(e.client_id) : ""].filter(Boolean).join(" · "))}</p>
      <ul class="fin-money" aria-label="Valores">
        <li><span>Valor</span><b>${esc(formatMoney(e.amount_cents))}</b></li>
        <li><span>${esc(word.done)}</span><b>${esc(formatMoney(e.settled_cents))}</b></li>
        <li class="${live && e.open_cents > 0 ? "is-open" : ""}"><span>Falta</span><b>${esc(formatMoney(live ? e.open_cents : 0))}</b></li>
      </ul>
      ${manages() && live ? `<div class="drawer__actions drawer__actions--top">
        ${e.open_cents > 0 ? `<button class="btn btn--primary btn--sm" type="button" data-fin-settle="${esc(e.id)}">${icon("check")}<span>${esc(word.verb)}</span></button>` : ""}
        <button class="btn btn--ghost btn--sm" type="button" data-fin-edit="${esc(e.id)}">${icon("edit")}<span>Editar</span></button>
        ${active.length ? "" : `<button class="btn btn--ghost btn--sm btn--danger-text" type="button" data-fin-cancel="${esc(e.id)}">${icon("close")}<span>Cancelar lançamento</span></button>`}
      </div>` : ""}
      <section class="task-box props" aria-label="Detalhes">
        ${prop("calendar", "Vencimento", esc(shortDate(e.due_date)))}
        ${prop("clock", "Competência", esc(monthLabel(e.competence_date.slice(0, 7))))}
        ${prop("wallet", "Conta prevista", esc(account(e.account_id)?.name || ""))}
        ${prop("tag", "Tipo", e.revenue_kind ? esc(REVENUE_KINDS[e.revenue_kind]) : "")}
        ${prop("user", e.direction === "despesa" ? "Fornecedor" : "Quem paga", esc(e.counterparty || ""))}
        ${prop("list", "Nota fiscal", esc(e.invoice_number || ""))}
        ${e.confirmed ? "" : prop("eye", "Situação", "Só previsto (ainda não confirmado)")}
      </section>
      ${e.notes ? `<div class="internal"><p class="internal__label">${icon("lock")}Observações</p><p class="internal__text">${esc(e.notes)}</p></div>` : ""}
      ${e.status === "cancelado" ? `<div class="internal"><p class="internal__label">${icon("close")}Cancelado</p><p class="internal__text">${esc(e.cancel_reason || "")}</p></div>` : ""}
      <section class="detail" aria-labelledby="fin-settle-title">
        <h3 class="detail__title" id="fin-settle-title">${e.direction === "despesa" ? "Pagamentos" : "Recebimentos"}</h3>
        ${settlements.length ? `<ul class="fin-settlements">${settlements.map((s) => `
          <li class="${s.voided_at ? "is-void" : ""}">
            <div><b>${esc(formatMoney(s.amount_cents))}</b> em ${esc(shortDate(s.paid_on))}<span class="fin-settlements__meta">${esc([account(s.account_id)?.name, METHODS[s.method]].filter(Boolean).join(" · "))}</span>
              ${s.notes ? `<span class="fin-settlements__meta">${esc(s.notes)}</span>` : ""}
              ${s.voided_at ? `<span class="fin-settlements__meta">Estornado: ${esc(s.void_reason || "")}</span>` : ""}</div>
            ${manages() && !s.voided_at && live ? `<button class="btn btn--ghost btn--sm btn--danger-text" type="button" data-fin-void="${esc(s.id)}">Estornar</button>` : ""}
          </li>`).join("")}</ul>` : `<p class="field__hint">Nenhum ${esc(word.act)} registrado.</p>`}
      </section>
      <details class="detail history-toggle" data-fin-history-toggle>
        <summary class="history-toggle__summary">${icon("clock")}<span>Histórico</span><span class="history-toggle__hint">quem fez cada mudança</span></summary>
        <div data-fin-audit><p class="field__hint">Carregando…</p></div>
      </details>`;
    drawer.querySelector("[data-fin-history-toggle]").addEventListener("toggle", async (event) => {
      if (!event.target.open || event.target.dataset.loaded) return;
      event.target.dataset.loaded = "1";
      const box = drawer.querySelector("[data-fin-audit]");
      try {
        const rows = await api.finAudit([e.id, ...settlements.map((s) => s.id)]);
        box.innerHTML = rows.length ? `<ul class="history">${rows.map((a) => `<li class="history__item history__item--neutro"><div><p class="history__title"><b>${esc(a.actor_name || "Sistema")}</b> ${esc(AUDIT_ACTIONS[a.action] || a.action)} ${esc(AUDIT_TABLES[a.table_name] || "")} <span class="history__meta">· ${esc(new Date(a.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}</span></p>${a.action === "estornou" || a.action === "cancelou" ? `<p class="history__text">${esc(a.after?.void_reason || a.after?.cancel_reason || "")}</p>` : ""}</div></li>`).join("")}</ul>` : '<p class="field__hint">Sem registros.</p>';
      } catch (error) { box.innerHTML = `<p class="field__hint">${esc(error.message)}</p>`; }
    });
    drawer._entry = e;
    drawer._settlements = settlements;
  }

  /* ---------- Formulários (uma janela só, campos conforme o caso) ---------- */
  const f = (name, label, input, { wide = false, optional = false, hint = "" } = {}) =>
    `<label class="field${wide ? " form-grid__wide" : ""}"><span class="field__label">${esc(label)}${optional ? ' <span class="field__optional">(opcional)</span>' : ""}</span>${input}${hint ? `<span class="field__hint">${esc(hint)}</span>` : ""}</label>`;
  const text = (name, value = "", attrs = "") => `<input class="field__input" name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
  const money = (name, value = "") => `<span class="input-row"><span class="field__suffix">R$</span><input class="field__input" name="${name}" value="${esc(value)}" inputmode="decimal" autocomplete="off" placeholder="0,00"></span>`;
  const select = (name, options, value = "", empty = "") => `<select class="field__input" name="${name}">${empty !== null ? `<option value="">${esc(empty)}</option>` : ""}${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const area = (name, value = "", max = 2000) => `<textarea class="field__input" name="${name}" rows="2" maxlength="${max}">${esc(value ?? "")}</textarea>`;
  const activeAccounts = (keep) => st.accounts.filter((a) => a.active || a.id === keep).map((a) => [a.id, a.name]);

  function openModal(next, { title, text: sub, iconName, fields, submitLabel }) {
    mode = next;
    form.reset();
    modal.querySelector("#fin-modal-title").textContent = title;
    modal.querySelector("[data-fin-modal-text]").textContent = sub || "";
    modal.querySelector("[data-fin-modal-icon]").innerHTML = icon(iconName);
    modal.querySelector("[data-fin-fields]").innerHTML = fields;
    submit.querySelector("span").textContent = submitLabel;
    showFieldErrors(form, {});
    modal.showModal();
    form.querySelector("input:not([type=hidden]):not([type=checkbox]), select, textarea")?.focus();
  }

  function entryForm(direction, entry = null) {
    const dir = entry?.direction || direction;
    const isRev = dir === "receita";
    const cats = st.categories.filter((c) => c.direction === dir && (c.active || c.id === entry?.category_id)).map((c) => [c.id, c.name]);
    const today = todayBR();
    const due = entry?.due_date || (st.month === today.slice(0, 7) ? today : `${st.month}-01`);
    const fields = [
      f("description", "Descrição", text("description", entry?.description, `maxlength="200" autocomplete="off" placeholder="${isRev ? "Ex.: Mensalidade de novembro" : "Ex.: Assinatura do Canva"}"`), { wide: true }),
      f("amount", "Valor", money("amount", entry ? moneyInput(entry.amount_cents) : "")),
      f("category_id", "Categoria", select("category_id", cats, entry?.category_id || "", "Escolha…")),
      f("due_date", "Vencimento", text("due_date", due, 'type="date"')),
      f("competence_date", "Competência (mês a que pertence)", text("competence_date", (entry?.competence_date || due).slice(0, 7), 'type="month"')),
      isRev ? f("client_id", "Cliente", select("client_id", state.clients.map((c) => [c.id, c.name]), entry?.client_id || "", "Nenhum"), { optional: true }) : "",
      isRev ? f("revenue_kind", "Tipo de receita", select("revenue_kind", Object.entries(REVENUE_KINDS), entry?.revenue_kind || "", "Não informar"), { optional: true }) : "",
      f("account_id", "Conta prevista", select("account_id", activeAccounts(entry?.account_id), entry?.account_id || "", "Não definir"), { optional: true }),
      f("counterparty", isRev ? "Quem paga" : "Fornecedor", text("counterparty", entry?.counterparty, 'maxlength="120" autocomplete="off"'), { optional: true }),
      f("invoice_number", "Nota fiscal", text("invoice_number", entry?.invoice_number, 'maxlength="60" autocomplete="off"'), { optional: true }),
      f("notes", "Observações", area("notes", entry?.notes), { wide: true, optional: true }),
      `<label class="check form-grid__wide"><input type="checkbox" name="forecast"${entry && !entry.confirmed ? " checked" : ""}><span>Só previsto · ainda não está confirmado</span></label>`,
      entry ? "" : `<fieldset class="field form-grid__wide fin-paid-now">
        <label class="check"><input type="checkbox" name="paid_now" data-fin-paid-now><span>${isRev ? "Já recebi" : "Já paguei"} · registrar o valor todo agora</span></label>
        <div class="form-grid" data-fin-paid-fields hidden>
          ${f("paid_on", isRev ? "Recebido em" : "Pago em", text("paid_on", today, 'type="date"'))}
          ${f("paid_account_id", "Conta", select("paid_account_id", activeAccounts(), st.accounts.find((a) => a.active)?.id || "", "Escolha…"))}
          ${f("method", "Forma", select("method", Object.entries(METHODS), "pix", "Não informar"), { optional: true })}
        </div></fieldset>`
    ].join("");
    openModal({ kind: "entry", direction: dir, entry, requestId: newRequestId(), settleRequestId: newRequestId() }, {
      title: entry ? `Editar ${isRev ? "receita" : "despesa"}` : isRev ? "Nova receita" : "Nova despesa",
      text: entry ? "Quem já recebeu ou pagou não muda o histórico: os registros ficam salvos." : isRev ? "Dinheiro que entra (ou vai entrar) na agência." : "Dinheiro que sai (ou vai sair) da agência.",
      iconName: isRev ? "sparkle" : "arrowRight", fields, submitLabel: entry ? "Salvar" : "Lançar"
    });
    const toggle = form.querySelector("[data-fin-paid-now]");
    toggle?.addEventListener("change", () => { form.querySelector("[data-fin-paid-fields]").hidden = !toggle.checked; });
  }

  function settleForm(e) {
    const isRev = e.direction === "receita";
    const fields = [
      f("amount", "Valor", money("amount", moneyInput(e.open_cents)), { hint: `Falta ${formatMoney(e.open_cents)}. Pode registrar só uma parte.` }),
      f("paid_on", isRev ? "Recebido em" : "Pago em", text("paid_on", todayBR(), 'type="date"')),
      f("account_id", "Conta", select("account_id", activeAccounts(), e.account_id && account(e.account_id)?.active ? e.account_id : st.accounts.find((a) => a.active)?.id || "", "Escolha…")),
      f("method", "Forma", select("method", Object.entries(METHODS), "pix", "Não informar"), { optional: true }),
      f("notes", "Observação", area("notes", "", 1000), { wide: true, optional: true })
    ].join("");
    openModal({ kind: "settle", entry: e, requestId: newRequestId() }, {
      title: isRev ? "Registrar recebimento" : "Registrar pagamento",
      text: `${e.description} · só registra no painel; nenhuma transferência é feita.`, iconName: "check", fields, submitLabel: "Registrar"
    });
  }

  function reasonForm(kind, payload, title, sub, label) {
    openModal({ kind, ...payload }, { title, text: sub, iconName: "close", fields: f("reason", "Motivo", area("reason", "", 500), { wide: true }), submitLabel: label });
  }

  function accountForm(a = null) {
    const fields = [
      f("name", "Nome", text("name", a?.name, 'maxlength="80" autocomplete="off" placeholder="Ex.: Conta Inter"')),
      f("kind", "Tipo", select("kind", Object.entries(ACCOUNT_KINDS), a?.kind || "conta", null)),
      f("opening_balance", "Saldo inicial", money("opening_balance", a?.opening_balance_cents != null ? moneyInput(a.opening_balance_cents) : ""), { optional: true, hint: "O saldo da conta no dia abaixo. Deixe em branco se ainda não souber." }),
      f("opening_date", "Data desse saldo", text("opening_date", a?.opening_date || "", 'type="date"'), { optional: true }),
      f("notes", "Observações", area("notes", a?.notes, 1000), { wide: true, optional: true }),
      a ? `<label class="check form-grid__wide"><input type="checkbox" name="active"${a.active ? " checked" : ""}><span>Conta em uso (desmarque para tirar dos formulários)</span></label>` : ""
    ].join("");
    openModal({ kind: "account", account: a }, { title: a ? `Editar ${a.name}` : "Nova conta", text: "Não coloque número de conta, agência ou cartão: o nome basta.", iconName: "wallet", fields, submitLabel: "Salvar" });
  }

  function categoryForm(c = null) {
    const fields = [
      c ? "" : f("direction", "Tipo", select("direction", [["receita", "Receita"], ["despesa", "Despesa"]], "despesa", null)),
      f("name", "Nome", text("name", c?.name, 'maxlength="60" autocomplete="off"')),
      !c || c.direction === "receita" ? `<label class="check form-grid__wide" data-revenue-only><input type="checkbox" name="counts_as_revenue"${!c || c.counts_as_revenue !== false ? " checked" : ""}><span>Conta como faturamento (metas e limite do MEI). Desmarque em reembolsos e repasses.</span></label>` : "",
      c ? `<label class="check form-grid__wide"><input type="checkbox" name="active"${c.active ? " checked" : ""}><span>Em uso (desmarque para tirar dos formulários)</span></label>` : ""
    ].join("");
    openModal({ kind: "category", category: c }, { title: c ? `Editar ${c.name}` : "Nova categoria", text: "", iconName: "tag", fields, submitLabel: "Salvar" });
    const dir = form.elements.direction;
    const sync = () => { const box = form.querySelector("[data-revenue-only]"); if (box && dir) box.hidden = dir.value !== "receita"; };
    dir?.addEventListener("change", sync);
    sync();
  }

  /* ---------- Enviar ---------- */
  const data = () => Object.fromEntries(new FormData(form));
  async function afterChange(entryId) {
    await Promise.all([st.tab === "metas" ? loadGoals() : loadEntries(), loadRefs().then(() => { renderAccounts(); renderCategories(); }).catch(() => {})]);
    if (entryId && drawer.open && st.open === entryId) await openEntry(entryId);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!mode || saving) return;
    const d = data();
    let errors = {};
    let run;
    if (mode.kind === "entry") {
      const input = { ...d, direction: mode.direction, forecast: Boolean(d.forecast) };
      errors = validateEntry(input, { categories: st.categories }).errors;
      if (d.paid_now) {
        if (!d.paid_on) errors.paid_on = "Informe a data.";
        if (!d.paid_account_id) errors.paid_account_id = "Escolha a conta.";
      }
      run = async () => {
        if (mode.entry) {
          const saved = await api.finUpdateEntry(mode.entry.id, mode.entry.version, input, { categories: st.categories });
          toast("Lançamento atualizado");
          return saved.id;
        }
        const saved = await api.finCreateEntry(input, mode.requestId, { categories: st.categories });
        if (d.paid_now) {
          try { await api.finSettle({ entry_id: saved.id, account_id: d.paid_account_id, amount: saved.amount_cents, paid_on: d.paid_on, method: d.method }, mode.settleRequestId, { openCents: saved.open_cents }); }
          catch (error) { toast(`Lançado, mas o ${mode.direction === "receita" ? "recebimento" : "pagamento"} não foi registrado: ${error.message}`, "error"); return saved.id; }
        }
        toast(saved.repeated ? "Este lançamento já estava salvo" : mode.direction === "receita" ? "Receita lançada" : "Despesa lançada");
        return saved.id;
      };
    } else if (mode.kind === "settle") {
      errors = validateSettlement({ ...d, entry_id: mode.entry.id }, { openCents: mode.entry.open_cents }).errors;
      run = async () => { await api.finSettle({ ...d, entry_id: mode.entry.id }, mode.requestId, { openCents: mode.entry.open_cents }); toast(mode.entry.direction === "receita" ? "Recebimento registrado" : "Pagamento registrado"); return mode.entry.id; };
    } else if (mode.kind === "cancel" || mode.kind === "void") {
      const r = validateReason(d.reason);
      if (r.error) errors.reason = r.error;
      run = async () => {
        if (mode.kind === "cancel") { await api.finCancelEntry(mode.entry.id, mode.entry.version, d.reason); toast("Lançamento cancelado"); return mode.entry.id; }
        await api.finVoidSettlement(mode.settlement, d.reason); toast("Estornado"); return mode.settlement.entry_id;
      };
    } else if (mode.kind === "account") {
      const input = { ...d, active: mode.account ? Boolean(d.active) : true };
      errors = validateAccount(input).errors;
      run = async () => { await api.finSaveAccount(mode.account?.id, input); toast("Conta salva"); return null; };
    } else if (mode.kind === "category") {
      const input = { ...d, direction: mode.category?.direction || d.direction, active: mode.category ? Boolean(d.active) : true, counts_as_revenue: Boolean(d.counts_as_revenue) };
      errors = validateCategory(input).errors;
      run = async () => { await api.finSaveCategory(mode.category?.id, input); toast("Categoria salva"); return null; };
    } else if (mode.kind === "goal") {
      const kindNow = mode.goal?.kind || d.kind;
      if (GOAL_KINDS[kindNow] && !GOAL_KINDS[kindNow].money) d.target = d.target_count;
      errors = validateGoal({ ...d, kind: kindNow, period: mode.goal?.period || d.period }, { editing: Boolean(mode.goal) }).errors;
      if (mode.goal) { delete errors.kind; delete errors.period; }
      run = async () => { await api.finSaveGoal(mode.goal?.id, { ...d, kind: mode.goal?.kind || d.kind }); toast("Meta salva"); return null; };
    } else if (mode.kind === "mei") {
      run = async () => { st.settings = await api.finSaveMeiLimit(d.mei_limit); toast(d.mei_limit ? "Limite do MEI salvo" : "Limite do MEI removido"); return null; };
    }
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return; }
    saving = true;
    setBusy(submit, true);
    try {
      const entryId = await run();
      saving = false;
      closeDialog(modal);
      await afterChange(entryId);
    } catch (error) {
      showFieldErrors(form, error.fields || {}, error.message);
      // Versão antiga ou lançamento mudou: atualiza o que está na tela
      if (error.status === 409 && mode.entry) afterChange(mode.entry.id).catch(() => {});
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  /* ---------- Ações ---------- */
  on(view, "click", "[data-fin-new]", (event, b) => { if (manages() && st.ready) entryForm(b.dataset.finNew); });
  on(list, "click", "[data-fin-open]", (event, b) => openEntry(b.dataset.finOpen));
  on(drawer, "click", "[data-fin-settle]", () => drawer._entry && settleForm(drawer._entry));
  on(drawer, "click", "[data-fin-edit]", () => drawer._entry && entryForm(drawer._entry.direction, drawer._entry));
  on(drawer, "click", "[data-fin-cancel]", () => {
    const e = drawer._entry;
    if (e) reasonForm("cancel", { entry: e }, "Cancelar lançamento", `${e.description} · ${formatMoney(e.amount_cents)}. Ele continua no histórico, marcado como cancelado.`, "Cancelar lançamento");
  });
  on(drawer, "click", "[data-fin-void]", (event, b) => {
    const s = drawer._settlements?.find((x) => x.id === b.dataset.finVoid);
    if (s) reasonForm("void", { settlement: s, entry: drawer._entry }, "Estornar registro", `${formatMoney(s.amount_cents)} em ${shortDate(s.paid_on)}. O registro fica no histórico como estornado e o valor volta a faltar.`, "Estornar");
  });
  on(view, "click", "[data-fin-account-new]", () => manages() && accountForm());
  on(view, "click", "[data-fin-account-edit]", (event, b) => { const a = st.accounts.find((x) => x.id === b.dataset.finAccountEdit); if (a && manages()) accountForm(a); });
  on(view, "click", "[data-fin-category-new]", () => manages() && categoryForm());
  on(view, "click", "[data-fin-category-edit]", (event, b) => { const c = category(b.dataset.finCategoryEdit); if (c && manages()) categoryForm(c); });
  view.querySelector("[data-fin-history]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const btn = formEl.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      st.settings = await api.finSaveHistoryStart(formEl.elements.history_start.value || null);
      showFieldErrors(formEl, {});
      toast("Início do histórico salvo");
    } catch (error) { showFieldErrors(formEl, error.fields || {}, error.message); }
    finally { setBusy(btn, false); }
  });

  return {
    load,
    reset() { gs.goals = []; gs.year = null; goalsRoot.innerHTML = ""; st.rows = []; st.accounts = []; st.categories = []; st.settings = null; st.ready = false; list.innerHTML = ""; sums.innerHTML = ""; $("#fin-accounts").innerHTML = ""; $("#fin-categories").innerHTML = ""; }
  };
}
