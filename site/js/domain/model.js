/* ==========================================================================
   Modelo de dados do portal
   --------------------------------------------------------------------------
   As mesmas entidades vão servir ao painel do cliente (agora) e ao painel
   administrativo (depois). Cada registro pertence a um cliente (clientId),
   para que cada conta veja só os próprios planejamentos quando houver login.

   @typedef {Object} Client          Empresa atendida pela Digital Galaxy
   @property {string} id
   @property {string} name           Nome exibido no portal
   @property {string} initials       Usado no avatar enquanto não há logo
   @property {string} segment
   @property {string} [logoUrl]

   @typedef {Object} Plan            Planejamento de um mês de um cliente
   @property {string} id
   @property {string} clientId
   @property {string} month          "AAAA-MM"
   @property {{title: string, summary: string, pillars: string[]}} focus
   @property {"rascunho"|"compartilhado"} visibility   O admin compartilha quando estiver pronto

   @typedef {Object} Activity        Conteúdo ou atividade no calendário
   @property {string} id
   @property {string} clientId
   @property {string} planId
   @property {string} date           "AAAA-MM-DD"
   @property {string} [time]         "HH:MM"
   @property {keyof ACTIVITY_TYPES} type
   @property {string[]} platforms    chaves de PLATFORMS
   @property {string} title
   @property {string} objective
   @property {string} description
   @property {string} [caption]
   @property {Media[]} media
   @property {boolean} requiresApproval
   @property {number} version        Sobe a cada edição do admin: aprovações valem só para a versão aprovada
   @property {string} updatedAt      ISO

   @typedef {Object} Media
   @property {"image"|"video"|"mock"} kind   "mock" = prévia ilustrativa da demonstração
   @property {string} [src]
   @property {string} [alt]
   @property {"1:1"|"4:5"|"9:16"} [ratio]
   @property {number} [slides]
   @property {string} [headline]
   @property {string} [palette]

   @typedef {Object} Approval        Decisão do cliente sobre UMA versão do conteúdo
   @property {string} id
   @property {string} activityId
   @property {number} version
   @property {"aprovado"|"ajustes"} decision
   @property {string} [message]      Obrigatória quando pede ajustes
   @property {Author} author
   @property {string} createdAt

   @typedef {Object} Comment         Observação vinculada a uma atividade
   @property {string} id
   @property {string} activityId
   @property {Author} author
   @property {string} text
   @property {string} createdAt

   @typedef {Object} Idea            Sugestão enviada pelo cliente
   @property {string} id
   @property {string} clientId
   @property {string} title
   @property {string} description
   @property {string} [suggestedDate] "AAAA-MM-DD"
   @property {"recebida"|"em-analise"|"no-planejamento"} status
   @property {string} createdAt
   @property {string} [updatedAt]    Quando o cliente editou a ideia

   @typedef {Object} Author
   @property {"cliente"|"agencia"} role
   @property {string} name
   ========================================================================== */

/** Tipos de atividade: rótulo para leigos, cor (em CSS: .type--<chave>) e ícone */
export const ACTIVITY_TYPES = {
  post:      { label: "Post",              short: "Post",      icon: "image" },
  carrossel: { label: "Carrossel",         short: "Carrossel", icon: "layers" },
  reels:     { label: "Reels",             short: "Reels",     icon: "play" },
  stories:   { label: "Stories",           short: "Stories",   icon: "circle" },
  campanha:  { label: "Campanha",          short: "Campanha",  icon: "megaphone" },
  acao:      { label: "Ação estratégica",  short: "Ação",      icon: "target" },
  gravacao:  { label: "Gravação",          short: "Gravação",  icon: "camera" },
  reuniao:   { label: "Reunião",           short: "Reunião",   icon: "users" },
  outro:     { label: "Outra entrega",     short: "Entrega",   icon: "box" }
};

export const PLATFORMS = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google: "Perfil do Google",
  whatsapp: "WhatsApp",
  loja: "Na loja"
};

/** Status vistos pelo cliente. "aguardando" é o padrão de quem precisa de aprovação e ainda não tem decisão. */
export const STATUS = {
  aguardando: { label: "Aguardando aprovação", short: "Aguardando" },
  aprovado:   { label: "Aprovado",             short: "Aprovado" },
  ajustes:    { label: "Ajustes solicitados",  short: "Ajustes" }
};

export const IDEA_STATUS = {
  "recebida": "Recebida pela equipe",
  "em-analise": "Em análise",
  "no-planejamento": "Entrou no planejamento"
};
