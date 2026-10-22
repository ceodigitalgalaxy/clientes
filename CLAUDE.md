# Portal de clientes Digital Galaxy

Site estático, sem build (HTML, CSS e módulos ES nativos), no mesmo padrão do site principal e do portfólio. Tudo o que vai para o ar fica em `site/`. Ver `README.md` para estrutura, modelo de dados e próximas etapas.

## Regras do projeto
- **Duas partes, publicadas juntas:** o portal do cliente (`site/`, login do cliente com dados reais) e o painel da agência (`site/admin/`, em `/admin/`, login da equipe). A pasta `admin/` tem só ferramentas locais (equipe.mjs, verify.mjs, prévia, testes) e não é publicada.
- **Etapa atual: foto do cliente, arte final, aprovação pelo cliente e importação por planilha.** Usuário é um nome, mapeado para `equipe+<usuario>@…` ou `cliente+<usuario>@digitalgalaxy.com.br` (`site/js/domain/accounts.js`); usuários da equipe só são criados por `admin/equipe.mjs`; logins de cliente pelo painel (função `supabase/functions/acesso-cliente`) ou pelo `equipe.mjs`.
- **Função acesso-cliente:** confere a sessão e `agency_members` a cada pedido e só mexe em logins de cliente (via `client_members`). Nunca ampliar para contas da equipe nem aceitar a chave secreta vinda do navegador. `accounts.js` dela é cópia de `site/js/domain/accounts.js` (manter idênticos). Comentários e ideias do cliente ainda não gravam no banco e ficam escondidos (próxima etapa, só com pedido). A demonstração foi removida a pedido: não recriar dados fictícios.
- **O cliente só lê por `portal_client()` e `portal_calendar()` e só decide por `portal_decide()`**, que descobrem o cliente pela sessão e conferem status e versão. Nunca dar ao cliente política direta em `contents`/`clients`/`content_assets`/`content_approvals` (exporia `internal_notes` e dados de outros clientes) nem criar função que receba id de cliente. `portal_profile`/`portal_contents` são antigas (só para a versão anterior publicada) e devem ser revogadas depois da publicação.
- **Arquivos:** `client-logos` (público) e `content-media` (privado, links temporários). Caminho da arte: `<client_id>/<content_id>/<arquivo>`; o cliente só lê pelo `private.client_can_read_media`. Só a equipe envia/apaga.
- **Mídia:** toda prévia e toda capa (miniaturas: `mediaCover`/`coverHtml`) passam por `site/js/ui/media.js`. Plataforma nova só com player oficial e entrada no `frame-src` da CSP das duas páginas; o resto vira aviso + link.
- **Quem protege os dados é o banco (RLS)**, não esconder a tela. Toda tabela nova precisa de RLS e política só para membros da equipe; nada liberado para `anon`. URL difícil de adivinhar não é proteção.
- **Chaves:** o navegador só recebe a chave publicável (`site/admin/js/config.js`). A chave secreta fica só em `admin/.env` (no `.gitignore`), nunca em `site/`. O cadastro aberto do Supabase fica desligado.
- **Senhas:** nunca guardar, registrar ou escrever senhas em código, arquivos ou commits; elas vão direto para o Supabase.
- **Sem dados fictícios** no banco nem no portal. Dados de clientes só aparecem depois do login, pelas funções do portal.
- **Toda leitura e escrita do portal passa pelo repositório** (`js/data/supabase-repository.js`). A tela não acessa o banco diretamente.
- Mudanças no banco: nova migração em `supabase/migrations/`. Validações compartilhadas em `site/admin/js/domain/rules.js` (navegador e comandos locais).
- Antes de concluir mudanças, rodar `node admin/test/store.test.mjs`, `node admin/test/portal.test.mjs` e os testes de ponta a ponta `admin/test/e2e.mjs`, `admin/test/portal-e2e.mjs` e `admin/test/review-e2e.mjs` (ou `npm test` em `admin/`).
- **Status**: vem de `contents.status`; o cliente só muda de aguardando aprovação para aprovado ou ajustes (via `portal_decide`). Uma aprovação vale só para a versão aprovada; qualquer mudança visível ao cliente (inclusive arte final) sobe `version`.
- O calendário é o elemento principal. Poucas funcionalidades, bem feitas; nada de chat, notificações ou gestão de projetos nesta etapa.

## Visual
- Tema claro e arejado com a identidade da marca: roxo #5A1AC7 / #3B008E, lilás #B794FF, Sora no texto e Orbitron ("Galaxy") nos títulos grandes, símbolo da Digital Galaxy no topo.
- Cores por tipo de atividade nas classes `.type--<tipo>` (variáveis `--t`, `--t-soft`, `--t-ink`); status: aguardando (âmbar), aprovado (verde), ajustes (coral).
- Espaçamentos em múltiplos de 8px; textos de apoio em 12px. Caixa alta só em títulos (aqui, nenhum).
- Topo só com o símbolo da Digital Galaxy. Abertura centralizada: "Olá, <empresa>!" e o título "Seu cronograma mensal com a Digital Galaxy", sem subtítulo (no celular, alinhada à esquerda e menor). Logo abaixo, **Destaques** (`js/ui/highlights.js`): carrossel que passa sozinho a cada 6 s, com o que o cliente precisa aprovar primeiro, depois ajustes, aprovados e publicados (janela de 31 dias antes/depois de hoje), e "A seguir" no computador. Os números do mês ficam pequenos, embaixo. O carrossel para com mouse/foco/toque, aba escondida, painel aberto ou "menos movimento".
- Calendário ocupa a largura da página (até 1600px): dias como cartões separados por 8px, etiquetas em duas linhas (horário em cima, título embaixo). A troca de mês desliza o mês atual para um lado e traz o novo pelo outro.
- Desktop: popover no hover do dia + painel lateral; clicar na data abre os detalhes do dia (ou "Nada programado"). Cada dia com conteúdo fica todo na cor do status (`day--<status>`; com vários, vale aguardando > ajustes > aprovado > publicado). O resumo flutuante só abre com mouse de verdade (nunca no toque). Celular: pontinhos no dia, agenda do dia abaixo do calendário (com miniatura e "Próximo: dia X" quando o dia está vazio) e painel como folha que sobe de baixo, com Aprovar / Pedir alteração presos embaixo enquanto aguarda aprovação. Visão Mês ou Semana. Nunca depender só do hover.
- CSP em `<meta>`: sem `style="..."` no HTML, sem scripts ou fontes de terceiros. Estilo via JS (`element.style`) é permitido.
- Textos em português, próximos e sem jargão (o cliente não precisa saber termos de marketing).

## Publicação
- `.github/workflows/pages.yml` publica `site/` no GitHub Pages. Não fazer commit, push ou deploy sem autorização.
- Ao mudar CSS ou JS, aumentar o `?v=` no `<head>` do `site/index.html` (portal) ou do `site/admin/index.html` (painel).
