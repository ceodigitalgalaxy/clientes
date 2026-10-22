-- ============================================================================
-- Arte final, aprovação do cliente e foto do cliente
-- ----------------------------------------------------------------------------
-- 1. Status "ajustes" (o cliente pediu ajuste).
-- 2. clients.logo_path: foto/logo do cliente no bucket público client-logos.
-- 3. content_assets: arte final de cada conteúdo (arquivos no bucket PRIVADO
--    content-media ou links), em ordem (carrossel). Mudou a arte, sobe a versão.
-- 4. content_approvals: histórico de decisões do cliente, por versão.
-- 5. Portas do portal: portal_client(), portal_calendar(p_from, p_to) e
--    portal_decide(...). Descobrem o cliente pela sessão; nenhuma recebe id de
--    cliente. O cliente só decide sobre a versão ATUAL de um conteúdo dele que
--    esteja aguardando aprovação.
-- 6. Storage: equipe envia e apaga; cliente só lê (link assinado) a arte final
--    dos próprios conteúdos já liberados.
-- ============================================================================

-- 1. Status "Ajustes solicitados" ---------------------------------------------
alter table public.contents drop constraint contents_status_check;
alter table public.contents add constraint contents_status_check
  check (status in ('planejado', 'em_producao', 'aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado'));

create or replace view public.client_calendar_items with (security_invoker = true) as
  select id, client_id, title, scheduled_date, scheduled_time, network, format,
         media_url, media_kind, caption, status, version, updated_at, client_notes
  from public.contents
  where status in ('aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado');

-- 2. Foto do cliente ----------------------------------------------------------
alter table public.clients
  add column logo_path text check (logo_path is null or (char_length(logo_path) <= 300 and logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$'));
comment on column public.clients.logo_path is 'Foto/logo do cliente no bucket client-logos (<client_id>/<arquivo>).';

-- 3. Arte final ---------------------------------------------------------------
-- Marca de mudança na arte: entra na conta da versão do conteúdo
alter table public.contents add column assets_changed_at timestamptz;

create or replace function public.bump_content_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title, new.scheduled_date, new.scheduled_time, new.network, new.format, new.media_url, new.media_kind, new.caption, new.client_notes, new.assets_changed_at)
     is distinct from
     (old.title, old.scheduled_date, old.scheduled_time, old.network, old.format, old.media_url, old.media_kind, old.caption, old.client_notes, old.assets_changed_at) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

create table public.content_assets (
  id           uuid primary key default gen_random_uuid(),
  content_id   uuid not null references public.contents (id) on delete cascade,
  kind         text not null check (kind in ('image', 'video')),
  storage_path text check (storage_path is null or (char_length(storage_path) <= 400 and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$')),
  url          text check (url is null or (url ~* '^https?://' and char_length(url) <= 2000)),
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  check ((storage_path is null) <> (url is null))
);
comment on table public.content_assets is 'Arte final do conteúdo (arquivo no bucket content-media ou link), na ordem do carrossel.';
create index content_assets_content_idx on public.content_assets (content_id, position);

create function public.touch_content_assets() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.contents set assets_changed_at = clock_timestamp()
  where id = coalesce(new.content_id, old.content_id);
  return null;
end $$;
create trigger content_assets_version after insert or update or delete on public.content_assets
  for each row execute function public.touch_content_assets();

alter table public.content_assets enable row level security;
revoke all on public.content_assets from anon;
create policy "Equipe da agência gerencia a arte final" on public.content_assets
  for all to authenticated
  using ((select private.is_agency_member())) with check ((select private.is_agency_member()));

-- 4. Aprovações ---------------------------------------------------------------
create table public.content_approvals (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents (id) on delete cascade,
  version    integer not null,
  decision   text not null check (decision in ('aprovado', 'ajustes')),
  message    text check (message is null or char_length(message) <= 800),
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (decision = 'aprovado' or char_length(btrim(coalesce(message, ''))) >= 1)
);
comment on table public.content_approvals is 'Decisões do cliente (aprovar ou pedir ajuste) sobre uma versão do conteúdo.';
create index content_approvals_content_idx on public.content_approvals (content_id, created_at desc);

alter table public.content_approvals enable row level security;
revoke all on public.content_approvals from anon;
revoke insert, update, delete on public.content_approvals from authenticated;
create policy "Equipe da agência vê as aprovações" on public.content_approvals
  for select to authenticated
  using ((select private.is_agency_member()));

-- 5. Portas do portal ---------------------------------------------------------
create function public.portal_client()
returns table (client_id uuid, name text, segment text, logo_path text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.segment, c.logo_path
  from public.client_members m
  join public.clients c on c.id = m.client_id
  where m.user_id = (select auth.uid()) and c.active
$$;

create function public.portal_calendar(p_from date, p_to date)
returns table (
  id uuid, title text, scheduled_date date, scheduled_time time, network text, format text,
  media_url text, media_kind text, caption text, client_notes text, status text,
  version integer, updated_at timestamptz, assets jsonb, decision jsonb
)
language sql stable security definer set search_path = '' as $$
  select ct.id, ct.title, ct.scheduled_date, ct.scheduled_time, ct.network, ct.format,
         ct.media_url, ct.media_kind, ct.caption, ct.client_notes, ct.status,
         ct.version, ct.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'storage_path', a.storage_path, 'url', a.url) order by a.position, a.created_at)
                   from public.content_assets a where a.content_id = ct.id), '[]'::jsonb),
         (select jsonb_build_object('decision', ap.decision, 'message', ap.message, 'version', ap.version, 'created_at', ap.created_at)
            from public.content_approvals ap
           where ap.content_id = ct.id and ap.version = ct.version
           order by ap.created_at desc limit 1)
  from public.contents ct
  join public.client_members m on m.client_id = ct.client_id and m.user_id = (select auth.uid())
  join public.clients c on c.id = ct.client_id and c.active
  where ct.status in ('aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado')
    and ct.scheduled_date between p_from and p_to
    and p_to - p_from between 0 and 62
  order by ct.scheduled_date, ct.scheduled_time nulls last, ct.created_at
$$;

-- Aprovar ou pedir ajuste: só a versão atual, só se estiver aguardando aprovação
create function public.portal_decide(p_content_id uuid, p_version integer, p_decision text, p_message text default null)
returns table (new_status text, new_version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_version integer;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if p_decision not in ('aprovado', 'ajustes') then raise exception 'decisao_invalida'; end if;
  if p_decision = 'ajustes' and v_message is null then raise exception 'mensagem_obrigatoria'; end if;
  if v_message is not null and char_length(v_message) > 800 then raise exception 'mensagem_longa'; end if;

  select ct.status, ct.version into v_status, v_version
  from public.contents ct
  join public.client_members m on m.client_id = ct.client_id and m.user_id = (select auth.uid())
  join public.clients c on c.id = ct.client_id and c.active
  where ct.id = p_content_id
  for update of ct;

  if not found then raise exception 'conteudo_nao_encontrado'; end if;
  if v_status <> 'aguardando_aprovacao' then raise exception 'nao_aguarda_aprovacao'; end if;
  if v_version <> p_version then raise exception 'versao_desatualizada'; end if;

  insert into public.content_approvals (content_id, version, decision, message, user_id)
  values (p_content_id, v_version, p_decision, v_message, (select auth.uid()));

  update public.contents set status = case p_decision when 'aprovado' then 'aprovado' else 'ajustes' end
  where id = p_content_id;

  return query select case p_decision when 'aprovado' then 'aprovado' else 'ajustes' end, v_version;
end $$;

revoke all on function public.portal_client() from public, anon;
revoke all on function public.portal_calendar(date, date) from public, anon;
revoke all on function public.portal_decide(uuid, integer, text, text) from public, anon;
grant execute on function public.portal_client() to authenticated;
grant execute on function public.portal_calendar(date, date) to authenticated;
grant execute on function public.portal_decide(uuid, integer, text, text) to authenticated;

-- 6. Armazenamento de arquivos ------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('client-logos', 'client-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('content-media', 'content-media', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

-- O cliente lê um arquivo da arte final só se for de um conteúdo liberado do cliente dele
create function private.client_can_read_media(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.content_assets a
    join public.contents ct on ct.id = a.content_id
    join public.client_members m on m.client_id = ct.client_id and m.user_id = (select auth.uid())
    join public.clients c on c.id = ct.client_id and c.active
    where a.storage_path = p_name
      and ct.status in ('aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado')
  )
$$;
revoke all on function private.client_can_read_media(text) from public, anon;
grant execute on function private.client_can_read_media(text) to authenticated;

create policy "Equipe envia fotos de clientes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-logos' and (select private.is_agency_member()));
create policy "Equipe altera fotos de clientes" on storage.objects
  for update to authenticated
  using (bucket_id = 'client-logos' and (select private.is_agency_member()));
create policy "Equipe apaga fotos de clientes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-logos' and (select private.is_agency_member()));
create policy "Equipe vê fotos de clientes" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-logos' and (select private.is_agency_member()));

create policy "Equipe gerencia a arte final (arquivos)" on storage.objects
  for all to authenticated
  using (bucket_id = 'content-media' and (select private.is_agency_member()))
  with check (bucket_id = 'content-media' and (select private.is_agency_member()));
create policy "Cliente vê a arte final liberada" on storage.objects
  for select to authenticated
  using (bucket_id = 'content-media' and private.client_can_read_media(name));
