/* Cores de alerta de cada conteúdo (calendário, legenda e demandas).
   Uma regra só, sem tela: verde concluído, azul em produção, amarelo prazo
   perto, vermelho urgente ou atrasado, roxo com o cliente, cinza não iniciado.
   O prazo que vale é o mais próximo entre o prazo interno e a publicação.
   Os limites (3 e 1 dia) ficam aqui para virarem configuração depois. */

export const ALERT_DEFAULTS = Object.freeze({ soon: 3, urgent: 1 });

export const TONES = Object.freeze({
  urgente: { label: "Urgente ou atrasado", hint: "até 1 dia e não aprovado, ou com prazo vencido" },
  atencao: { label: "Prazo próximo", hint: "até 3 dias e não concluído" },
  cliente: { label: "Com o cliente", hint: "aguardando aprovação" },
  producao: { label: "Em produção", hint: "a equipe está fazendo" },
  nao_iniciado: { label: "Não iniciado", hint: "nada começou ainda" },
  concluido: { label: "Concluído", hint: "agendado ou publicado" }
});

const DONE = ["agendado", "publicado"];
const READY = ["pronto_para_agendar", ...DONE];
const WITH_CLIENT = ["aguardando_aprovacao", "reenviado"];

/** Limites editados pelo administrador: vermelho sempre menor que amarelo */
export function validateAlertSettings(input = {}) {
  const errors = {};
  const soon = Number(input.soon);
  const urgent = Number(input.urgent);
  if (!Number.isInteger(soon) || soon < 1 || soon > 30) errors.soon = "Use de 1 a 30 dias.";
  if (!Number.isInteger(urgent) || urgent < 0 || urgent > 29) errors.urgent = "Use de 0 a 29 dias.";
  if (!errors.soon && !errors.urgent && urgent >= soon) errors.urgent = "Precisa ser menor que o prazo do amarelo.";
  return { value: { soon, urgent }, errors };
}

/** Dias entre hoje e a data (negativo = já passou); null sem data */
export function daysFrom(today, iso) {
  if (!iso) return null;
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = String(iso).slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Prazo que vale para o alerta: o mais próximo entre o interno e a publicação */
export function nearestDeadline(c) {
  return [c.due_date, c.scheduled_date].filter(Boolean).sort()[0] || null;
}

export function alertTone(c, today, limits = ALERT_DEFAULTS) {
  if (DONE.includes(c.production_status)) return "concluido";
  const approved = c.final_status === "aprovado" || READY.includes(c.production_status);
  const n = daysFrom(today, nearestDeadline(c));
  if (n !== null && (n < 0 || (n <= limits.urgent && !approved))) return "urgente";
  if (WITH_CLIENT.includes(c.approval_status) || WITH_CLIENT.includes(c.final_status)) return "cliente";
  if (n !== null && n <= limits.soon) return "atencao";
  if (c.production_status === "em_producao" || c.production_status === "pronto_para_agendar") return "producao";
  return "nao_iniciado";
}
