/* ==========================================================================
   Anúncios: nomes, status e limites (os mesmos do banco)
   --------------------------------------------------------------------------
   Usado pelo portal do cliente e pelo painel da agência. As chaves são as
   mesmas das regras (check) da tabela public.ads.
   ========================================================================== */

/** Status do anúncio (tone = cor usada nas etiquetas) */
export const AD_STATUS = {
  rascunho:               { label: "Rascunho",               short: "Rascunho",   tone: "neutral",    icon: "edit" },
  aguardando_aprovacao:   { label: "Aguardando aprovação",   short: "Aguardando", tone: "aguardando", icon: "clock" },
  alteracoes_solicitadas: { label: "Alterações solicitadas", short: "Alterações", tone: "ajustes",    icon: "message" },
  aprovado:               { label: "Aprovado",               short: "Aprovado",   tone: "aprovado",   icon: "check" },
  arquivado:              { label: "Arquivado",              short: "Arquivado",  tone: "arquivado",  icon: "box" }
};

/** O que o cliente enxerga (rascunho nunca) */
export const AD_CLIENT_STATUS = ["aguardando_aprovacao", "alteracoes_solicitadas", "aprovado", "arquivado"];

/** O criativo enviado: referência (aprovar a ideia) ou arte final (pronta para veicular) */
export const AD_STAGES = {
  referencia: { label: "Referência", long: "Referência (aprovar a ideia)", hint: "O cliente aprova a ideia e a inspiração. A arte final vem depois, como nova versão." },
  final: { label: "Arte final", long: "Arte final (pronta para veicular)", hint: "O criativo que vai ao ar." }
};

export const AD_PLATFORMS = { meta: "Meta Ads (Facebook e Instagram)", google: "Google Ads", tiktok: "TikTok Ads", outra: "Outra plataforma" };
export const AD_PLATFORMS_SHORT = { meta: "Meta Ads", google: "Google Ads", tiktok: "TikTok Ads", outra: "Outra" };

export const AD_OBJECTIVES = {
  reconhecimento: "Reconhecimento da marca",
  trafego: "Tráfego para o site",
  engajamento: "Engajamento",
  leads: "Cadastros (leads)",
  vendas: "Vendas",
  mensagens: "Mensagens (WhatsApp/Direct)",
  outro: "Outro objetivo"
};

export const AD_FORMATS = {
  imagem:    { label: "Imagem",    icon: "image" },
  video:     { label: "Vídeo",     icon: "play" },
  carrossel: { label: "Carrossel", icon: "layers" }
};

/** Sugestões de botão (o campo aceita qualquer texto curto) */
export const AD_CTAS = ["Saiba mais", "Comprar agora", "Fale conosco", "Enviar mensagem", "Cadastre-se", "Agendar", "Ver oferta", "Baixar", "Ligar agora"];

export const AD_LIMITS = {
  title: 160, campaignContext: 2000, platformOther: 60, primaryText: 3000, headline: 255,
  description: 500, cta: 40, url: 2000, clientNotes: 2000, internalNotes: 4000, message: 1000
};

/** Histórico: como cada passo aparece (role = quem fez) */
export const AD_EVENTS = {
  criado: "Rascunho criado",
  enviado: "Enviado para aprovação",
  recolhido: "Recolhido para edição",
  aprovado: "Aprovado",
  alteracoes_solicitadas: "Alterações solicitadas",
  reaberto: "Reaberto para edição",
  arquivado: "Arquivado",
  reativado: "Reativado"
};

export const platformLabel = (ad, short = true) =>
  ad.platform === "outra" && ad.platform_other ? ad.platform_other : (short ? AD_PLATFORMS_SHORT : AD_PLATFORMS)[ad.platform] || "";
