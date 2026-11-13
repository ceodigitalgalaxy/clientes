-- =============================================================================
-- Aprovação em duas etapas: IDEIA (planejamento) e CONTEÚDO FINAL
-- -----------------------------------------------------------------------------
-- Duas aprovações distintas, com status e histórico independentes:
--   contents.approval_status  → aprovação da IDEIA (lotes "planejamento"; é o
--                               que já existia, todos os lotes atuais são deste tipo)
--   contents.final_status     → aprovação do CONTEÚDO FINAL (lotes "final")
-- Aprovar a ideia NÃO aprova o final.
--
-- O que o cliente vê em cada etapa (filtrado no banco, também para lotes antigos):
--   planejamento: título, data/horário, rede, formato, ideia, roteiro e
--                 "observações do planejamento" (planning_notes).
--                 NUNCA legenda, hashtags, arte, vídeo ou arquivos.
--   final:        título, data/horário, rede, formato, arte/vídeo/arquivos,
--                 legenda, hashtags, CTA e "observações para o cliente".
-- Observações internas nunca saem do painel.
--
-- Campos novos: planning_notes (o texto que hoje está em client_notes foi
-- escrito para o planejamento e é movido para lá), hashtags, final_status e
-- content_versions.stage. A versão enviada guarda só o que a etapa mostra;
-- "mudou desde o envio" passa a comparar só os campos da etapa
-- (approval_stale), então mexer na legenda não pede para reaprovar a ideia.
-- O portal com login também esconde legenda, arte e arquivos até o conteúdo
-- ir para a aprovação final.
-- =============================================================================

-- 1. Conteúdos -------------------------------------------------------------------
alter table public.contents
  add column planning_notes text check (char_length(planning_notes) <= 2000),
  add column hashtags       text check (char_length(hashtags) <= 1000),
  add column final_status   text not null default 'rascunho'
    check (final_status in ('rascunho', 'aguardando_aprovacao', 'aprovado', 'ajustes', 'reenviado'));
comment on column public.contents.approval_status is 'Aprovação da IDEIA (planejamento): rascunho, aguardando_aprovacao, aprovado, ajustes, reenviado.';
comment on column public.contents.final_status is 'Aprovação do CONTEÚDO FINAL (arte, legenda): rascunho, aguardando_aprovacao, aprovado, ajustes, reenviado.';
comment on column public.contents.planning_notes is 'Observações do planejamento: o cliente vê na aprovação da ideia.';
comment on column public.contents.client_notes is 'Observações para o cliente na aprovação final.';
comment on column public.contents.hashtags is 'Hashtags do post (vão para o cliente só na aprovação final).';

-- O que existia em client_notes foi escrito para o planejamento
update public.contents set planning_notes = client_notes, client_notes = null
 where client_notes is not null and planning_notes is null;
-- Já publicado = o final foi aceito
update public.contents set final_status = 'aprovado' where production_status = 'publicado';

-- A versão sobe quando muda algo que o cliente vê
create or replace function public.bump_content_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title, new.scheduled_date, new.scheduled_time, new.network, new.format, new.caption, new.client_notes,
      new.assets_changed_at, new.idea, new.content_plan, new.art_text, new.objective, new.pillar, new.cta,
      new.planning_notes, new.hashtags)
     is distinct from
     (old.title, old.scheduled_date, old.scheduled_time, old.network, old.format, old.caption, old.client_notes,
      old.assets_changed_at, old.idea, old.content_plan, old.art_text, old.objective, old.pillar, old.cta,
      old.planning_notes, old.hashtags) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

-- 2. Versões: etapa de cada envio ------------------------------------------------
alter table public.content_versions
  add column stage text not null default 'planejamento' check (stage in ('planejamento', 'final'));
comment on column public.content_versions.stage is 'Etapa do envio: planejamento (ideia) ou final.';
-- Lotes antigos: a observação enviada era do planejamento
update public.content_versions
   set snapshot = snapshot || jsonb_build_object('planning_notes', snapshot -> 'client_notes')
 where stage = 'planejamento' and not snapshot ? 'planning_notes';

-- 3. O que cada etapa mostra -------------------------------------------------------
create or replace function private.content_snapshot(p_content uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', c.title, 'scheduled_date', c.scheduled_date, 'scheduled_time', left(c.scheduled_time::text, 5),
    'network', c.network, 'format', c.format, 'pillar', c.pillar, 'objective', c.objective, 'idea', c.idea,
    'content_plan', c.content_plan, 'art_text', c.art_text, 'caption', c.caption, 'hashtags', c.hashtags, 'cta', c.cta,
    'client_notes', c.client_notes, 'planning_notes', c.planning_notes,
    'assets', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'role', a.role, 'name', a.name, 'storage_path', a.storage_path, 'url', a.url)
                                         order by a.position, a.created_at)
                          from public.content_assets a where a.content_id = c.id), '[]'::jsonb))
  from public.contents c where c.id = p_content
$$;

-- Recorte por etapa (aplicado ao gravar a versão E ao entregar ao cliente)
create function private.approval_view(p_snapshot jsonb, p_mode text) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_snapshot is null then null
    when p_mode = 'final' then jsonb_build_object(
      'title', p_snapshot -> 'title', 'scheduled_date', p_snapshot -> 'scheduled_date', 'scheduled_time', p_snapshot -> 'scheduled_time',
      'network', p_snapshot -> 'network', 'format', p_snapshot -> 'format',
      'caption', p_snapshot -> 'caption', 'hashtags', p_snapshot -> 'hashtags', 'cta', p_snapshot -> 'cta',
      'client_notes', p_snapshot -> 'client_notes', 'assets', coalesce(p_snapshot -> 'assets', '[]'::jsonb))
    else jsonb_build_object(
      'title', p_snapshot -> 'title', 'scheduled_date', p_snapshot -> 'scheduled_date', 'scheduled_time', p_snapshot -> 'scheduled_time',
      'network', p_snapshot -> 'network', 'format', p_snapshot -> 'format',
      'idea', p_snapshot -> 'idea', 'content_plan', p_snapshot -> 'content_plan',
      'planning_notes', p_snapshot -> 'planning_notes', 'assets', '[]'::jsonb)
  end
$$;

-- Coluna de status de cada etapa
create function private.stage_status(p_content uuid, p_mode text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_mode = 'final' then final_status else approval_status end from public.contents where id = p_content
$$;
create function private.set_stage_status(p_content uuid, p_mode text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_mode = 'final' then update public.contents set final_status = p_status where id = p_content;
  else update public.contents set approval_status = p_status where id = p_content; end if;
end $$;

-- 4. Envio, decisão e leitura respeitam a etapa --------------------------------------
create or replace function private.approval_send(p_batch uuid, p_items uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid()); v_mode text; v_item record; v_version uuid; v_number integer; v_to text; v_count integer := 0;
  v_view jsonb;
begin
  select approval_mode into v_mode from public.approval_batches where id = p_batch;
  for v_item in
    select i.*, c.version as content_version, c.client_id as content_client, c.caption as content_caption,
           cv.snapshot as sent_snapshot,
           exists (select 1 from public.content_assets a where a.content_id = c.id) as has_assets
      from public.approval_items i
      join public.contents c on c.id = i.content_id
      left join public.content_versions cv on cv.id = i.version_id
     where i.batch_id = p_batch and i.removed_at is null
       and (p_items is null or i.id = any (p_items))
       and (i.version_id is null or i.status = 'ajustes'
            or private.approval_view(cv.snapshot, v_mode) is distinct from private.approval_view(private.content_snapshot(c.id), v_mode))
     order by i.display_order
     for update of i
  loop
    -- Aprovação final precisa de algo pronto para o cliente ver
    if v_mode = 'final' and not v_item.has_assets and nullif(btrim(coalesce(v_item.content_caption, '')), '') is null then
      raise exception 'final_sem_conteudo';
    end if;
    v_view := private.approval_view(private.content_snapshot(v_item.content_id), v_mode);
    select coalesce(max(version_number), 0) + 1 into v_number from public.content_versions where content_id = v_item.content_id;
    insert into public.content_versions (content_id, client_id, version_number, content_version, snapshot, created_by, stage)
    values (v_item.content_id, v_item.content_client, v_number, v_item.content_version, v_view, v_user, coalesce(v_mode, 'planejamento'))
    returning id into v_version;
    v_to := case when v_item.version_id is null then 'aguardando_aprovacao' else 'reenviado' end;
    update public.approval_items set version_id = v_version, status = v_to, decided_at = null where id = v_item.id;
    perform private.set_stage_status(v_item.content_id, v_mode, v_to);
    perform private.approval_event(p_batch, case when v_to = 'reenviado' then 'nova_versao' else 'enviado' end, 'equipe', private.username_of(v_user),
      v_item.id, v_item.content_id, v_version, v_item.status, v_to, jsonb_build_object('version_number', v_number, 'stage', v_mode));
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then update public.approval_batches set sent_at = coalesce(sent_at, now()) where id = p_batch; end if;
  return v_count;
end $$;

create or replace function private.approval_apply(p_link public.approval_links, p_item uuid, p_version uuid, p_action text,
  p_comment text, p_name text, p_session text, p_bulk boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.approval_items;
  v_mode text;
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
  select approval_mode into v_mode from public.approval_batches where id = p_link.batch_id;
  insert into public.approval_decisions (batch_id, item_id, content_id, version_id, link_id, action, comment, reviewer_name, session_id, bulk)
  values (p_link.batch_id, v_item.id, v_item.content_id, v_item.version_id, p_link.id, p_action, v_comment, v_name, left(p_session, 64), p_bulk);
  update public.approval_items set status = p_action, decided_at = now() where id = v_item.id;
  if v_item.content_id is not null then perform private.set_stage_status(v_item.content_id, v_mode, p_action); end if;
  perform private.approval_event(p_link.batch_id, p_action, 'cliente', coalesce(v_name, 'Cliente (sem nome)'), v_item.id, v_item.content_id, v_item.version_id,
    v_item.status, p_action, jsonb_build_object('comment', v_comment, 'session', left(p_session, 64), 'link_id', p_link.id, 'bulk', p_bulk, 'stage', v_mode));
  return jsonb_build_object('ok', true, 'item', v_item.id, 'status', p_action);
end $$;

create or replace function private.approval_batch_json(p_batch uuid, p_link uuid, p_preview boolean default false) returns jsonb
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
               'content', private.approval_view(coalesce(v.snapshot, case when p_preview then private.content_snapshot(i.content_id) end), b.approval_mode),
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

-- Excluir lote: os pendentes voltam a rascunho na etapa daquele lote
create or replace function public.approval_batch_delete(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.approval_links; v_mode text; v_item record;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  select approval_mode into v_mode from public.approval_batches where id = p_batch for update;
  if not found then raise exception 'lote_nao_encontrado'; end if;
  for v_item in
    select i.content_id from public.approval_items i
     where i.batch_id = p_batch and i.removed_at is null and i.content_id is not null
       and i.status in ('aguardando_aprovacao', 'reenviado')
       and private.stage_status(i.content_id, v_mode) in ('aguardando_aprovacao', 'reenviado')
       and not exists (select 1 from public.approval_items o
                         join public.approval_batches ob on ob.id = o.batch_id
                        where o.content_id = i.content_id and o.batch_id <> p_batch and o.removed_at is null
                          and ob.archived_at is null and ob.approval_mode = v_mode
                          and o.status in ('aguardando_aprovacao', 'reenviado'))
  loop
    perform private.set_stage_status(v_item.content_id, v_mode, 'rascunho');
  end loop;
  for v_link in select * from public.approval_links where batch_id = p_batch loop
    if v_link.secret_id is not null then delete from vault.secrets where id = v_link.secret_id; end if;
  end loop;
  delete from public.approval_decisions where batch_id = p_batch;
  delete from public.approval_batches where id = p_batch;
end $$;

-- O tipo do lote não muda depois de enviado (as decisões são daquela etapa)
create function public.approval_batch_lock_mode() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.sent_at is not null and new.approval_mode is distinct from old.approval_mode then raise exception 'modo_travado'; end if;
  return new;
end $$;
create trigger approval_batches_lock_mode before update on public.approval_batches
  for each row execute function public.approval_batch_lock_mode();

-- 5. "Mudou desde o envio?" por etapa (painel) -------------------------------------
create function public.approval_stale(p_batch uuid default null, p_content uuid default null)
returns table (item_id uuid, batch_id uuid, content_id uuid, mode text, stale boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.batch_id, i.content_id, b.approval_mode,
         v.snapshot is not null and private.approval_view(v.snapshot, b.approval_mode)
           is distinct from private.approval_view(private.content_snapshot(i.content_id), b.approval_mode)
    from public.approval_items i
    join public.approval_batches b on b.id = i.batch_id
    left join public.content_versions v on v.id = i.version_id
   where private.is_agency_member()
     and i.removed_at is null and i.content_id is not null
     and (p_batch is null or i.batch_id = p_batch)
     and (p_content is null or i.content_id = p_content)
     and (p_batch is not null or p_content is not null)
$$;

-- 6. Portal com login: legenda, arte e arquivos só depois do envio para aprovação final
create or replace function public.portal_agenda(p_from date, p_to date)
returns table (
  id uuid, title text, scheduled_date date, scheduled_time time, network text, format text,
  idea text, content_plan text, art_text text, objective text, caption text, client_notes text,
  status text, version integer, updated_at timestamptz, assets jsonb
)
language sql stable security definer set search_path = '' as $$
  select ct.id, ct.title, ct.scheduled_date, ct.scheduled_time, ct.network, ct.format,
         ct.idea, ct.content_plan,
         case when ct.final_status <> 'rascunho' then ct.art_text end,
         ct.objective,
         case when ct.final_status <> 'rascunho' then concat_ws(E'\n\n', nullif(ct.caption, ''), nullif(ct.hashtags, '')) end,
         case when ct.final_status <> 'rascunho' then coalesce(ct.client_notes, ct.planning_notes) else ct.planning_notes end,
         ct.status, ct.version, ct.updated_at,
         case when ct.final_status <> 'rascunho' then
           coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'storage_path', a.storage_path, 'url', a.url) order by a.position, a.created_at)
                     from public.content_assets a where a.content_id = ct.id and a.kind <> 'pdf' and a.role <> 'thumbnail'), '[]'::jsonb)
         else '[]'::jsonb end
  from public.contents ct
  join public.client_members m on m.client_id = ct.client_id and m.user_id = (select auth.uid())
  join public.clients c on c.id = ct.client_id and c.active
  where ct.status in ('aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado')
    and ct.scheduled_date between p_from and p_to
    and p_to - p_from between 0 and 62
  order by ct.scheduled_date, ct.scheduled_time nulls last, ct.created_at
$$;

-- Permissões
revoke all on function private.approval_view(jsonb, text), private.stage_status(uuid, text), private.set_stage_status(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.approval_batch_lock_mode() from public, anon, authenticated;
revoke all on function public.approval_stale(uuid, uuid) from public, anon;
grant execute on function public.approval_stale(uuid, uuid) to authenticated;
