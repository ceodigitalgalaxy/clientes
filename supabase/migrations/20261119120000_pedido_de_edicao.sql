-- =============================================================================
-- Pedido de edição de vídeo (Gestão de demandas)
--   tasks.kind = 'edicao'      a demanda é um pedido de edição
--   tasks.drive_url            pasta do Drive com os brutos (link colado)
--   tasks.reference_url        vídeo de referência (opcional)
--   tasks.video_format/_duration  formato (9:16, 4:5, 16:9…) e duração
--   task_rounds                rodadas: pedido (ou ajustes) → entrega do editor
--                              → aprovado ou novo ajuste (a próxima rodada)
-- Fluxo, só por funções (o banco confere quem pode):
--   edit_deliver(tarefa, link, obs)   quem edita a demanda (o editor) entrega a
--                                     rodada aberta → "Em revisão" e avisa quem pediu
--   edit_review(tarefa, decisão, pontos)  quem pediu (criador, administrador ou
--                                     quem edita o cliente) aprova → "Concluído",
--                                     ou pede ajuste → nova rodada → "Ajustes
--                                     solicitados" e avisa o editor
-- Links só https (nada de javascript: ou http). Nunca vão para o cliente.
-- =============================================================================

-- 1. Campos do pedido ---------------------------------------------------------------
alter table public.tasks add column kind text not null default 'geral' check (kind in ('geral', 'edicao'));
alter table public.tasks add column drive_url text check (drive_url is null or (char_length(drive_url) <= 1000 and drive_url ~ '^https://[^\s/@]+(/\S*)?$'));
alter table public.tasks add column reference_url text check (reference_url is null or (char_length(reference_url) <= 1000 and reference_url ~ '^https://[^\s/@]+(/\S*)?$'));
alter table public.tasks add column video_format text check (video_format is null or video_format in ('9_16', '4_5', '1_1', '16_9', 'outro'));
alter table public.tasks add column video_duration text check (video_duration is null or char_length(video_duration) <= 40);
comment on column public.tasks.kind is 'geral = demanda comum; edicao = pedido de edição de vídeo (com rodadas em task_rounds).';

-- O tipo da demanda não muda depois de criada
create function private.tasks_kind_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then raise exception 'tipo_nao_muda'; end if;
  return new;
end $$;
create trigger tasks_b_kind_guard before update on public.tasks
  for each row execute function private.tasks_kind_guard();

-- 2. Rodadas -----------------------------------------------------------------------
create table public.task_rounds (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks (id) on delete cascade,
  round          integer not null check (round >= 1),
  requested_notes text check (char_length(requested_notes) <= 5000),
  requested_by   uuid references auth.users (id) on delete set null,
  requested_name text,
  requested_at   timestamptz not null default now(),
  delivery_url   text check (delivery_url is null or (char_length(delivery_url) <= 1000 and delivery_url ~ '^https://[^\s/@]+(/\S*)?$')),
  delivery_note  text check (char_length(delivery_note) <= 2000),
  delivered_by   uuid references auth.users (id) on delete set null,
  delivered_name text,
  delivered_at   timestamptz,
  decision       text check (decision in ('aprovado', 'ajustes')),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  unique (task_id, round)
);
comment on table public.task_rounds is 'Rodadas do pedido de edição: o que foi pedido, a entrega do editor e a decisão.';

alter table public.task_rounds enable row level security;
revoke all on public.task_rounds from anon, authenticated;
grant select on public.task_rounds to authenticated;
create policy "Equipe vê as rodadas das demandas que vê" on public.task_rounds for select to authenticated
  using (private.member_sees_task(task_id));

-- Pedido de edição nasce com a rodada 1 (o pedido original)
create function private.tasks_first_round() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'edicao' then
    insert into public.task_rounds (task_id, round, requested_by, requested_name)
    values (new.id, 1, new.created_by, private.member_name(new.created_by));
  end if;
  return new;
end $$;
create trigger tasks_zz_first_round after insert on public.tasks
  for each row execute function private.tasks_first_round();

-- 3. Histórico e avisos aceitam os passos da edição --------------------------------------
alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check
  check (event_type in ('criada', 'status', 'responsavel_adicionado', 'responsavel_removido', 'prazo', 'prioridade', 'titulo', 'cliente', 'arquivada', 'restaurada', 'conteudo',
                        'edicao_entregue', 'edicao_ajuste', 'edicao_aprovada'));
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('atribuicao', 'mencao', 'comentario', 'ajuste', 'tarefa_atribuida', 'tarefa_mencao', 'tarefa_comentario', 'subtarefa_concluida', 'prazo_proximo', 'tarefa_atrasada',
                  'edicao_entregue', 'edicao_ajuste', 'edicao_aprovada'));

-- 4. Entregar (editor) -------------------------------------------------------------------
create function public.edit_deliver(p_task uuid, p_url text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype; r public.task_rounds%rowtype; v_uid uuid := (select auth.uid()); v_user uuid;
begin
  select * into t from public.tasks where id = p_task;
  if not found or t.kind <> 'edicao' or t.archived_at is not null then raise exception 'pedido_invalido'; end if;
  if not private.member_edits_task(p_task) then raise exception 'sem_permissao'; end if;
  if p_url is null or char_length(p_url) > 1000 or p_url !~ '^https://[^\s/@]+(/\S*)?$' then raise exception 'link_invalido'; end if;
  select * into r from public.task_rounds where task_id = p_task order by round desc limit 1;
  if r.decision is not null then raise exception 'rodada_fechada'; end if;
  update public.task_rounds set delivery_url = p_url, delivery_note = nullif(btrim(coalesce(p_note, '')), ''),
         delivered_by = v_uid, delivered_name = private.member_name(v_uid), delivered_at = now()
   where id = r.id;
  update public.tasks set status = 'em_revisao' where id = p_task and status <> 'em_revisao';
  perform private.task_event(p_task, 'edicao_entregue', null, r.round::text);
  for v_user in select t.created_by union select r.requested_by loop
    perform private.notify_task(v_user, 'edicao_entregue', p_task, format('%s · rodada %s', t.title, r.round));
  end loop;
  return jsonb_build_object('round', r.round);
end $$;

-- 5. Revisar (quem pediu): aprovar ou pedir ajuste ----------------------------------------------
create function public.edit_review(p_task uuid, p_decision text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype; r public.task_rounds%rowtype; v_uid uuid := (select auth.uid()); v_user uuid; v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into t from public.tasks where id = p_task;
  if not found or t.kind <> 'edicao' or t.archived_at is not null then raise exception 'pedido_invalido'; end if;
  if not (private.is_agency_admin() or (private.is_agency_member() and (t.created_by = v_uid
          or (t.client_id is not null and private.member_edits_client(t.client_id))))) then raise exception 'so_quem_pediu_revisa'; end if;
  if p_decision not in ('aprovado', 'ajustes') then raise exception 'decisao_invalida'; end if;
  select * into r from public.task_rounds where task_id = p_task order by round desc limit 1;
  if r.delivered_at is null then raise exception 'sem_entrega'; end if;
  if r.decision is not null then raise exception 'rodada_fechada'; end if;
  if p_decision = 'ajustes' and (v_notes is null or char_length(v_notes) > 5000) then raise exception 'ajuste_sem_pontos'; end if;
  update public.task_rounds set decision = p_decision, decided_by = v_uid, decided_at = now() where id = r.id;
  if p_decision = 'aprovado' then
    update public.tasks set status = 'concluido' where id = p_task;
    perform private.task_event(p_task, 'edicao_aprovada', null, r.round::text);
  else
    insert into public.task_rounds (task_id, round, requested_notes, requested_by, requested_name)
    values (p_task, r.round + 1, v_notes, v_uid, private.member_name(v_uid));
    update public.tasks set status = 'ajustes' where id = p_task and status <> 'ajustes';
    perform private.task_event(p_task, 'edicao_ajuste', null, (r.round + 1)::text);
  end if;
  for v_user in select user_id from public.task_assignees where task_id = p_task loop
    perform private.notify_task(v_user, case p_decision when 'aprovado' then 'edicao_aprovada' else 'edicao_ajuste' end, p_task,
      case p_decision when 'aprovado' then format('%s · aprovado na rodada %s', t.title, r.round) else format('%s · rodada %s: %s', t.title, r.round + 1, v_notes) end);
  end loop;
  return jsonb_build_object('round', case p_decision when 'aprovado' then r.round else r.round + 1 end, 'decision', p_decision);
end $$;

revoke all on function public.edit_deliver(uuid, text, text), public.edit_review(uuid, text, text) from public, anon;
grant execute on function public.edit_deliver(uuid, text, text), public.edit_review(uuid, text, text) to authenticated;
revoke all on function private.tasks_kind_guard(), private.tasks_first_round() from public, anon, authenticated;

-- 6. Títulos dos avisos no celular para os passos da edição (mesmo push_claim, com o código por aviso) ----
create or replace function public.push_claim(p_id uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.notifications%rowtype; v_secret text; v_title text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_secret is null or p_secret is null or p_id is null
     or p_secret <> encode(extensions.hmac(p_id::text, v_secret, 'sha256'), 'hex') then return null; end if;
  update public.notifications set pushed_at = now() where id = p_id and pushed_at is null and read_at is null returning * into n;
  if not found then return null; end if;
  if not exists (select 1 from public.agency_members m where m.user_id = n.user_id and m.active) then return null; end if;
  v_title := case n.kind
    when 'atribuicao' then n.actor_name || ' te colocou como responsável'
    when 'mencao' then n.actor_name || ' te mencionou'
    when 'comentario' then n.actor_name || ' comentou numa demanda sua'
    when 'ajuste' then case when n.actor_name = 'Cliente (pelo link)' then 'O cliente pediu ajuste' else n.actor_name || ' marcou ajuste' end
    when 'tarefa_atribuida' then n.actor_name || ' te passou uma demanda'
    when 'tarefa_mencao' then n.actor_name || ' te mencionou numa demanda'
    when 'tarefa_comentario' then n.actor_name || ' comentou numa demanda sua'
    when 'subtarefa_concluida' then n.actor_name || ' concluiu uma subtarefa'
    when 'prazo_proximo' then 'Entrega chegando'
    when 'tarefa_atrasada' then 'Demanda atrasada'
    when 'edicao_entregue' then n.actor_name || ' entregou a edição'
    when 'edicao_ajuste' then n.actor_name || ' pediu ajuste na edição'
    when 'edicao_aprovada' then n.actor_name || ' aprovou a edição'
    else 'Aviso do painel' end;
  return jsonb_build_object(
    'title', v_title, 'body', coalesce(n.body, ''), 'tag', n.id::text,
    'url', '/admin/?abrir=' || case when n.task_id is not null then 'demanda.' || n.task_id::text
                                    when n.content_id is not null then 'conteudo.' || n.content_id::text else 'inicio' end,
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                        from public.push_subscriptions s where s.user_id = n.user_id));
end $$;
