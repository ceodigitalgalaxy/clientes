-- =============================================================================
-- Avisos no celular (Web Push) e avisos de prazo das demandas.
--   push_subscriptions  aparelhos em que cada pessoa da equipe ativou os avisos
--   notifications       ganha pushed_at (enviado uma vez só) e dedupe_key
--                       (aviso de prazo não repete) + tipos prazo_proximo e
--                       tarefa_atrasada
-- Como o aviso sai: gatilho em notifications → pg_net chama a função
-- "avisos-push" com o segredo do gancho (nasce aqui, fica no Vault; ninguém
-- vê) → a função pede o aviso ao banco (push_claim confere o segredo e marca
-- pushed_at) → manda cifrado para os aparelhos da pessoa.
-- A chave privada de envio (VAPID) também fica só no Vault (push_config).
-- Permissões:
--   - cada pessoa vê só os próprios aparelhos; ativa/desativa só por
--     push_subscribe / push_unsubscribe (equipe ativa)
--   - push_config, push_claim, push_targets, push_report: só a chave secreta
--     do servidor (a função); anon e authenticated não executam
-- Avisos de prazo: pg_cron, de hora em hora das 8h às 20h (Brasília): entrega
-- nas próximas 24 h e demanda atrasada, uma vez por prazo e por pessoa.
-- =============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1. Aparelhos -------------------------------------------------------------------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.agency_members (user_id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) between 20 and 1000
               and endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'),
  p256dh     text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth       text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
comment on table public.push_subscriptions is 'Aparelhos (navegadores) em que cada pessoa da equipe ativou os avisos do painel.';
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, user_id, endpoint, user_agent, created_at, last_ok_at) on public.push_subscriptions to authenticated;
create policy "Cada um vê os próprios aparelhos" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- Ativar neste aparelho (quem tem o endereço e as chaves é o aparelho: passa a ser de quem está logado)
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_agent text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_agent, 300))
  on conflict (endpoint) do update set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now(), last_ok_at = null;
  -- No máximo 10 aparelhos por pessoa: os mais antigos saem
  delete from public.push_subscriptions where user_id = v_uid
     and id not in (select id from public.push_subscriptions where user_id = v_uid order by created_at desc limit 10);
end $$;
create function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;
revoke all on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) to authenticated;

-- 2. Avisos: enviado uma vez, prazo sem repetir -------------------------------------
alter table public.notifications add column pushed_at timestamptz;
alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('atribuicao', 'mencao', 'comentario', 'ajuste', 'tarefa_atribuida', 'tarefa_mencao', 'tarefa_comentario', 'subtarefa_concluida', 'prazo_proximo', 'tarefa_atrasada'));

-- 3. Segredo do gancho (aleatório, criado aqui; fica só no Vault) ----------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_hook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_hook_secret', 'Segredo do gancho banco -> função avisos-push');
  end if;
end $$;

-- 4. Funções só do servidor (chave secreta) ----------------------------------------------
-- Chaves de envio (VAPID): devolve as guardadas; se não houver e vierem novas, guarda
create function public.push_config(p_private text default null, p_public text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'push_vapid';
  if v is null and p_private is not null and p_public ~ '^[A-Za-z0-9_-]{80,100}$' then
    perform pg_advisory_xact_lock(hashtext('push_vapid'));
    select decrypted_secret into v from vault.decrypted_secrets where name = 'push_vapid';
    if v is null then
      v := jsonb_build_object('private', p_private, 'public', p_public)::text;
      perform vault.create_secret(v, 'push_vapid', 'Chaves VAPID dos avisos push do painel');
    end if;
  end if;
  return v::jsonb;
end $$;

-- Entrega o aviso para envio UMA vez (confere o segredo do gancho; lido ou já enviado → nada)
create function public.push_claim(p_id uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.notifications%rowtype; v_secret text; v_title text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_secret is null or p_secret is null or p_secret <> v_secret then return null; end if;
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
    else 'Aviso do painel' end;
  return jsonb_build_object(
    'title', v_title, 'body', coalesce(n.body, ''), 'tag', n.id::text,
    'url', '/admin/?abrir=' || case when n.task_id is not null then 'demanda.' || n.task_id::text
                                    when n.content_id is not null then 'conteudo.' || n.content_id::text else 'inicio' end,
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                        from public.push_subscriptions s where s.user_id = n.user_id));
end $$;

-- Aparelhos de uma pessoa (aviso de teste)
create function public.push_targets(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    from public.push_subscriptions s join public.agency_members m on m.user_id = s.user_id and m.active
   where s.user_id = p_user;
$$;

-- Resultado do envio: o que chegou e as assinaturas que morreram (apagadas)
create function public.push_report(p_ok text[], p_gone text[]) returns void
language sql security definer set search_path = '' as $$
  with gone as (delete from public.push_subscriptions where endpoint = any (coalesce(p_gone, '{}')))
  update public.push_subscriptions set last_ok_at = now() where endpoint = any (coalesce(p_ok, '{}'));
$$;

revoke all on function public.push_config(text, text), public.push_claim(uuid, text), public.push_targets(uuid), public.push_report(text[], text[]) from public, anon, authenticated;
grant execute on function public.push_config(text, text), public.push_claim(uuid, text), public.push_targets(uuid), public.push_report(text[], text[]) to service_role;

-- 5. Gancho: aviso novo → função (só se a pessoa tem aparelho; nunca derruba a gravação do aviso) ----
create function private.push_dispatch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := 'https://peieimwpkrattuldmjux.supabase.co/functions/v1/avisos-push',
    body := jsonb_build_object('action', 'enviar', 'id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_secret),
    timeout_milliseconds := 10000);
  return new;
exception when others then
  return new;
end $$;
create trigger notifications_push after insert on public.notifications
  for each row execute function private.push_dispatch();

-- 6. Avisos de prazo das demandas (sem repetir: um por prazo e por pessoa) ----------------------
create function private.task_deadline_notices() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_rows integer;
begin
  insert into public.notifications (user_id, kind, task_id, actor_name, body, dedupe_key)
  select a.user_id, 'prazo_proximo', t.id, 'Sistema',
         left(t.title || ' · entrega ' || to_char(t.due_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24"h"MI'), 280),
         'prazo:' || t.id::text || ':' || extract(epoch from t.due_at)::bigint::text
    from public.tasks t join public.task_assignees a on a.task_id = t.id
   where t.archived_at is null and t.status <> 'concluido'
     and t.due_at > now() and t.due_at <= now() + interval '24 hours'
     and private.user_sees_task(a.user_id, t.id)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;

  insert into public.notifications (user_id, kind, task_id, actor_name, body, dedupe_key)
  select a.user_id, 'tarefa_atrasada', t.id, 'Sistema',
         left(t.title || ' · era para ' || to_char(t.due_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24"h"MI'), 280),
         'atraso:' || t.id::text || ':' || extract(epoch from t.due_at)::bigint::text
    from public.tasks t join public.task_assignees a on a.task_id = t.id
   where t.archived_at is null and t.status <> 'concluido'
     and t.due_at <= now() and t.due_at > now() - interval '3 days'
     and private.user_sees_task(a.user_id, t.id)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  return v_count;
end $$;
revoke all on function private.push_dispatch(), private.task_deadline_notices() from public, anon, authenticated;

-- De hora em hora, das 8h às 20h de Brasília (11h às 23h UTC)
select cron.schedule('avisos-de-prazo-das-demandas', '5 11-23 * * *', $$select private.task_deadline_notices()$$);
