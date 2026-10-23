-- ============================================================================
-- Aprovação de anúncios (criativos de anúncios pagos)
-- ----------------------------------------------------------------------------
-- Separado do calendário orgânico. Fluxo:
--   rascunho → aguardando_aprovacao → (aprovado | alteracoes_solicitadas)
--   alteracoes_solicitadas → (equipe edita) → aguardando_aprovacao (nova versão)
--   qualquer um → arquivado → (reativar) → rascunho
--
-- Garantias feitas pelo BANCO (não pela tela):
--   * Status, versão e datas de envio só mudam pelas funções do fluxo
--     (ad_transition para a equipe, portal_ad_decide para o cliente). Um UPDATE
--     direto nesses campos é recusado (gatilho ads_guard).
--   * Enquanto o cliente está avaliando (ou depois de aprovado/arquivado), o
--     criativo e os textos não podem ser alterados: a equipe "recolhe" ou
--     "reabre" (vira rascunho) e envia uma nova versão.
--   * Cada envio guarda uma cópia da versão (ad_versions) e todo passo fica no
--     histórico (ad_events), que nunca é apagado por um novo envio.
--   * O cliente só enxerga pelas funções portal_ads() e portal_ad_decide(),
--     que descobrem o cliente pela sessão (nenhuma recebe id de cliente) e
--     nunca mostram rascunhos nem observações internas.
--   * Arquivos no bucket PRIVADO ad-media (links assinados temporários).
--   * ad_events.notified_at fica pronto para um envio de e-mail futuro; nada
--     é enviado nesta etapa.
-- ============================================================================

-- Anúncios --------------------------------------------------------------------
create table public.ads (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id) on delete restrict,
  title              text not null check (char_length(btrim(title)) between 1 and 160),
  campaign_context   text check (char_length(campaign_context) <= 2000),   -- descrição e contexto da campanha
  objective          text check (objective in ('reconhecimento', 'trafego', 'engajamento', 'leads', 'vendas', 'mensagens', 'outro')),
  platform           text not null check (platform in ('meta', 'google', 'tiktok', 'outra')),
  platform_other     text check (char_length(platform_other) <= 60),
  format             text not null check (format in ('imagem', 'video', 'carrossel')),
  primary_text       text check (char_length(primary_text) <= 3000),       -- texto principal
  headline           text check (char_length(headline) <= 255),            -- título / headline
  description        text check (char_length(description) <= 500),         -- descrição complementar
  cta                text check (char_length(cta) <= 40),                  -- chamada para ação
  destination_url    text check (destination_url is null or (destination_url ~* '^https?://' and char_length(destination_url) <= 2000)),
  client_notes       text check (char_length(client_notes) <= 2000),       -- observações para o cliente
  internal_notes     text check (char_length(internal_notes) <= 4000),     -- nunca saem do painel
  status             text not null default 'rascunho'
                     check (status in ('rascunho', 'aguardando_aprovacao', 'alteracoes_solicitadas', 'aprovado', 'arquivado')),
  version            integer not null default 1,
  submitted_at       timestamptz,          -- último envio para aprovação
  submitted_by       uuid references auth.users (id) on delete set null,
  first_submitted_at timestamptz,          -- primeiro envio (depois dele, o cliente fica fixo e o anúncio não é apagado)
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (platform <> 'outra' or char_length(btrim(coalesce(platform_other, ''))) >= 1)
);
comment on table public.ads is 'Criativos de anúncios pagos enviados ao cliente para aprovação (fora do calendário orgânico).';
comment on column public.ads.internal_notes is 'Observações internas da agência. Não aparecem para o cliente.';
create index ads_client_status_idx on public.ads (client_id, status);
create index ads_status_idx on public.ads (status);

-- Criativo: arquivos (bucket ad-media) ou links, na ordem do carrossel
create table public.ad_assets (
  id           uuid primary key default gen_random_uuid(),
  ad_id        uuid not null references public.ads (id) on delete cascade,
  kind         text not null check (kind in ('image', 'video')),
  storage_path text check (storage_path is null or (char_length(storage_path) <= 400 and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$')),
  url          text check (url is null or (url ~* '^https?://' and char_length(url) <= 2000)),
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  check ((storage_path is null) <> (url is null))
);
create index ad_assets_ad_idx on public.ad_assets (ad_id, position);

-- Cópia de cada versão enviada (textos + criativo daquele momento)
create table public.ad_versions (
  id           uuid primary key default gen_random_uuid(),
  ad_id        uuid not null references public.ads (id) on delete cascade,
  version      integer not null,
  snapshot     jsonb not null,
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz not null default now(),
  unique (ad_id, version)
);

-- Histórico: envios, decisões do cliente (com comentário) e mudanças de status
create table public.ad_events (
  id             uuid primary key default gen_random_uuid(),
  ad_id          uuid not null references public.ads (id) on delete cascade,
  version        integer not null,
  event          text not null check (event in ('criado', 'enviado', 'recolhido', 'aprovado', 'alteracoes_solicitadas', 'reaberto', 'arquivado', 'reativado')),
  from_status    text,
  to_status      text,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_role     text not null check (actor_role in ('equipe', 'cliente')),
  actor_username text,
  message        text check (message is null or char_length(message) <= 1000),
  created_at     timestamptz not null default clock_timestamp(),
  notified_at    timestamptz            -- para um futuro aviso por e-mail (ainda não integrado)
);
comment on column public.ad_events.notified_at is 'Preenchido por um futuro serviço de e-mail ao avisar sobre o evento. Nulo = ainda não avisado.';
create index ad_events_ad_idx on public.ad_events (ad_id, created_at);

-- Nome de usuário (o login é usuario; no Auth vira equipe+usuario@ ou cliente+usuario@)
create function private.username_of(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select regexp_replace(split_part(u.email, '@', 1), '^(equipe|cliente)\+', '')
  from auth.users u where u.id = p_user
$$;
revoke all on function private.username_of(uuid) from public, anon, authenticated;

-- Regras de edição (gatilhos) ------------------------------------------------------
-- Dentro das funções do fluxo, app.ad_flow = 'on' (vale só para a transação).
create function private.in_ad_flow() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.ad_flow', true), '') = 'on'
$$;
revoke all on function private.in_ad_flow() from public, anon;
grant execute on function private.in_ad_flow() to authenticated;

create function public.ads_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not private.in_ad_flow() then
      new.status := 'rascunho'; new.version := 1;
      new.submitted_at := null; new.submitted_by := null; new.first_submitted_at := null;
      new.created_by := (select auth.uid());
    end if;
    return new;
  end if;
  new.updated_at := now();
  if private.in_ad_flow() then return new; end if;
  if (new.status, new.version, new.submitted_at, new.submitted_by, new.first_submitted_at, new.created_by, new.created_at)
     is distinct from (old.status, old.version, old.submitted_at, old.submitted_by, old.first_submitted_at, old.created_by, old.created_at) then
    raise exception 'use_fluxo_do_anuncio' using hint = 'Status e versão mudam só por ad_transition / portal_ad_decide.';
  end if;
  if old.status not in ('rascunho', 'alteracoes_solicitadas') then
    raise exception 'anuncio_bloqueado' using hint = 'Recolha ou reabra o anúncio (vira rascunho) para editar.';
  end if;
  if new.client_id <> old.client_id and old.first_submitted_at is not null then
    raise exception 'cliente_fixo' using hint = 'Depois do primeiro envio o anúncio não muda de cliente.';
  end if;
  return new;
end $$;
create trigger ads_guard before insert or update on public.ads
  for each row execute function public.ads_guard();

-- Anúncio já enviado alguma vez não é apagado (o histórico fica); arquive
create function public.ads_no_delete_after_submit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.first_submitted_at is not null then raise exception 'anuncio_com_historico'; end if;
  return old;
end $$;
create trigger ads_no_delete before delete on public.ads
  for each row execute function public.ads_no_delete_after_submit();

-- Evento "criado" (quem cadastrou)
create function public.ads_created_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ad_events (ad_id, version, event, to_status, actor_id, actor_role, actor_username)
  values (new.id, new.version, 'criado', new.status, (select auth.uid()), 'equipe', private.username_of((select auth.uid())));
  return null;
end $$;
create trigger ads_created after insert on public.ads
  for each row execute function public.ads_created_event();

-- Criativo só muda com o anúncio editável (rascunho ou alterações solicitadas)
create function public.ad_assets_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.ads where id = coalesce(new.ad_id, old.ad_id);
  if v_status is not null and v_status not in ('rascunho', 'alteracoes_solicitadas') and not private.in_ad_flow() then
    raise exception 'anuncio_bloqueado';
  end if;
  if tg_op = 'UPDATE' and new.ad_id <> old.ad_id then raise exception 'anuncio_bloqueado'; end if;
  return coalesce(new, old);
end $$;
create trigger ad_assets_guard before insert or update or delete on public.ad_assets
  for each row execute function public.ad_assets_guard();

-- Segurança (RLS) ---------------------------------------------------------------------
alter table public.ads enable row level security;
alter table public.ad_assets enable row level security;
alter table public.ad_versions enable row level security;
alter table public.ad_events enable row level security;
revoke all on public.ads, public.ad_assets, public.ad_versions, public.ad_events from anon;
-- Histórico e versões: só leitura (gravados pelas funções do fluxo)
revoke insert, update, delete on public.ad_versions, public.ad_events from authenticated;

create policy "Equipe da agência gerencia anúncios" on public.ads
  for all to authenticated
  using ((select private.is_agency_member())) with check ((select private.is_agency_member()));
create policy "Equipe da agência gerencia criativos" on public.ad_assets
  for all to authenticated
  using ((select private.is_agency_member())) with check ((select private.is_agency_member()));
create policy "Equipe da agência vê versões" on public.ad_versions
  for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe da agência vê o histórico" on public.ad_events
  for select to authenticated using ((select private.is_agency_member()));

-- Fluxo da equipe ---------------------------------------------------------------------
-- p_action: enviar | recolher | reabrir | arquivar | reativar
create function public.ad_transition(p_ad_id uuid, p_action text, p_message text default null)
returns setof public.ads
language plpgsql security definer set search_path = '' as $$
declare
  v_ad public.ads;
  v_to text;
  v_event text;
  v_version integer;
  v_user uuid := (select auth.uid());
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  if v_message is not null and char_length(v_message) > 1000 then raise exception 'mensagem_longa'; end if;
  select * into v_ad from public.ads where id = p_ad_id for update;
  if not found then raise exception 'anuncio_nao_encontrado'; end if;

  v_version := v_ad.version;
  case p_action
    when 'enviar' then
      if v_ad.status not in ('rascunho', 'alteracoes_solicitadas') then raise exception 'transicao_invalida'; end if;
      if not exists (select 1 from public.ad_assets where ad_id = p_ad_id) then raise exception 'sem_criativo'; end if;
      if v_ad.first_submitted_at is not null then v_version := v_ad.version + 1; end if;
      v_to := 'aguardando_aprovacao'; v_event := 'enviado';
    when 'recolher' then
      if v_ad.status <> 'aguardando_aprovacao' then raise exception 'transicao_invalida'; end if;
      v_to := 'rascunho'; v_event := 'recolhido';
    when 'reabrir' then
      if v_ad.status <> 'aprovado' then raise exception 'transicao_invalida'; end if;
      v_to := 'rascunho'; v_event := 'reaberto';
    when 'arquivar' then
      if v_ad.status = 'arquivado' then raise exception 'transicao_invalida'; end if;
      v_to := 'arquivado'; v_event := 'arquivado';
    when 'reativar' then
      if v_ad.status <> 'arquivado' then raise exception 'transicao_invalida'; end if;
      v_to := 'rascunho'; v_event := 'reativado';
    else raise exception 'acao_invalida';
  end case;

  perform set_config('app.ad_flow', 'on', true);
  if p_action = 'enviar' then
    update public.ads set status = v_to, version = v_version, submitted_at = now(), submitted_by = v_user,
           first_submitted_at = coalesce(first_submitted_at, now())
     where id = p_ad_id;
    insert into public.ad_versions (ad_id, version, snapshot, submitted_by)
    select a.id, v_version, jsonb_build_object(
             'title', a.title, 'campaign_context', a.campaign_context, 'objective', a.objective,
             'platform', a.platform, 'platform_other', a.platform_other, 'format', a.format,
             'primary_text', a.primary_text, 'headline', a.headline, 'description', a.description,
             'cta', a.cta, 'destination_url', a.destination_url, 'client_notes', a.client_notes,
             'assets', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'storage_path', s.storage_path, 'url', s.url) order by s.position, s.created_at)
                                 from public.ad_assets s where s.ad_id = a.id), '[]'::jsonb)),
           v_user
      from public.ads a where a.id = p_ad_id
    on conflict (ad_id, version) do update set snapshot = excluded.snapshot, submitted_by = excluded.submitted_by, submitted_at = now();
  else
    update public.ads set status = v_to where id = p_ad_id;
  end if;
  perform set_config('app.ad_flow', 'off', true);

  insert into public.ad_events (ad_id, version, event, from_status, to_status, actor_id, actor_role, actor_username, message)
  values (p_ad_id, v_version, v_event, v_ad.status, v_to, v_user, 'equipe', private.username_of(v_user), v_message);

  return query select * from public.ads where id = p_ad_id;
end $$;
revoke all on function public.ad_transition(uuid, text, text) from public, anon;
grant execute on function public.ad_transition(uuid, text, text) to authenticated;

-- Portas do cliente ---------------------------------------------------------------------
-- Anúncios que o cliente pode ver: já enviados e fora do rascunho
create function public.portal_ads()
returns table (
  id uuid, title text, campaign_context text, objective text, platform text, platform_other text,
  format text, primary_text text, headline text, description text, cta text, destination_url text,
  client_notes text, status text, version integer, submitted_at timestamptz, first_submitted_at timestamptz,
  updated_at timestamptz, assets jsonb, history jsonb
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title, a.campaign_context, a.objective, a.platform, a.platform_other,
         a.format, a.primary_text, a.headline, a.description, a.cta, a.destination_url,
         a.client_notes, a.status, a.version, a.submitted_at, a.first_submitted_at, a.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'storage_path', s.storage_path, 'url', s.url) order by s.position, s.created_at)
                   from public.ad_assets s where s.ad_id = a.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'version', e.version, 'actor_role', e.actor_role,
                                                       'actor_username', e.actor_username, 'message', e.message, 'created_at', e.created_at)
                                    order by e.created_at)
                   from public.ad_events e
                   where e.ad_id = a.id and e.event in ('enviado', 'aprovado', 'alteracoes_solicitadas', 'arquivado')), '[]'::jsonb)
  from public.ads a
  join public.client_members m on m.client_id = a.client_id and m.user_id = (select auth.uid())
  join public.clients c on c.id = a.client_id and c.active
  where a.first_submitted_at is not null
    and a.status in ('aguardando_aprovacao', 'alteracoes_solicitadas', 'aprovado', 'arquivado')
  order by (a.status = 'aguardando_aprovacao') desc, a.submitted_at desc nulls last
$$;

-- Aprovar ou pedir alterações: só anúncio dele, aguardando, na versão atual
create function public.portal_ad_decide(p_ad_id uuid, p_version integer, p_decision text, p_message text default null)
returns table (new_status text, new_version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_ad public.ads;
  v_user uuid := (select auth.uid());
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if p_decision not in ('aprovado', 'alteracoes_solicitadas') then raise exception 'decisao_invalida'; end if;
  if p_decision = 'alteracoes_solicitadas' and v_message is null then raise exception 'mensagem_obrigatoria'; end if;
  if v_message is not null and char_length(v_message) > 1000 then raise exception 'mensagem_longa'; end if;

  select a.* into v_ad
  from public.ads a
  join public.client_members m on m.client_id = a.client_id and m.user_id = v_user
  join public.clients c on c.id = a.client_id and c.active
  where a.id = p_ad_id and a.first_submitted_at is not null
  for update of a;

  if not found then raise exception 'anuncio_nao_encontrado'; end if;
  if v_ad.status <> 'aguardando_aprovacao' then raise exception 'nao_aguarda_aprovacao'; end if;
  if v_ad.version <> p_version then raise exception 'versao_desatualizada'; end if;

  perform set_config('app.ad_flow', 'on', true);
  update public.ads set status = p_decision where id = p_ad_id;
  perform set_config('app.ad_flow', 'off', true);

  insert into public.ad_events (ad_id, version, event, from_status, to_status, actor_id, actor_role, actor_username, message)
  values (p_ad_id, v_ad.version, p_decision, v_ad.status, p_decision, v_user, 'cliente', private.username_of(v_user), v_message);

  return query select p_decision, v_ad.version;
end $$;

revoke all on function public.portal_ads() from public, anon;
revoke all on function public.portal_ad_decide(uuid, integer, text, text) from public, anon;
grant execute on function public.portal_ads() to authenticated;
grant execute on function public.portal_ad_decide(uuid, integer, text, text) to authenticated;

-- Arquivos (Storage) ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ad-media', 'ad-media', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;

-- O cliente lê um arquivo só se ele estiver no criativo ATUAL de um anúncio dele já enviado
create function private.client_can_read_ad_media(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.ad_assets s
    join public.ads a on a.id = s.ad_id
    join public.client_members m on m.client_id = a.client_id and m.user_id = (select auth.uid())
    join public.clients c on c.id = a.client_id and c.active
    where s.storage_path = p_name
      and a.first_submitted_at is not null
      and a.status in ('aguardando_aprovacao', 'alteracoes_solicitadas', 'aprovado', 'arquivado')
  )
$$;
revoke all on function private.client_can_read_ad_media(text) from public, anon;
grant execute on function private.client_can_read_ad_media(text) to authenticated;

create policy "Equipe gerencia arquivos de anúncios" on storage.objects
  for all to authenticated
  using (bucket_id = 'ad-media' and (select private.is_agency_member()))
  with check (bucket_id = 'ad-media' and (select private.is_agency_member()));
create policy "Cliente vê o criativo dos próprios anúncios" on storage.objects
  for select to authenticated
  using (bucket_id = 'ad-media' and private.client_can_read_ad_media(name));

-- Função de gatilho: não é chamável pela API (o gatilho continua funcionando)
revoke all on function public.ads_created_event() from public, anon, authenticated;
