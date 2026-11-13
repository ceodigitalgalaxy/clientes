/* Gestão de demandas: status oficiais, cores e validação das tarefas.
   O status oficial é o que vale (relatórios, sincronia com o conteúdo); as
   colunas do quadro são só nome/cor/ordem por cima dele. Etiqueta (categoria),
   prioridade (urgência), status (etapa) e prazo (data) são coisas separadas. */

export const TASK_STATUS = Object.freeze({
  a_fazer: { label: "A fazer", color: "cinza" },
  em_andamento: { label: "Em andamento", color: "azul" },
  em_revisao: { label: "Em revisão", color: "roxo" },
  aguardando_pessoa: { label: "Aguardando outra pessoa", color: "laranja" },
  aguardando_cliente: { label: "Aguardando cliente", color: "amarelo" },
  ajustes: { label: "Ajustes solicitados", color: "vermelho" },
  concluido: { label: "Concluído", color: "verde" }
});

export const COLORS = Object.freeze({
  cinza: "Cinza", azul: "Azul", roxo: "Roxo", amarelo: "Amarelo", laranja: "Laranja", vermelho: "Vermelho", verde: "Verde", rosa: "Rosa"
});

export const TASK_PRIORITIES = Object.freeze({
  baixa: { label: "Baixa", rank: 3 },
  media: { label: "Média", rank: 2 },
  alta: { label: "Alta", rank: 1 },
  urgente: { label: "Urgente", rank: 0 }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isId = (v) => UUID.test(String(v || ""));
const clean = (v) => (typeof v === "string" ? v.trim() : v ?? "");

/** "AAAA-MM-DD" + "HH:MM" (horário local) → ISO; sem data = sem prazo */
export function dueFrom(date, time) {
  if (!date) return null;
  const [y, m, d] = String(date).split("-").map(Number);
  const [hh, mm] = (time || "18:00").split(":").map(Number);
  const when = new Date(y, m - 1, d, hh || 0, mm || 0);
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString();
}
/** ISO → { date, time } no horário local (para os campos do formulário) */
export function dueParts(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * Valida o que a tela manda criar/alterar. Só os campos presentes entram (dá para
 * mandar só o status, só o prazo…). client_id "" = interno da agência.
 */
export function validateTask(input = {}, { creating = false } = {}) {
  const errors = {};
  const value = {};
  if (creating || "title" in input) {
    value.title = clean(input.title);
    if (!value.title) errors.title = "Dê um título para a demanda.";
    else if (value.title.length > 200) errors.title = "Use até 200 caracteres.";
  }
  if ("description" in input) {
    value.description = clean(input.description) || null;
    if (value.description && value.description.length > 10000) errors.description = "Use até 10.000 caracteres.";
  }
  if ("client_id" in input) {
    value.client_id = clean(input.client_id) || null;
    if (value.client_id && !isId(value.client_id)) errors.client_id = "Escolha o cliente.";
  }
  for (const key of ["project_id", "content_id", "parent_id", "column_id"]) {
    if (key in input) {
      value[key] = clean(input[key]) || null;
      if (value[key] && !isId(value[key])) errors[key] = "Registro inválido.";
    }
  }
  if ("status" in input) {
    value.status = clean(input.status);
    if (!TASK_STATUS[value.status]) errors.status = "Escolha a etapa.";
  }
  if ("priority" in input) {
    value.priority = clean(input.priority) || "media";
    if (!TASK_PRIORITIES[value.priority]) errors.priority = "Escolha a prioridade.";
  }
  if ("due_date" in input || "due_time" in input) {
    const due = dueFrom(clean(input.due_date), clean(input.due_time));
    if (due === undefined) errors.due_date = "Data inválida.";
    else value.due_at = due;
  } else if ("due_at" in input) {
    value.due_at = input.due_at || null;
  }
  if ("position" in input) {
    value.position = Number(input.position);
    if (!Number.isFinite(value.position)) errors.position = "Posição inválida.";
  }
  if ("archived_at" in input) value.archived_at = input.archived_at || null;
  return { value, errors };
}

/** Prazo de uma tarefa em relação a agora: atrasada, hoje, amanhã… */
export function dueState(iso, status, now = new Date()) {
  if (!iso) return null;
  if (status === "concluido") return { tone: "done", label: "Entregue" };
  const due = new Date(iso);
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(due) - start(now)) / 86400000);
  if (due < now) return { tone: "late", label: days === 0 ? "Atrasada hoje" : `Atrasada ${-days || 1} ${-days === 1 ? "dia" : "dias"}`, days };
  if (days === 0) return { tone: "today", label: "Hoje", days };
  if (days === 1) return { tone: "soon", label: "Amanhã", days };
  return { tone: days <= 3 ? "soon" : "ok", label: due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), days };
}
