/* ==========================================================================
   Central de aprovação: status, modos e textos (os mesmos do banco)
   --------------------------------------------------------------------------
   Usado pelo painel da agência e pela página pública de aprovação.
   Status de APROVAÇÃO e de PRODUÇÃO são separados (migração
   20261110120000_central_de_aprovacao.sql); a coluna antiga "status" do
   conteúdo é calculada a partir dos dois (statusFromPair) para o calendário.
   ========================================================================== */

/** Aprovação do cliente (tone = cor das etiquetas) */
export const APPROVAL_STATUS = {
  rascunho:             { label: "Rascunho",             short: "Rascunho",   tone: "neutral",    icon: "edit",    hint: "Só a agência vê." },
  aguardando_aprovacao: { label: "Aguardando aprovação", short: "Aguardando", tone: "aguardando", icon: "clock",   hint: "Disponível para o cliente decidir." },
  aprovado:             { label: "Aprovado",             short: "Aprovado",   tone: "aprovado",   icon: "check",   hint: "Validado pelo cliente." },
  ajustes:              { label: "Ajustes solicitados",  short: "Ajustes",    tone: "ajustes",    icon: "message", hint: "O cliente pediu alterações." },
  reenviado:            { label: "Revisado e reenviado", short: "Revisado",   tone: "reenviado",  icon: "refresh", hint: "Nova versão aguardando aprovação." }
};

/** Produção (operacional, separada da aprovação) */
export const PRODUCTION_STATUS = {
  em_producao:         { label: "Em produção",         icon: "edit" },
  pronto_para_agendar: { label: "Pronto para agendar", icon: "check" },
  agendado:            { label: "Agendado",            icon: "calendar" },
  publicado:           { label: "Publicado",           icon: "send" }
};

/** Modos do lote: o cliente precisa saber o que está aprovando */
export const APPROVAL_MODES = {
  planejamento: {
    label: "Aprovação de planejamento", short: "Planejamento", icon: "lightbulb",
    what: "o tema, a ideia, o formato, a data e a abordagem",
    note: "Você está aprovando a IDEIA de cada conteúdo (tema, formato, data e abordagem). A arte, o vídeo e a legenda podem ainda não estar prontos: eles vêm numa próxima etapa."
  },
  final: {
    label: "Aprovação de conteúdo final", short: "Conteúdo final", icon: "image",
    what: "a arte, o vídeo, a legenda e a data",
    note: "Você está aprovando o conteúdo FINAL: a arte, o vídeo ou carrossel, a legenda e a data, do jeito que vão ao ar."
  }
};

/** Situação geral do lote (approval_batch_summary.overall_status) */
export const BATCH_STATUS = {
  rascunho:    { label: "Rascunho",                tone: "neutral" },
  aguardando:  { label: "Aguardando o cliente",    tone: "aguardando" },
  parcial:     { label: "Parcialmente aprovado",   tone: "reenviado" },
  com_ajustes: { label: "Com ajustes pendentes",   tone: "ajustes" },
  aprovado:    { label: "Aprovado",                tone: "aprovado" },
  arquivado:   { label: "Arquivado",               tone: "neutral" }
};

/** Histórico: como cada evento aparece */
export const APPROVAL_EVENTS = {
  lote_criado: "Lote criado",
  conteudo_adicionado: "Conteúdo adicionado ao lote",
  conteudo_removido: "Conteúdo retirado do lote",
  enviado: "Enviado para aprovação",
  nova_versao: "Nova versão enviada",
  link_gerado: "Link gerado",
  link_desativado: "Link desativado",
  link_expirado: "Link expirado",
  aprovado: "Aprovado pelo cliente",
  ajustes: "Ajuste solicitado",
  lote_aprovado: "Planejamento totalmente aprovado"
};

export const isPending = (status) => status === "aguardando_aprovacao" || status === "reenviado";

/** Par (aprovação, produção) → status antigo do calendário */
export function statusFromPair(approval, production) {
  if (production === "publicado") return "publicado";
  if (approval === "aguardando_aprovacao" || approval === "reenviado") return "aguardando_aprovacao";
  if (approval === "ajustes") return "ajustes";
  if (approval === "aprovado") return "aprovado";
  if (production) return "em_producao";
  return "planejado";
}

/** Status antigo → par (aprovação, produção), preservando a produção quando cabe */
export function pairFromStatus(status, approval = null, production = null) {
  const a = { planejado: "rascunho", em_producao: "rascunho", aguardando_aprovacao: approval === "reenviado" ? "reenviado" : "aguardando_aprovacao", ajustes: "ajustes", aprovado: "aprovado", publicado: "aprovado" }[status] ?? (approval || "rascunho");
  let p;
  if (status === "publicado") p = "publicado";
  else if (status === "em_producao") p = ["em_producao", "pronto_para_agendar", "agendado"].includes(production) ? production : "em_producao";
  else if (status === "planejado") p = null;
  else p = production === "publicado" ? null : production;
  return { approval_status: a, production_status: p ?? null };
}

/** Endereço público do link (o token vai depois do #: nunca é enviado ao servidor do site) */
export const approvalUrl = (origin, token) => `${String(origin).replace(/\/+$/, "")}/aprovacao/#${token}`;

/** Mensagem pronta para o WhatsApp */
export function whatsappMessage(link, { client = "", month = "" } = {}) {
  return [
    `Olá${client ? `, ${client}` : ""}! Seu planejamento de conteúdos${month ? ` de ${month}` : ""} está pronto para aprovação.`,
    "Organizamos todas as ideias e datas em um único lugar.",
    "Acesse o link abaixo para visualizar e aprovar:",
    link,
    "Caso queira alterar algum conteúdo, basta selecionar \"Solicitar ajuste\" e escrever sua observação.",
    "Você não precisa criar conta nem fazer login."
  ].join("\n");
}
