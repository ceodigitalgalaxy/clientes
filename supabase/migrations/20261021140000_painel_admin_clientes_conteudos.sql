-- ============================================================================
-- Portal de clientes Digital Galaxy · Painel administrativo (etapa 1)
-- Clientes e conteúdos do calendário editorial.
--
-- Segurança: RLS ligado em tudo e NENHUMA política para "anon" (visitante sem
-- login). Até existir login, só o servidor local do painel (admin/server.mjs),
-- com a chave secreta, lê e grava. As políticas para a equipe da agência já
-- ficam prontas (agency_members); na etapa de login basta cadastrar os membros.
-- ============================================================================

-- Clientes da agência --------------------------------------------------------
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  -- Identificador único e legível (ex.: "trigo-e-mel"), usado em links e filtros
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  segment       text check (char_length(segment) <= 120),
  contact_name  text check (char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes         text check (char_length(notes) <= 2000),          -- observações internas da agência
  active        boolean not null default true,                    -- inativar em vez de apagar
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.clients is 'Empresas atendidas pela agência. Cada conteúdo pertence a um cliente.';

-- Conteúdos do calendário ----------------------------------------------------
create table public.contents (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete restrict,
  title          text not null check (char_length(btrim(title)) between 1 and 160),
  scheduled_date date not null,
  scheduled_time time,
  -- Redes: mesmas chaves de PLATFORMS em site/js/domain/model.js
  network        text not null check (network in ('instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'google', 'whatsapp')),
  -- Formato: mesmas chaves de ACTIVITY_TYPES (cores e ícones do calendário)
  format         text not null check (format in ('post', 'carrossel', 'reels', 'stories', 'outro')),
  media_url      text check (media_url is null or (media_url ~* '^https?://' and char_length(media_url) <= 2000)),
  media_kind     text check (media_kind in ('image', 'video')),
  caption        text check (char_length(caption) <= 2200),
  internal_notes text check (char_length(internal_notes) <= 4000),  -- nunca exibidas ao cliente
  status         text not null default 'planejado'
                 check (status in ('planejado', 'em_producao', 'aguardando_aprovacao', 'aprovado', 'publicado')),
  -- Sobe quando muda algo que o cliente vê: aprovações valem só para a versão aprovada
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((media_url is null) = (media_kind is null))
);
comment on table public.contents is 'Conteúdos do calendário editorial, sempre ligados a um cliente.';
comment on column public.contents.internal_notes is 'Observações internas da agência. Não aparecem para o cliente.';

create index contents_client_date_idx on public.contents (client_id, scheduled_date);
create index contents_date_idx on public.contents (scheduled_date);
create index contents_status_idx on public.contents (status);

-- updated_at automático e versão do conteúdo ---------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function public.bump_content_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title, new.scheduled_date, new.scheduled_time, new.network, new.format, new.media_url, new.media_kind, new.caption)
     is distinct from
     (old.title, old.scheduled_date, old.scheduled_time, old.network, old.format, old.media_url, old.media_kind, old.caption) then
    new.version := old.version + 1;
  else
    new.version := old.version;   -- a versão não é editada diretamente
  end if;
  return new;
end $$;

create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger contents_touch before update on public.contents
  for each row execute function public.touch_updated_at();
create trigger contents_version before update on public.contents
  for each row execute function public.bump_content_version();

-- Calendário do cliente --------------------------------------------------------
-- O que o calendário de um cliente pode mostrar: sem observações internas e só
-- conteúdos que já saíram da produção. security_invoker: respeita o RLS de quem consulta.
create view public.client_calendar_items with (security_invoker = true) as
  select id, client_id, title, scheduled_date, scheduled_time, network, format,
         media_url, media_kind, caption, status, version, updated_at
  from public.contents
  where status in ('aguardando_aprovacao', 'aprovado', 'publicado');
comment on view public.client_calendar_items is 'Conteúdos visíveis no calendário do cliente (sem observações internas).';

-- Equipe da agência (preparado para a etapa de login) ------------------------
create table public.agency_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.agency_members is 'Usuários com acesso ao painel administrativo. Vazia até a etapa de login.';

create function public.is_agency_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members where user_id = (select auth.uid()));
$$;
revoke all on function public.is_agency_member() from public, anon;
grant execute on function public.is_agency_member() to authenticated;

-- Segurança -------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.contents enable row level security;
alter table public.agency_members enable row level security;

-- Visitantes sem login não têm nenhum acesso
revoke all on public.clients, public.contents, public.agency_members, public.client_calendar_items from anon;

-- Equipe da agência (só quem estiver em agency_members, depois do login)
create policy "Equipe da agência gerencia clientes" on public.clients
  for all to authenticated
  using ((select public.is_agency_member())) with check ((select public.is_agency_member()));
create policy "Equipe da agência gerencia conteúdos" on public.contents
  for all to authenticated
  using ((select public.is_agency_member())) with check ((select public.is_agency_member()));
create policy "Membro vê o próprio cadastro" on public.agency_members
  for select to authenticated
  using (user_id = (select auth.uid()));
