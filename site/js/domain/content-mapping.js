/* ==========================================================================
   Do banco para o calendário do cliente
   --------------------------------------------------------------------------
   O painel da agência grava os conteúdos na tabela "contents" (Supabase).
   O calendário do cliente lê a view "client_calendar_items", que já traz só
   o que o cliente pode ver (sem observações internas e só a partir de
   "Aguardando aprovação"). Esta função converte cada linha da view no
   formato Activity que o calendário usa hoje (domain/model.js).

   Usada pelo repositório real do portal, que entra na etapa de login
   (README → Próximas etapas). Enquanto isso, o portal segue na demonstração.
   ========================================================================== */

/**
 * @param {object} row  linha de client_calendar_items
 * @returns {import("./model.js").Activity}
 */
export function activityFromContent(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    planId: `${row.client_id}:${row.scheduled_date.slice(0, 7)}`,
    date: row.scheduled_date,
    time: row.scheduled_time ? row.scheduled_time.slice(0, 5) : undefined,
    type: row.format,
    platforms: [row.network],
    title: row.title,
    objective: "",
    description: "",
    caption: row.caption || "",
    media: row.media_url ? [{ kind: row.media_kind === "video" ? "video" : "image", src: row.media_url, alt: row.title }] : [],
    // Tudo o que chega ao cliente pela view passa pela aprovação dele
    requiresApproval: true,
    version: row.version,
    updatedAt: row.updated_at
  };
}
