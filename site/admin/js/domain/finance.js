/* Financeiro da agência — regras puras (sem banco, sem tela).
   - Dinheiro é sempre em CENTAVOS (número inteiro). Nada de conta com vírgula
     flutuante: "R$ 1.234,56" vira 123456 e volta para "R$ 1.234,56".
   - Status e saldos oficiais vêm do banco (visões fin_entries_view e
     fin_account_balances); aqui só há a validação antes de enviar, os nomes
     que a tela mostra e somas simples de linhas que já vieram calculadas. */

export const MAX_CENTS = 100000000000;   // R$ 1 bilhão: o mesmo teto do banco
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (v) => UUID.test(String(v || ""));
const clean = (v) => { const s = String(v ?? "").trim(); return s || null; };

export const DIRECTIONS = Object.freeze({ receita: "Receita", despesa: "Despesa" });
export const REVENUE_KINDS = Object.freeze({ recorrente: "Recorrente (mensalidade)", avulsa: "Avulsa (projeto)" });
export const METHODS = Object.freeze({ pix: "Pix", boleto: "Boleto", transferencia: "Transferência", cartao: "Cartão", dinheiro: "Dinheiro", outro: "Outro" });
export const ACCOUNT_KINDS = Object.freeze({ conta: "Conta corrente", poupanca: "Poupança / reserva", caixa: "Dinheiro em caixa", outro: "Outra" });

/** Status calculado pelo banco → nome na tela (muda conforme receita ou despesa) */
export const STATUS = Object.freeze({
  aberto:    { receita: "A receber", despesa: "A pagar", tone: "neutral" },
  previsto:  { receita: "Previsto", despesa: "Previsto", tone: "muted" },
  parcial:   { receita: "Recebido em parte", despesa: "Pago em parte", tone: "info" },
  vencido:   { receita: "Vencido", despesa: "Vencido", tone: "danger" },
  quitado:   { receita: "Recebido", despesa: "Pago", tone: "success" },
  cancelado: { receita: "Cancelado", despesa: "Cancelado", tone: "muted" }
});
export const statusLabel = (row) => {
  const s = STATUS[row?.status];
  if (!s) return "";
  // Vencido mas já com parte paga: diz as duas coisas
  if (row.status === "vencido" && Number(row.settled_cents) > 0) return `${s[row.direction] || s.receita} · ${row.direction === "despesa" ? "pago em parte" : "recebido em parte"}`;
  return s[row.direction] || s.receita;
};

/** Erros do banco (raise exception) → português */
export const FINANCE_ERRORS = Object.freeze({
  categoria_invalida: "Escolha uma categoria.",
  categoria_de_outro_tipo: "Esta categoria é de outro tipo (receita × despesa).",
  categoria_inativa: "Esta categoria foi desativada. Escolha outra.",
  categoria_em_uso: "Esta categoria já tem lançamentos e não pode mudar de tipo.",
  conta_inativa: "Esta conta está desativada. Escolha outra.",
  lancamento_cancelado: "Este lançamento foi cancelado e não pode mais ser alterado.",
  lancamento_nao_encontrado: "Lançamento não encontrado. Atualize a página.",
  tem_baixas_ativas: "Este lançamento já tem recebimento/pagamento registrado. Estorne antes de cancelar.",
  valor_menor_que_baixas: "O valor não pode ficar menor do que o já recebido/pago.",
  baixa_maior_que_saldo: "O valor passa do que falta receber/pagar.",
  baixa_imutavel: "Recebimentos e pagamentos não se editam: estorne e registre de novo.",
  baixa_ja_estornada: "Este registro já foi estornado.",
  versao_desatualizada: "Outra pessoa alterou este lançamento agora há pouco. Atualize e tente de novo.",
  campo_imutavel: "Este dado não pode ser alterado.",
  mensalidade_nao_encontrada: "Mensalidade não encontrada. Atualize a página.",
  mensalidade_de_outro_cliente: "Este lançamento não é do cliente desta mensalidade.",
  sem_permissao: "Seu usuário não tem permissão para fazer isso.",
  mes_invalido: "Mês inválido."
});

/* ---------- Dinheiro ---------- */

/**
 * Texto digitado → centavos (inteiro) ou null.
 * Aceita "1.234,56", "1234,56", "R$ 1.234", "1234.56" e "1234".
 * Vírgula é sempre o decimal; ponto só é decimal quando tem 1 ou 2 casas no fim.
 */
export function parseMoney(input) {
  if (typeof input === "number") return Number.isSafeInteger(input) ? input : null;
  let s = String(input ?? "").replace(/R\$|\s| /gi, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  let whole, frac = "";
  if (s.includes(",")) {
    if ((s.match(/,/g) || []).length > 1) return null;
    [whole, frac] = s.split(",");
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(whole)) return null;
    whole = whole.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [whole, frac] = s.split(".");
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    whole = s.replace(/\./g, "");
  } else return null;
  if (!/^\d*$/.test(frac) || frac.length > 2 || !whole) return null;
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Centavos → "R$ 1.234,56" (negativo: "-R$ 1.234,56") */
export function formatMoney(cents, { symbol = true } = {}) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(Math.trunc(n));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const text = `${symbol ? "R$ " : ""}${whole},${String(abs % 100).padStart(2, "0")}`;
  return n < 0 ? `-${text}` : text;
}
/** Para preencher o campo de valor ao editar: "1.234,56" */
export const moneyInput = (cents) => (cents == null ? "" : formatMoney(cents, { symbol: false }));

export const sumCents = (rows, key) => rows.reduce((total, r) => total + (Number(r[key]) || 0), 0);

/* ---------- Datas ---------- */

/** "Hoje" no horário de Brasília, como o banco (private.fin_today) */
export function todayBR(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const validDate = (s) => {
  if (!DATE.test(String(s || ""))) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "2000-01-01" && s <= "2100-12-31";
};
export const isDate = validDate;
/** "2026-11" → { from: "2026-11-01", to: "2026-11-30" } */
export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthLabel = (month) => { const [y, m] = String(month).split("-").map(Number); return MONTHS[m - 1] ? `${MONTHS[m - 1]} de ${y}` : ""; };
/** "Novembro de 2026" (só a primeira letra maiúscula) */
export const monthTitle = (month) => { const t = monthLabel(month); return t.charAt(0).toUpperCase() + t.slice(1); };
export const shortDate = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

/* ---------- Validação (o banco confere tudo de novo) ---------- */

export const newRequestId = () => globalThis.crypto.randomUUID();

/** Receita ou despesa: { value, errors } */
export function validateEntry(input = {}, { categories = [] } = {}) {
  const errors = {};
  const direction = input.direction === "despesa" ? "despesa" : input.direction === "receita" ? "receita" : null;
  const amount = parseMoney(input.amount ?? input.amount_cents);
  const value = {
    direction,
    description: clean(input.description),
    amount_cents: amount,
    category_id: clean(input.category_id),
    account_id: clean(input.account_id),
    client_id: direction === "receita" ? clean(input.client_id) : null,
    revenue_kind: direction === "receita" ? (["recorrente", "avulsa"].includes(input.revenue_kind) ? input.revenue_kind : null) : null,
    counterparty: clean(input.counterparty),
    competence_date: clean(input.competence_date),
    due_date: clean(input.due_date),
    confirmed: !(input.confirmed === false || input.confirmed === "false" || input.forecast === true || input.forecast === "on"),
    invoice_number: clean(input.invoice_number),
    notes: clean(input.notes)
  };
  // Competência pode vir como mês ("2026-11"): vale o dia 1º
  if (value.competence_date && /^\d{4}-\d{2}$/.test(value.competence_date)) value.competence_date += "-01";
  if (!direction) errors.direction = "Escolha receita ou despesa.";
  if (!value.description) errors.description = "Descreva o lançamento.";
  else if (value.description.length > 200) errors.description = "Use até 200 caracteres.";
  if (amount == null) errors.amount = "Informe o valor (ex.: 1.500,00).";
  else if (amount <= 0) errors.amount = "O valor precisa ser maior que zero.";
  else if (amount > MAX_CENTS) errors.amount = "Valor alto demais.";
  if (!isId(value.category_id)) errors.category_id = "Escolha a categoria.";
  else if (categories.length) {
    const cat = categories.find((c) => c.id === value.category_id);
    if (!cat) errors.category_id = "Escolha a categoria.";
    else if (direction && cat.direction !== direction) errors.category_id = "Esta categoria é de outro tipo.";
  }
  if (value.account_id && !isId(value.account_id)) errors.account_id = "Conta inválida.";
  if (value.client_id && !isId(value.client_id)) errors.client_id = "Cliente inválido.";
  if (!validDate(value.due_date)) errors.due_date = "Informe o vencimento.";
  if (!value.competence_date) value.competence_date = validDate(value.due_date) ? `${value.due_date.slice(0, 7)}-01` : null;
  if (!validDate(value.competence_date)) errors.competence_date = "Informe o mês de competência.";
  if (value.counterparty && value.counterparty.length > 120) errors.counterparty = "Use até 120 caracteres.";
  if (value.invoice_number && value.invoice_number.length > 60) errors.invoice_number = "Use até 60 caracteres.";
  if (value.notes && value.notes.length > 2000) errors.notes = "Use até 2.000 caracteres.";
  return { value, errors };
}

/** Recebimento/pagamento (baixa): { value, errors }. openCents = quanto falta (da visão) */
export function validateSettlement(input = {}, { openCents = null } = {}) {
  const errors = {};
  const amount = parseMoney(input.amount ?? input.amount_cents);
  const value = {
    entry_id: clean(input.entry_id),
    account_id: clean(input.account_id),
    amount_cents: amount,
    paid_on: clean(input.paid_on),
    method: Object.hasOwn(METHODS, input.method) ? input.method : null,
    notes: clean(input.notes)
  };
  if (!isId(value.entry_id)) errors.entry_id = "Lançamento inválido.";
  if (!isId(value.account_id)) errors.account_id = "Escolha a conta.";
  if (amount == null) errors.amount = "Informe o valor.";
  else if (amount <= 0) errors.amount = "O valor precisa ser maior que zero.";
  else if (openCents != null && amount > openCents) errors.amount = `Falta ${formatMoney(openCents)}: o valor não pode passar disso.`;
  if (!validDate(value.paid_on)) errors.paid_on = "Informe a data.";
  if (value.notes && value.notes.length > 1000) errors.notes = "Use até 1.000 caracteres.";
  return { value, errors };
}

export function validateReason(text, max = 500) {
  const v = clean(text);
  if (!v) return { value: null, error: "Escreva o motivo." };
  if (v.length > max) return { value: null, error: `Use até ${max} caracteres.` };
  return { value: v, error: null };
}

export function validateAccount(input = {}) {
  const errors = {};
  const hasOpening = clean(input.opening_balance) != null;
  const opening = hasOpening ? parseMoney(input.opening_balance) : null;
  const value = {
    name: clean(input.name),
    kind: Object.hasOwn(ACCOUNT_KINDS, input.kind) ? input.kind : "conta",
    opening_balance_cents: opening,
    opening_date: hasOpening ? clean(input.opening_date) : null,
    active: !(input.active === false || input.active === "false"),
    notes: clean(input.notes)
  };
  if (!value.name) errors.name = "Dê um nome à conta.";
  else if (value.name.length > 80) errors.name = "Use até 80 caracteres.";
  if (hasOpening && opening == null) errors.opening_balance = "Valor inválido (ex.: 2.350,00).";
  else if (hasOpening && Math.abs(opening) > MAX_CENTS) errors.opening_balance = "Valor alto demais.";
  if (hasOpening && !validDate(value.opening_date)) errors.opening_date = "Informe a data desse saldo.";
  if (value.notes && value.notes.length > 1000) errors.notes = "Use até 1.000 caracteres.";
  return { value, errors };
}

export function validateCategory(input = {}) {
  const errors = {};
  const value = {
    direction: input.direction === "despesa" ? "despesa" : input.direction === "receita" ? "receita" : null,
    name: clean(input.name),
    active: !(input.active === false || input.active === "false")
  };
  if (!value.direction) errors.direction = "Escolha receita ou despesa.";
  if (!value.name) errors.name = "Dê um nome à categoria.";
  else if (value.name.length > 60) errors.name = "Use até 60 caracteres.";
  return { value, errors };
}

/** Filtros da lista (vêm do endereço da página: tudo é conferido) */
export function validateEntryFilters(input = {}) {
  const out = {};
  if (monthRange(input.month)) out.month = input.month;
  if (["receita", "despesa"].includes(input.direction)) out.direction = input.direction;
  if (Object.hasOwn(STATUS, input.status) || input.status === "pendente") out.status = input.status;
  for (const k of ["category_id", "account_id", "client_id"]) if (isId(input[k])) out[k] = input[k];
  if (["vencimento", "competencia"].includes(input.basis)) out.basis = input.basis;
  if (input.q) out.q = String(input.q).trim().slice(0, 80);
  return out;
}

/** Totais de uma lista já filtrada (linhas da visão; canceladas ficam de fora) */
export function entryTotals(rows) {
  const live = rows.filter((r) => r.status !== "cancelado");
  const by = (dir) => live.filter((r) => r.direction === dir);
  const rec = by("receita"); const des = by("despesa");
  return {
    revenue: sumCents(rec, "amount_cents"), received: sumCents(rec, "settled_cents"), toReceive: sumCents(rec, "open_cents"),
    expense: sumCents(des, "amount_cents"), paid: sumCents(des, "settled_cents"), toPay: sumCents(des, "open_cents"),
    overdue: sumCents(live.filter((r) => r.status === "vencido"), "open_cents"),
    count: live.length
  };
}

/* ---------- Metas ----------
   O realizado vem calculado do banco (fin_goal_progress). Aqui ficam só os
   nomes, a validação do formulário e a leitura do progresso (percentual,
   quanto falta e o ritmo do período em andamento). */

/** higher: quanto mais, melhor (faturamento); false: é um teto (gasto) */
export const GOAL_KINDS = Object.freeze({
  faturamento:      { label: "Faturamento", short: "Faturamento", money: true, higher: true, hint: "Receitas do período (sem as categorias marcadas como fora do faturamento, ex.: reembolso)." },
  resultado:        { label: "Resultado (receitas − despesas)", short: "Resultado", money: true, higher: true, hint: "O que sobra: tudo o que entra menos tudo o que sai." },
  despesas:         { label: "Teto de despesas", short: "Despesas", money: true, higher: false, hint: "Quanto a agência pode gastar no período, no máximo." },
  limite_categoria: { label: "Teto de gasto por categoria", short: "Gasto", money: true, higher: false, hint: "Ex.: no máximo R$ 300,00 em Ferramentas e assinaturas." },
  clientes_ativos:  { label: "Clientes ativos", short: "Clientes ativos", money: false, higher: true, hint: "Quantos clientes ativos no cadastro (contagem de agora)." }
});
export const GOAL_BASIS = Object.freeze({ competencia: "Competência (mês a que pertence)", caixa: "Caixa (o que entrou/saiu de verdade)" });

export function validateGoal(input = {}, { editing = false } = {}) {
  const errors = {};
  const kind = Object.hasOwn(GOAL_KINDS, input.kind) ? input.kind : null;
  const period = input.period === "ano" ? "ano" : input.period === "mes" ? "mes" : null;
  let start = null;
  if (period === "mes" && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.month || ""))) start = `${input.month}-01`;
  if (period === "ano" && /^\d{4}$/.test(String(input.year || "")) && Number(input.year) >= 2000 && Number(input.year) <= 2100) start = `${input.year}-01-01`;
  const meta = kind ? GOAL_KINDS[kind] : null;
  let target = null;
  if (meta?.money) target = parseMoney(input.target);
  else if (meta) target = /^\d{1,6}$/.test(String(input.target ?? "").trim()) ? Number(String(input.target).trim()) : null;
  const value = {
    kind, period, period_start: start, target,
    basis: kind === "clientes_ativos" ? "competencia" : input.basis === "caixa" ? "caixa" : "competencia",
    category_id: kind === "limite_categoria" ? clean(input.category_id) : null,
    notes: clean(input.notes)
  };
  if (!editing) {
    if (!kind) errors.kind = "Escolha o tipo de meta.";
    if (!period) errors.period = "Escolha mês ou ano.";
    else if (!start) errors[period === "mes" ? "month" : "year"] = period === "mes" ? "Escolha o mês." : "Informe o ano (ex.: 2027).";
  }
  if (target == null) errors.target = meta && !meta.money ? "Informe um número inteiro." : "Informe o valor (ex.: 10.000,00).";
  else if (target < 0) errors.target = "A meta não pode ser negativa.";
  else if (target > MAX_CENTS) errors.target = "Valor alto demais.";
  if (kind === "limite_categoria" && !isId(value.category_id)) errors.category_id = "Escolha a categoria.";
  if (value.notes && value.notes.length > 500) errors.notes = "Use até 500 caracteres.";
  return { value, errors };
}

/** Andamento do período: "passado" | "atual" | "futuro" e a fração já corrida (0–1) */
export function periodProgress(start, end, today = todayBR()) {
  if (today < start) return { phase: "futuro", elapsed: 0 };
  if (today > end) return { phase: "passado", elapsed: 1 };
  const day = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const total = (day(end) - day(start)) / 86400000 + 1;
  const done = (day(today) - day(start)) / 86400000 + 1;
  return { phase: "atual", elapsed: Math.min(1, done / total) };
}

/**
 * Leitura de uma meta (linha da visão fin_goal_progress).
 * pct: realizado/meta (0–∞); remaining: quanto falta (meta de alta) ou quanto
 * ainda pode gastar (teto); pace: projeção pelo ritmo, só no período em andamento
 * e só em valores; tone: success | warn | danger | neutral.
 */
export function goalReading(g, today = todayBR()) {
  const meta = GOAL_KINDS[g.kind] || GOAL_KINDS.faturamento;
  const target = Number(g.target) || 0;
  const actual = Number(g.actual) || 0;
  const { phase, elapsed } = periodProgress(g.period_start, g.period_end, today);
  const pct = target > 0 ? actual / target : actual > 0 ? 1 : 0;
  const pace = meta.money && phase === "atual" && elapsed > 0 && g.kind !== "clientes_ativos" ? Math.round(actual / elapsed) : null;
  let tone = "neutral"; let label = "";
  if (meta.higher) {
    const remaining = Math.max(0, target - actual);
    if (actual >= target && target > 0) { tone = "success"; label = phase === "passado" ? "Meta batida" : "Meta já batida"; }
    else if (phase === "passado") { tone = "danger"; label = "Não bateu"; }
    else if (phase === "futuro") { label = "Ainda não começou"; }
    else if (pace != null) { tone = pace >= target ? "success" : pace >= target * 0.8 ? "warn" : "danger"; label = pace >= target ? "No ritmo" : "Abaixo do ritmo"; }
    else { tone = pct >= elapsed ? "success" : "warn"; label = "Em andamento"; }
    return { pct, remaining, pace, tone, label, phase, elapsed };
  }
  // Teto: passar é ruim
  const remaining = target - actual;
  if (actual > target) { tone = "danger"; label = "Estourou o teto"; }
  else if (phase === "futuro") { label = "Ainda não começou"; }
  else if (phase === "passado") { tone = "success"; label = "Dentro do teto"; }
  else if (pace != null && pace > target) { tone = "warn"; label = "No ritmo de estourar"; }
  else if (pct >= 0.8) { tone = "warn"; label = "Perto do teto"; }
  else { tone = "success"; label = "Dentro do teto"; }
  return { pct, remaining, pace, tone, label, phase, elapsed };
}

/** Limite anual do MEI: usado / limite (aviso a partir de 80%) */
export function meiReading(limitCents, billedCents) {
  if (!limitCents) return null;
  const pct = billedCents / limitCents;
  return { pct, remaining: limitCents - billedCents, tone: pct >= 1 ? "danger" : pct >= 0.8 ? "warn" : "success" };
}
export const percent = (x) => `${Math.round((Number(x) || 0) * 100)}%`;

/* ---------- Mensalidades (contratos dos clientes) ---------- */

/** A mensalidade vale neste mês? (pausada não gera) */
export const contractCovers = (c, month) => !c.paused && c.start_month.slice(0, 7) <= month && (!c.end_month || c.end_month.slice(0, 7) >= month);
/** Vencimento no mês: dia 29–31 vira o último dia nos meses curtos (como no banco) */
export function contractDueDate(c, month) {
  const last = monthRange(month).to.slice(8, 10);
  return `${month}-${String(Math.min(Number(c.due_day), Number(last))).padStart(2, "0")}`;
}

export function validateContract(input = {}, { editing = false, categories = [] } = {}) {
  const errors = {};
  const amount = parseMoney(input.amount);
  const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));
  const value = {
    client_id: clean(input.client_id),
    description: clean(input.description) || "Mensalidade",
    amount_cents: amount,
    due_day: /^\d{1,2}$/.test(String(input.due_day ?? "").trim()) ? Number(input.due_day) : null,
    start_month: monthOk(input.start_month) ? `${input.start_month}-01` : null,
    end_month: clean(input.end_month) ? (monthOk(input.end_month) ? `${input.end_month}-01` : "x") : null,
    category_id: clean(input.category_id),
    account_id: clean(input.account_id),
    method: Object.hasOwn(METHODS, input.method) ? input.method : null,
    notes: clean(input.notes),
    paused: input.paused === true || input.paused === "on"
  };
  if (!editing && !isId(value.client_id)) errors.client_id = "Escolha o cliente.";
  if (value.description.length > 120) errors.description = "Use até 120 caracteres.";
  if (amount == null) errors.amount = "Informe o valor (ex.: 1.500,00).";
  else if (amount <= 0) errors.amount = "O valor precisa ser maior que zero.";
  else if (amount > MAX_CENTS) errors.amount = "Valor alto demais.";
  if (!value.due_day || value.due_day < 1 || value.due_day > 31) errors.due_day = "Dia de 1 a 31.";
  if (!value.start_month) errors.start_month = "Escolha o mês de início.";
  if (value.end_month === "x") errors.end_month = "Mês inválido.";
  else if (value.end_month && value.start_month && value.end_month < value.start_month) errors.end_month = "O fim não pode ser antes do início.";
  if (!isId(value.category_id)) errors.category_id = "Escolha a categoria.";
  else if (categories.length && categories.find((c) => c.id === value.category_id)?.direction !== "receita") errors.category_id = "Use uma categoria de receita.";
  if (value.account_id && !isId(value.account_id)) errors.account_id = "Conta inválida.";
  if (value.notes && value.notes.length > 1000) errors.notes = "Use até 1.000 caracteres.";
  return { value, errors };
}

/**
 * Linhas do mês: cada mensalidade que vale no mês, com o lançamento dela (se já
 * foi lançado) e a situação. entries = linhas da visão com contract_id.
 */
export function monthlyRows(contracts, entries, month) {
  return contracts.filter((c) => contractCovers(c, month) || entries.some((e) => e.contract_id === c.id))
    .map((c) => {
      const entry = entries.find((e) => e.contract_id === c.id) || null;
      return { contract: c, entry, status: entry ? entry.status : "nao_lancada", due: entry?.due_date || contractDueDate(c, month) };
    });
}
export function monthlyTotals(contracts, rows, month) {
  const live = rows.filter((r) => r.status !== "cancelado");
  return {
    // O que vale no mês: o lançado (com o valor da época) ou, se ainda não lançou, o valor do contrato
    recurring: live.reduce((t, r) => t + (r.entry ? Number(r.entry.amount_cents) || 0 : r.contract.amount_cents), 0),
    received: live.reduce((t, r) => t + (Number(r.entry?.settled_cents) || 0), 0),
    toReceive: live.reduce((t, r) => t + (r.entry ? Number(r.entry.open_cents) || 0 : r.contract.amount_cents), 0),
    overdue: live.filter((r) => r.status === "vencido").reduce((t, r) => t + (Number(r.entry.open_cents) || 0), 0),
    missing: rows.filter((r) => r.status === "nao_lancada").length
  };
}
