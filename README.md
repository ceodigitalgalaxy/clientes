# Portal de clientes · Digital Galaxy

Portal onde cada cliente acompanha o planejamento de marketing da sua marca: calendário de conteúdos, aprovações, pedidos de ajuste, observações e ideias. Endereço previsto: **https://clientes.digitalgalaxy.com.br**.

O projeto tem duas partes, publicadas juntas pelo GitHub Pages:

| Parte | Endereço | Pasta | Situação |
|---|---|---|---|
| **Portal do cliente** | `clientes.digitalgalaxy.com.br` | `site/` | Cada cliente entra com usuário e senha e vê o calendário com os conteúdos que a agência liberou |
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

Senhas: pelo menos 6 caracteres, sem conter o nome do usuário. Ficam guardadas só no Supabase, criptografadas. **Nunca** envie o `admin/.env` para o GitHub nem cole a chave secreta ou senhas em chats ou páginas.

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
- **Clientes:** cadastrar, editar, inativar e excluir (só quem não tem conteúdos; com conteúdos, inative). Cada cliente tem um identificador único (`slug`) e pode ter uma **foto/logo** (PNG, JPG ou WebP, reduzida para 512 px), que aparece no topo do portal dele.
- **Conteúdos:** cliente, título, data e horário, rede social, formato (imagem, carrossel, vídeo, stories ou outro), link da **referência** (imagem ou vídeo, com prévia na lista e nos detalhes), legenda, observação para o cliente, observações internas e status (planejado, em produção, aguardando aprovação, ajustes solicitados, aprovado, publicado).
- **Arte final:** nos detalhes do conteúdo, enviar arquivos (imagem, GIF ou vídeo MP4/WebM/MOV, até 50 MB cada) e/ou links de vídeo, na ordem do carrossel (setas para reordenar). Depois, **Enviar para aprovação**: o cliente vê a arte final no portal e aprova ou pede ajuste com uma mensagem. O histórico das respostas aparece no painel; aprovado, dá para **Marcar como publicado**. Se a arte mudar depois da aprovação, o painel avisa para enviar de novo.
- **Aprovação de anúncios** (menu "Anúncios"): criativos de anúncios pagos, separados do calendário. Cadastro com cliente, título, contexto e objetivo da campanha, plataforma (Meta, Google, TikTok ou outra), formato (imagem, vídeo, carrossel), criativo (arquivos de até 50 MB ou links), texto principal, headline, descrição, CTA, link de destino e observações. Salva como **rascunho** (só a equipe vê), envia para aprovação (o cliente vê na hora), e o histórico registra quem enviou, quando, quem aprovou ou pediu alterações e o comentário. Cada envio guarda uma **versão** (textos + criativo) que pode ser aberta depois. Enquanto o cliente avalia, o anúncio fica travado: para mudar, "Recolher para editar"; aprovado, "Reabrir"; e "Arquivar"/"Reativar". O menu mostra quantos anúncios têm alterações pedidas. Na lista, marque vários anúncios (ou "Selecionar todos") para **enviar para aprovação** ou **arquivar** de uma vez; os que não podem (sem criativo, já com o cliente) ficam de fora e o painel avisa antes. Criativo que é post do Instagram ou vídeo do Vimeo aparece como capa nos cards.
- **Importar anúncios:** na mesma seção Importar, escolha "Anúncios" e use o modelo `modelo-importacao-anuncios.xlsx`. Colunas: Título do anúncio, Plataforma, Formato (obrigatórias), Objetivo, Contexto, Texto principal, Headline, Descrição, CTA, Link de destino, Link do criativo (um ou vários, na ordem do carrossel), Observações e "Enviar para aprovação" (sim/não). Entram como rascunho; os marcados com "sim" e com link do criativo vão direto para o cliente. Arquivos do computador: envie depois, nos detalhes do anúncio.
- **Importar:** escolher o cliente e uma planilha (.xlsx ou .csv; há um modelo para baixar). O painel mostra a prévia linha a linha (pronto, com erro, parece repetido), com a miniatura da referência, e importa só as linhas marcadas, de uma vez. Colunas: Título, Data, Horário, Rede social, Formato, Link da referência, Legenda, Observação para o cliente, Observações internas e Status (vazio = planejado).
- Criar, ver detalhes, editar e excluir (com confirmação).
- **Status em massa:** marque conteúdos na lista (ou "Selecionar todos"), escolha o status e clique em **Aplicar**. O painel confirma antes e avisa quantos passam a aparecer (ou deixam de aparecer) no calendário do cliente.
- **Capa da referência em vídeo:** YouTube e Google Drive (arquivo público) mostram a capa oficial; arquivo de vídeo (.mp4, .webm) mostra o primeiro quadro. Vimeo, TikTok e Instagram não oferecem capa sem serviços de terceiros: na lista aparece o ícone de vídeo. Posts e reels públicos do Instagram aparecem nos detalhes (painel e portal) pela página oficial de incorporação do Instagram.
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
├── index.html                 Entrada (login) + painel (Conteúdos, Clientes e Importar, modais, detalhes)
├── modelo-importacao-conteudos.xlsx  Modelo da planilha de importação
├── css/admin.css              Estilos do painel (reaproveita o style.css do portal)
└── js/
    ├── main.js                Entrada, checagem da equipe, navegação e estado
    ├── config.js              Endereço do Supabase e chave PUBLICÁVEL
    ├── auth.js                Login, renovação e saída (Supabase Auth)
    ├── api.js                 Valida e chama o banco com a sessão
    ├── data/store.js          Leitura e escrita no Supabase (navegador e comandos locais)
    ├── domain/rules.js        Validações, regras de usuário e senha
    ├── lib/spreadsheet.js     Leitor de .xlsx e .csv (sem bibliotecas externas)
    ├── domain/import.js       Planilha → conteúdos (colunas, datas, apelidos, erros, repetidos)
    ├── views/                 clients.js, contents.js, content-review.js (arte final e aprovação),
    │                          import.js (Importar) e access.js (acesso do cliente ao portal)
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
| `ads`, `ad_assets` | Anúncios pagos e o criativo de cada um (bucket privado `ad-media` ou links). Status e versão só mudam pela função `ad_transition` (equipe) e `portal_ad_decide` (cliente); um gatilho recusa mudanças diretas e edição enquanto o cliente avalia |
| `ad_versions`, `ad_events` | Cópia de cada versão enviada e o histórico completo (envios, decisões com comentário, recolher, reabrir, arquivar). Nunca apagados por um novo envio. `ad_events.notified_at` fica pronto para um futuro aviso por e-mail |
| `content_assets` | Arte final de cada conteúdo, em ordem: arquivo no armazenamento ou link de vídeo |
| `content_approvals` | Respostas do cliente: versão, aprovado ou ajustes, mensagem e quem respondeu |
| `client_calendar_items` (visão) | Calendário do cliente para a equipe: sem observações internas e só com status aguardando aprovação, aprovado ou publicado |
| `portal_client()`, `portal_calendar(p_from, p_to)` e `portal_decide(conteúdo, versão, decisão, mensagem)` | **As únicas portas do cliente.** Descobrem o cliente pela sessão (não recebem id de cliente): devolvem só os conteúdos liberados dele (com arte final e a última resposta), sem observações internas, e registram a aprovação ou o pedido de ajuste só se o conteúdo for dele, estiver aguardando aprovação e a versão for a atual. O cliente não tem nenhum acesso direto às tabelas |

**Armazenamento (Supabase Storage):** `client-logos` (público, 2 MB, só fotos/logos) e `content-media` (privado, 50 MB por arquivo). A arte final é aberta por links temporários de 1 hora; o cliente só consegue gerar link para arquivos de conteúdos dele já liberados. Só a equipe envia ou apaga arquivos. No plano gratuito do Supabase o armazenamento total é de 1 GB.

Em cada conteúdo, **Observação para o cliente** (`client_notes`) aparece no portal; **Observações internas** (`internal_notes`) nunca saem do painel.

### Testes

```bash
P=$(npm root -g)/playwright/index.mjs
node admin/test/store.test.mjs                    # banco, login e equipe (sem rede)
node admin/test/portal.test.mjs                   # links de mídia, repositório do portal, contas de cliente, função acesso-cliente
PLAYWRIGHT=$P node admin/test/e2e.mjs             # painel da agência, ponta a ponta
PLAYWRIGHT=$P node admin/test/portal-e2e.mjs      # painel → calendário do cliente, ponta a ponta
PLAYWRIGHT=$P node admin/test/review-e2e.mjs      # foto, arte final, aprovação/ajuste e importação, ponta a ponta
PLAYWRIGHT=$P node admin/test/ads-e2e.mjs         # aprovação de anúncios: rascunho → envio → alterações → nova versão → aprovação
PLAYWRIGHT=$P UX_SHOTS=pasta node admin/test/ux-shots.mjs   # só capturas do portal (computador e celular) para revisão visual
```

Os testes de ponta a ponta usam um Supabase de mentira em memória (**só para teste**). O do portal abre o painel e o portal lado a lado e confere: imagem cadastrada na data certa e proporcional, vídeo do YouTube no player oficial, arquivo de vídeo, reel do Instagram no player oficial, link do Facebook e imagem quebrada com aviso, mudança de data (inclusive para outro mês), edição e exclusão refletidas, atualização automática, outro cliente sem acesso, tentativas de trocar parâmetros, semana, carregando, erro, celular, a demonstração removida e o acesso do cliente criado, trocado e removido pelo painel (rodando o código real da função). O de revisão confere foto do cliente, envio e ordem da arte final, tipo de arquivo recusado, carrossel no portal (inclusive no celular), pedido de ajuste com mensagem, nova versão, aprovação de versão antiga recusada, aprovação, marcar como publicado, outro cliente sem acesso e a importação (.xlsx e .csv). O `admin/verify.mjs` repete o essencial no banco real, inclusive as aprovações.

## Portal do cliente (`site/`)

O cliente entra em `https://clientes.digitalgalaxy.com.br` com o usuário e a senha criados no painel (Clientes → Acesso ao portal) ou pelo `equipe.mjs criar-cliente` e vê o calendário com os conteúdos do cliente dele que estão **Aguardando aprovação**, **Aprovados** ou **Publicados**. Sem login, nenhum dado é pedido ao banco.

- **Aprovação de anúncios** (aba ao lado do calendário, com o número de anúncios esperando resposta): abas por status (todos, aguardando, alterações, aprovados, arquivados), cards com a prévia, e os detalhes com o anúncio simulado como post patrocinado, todos os textos, o link de destino, as observações e o histórico. **Aprovar anúncio** pede confirmação; **Solicitar alterações** exige um comentário. Rascunhos e anúncios de outros clientes nunca chegam ao navegador (funções `portal_ads` e `portal_ad_decide`).
- **Destaques:** carrossel no topo que passa sozinho com o que o cliente tem para aprovar, os ajustes em andamento, os aprovados e os já publicados; cada destaque abre os detalhes. Os números do mês ficam embaixo, pequenos.
- **Calendário:** mês ou semana, com navegação; cada dia fica na cor do status dos conteúdos (âmbar para aprovar, vermelho em ajuste, verde aprovado, roxo publicado); no celular, pontinhos no dia, agenda abaixo com miniaturas e botões de aprovar sempre à mão nos detalhes.
- **Detalhes** (clique no conteúdo ou na data): título, prévia da mídia, legenda, rede social, data, status e a observação para o cliente. Data com vários conteúdos mostra a lista; data livre mostra "Nada programado para este dia".
- **Atualização:** busca de novo a cada 30 segundos, ao voltar para a aba e no botão **Atualizar**. O que a agência muda no painel aparece sozinho, inclusive no painel de detalhes aberto.
- **Ainda não gravam no banco:** aprovar, pedir ajuste, observações do cliente e ideias. Os componentes dessas ações estão no código (`ui/drawer.js`, `ui/ideas.js`) e ficam escondidos até a próxima etapa.
- A demonstração com dados fictícios foi removida: o portal só mostra dados reais, depois do login.

### Links de mídia aceitos (prévia)

| Link | Como aparece |
|---|---|
| Imagem (link direto do arquivo: .jpg, .png, .webp...) | Imagem inteira e proporcional, sem cortar nem esticar |
| YouTube (vídeo, Shorts, youtu.be) | Player oficial em modo de privacidade (`youtube-nocookie.com`) |
| Vimeo (inclusive não listado com o código) | Player oficial (`player.vimeo.com`) |
| TikTok (link completo `tiktok.com/@perfil/video/...`) | Player oficial (`tiktok.com/player`) |
| Google Drive (link de arquivo) | Prévia oficial do Drive (o arquivo precisa estar compartilhado com "qualquer pessoa com o link") |
| Arquivo de vídeo (.mp4, .webm, .ogg, .m4v, .mov) | Player do navegador, sem tocar sozinho |
| Post ou reel público do Instagram (`instagram.com/p/…`, `/reel/…`, com ou sem o perfil antes) | Página oficial de incorporação do Instagram (`instagram.com/p/<código>/embed`) |
| Perfil ou stories do Instagram, Facebook, links curtos do TikTok, Canva, páginas comuns | **Não são incorporados**: aviso amigável e botão para abrir o original |

Se a imagem ou o arquivo de vídeo não carregar, a prévia vira o mesmo aviso com o link. Players incorporados (YouTube, Vimeo, TikTok, Drive) não avisam quando o vídeo é privado ou foi removido: nesses casos aparece a mensagem da própria plataforma, e o link para abrir o original fica sempre embaixo.

### Como rodar

Site estático, sem build. Para ver localmente: `node admin/server.mjs` e abra http://localhost:5600/ (portal).

### Estrutura

```
site/
├── index.html                  Página do cliente (cabeçalho, resumo, calendário, ideias, painel e modal)
├── css/
│   ├── style.css               Tokens da marca, componentes e calendário
│   └── responsive.css          Tablet e celular (calendário com pontinhos + agenda do dia, painel vira folha de baixo)
├── js/
│   ├── main.js                 Liga os dados à tela: entrada do cliente, mês/semana, atualização
│   ├── config.js               Endereço do Supabase e chave PUBLICÁVEL
│   ├── domain/
│   │   ├── model.js            Entidades (Client, Plan, Activity, Approval, Comment, Idea), tipos e status
│   │   ├── status.js           Regras: status (da agência ou calculado pelas aprovações); indicadores do mês
│   │   ├── content-mapping.js  Linha do banco → Activity do calendário
│   │   └── accounts.js         Usuário e senha (equipe e clientes)
│   ├── data/
│   │   └── supabase-repository.js  Dados do portal (funções portal_profile / portal_contents)
│   ├── lib/                    Datas em pt-BR, utilitários de DOM, ícones, login (auth.js)
│   └── ui/                     Componentes: calendar, drawer, highlights (destaques), ideas, preview, media, badges, toast
├── fonts/                      Sora e Orbitron (locais, as mesmas do site)
└── images/logo/                Favicons da marca
```

### Modelo de dados da tela

| Entidade | O que é | Pertence a |
|---|---|---|
| `Client` | Empresa atendida | — |
| `Plan` | Planejamento de um mês (`AAAA-MM`), com o "Nosso foco neste mês" e a visibilidade (`rascunho` / `compartilhado`) | Client |
| `Activity` | Conteúdo ou atividade do calendário (post, carrossel, reels, stories, campanha, ação, gravação, reunião), com data, horário, plataformas, objetivo, ideia, legenda, mídias e **versão** | Plan |
| `Approval` | Decisão do cliente (`aprovado` / `ajustes` + mensagem) sobre **uma versão** do conteúdo | Activity |
| `Comment` | Observação vinculada a uma atividade (do cliente ou da agência) | Activity |
| `Idea` | Sugestão enviada pelo cliente, com data sugerida opcional e status | Client |

Hoje `Client`, `Activity` (com a arte final) e `Approval` vêm do banco. `Plan`, `Comment` e `Idea` são o desenho de uma próxima etapa. Uma aprovação vale só para a versão aprovada: qualquer mudança que o cliente vê (inclusive na arte final) sobe a `version`.

## Próximas etapas (preparadas, não implementadas)

1. **Comentários e ideias do cliente no banco** e "foco do mês".
2. **Exportar cronograma em PDF.** Gerar no admin a partir de `Plan` + `Activity[]` do mês, com a identidade da Digital Galaxy (impressão de uma página própria do cronograma ou geração no servidor).
3. **Compartilhar via WhatsApp.** Link `https://wa.me/?text=...` com a mensagem e o link do planejamento. Anexar o PDF automaticamente exige a API oficial do WhatsApp Business; sem ela, o PDF é enviado manualmente.

## Publicação

Antes de publicar uma mudança de CSS ou JS, rode `node admin/versao.mjs` (coloca a mesma versão em todos os arquivos, para o navegador nunca misturar arquivo novo com antigo do cache). O workflow `.github/workflows/pages.yml` publica a pasta `site/` (portal e `site/admin/`) no GitHub Pages a cada push na `main`, em `https://clientes.digitalgalaxy.com.br`. As páginas têm `noindex`. A pasta `admin/` (ferramentas locais) não é publicada. Antes de publicar mudanças no painel, deixe o cadastro aberto do Supabase desligado (`node admin/equipe.mjs verificar`).
