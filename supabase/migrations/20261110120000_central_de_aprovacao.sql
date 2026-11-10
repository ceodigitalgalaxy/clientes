-- ============================================================================
-- Central de Aprovação de Conteúdos com link público
-- ----------------------------------------------------------------------------
-- A agência monta um LOTE (planejamento do mês ou etapa de arte final) com
-- conteúdos de um cliente, envia (cada conteúdo vira uma VERSÃO congelada) e
-- gera um LINK. O cliente abre o link sem login e aprova ou pede ajuste.
--
-- Segurança do link (acessível sem login):
--   * token de 32 bytes aleatórios (gen_random_bytes), 43 caracteres base64url;
--   * o banco guarda só o SHA-256 do token para conferir; o token em si fica
--     cifrado no Supabase Vault, só para a equipe copiar de novo;
--   * a página pública fala só com a função "aprovacao" (Edge Function), que
--     chama as funções approval_public_* com a chave secreta (service_role):
--     anon e authenticated NÃO executam essas funções;
--   * o link vale só para o lote dele; expira, é desativado ou regenerado;
--   * limite de tentativas por IP e por link (private.approval_hits);
--   * o cliente vê a cópia congelada da versão enviada, nunca a referência
--     interna, as observações internas nem rascunhos.
--
-- Status separados:
--   approval_status   rascunho | aguardando_aprovacao | aprovado | ajustes | reenviado
--   production_status em_producao | pronto_para_agendar | agendado | publicado (ou vazio)
--   A coluna antiga "status" continua existindo, calculada a partir dos dois
--   (e vice-versa, se algo antigo gravar só ela), para o calendário e o portal
--   seguirem funcionando sem mudança.
-- ============================================================================

-- 1. Conteúdo: campos novos e status separados --------------------------------
alter table public.contents
  add column pillar            text check (char_length(pillar) <= 80),
  add column cta               text check (char_length(cta) <= 200),
  add column approval_status   text not null default 'rascunho'
    check (approval_status in ('rascunho', 'aguardando_aprovacao', 'aprovado', 'ajustes', 'reenviado')),
  add column production_status text
    check (production_status in ('em_producao', 'pronto_para_agendar', 'agendado', 'publicado'));
comment on column public.contents.pillar is 'Pilar editorial (o cliente vê).';
comment on column public.contents.cta is 'Chamada para ação (o cliente vê).';
comment on column public.contents.content_plan is 'Roteiro / como vai ser: cenas, slides ou o que aparece (o cliente vê).';
comment on column public.contents.approval_status is 'Aprovação: rascunho, aguardando_aprovacao, aprovado, ajustes, reenviado.';
comment on column public.contents.production_status is 'Produção: em_producao, pronto_para_agendar, agendado, publicado.';

alter table public.contents drop constraint contents_network_check;
alter table public.contents add constraint contents_network_check
  check (network in ('instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'google', 'whatsapp', 'outra'));

-- Status antigo → par (aprovação, produção), preservando a produção quando cabe
create function private.content_pair_from_status(p_status text, p_approval text, p_production text,
  out approval text, out production text)
language sql immutable set search_path = '' as $$
  select
    case p_status
      when 'planejado' then 'rascunho'
      when 'em_producao' then 'rascunho'
      when 'aguardando_aprovacao' then case when p_approval = 'reenviado' then 'reenviado' else 'aguardando_aprovacao' end
      when 'ajustes' then 'ajustes'
      when 'aprovado' then 'aprovado'
      when 'publicado' then 'aprovado'
      else coalesce(p_approval, 'rascunho')
    end,
    case p_status
      when 'publicado' then 'publicado'
      when 'em_producao' then case when p_production in ('em_producao', 'pronto_para_agendar', 'agendado') then p_production else 'em_producao' end
      when 'planejado' then null
      else case when p_production = 'publicado' then null else p_production end
    end
$$;

-- Par (aprovação, produção) → status antigo (o que o calendário e o portal leem)
create function private.content_status_from_pair(p_approval text, p_production text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_production = 'publicado' then 'publicado'
    when p_approval in ('aguardando_aprovacao', 'reenviado') then 'aguardando_aprovacao'
    when p_approval = 'ajustes' then 'ajustes'
    when p_approval = 'aprovado' then 'aprovado'
    when p_production is not null then 'em_producao'
    else 'planejado'
  end
$$;

update public.contents
   set (approval_status, production_status) = (select p.approval, p.production from private.content_pair_from_status(status, null, null) p);

create function public.sync_content_status() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_pair record;
begin
  if tg_op = 'INSERT' then
    if new.approval_status = 'rascunho' and new.production_status is null and new.status <> 'planejado' then
      select * into v_pair from private.content_pair_from_status(new.status, null, null);
      new.approval_status := v_pair.approval; new.production_status := v_pair.production;
    end if;
  elsif (new.approval_status, new.production_status) is distinct from (old.approval_status, old.production_status) then
    null;  -- os campos novos mandam
  elsif new.status is distinct from old.status then
    select * into v_pair from private.content_pair_from_status(new.status, old.approval_status, old.production_status);
    new.approval_status := v_pair.approval; new.production_status := v_pair.production;
  end if;
  new.status := private.content_status_from_pair(new.approval_status, new.production_status);
  return new;
end $$;
create trigger contents_a_status before insert or update on public.contents
  for each row execute function public.sync_content_status();

-- A versão sobe quando muda algo que o cliente vê (agora com pilar e CTA)
create or replace function public.bump_content_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title, new.scheduled_date, new.scheduled_time, new.network, new.format, new.caption, new.client_notes,
      new.assets_changed_at, new.idea, new.content_plan, new.art_text, new.objective, new.pillar, new.cta)
     is distinct from
     (old.title, old.scheduled_date, old.scheduled_time, old.network, old.format, old.caption, old.client_notes,
      old.assets_changed_at, old.idea, old.content_plan, old.art_text, old.objective, old.pillar, old.cta) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

-- 2. Arquivos: capa, thumbnail de vídeo e PDF ------------------------------------
alter table public.content_assets drop constraint content_assets_kind_check;
alter table public.content_assets add constraint content_assets_kind_check check (kind in ('image', 'video', 'pdf'));
alter table public.content_assets
  add column role text not null default 'midia' check (role in ('midia', 'capa', 'thumbnail')),
  add column name text check (char_length(name) <= 160);
comment on column public.content_assets.role is 'midia (galeria/carrossel), capa ou thumbnail do vídeo.';
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf']
 where id = 'content-media';

-- 3. Versões congeladas -----------------------------------------------------------
create table public.content_versions (
  id              uuid primary key default gen_random_uuid(),
  content_id      uuid references public.contents (id) on delete set null,
  client_id       uuid not null references public.clients (id) on delete restrict,
  version_number  integer not null,
  content_version integer not null,   -- contents.version no momento do envio
  snapshot        jsonb not null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
comment on table public.content_versions is 'Cópia do conteúdo como foi enviado ao cliente (o que ele aprova).';
create unique index content_versions_number_idx on public.content_versions (content_id, version_number);
create index content_versions_client_idx on public.content_versions (client_id);

-- 4. Lotes, itens, links, decisões e eventos -------------------------------------
create table public.approval_batches (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete restrict,
  title            text not null check (char_length(btrim(title)) between 1 and 120),
  month            date not null check (extract(day from month) = 1),
  approval_mode    text not null default 'planejamento' check (approval_mode in ('planejamento', 'final')),
  intro_message    text check (char_length(intro_message) <= 1000),
  allow_individual boolean not null default true,
  allow_bulk       boolean not null default true,
  sent_at          timestamptz,
  last_client_action_at timestamptz,
  archived_at      timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (allow_individual or allow_bulk)
);
comment on table public.approval_batches is 'Lote de aprovação: planejamento do mês ou etapa de arte final de um cliente.';
create index approval_batches_client_idx on public.approval_batches (client_id, month desc);
create trigger approval_batches_touch before update on public.approval_batches
  for each row execute function public.touch_updated_at();

create table public.approval_items (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.approval_batches (id) on delete cascade,
  content_id    uuid references public.contents (id) on delete set null,
  version_id    uuid references public.content_versions (id) on delete restrict,
  display_order integer not null default 0,
  status        text not null default 'rascunho'
                check (status in ('rascunho', 'aguardando_aprovacao', 'aprovado', 'ajustes', 'reenviado')),
  decided_at    timestamptz,
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (status = 'rascunho' or version_id is not null)
);
comment on table public.approval_items is 'Conteúdos de um lote, cada um ligado à versão enviada.';
create unique index approval_items_active_idx on public.approval_items (batch_id, content_id) where removed_at is null;
create index approval_items_content_idx on public.approval_items (content_id);

create table public.approval_links (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.approval_batches (id) on delete cascade,
  token_hash     bytea not null unique,
  secret_id      uuid,                 -- token cifrado no Vault (só para copiar de novo)
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  revoked_reason text check (revoked_reason in ('desativado', 'regenerado')),
  last_used_at   timestamptz
);
comment on table public.approval_links is 'Links públicos de aprovação. Guarda só o hash do token.';
create unique index approval_links_active_idx on public.approval_links (batch_id) where revoked_at is null;

create table public.approval_decisions (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.approval_batches (id) on delete restrict,
  item_id       uuid not null references public.approval_items (id) on delete restrict,
  content_id    uuid references public.contents (id) on delete set null,
  version_id    uuid not null references public.content_versions (id) on delete restrict,
  link_id       uuid references public.approval_links (id) on delete set null,
  action        text not null check (action in ('aprovado', 'ajustes')),
  comment       text check (char_length(comment) <= 1000),
  reviewer_name text check (char_length(reviewer_name) <= 80),
  session_id    text check (char_length(session_id) <= 64),
  bulk          boolean not null default false,
  created_at    timestamptz not null default now(),
  check (action = 'aprovado' or char_length(btrim(coalesce(comment, ''))) >= 1),
  unique (item_id, version_id)          -- uma decisão por versão (cliques repetidos não duplicam)
);
comment on table public.approval_decisions is 'Decisões do cliente pelo link (por versão). Nunca apagadas.';
create index approval_decisions_batch_idx on public.approval_decisions (batch_id, created_at desc);

create table public.approval_events (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.approval_batches (id) on delete cascade,
  item_id         uuid references public.approval_items (id) on delete set null,
  content_id      uuid references public.contents (id) on delete set null,
  version_id      uuid references public.content_versions (id) on delete set null,
  event_type      text not null check (event_type in ('lote_criado', 'conteudo_adicionado', 'conteudo_removido', 'enviado', 'nova_versao',
                    'link_gerado', 'link_desativado', 'link_expirado', 'aprovado', 'ajustes', 'lote_aprovado')),
  actor_type      text not null check (actor_type in ('equipe', 'cliente', 'sistema')),
  actor_reference text check (char_length(actor_reference) <= 120),
  from_status     text,
  to_status       text,
  metadata        jsonb not null default '{}'::jsonb,
  read_at         timestamptz,          -- notificação interna lida pela equipe
  created_at      timestamptz not null default now()
);
comment on table public.approval_events is 'Histórico do lote e de cada conteúdo; eventos do cliente viram notificações internas.';
create index approval_events_batch_idx on public.approval_events (batch_id, created_at desc);
create index approval_events_unread_idx on public.approval_events (created_at desc) where read_at is null and actor_type <> 'equipe';

-- Limite de tentativas (por IP e por link)
create table private.approval_hits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

-- Resumo por lote (painel): contagens e status geral
create view public.approval_batch_summary with (security_invoker = true) as
select b.id, b.client_id, b.title, b.month, b.approval_mode, b.sent_at, b.last_client_action_at, b.archived_at,
       b.created_at, b.updated_at, b.intro_message, b.allow_individual, b.allow_bulk,
       count(i.id) filter (where i.removed_at is null) as total,
       count(i.id) filter (where i.removed_at is null and i.status = 'aprovado') as aprovados,
       count(i.id) filter (where i.removed_at is null and i.status in ('aguardando_aprovacao', 'reenviado')) as aguardando,
       count(i.id) filter (where i.removed_at is null and i.status = 'ajustes') as ajustes,
       count(i.id) filter (where i.removed_at is null and i.status = 'rascunho') as rascunhos,
       l.id as link_id, l.created_at as link_created_at, l.expires_at as link_expires_at, l.last_used_at as link_last_used_at,
       case
         when b.archived_at is not null then 'arquivado'
         when count(i.id) filter (where i.removed_at is null and i.status <> 'rascunho') = 0 then 'rascunho'
         when count(i.id) filter (where i.removed_at is null and i.status = 'ajustes') > 0 then 'com_ajustes'
         when count(i.id) filter (where i.removed_at is null and i.status = 'aprovado') = count(i.id) filter (where i.removed_at is null) then 'aprovado'
         when count(i.id) filter (where i.removed_at is null and i.status = 'aprovado') > 0 then 'parcial'
         else 'aguardando'
       end as overall_status
  from public.approval_batches b
  left join public.approval_items i on i.batch_id = b.id
  left join public.approval_links l on l.batch_id = b.id and l.revoked_at is null
 group by b.id, l.id;

-- 5. Acesso: só a equipe lê; mudanças sensíveis só pelas funções -----------------
alter table public.content_versions enable row level security;
alter table public.approval_batches enable row level security;
alter table public.approval_items enable row level security;
alter table public.approval_links enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.approval_events enable row level security;
revoke all on public.content_versions, public.approval_batches, public.approval_items, public.approval_links,
              public.approval_decisions, public.approval_events, public.approval_batch_summary from anon;
revoke all on private.approval_hits from public, anon, authenticated;

create policy "Equipe lê versões" on public.content_versions for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe lê lotes" on public.approval_batches for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe cria lotes" on public.approval_batches for insert to authenticated with check ((select private.is_agency_member()));
create policy "Equipe edita lotes" on public.approval_batches for update to authenticated
  using ((select private.is_agency_member())) with check ((select private.is_agency_member()));
create policy "Equipe apaga lote nunca enviado" on public.approval_batches for delete to authenticated
  using ((select private.is_agency_member()) and sent_at is null);
create policy "Equipe lê itens" on public.approval_items for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe lê links" on public.approval_links for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe lê decisões" on public.approval_decisions for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe lê eventos" on public.approval_events for select to authenticated using ((select private.is_agency_member()));
-- Colunas que a equipe pode mudar direto nos lotes (o resto só pelas funções)
revoke update on public.approval_batches from authenticated;
grant update (title, month, approval_mode, intro_message, allow_individual, allow_bulk, archived_at) on public.approval_batches to authenticated;
revoke insert on public.approval_batches from authenticated;
grant insert (client_id, title, month, approval_mode, intro_message, allow_individual, allow_bulk) on public.approval_batches to authenticated;

-- 6. Funções internas ----------------------------------------------------------------
-- Limite de tentativas: true se ainda cabe nesta janela
create function private.approval_rate_ok(p_bucket text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into private.approval_hits (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = private.approval_hits.hits + 1
  returning hits into v_hits;
  if random() < 0.02 then delete from private.approval_hits where window_start < now() - interval '1 day'; end if;
  return v_hits <= p_max;
end $$;

-- Cópia do conteúdo como o cliente vai ver (sem referência nem observações internas)
create function private.content_snapshot(p_content uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', c.title, 'scheduled_date', c.scheduled_date, 'scheduled_time', left(c.scheduled_time::text, 5),
    'network', c.network, 'format', c.format, 'pillar', c.pillar, 'objective', c.objective, 'idea', c.idea,
    'content_plan', c.content_plan, 'art_text', c.art_text, 'caption', c.caption, 'cta', c.cta, 'client_notes', c.client_notes,
    'assets', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'role', a.role, 'name', a.name, 'storage_path', a.storage_path, 'url', a.url)
                                         order by a.position, a.created_at)
                          from public.content_assets a where a.content_id = c.id), '[]'::jsonb))
  from public.contents c where c.id = p_content
$$;

-- Evento (com quem fez)
create function private.approval_event(p_batch uuid, p_type text, p_actor text, p_ref text,
  p_item uuid default null, p_content uuid default null, p_version uuid default null,
  p_from text default null, p_to text default null, p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.approval_events (batch_id, item_id, content_id, version_id, event_type, actor_type, actor_reference, from_status, to_status, metadata, read_at)
  values (p_batch, p_item, p_content, p_version, p_type, p_actor, left(p_ref, 120), p_from, p_to, coalesce(p_meta, '{}'::jsonb),
          case when p_actor = 'equipe' then now() end)
$$;

-- O lote como o cliente vê (p_preview: a equipe vendo antes de enviar)
create function private.approval_batch_json(p_batch uuid, p_link uuid, p_preview boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'batch', jsonb_build_object('id', b.id, 'title', b.title, 'month', to_char(b.month, 'YYYY-MM'), 'mode', b.approval_mode,
             'intro', b.intro_message, 'allow_individual', b.allow_individual, 'allow_bulk', b.allow_bulk,
             'expires_at', (select l.expires_at from public.approval_links l where l.id = p_link), 'preview', p_preview),
    'client', jsonb_build_object('name', c.name, 'logo_path', c.logo_path),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'status', i.status, 'version_id', i.version_id,
               'version_number', v.version_number,
               'content', coalesce(v.snapshot, case when p_preview then private.content_snapshot(i.content_id) end),
               'decision', (select jsonb_build_object('action', d.action, 'comment', d.comment, 'reviewer_name', d.reviewer_name, 'created_at', d.created_at, 'bulk', d.bulk)
                              from public.approval_decisions d where d.item_id = i.id and d.version_id = i.version_id),
               'previous_request', (select jsonb_build_object('comment', d.comment, 'reviewer_name', d.reviewer_name, 'created_at', d.created_at)
                                      from public.approval_decisions d
                                      where d.item_id = i.id and d.action = 'ajustes' and d.version_id is distinct from i.version_id
                                      order by d.created_at desc limit 1))
             order by i.display_order, i.created_at)
        from public.approval_items i
        left join public.content_versions v on v.id = i.version_id
       where i.batch_id = b.id and i.removed_at is null
         and (p_preview or (i.version_id is not null and i.status <> 'rascunho'))
         and (i.version_id is not null or i.content_id is not null)), '[]'::jsonb))
  from public.approval_batches b
  join public.clients c on c.id = b.client_id
  where b.id = p_batch
$$;

-- Link válido para o token? Devolve o link ou o motivo (sem exceção: o limite de
-- tentativas e o evento de link expirado precisam ficar gravados)
create function private.approval_link_check(p_token text, p_ip text, out link public.approval_links, out problem text)
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.approval_batches;
begin
  problem := null;
  if not private.approval_rate_ok('ip:' || coalesce(nullif(p_ip, ''), '?'), 120, 60) then problem := 'muitas_tentativas'; return; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,64}$' then
    if not private.approval_rate_ok('falha:' || coalesce(nullif(p_ip, ''), '?'), 20, 600) then problem := 'muitas_tentativas'; return; end if;
    problem := 'link_invalido'; return;
  end if;
  select * into link from public.approval_links l where l.token_hash = extensions.digest(p_token, 'sha256');
  if not found then
    if not private.approval_rate_ok('falha:' || coalesce(nullif(p_ip, ''), '?'), 20, 600) then problem := 'muitas_tentativas'; return; end if;
    problem := 'link_invalido'; return;
  end if;
  select * into v_batch from public.approval_batches where id = link.batch_id;
  if link.revoked_at is not null or v_batch.archived_at is not null then problem := 'link_desativado'; return; end if;
  if link.expires_at is not null and link.expires_at <= now() then
    if not exists (select 1 from public.approval_events e where e.batch_id = link.batch_id and e.event_type = 'link_expirado' and (e.metadata ->> 'link_id') = link.id::text) then
      perform private.approval_event(link.batch_id, 'link_expirado', 'sistema', null, p_meta => jsonb_build_object('link_id', link.id));
    end if;
    problem := 'link_expirado'; return;
  end if;
  update public.approval_links set last_used_at = now() where id = link.id;
end $$;

-- Aplica uma decisão do cliente (dentro da transação de quem chama)
create function private.approval_apply(p_link public.approval_links, p_item uuid, p_version uuid, p_action text,
  p_comment text, p_name text, p_session text, p_bulk boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.approval_items;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_action not in ('aprovado', 'ajustes') then return jsonb_build_object('error', 'acao_invalida'); end if;
  if p_action = 'ajustes' and v_comment is null then return jsonb_build_object('error', 'comentario_obrigatorio'); end if;
  if char_length(v_comment) > 1000 then return jsonb_build_object('error', 'comentario_longo'); end if;
  if char_length(v_name) > 80 then v_name := left(v_name, 80); end if;
  select * into v_item from public.approval_items
   where id = p_item and batch_id = p_link.batch_id and removed_at is null and status <> 'rascunho'
   for update;
  if not found then return jsonb_build_object('error', 'item_nao_encontrado'); end if;
  if v_item.version_id is distinct from p_version then return jsonb_build_object('error', 'versao_desatualizada', 'item', p_item); end if;
  if v_item.status not in ('aguardando_aprovacao', 'reenviado') then
    return jsonb_build_object('error', 'ja_decidido', 'item', p_item, 'status', v_item.status);
  end if;
  insert into public.approval_decisions (batch_id, item_id, content_id, version_id, link_id, action, comment, reviewer_name, session_id, bulk)
  values (p_link.batch_id, v_item.id, v_item.content_id, v_item.version_id, p_link.id, p_action, v_comment, v_name, left(p_session, 64), p_bulk);
  update public.approval_items set status = p_action, decided_at = now() where id = v_item.id;
  if v_item.content_id is not null then
    update public.contents set approval_status = p_action where id = v_item.content_id;
  end if;
  perform private.approval_event(p_link.batch_id, p_action, 'cliente', coalesce(v_name, 'Cliente (sem nome)'), v_item.id, v_item.content_id, v_item.version_id,
    v_item.status, p_action, jsonb_build_object('comment', v_comment, 'session', left(p_session, 64), 'link_id', p_link.id, 'bulk', p_bulk));
  return jsonb_build_object('ok', true, 'item', v_item.id, 'status', p_action);
end $$;

-- Depois de uma ação do cliente: data da última interação e "lote aprovado"
create function private.approval_after_client_action(p_batch uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_open integer; v_total integer;
begin
  update public.approval_batches set last_client_action_at = now() where id = p_batch;
  select count(*) filter (where status <> 'aprovado'), count(*) into v_open, v_total
    from public.approval_items where batch_id = p_batch and removed_at is null and status <> 'rascunho';
  if v_total > 0 and v_open = 0 and not exists (
       select 1 from public.approval_items where batch_id = p_batch and removed_at is null and status = 'rascunho') then
    perform private.approval_event(p_batch, 'lote_aprovado', 'cliente', coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Cliente (sem nome)'),
      p_meta => jsonb_build_object('total', v_total));
  end if;
end $$;

-- 7. Funções públicas (só a função "aprovacao", com a chave secreta) -------------
create function public.approval_public_view(p_token text, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from private.approval_link_check(p_token, p_ip);
  if v.problem is not null then return jsonb_build_object('error', v.problem); end if;
  return private.approval_batch_json((v.link).batch_id, (v.link).id);
end $$;

create function public.approval_public_decide(p_token text, p_ip text, p_item uuid, p_version uuid, p_action text,
  p_comment text default null, p_name text default null, p_session text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v record; v_result jsonb; v_allowed boolean;
begin
  select * into v from private.approval_link_check(p_token, p_ip);
  if v.problem is not null then return jsonb_build_object('error', v.problem); end if;
  if not private.approval_rate_ok('decisao:' || (v.link).id, 60, 60) then return jsonb_build_object('error', 'muitas_tentativas'); end if;
  select allow_individual into v_allowed from public.approval_batches where id = (v.link).batch_id;
  if not v_allowed then return jsonb_build_object('error', 'nao_permitido'); end if;
  v_result := private.approval_apply(v.link, p_item, p_version, p_action, p_comment, p_name, p_session, false);
  if v_result ? 'error' then return v_result || jsonb_build_object('view', private.approval_batch_json((v.link).batch_id, (v.link).id)); end if;
  perform private.approval_after_client_action((v.link).batch_id, p_name);
  return v_result || jsonb_build_object('view', private.approval_batch_json((v.link).batch_id, (v.link).id));
end $$;

-- Aprovar todos os pendentes que o cliente viu (cada um vira uma decisão)
create function public.approval_public_approve_all(p_token text, p_ip text, p_items jsonb,
  p_name text default null, p_session text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v record; v_allowed boolean; v_entry jsonb; v_res jsonb;
  v_ok jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
begin
  select * into v from private.approval_link_check(p_token, p_ip);
  if v.problem is not null then return jsonb_build_object('error', v.problem); end if;
  if not private.approval_rate_ok('decisao:' || (v.link).id, 60, 60) then return jsonb_build_object('error', 'muitas_tentativas'); end if;
  select allow_bulk into v_allowed from public.approval_batches where id = (v.link).batch_id;
  if not v_allowed then return jsonb_build_object('error', 'nao_permitido'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then
    return jsonb_build_object('error', 'nada_para_aprovar');
  end if;
  for v_entry in select * from jsonb_array_elements(p_items) loop
    begin
      v_res := private.approval_apply(v.link, (v_entry ->> 'item')::uuid, (v_entry ->> 'version')::uuid, 'aprovado', null, p_name, p_session, true);
    exception when invalid_text_representation then
      v_res := jsonb_build_object('error', 'item_nao_encontrado');
    end;
    if v_res ? 'error' then v_skipped := v_skipped || jsonb_build_array(v_res); else v_ok := v_ok || jsonb_build_array(v_res ->> 'item'); end if;
  end loop;
  if jsonb_array_length(v_ok) > 0 then perform private.approval_after_client_action((v.link).batch_id, p_name); end if;
  return jsonb_build_object('ok', true, 'approved', v_ok, 'skipped', v_skipped,
                            'view', private.approval_batch_json((v.link).batch_id, (v.link).id));
end $$;

-- 8. Funções da equipe ---------------------------------------------------------------
-- Conteúdos do lote, na ordem (adiciona, reordena e tira; tirar preserva o histórico)
create function public.approval_set_items(p_batch uuid, p_contents uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.approval_batches; v_user uuid := (select auth.uid()); v_item public.approval_items; v_id uuid; v_pos integer := 0;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  select * into v_batch from public.approval_batches where id = p_batch for update;
  if not found then raise exception 'lote_nao_encontrado'; end if;
  if v_batch.archived_at is not null then raise exception 'lote_arquivado'; end if;
  if coalesce(array_length(p_contents, 1), 0) > 200 then raise exception 'conteudos_demais'; end if;
  if exists (select 1 from unnest(coalesce(p_contents, '{}')) x left join public.contents c on c.id = x where c.id is null or c.client_id <> v_batch.client_id) then
    raise exception 'conteudo_de_outro_cliente';
  end if;
  for v_item in select * from public.approval_items where batch_id = p_batch and removed_at is null
                  and (content_id is null or not (content_id = any (coalesce(p_contents, '{}')))) loop
    update public.approval_items set removed_at = now() where id = v_item.id;
    perform private.approval_event(p_batch, 'conteudo_removido', 'equipe', private.username_of(v_user), v_item.id, v_item.content_id);
  end loop;
  foreach v_id in array coalesce(p_contents, '{}') loop
    v_pos := v_pos + 1;
    update public.approval_items set display_order = v_pos where batch_id = p_batch and content_id = v_id and removed_at is null;
    if not found then
      insert into public.approval_items (batch_id, content_id, display_order) values (p_batch, v_id, v_pos) returning * into v_item;
      perform private.approval_event(p_batch, 'conteudo_adicionado', 'equipe', private.username_of(v_user), v_item.id, v_id);
    end if;
  end loop;
end $$;

-- Envia (congela uma versão) os conteúdos novos, com ajustes ou alterados depois do envio
create function private.approval_send(p_batch uuid, p_items uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid()); v_item record; v_version uuid; v_number integer; v_to text; v_count integer := 0;
begin
  for v_item in
    select i.*, c.version as content_version, cv.content_version as sent_version, c.client_id as content_client
      from public.approval_items i
      join public.contents c on c.id = i.content_id
      left join public.content_versions cv on cv.id = i.version_id
     where i.batch_id = p_batch and i.removed_at is null
       and (p_items is null or i.id = any (p_items))
       and (i.version_id is null or i.status = 'ajustes' or cv.content_version < c.version)
     order by i.display_order
     for update of i
  loop
    select coalesce(max(version_number), 0) + 1 into v_number from public.content_versions where content_id = v_item.content_id;
    insert into public.content_versions (content_id, client_id, version_number, content_version, snapshot, created_by)
    values (v_item.content_id, v_item.content_client, v_number, v_item.content_version, private.content_snapshot(v_item.content_id), v_user)
    returning id into v_version;
    v_to := case when v_item.version_id is null then 'aguardando_aprovacao' else 'reenviado' end;
    update public.approval_items set version_id = v_version, status = v_to, decided_at = null where id = v_item.id;
    update public.contents set approval_status = v_to where id = v_item.content_id;
    perform private.approval_event(p_batch, case when v_to = 'reenviado' then 'nova_versao' else 'enviado' end, 'equipe', private.username_of(v_user),
      v_item.id, v_item.content_id, v_version, v_item.status, v_to, jsonb_build_object('version_number', v_number));
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then update public.approval_batches set sent_at = coalesce(sent_at, now()) where id = p_batch; end if;
  return v_count;
end $$;

create function private.approval_new_link(p_batch uuid, p_expires timestamptz, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid()); v_token text; v_link uuid := gen_random_uuid(); v_secret uuid; v_old public.approval_links;
begin
  for v_old in select * from public.approval_links where batch_id = p_batch and revoked_at is null for update loop
    update public.approval_links set revoked_at = now(), revoked_reason = p_reason where id = v_old.id;
    if v_old.secret_id is not null then delete from vault.secrets where id = v_old.secret_id; end if;
    perform private.approval_event(p_batch, 'link_desativado', 'equipe', private.username_of(v_user), p_meta => jsonb_build_object('link_id', v_old.id, 'motivo', p_reason));
  end loop;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_secret := vault.create_secret(v_token, 'aprovacao-' || v_link::text, 'Link público de aprovação (lote ' || p_batch::text || ')');
  insert into public.approval_links (id, batch_id, token_hash, secret_id, created_by, expires_at)
  values (v_link, p_batch, extensions.digest(v_token, 'sha256'), v_secret, v_user, p_expires);
  perform private.approval_event(p_batch, 'link_gerado', 'equipe', private.username_of(v_user),
    p_meta => jsonb_build_object('link_id', v_link, 'expires_at', p_expires));
  return v_token;
end $$;

-- "Gerar link para aprovação": salva as opções, envia os conteúdos escolhidos e
-- devolve o link (o atual, ou um novo se não houver ou se p_regenerate)
create function public.approval_publish(p_batch uuid, p_items uuid[], p_title text, p_intro text, p_mode text,
  p_expires timestamptz default null, p_allow_individual boolean default true, p_allow_bulk boolean default true,
  p_regenerate boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.approval_batches; v_sent integer; v_token text; v_link public.approval_links;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  select * into v_batch from public.approval_batches where id = p_batch for update;
  if not found then raise exception 'lote_nao_encontrado'; end if;
  if v_batch.archived_at is not null then raise exception 'lote_arquivado'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expiracao_no_passado'; end if;
  update public.approval_batches
     set title = coalesce(nullif(btrim(p_title), ''), title), intro_message = nullif(btrim(coalesce(p_intro, '')), ''),
         approval_mode = coalesce(p_mode, approval_mode), allow_individual = p_allow_individual, allow_bulk = p_allow_bulk
   where id = p_batch;
  v_sent := private.approval_send(p_batch, p_items);
  if not exists (select 1 from public.approval_items where batch_id = p_batch and removed_at is null and status <> 'rascunho') then
    raise exception 'nada_para_enviar';
  end if;
  select * into v_link from public.approval_links where batch_id = p_batch and revoked_at is null;
  if not found or p_regenerate then
    v_token := private.approval_new_link(p_batch, p_expires, 'regenerado');
  else
    update public.approval_links set expires_at = p_expires where id = v_link.id;
    select decrypted_secret into v_token from vault.decrypted_secrets where id = v_link.secret_id;
  end if;
  return jsonb_build_object('token', v_token, 'sent', v_sent);
end $$;

-- Reenviar só alguns (nova versão depois de ajuste ou alteração)
create function public.approval_resend(p_batch uuid, p_items uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.approval_batches;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  select * into v_batch from public.approval_batches where id = p_batch for update;
  if not found then raise exception 'lote_nao_encontrado'; end if;
  if v_batch.archived_at is not null then raise exception 'lote_arquivado'; end if;
  return private.approval_send(p_batch, p_items);
end $$;

-- Copiar o link de novo (só a equipe; o token sai cifrado do Vault)
create function public.approval_link_token(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.approval_links; v_token text;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  select * into v_link from public.approval_links where batch_id = p_batch and revoked_at is null;
  if not found then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_link.secret_id;
  return jsonb_build_object('token', v_token, 'created_at', v_link.created_at, 'expires_at', v_link.expires_at,
                            'expired', v_link.expires_at is not null and v_link.expires_at <= now());
end $$;

-- Regenerar (o anterior para de funcionar na hora)
create function public.approval_link_regenerate(p_batch uuid, p_expires timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  if not exists (select 1 from public.approval_batches where id = p_batch and archived_at is null) then raise exception 'lote_nao_encontrado'; end if;
  if not exists (select 1 from public.approval_items where batch_id = p_batch and removed_at is null and status <> 'rascunho') then raise exception 'nada_para_enviar'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expiracao_no_passado'; end if;
  return jsonb_build_object('token', private.approval_new_link(p_batch, p_expires, 'regenerado'));
end $$;

-- Desativar na hora
create function public.approval_link_revoke(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.approval_links;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  for v_link in select * from public.approval_links where batch_id = p_batch and revoked_at is null for update loop
    update public.approval_links set revoked_at = now(), revoked_reason = 'desativado' where id = v_link.id;
    if v_link.secret_id is not null then delete from vault.secrets where id = v_link.secret_id; end if;
    perform private.approval_event(p_batch, 'link_desativado', 'equipe', private.username_of((select auth.uid())),
      p_meta => jsonb_build_object('link_id', v_link.id, 'motivo', 'desativado'));
  end loop;
end $$;

-- "Visualizar como cliente" (inclui o que ainda não foi enviado, marcado como rascunho)
create function public.approval_preview(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  return private.approval_batch_json(p_batch, null, true);
end $$;

-- Notificações internas lidas
create function public.approval_mark_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  update public.approval_events set read_at = now()
   where read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Arquivo ainda usado por alguma versão enviada? (não apagar do armazenamento)
create function public.media_in_history(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_agency_member() and exists (
    select 1 from public.content_versions v
     where v.snapshot -> 'assets' @> jsonb_build_array(jsonb_build_object('storage_path', p_path)))
$$;

-- Permissões das funções
-- Usadas pelo gatilho de status, que roda como quem grava o conteúdo (equipe)
revoke all on function private.content_pair_from_status(text, text, text), private.content_status_from_pair(text, text) from public, anon;
grant execute on function private.content_pair_from_status(text, text, text), private.content_status_from_pair(text, text) to authenticated;
revoke all on function private.approval_rate_ok(text, integer, integer), private.content_snapshot(uuid),
  private.approval_event(uuid, text, text, text, uuid, uuid, uuid, text, text, jsonb),
  private.approval_batch_json(uuid, uuid, boolean), private.approval_link_check(text, text),
  private.approval_apply(public.approval_links, uuid, uuid, text, text, text, text, boolean),
  private.approval_after_client_action(uuid, text), private.approval_send(uuid, uuid[]),
  private.approval_new_link(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.sync_content_status() from public, anon, authenticated;

revoke all on function public.approval_public_view(text, text),
  public.approval_public_decide(text, text, uuid, uuid, text, text, text, text),
  public.approval_public_approve_all(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.approval_public_view(text, text),
  public.approval_public_decide(text, text, uuid, uuid, text, text, text, text),
  public.approval_public_approve_all(text, text, jsonb, text, text) to service_role;

revoke all on function public.approval_set_items(uuid, uuid[]),
  public.approval_publish(uuid, uuid[], text, text, text, timestamptz, boolean, boolean, boolean),
  public.approval_resend(uuid, uuid[]), public.approval_link_token(uuid), public.approval_link_regenerate(uuid, timestamptz),
  public.approval_link_revoke(uuid), public.approval_preview(uuid), public.approval_mark_read(uuid[]),
  public.media_in_history(text) from public, anon;
grant execute on function public.approval_set_items(uuid, uuid[]),
  public.approval_publish(uuid, uuid[], text, text, text, timestamptz, boolean, boolean, boolean),
  public.approval_resend(uuid, uuid[]), public.approval_link_token(uuid), public.approval_link_regenerate(uuid, timestamptz),
  public.approval_link_revoke(uuid), public.approval_preview(uuid), public.approval_mark_read(uuid[]),
  public.media_in_history(text) to authenticated;

-- Lote criado (evento)
create function public.approval_batch_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  return new;
end $$;
create trigger approval_batches_created before insert on public.approval_batches
  for each row execute function public.approval_batch_created();
create function public.approval_batch_created_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.approval_event(new.id, 'lote_criado', 'equipe', private.username_of((select auth.uid())));
  return null;
end $$;
create trigger approval_batches_created_event after insert on public.approval_batches
  for each row execute function public.approval_batch_created_event();
revoke all on function public.approval_batch_created(), public.approval_batch_created_event() from public, anon, authenticated;
