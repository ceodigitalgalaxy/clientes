-- ============================================================================
-- Referência sem arquivo: o anúncio marcado como REFERÊNCIA pode ir ao cliente
-- só com o texto (escopo, ideia e referências em campaign_context), sem
-- arquivo nem link. Arte final continua exigindo pelo menos um criativo.
--   sem_criativo: arte final sem arquivo/link
--   sem_escopo:   referência sem arquivo/link e sem o texto do escopo
-- ============================================================================

-- Mesma função, só muda a checagem do criativo no "enviar"
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
      if not exists (select 1 from public.ad_assets where ad_id = p_ad_id) then
        if v_ad.creative_stage <> 'referencia' then raise exception 'sem_criativo'; end if;
        if nullif(btrim(coalesce(v_ad.campaign_context, '')), '') is null then raise exception 'sem_escopo'; end if;
      end if;
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
