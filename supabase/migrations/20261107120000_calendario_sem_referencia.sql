-- ============================================================================
-- Calendário do cliente sem referência e sem aprovação pelo portal
-- ----------------------------------------------------------------------------
-- A aprovação passa a ser combinada no grupo do cliente; o portal mostra só o
-- calendário, com o conteúdo explicado em campos guiados:
--   idea          A ideia
--   content_plan  Como vai ser (cenas, slides, o que aparece)
--   art_text      Texto na arte
--   objective     Objetivo
-- A referência (media_url/media_kind) continua só para a equipe: a nova
-- função portal_agenda() não a entrega ao cliente, nem a decisão de aprovação.
-- portal_calendar(), portal_decide(), portal_ad_list() e portal_ad_decide()
-- ficam até o site novo ser publicado e depois são revogadas (migração seguinte).
-- ============================================================================

alter table public.contents
  add column idea         text check (char_length(idea) <= 2000),
  add column content_plan text check (char_length(content_plan) <= 4000),
  add column art_text     text check (char_length(art_text) <= 1000),
  add column objective    text check (char_length(objective) <= 500);

comment on column public.contents.idea is 'A ideia do conteúdo (o cliente vê).';
comment on column public.contents.content_plan is 'Como vai ser: cenas, slides ou o que aparece (o cliente vê).';
comment on column public.contents.art_text is 'Texto que vai na arte ou no vídeo (o cliente vê).';
comment on column public.contents.objective is 'Objetivo do conteúdo (o cliente vê).';
comment on column public.contents.media_url is 'Referência/inspiração: só a equipe vê.';

-- A versão sobe quando muda algo que o cliente vê (agora sem a referência)
create or replace function public.bump_content_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.title, new.scheduled_date, new.scheduled_time, new.network, new.format, new.caption, new.client_notes,
      new.assets_changed_at, new.idea, new.content_plan, new.art_text, new.objective)
     is distinct from
     (old.title, old.scheduled_date, old.scheduled_time, old.network, old.format, old.caption, old.client_notes,
      old.assets_changed_at, old.idea, old.content_plan, old.art_text, old.objective) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

-- Calendário do cliente: sem referência e sem decisão; com os campos guiados
create function public.portal_agenda(p_from date, p_to date)
returns table (
  id uuid, title text, scheduled_date date, scheduled_time time, network text, format text,
  idea text, content_plan text, art_text text, objective text, caption text, client_notes text,
  status text, version integer, updated_at timestamptz, assets jsonb
)
language sql stable security definer set search_path = '' as $$
  select ct.id, ct.title, ct.scheduled_date, ct.scheduled_time, ct.network, ct.format,
         ct.idea, ct.content_plan, ct.art_text, ct.objective, ct.caption, ct.client_notes,
         ct.status, ct.version, ct.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'storage_path', a.storage_path, 'url', a.url) order by a.position, a.created_at)
                   from public.content_assets a where a.content_id = ct.id), '[]'::jsonb)
  from public.contents ct
  join public.client_members m on m.client_id = ct.client_id and m.user_id = (select auth.uid())
  join public.clients c on c.id = ct.client_id and c.active
  where ct.status in ('aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado')
    and ct.scheduled_date between p_from and p_to
    and p_to - p_from between 0 and 62
  order by ct.scheduled_date, ct.scheduled_time nulls last, ct.created_at
$$;
revoke all on function public.portal_agenda(date, date) from public, anon;
grant execute on function public.portal_agenda(date, date) to authenticated;
