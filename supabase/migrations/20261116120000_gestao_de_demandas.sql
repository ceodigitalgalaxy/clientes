-- =============================================================================
-- Gestão de demandas (etapa 1): tarefas e subtarefas, quadro Kanban com
-- colunas personalizáveis, etiquetas, projetos e histórico.
--   tasks             demanda (parent_id null) ou subtarefa (parent_id = demanda)
--                     cliente opcional (null = "Interno da agência"),
--                     vínculo opcional com projeto e com conteúdo do calendário
--   task_assignees    responsáveis (vários)
--   labels/task_labels  etiquetas coloridas (categoria; não é prioridade nem status)
--   board_columns     colunas do quadro: nome/cor/ordem livres, mas cada uma
--                     aponta para um STATUS OFICIAL (o que vale nos relatórios)
--   task_events       histórico automático (comentários humanos ficam à parte)
--   projects          projetos de um cliente
-- Permissões no banco:
--   ver: administrador; quem enxerga o cliente; tarefa interna só para quem
--        criou, responsáveis (e quem tem subtarefa nela)
--   criar: qualquer pessoa ativa da equipe, só em clientes que enxerga
--   editar: administrador, quem criou, responsáveis, ou quem edita o cliente
--   arquivar: administrador ou quem criou; excluir de vez: só administrador
-- Edição simultânea: "version" sobe a cada gravação; o painel grava com
-- version=eq.<a que leu> e avisa quando outra pessoa salvou antes.
-- Só cria coisas novas (não apaga nem troca regras existentes).
-- =============================================================================

-- 1. Tabelas ---------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  status      text not null default 'ativo' check (status in ('ativo', 'concluido')),
  archived_at timestamptz,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index projects_client_idx on public.projects (client_id);

create table public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  status     text not null check (status in ('a_fazer', 'em_andamento', 'em_revisao', 'aguardando_pessoa', 'aguardando_cliente', 'ajustes', 'concluido')),
  color      text not null default 'cinza' check (color in ('cinza', 'azul', 'roxo', 'amarelo', 'laranja', 'vermelho', 'verde', 'rosa')),
  position   integer not null default 0,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.board_columns is 'Colunas do quadro: nome, cor e ordem livres; cada uma grava um status oficial.';
insert into public.board_columns (name, status, color, position) values
  ('A fazer', 'a_fazer', 'cinza', 1),
  ('Em andamento', 'em_andamento', 'azul', 2),
  ('Em revisão', 'em_revisao', 'roxo', 3),
  ('Aguardando outra pessoa', 'aguardando_pessoa', 'laranja', 4),
  ('Aguardando cliente', 'aguardando_cliente', 'amarelo', 5),
  ('Ajustes solicitados', 'ajustes', 'vermelho', 6),
  ('Concluído', 'concluido', 'verde', 7);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.tasks (id) on delete cascade,
  client_id    uuid references public.clients (id) on delete cascade,
  project_id   uuid references public.projects (id) on delete set null,
  content_id   uuid references public.contents (id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  description  text check (char_length(description) <= 10000),
  status       text not null default 'a_fazer' check (status in ('a_fazer', 'em_andamento', 'em_revisao', 'aguardando_pessoa', 'aguardando_cliente', 'ajustes', 'concluido')),
  column_id    uuid references public.board_columns (id) on delete set null,
  priority     text not null default 'media' check (priority in ('baixa', 'media', 'alta', 'urgente')),
  due_at       timestamptz,
  position     double precision not null default 0,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  archived_at  timestamptz,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.tasks is 'Demandas e subtarefas da equipe (podem ou não estar ligadas a um conteúdo do calendário).';
create index tasks_client_idx on public.tasks (client_id);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_content_idx on public.tasks (content_id);
create index tasks_status_idx on public.tasks (status);
create index tasks_due_idx on public.tasks (due_at);

create table public.task_assignees (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null references public.agency_members (user_id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on public.task_assignees (user_id);

create table public.labels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  color       text not null default 'roxo' check (color in ('cinza', 'azul', 'roxo', 'amarelo', 'laranja', 'vermelho', 'verde', 'rosa')),
  archived_at timestamptz,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index labels_name_idx on public.labels (lower(btrim(name)));
insert into public.labels (name, color) values
  ('Reels', 'rosa'), ('Design', 'roxo'), ('Captação', 'laranja'), ('Edição', 'azul'), ('Social media', 'verde'),
  ('Cliente prioritário', 'amarelo'), ('Aguardando material', 'cinza'), ('Ajuste solicitado', 'vermelho');

create table public.task_labels (
  task_id  uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  primary key (task_id, label_id)
);

create table public.task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  event_type text not null check (event_type in ('criada', 'status', 'responsavel_adicionado', 'responsavel_removido', 'prazo', 'prioridade', 'titulo', 'cliente', 'arquivada', 'restaurada', 'conteudo')),
  actor_id   uuid references auth.users (id) on delete set null,
  actor_name text,
  from_value text,
  to_value   text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index task_events_task_idx on public.task_events (task_id, created_at desc);

-- 2. Quem pode o quê -----------------------------------------------------------------
-- Ver a tarefa pelos campos da própria linha (a regra de leitura não pode procurar a
-- tarefa pelo id: no INSERT ... RETURNING a linha nova ainda não aparece para a consulta)
create function private.member_sees_task_row(p_id uuid, p_client uuid, p_created_by uuid, p_parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_agency_member()
     and (private.is_agency_admin()
          or (p_client is not null and private.member_sees_client(p_client))
          or (p_client is null and (p_created_by = (select auth.uid())
               or exists (select 1 from public.task_assignees a where a.task_id = p_id and a.user_id = (select auth.uid()))
               or exists (select 1 from public.tasks c join public.task_assignees a on a.task_id = c.id
                           where c.parent_id = p_id and a.user_id = (select auth.uid()))
               or (p_parent is not null and exists (select 1 from public.task_assignees a where a.task_id = p_parent and a.user_id = (select auth.uid()))))));
$$;
create function private.member_sees_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.member_sees_task_row(t.id, t.client_id, t.created_by, t.parent_id) from public.tasks t where t.id = p_task), false);
$$;
create function private.member_edits_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task and private.is_agency_member()
       and (private.is_agency_admin()
            or ((t.client_id is null or private.member_sees_client(t.client_id))
                and (t.created_by = (select auth.uid())
                     or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = (select auth.uid()))
                     or (t.parent_id is not null and exists (select 1 from public.tasks p where p.id = t.parent_id and p.created_by = (select auth.uid())))
                     or (t.client_id is not null and private.member_edits_client(t.client_id))))));
$$;
-- A pessoa pode ser responsável? (ativa e enxerga o cliente; tarefa interna: qualquer pessoa ativa)
create function private.user_can_take_task(p_user uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t join public.agency_members m on m.user_id = p_user and m.active
                  where t.id = p_task and (t.client_id is null or private.user_sees_client(p_user, t.client_id)));
$$;

-- 3. Regras das tabelas (RLS) -----------------------------------------------------------
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant select, insert, update, delete on public.projects to authenticated;
create policy "Equipe vê projetos dos clientes liberados" on public.projects for select to authenticated using (private.member_sees_client(client_id));
create policy "Quem edita o cliente cria projetos" on public.projects for insert to authenticated with check (private.member_edits_client(client_id));
create policy "Quem edita o cliente altera projetos" on public.projects for update to authenticated using (private.member_edits_client(client_id)) with check (private.member_edits_client(client_id));
create policy "Administrador apaga projetos" on public.projects for delete to authenticated using ((select private.is_agency_admin()));

alter table public.board_columns enable row level security;
revoke all on public.board_columns from anon, authenticated;
grant select, insert, update, delete on public.board_columns to authenticated;
create policy "Equipe vê as colunas" on public.board_columns for select to authenticated using ((select private.is_agency_member()));
create policy "Administrador cria colunas" on public.board_columns for insert to authenticated with check ((select private.is_agency_admin()));
create policy "Administrador altera colunas" on public.board_columns for update to authenticated using ((select private.is_agency_admin())) with check ((select private.is_agency_admin()));
create policy "Administrador apaga colunas" on public.board_columns for delete to authenticated using ((select private.is_agency_admin()));

alter table public.tasks enable row level security;
revoke all on public.tasks from anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
create policy "Equipe vê as tarefas que pode ver" on public.tasks for select to authenticated using (private.member_sees_task_row(id, client_id, created_by, parent_id));
create policy "Equipe cria tarefas nos clientes que enxerga" on public.tasks for insert to authenticated
  with check (private.is_agency_member() and created_by = (select auth.uid())
              and (client_id is null or private.member_sees_client(client_id))
              and (parent_id is null or private.member_sees_task(parent_id)));
create policy "Equipe edita as tarefas que pode editar" on public.tasks for update to authenticated
  using (private.member_edits_task(id))
  with check (client_id is null or private.member_sees_client(client_id) or (select private.is_agency_admin()));
create policy "Administrador exclui tarefas" on public.tasks for delete to authenticated using ((select private.is_agency_admin()));

alter table public.task_assignees enable row level security;
revoke all on public.task_assignees from anon, authenticated;
grant select, insert, delete on public.task_assignees to authenticated;
create policy "Equipe vê responsáveis das tarefas" on public.task_assignees for select to authenticated using (private.member_sees_task(task_id));
create policy "Quem edita a tarefa atribui" on public.task_assignees for insert to authenticated
  with check (private.member_edits_task(task_id) and private.user_can_take_task(user_id, task_id));
create policy "Quem edita a tarefa retira responsáveis" on public.task_assignees for delete to authenticated using (private.member_edits_task(task_id));

alter table public.labels enable row level security;
revoke all on public.labels from anon, authenticated;
grant select, insert, update, delete on public.labels to authenticated;
create policy "Equipe vê etiquetas" on public.labels for select to authenticated using ((select private.is_agency_member()));
create policy "Equipe cria etiquetas" on public.labels for insert to authenticated with check ((select private.is_agency_member()));
create policy "Administrador altera etiquetas" on public.labels for update to authenticated using ((select private.is_agency_admin())) with check ((select private.is_agency_admin()));
create policy "Administrador apaga etiquetas" on public.labels for delete to authenticated using ((select private.is_agency_admin()));

alter table public.task_labels enable row level security;
revoke all on public.task_labels from anon, authenticated;
grant select, insert, delete on public.task_labels to authenticated;
create policy "Equipe vê etiquetas das tarefas" on public.task_labels for select to authenticated using (private.member_sees_task(task_id));
create policy "Quem edita a tarefa põe etiqueta" on public.task_labels for insert to authenticated with check (private.member_edits_task(task_id));
create policy "Quem edita a tarefa tira etiqueta" on public.task_labels for delete to authenticated using (private.member_edits_task(task_id));

alter table public.task_events enable row level security;
revoke all on public.task_events from anon, authenticated;
grant select on public.task_events to authenticated;
create policy "Equipe vê o histórico das tarefas" on public.task_events for select to authenticated using (private.member_sees_task(task_id));

-- 4. Gatilhos ----------------------------------------------------------------------------
create function private.task_event(p_task uuid, p_type text, p_from text, p_to text, p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.task_events (task_id, event_type, actor_id, actor_name, from_value, to_value, metadata)
  values (p_task, p_type, (select auth.uid()),
          coalesce(private.member_name((select auth.uid())), case when p_type = 'status' then 'Cliente (pelo link)' else 'Sistema' end),
          p_from, p_to, coalesce(p_meta, '{}'::jsonb));
$$;

-- Antes de gravar: subtarefa herda o cliente da demanda; coluna ↔ status oficial; versão
create function private.tasks_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parent public.tasks%rowtype; v_col public.board_columns%rowtype; v_uid uuid := (select auth.uid());
begin
  if new.parent_id is not null then
    select * into v_parent from public.tasks where id = new.parent_id;
    if v_parent.parent_id is not null then raise exception 'subtarefa_de_subtarefa'; end if;
    new.client_id := v_parent.client_id;
    if tg_op = 'INSERT' and new.project_id is null then new.project_id := v_parent.project_id; end if;
  end if;
  if tg_op = 'INSERT' then
    if v_uid is not null then new.created_by := v_uid; end if;
    if new.position = 0 then new.position := extract(epoch from clock_timestamp()); end if;
    new.version := 1;
  else
    if new.parent_id is distinct from old.parent_id then raise exception 'nao_pode_mover_subtarefa'; end if;
    if new.archived_at is distinct from old.archived_at and v_uid is not null
       and not (private.is_agency_admin() or old.created_by = v_uid) then
      raise exception 'sem_permissao_arquivar';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    new.created_by := old.created_by;
  end if;
  -- A coluna escolhida manda no status; mudou só o status: vai para a primeira coluna visível daquele status
  if new.column_id is not null and (tg_op = 'INSERT' or new.column_id is distinct from old.column_id) then
    select * into v_col from public.board_columns where id = new.column_id;
    if found then new.status := v_col.status; end if;
  elsif tg_op = 'INSERT' or new.status is distinct from old.status then
    select id into new.column_id from public.board_columns where status = new.status order by hidden, position limit 1;
  end if;
  if new.status = 'concluido' and (tg_op = 'INSERT' or old.status <> 'concluido') then
    new.completed_at := now(); new.completed_by := v_uid;
  elsif new.status <> 'concluido' then
    new.completed_at := null; new.completed_by := null;
  end if;
  return new;
end $$;
create trigger tasks_a_prepare before insert or update on public.tasks
  for each row execute function private.tasks_prepare();

create function private.tasks_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then perform private.task_event(new.id, 'criada', null, null); return new; end if;
  if new.status is distinct from old.status then perform private.task_event(new.id, 'status', old.status, new.status); end if;
  if new.due_at is distinct from old.due_at then perform private.task_event(new.id, 'prazo', old.due_at::text, new.due_at::text); end if;
  if new.priority is distinct from old.priority then perform private.task_event(new.id, 'prioridade', old.priority, new.priority); end if;
  if new.title is distinct from old.title then perform private.task_event(new.id, 'titulo', old.title, new.title); end if;
  if new.client_id is distinct from old.client_id then perform private.task_event(new.id, 'cliente', old.client_id::text, new.client_id::text); end if;
  if new.content_id is distinct from old.content_id then perform private.task_event(new.id, 'conteudo', old.content_id::text, new.content_id::text); end if;
  if new.archived_at is distinct from old.archived_at then perform private.task_event(new.id, case when new.archived_at is null then 'restaurada' else 'arquivada' end, null, null); end if;
  return new;
end $$;
create trigger tasks_z_log after insert or update on public.tasks
  for each row execute function private.tasks_log();

create function private.task_assignees_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.task_event(new.task_id, 'responsavel_adicionado', null, new.user_id::text, jsonb_build_object('name', private.member_name(new.user_id)));
    return new;
  end if;
  if exists (select 1 from public.tasks where id = old.task_id) then
    perform private.task_event(old.task_id, 'responsavel_removido', old.user_id::text, null, jsonb_build_object('name', private.member_name(old.user_id)));
  end if;
  return old;
end $$;
create trigger task_assignees_log after insert or delete on public.task_assignees
  for each row execute function private.task_assignees_log();

-- Conteúdo ↔ demanda: o que acontece na aprovação move a demanda ligada (só a principal, não arquivada nem concluída)
create function private.sync_tasks_from_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if new.final_status = 'aprovado' and old.final_status is distinct from 'aprovado' then v_status := 'concluido';
  elsif (new.approval_status = 'ajustes' and old.approval_status is distinct from 'ajustes')
     or (new.final_status = 'ajustes' and old.final_status is distinct from 'ajustes') then v_status := 'ajustes';
  elsif (new.approval_status in ('aguardando_aprovacao', 'reenviado') and old.approval_status is distinct from new.approval_status)
     or (new.final_status in ('aguardando_aprovacao', 'reenviado') and old.final_status is distinct from new.final_status) then v_status := 'aguardando_cliente';
  else return new;
  end if;
  update public.tasks set status = v_status
   where content_id = new.id and parent_id is null and archived_at is null and status <> 'concluido' and status <> v_status;
  return new;
end $$;
create trigger contents_zzz_sync_tasks after update on public.contents
  for each row execute function private.sync_tasks_from_content();

-- 5. Permissões das funções ------------------------------------------------------------------
revoke all on function private.member_sees_task_row(uuid, uuid, uuid, uuid), private.member_sees_task(uuid), private.member_edits_task(uuid), private.user_can_take_task(uuid, uuid),
  private.task_event(uuid, text, text, text, jsonb), private.tasks_prepare(), private.tasks_log(), private.task_assignees_log(),
  private.sync_tasks_from_content() from public, anon;
grant execute on function private.member_sees_task_row(uuid, uuid, uuid, uuid), private.member_sees_task(uuid), private.member_edits_task(uuid), private.user_can_take_task(uuid, uuid) to authenticated;
revoke all on function private.tasks_prepare(), private.tasks_log(), private.task_assignees_log(), private.sync_tasks_from_content() from authenticated;
