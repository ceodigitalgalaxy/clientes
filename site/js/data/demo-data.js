/* ==========================================================================
   DADOS DE DEMONSTRAÇÃO
   --------------------------------------------------------------------------
   Empresa e conteúdos FICTÍCIOS, só para avaliar a experiência. Nenhum dado
   real de cliente. As datas são montadas a partir do mês atual, para que a
   demonstração esteja sempre "viva": mês passado concluído, mês atual em
   andamento e próximo mês começando. O mês seguinte fica sem planejamento
   (para mostrar o estado vazio).
   ========================================================================== */

import { addMonths, daysInMonth, monthKey } from "../lib/dates.js";

const CLIENT_ID = "demo-trigo-e-mel";
const AGENCY = { role: "agencia", name: "Equipe Digital Galaxy" };
const CUSTOMER = { role: "cliente", name: "Marina · Trigo & Mel" };

export function buildDemoData(now = new Date()) {
  const current = monthKey(now);
  const previous = addMonths(current, -1);
  const next = addMonths(current, 1);
  // Dia dentro do mês, sem passar do último dia (meses de 28/30 dias)
  const D = (key, day) => `${key}-${String(Math.min(day, daysInMonth(key))).padStart(2, "0")}`;
  const stamp = (key, day, hour = 10) => `${D(key, day)}T${String(hour).padStart(2, "0")}:12:00`;

  const client = {
    id: CLIENT_ID,
    name: "Trigo & Mel",
    initials: "TM",
    segment: "Padaria artesanal e café"
  };

  const plans = [
    {
      id: `plan-${previous}`, clientId: CLIENT_ID, month: previous, visibility: "compartilhado",
      focus: {
        title: "Apresentar a Trigo & Mel para o bairro",
        summary: "Mês de reforçar quem somos: a história da padaria, a equipe e os produtos que mais saem no balcão.",
        pillars: ["História da padaria", "Produtos campeões", "Equipe em destaque"]
      }
    },
    {
      id: `plan-${current}`, clientId: CLIENT_ID, month: current, visibility: "compartilhado",
      focus: {
        title: "Lançamento da linha de fermentação natural",
        summary: "Vamos apresentar a nova linha de pães, mostrar o cuidado da produção nos bastidores e levar mais gente para o café da manhã de sábado.",
        pillars: ["Nova linha de pães", "Bastidores da produção", "Movimento aos sábados"]
      }
    },
    {
      id: `plan-${next}`, clientId: CLIENT_ID, month: next, visibility: "compartilhado",
      focus: {
        title: "Clientes que voltam toda semana",
        summary: "Planejamento em construção: a ideia é criar o hábito da visita semanal com o cartão fidelidade e conteúdos de receitas.",
        pillars: ["Cartão fidelidade", "Receitas da casa"]
      }
    }
  ];

  let seq = 0;
  const A = (key, day, data) => ({
    id: `act-${++seq}`,
    clientId: CLIENT_ID,
    planId: `plan-${key}`,
    date: D(key, day),
    platforms: ["instagram"],
    media: [],
    caption: "",
    requiresApproval: true,
    version: 1,
    updatedAt: stamp(key, 1),
    ...data
  });
  const mock = (ratio, headline, palette, slides) => ({ kind: "mock", ratio, headline, palette, slides });

  const activities = [
    // ---------- Mês passado (concluído) ----------
    A(previous, 3, { type: "carrossel", time: "10:00", title: "Nossa história em 6 fotos", objective: "Fazer o bairro conhecer a padaria por trás do balcão.", description: "Fotos antigas e atuais da padaria, contando como a Trigo & Mel começou numa cozinha de casa.", caption: "Tudo começou com uma receita de família e um forno pequeno. Hoje são mais de 40 tipos de pão saindo todo dia. Arrasta pro lado e conhece a nossa história.", media: [mock("4:5", "Nossa história em 6 fotos", "wheat", 6)] }),
    A(previous, 7, { type: "reels", time: "18:00", title: "Os 3 pães que mais saem no balcão", objective: "Mostrar os produtos campeões e despertar vontade.", description: "Vídeo rápido com os três pães mais vendidos saindo do forno, com nome e preço na tela.", caption: "Se você ainda não provou esses três, tá perdendo. Qual é o seu preferido?", media: [mock("9:16", "Os 3 campeões do balcão", "crust")] }),
    A(previous, 12, { type: "post", time: "12:00", title: "Conheça o Seu Antônio, nosso padeiro", objective: "Aproximar a marca das pessoas que fazem o pão.", description: "Retrato do padeiro com uma frase dele sobre o ofício.", caption: "Há 15 anos acordando às 4h para o seu pão chegar quentinho. Obrigado, Seu Antônio!", media: [mock("1:1", "Seu Antônio, nosso padeiro", "cocoa")] }),
    A(previous, 18, { type: "stories", time: "09:00", title: "Enquete: doce ou salgado no café da manhã?", objective: "Gerar conversa e entender a preferência do público.", description: "Sequência de 3 stories com enquete e caixinha de perguntas.", media: [mock("9:16", "Doce ou salgado?", "honey")] }),
    A(previous, 22, { type: "gravacao", time: "07:00", title: "Gravação dos bastidores da fornada", requiresApproval: false, platforms: ["loja"], objective: "Captar imagens para os vídeos do próximo mês.", description: "A equipe da Digital Galaxy grava a primeira fornada do dia. Duração prevista: 2 horas." }),
    A(previous, 26, { type: "carrossel", time: "10:00", title: "Guia rápido: como escolher seu pão", objective: "Ajudar o cliente a decidir e mostrar variedade.", description: "Carrossel com 5 tipos de pão e para que ocasião cada um combina.", caption: "Pão para o café, para o almoço ou para receber visita? Salva esse guia.", media: [mock("4:5", "Como escolher seu pão", "wheat", 5)] }),

    // ---------- Mês atual (em andamento) ----------
    A(current, 2, { type: "carrossel", time: "10:00", title: "5 motivos para provar o pão de fermentação natural", objective: "Apresentar a nova linha e explicar por que ela é diferente.", description: "Carrossel educativo e leve: sabor, digestão, casca crocante, durabilidade e ingredientes simples.", caption: "Fermentação natural não é moda, é tempo e cuidado. Separamos 5 motivos para você provar a nossa nova linha. Qual deles te convenceu?", media: [mock("4:5", "5 motivos para provar", "wheat", 6)] }),
    A(current, 3, { type: "stories", time: "09:00", title: "Enquete: qual pão sai primeiro?", objective: "Criar expectativa para o lançamento.", description: "Enquete com duas opções da nova linha e contagem regressiva para sábado.", media: [mock("9:16", "Qual sai primeiro?", "honey")] }),
    A(current, 5, { type: "reels", time: "18:00", title: "Bastidores: a fornada das 5h da manhã", objective: "Mostrar o cuidado da produção e gerar admiração.", description: "Vídeo de 30 segundos com a massa descansando, o forno abrindo e o primeiro pão sendo cortado. Trilha calma.", caption: "Enquanto a cidade dorme, a gente já tá aqui. Esse é o caminho do seu pão até a mesa.", media: [mock("9:16", "A fornada das 5h", "crust")] }),
    A(current, 6, { type: "gravacao", time: "07:00", title: "Gravação na padaria: forno e equipe", requiresApproval: false, platforms: ["loja"], objective: "Captar vídeos para os Reels de bastidores.", description: "A equipe chega às 7h. Peça para a equipe vir com o avental da marca, se possível." }),
    A(current, 8, { type: "post", time: "12:00", title: "Café da manhã de sábado: a mesa completa", objective: "Levar mais gente para o café de sábado.", description: "Foto da mesa de café com os itens do combo e o horário de funcionamento.", caption: "Sábado é dia de mesa cheia. Café, pão de fermentação natural, manteiga da casa e geleia. Te esperamos a partir das 7h.", media: [mock("1:1", "A mesa de sábado", "cocoa")] }),
    A(current, 9, { type: "campanha", title: "Campanha: Semana do Pão Artesanal", platforms: ["instagram", "facebook"], objective: "Aumentar as visitas na semana do lançamento.", description: "Anúncios no Instagram e no Facebook para quem mora até 3 km da padaria, durante 7 dias, com o convite para provar a nova linha.", caption: "Nova linha de fermentação natural na Trigo & Mel. Vem provar essa semana!" }),
    A(current, 10, { type: "reuniao", time: "15:00", title: "Reunião de alinhamento do mês", requiresApproval: false, platforms: ["loja"], objective: "Revisar o que já foi ao ar e ajustar a segunda quinzena.", description: "Conversa de 30 minutos, por vídeo ou na padaria. Traga as perguntas que os clientes mais fizeram no balcão." }),
    A(current, 12, { type: "carrossel", time: "10:00", title: "Do trigo ao pão: as 4 etapas da fermentação", objective: "Explicar o processo de um jeito simples e valorizar o produto.", description: "Quatro etapas ilustradas com fotos da produção: o fermento, a mistura, o descanso e o forno.", caption: "Leva até 36 horas para um pão de fermentação natural ficar pronto. Arrasta e vê cada etapa.", version: 2, updatedAt: stamp(current, 11, 16), media: [mock("4:5", "As 4 etapas", "wheat", 5)] }),
    A(current, 12, { type: "stories", time: "19:00", title: "Caixinha: tire suas dúvidas sobre fermentação", objective: "Responder dúvidas e criar proximidade.", description: "Caixinha de perguntas aberta à noite. As respostas saem no dia seguinte com o padeiro.", media: [] }),
    A(current, 14, { type: "reels", time: "18:00", title: "Teste do aroma: clientes provando às cegas", objective: "Mostrar a reação real de quem prova.", description: "Clientes com os olhos vendados provam dois pães e tentam adivinhar qual é o de fermentação natural.", caption: "Fizemos o teste: dá para sentir a diferença de olhos fechados? Assiste até o final.", media: [mock("9:16", "Prova às cegas", "honey")] }),
    A(current, 15, { type: "carrossel", time: "10:00", title: "5 dicas para conservar o pão em casa", objective: "Ser útil e ser lembrado como a padaria que ensina.", description: "Dicas práticas: pano de algodão, nada de geladeira, como congelar, como reaquecer e quanto tempo dura.", caption: "Pão bom merece ser bem guardado. Salva esse post para não esquecer!", media: [mock("4:5", "Como conservar seu pão", "wheat", 6)] }),
    A(current, 15, { type: "reels", time: "14:00", title: "Bastidores da empresa: um dia com a equipe", objective: "Humanizar a marca mostrando quem faz.", description: "Vídeo leve com a rotina da equipe, do balcão à cozinha, com música animada.", caption: "Por trás de cada pão tem gente que ama o que faz. Vem conhecer a nossa equipe!", media: [mock("9:16", "Um dia com a equipe", "crust")] }),
    A(current, 15, { type: "campanha", title: "Divulgação promocional: combo café + pão", platforms: ["instagram", "whatsapp"], objective: "Vender mais no período da manhã durante a semana.", description: "Combo de café coado e pão na chapa por preço especial até as 10h, divulgado no Instagram e na lista de transmissão do WhatsApp.", caption: "Seu dia começa melhor aqui: café coado + pão na chapa com preço especial até as 10h." }),
    A(current, 17, { type: "post", time: "12:00", title: "Cliente da semana: quem vem desde o primeiro dia", objective: "Valorizar quem é fiel e inspirar novos clientes.", description: "Foto e depoimento curto de um cliente antigo, com autorização dele.", caption: "Tem cliente que já é da família. Obrigado por estar com a gente desde o primeiro pão!", media: [] }),
    A(current, 19, { type: "acao", title: "Degustação gratuita no balcão", platforms: ["loja", "instagram"], objective: "Fazer mais pessoas provarem a nova linha sem compromisso.", description: "Das 7h às 10h, uma bandeja com a nova linha no balcão. Avisamos nos stories na noite anterior e no próprio dia.", caption: "" }),
    A(current, 21, { type: "reels", time: "18:00", title: "Receita: torrada com ricota e mel", objective: "Mostrar como aproveitar o pão em casa.", description: "Receita de 3 passos com o pão da nova linha, gravada em cima, só com as mãos aparecendo.", caption: "Lanche da tarde resolvido em 3 minutos. Salva e faz hoje!", media: [mock("9:16", "Torrada com ricota e mel", "honey")] }),
    A(current, 22, { type: "stories", time: "20:00", title: "Contagem regressiva: fornada especial de sábado", objective: "Criar expectativa e lembrar do horário.", description: "Sticker de contagem regressiva para a fornada especial de sábado às 7h.", media: [mock("9:16", "Sábado, 7h", "cocoa")] }),
    A(current, 24, { type: "post", time: "12:00", title: "Novo horário de sábado: abrimos às 7h", objective: "Informar o novo horário e reforçar o café de sábado.", description: "Arte simples com o novo horário e um convite.", caption: "Novidade! Aos sábados agora a gente abre às 7h. Mais tempo para o seu café da manhã com calma.", media: [mock("1:1", "Sábado, a partir das 7h", "wheat")] }),
    A(current, 26, { type: "carrossel", time: "10:00", title: "Guia: qual pão combina com cada refeição", objective: "Aumentar o ticket mostrando variedade.", description: "Café da manhã, almoço, lanche e jantar, cada um com uma sugestão da casa.", caption: "Do café ao jantar, tem um pão certo para cada momento. Qual é o seu?", media: [] }),
    A(current, 28, { type: "reels", time: "18:00", title: "Um dia na Trigo & Mel", objective: "Fechar o mês resumindo o lançamento.", description: "Resumo do mês em 40 segundos: fornada, clientes, degustação e equipe.", caption: "Foi assim o mês do lançamento. Obrigado por cada visita!", media: [mock("9:16", "Um dia na Trigo & Mel", "crust")] }),
    A(current, 28, { type: "stories", time: "19:00", title: "Bastidores da fornada de domingo", objective: "Manter a presença no fim de semana.", description: "Três stories curtos da fornada de domingo.", media: [] }),

    // ---------- Próximo mês (começando) ----------
    A(next, 4, { type: "post", time: "12:00", title: "Cartão fidelidade: o 10º café é por nossa conta", objective: "Apresentar o cartão fidelidade.", description: "Arte com o cartão e as regras em linguagem simples.", caption: "Juntou 9 carimbos? O 10º café é presente nosso. Pede o seu cartão no balcão!", media: [mock("1:1", "O 10º café é nosso", "cocoa")] }),
    A(next, 9, { type: "reels", time: "18:00", title: "Receita da casa: rabanada de forno", objective: "Conteúdo útil para salvar e compartilhar.", description: "Receita rápida com o pão amanhecido.", media: [] }),
    A(next, 16, { type: "carrossel", time: "10:00", title: "3 cafés da manhã para a semana toda", objective: "Criar o hábito da visita semanal.", description: "Três combinações diferentes de café da manhã com produtos da casa.", media: [] })
  ];

  // Decisões do cliente já tomadas (por versão do conteúdo)
  const byTitle = (title) => activities.find((a) => a.title === title);
  let aprSeq = 0;
  const approve = (title, key, day, hour) => ({ id: `apr-${++aprSeq}`, activityId: byTitle(title).id, version: byTitle(title).version, decision: "aprovado", author: CUSTOMER, createdAt: stamp(key, day, hour) });
  const approvals = [
    ...activities.filter((a) => a.planId === `plan-${previous}` && a.requiresApproval).map((a, i) => ({ id: `apr-prev-${i}`, activityId: a.id, version: 1, decision: "aprovado", author: CUSTOMER, createdAt: `${a.date.slice(0, 8)}01T09:30:00` })),
    approve("5 motivos para provar o pão de fermentação natural", previous, 27, 9),
    approve("Enquete: qual pão sai primeiro?", previous, 27, 9),
    approve("Bastidores: a fornada das 5h da manhã", current, 1, 14),
    approve("Café da manhã de sábado: a mesa completa", current, 1, 14),
    // Pedido de ajuste na versão 1; a equipe já mandou a versão 2, que aguarda nova aprovação
    { id: "apr-etapas-v1", activityId: byTitle("Do trigo ao pão: as 4 etapas da fermentação").id, version: 1, decision: "ajustes", message: "Trocar a foto da etapa 3: o pão está meio queimado. Temos fotos melhores do descanso da massa.", author: CUSTOMER, createdAt: stamp(current, 9, 11) },
    { id: "apr-horario", activityId: byTitle("Novo horário de sábado: abrimos às 7h").id, version: 1, decision: "ajustes", message: "Ainda estamos confirmando se vamos abrir às 7h ou 7h30. Podemos esperar até quinta?", author: CUSTOMER, createdAt: stamp(current, 13, 17) },
    approve("Teste do aroma: clientes provando às cegas", current, 10, 9)
  ];

  const comments = [
    { id: "com-1", activityId: byTitle("Do trigo ao pão: as 4 etapas da fermentação").id, author: AGENCY, text: "Trocamos a foto da etapa 3 pela do descanso da massa, como você pediu. Essa é a versão 2.", createdAt: stamp(current, 11, 16) },
    { id: "com-2", activityId: byTitle("Gravação na padaria: forno e equipe").id, author: CUSTOMER, text: "Combinado! A primeira fornada sai às 7h15, dá tempo de montar o equipamento.", createdAt: stamp(current, 4, 18) },
    { id: "com-3", activityId: byTitle("Degustação gratuita no balcão").id, author: AGENCY, text: "Sugestão: deixar plaquinhas com o nome de cada pão na bandeja. Ajuda nas fotos e na venda.", createdAt: stamp(current, 14, 10) }
  ];

  const ideas = [
    { id: "idea-1", clientId: CLIENT_ID, title: "Aula de pão para crianças", description: "Uma manhã de sábado em que as crianças fazem o próprio pãozinho. Os pais adoram e rende fotos ótimas.", suggestedDate: D(next, 12), status: "em-analise", createdAt: stamp(current, 7, 20) },
    { id: "idea-2", clientId: CLIENT_ID, title: "Mostrar o fornecedor de mel", description: "O mel que usamos vem de um apicultor da região. Acho que vale um vídeo contando essa parceria.", status: "no-planejamento", createdAt: stamp(previous, 20, 15) }
  ];

  return { client, plans, activities, approvals, comments, ideas, author: CUSTOMER };
}
