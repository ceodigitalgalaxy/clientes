# Portal de clientes · Digital Galaxy

Portal onde cada cliente acompanha o planejamento de marketing da sua marca: calendário de conteúdos, aprovações, pedidos de ajuste, observações e ideias. Endereço previsto: **https://clientes.digitalgalaxy.com.br**.

> **Etapa atual: primeira versão do painel do cliente, em modo demonstração.**
> Empresa e conteúdos fictícios ("Trigo & Mel"). Sem login e sem backend: o que o cliente faz fica salvo só no navegador dele (`localStorage`). Nada é enviado para a Digital Galaxy ainda.

## Como rodar

Site estático, sem build (mesmo padrão do site principal e do portfólio). Sirva a pasta `site/`:

```bash
npx -y http-server site -p 5502 -c-1
```

Abra http://localhost:5502. Para voltar a demonstração ao estado inicial: menu do perfil (canto superior direito) → **Restaurar demonstração**.

## Estrutura

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

## Modelo de dados

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

1. **Backend e login.** Criar uma implementação de repositório com os mesmos métodos de `data/repository.js` (ex.: Supabase com autenticação por cliente e regras de acesso por `clientId`) e trocá-la em `js/main.js`. A tela não muda.
2. **Painel administrativo.** Nova página (ex.: `site/admin/`) reaproveitando `domain/`, `lib/` e os componentes de `ui/` (calendário, etiquetas, prévia). O repositório do admin ganha escrita: clientes, planos, atividades (subindo `version` a cada edição), upload de mídias, status das ideias e "compartilhar" o plano (`visibility`).
3. **Exportar cronograma em PDF.** Gerar no admin a partir de `Plan` + `Activity[]` do mês, com a identidade da Digital Galaxy (impressão de uma página própria do cronograma ou geração no servidor).
4. **Compartilhar via WhatsApp.** Link `https://wa.me/?text=...` com a mensagem e o link do planejamento. Anexar o PDF automaticamente exige a API oficial do WhatsApp Business; sem ela, o PDF é enviado manualmente.

## Publicação

O workflow `.github/workflows/pages.yml` publica a pasta `site/` no GitHub Pages a cada push na `main`. Ainda não publicado: falta criar o repositório no GitHub e o CNAME `clientes` → `ceodigitalgalaxy.github.io` no DNS. Enquanto for demonstração, a página tem `noindex` e só dados fictícios.
