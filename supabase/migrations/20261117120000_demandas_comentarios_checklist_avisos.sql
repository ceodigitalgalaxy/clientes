-- =============================================================================
-- Gestão de demandas (etapa 2): comentários das demandas (com resposta, edição
-- rastreável e @menção), checklist, e avisos de demanda (atribuição, menção,
-- comentário e subtarefa concluída).
--   task_comments       conversa da equipe na demanda (o cliente nunca vê)
--   task_comment_edits  texto anterior de cada edição (quem e quando)
--   task_checklist      itens de checklist da demanda ou da subtarefa
--   notifications       ganha task_id e os tipos de aviso das demandas
-- Permissões no banco:
--   comentar: quem vê a demanda; editar: só o autor; apagar (some o texto,
--   fica o registro): autor ou administrador
--   checklist: vê quem vê a demanda; mexe quem edita a demanda
--   menção: só vale para quem enxerga a demanda (não dá acesso a ninguém)
--   avisos: só pelos gatilhos, para quem está ativo, enxerga a demanda e não
--   foi quem fez a ação
-- =============================================================================

-- 1. Quem enxerga a demanda (para qualquer pessoa, não só quem está logado) ------
create function private.user_sees_task(p_user uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t join public.agency_members m on m.user_id = p_user and m.active
     where t.id = p_task
       and (m.role = 'admin'
            or (t.client_id is not null and private.user_sees_client(p_user, t.client_id))
            or (t.client_id is null and (t.created_by = p_user
                 or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = p_user)
                 or exists (select 1 from public.tasks c join public.task_assignees a on a.task_id = c.id where c.parent_id = t.id and a.user_id = p_user)
                 or (t.parent_id is not null and exists (select 1 from public.task_assignees a where a.task_id = t.parent_id and a.user_id = p_user))))));
$$;

-- 2. Comentários -------------------------------------------------------------------
create table public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  parent_id   uuid references public.task_comments (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null default auth.uid(),
  author_name text,
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  mentions    uuid[] not null default '{}',
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
comment on table public.task_comments is 'Comentários internos da equipe nas demandas (nunca vão para o cliente).';
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_comment_edits (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.task_comments (id) on delete cascade,
  body       text not null,
  editor_id  uuid references auth.users (id) on delete set null,
  edited_at  timestamptz not null default now()
);
create index task_comment_edits_comment_idx on public.task_comment_edits (comment_id, edited_at);

alter table public.task_comments enable row level security;
revoke all on public.task_comments from anon, authenticated;
grant select, insert on public.task_comments to authenticated;
grant update (body, mentions, deleted_at) on public.task_comments to authenticated;
create policy "Equipe lê comentários das demandas" on public.task_comments for select to authenticated
  using (private.member_sees_task(task_id));
create policy "Equipe comenta nas demandas" on public.task_comments for insert to authenticated
  with check (private.member_sees_task(task_id) and author_id = (select auth.uid()));
create policy "Autor edita; autor ou administrador apaga" on public.task_comments for update to authenticated
  using (author_id = (select auth.uid()) or (select private.is_agency_admin()))
  with check (private.member_sees_task(task_id));

alter table public.task_comment_edits enable row level security;
revoke all on public.task_comment_edits from anon, authenticated;
grant select on public.task_comment_edits to authenticated;
create policy "Equipe vê as edições dos comentários" on public.task_comment_edits for select to authenticated
  using (exists (select 1 from public.task_comments c where c.id = comment_id and private.member_sees_task(c.task_id)));

-- Antes de gravar: autor fixo, resposta só a comentário da mesma demanda (um nível),
-- menções só de quem enxerga a demanda; editar só o autor; apagar some o texto
create function private.task_comments_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_parent public.task_comments%rowtype;
begin
  if tg_op = 'INSERT' then
    new.author_id := v_uid;
    new.author_name := private.member_name(v_uid);
    new.edited_at := null; new.deleted_at := null; new.created_at := now();
    if new.parent_id is not null then
      select * into v_parent from public.task_comments where id = new.parent_id;
      if not found or v_parent.task_id <> new.task_id then raise exception 'resposta_invalida'; end if;
      if v_parent.parent_id is not null then new.parent_id := v_parent.parent_id; end if;   -- resposta de resposta vira resposta do mesmo fio
    end if;
  else
    if new.task_id <> old.task_id or new.parent_id is distinct from old.parent_id or new.author_id is distinct from old.author_id then raise exception 'sem_permissao'; end if;
    if old.deleted_at is not null then raise exception 'comentario_apagado'; end if;
    if new.deleted_at is not null then
      if not (old.author_id = v_uid or private.is_agency_admin()) then raise exception 'sem_permissao'; end if;
      new.body := old.body; new.mentions := old.mentions; new.deleted_at := now();
      return new;
    end if;
    if old.author_id is distinct from v_uid then raise exception 'so_o_autor_edita'; end if;
    if btrim(new.body) = old.body then new.mentions := old.mentions; return new; end if;
    new.edited_at := now();
  end if;
  new.body := btrim(new.body);
  new.mentions := coalesce((select array_agg(distinct m) from unnest(new.mentions) m
                             where m is distinct from new.author_id and private.user_sees_task(m, new.task_id)), '{}');
  return new;
end $$;
create trigger task_comments_a_prepare before insert or update on public.task_comments
  for each row execute function private.task_comments_prepare();

-- 3. Checklist ---------------------------------------------------------------------
create table public.task_checklist (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 300),
  done       boolean not null default false,
  done_by    uuid references auth.users (id) on delete set null,
  done_at    timestamptz,
  position   double precision not null default 0,
  created_at timestamptz not null default now()
);
create index task_checklist_task_idx on public.task_checklist (task_id, position);

alter table public.task_checklist enable row level security;
revoke all on public.task_checklist from anon, authenticated;
grant select, insert, update, delete on public.task_checklist to authenticated;
create policy "Equipe vê o checklist" on public.task_checklist for select to authenticated using (private.member_sees_task(task_id));
create policy "Quem edita a demanda cria item" on public.task_checklist for insert to authenticated with check (private.member_edits_task(task_id));
create policy "Quem edita a demanda marca item" on public.task_checklist for update to authenticated using (private.member_edits_task(task_id)) with check (private.member_edits_task(task_id));
create policy "Quem edita a demanda apaga item" on public.task_checklist for delete to authenticated using (private.member_edits_task(task_id));

create function private.task_checklist_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := btrim(new.body);
  if tg_op = 'UPDATE' and new.task_id <> old.task_id then raise exception 'sem_permissao'; end if;
  if tg_op = 'INSERT' and new.position = 0 then new.position := extract(epoch from clock_timestamp()); end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_by := (select auth.uid()); new.done_at := now();
  elsif not new.done then new.done_by := null; new.done_at := null;
  end if;
  return new;
end $$;
create trigger task_checklist_a_prepare before insert or update on public.task_checklist
  for each row execute function private.task_checklist_prepare();

-- 4. Avisos das demandas -------------------------------------------------------------------
alter table public.notifications add column task_id uuid references public.tasks (id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('atribuicao', 'mencao', 'comentario', 'ajuste', 'tarefa_atribuida', 'tarefa_mencao', 'tarefa_comentario', 'subtarefa_concluida'));
create index notifications_task_idx on public.notifications (task_id);

create function private.notify_task(p_user uuid, p_kind text, p_task uuid, p_body text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, task_id, actor_name, body)
  select p_user, p_kind, p_task, coalesce(private.member_name((select auth.uid())), 'Sistema'), left(p_body, 280)
   where p_user is not null
     and p_user is distinct from (select auth.uid())
     and private.user_sees_task(p_user, p_task);
$$;

-- Virou responsável (inclusive numa subtarefa delegada)
create function private.notify_task_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_task(new.user_id, 'tarefa_atribuida', new.task_id, (select title from public.tasks where id = new.task_id));
  return new;
end $$;
create trigger task_assignees_notify after insert on public.task_assignees
  for each row execute function private.notify_task_assignment();

-- Comentário: mencionados; responsáveis e quem criou (que não foram mencionados).
-- Na edição, só quem passou a ser mencionado agora.
create function private.notify_task_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_new uuid[];
begin
  if tg_op = 'UPDATE' then
    if new.body is distinct from old.body then
      insert into public.task_comment_edits (comment_id, body, editor_id) values (old.id, old.body, (select auth.uid()));
    end if;
    if new.deleted_at is not null then return new; end if;
    v_new := coalesce((select array_agg(m) from unnest(new.mentions) m where not (m = any (old.mentions))), '{}');
    foreach v_user in array v_new loop perform private.notify_task(v_user, 'tarefa_mencao', new.task_id, new.body); end loop;
    return new;
  end if;
  foreach v_user in array new.mentions loop
    perform private.notify_task(v_user, 'tarefa_mencao', new.task_id, new.body);
  end loop;
  for v_user in
    select user_id from public.task_assignees where task_id = new.task_id
    union select created_by from public.tasks where id = new.task_id
  loop
    if not (v_user = any (new.mentions)) then perform private.notify_task(v_user, 'tarefa_comentario', new.task_id, new.body); end if;
  end loop;
  return new;
end $$;
create trigger task_comments_notify after insert or update on public.task_comments
  for each row execute function private.notify_task_comment();

-- Subtarefa concluída: avisa quem criou a demanda principal e os responsáveis dela
create function private.notify_subtask_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_parent public.tasks%rowtype;
begin
  if new.parent_id is null or new.status <> 'concluido' or old.status = 'concluido' then return new; end if;
  select * into v_parent from public.tasks where id = new.parent_id;
  for v_user in
    select user_id from public.task_assignees where task_id = v_parent.id
    union select v_parent.created_by
  loop
    perform private.notify_task(v_user, 'subtarefa_concluida', v_parent.id, format('%s (em "%s")', new.title, v_parent.title));
  end loop;
  return new;
end $$;
create trigger tasks_zz_notify_subtask after update on public.tasks
  for each row execute function private.notify_subtask_done();

-- 5. Permissões das funções ------------------------------------------------------------------
revoke all on function private.user_sees_task(uuid, uuid), private.task_comments_prepare(), private.task_checklist_prepare(),
  private.notify_task(uuid, text, uuid, text), private.notify_task_assignment(), private.notify_task_comment(), private.notify_subtask_done()
  from public, anon, authenticated;
