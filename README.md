# Portal de clientes · Digital Galaxy

Portal onde cada cliente acompanha o planejamento de marketing da sua marca: calendário de conteúdos, aprovações, pedidos de ajuste, observações e ideias. Endereço previsto: **https://clientes.digitalgalaxy.com.br**.

O projeto tem duas partes, publicadas juntas pelo GitHub Pages:

| Parte | Endereço | Pasta | Situação |
|---|---|---|---|
| **Portal do cliente** | `clientes.digitalgalaxy.com.br` | `site/` | Cada cliente entra com usuário e senha e vê o calendário com os conteúdos que a agência liberou. Demonstração com dados fictícios em `?demo` |
| **Painel da agência** | `clientes.digitalgalaxy.com.br/admin/` | `site/admin/` | Clientes e conteúdos no banco Supabase. Acesso só com usuário e senha da equipe |

A pasta `admin/` tem as ferramentas que rodam **só no computador da agência** (criar usuários, prévia local, verificação do banco). Ela não é publicada.

## Painel da agência

### Entrar

Abra `https://clientes.digitalgalaxy.com.br/admin/` e entre com o usuário e a senha. O usuário é um nome (ex.: `admdg`), sem e-mail. "Sair", no topo, encerra a sessão. A sessão dura enquanto for usada; se a senha for trocada ou o usuário removido, ela acaba na próxima renovação (até 1 hora).

### Acesso dos clientes ao portal (pelo painel)

Na seção **Clientes**, cada cartão tem o bloco **Acesso ao portal**:

- **Criar acesso ao portal:** usuário (sugerido pelo identificador do cliente) e senha (digite ou use **Gerar senha**). Ao salvar, o painel mostra endereço, usuário e senha uma única vez, com o botão **Copiar dados de acesso** para enviar ao cliente. A senha não fica guardada no painel.
- **Trocar senha** e **Remover** (com confirmação) para cada login do cliente.

Isso passa pela função `supabase/functions/acesso-cliente` (Supabase Edge Function). Ela guarda a chave secreta no servidor, confere a cada pedido que quem chama é da equipe (`agency_members`) e só mexe em logins de **cliente**: nunca cria, altera ou remove usuários da equipe. Aceita pedidos só do site (`clientes.digitalgalaxy.com.br`) e da prévia local.

### Criar usuários da equipe (e, se preferir, de clientes) pelo computador

Só pelo computador da agência, com a chave secreta em `admin/.env`. Requer Node 22.12 ou mais novo, sem dependências para instalar.

```bash
cp admin/.env.example admin/.env      # uma vez; cole a chave secreta (Supabase → Project Settings → API Keys → Secret key)
node admin/equipe.mjs criar           # novo usuário da EQUIPE (painel da agência)
node admin/equipe.mjs criar-cliente   # login de um CLIENTE no portal (escolhe o cliente da lista)
node admin/equipe.mjs senha           # troca a senha (também serve para "esqueci a senha")
node admin/equipe.mjs listar          # equipe e clientes com acesso, e o último acesso de cada um
node admin/equipe.mjs remover         # apaga o usuário (perde o acesso)
node admin/equipe.mjs verificar       # confere se o cadastro aberto está desligado
```

A senha é digitada sem aparecer. Usuários da equipe só são criados por aqui.

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
    ├── views/                 clients.js, contents.js e access.js (acesso do cliente ao portal)
    └── ui/                    dialogs.js e states.js
admin/                         ← só no computador da agência (não publicado)
├── equipe.mjs                 Criar usuários, trocar senha, listar, remover
├── verify.mjs                 Verificação no banco real
├── server.mjs                 Prévia local de site/
├── test/fixtures/             Imagem e vídeo usados só nos testes
├── .env.example               Modelo de configuração (o .env de verdade fica fora do git)
└── test/                      Testes automáticos (memory-store e fake-supabase são só para testes)
supabase/migrations/           Estrutura do banco (tabelas, regras, segurança)
supabase/functions/acesso-cliente/  Função que cria, troca a senha e remove logins de cliente (painel)
```

Para publicar uma mudança na função: `supabase functions deploy acesso-cliente --no-verify-jwt` (ou pelo painel do Supabase). O arquivo `accounts.js` da função é cópia de `site/js/domain/accounts.js`; o teste `portal.test.mjs` avisa se os dois ficarem diferentes.

### Banco de dados (Supabase, projeto `digitalgalaxy-portal`, São Paulo)

| Tabela | Conteúdo |
|---|---|
| `clients` | Nome, identificador (`slug`), segmento, contato, observações, ativo |
| `contents` | Conteúdos de cada cliente (campos acima) e `version`, que sobe quando muda algo que o cliente vê |
| `agency_members` | Quem da equipe pode entrar no painel (preenchida pelo `equipe.mjs`) |
| `client_members` | Login de cada cliente no portal, ligado a **um** cliente (preenchida pelo `equipe.mjs criar-cliente`) |
| `client_calendar_items` (visão) | Calendário do cliente para a equipe: sem observações internas e só com status aguardando aprovação, aprovado ou publicado |
| `portal_profile()` e `portal_contents(p_from, p_to)` | **As únicas portas do cliente.** Descobrem o cliente pela sessão (não recebem id de cliente) e devolvem só os conteúdos liberados dele, sem observações internas. O cliente não tem nenhum acesso direto às tabelas |

Em cada conteúdo, **Observação para o cliente** (`client_notes`) aparece no portal; **Observações internas** (`internal_notes`) nunca saem do painel.

### Testes

```bash
P=$(npm root -g)/playwright/index.mjs
node admin/test/store.test.mjs                    # banco, login e equipe (sem rede)
node admin/test/portal.test.mjs                   # links de mídia, repositório do portal, contas de cliente, função acesso-cliente
PLAYWRIGHT=$P node admin/test/e2e.mjs             # painel da agência, ponta a ponta
PLAYWRIGHT=$P node admin/test/portal-e2e.mjs      # painel → calendário do cliente, ponta a ponta
```

Os testes de ponta a ponta usam um Supabase de mentira em memória (**só para teste**). O do portal abre o painel e o portal lado a lado e confere: imagem cadastrada na data certa e proporcional, vídeo do YouTube no player oficial, arquivo de vídeo, link do Instagram e imagem quebrada com aviso, mudança de data (inclusive para outro mês), edição e exclusão refletidas, atualização automática, outro cliente sem acesso, tentativas de trocar parâmetros, semana, carregando, erro, celular, a demonstração e o acesso do cliente criado, trocado e removido pelo painel (rodando o código real da função). O `admin/verify.mjs` repete o essencial no banco real.

## Portal do cliente (`site/`)

O cliente entra em `https://clientes.digitalgalaxy.com.br` com o usuário e a senha criados no painel (Clientes → Acesso ao portal) ou pelo `equipe.mjs criar-cliente` e vê o calendário com os conteúdos do cliente dele que estão **Aguardando aprovação**, **Aprovados** ou **Publicados**. Sem login, nenhum dado é pedido ao banco.

- **Calendário:** mês ou semana, com navegação; no celular, pontinhos no dia e agenda abaixo.
- **Detalhes** (clique no conteúdo ou na data): título, prévia da mídia, legenda, rede social, data, status e a observação para o cliente. Data com vários conteúdos mostra a lista; data livre mostra "Nada programado para este dia".
- **Atualização:** busca de novo a cada 30 segundos, ao voltar para a aba e no botão **Atualizar**. O que a agência muda no painel aparece sozinho, inclusive no painel de detalhes aberto.
- **Ainda não gravam no banco** (ficam só na demonstração): aprovar, pedir ajuste, observações do cliente e ideias. No modo real essas ações ficam escondidas.
- **Demonstração:** `https://clientes.digitalgalaxy.com.br/?demo` (dados fictícios, salvos só no navegador; "Restaurar demonstração" no menu do perfil).

### Links de mídia aceitos (prévia)

| Link | Como aparece |
|---|---|
| Imagem (link direto do arquivo: .jpg, .png, .webp...) | Imagem inteira e proporcional, sem cortar nem esticar |
| YouTube (vídeo, Shorts, youtu.be) | Player oficial em modo de privacidade (`youtube-nocookie.com`) |
| Vimeo (inclusive não listado com o código) | Player oficial (`player.vimeo.com`) |
| TikTok (link completo `tiktok.com/@perfil/video/...`) | Player oficial (`tiktok.com/player`) |
| Google Drive (link de arquivo) | Prévia oficial do Drive (o arquivo precisa estar compartilhado com "qualquer pessoa com o link") |
| Arquivo de vídeo (.mp4, .webm, .ogg, .m4v, .mov) | Player do navegador, sem tocar sozinho |
| Instagram, Facebook, links curtos do TikTok, Canva, páginas comuns | **Não são incorporados**: aviso amigável e botão para abrir o original |

Se a imagem ou o arquivo de vídeo não carregar, a prévia vira o mesmo aviso com o link. Players incorporados (YouTube, Vimeo, TikTok, Drive) não avisam quando o vídeo é privado ou foi removido: nesses casos aparece a mensagem da própria plataforma, e o link para abrir o original fica sempre embaixo.

### Como rodar

Site estático, sem build. Para ver localmente: `node admin/server.mjs` e abra http://localhost:5600/ (portal) ou http://localhost:5600/?demo (demonstração).

### Estrutura

```
site/
├── index.html                  Página do cliente (cabeçalho, resumo, calendário, ideias, painel e modal)
├── css/
│   ├── style.css               Tokens da marca, componentes e calendário
│   └── responsive.css          Tablet e celular (calendário com pontinhos + agenda do dia, painel vira folha de baixo)
├── js/
│   ├── main.js                 Liga os dados à tela: entrada do cliente, mês/semana, atualização; ?demo usa a demonstração
│   ├── config.js               Endereço do Supabase e chave PUBLICÁVEL
│   ├── domain/
│   │   ├── model.js            Entidades (Client, Plan, Activity, Approval, Comment, Idea), tipos e status
│   │   ├── status.js           Regras: status (da agência ou calculado pelas aprovações); indicadores do mês
│   │   ├── content-mapping.js  Linha do banco → Activity do calendário
│   │   └── accounts.js         Usuário e senha (equipe e clientes)
│   ├── data/
│   │   ├── repository.js       Interface de dados + implementação de demonstração (localStorage)
│   │   ├── supabase-repository.js  Implementação real (funções portal_profile / portal_contents)
│   │   └── demo-data.js        Dados FICTÍCIOS, montados a partir do mês atual
│   ├── lib/                    Datas em pt-BR, utilitários de DOM, ícones, login (auth.js)
│   └── ui/                     Componentes: calendar, drawer, summary, ideas, preview, media, badges, toast
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

1. **Aprovações, observações e ideias do cliente no banco**, para o cliente aprovar ou pedir ajuste pelo portal. Depois: upload de mídias e "foco do mês".
2. **Exportar cronograma em PDF.** Gerar no admin a partir de `Plan` + `Activity[]` do mês, com a identidade da Digital Galaxy (impressão de uma página própria do cronograma ou geração no servidor).
3. **Compartilhar via WhatsApp.** Link `https://wa.me/?text=...` com a mensagem e o link do planejamento. Anexar o PDF automaticamente exige a API oficial do WhatsApp Business; sem ela, o PDF é enviado manualmente.

## Publicação

O workflow `.github/workflows/pages.yml` publica a pasta `site/` (portal e `site/admin/`) no GitHub Pages a cada push na `main`, em `https://clientes.digitalgalaxy.com.br`. As páginas têm `noindex`. A pasta `admin/` (ferramentas locais) não é publicada. Antes de publicar mudanças no painel, deixe o cadastro aberto do Supabase desligado (`node admin/equipe.mjs verificar`).
