-- =============================================================================
-- Comentários internos nos conteúdos (com @menção) e avisos no painel.
--   content_comments  conversa da equipe em cada conteúdo (o cliente nunca vê)
--   notifications     avisos de cada pessoa: atribuição, menção, comentário
--                     numa demanda sua e pedido de ajuste do cliente
-- Os avisos só nascem pelos gatilhos (ninguém grava aviso direto) e só para
-- quem está ativo e enxerga o cliente do conteúdo. Cada um lê e marca como
-- lido só os próprios.
-- Só cria coisas novas (não apaga nem troca regras existentes).
-- =============================================================================

-- 1. Comentários ---------------------------------------------------------------
create table public.content_comments (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.contents (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null default auth.uid(),
  author_name text,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
comment on table public.content_comments is 'Comentários internos da equipe em cada conteúdo (nunca vão para o cliente).';
create index content_comments_content_idx on public.content_comments (content_id, created_at);

alter table public.content_comments enable row level security;
revoke all on public.content_comments from anon, authenticated;
grant select, insert, delete on public.content_comments to authenticated;
create policy "Equipe lê comentários" on public.content_comments for select to authenticated
  using (private.member_sees_content(content_id));
create policy "Equipe comenta" on public.content_comments for insert to authenticated
  with check (private.member_sees_content(content_id) and author_id = (select auth.uid()));
create policy "Autor ou administrador apaga comentário" on public.content_comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select private.is_agency_admin()));

-- Autor e menções conferidos no banco (só quem enxerga o cliente pode ser mencionado)
create function private.content_comments_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_client uuid := private.content_client(new.content_id);
begin
  new.author_id := (select auth.uid());
  new.author_name := private.member_name(new.author_id);
  new.body := btrim(new.body);
  new.mentions := coalesce((select array_agg(distinct m) from unnest(new.mentions) m
                             where m is distinct from new.author_id and private.user_sees_client(m, v_client)), '{}');
  return new;
end $$;
create trigger content_comments_a_prepare before insert on public.content_comments
  for each row execute function private.content_comments_prepare();

-- 2. Avisos --------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.agency_members (user_id) on delete cascade,
  kind       text not null check (kind in ('atribuicao', 'mencao', 'comentario', 'ajuste')),
  content_id uuid references public.contents (id) on delete cascade,
  actor_name text,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.notifications is 'Avisos do painel para cada pessoa da equipe (criados só pelos gatilhos).';
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "Cada um lê os próprios avisos" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Cada um marca os próprios avisos" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Cria o aviso só para quem está ativo, enxerga o cliente e não é quem fez a ação
create function private.notify(p_user uuid, p_kind text, p_content uuid, p_body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, content_id, actor_name, body)
  select p_user, p_kind, p_content,
         coalesce(private.member_name((select auth.uid())), 'Cliente (pelo link)'),
         left(p_body, 280)
   where p_user is not null
     and p_user is distinct from (select auth.uid())
     and private.user_sees_client(p_user, private.content_client(p_content));
$$;

-- Atribuição
create function private.notify_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.user_id, 'atribuicao', new.content_id, (select title from public.contents where id = new.content_id));
  return new;
end $$;
create trigger content_assignees_notify after insert on public.content_assignees
  for each row execute function private.notify_assignment();

-- Comentário: quem foi mencionado; e os responsáveis da demanda (que não foram mencionados)
create function private.notify_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  foreach v_user in array new.mentions loop
    perform private.notify(v_user, 'mencao', new.content_id, new.body);
  end loop;
  for v_user in select user_id from public.content_assignees where content_id = new.content_id and not (user_id = any (new.mentions)) loop
    perform private.notify(v_user, 'comentario', new.content_id, new.body);
  end loop;
  return new;
end $$;
create trigger content_comments_notify after insert on public.content_comments
  for each row execute function private.notify_comment();

-- Pedido de ajuste (do cliente pelo link ou marcado pela equipe): avisa os responsáveis; sem responsável, os administradores
create function private.notify_adjustment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_stage text;
begin
  if new.approval_status = 'ajustes' and old.approval_status is distinct from 'ajustes' then v_stage := 'na ideia';
  elsif new.final_status = 'ajustes' and old.final_status is distinct from 'ajustes' then v_stage := 'no conteúdo final';
  else return new;
  end if;
  for v_user in
    select user_id from public.content_assignees where content_id = new.id
    union
    select m.user_id from public.agency_members m
     where m.role = 'admin' and m.active and not exists (select 1 from public.content_assignees a where a.content_id = new.id)
  loop
    perform private.notify(v_user, 'ajuste', new.id, format('Ajuste pedido %s: %s', v_stage, new.title));
  end loop;
  return new;
end $$;
create trigger contents_zz_notify after update on public.contents
  for each row execute function private.notify_adjustment();

revoke all on function private.content_comments_prepare(), private.notify(uuid, text, uuid, text), private.notify_assignment(),
  private.notify_comment(), private.notify_adjustment() from public, anon, authenticated;
