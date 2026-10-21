# Portal de clientes Digital Galaxy

Site estático, sem build (HTML, CSS e módulos ES nativos), no mesmo padrão do site principal e do portfólio. Tudo o que vai para o ar fica em `site/`. Ver `README.md` para estrutura, modelo de dados e próximas etapas.

## Regras do projeto
- **Duas partes:** o portal do cliente (`site/`, publicado, ainda em demonstração) e o painel da agência (`admin/`, **nunca publicado**, roda só no computador da agência via `node admin/server.mjs`).
- **Etapa atual: estrutura do painel administrativo (clientes e conteúdos) com banco Supabase.** Ainda sem login. Não criar autenticação, senhas nem publicar o painel sem pedido.
- **Segurança do painel:** servidor só em 127.0.0.1, checagem de Host e Origin, chave secreta só em `admin/.env` (no `.gitignore`). Banco com RLS em todas as tabelas e nada liberado para `anon`. URL difícil de adivinhar não é proteção.
- **Sem dados fictícios no banco.** O portal publicado continua só com dados de demonstração (`js/data/demo-data.js`); nunca colocar dados reais de clientes numa página pública.
- Mudanças no banco: nova migração em `supabase/migrations/`. Validações compartilhadas em `admin/public/js/domain/rules.js` (navegador e servidor).
- Antes de concluir mudanças no painel, rodar `node admin/test/store-supabase.test.mjs` e o teste de ponta a ponta `admin/test/e2e.mjs`.
- **Toda leitura e escrita passa pelo repositório** (`js/data/repository.js`). A tela não acessa `localStorage` nem dados diretamente. Deixar claro no código o que é demonstração.
- **Status é calculado, não guardado**: última `Approval` da versão atual da `Activity` (`js/domain/status.js`). Edição do conteúdo sobe `version`.
- O calendário é o elemento principal. Poucas funcionalidades, bem feitas; nada de chat, notificações ou gestão de projetos nesta etapa.

## Visual
- Tema claro e arejado com a identidade da marca: roxo #5A1AC7 / #3B008E, lilás #B794FF, Sora no texto e Orbitron ("Galaxy") nos títulos grandes, símbolo da Digital Galaxy no topo.
- Cores por tipo de atividade nas classes `.type--<tipo>` (variáveis `--t`, `--t-soft`, `--t-ink`); status: aguardando (âmbar), aprovado (verde), ajustes (coral).
- Espaçamentos em múltiplos de 8px; textos de apoio em 12px. Caixa alta só em títulos (aqui, nenhum).
- Topo só com o símbolo da Digital Galaxy. Abertura centralizada: "Olá, <empresa>!" e o título "Seu cronograma mensal com a Digital Galaxy", sem subtítulo. Resumo do mês sem tópicos (só foco e indicadores).
- Calendário ocupa a largura da página (até 1600px): dias como cartões separados por 8px, etiquetas em duas linhas (horário em cima, título embaixo). A troca de mês desliza o mês atual para um lado e traz o novo pelo outro.
- Desktop: popover no hover do dia + painel lateral. Celular: pontinhos no dia, agenda do dia abaixo do calendário e painel como folha que sobe de baixo. Nunca depender só do hover.
- CSP em `<meta>`: sem `style="..."` no HTML, sem scripts ou fontes de terceiros. Estilo via JS (`element.style`) é permitido.
- Textos em português, próximos e sem jargão (o cliente não precisa saber termos de marketing).

## Publicação
- `.github/workflows/pages.yml` publica `site/` no GitHub Pages. Não fazer commit, push ou deploy sem autorização.
- Ao mudar CSS ou JS, aumentar o `?v=` no `<head>` do `site/index.html`.
