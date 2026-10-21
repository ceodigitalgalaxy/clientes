# Portal de clientes Digital Galaxy

Site estático, sem build (HTML, CSS e módulos ES nativos), no mesmo padrão do site principal e do portfólio. Tudo o que vai para o ar fica em `site/`. Ver `README.md` para estrutura, modelo de dados e próximas etapas.

## Regras do projeto
- **Duas partes, publicadas juntas:** o portal do cliente (`site/`, login do cliente com dados reais; demonstração em `?demo`) e o painel da agência (`site/admin/`, em `/admin/`, login da equipe). A pasta `admin/` tem só ferramentas locais (equipe.mjs, verify.mjs, prévia, testes) e não é publicada.
- **Etapa atual: calendário do cliente ligado ao painel.** Usuário é um nome, mapeado para `equipe+<usuario>@…` ou `cliente+<usuario>@digitalgalaxy.com.br` (`site/js/domain/accounts.js`); usuários só são criados por `admin/equipe.mjs`. Aprovar, pedir ajuste, observações do cliente e ideias ainda são só da demonstração (próxima etapa, só com pedido).
- **O cliente só lê por `portal_profile()` e `portal_contents()`**, que descobrem o cliente pela sessão. Nunca dar ao cliente política direta em `contents`/`clients` (exporia `internal_notes` e dados de outros clientes) nem criar função que receba id de cliente.
- **Mídia:** toda prévia passa por `site/js/ui/media.js`. Plataforma nova só com player oficial e entrada no `frame-src` da CSP das duas páginas; o resto vira aviso + link.
- **Quem protege os dados é o banco (RLS)**, não esconder a tela. Toda tabela nova precisa de RLS e política só para membros da equipe; nada liberado para `anon`. URL difícil de adivinhar não é proteção.
- **Chaves:** o navegador só recebe a chave publicável (`site/admin/js/config.js`). A chave secreta fica só em `admin/.env` (no `.gitignore`), nunca em `site/`. O cadastro aberto do Supabase fica desligado.
- **Senhas:** nunca guardar, registrar ou escrever senhas em código, arquivos ou commits; elas vão direto para o Supabase.
- **Sem dados fictícios no banco.** O portal do cliente continua só com dados de demonstração (`js/data/demo-data.js`); nunca colocar dados reais de clientes numa página pública sem login.
- **Toda leitura e escrita do portal passa pelo repositório** (`js/data/repository.js`). A tela não acessa `localStorage` nem dados diretamente.
- Mudanças no banco: nova migração em `supabase/migrations/`. Validações compartilhadas em `site/admin/js/domain/rules.js` (navegador e comandos locais).
- Antes de concluir mudanças, rodar `node admin/test/store.test.mjs`, `node admin/test/portal.test.mjs` e os testes de ponta a ponta `admin/test/e2e.mjs` e `admin/test/portal-e2e.mjs`.
- **Status é calculado, não guardado**: última `Approval` da versão atual da `Activity` (`js/domain/status.js`). Edição do conteúdo sobe `version`.
- O calendário é o elemento principal. Poucas funcionalidades, bem feitas; nada de chat, notificações ou gestão de projetos nesta etapa.

## Visual
- Tema claro e arejado com a identidade da marca: roxo #5A1AC7 / #3B008E, lilás #B794FF, Sora no texto e Orbitron ("Galaxy") nos títulos grandes, símbolo da Digital Galaxy no topo.
- Cores por tipo de atividade nas classes `.type--<tipo>` (variáveis `--t`, `--t-soft`, `--t-ink`); status: aguardando (âmbar), aprovado (verde), ajustes (coral).
- Espaçamentos em múltiplos de 8px; textos de apoio em 12px. Caixa alta só em títulos (aqui, nenhum).
- Topo só com o símbolo da Digital Galaxy. Abertura centralizada: "Olá, <empresa>!" e o título "Seu cronograma mensal com a Digital Galaxy", sem subtítulo. Resumo do mês sem tópicos (só foco e indicadores).
- Calendário ocupa a largura da página (até 1600px): dias como cartões separados por 8px, etiquetas em duas linhas (horário em cima, título embaixo). A troca de mês desliza o mês atual para um lado e traz o novo pelo outro.
- Desktop: popover no hover do dia + painel lateral; clicar na data abre os detalhes do dia (ou "Nada programado"). Celular: pontinhos no dia, agenda do dia abaixo do calendário e painel como folha que sobe de baixo. Visão Mês ou Semana. Nunca depender só do hover.
- CSP em `<meta>`: sem `style="..."` no HTML, sem scripts ou fontes de terceiros. Estilo via JS (`element.style`) é permitido.
- Textos em português, próximos e sem jargão (o cliente não precisa saber termos de marketing).

## Publicação
- `.github/workflows/pages.yml` publica `site/` no GitHub Pages. Não fazer commit, push ou deploy sem autorização.
- Ao mudar CSS ou JS, aumentar o `?v=` no `<head>` do `site/index.html` (portal) ou do `site/admin/index.html` (painel).
