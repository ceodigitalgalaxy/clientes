-- =============================================================================
-- Equipe: perfis (administrador e colaborador), clientes por pessoa,
-- permissões no BANCO e conteúdo como tarefa (responsáveis, prazo interno,
-- prioridade e histórico).
-- -----------------------------------------------------------------------------
-- Perfis (agency_members.role):
--   admin        tudo: clientes, equipe, conteúdos, aprovações, exclusões.
--   colaborador  só os clientes liberados (all_clients ou agency_member_clients);
--                edit_scope 'todos' = cria e edita qualquer conteúdo desses
--                clientes; 'atribuidos' = edita só as demandas em que é
--                responsável; can_send_approval = monta lotes, gera links e
--                muda status de aprovação. Nunca apaga conteúdo, cliente ou
--                lote, nem mexe na equipe ou nos logins de cliente.
--   active=false bloqueia tudo na hora (e a função "equipe" bane o login).
-- Quem já era da equipe vira administrador.
--
-- Tudo isso vale no banco (RLS, funções e gatilhos), não só nos botões.
-- Contas novas da equipe: só pela função "equipe" (chave secreta no servidor).
-- =============================================================================

-- 1. Perfis -----------------------------------------------------------------------
alter table public.agency_members
  add column role              text not null default 'admin' check (role in ('admin', 'colaborador')),
  add column name              text check (char_length(name) <= 80),
  add column email             text check (email is null or (char_length(email) <= 160 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  add column job_title         text check (char_length(job_title) <= 60),
  add column active            boolean not null default true,
  add column all_clients       boolean not null default true,
  add column edit_scope        text not null default 'todos' check (edit_scope in ('todos', 'atribuidos')),
  add column can_send_approval boolean not null default true,
  add column updated_at        timestamptz not null default now();
comment on column public.agency_members.role is 'admin (tudo) ou colaborador (clientes liberados e permissões abaixo).';
comment on column public.agency_members.email is 'E-mail de contato (o login é pelo nome de usuário).';
comment on column public.agency_members.edit_scope is 'todos: edita qualquer conteúdo dos clientes liberados; atribuidos: só as próprias demandas.';

create table public.agency_member_clients (
  user_id    uuid not null references public.agency_members (user_id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
comment on table public.agency_member_clients is 'Clientes liberados para o colaborador (quando all_clients = false).';
create index agency_member_clients_client_idx on public.agency_member_clients (client_id);

-- 2. Conteúdo como tarefa -----------------------------------------------------------
alter table public.contents
  add column due_date date,
  add column priority text not null default 'media' check (priority in ('baixa', 'media', 'alta', 'urgente'));
comment on column public.contents.due_date is 'Prazo interno de entrega (diferente da data de publicação).';
comment on column public.contents.priority is 'Prioridade da demanda: baixa, media, alta, urgente.';
create index contents_due_date_idx on public.contents (due_date);

create table public.content_assignees (
  content_id  uuid not null references public.contents (id) on delete cascade,
  user_id     uuid not null references public.agency_members (user_id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (content_id, user_id)
);
comment on table public.content_assignees is 'Responsáveis pela demanda (pode haver mais de um).';
create index content_assignees_user_idx on public.content_assignees (user_id);

create table public.content_events (
  id         uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents (id) on delete cascade,
  event_type text not null check (event_type in ('criado', 'responsavel_adicionado', 'responsavel_removido', 'producao', 'prazo', 'prioridade', 'ideia', 'final')),
  actor_id   uuid references auth.users (id) on delete set null,
  actor_name text,
  from_value text,
  to_value   text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.content_events is 'Histórico da demanda: quem criou, atribuiu, mudou prazo, prioridade, produção e aprovação.';
create index content_events_content_idx on public.content_events (content_id, created_at desc);

-- 3. Quem pode o quê ----------------------------------------------------------------
create or replace function private.is_agency_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members where user_id = (select auth.uid()) and active);
$$;
create function private.is_agency_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members where user_id = (select auth.uid()) and active and role = 'admin');
$$;
create function private.user_sees_client(p_user uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members m
                  where m.user_id = p_user and m.active
                    and (m.role = 'admin' or m.all_clients
                         or exists (select 1 from public.agency_member_clients x where x.user_id = m.user_id and x.client_id = p_client)));
$$;
create function private.member_sees_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_sees_client((select auth.uid()), p_client);
$$;
create function private.member_edits_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members m
                  where m.user_id = (select auth.uid()) and m.active
                    and (m.role = 'admin' or (m.edit_scope = 'todos' and private.user_sees_client(m.user_id, p_client))));
$$;
create function private.member_sends(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members m
                  where m.user_id = (select auth.uid()) and m.active
                    and (m.role = 'admin' or (m.can_send_approval and private.user_sees_client(m.user_id, p_client))));
$$;
create function private.is_assignee(p_content uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.content_assignees where content_id = p_content and user_id = (select auth.uid()));
$$;
create function private.content_client(p_content uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select client_id from public.contents where id = p_content;
$$;
create function private.member_sees_content(p_content uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.member_sees_client(private.content_client(p_content));
$$;
create function private.member_edits_content(p_content uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contents c
                  where c.id = p_content
                    and (private.member_edits_client(c.client_id)
                         or (private.member_sees_client(c.client_id) and private.is_assignee(c.id))));
$$;
create function private.member_sees_batch(p_batch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.member_sees_client((select client_id from public.approval_batches where id = p_batch));
$$;
create function private.ad_client(p_ad uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select client_id from public.ads where id = p_ad;
$$;
-- Pasta do arquivo: <cliente>/<conteúdo ou anúncio>/<arquivo>
create function private.path_uuid(p_name text, p_part integer) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', p_part) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then split_part(p_name, '/', p_part)::uuid end;
$$;
create function private.member_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(name), '') from public.agency_members where user_id = p_user), private.username_of(p_user));
$$;

-- Lotes e anúncios: confere cliente e permissão (usado pelas funções da equipe)
create function private.assert_batch(p_batch uuid, p_need text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_client uuid;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  select client_id into v_client from public.approval_batches where id = p_batch;
  if not found then return; end if;   -- a própria função avisa "lote não encontrado"
  if not private.member_sees_client(v_client) then raise exception 'sem_permissao'; end if;
  if p_need = 'enviar' and not private.member_sends(v_client) then raise exception 'sem_permissao'; end if;
  if p_need = 'admin' and not private.is_agency_admin() then raise exception 'sem_permissao'; end if;
end $$;
create function private.assert_ad(p_ad uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_client uuid;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  v_client := private.ad_client(p_ad);
  if v_client is not null and not private.member_sends(v_client) then raise exception 'sem_permissao'; end if;
end $$;

-- 4. Regras das tabelas (RLS) ---------------------------------------------------------
-- Clientes: todos veem os liberados; só administrador cria, edita e apaga
drop policy "Equipe da agência gerencia clientes" on public.clients;
create policy "Equipe vê os clientes liberados" on public.clients for select to authenticated using (private.member_sees_client(id));
create policy "Administrador cria clientes" on public.clients for insert to authenticated with check ((select private.is_agency_admin()));
create policy "Administrador edita clientes" on public.clients for update to authenticated using ((select private.is_agency_admin())) with check ((select private.is_agency_admin()));
create policy "Administrador apaga clientes" on public.clients for delete to authenticated using ((select private.is_agency_admin()));

-- Conteúdos
drop policy "Equipe da agência gerencia conteúdos" on public.contents;
create policy "Equipe vê conteúdos dos clientes liberados" on public.contents for select to authenticated using (private.member_sees_client(client_id));
create policy "Equipe cria conteúdos" on public.contents for insert to authenticated with check (private.member_edits_client(client_id));
create policy "Equipe edita conteúdos" on public.contents for update to authenticated
  using (private.member_edits_content(id))
  with check (private.member_edits_client(client_id) or (private.member_sees_client(client_id) and private.is_assignee(id)));
create policy "Administrador apaga conteúdos" on public.contents for delete to authenticated using ((select private.is_agency_admin()));

-- Arquivos do conteúdo
drop policy "Equipe da agência gerencia a arte final" on public.content_assets;
create policy "Equipe vê arquivos" on public.content_assets for select to authenticated using (private.member_sees_content(content_id));
create policy "Equipe envia arquivos" on public.content_assets for insert to authenticated with check (private.member_edits_content(content_id));
create policy "Equipe altera arquivos" on public.content_assets for update to authenticated using (private.member_edits_content(content_id)) with check (private.member_edits_content(content_id));
create policy "Equipe apaga arquivos" on public.content_assets for delete to authenticated using (private.member_edits_content(content_id));

drop policy "Equipe da agência vê as aprovações" on public.content_approvals;
create policy "Equipe vê as aprovações" on public.content_approvals for select to authenticated using (private.member_sees_content(content_id));
drop policy "Equipe lê versões" on public.content_versions;
create policy "Equipe lê versões" on public.content_versions for select to authenticated using (private.member_sees_client(client_id));

-- Central de aprovação
drop policy "Equipe lê lotes" on public.approval_batches;
drop policy "Equipe cria lotes" on public.approval_batches;
drop policy "Equipe edita lotes" on public.approval_batches;
drop policy "Equipe apaga lote nunca enviado" on public.approval_batches;
create policy "Equipe lê lotes" on public.approval_batches for select to authenticated using (private.member_sees_client(client_id));
create policy "Equipe cria lotes" on public.approval_batches for insert to authenticated with check (private.member_sends(client_id));
create policy "Equipe edita lotes" on public.approval_batches for update to authenticated using (private.member_sends(client_id)) with check (private.member_sends(client_id));
create policy "Administrador apaga lote nunca enviado" on public.approval_batches for delete to authenticated using ((select private.is_agency_admin()) and sent_at is null);
drop policy "Equipe lê itens" on public.approval_items;
create policy "Equipe lê itens" on public.approval_items for select to authenticated using (private.member_sees_batch(batch_id));
drop policy "Equipe lê links" on public.approval_links;
create policy "Equipe lê links" on public.approval_links for select to authenticated using (private.member_sees_batch(batch_id));
drop policy "Equipe lê decisões" on public.approval_decisions;
create policy "Equipe lê decisões" on public.approval_decisions for select to authenticated using (private.member_sees_batch(batch_id));
drop policy "Equipe lê eventos" on public.approval_events;
create policy "Equipe lê eventos" on public.approval_events for select to authenticated using (private.member_sees_batch(batch_id));

-- Anúncios
drop policy "Equipe da agência gerencia anúncios" on public.ads;
create policy "Equipe vê anúncios" on public.ads for select to authenticated using (private.member_sees_client(client_id));
create policy "Equipe cria anúncios" on public.ads for insert to authenticated with check (private.member_edits_client(client_id));
create policy "Equipe edita anúncios" on public.ads for update to authenticated using (private.member_edits_client(client_id)) with check (private.member_edits_client(client_id));
create policy "Administrador apaga anúncios" on public.ads for delete to authenticated using ((select private.is_agency_admin()));
drop policy "Equipe da agência gerencia criativos" on public.ad_assets;
create policy "Equipe vê criativos" on public.ad_assets for select to authenticated using (private.member_sees_client(private.ad_client(ad_id)));
create policy "Equipe envia criativos" on public.ad_assets for insert to authenticated with check (private.member_edits_client(private.ad_client(ad_id)));
create policy "Equipe altera criativos" on public.ad_assets for update to authenticated using (private.member_edits_client(private.ad_client(ad_id))) with check (private.member_edits_client(private.ad_client(ad_id)));
create policy "Equipe apaga criativos" on public.ad_assets for delete to authenticated using (private.member_edits_client(private.ad_client(ad_id)));
drop policy "Equipe da agência vê versões" on public.ad_versions;
create policy "Equipe vê versões de anúncios" on public.ad_versions for select to authenticated using (private.member_sees_client(private.ad_client(ad_id)));
drop policy "Equipe da agência vê o histórico" on public.ad_events;
create policy "Equipe vê o histórico de anúncios" on public.ad_events for select to authenticated using (private.member_sees_client(private.ad_client(ad_id)));

-- Gerador de artes e logins de cliente
drop policy "Equipe gerencia a identidade das artes" on public.brand_kits;
create policy "Equipe vê a identidade das artes" on public.brand_kits for select to authenticated using (private.member_sees_client(client_id));
create policy "Equipe cria a identidade das artes" on public.brand_kits for insert to authenticated with check (private.member_edits_client(client_id));
create policy "Equipe altera a identidade das artes" on public.brand_kits for update to authenticated using (private.member_edits_client(client_id)) with check (private.member_edits_client(client_id));
create policy "Equipe apaga a identidade das artes" on public.brand_kits for delete to authenticated using (private.member_edits_client(client_id));
drop policy "Equipe da agência vê os acessos dos clientes" on public.client_members;
create policy "Administrador vê os acessos dos clientes" on public.client_members for select to authenticated using ((select private.is_agency_admin()));

-- Equipe: cada um vê o próprio cadastro; o administrador vê e edita todos
create policy "Administrador vê a equipe" on public.agency_members for select to authenticated using ((select private.is_agency_admin()));
create policy "Administrador edita a equipe" on public.agency_members for update to authenticated using ((select private.is_agency_admin())) with check ((select private.is_agency_admin()));
revoke insert, update, delete, truncate on public.agency_members from authenticated;
grant update (name, email, job_title, role, active, all_clients, edit_scope, can_send_approval) on public.agency_members to authenticated;
alter table public.agency_member_clients enable row level security;
revoke all on public.agency_member_clients from anon, authenticated;
grant select, insert, delete on public.agency_member_clients to authenticated;
create policy "Membro vê os próprios clientes" on public.agency_member_clients for select to authenticated using (user_id = (select auth.uid()) or (select private.is_agency_admin()));
create policy "Administrador libera clientes" on public.agency_member_clients for insert to authenticated with check ((select private.is_agency_admin()));
create policy "Administrador tira clientes" on public.agency_member_clients for delete to authenticated using ((select private.is_agency_admin()));

-- Responsáveis e histórico da demanda
alter table public.content_assignees enable row level security;
revoke all on public.content_assignees from anon, authenticated;
grant select, insert, delete on public.content_assignees to authenticated;
create policy "Equipe vê responsáveis" on public.content_assignees for select to authenticated using (private.member_sees_content(content_id));
create policy "Equipe atribui demandas" on public.content_assignees for insert to authenticated
  with check (private.member_edits_client(private.content_client(content_id)) and private.user_sees_client(user_id, private.content_client(content_id)));
create policy "Equipe retira responsáveis" on public.content_assignees for delete to authenticated using (private.member_edits_client(private.content_client(content_id)));
alter table public.content_events enable row level security;
revoke all on public.content_events from anon, authenticated;
grant select on public.content_events to authenticated;
create policy "Equipe vê o histórico da demanda" on public.content_events for select to authenticated using (private.member_sees_content(content_id));

-- Arquivos no armazenamento
drop policy "Equipe gerencia a arte final (arquivos)" on storage.objects;
create policy "Equipe vê arquivos de conteúdo" on storage.objects for select to authenticated
  using (bucket_id = 'content-media' and private.member_sees_client(private.path_uuid(name, 1)));
create policy "Equipe envia arquivos de conteúdo" on storage.objects for insert to authenticated
  with check (bucket_id = 'content-media' and private.member_edits_content(private.path_uuid(name, 2)) and private.content_client(private.path_uuid(name, 2)) = private.path_uuid(name, 1));
create policy "Equipe altera arquivos de conteúdo" on storage.objects for update to authenticated
  using (bucket_id = 'content-media' and private.member_edits_content(private.path_uuid(name, 2)))
  with check (bucket_id = 'content-media' and private.member_edits_content(private.path_uuid(name, 2)));
create policy "Equipe apaga arquivos de conteúdo" on storage.objects for delete to authenticated
  using (bucket_id = 'content-media' and private.member_edits_content(private.path_uuid(name, 2)));
drop policy "Equipe gerencia arquivos de anúncios" on storage.objects;
create policy "Equipe vê arquivos de anúncios" on storage.objects for select to authenticated
  using (bucket_id = 'ad-media' and private.member_sees_client(private.path_uuid(name, 1)));
create policy "Equipe envia arquivos de anúncios" on storage.objects for insert to authenticated
  with check (bucket_id = 'ad-media' and private.member_edits_client(private.path_uuid(name, 1)));
create policy "Equipe altera arquivos de anúncios" on storage.objects for update to authenticated
  using (bucket_id = 'ad-media' and private.member_edits_client(private.path_uuid(name, 1)))
  with check (bucket_id = 'ad-media' and private.member_edits_client(private.path_uuid(name, 1)));
create policy "Equipe apaga arquivos de anúncios" on storage.objects for delete to authenticated
  using (bucket_id = 'ad-media' and private.member_edits_client(private.path_uuid(name, 1)));
drop policy "Equipe envia fotos de clientes" on storage.objects;
drop policy "Equipe altera fotos de clientes" on storage.objects;
drop policy "Equipe apaga fotos de clientes" on storage.objects;
create policy "Administrador envia fotos de clientes" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-logos' and (select private.is_agency_admin()));
create policy "Administrador altera fotos de clientes" on storage.objects for update to authenticated
  using (bucket_id = 'client-logos' and (select private.is_agency_admin()));
create policy "Administrador apaga fotos de clientes" on storage.objects for delete to authenticated
  using (bucket_id = 'client-logos' and (select private.is_agency_admin()));

-- 5. Gatilhos ---------------------------------------------------------------------------
-- Status de aprovação: só quem pode enviar para aprovação (o cliente, pelo link, passa pela função)
create function public.contents_guard_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and private.is_agency_member() and not private.member_sends(new.client_id)
     and (case when tg_op = 'INSERT' then new.approval_status <> 'rascunho' or new.final_status <> 'rascunho'
               else (new.approval_status, new.final_status) is distinct from (old.approval_status, old.final_status) end) then
    raise exception 'sem_permissao_aprovacao';
  end if;
  return new;
end $$;
create trigger contents_b_guard_approval before insert or update on public.contents
  for each row execute function public.contents_guard_approval();

-- Histórico da demanda
create function private.content_event(p_content uuid, p_type text, p_from text, p_to text, p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.content_events (content_id, event_type, actor_id, actor_name, from_value, to_value, metadata)
  values (p_content, p_type, (select auth.uid()),
          coalesce(private.member_name((select auth.uid())), case when p_type in ('ideia', 'final') then 'Cliente (pelo link)' else 'Sistema' end),
          p_from, p_to, coalesce(p_meta, '{}'::jsonb));
$$;
create function public.contents_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.content_event(new.id, 'criado', null, null);
    return new;
  end if;
  if new.production_status is distinct from old.production_status then perform private.content_event(new.id, 'producao', old.production_status, new.production_status); end if;
  if new.due_date is distinct from old.due_date then perform private.content_event(new.id, 'prazo', old.due_date::text, new.due_date::text); end if;
  if new.priority is distinct from old.priority then perform private.content_event(new.id, 'prioridade', old.priority, new.priority); end if;
  if new.approval_status is distinct from old.approval_status then perform private.content_event(new.id, 'ideia', old.approval_status, new.approval_status); end if;
  if new.final_status is distinct from old.final_status then perform private.content_event(new.id, 'final', old.final_status, new.final_status); end if;
  return new;
end $$;
create trigger contents_z_log after insert or update on public.contents
  for each row execute function public.contents_log();
create function public.content_assignees_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.content_event(new.content_id, 'responsavel_adicionado', null, new.user_id::text, jsonb_build_object('name', private.member_name(new.user_id)));
    return new;
  end if;
  if exists (select 1 from public.contents where id = old.content_id) then
    perform private.content_event(old.content_id, 'responsavel_removido', old.user_id::text, null, jsonb_build_object('name', private.member_name(old.user_id)));
  end if;
  return old;
end $$;
create trigger content_assignees_log after insert or delete on public.content_assignees
  for each row execute function public.content_assignees_log();

-- Equipe: não deixar a agência sem administrador ativo (nem tirar o próprio acesso)
create function public.agency_members_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.user_id = (select auth.uid()) and (new.role <> 'admin' or not new.active) then raise exception 'nao_pode_proprio_acesso'; end if;
  if (old.role = 'admin' and old.active) and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.agency_members where user_id <> old.user_id and role = 'admin' and active) then
    raise exception 'ultimo_admin';
  end if;
  return new;
end $$;
create trigger agency_members_guard before update on public.agency_members
  for each row execute function public.agency_members_guard();

-- 6. Funções da equipe passam a conferir cliente e permissão ------------------------------
-- Troca a conferência "é da equipe" pela conferência do lote (cliente + permissão)
do $migra$
declare
  v_fn record; v_src text;
  v_old constant text := 'if not private.is_agency_member() then raise exception ''sem_permissao''; end if;';
begin
  for v_fn in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('approval_set_items', 'approval_publish', 'approval_resend', 'approval_link_regenerate',
                                                  'approval_link_revoke', 'approval_link_token', 'approval_preview', 'approval_batch_delete', 'ad_transition')
  loop
    v_src := pg_get_functiondef(v_fn.oid);
    if position(v_old in v_src) = 0 then raise exception 'conferencia nao encontrada em %', v_fn.proname; end if;
    v_src := replace(v_src, v_old, case
      when v_fn.proname = 'ad_transition' then 'perform private.assert_ad(p_ad_id);'
      when v_fn.proname in ('approval_link_token', 'approval_preview') then 'perform private.assert_batch(p_batch, ''ver'');'
      when v_fn.proname = 'approval_batch_delete' then 'perform private.assert_batch(p_batch, ''admin'');'
      else 'perform private.assert_batch(p_batch, ''enviar'');' end);
    execute v_src;
  end loop;
end $migra$;

create or replace function public.approval_mark_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  update public.approval_events set read_at = now()
   where read_at is null and private.member_sees_batch(batch_id) and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.approval_stale(p_batch uuid default null, p_content uuid default null)
returns table (item_id uuid, batch_id uuid, content_id uuid, mode text, stale boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.batch_id, i.content_id, b.approval_mode,
         v.snapshot is not null and private.approval_view(v.snapshot, b.approval_mode)
           is distinct from private.approval_view(private.content_snapshot(i.content_id), b.approval_mode)
    from public.approval_items i
    join public.approval_batches b on b.id = i.batch_id
    left join public.content_versions v on v.id = i.version_id
   where private.member_sees_client(b.client_id)
     and i.removed_at is null and i.content_id is not null
     and (p_batch is null or i.batch_id = p_batch)
     and (p_content is null or i.content_id = p_content)
     and (p_batch is not null or p_content is not null)
$$;

-- 7. Quem é quem (para escolher responsáveis) e o meu perfil ------------------------------
create function public.team_directory()
returns table (user_id uuid, username text, name text, job_title text, role text, active boolean,
               all_clients boolean, client_ids uuid[], edit_scope text, can_send_approval boolean, email text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, private.username_of(m.user_id), m.name, m.job_title, m.role, m.active,
         m.all_clients, coalesce((select array_agg(x.client_id) from public.agency_member_clients x where x.user_id = m.user_id), '{}'),
         m.edit_scope, m.can_send_approval,
         case when private.is_agency_admin() then m.email end
    from public.agency_members m
   where private.is_agency_member() and (m.active or private.is_agency_admin())
   order by m.active desc, coalesce(nullif(m.name, ''), private.username_of(m.user_id))
$$;

-- 8. Permissões das funções novas ---------------------------------------------------------
revoke all on function private.is_agency_admin(), private.user_sees_client(uuid, uuid), private.member_sees_client(uuid),
  private.member_edits_client(uuid), private.member_sends(uuid), private.is_assignee(uuid), private.content_client(uuid),
  private.member_sees_content(uuid), private.member_edits_content(uuid), private.member_sees_batch(uuid), private.ad_client(uuid),
  private.path_uuid(text, integer), private.member_name(uuid), private.assert_batch(uuid, text), private.assert_ad(uuid),
  private.content_event(uuid, text, text, text, jsonb) from public, anon;
-- Usadas nas regras (RLS) e nos gatilhos, que rodam como quem está logado
grant execute on function private.is_agency_admin(), private.user_sees_client(uuid, uuid), private.member_sees_client(uuid),
  private.member_edits_client(uuid), private.member_sends(uuid), private.is_assignee(uuid), private.content_client(uuid),
  private.member_sees_content(uuid), private.member_edits_content(uuid), private.member_sees_batch(uuid), private.ad_client(uuid),
  private.path_uuid(text, integer) to authenticated;
revoke all on function public.contents_guard_approval(), public.contents_log(), public.content_assignees_log(), public.agency_members_guard()
  from public, anon, authenticated;
revoke all on function public.team_directory() from public, anon;
grant execute on function public.team_directory() to authenticated;
