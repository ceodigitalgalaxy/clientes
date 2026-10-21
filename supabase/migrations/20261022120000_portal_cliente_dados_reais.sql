-- ============================================================================
-- Portal do cliente com dados reais
-- ----------------------------------------------------------------------------
-- 1. contents.client_notes: observação que a agência quer mostrar ao cliente
--    (internal_notes continua só para a equipe).
-- 2. client_members: liga cada login de cliente a UM cliente.
-- 3. portal_profile() e portal_contents(): as ÚNICAS portas do cliente para os
--    dados. Elas descobrem o cliente pela sessão (auth.uid()) e não recebem
--    id de cliente: trocar ids ou parâmetros na requisição não dá acesso a
--    outro cliente. O cliente não tem nenhuma permissão direta nas tabelas
--    (RLS: só a equipe), então não lê internal_notes nem dados de outros.
-- ============================================================================

-- 1. Observação para o cliente ------------------------------------------------
alter table public.contents
  add column client_notes text check (client_notes is null or char_length(client_notes) <= 2000);
comment on column public.contents.client_notes is 'Observação da agência que aparece para o cliente no calendário.';

-- A observação para o cliente também é algo que ele vê: muda a versão
create or replace function public.bump_content_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title, new.scheduled_date, new.scheduled_time, new.network, new.format, new.media_url, new.media_kind, new.caption, new.client_notes)
     is distinct from
     (old.title, old.scheduled_date, old.scheduled_time, old.network, old.format, old.media_url, old.media_kind, old.caption, old.client_notes) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

-- Mesma visão de antes (para a equipe), agora com a observação para o cliente
create or replace view public.client_calendar_items with (security_invoker = true) as
  select id, client_id, title, scheduled_date, scheduled_time, network, format,
         media_url, media_kind, caption, status, version, updated_at, client_notes
  from public.contents
  where status in ('aguardando_aprovacao', 'aprovado', 'publicado');

-- 2. Acesso dos clientes ------------------------------------------------------
create table public.client_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  username   text not null unique check (char_length(username) between 3 and 32 and username ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);
comment on table public.client_members is 'Login de cada cliente no portal (criado por admin/equipe.mjs). Um login vê só o próprio cliente.';
create index client_members_client_id_idx on public.client_members (client_id);

alter table public.client_members enable row level security;
revoke all on public.client_members from anon;
revoke insert, update, delete on public.client_members from authenticated;
-- A equipe vê quem tem acesso (para mostrar no painel); só a chave secreta cria ou remove
create policy "Equipe da agência vê os acessos dos clientes" on public.client_members
  for select to authenticated
  using ((select private.is_agency_member()));

-- 3. Portas do portal ---------------------------------------------------------
-- Cliente logado: nome e segmento (nada de contato ou observações internas)
create function public.portal_profile()
returns table (client_id uuid, name text, segment text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.segment
  from public.client_members m
  join public.clients c on c.id = m.client_id
  where m.user_id = (select auth.uid())
    and c.active
$$;

-- Conteúdos do cliente logado num período (até 62 dias), só os liberados para ele
create function public.portal_contents(p_from date, p_to date)
returns table (
  id uuid, title text, scheduled_date date, scheduled_time time, network text, format text,
  media_url text, media_kind text, caption text, client_notes text, status text,
  version integer, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select ct.id, ct.title, ct.scheduled_date, ct.scheduled_time, ct.network, ct.format,
         ct.media_url, ct.media_kind, ct.caption, ct.client_notes, ct.status,
         ct.version, ct.updated_at
  from public.contents ct
  join public.client_members m on m.client_id = ct.client_id and m.user_id = (select auth.uid())
  join public.clients c on c.id = ct.client_id and c.active
  where ct.status in ('aguardando_aprovacao', 'aprovado', 'publicado')
    and ct.scheduled_date between p_from and p_to
    and p_to - p_from between 0 and 62
  order by ct.scheduled_date, ct.scheduled_time nulls last, ct.created_at
$$;

revoke all on function public.portal_profile() from public, anon;
revoke all on function public.portal_contents(date, date) from public, anon;
grant execute on function public.portal_profile() to authenticated;
grant execute on function public.portal_contents(date, date) to authenticated;
