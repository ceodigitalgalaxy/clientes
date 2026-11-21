/* Regras do financeiro (centavos, validação, totais). Rode: node admin/test/finance.test.mjs */

import assert from "node:assert/strict";
import { parseMoney, formatMoney, moneyInput, validateEntry, validateSettlement, validateAccount, validateEntryFilters, entryTotals, monthRange, shiftMonth, todayBR, statusLabel, validateGoal, goalReading, periodProgress, meiReading } from "../../site/admin/js/domain/finance.js";

let n = 0;
const check = (label, fn) => { fn(); n += 1; console.log(`✔ ${label}`); };

check("Dinheiro digitado vira centavos inteiros (sem float)", () => {
  assert.equal(parseMoney("1.234,56"), 123456);
  assert.equal(parseMoney("R$ 1.234,56"), 123456);
  assert.equal(parseMoney("1234,5"), 123450);
  assert.equal(parseMoney("1234.56"), 123456);
  assert.equal(parseMoney("1.500"), 150000);
  assert.equal(parseMoney("0,10"), 10);
  assert.equal(parseMoney("0,1"), 10);
  assert.equal(parseMoney("19,99"), 1999);
  assert.equal(parseMoney("-50,00"), -5000);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney("1,2,3"), null);
  assert.equal(parseMoney("1,234"), null);
  assert.equal(parseMoney("12.34.56"), null);
  // 0,1 + 0,2 em float dá 0.30000000000000004; em centavos é exato
  assert.equal(parseMoney("0,10") + parseMoney("0,20"), parseMoney("0,30"));
});

check("Centavos voltam formatados em reais", () => {
  assert.equal(formatMoney(123456), "R$ 1.234,56");
  assert.equal(formatMoney(5), "R$ 0,05");
  assert.equal(formatMoney(0), "R$ 0,00");
  assert.equal(formatMoney(-150000), "-R$ 1.500,00");
  assert.equal(formatMoney(100000000000), "R$ 1.000.000.000,00");
  assert.equal(moneyInput(123456), "1.234,56");
  assert.equal(parseMoney(moneyInput(987654321)), 987654321);
});

const cats = [{ id: "11111111-1111-4111-8111-111111111111", direction: "receita" }, { id: "22222222-2222-4222-8222-222222222222", direction: "despesa" }];

check("Lançamento: valida valor, categoria do tipo certo e datas", () => {
  const ok = validateEntry({ direction: "receita", description: "Mensalidade", amount: "1.500,00", category_id: cats[0].id, due_date: "2026-11-10", competence_date: "2026-11" }, { categories: cats });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.amount_cents, 150000);
  assert.equal(ok.value.competence_date, "2026-11-01");
  assert.equal(ok.value.confirmed, true);
  const bad = validateEntry({ direction: "receita", description: "", amount: "0", category_id: cats[1].id, due_date: "2026-02-30" }, { categories: cats });
  assert.ok(bad.errors.description && bad.errors.amount && bad.errors.category_id && bad.errors.due_date);
  const neg = validateEntry({ direction: "despesa", description: "x", amount: "-5", category_id: cats[1].id, due_date: "2026-11-01" }, { categories: cats });
  assert.ok(neg.errors.amount, "valor negativo recusado");
  const forecast = validateEntry({ direction: "despesa", description: "x", amount: "5", category_id: cats[1].id, due_date: "2026-11-01", forecast: true, client_id: cats[0].id, revenue_kind: "recorrente" }, { categories: cats });
  assert.equal(forecast.value.confirmed, false);
  assert.equal(forecast.value.client_id, null, "despesa não tem cliente");
  assert.equal(forecast.value.revenue_kind, null);
  assert.equal(forecast.value.competence_date, "2026-11-01", "sem competência: mês do vencimento");
});

check("Baixa (recebimento/pagamento) não passa do que falta", () => {
  const base = { entry_id: cats[0].id, account_id: cats[1].id, paid_on: "2026-11-05" };
  assert.deepEqual(validateSettlement({ ...base, amount: "500,00" }, { openCents: 150000 }).errors, {});
  assert.ok(validateSettlement({ ...base, amount: "1.500,01" }, { openCents: 150000 }).errors.amount);
  assert.ok(validateSettlement({ ...base, amount: "0" }, { openCents: 150000 }).errors.amount);
  assert.ok(validateSettlement({ ...base, account_id: "", amount: "1" }).errors.account_id);
});

check("Conta: saldo inicial é opcional, mas exige a data quando informado", () => {
  assert.deepEqual(validateAccount({ name: "Conta Inter" }).errors, {});
  assert.equal(validateAccount({ name: "Conta Inter" }).value.opening_balance_cents, null);
  assert.ok(validateAccount({ name: "Conta Inter", opening_balance: "2.000,00" }).errors.opening_date);
  const v = validateAccount({ name: "Conta Inter", opening_balance: "-350,25", opening_date: "2026-01-01" });
  assert.deepEqual(v.errors, {});
  assert.equal(v.value.opening_balance_cents, -35025);
});

check("Filtros do endereço são conferidos (nada estranho chega ao banco)", () => {
  assert.deepEqual(validateEntryFilters({ month: "2026-13", direction: "x", status: "<script>", category_id: "1 or 1=1", basis: "competencia" }), { basis: "competencia" });
  assert.deepEqual(validateEntryFilters({ month: "2026-11", status: "pendente" }), { month: "2026-11", status: "pendente" });
});

check("Meses e totais", () => {
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.match(todayBR(new Date("2026-11-20T02:30:00Z")), /^2026-11-19$/, "23h30 em Brasília ainda é o dia 19");
  const rows = [
    { direction: "receita", amount_cents: 150000, settled_cents: 50000, open_cents: 100000, status: "vencido" },
    { direction: "receita", amount_cents: 20000, settled_cents: 0, open_cents: 20000, status: "cancelado" },
    { direction: "despesa", amount_cents: 9990, settled_cents: 9990, open_cents: 0, status: "quitado" }
  ];
  const t = entryTotals(rows);
  assert.deepEqual([t.revenue, t.received, t.toReceive, t.expense, t.paid, t.toPay, t.overdue, t.count], [150000, 50000, 100000, 9990, 9990, 0, 100000, 2]);
  assert.equal(statusLabel({ status: "quitado", direction: "despesa" }), "Pago");
  assert.equal(statusLabel({ status: "vencido", direction: "receita", settled_cents: 1 }), "Vencido · recebido em parte");
});

check("Metas: validação do formulário", () => {
  const ok = validateGoal({ kind: "faturamento", period: "mes", month: "2026-11", target: "10.000,00", basis: "caixa" });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual([ok.value.period_start, ok.value.target, ok.value.basis], ["2026-11-01", 1000000, "caixa"]);
  const year = validateGoal({ kind: "resultado", period: "ano", year: "2027", target: "50.000" });
  assert.equal(year.value.period_start, "2027-01-01");
  const clients = validateGoal({ kind: "clientes_ativos", period: "mes", month: "2026-11", target: "12", basis: "caixa" });
  assert.deepEqual([clients.value.target, clients.value.basis], [12, "competencia"], "quantidade inteira; base fixa");
  assert.ok(validateGoal({ kind: "clientes_ativos", period: "mes", month: "2026-11", target: "1,5" }).errors.target);
  assert.ok(validateGoal({ kind: "limite_categoria", period: "mes", month: "2026-11", target: "300" }).errors.category_id);
  const bad = validateGoal({ kind: "x", period: "semana", target: "-1" });
  assert.ok(bad.errors.kind && bad.errors.period && bad.errors.target);
  assert.ok(validateGoal({ kind: "faturamento", period: "mes", month: "2026-13", target: "1" }).errors.month);
  assert.deepEqual(validateGoal({ target: "2.000,00" }, { editing: true }).errors.kind, undefined, "ao editar, tipo e período não mudam");
});

check("Metas: leitura do progresso (meta de alta e teto)", () => {
  const month = { period_start: "2026-11-01", period_end: "2026-11-30" };
  assert.deepEqual(periodProgress("2026-11-01", "2026-11-30", "2026-11-15"), { phase: "atual", elapsed: 0.5 });
  assert.equal(periodProgress("2026-11-01", "2026-11-30", "2026-12-01").phase, "passado");
  const onPace = goalReading({ kind: "faturamento", target: 1000000, actual: 600000, ...month }, "2026-11-15");
  assert.deepEqual([onPace.pace, onPace.tone, onPace.label, onPace.remaining], [1200000, "success", "No ritmo", 400000]);
  const behind = goalReading({ kind: "faturamento", target: 1000000, actual: 200000, ...month }, "2026-11-15");
  assert.equal(behind.tone, "danger");
  assert.equal(goalReading({ kind: "faturamento", target: 1000000, actual: 1000000, ...month }, "2026-11-15").label, "Meta já batida");
  assert.equal(goalReading({ kind: "faturamento", target: 1000000, actual: 900000, ...month }, "2026-12-02").label, "Não bateu");
  const cap = goalReading({ kind: "limite_categoria", target: 30000, actual: 35000, ...month }, "2026-11-10");
  assert.deepEqual([cap.tone, cap.label, cap.remaining], ["danger", "Estourou o teto", -5000]);
  assert.equal(goalReading({ kind: "despesas", target: 100000, actual: 60000, ...month }, "2026-11-10").label, "No ritmo de estourar");
  assert.equal(goalReading({ kind: "despesas", target: 100000, actual: 20000, ...month }, "2026-11-10").label, "Dentro do teto");
  assert.equal(goalReading({ kind: "clientes_ativos", target: 10, actual: 7, ...month }, "2026-11-10").pace, null, "clientes não têm projeção");
  assert.equal(goalReading({ kind: "faturamento", target: 1000000, actual: 0, period_start: "2026-12-01", period_end: "2026-12-31" }, "2026-11-10").label, "Ainda não começou");
  assert.equal(meiReading(null, 100), null);
  assert.equal(meiReading(8100000, 6500000).tone, "warn");
  assert.equal(meiReading(8100000, 8200000).tone, "danger");
});

console.log(`\n${n} verificações ok`);
