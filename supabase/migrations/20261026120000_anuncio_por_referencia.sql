-- ============================================================================
-- Anúncio enviado pela REFERÊNCIA (ideia) ou pela ARTE FINAL
-- ----------------------------------------------------------------------------
-- creative_stage: 'referencia' = o cliente aprova a ideia/inspiração (a arte
-- final vem depois, como nova versão); 'final' = criativo pronto para veicular.
-- É um campo comum do anúncio (editável só em rascunho/alterações, como os
-- demais) e entra na cópia de cada versão enviada.
-- ============================================================================

alter table public.ads add column creative_stage text not null default 'final'
  check (creative_stage in ('referencia', 'final'));
comment on column public.ads.creative_stage is 'referencia (aprovar a ideia) ou final (arte pronta).';

-- Versão enviada guarda também o tipo do criativo
create or replace function public.ad_transition(p_ad_id uuid, p_action text, p_message text default null)
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
             'creative_stage', a.creative_stage,
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

-- O portal passa a receber o tipo do criativo: nova função portal_ad_list() (mesmas
-- regras de portal_ads, mais a coluna creative_stage). portal_ads() fica só para a
-- versão anterior do site e deve ser revogada depois da publicação.
create function public.portal_ad_list()
returns table (
  id uuid, title text, campaign_context text, objective text, platform text, platform_other text,
  format text, creative_stage text, primary_text text, headline text, description text, cta text, destination_url text,
  client_notes text, status text, version integer, submitted_at timestamptz, first_submitted_at timestamptz,
  updated_at timestamptz, assets jsonb, history jsonb
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title, a.campaign_context, a.objective, a.platform, a.platform_other,
         a.format, a.creative_stage, a.primary_text, a.headline, a.description, a.cta, a.destination_url,
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
revoke all on function public.portal_ad_list() from public, anon;
grant execute on function public.portal_ad_list() to authenticated;
