/* ==========================================================================
   Do banco para o calendário do cliente
   --------------------------------------------------------------------------
   O painel da agência grava os conteúdos na tabela "contents" (Supabase).
   O calendário do cliente lê a view "client_calendar_items", que já traz só
   o que o cliente pode ver (sem observações internas e só a partir de
   "Aguardando aprovação"). Esta função converte cada linha da view no
   formato Activity que o calendário usa hoje (domain/model.js).

   Usada pelo repositório real do portal (data/supabase-repository.js), que
   lê a função portal_contents() (mesmas colunas da view, sem client_id).
   ========================================================================== */

/** Status do banco → status mostrado ao cliente (domain/model.js → STATUS) */
const STATUS_FROM_DB = { aguardando_aprovacao: "aguardando", aprovado: "aprovado", publicado: "publicado" };

/**
 * @param {object} row  linha de portal_contents() ou de client_calendar_items
 * @returns {import("./model.js").Activity}
 */
export function activityFromContent(row) {
  const month = row.scheduled_date.slice(0, 7);
  return {
    id: row.id,
    clientId: row.client_id ?? null,
    planId: `${row.client_id ?? "cliente"}:${month}`,
    date: row.scheduled_date,
    time: row.scheduled_time ? row.scheduled_time.slice(0, 5) : undefined,
    type: row.format,
    platforms: [row.network],
    title: row.title,
    objective: "",
    description: "",
    caption: row.caption || "",
    media: row.media_url ? [{ kind: row.media_kind === "video" ? "video" : "image", src: row.media_url, alt: row.title }] : [],
    // Observação que a agência liberou para o cliente (as internas nunca chegam aqui)
    notes: row.client_notes || "",
    // Status definido pela agência no painel
    status: STATUS_FROM_DB[row.status] || "aguardando",
    requiresApproval: true,
    version: row.version,
    updatedAt: row.updated_at
  };
}
