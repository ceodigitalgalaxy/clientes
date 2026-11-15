-- =============================================================================
-- Avisos no celular: o segredo do gancho não sai mais do Vault.
-- A chamada do banco para a função "avisos-push" fica alguns instantes na fila
-- interna do pg_net (net.http_request_queue). O esquema "net" não é publicado
-- na API, mas as permissões dele são do Supabase e não dá para fechá-las daqui
-- (uma tentativa de REVOKE, registrada como "fila_de_chamadas_fechada", não
-- teve efeito). Então a chamada passa a levar um código próprio de cada aviso:
-- HMAC-SHA256(id do aviso, segredo). Ele só serve para aquele aviso, que é
-- entregue uma única vez (pushed_at); depois disso não vale mais nada.
-- =============================================================================

create or replace function private.push_dispatch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := 'https://peieimwpkrattuldmjux.supabase.co/functions/v1/avisos-push',
    body := jsonb_build_object('action', 'enviar', 'id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', encode(extensions.hmac(new.id::text, v_secret, 'sha256'), 'hex')),
    timeout_milliseconds := 10000);
  return new;
exception when others then
  return new;
end $$;

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
    else 'Aviso do painel' end;
  return jsonb_build_object(
    'title', v_title, 'body', coalesce(n.body, ''), 'tag', n.id::text,
    'url', '/admin/?abrir=' || case when n.task_id is not null then 'demanda.' || n.task_id::text
                                    when n.content_id is not null then 'conteudo.' || n.content_id::text else 'inicio' end,
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                        from public.push_subscriptions s where s.user_id = n.user_id));
end $$;
