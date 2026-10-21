# Portal de clientes · Digital Galaxy

Portal onde cada cliente acompanha o planejamento de marketing da sua marca: calendário de conteúdos, aprovações, pedidos de ajuste, observações e ideias. Endereço previsto: **https://clientes.digitalgalaxy.com.br**.

O projeto tem duas partes, publicadas juntas pelo GitHub Pages:

| Parte | Endereço | Pasta | Situação |
|---|---|---|---|
| **Portal do cliente** | `clientes.digitalgalaxy.com.br` | `site/` | Demonstração com dados fictícios ("Trigo & Mel"), salvos só no navegador |
| **Painel da agência** | `clientes.digitalgalaxy.com.br/admin/` | `site/admin/` | Clientes e conteúdos no banco Supabase. Acesso só com usuário e senha da equipe |

A pasta `admin/` tem as ferramentas que rodam **só no computador da agência** (criar usuários, prévia local, verificação do banco). Ela não é publicada.

## Painel da agência

### Entrar

Abra `https://clientes.digitalgalaxy.com.br/admin/` e entre com o usuário e a senha. O usuário é um nome (ex.: `admdg`), sem e-mail. "Sair", no topo, encerra a sessão. A sessão dura enquanto for usada; se a senha for trocada ou o usuário removido, ela acaba na próxima renovação (até 1 hora).

### Criar usuários e trocar senhas

Só pelo computador da agência, com a chave secreta em `admin/.env`. Requer Node 22.12 ou mais novo, sem dependências para instalar.

```bash
cp admin/.env.example admin/.env      # uma vez; cole a chave secreta (Supabase → Project Settings → API Keys → Secret key)
node admin/equipe.mjs criar           # novo usuário (a senha é digitada sem aparecer)
node admin/equipe.mjs senha           # troca a senha (também serve para "esqueci a senha")
node admin/equipe.mjs listar          # quem tem acesso e o último acesso de cada um
node admin/equipe.mjs remover         # apaga o usuário (perde o acesso)
node admin/equipe.mjs verificar       # confere se o cadastro aberto está desligado
```

Senhas: pelo menos 10 caracteres, sem conter o nome do usuário. Ficam guardadas só no Supabase, criptografadas. **Nunca** envie o `admin/.env` para o GitHub nem cole a chave secreta ou senhas em chats ou páginas.

### Conferir o banco e a proteção

```bash
node admin/verify.mjs
```

Cria um cliente e um conteúdo de teste, consulta, edita, filtra e exclui (apaga tudo no fim). Também confere que visitante sem login não lê nenhuma tabela e que o cadastro aberto está desligado.

### Prévia local (antes de publicar)

```bash
node admin/server.mjs                 # http://localhost:5600/admin/ (e o portal em http://localhost:5600/)
```

Serve a pasta `site/` como o GitHub Pages. Não usa chave nenhuma: entra com usuário e senha, igual ao publicado.

### O que faz

- **Login da equipe** com usuário e senha; quem não faz parte da equipe é recusado.
- **Clientes:** cadastrar, editar, inativar e excluir (só quem não tem conteúdos; com conteúdos, inative). Cada cliente tem um identificador único (`slug`).
- **Conteúdos:** cliente, título, data e horário, rede social, formato (imagem, carrossel, vídeo, stories ou outro), URL de referência da mídia (imagem ou vídeo), legenda, observações internas e status (planejado, em produção, aguardando aprovação, aprovado, publicado).
- Criar, ver detalhes, editar e excluir (com confirmação).
- Filtros por cliente, período e status, guardados no endereço da página.
- Estados de carregamento, sucesso, erro (com "Tentar novamente") e lista vazia.

### Como a proteção funciona

- **Quem protege os dados é o banco**, não a página. Todas as tabelas têm RLS: sem login, nada; com login, só quem está em `agency_members`. Mesmo que alguém copie a página ou chame a API do Supabase direto, não recebe dados.
- O navegador só conhece a **chave publicável** (`site/admin/js/config.js`), que sozinha não dá acesso a nada. A **chave secreta** fica só em `admin/.env`, no computador da agência.
- Usuários só são criados pelo `admin/equipe.mjs`. O cadastro aberto do Supabase precisa ficar **desligado** (Authentication → Sign In / Providers → "Allow new users to sign up"). O `verify.mjs` e o `equipe.mjs verificar` conferem.
- Cada usuário vira um endereço interno `equipe+<usuario>@digitalgalaxy.com.br` no Supabase Auth. Nenhum e-mail é enviado para ele.
- A página tem CSP (só arquivos do site e o Supabase do painel), `noindex` e não aparece dentro de outros sites (iframe).
- Sessão: token de acesso de 1 hora, renovado sozinho. "Sair" apaga a sessão do navegador e a encerra no Supabase.

### Estrutura

```
site/admin/                    ← publicado em /admin/
├── index.html                 Entrada (login) + painel (Conteúdos e Clientes, modais, detalhes)
├── css/admin.css              Estilos do painel (reaproveita o style.css do portal)
└── js/
    ├── main.js                Entrada, checagem da equipe, navegação e estado
    ├── config.js              Endereço do Supabase e chave PUBLICÁVEL
    ├── auth.js                Login, renovação e saída (Supabase Auth)
    ├── api.js                 Valida e chama o banco com a sessão
    ├── data/store.js          Leitura e escrita no Supabase (navegador e comandos locais)
    ├── domain/rules.js        Validações, regras de usuário e senha
    ├── views/                 clients.js e contents.js
    └── ui/                    dialogs.js e states.js
admin/                         ← só no computador da agência (não publicado)
├── equipe.mjs                 Criar usuários, trocar senha, listar, remover
├── verify.mjs                 Verificação no banco real
├── server.mjs                 Prévia local de site/
├── .env.example               Modelo de configuração (o .env de verdade fica fora do git)
└── test/                      Testes automáticos (memory-store e fake-supabase são só para testes)
supabase/migrations/           Estrutura do banco (tabelas, regras, segurança)
```

### Banco de dados (Supabase, projeto `digitalgalaxy-portal`, São Paulo)

| Tabela | Conteúdo |
|---|---|
| `clients` | Nome, identificador (`slug`), segmento, contato, observações, ativo |
| `contents` | Conteúdos de cada cliente (campos acima) e `version`, que sobe quando muda algo que o cliente vê |
| `agency_members` | Quem da equipe pode entrar no painel (preenchida pelo `equipe.mjs`) |
| `client_calendar_items` (visão) | Calendário do cliente: sem observações internas e só com status aguardando aprovação, aprovado ou publicado |

### Testes

```bash
node admin/test/store.test.mjs                                          # banco, login e equipe (sem rede)
PLAYWRIGHT=$(npm root -g)/playwright/index.mjs node admin/test/e2e.mjs   # tela, ponta a ponta
```

O teste de ponta a ponta usa um Supabase de mentira em memória (**só para teste**) e confere: prévia local, CSP, login (senha errada, muitas tentativas, usuário fora da equipe), renovação e fim da sessão, sair, iframe, cadastro, edição, filtros, exclusão com confirmação, erros e layout no celular.

### Próximo passo: portal do cliente com dados reais

Login do cliente, ligação usuário ↔ cliente e regra de acesso à visão `client_calendar_items`. O mapeamento para a tela do portal já existe em `site/js/domain/content-mapping.js`; o mesmo esquema de usuário e senha pode ser reaproveitado.

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

1. **Portal com dados reais.** Criar um repositório com os mesmos métodos de `data/repository.js` lendo `client_calendar_items` e trocá-lo em `js/main.js`. Depois: aprovações, comentários e ideias no banco, upload de mídias.
2. **Exportar cronograma em PDF.** Gerar no admin a partir de `Plan` + `Activity[]` do mês, com a identidade da Digital Galaxy (impressão de uma página própria do cronograma ou geração no servidor).
3. **Compartilhar via WhatsApp.** Link `https://wa.me/?text=...` com a mensagem e o link do planejamento. Anexar o PDF automaticamente exige a API oficial do WhatsApp Business; sem ela, o PDF é enviado manualmente.

## Publicação

O workflow `.github/workflows/pages.yml` publica a pasta `site/` (portal e `site/admin/`) no GitHub Pages a cada push na `main`, em `https://clientes.digitalgalaxy.com.br`. As páginas têm `noindex`. A pasta `admin/` (ferramentas locais) não é publicada. Antes de publicar mudanças no painel, deixe o cadastro aberto do Supabase desligado (`node admin/equipe.mjs verificar`).
