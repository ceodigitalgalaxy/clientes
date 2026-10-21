/* Regras de status: calculadas a partir das aprovações, nunca guardadas no conteúdo.
   Assim uma edição do admin (versão nova) volta a "aguardando" sozinha. */

/**
 * Última decisão do cliente para a versão ATUAL do conteúdo.
 * @param {import("./model.js").Activity} activity
 * @param {import("./model.js").Approval[]} approvals  todas as aprovações da atividade
 */
export function latestDecision(activity, approvals) {
  return approvals
    .filter((a) => a.activityId === activity.id && a.version === activity.version)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1) || null;
}

/** "aguardando" | "aprovado" | "ajustes" | null (atividades que não pedem aprovação) */
export function statusOf(activity, approvals) {
  if (!activity.requiresApproval) return null;
  const decision = latestDecision(activity, approvals);
  return decision ? decision.decision : "aguardando";
}

/** Indicadores do mês */
export function summarize(activities, approvals) {
  const total = activities.filter((a) => ["post", "carrossel", "reels", "stories"].includes(a.type)).length;
  const counts = { planejados: total, aguardando: 0, aprovado: 0, ajustes: 0 };
  activities.forEach((activity) => {
    const status = statusOf(activity, approvals);
    if (status) counts[status] += 1;
  });
  return counts;
}
