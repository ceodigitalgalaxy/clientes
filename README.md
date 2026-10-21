# Portal de clientes · Digital Galaxy

Portal onde cada cliente acompanha o planejamento de marketing da sua marca: calendário de conteúdos, aprovações, pedidos de ajuste, observações e ideias. Endereço previsto: **https://clientes.digitalgalaxy.com.br**.

O projeto tem duas partes:

| Parte | Pasta | Onde roda | Situação |
|---|---|---|---|
| **Portal do cliente** | `site/` | GitHub Pages | Demonstração com dados fictícios ("Trigo & Mel"), salvos só no navegador |
| **Painel da agência** | `admin/` | Só no computador da agência | Clientes e conteúdos gravados no banco Supabase. Ainda sem login, por isso **não é publicado** |

## Painel da agência (`admin/`)

### Como rodar

Requer Node 18.17 ou mais novo. Não tem dependências para instalar.

```bash
cp admin/.env.example admin/.env
# edite admin/.env e cole a chave secreta (Supabase → Project Settings → API Keys → Secret key, começa com sb_secret_)
node admin/server.mjs
# abra http://localhost:5600
```

Para conferir criação, consulta, edição e exclusão direto no banco real (cria um cliente de teste e apaga tudo no fim):

```bash
node admin/verify.mjs
```

**Nunca** envie o `admin/.env` para o GitHub nem cole a chave secreta em chats ou páginas: ela dá acesso total ao banco.

### O que faz

- **Clientes:** cadastrar, editar, inativar e excluir (só quem não tem conteúdos; com conteúdos, inative). Cada cliente tem um identificador único (`slug`).
- **Conteúdos:** cliente, título, data e horário, rede social, formato (imagem, carrossel, vídeo, stories ou outro), URL de referência da mídia (imagem ou vídeo), legenda, observações internas e status (planejado, em produção, aguardando aprovação, aprovado, publicado).
- Criar, ver detalhes, editar e excluir (com confirmação).
- Filtros por cliente, período e status, guardados no endereço da página.
- Estados de carregamento, sucesso, erro (com "Tentar novamente") e lista vazia.
- Calendário de cada cliente: `GET /api/clients/:id/calendar?from=&to=`.

### Estrutura

```
admin/
├── server.mjs              Servidor local (127.0.0.1): API /api/* + arquivos da tela
├── lib/store-supabase.mjs  Leitura e escrita no Supabase (API REST com a chave secreta)
├── verify.mjs              Teste de criação/consulta/edição/exclusão no banco real
├── .env.example            Modelo de configuração (o .env de verdade fica fora do git)
├── public/
│   ├── index.html          Tela do painel (Conteúdos e Clientes, modais, painel de detalhes)
│   ├── css/admin.css       Estilos do painel (reaproveita o style.css do portal)
│   └── js/
│       ├── main.js         Navegação e estado
│       ├── api.js          Chamadas à API local
│       ├── domain/rules.js Validações (usadas também pelo servidor)
│       ├── views/          clients.js e contents.js
│       └── ui/             dialogs.js e states.js
└── test/                   Testes automáticos (o memory-store.mjs é só para testes)
supabase/migrations/        Estrutura do banco (tabelas, regras, segurança)
```

O painel reaproveita do portal (`site/`) as fontes, cores, ícones, utilitários e componentes de etiqueta e aviso.

### Banco de dados (Supabase, projeto `digitalgalaxy-portal`, São Paulo)

| Tabela | Conteúdo |
|---|---|
| `clients` | Nome, identificador (`slug`), segmento, contato, observações, ativo |
| `contents` | Conteúdos de cada cliente (campos acima) e `version`, que sobe quando muda algo que o cliente vê |
| `agency_members` | Quem da equipe poderá entrar no painel (usado na etapa de login) |
| `client_calendar_items` (visão) | Calendário do cliente: sem observações internas e só com status aguardando aprovação, aprovado ou publicado |

**Segurança:** RLS ligado em todas as tabelas; o acesso público (`anon`) não tem permissão nenhuma; usuários logados só acessam se estiverem em `agency_members`. Hoje, só o servidor local acessa o banco, com a chave secreta.

### Testes

```bash
node admin/test/store-supabase.test.mjs   # adaptador do Supabase (sem rede)
PLAYWRIGHT=$(npm root -g)/playwright/index.mjs node admin/test/e2e.mjs   # tela + API, ponta a ponta
```

O teste de ponta a ponta usa um banco em memória **só para teste**; ele confere segurança do servidor, cadastro, edição, filtros, exclusão com confirmação, erros e layout no celular.

### O que ainda depende de login

1. **Login da equipe** (Supabase Auth) e cadastro em `agency_members`. As regras do banco já exigem isso.
2. **Publicar o painel** (ex.: `admin.digitalgalaxy.com.br`), só depois do login. Até lá, ele roda apenas no computador da agência.
3. **Portal do cliente com dados reais:** login do cliente, ligação usuário ↔ cliente e regra de acesso à visão `client_calendar_items`. O mapeamento para a tela do portal já existe em `site/js/domain/content-mapping.js`.

## Portal do cliente (`site/`)

> **Em modo demonstração.** Empresa e conteúdos fictícios. O que o cliente faz fica salvo só no navegador dele (`localStorage`).

### Como rodar

Site estático, sem build (mesmo padrão do site principal e do portfólio). Sirva a pasta `site/`:

```bash
npx -y http-server site -p 5502 -c-1
```

Abra http://localhost:5502. Para voltar a demonstração ao estado inicial: menu do perfil (canto superior direito) → **Restaurar demonstração**.

### Estrutura

```
site/
├── index.html                  Página do cliente (cabeçalho, resumo, calendário, ideias, painel e modal)
├── css/
│   ├── style.css               Tokens da marca, componentes e calendário
│   └── responsive.css          Tablet e celular (calendário com pontinhos + agenda do dia, painel vira folha de baixo)
├── js/
│   ├── main.js                 Liga os dados à tela; escolhe o repositório (hoje: demonstração)
│   ├── domain/
│   │   ├── model.js            Entidades (Client, Plan, Activity, Approval, Comment, Idea), tipos e status
│   │   └── status.js           Regras: status calculado pela aprovação da versão atual; indicadores do mês
│   ├── data/
│   │   ├── repository.js       Interface de dados + implementação de demonstração (localStorage)
│   │   └── demo-data.js        Dados FICTÍCIOS, montados a partir do mês atual
│   ├── lib/                    Datas em pt-BR, utilitários de DOM, ícones
│   └── ui/                     Componentes: calendar, drawer, summary, ideas, preview, badges, toast
├── fonts/                      Sora e Orbitron (locais, as mesmas do site)
└── images/logo/                Favicons da marca
```

### Modelo de dados (demonstração)

| Entidade | O que é | Pertence a |
|---|---|---|
| `Client` | Empresa atendida | — |
| `Plan` | Planejamento de um mês (`AAAA-MM`), com o "Nosso foco neste mês" e a visibilidade (`rascunho` / `compartilhado`) | Client |
| `Activity` | Conteúdo ou atividade do calendário (post, carrossel, reels, stories, campanha, ação, gravação, reunião), com data, horário, plataformas, objetivo, ideia, legenda, mídias e **versão** | Plan |
| `Approval` | Decisão do cliente (`aprovado` / `ajustes` + mensagem) sobre **uma versão** do conteúdo | Activity |
| `Comment` | Observação vinculada a uma atividade (do cliente ou da agência) | Activity |
| `Idea` | Sugestão enviada pelo cliente, com data sugerida opcional e status | Client |

**Status nunca é guardado no conteúdo.** Ele é calculado pela última aprovação da versão atual (`domain/status.js`). Quando o admin editar um conteúdo e subir a versão, o status volta sozinho para "Aguardando aprovação"; a aprovação antiga continua no histórico, ligada à versão que foi aprovada.

## Próximas etapas (preparadas, não implementadas)

1. **Login e publicação do painel** (ver "O que ainda depende de login").
2. **Portal com dados reais.** Criar um repositório com os mesmos métodos de `data/repository.js` lendo `client_calendar_items` e trocá-lo em `js/main.js`. Depois: aprovações, comentários e ideias no banco, upload de mídias.
3. **Exportar cronograma em PDF.** Gerar no admin a partir de `Plan` + `Activity[]` do mês, com a identidade da Digital Galaxy (impressão de uma página própria do cronograma ou geração no servidor).
4. **Compartilhar via WhatsApp.** Link `https://wa.me/?text=...` com a mensagem e o link do planejamento. Anexar o PDF automaticamente exige a API oficial do WhatsApp Business; sem ela, o PDF é enviado manualmente.

## Publicação

O workflow `.github/workflows/pages.yml` publica a pasta `site/` no GitHub Pages a cada push na `main`. Ainda não publicado: falta criar o repositório no GitHub e o CNAME `clientes` → `ceodigitalgalaxy.github.io` no DNS. Enquanto for demonstração, a página tem `noindex` e só dados fictícios.
