-- =============================================================================
-- Financeiro da agência — Fase A (base)
-- Só o administrador gerencia; quem tem "finance_access = 'ver'" (o sócio) só
-- consulta; o resto da equipe não vê nada — a proteção está aqui no banco (RLS),
-- não só no menu.
--
-- Regras de dinheiro:
--   * Todo valor é em CENTAVOS (bigint). Nada de float.
--   * Um lançamento (receita ou despesa) é o compromisso; as BAIXAS são os
--     recebimentos/pagamentos de verdade, que podem ser parciais. A soma das
--     baixas ativas nunca passa do valor do lançamento.
--   * Nada é apagado: lançamento é CANCELADO (com motivo) e baixa é ESTORNADA
--     (com motivo). Lançamento com baixa ativa não pode ser cancelado — estorne
--     a baixa antes.
--   * Cada envio do painel leva um request_id único: o mesmo formulário enviado
--     duas vezes (clique duplo, internet caindo) não duplica nada.
--   * Status (previsto, em aberto, vencido, parcial, recebido/pago, cancelado) e
--     saldos são CALCULADOS nas visões abaixo — não ficam gravados à mão.
--   * Toda mudança fica na trilha de auditoria (fin_audit), com quem e quando.
-- =============================================================================

-- 1. Quem vê o financeiro -------------------------------------------------------
alter table public.agency_members
  add column finance_access text not null default 'nenhum' check (finance_access in ('nenhum', 'ver'));
comment on column public.agency_members.finance_access is
  'Financeiro: nenhum = não vê; ver = só consulta. O administrador sempre gerencia.';
-- Só o administrador edita a equipe (política "Administrador edita a equipe")
grant update (finance_access) on public.agency_members to authenticated;

create function private.finance_sees() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members
                  where user_id = (select auth.uid()) and active and (role = 'admin' or finance_access = 'ver'));
$$;
create function private.finance_manages() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members
                  where user_id = (select auth.uid()) and active and role = 'admin');
$$;
-- "Hoje" da agência (o servidor roda em UTC; o Brasil não)
create function private.fin_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- 2. Configuração (uma linha só) -----------------------------------------------
create table public.fin_settings (
  id            boolean primary key default true check (id),
  history_start date,                                   -- a partir de quando o histórico vale (informado depois)
  updated_at    timestamptz not null default now()
);
insert into public.fin_settings (id) values (true);

-- 3. Contas (onde o dinheiro está) ---------------------------------------------
create table public.fin_accounts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(btrim(name)) between 1 and 80),
  kind                  text not null default 'conta' check (kind in ('conta', 'poupanca', 'caixa', 'outro')),
  opening_balance_cents bigint check (opening_balance_cents between -100000000000 and 100000000000),
  opening_date          date,
  active                boolean not null default true,
  notes                 text check (char_length(notes) <= 1000),
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- saldo inicial e data andam juntos (ou os dois, ou nenhum)
  check ((opening_balance_cents is null) = (opening_date is null))
);
create unique index fin_accounts_name_key on public.fin_accounts (lower(btrim(name)));
-- A única conta informada até agora; o saldo inicial fica em branco até ser informado
insert into public.fin_accounts (name, kind) values ('Conta Inter', 'conta');

-- 4. Categorias --------------------------------------------------------------
create table public.fin_categories (
  id         uuid primary key default gen_random_uuid(),
  direction  text not null check (direction in ('receita', 'despesa')),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  active     boolean not null default true,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index fin_categories_name_key on public.fin_categories (direction, lower(btrim(name)));
-- Estrutura inicial (só nomes de categorias; nenhum valor)
insert into public.fin_categories (direction, name, position) values
  ('receita', 'Mensalidade de cliente', 1),
  ('receita', 'Projeto avulso', 2),
  ('receita', 'Comissão', 3),
  ('receita', 'Reembolso recebido', 4),
  ('receita', 'Outras receitas', 5),
  ('despesa', 'Ferramentas e assinaturas', 1),
  ('despesa', 'Impostos (DAS)', 2),
  ('despesa', 'Freelancers e terceiros', 3),
  ('despesa', 'Equipamentos', 4),
  ('despesa', 'Marketing da agência', 5),
  ('despesa', 'Tarifas bancárias', 6),
  ('despesa', 'Outras despesas', 7);

-- 5. Lançamentos -------------------------------------------------------------
create table public.fin_entries (
  id              uuid primary key default gen_random_uuid(),
  direction       text not null check (direction in ('receita', 'despesa')),
  description     text not null check (char_length(btrim(description)) between 1 and 200),
  amount_cents    bigint not null check (amount_cents between 1 and 100000000000),
  category_id     uuid not null references public.fin_categories (id),
  account_id      uuid references public.fin_accounts (id),          -- conta prevista (a baixa diz a real)
  client_id       uuid references public.clients (id) on delete set null,
  revenue_kind    text check (revenue_kind in ('recorrente', 'avulsa')),
  counterparty    text check (char_length(counterparty) <= 120),     -- fornecedor / quem paga
  competence_date date not null,                                     -- mês a que pertence (regime de competência)
  due_date        date not null,                                     -- vencimento (regime de caixa usa as baixas)
  confirmed       boolean not null default true,                     -- false = só previsto
  invoice_number  text check (char_length(invoice_number) <= 60),
  notes           text check (char_length(notes) <= 2000),
  cancelled_at    timestamptz,
  cancelled_by    uuid,
  cancel_reason   text check (char_length(cancel_reason) <= 500),
  request_id      uuid not null unique,
  version         integer not null default 1,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (revenue_kind is null or direction = 'receita'),
  check (client_id is null or direction = 'receita'),
  check ((cancelled_at is null) = (cancel_reason is null)),
  check (competence_date between date '2000-01-01' and date '2100-12-31'),
  check (due_date between date '2000-01-01' and date '2100-12-31')
);
create index fin_entries_due_idx on public.fin_entries (due_date);
create index fin_entries_competence_idx on public.fin_entries (competence_date);
create index fin_entries_category_idx on public.fin_entries (category_id);
create index fin_entries_account_idx on public.fin_entries (account_id);
create index fin_entries_client_idx on public.fin_entries (client_id);

-- 6. Baixas (recebimentos e pagamentos; podem ser parciais) ----------------------
create table public.fin_settlements (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.fin_entries (id),
  account_id   uuid not null references public.fin_accounts (id),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  paid_on      date not null check (paid_on between date '2000-01-01' and date '2100-12-31'),
  method       text check (method in ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'outro')),
  notes        text check (char_length(notes) <= 1000),
  voided_at    timestamptz,
  voided_by    uuid,
  void_reason  text check (char_length(void_reason) <= 500),
  request_id   uuid not null unique,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check ((voided_at is null) = (void_reason is null))
);
create index fin_settlements_entry_idx on public.fin_settlements (entry_id);
create index fin_settlements_account_idx on public.fin_settlements (account_id);
create index fin_settlements_paid_idx on public.fin_settlements (paid_on);

-- 7. Regras que valem mesmo fora do painel (gatilhos) ------------------------------
create function private.fin_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dir text; v_cat_active boolean; v_settled bigint; v_acc_active boolean;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.direction <> old.direction or new.request_id <> old.request_id
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'campo_imutavel';
    end if;
    if old.cancelled_at is not null then raise exception 'lancamento_cancelado'; end if;
    -- edição simultânea: quem salva por cima de uma versão antiga é recusado
    if new.version <> old.version then raise exception 'versao_desatualizada'; end if;
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
    if new.cancelled_at is not null then raise exception 'lancamento_cancelado'; end if;
  end if;

  select direction, active into v_dir, v_cat_active from public.fin_categories where id = new.category_id;
  if v_dir is null then raise exception 'categoria_invalida'; end if;
  if v_dir <> new.direction then raise exception 'categoria_de_outro_tipo'; end if;
  if (tg_op = 'INSERT' or new.category_id <> old.category_id) and not v_cat_active then raise exception 'categoria_inativa'; end if;
  if new.account_id is not null and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id) then
    select active into v_acc_active from public.fin_accounts where id = new.account_id;
    if not coalesce(v_acc_active, false) then raise exception 'conta_inativa'; end if;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(amount_cents), 0) into v_settled from public.fin_settlements where entry_id = new.id and voided_at is null;
    if new.cancelled_at is not null then
      if v_settled > 0 then raise exception 'tem_baixas_ativas'; end if;
      new.cancelled_by := (select auth.uid());
      new.cancelled_at := now();
    end if;
    if new.amount_cents < v_settled then raise exception 'valor_menor_que_baixas'; end if;
  end if;
  return new;
end $$;
create trigger fin_entries_guard before insert or update on public.fin_entries
  for each row execute function private.fin_entries_guard();

create function private.fin_settlements_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_entry public.fin_entries; v_settled bigint; v_acc_active boolean;
begin
  if tg_op = 'UPDATE' then
    -- Baixa não se edita: só se estorna (uma vez, com motivo)
    if old.voided_at is not null then raise exception 'baixa_ja_estornada'; end if;
    if new.voided_at is null or new.entry_id <> old.entry_id or new.account_id <> old.account_id
       or new.amount_cents <> old.amount_cents or new.paid_on <> old.paid_on or new.method is distinct from old.method
       or new.notes is distinct from old.notes or new.request_id <> old.request_id
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'baixa_imutavel';
    end if;
    new.voided_at := now();
    new.voided_by := (select auth.uid());
    return new;
  end if;

  new.created_by := (select auth.uid());
  new.created_at := now();
  if new.voided_at is not null then raise exception 'baixa_imutavel'; end if;
  -- trava o lançamento: duas baixas ao mesmo tempo não passam do valor
  select * into v_entry from public.fin_entries where id = new.entry_id for update;
  if not found then raise exception 'lancamento_nao_encontrado'; end if;
  if v_entry.cancelled_at is not null then raise exception 'lancamento_cancelado'; end if;
  select active into v_acc_active from public.fin_accounts where id = new.account_id;
  if not coalesce(v_acc_active, false) then raise exception 'conta_inativa'; end if;
  select coalesce(sum(amount_cents), 0) into v_settled from public.fin_settlements where entry_id = new.entry_id and voided_at is null;
  if v_settled + new.amount_cents > v_entry.amount_cents then raise exception 'baixa_maior_que_saldo'; end if;
  return new;
end $$;
create trigger fin_settlements_guard before insert or update on public.fin_settlements
  for each row execute function private.fin_settlements_guard();

create function private.fin_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger fin_accounts_touch before update on public.fin_accounts for each row execute function private.fin_touch();
create trigger fin_categories_touch before update on public.fin_categories for each row execute function private.fin_touch();
create trigger fin_settings_touch before update on public.fin_settings for each row execute function private.fin_touch();

-- Categoria já usada em lançamentos não troca de tipo (receita ↔ despesa)
create function private.fin_categories_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction <> old.direction and exists (select 1 from public.fin_entries where category_id = old.id) then
    raise exception 'categoria_em_uso';
  end if;
  return new;
end $$;
create trigger fin_categories_guard before update on public.fin_categories for each row execute function private.fin_categories_guard();

-- 8. Trilha de auditoria ------------------------------------------------------
create table public.fin_audit (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text not null,
  action     text not null,           -- criou, alterou, cancelou, estornou
  actor      uuid,
  actor_name text,
  at         timestamptz not null default now(),
  before     jsonb,
  after      jsonb
);
create index fin_audit_row_idx on public.fin_audit (table_name, row_id);
create index fin_audit_at_idx on public.fin_audit (at desc);

create function private.fin_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_action text; v_new jsonb := to_jsonb(new); v_old jsonb;
begin
  if tg_op = 'INSERT' then v_action := 'criou';
  else
    v_old := to_jsonb(old);
    v_action := case
      when tg_table_name = 'fin_entries' and (v_old->>'cancelled_at') is null and (v_new->>'cancelled_at') is not null then 'cancelou'
      when tg_table_name = 'fin_settlements' and (v_old->>'voided_at') is null and (v_new->>'voided_at') is not null then 'estornou'
      else 'alterou' end;
    if v_old - 'updated_at' - 'version' = v_new - 'updated_at' - 'version' then return null; end if;
  end if;
  insert into public.fin_audit (table_name, row_id, action, actor, actor_name, before, after)
  values (tg_table_name, coalesce(v_new->>'id', 'config'), v_action, (select auth.uid()),
          case when (select auth.uid()) is null then 'Sistema' else private.member_name((select auth.uid())) end, v_old, v_new);
  return null;
end $$;
create trigger fin_entries_log after insert or update on public.fin_entries for each row execute function private.fin_log();
create trigger fin_settlements_log after insert or update on public.fin_settlements for each row execute function private.fin_log();
create trigger fin_accounts_log after insert or update on public.fin_accounts for each row execute function private.fin_log();
create trigger fin_categories_log after insert or update on public.fin_categories for each row execute function private.fin_log();
create trigger fin_settings_log after update on public.fin_settings for each row execute function private.fin_log();

-- 9. Visões calculadas (respeitam a RLS de quem consulta) ---------------------------
create view public.fin_entries_view with (security_invoker = true) as
select e.*,
       coalesce(s.settled, 0)                         as settled_cents,
       e.amount_cents - coalesce(s.settled, 0)        as open_cents,
       s.last_paid_on,
       case
         when e.cancelled_at is not null                       then 'cancelado'
         when coalesce(s.settled, 0) >= e.amount_cents         then 'quitado'
         when coalesce(s.settled, 0) > 0 and e.due_date < private.fin_today() then 'vencido'
         when coalesce(s.settled, 0) > 0                       then 'parcial'
         when not e.confirmed                                  then 'previsto'
         when e.due_date < private.fin_today()                 then 'vencido'
         else 'aberto'
       end as status
  from public.fin_entries e
  left join lateral (select sum(x.amount_cents) as settled, max(x.paid_on) as last_paid_on
                       from public.fin_settlements x where x.entry_id = e.id and x.voided_at is null) s on true;

create view public.fin_account_balances with (security_invoker = true) as
select a.id, a.name, a.kind, a.active, a.opening_balance_cents, a.opening_date,
       coalesce(m.inflow, 0)  as inflow_cents,
       coalesce(m.outflow, 0) as outflow_cents,
       coalesce(a.opening_balance_cents, 0) + coalesce(m.inflow, 0) - coalesce(m.outflow, 0) as balance_cents,
       a.opening_balance_cents is not null as opening_known
  from public.fin_accounts a
  left join lateral (
    select sum(case when e.direction = 'receita' then x.amount_cents else 0 end) as inflow,
           sum(case when e.direction = 'despesa' then x.amount_cents else 0 end) as outflow
      from public.fin_settlements x join public.fin_entries e on e.id = x.entry_id
     where x.account_id = a.id and x.voided_at is null
       and (a.opening_date is null or x.paid_on >= a.opening_date)
  ) m on true;

-- 10. Permissões: ver = quem tem acesso; mudar = só o administrador; apagar = ninguém
alter table public.fin_settings    enable row level security;
alter table public.fin_accounts    enable row level security;
alter table public.fin_categories  enable row level security;
alter table public.fin_entries     enable row level security;
alter table public.fin_settlements enable row level security;
alter table public.fin_audit       enable row level security;

create policy "Financeiro: quem tem acesso vê" on public.fin_settings    for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: quem tem acesso vê" on public.fin_accounts    for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: quem tem acesso vê" on public.fin_categories  for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: quem tem acesso vê" on public.fin_entries     for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: quem tem acesso vê" on public.fin_settlements for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: quem tem acesso vê" on public.fin_audit       for select to authenticated using ((select private.finance_sees()));

create policy "Financeiro: administrador altera" on public.fin_settings for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));
create policy "Financeiro: administrador cria" on public.fin_accounts for insert to authenticated with check ((select private.finance_manages()));
create policy "Financeiro: administrador altera" on public.fin_accounts for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));
create policy "Financeiro: administrador cria" on public.fin_categories for insert to authenticated with check ((select private.finance_manages()));
create policy "Financeiro: administrador altera" on public.fin_categories for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));
create policy "Financeiro: administrador cria" on public.fin_entries for insert to authenticated with check ((select private.finance_manages()));
create policy "Financeiro: administrador altera" on public.fin_entries for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));
create policy "Financeiro: administrador cria" on public.fin_settlements for insert to authenticated with check ((select private.finance_manages()));
create policy "Financeiro: administrador estorna" on public.fin_settlements for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));

revoke all on table public.fin_settings, public.fin_accounts, public.fin_categories, public.fin_entries,
  public.fin_settlements, public.fin_audit, public.fin_entries_view, public.fin_account_balances from anon, authenticated;
grant select on table public.fin_settings, public.fin_accounts, public.fin_categories, public.fin_entries,
  public.fin_settlements, public.fin_audit, public.fin_entries_view, public.fin_account_balances to authenticated;
grant update (history_start) on public.fin_settings to authenticated;
grant insert (name, kind, opening_balance_cents, opening_date, active, notes) on public.fin_accounts to authenticated;
grant update (name, kind, opening_balance_cents, opening_date, active, notes) on public.fin_accounts to authenticated;
grant insert (direction, name, active, position) on public.fin_categories to authenticated;
grant update (name, active, position) on public.fin_categories to authenticated;
grant insert (direction, description, amount_cents, category_id, account_id, client_id, revenue_kind, counterparty,
  competence_date, due_date, confirmed, invoice_number, notes, request_id) on public.fin_entries to authenticated;
grant update (description, amount_cents, category_id, account_id, client_id, revenue_kind, counterparty,
  competence_date, due_date, confirmed, invoice_number, notes, cancelled_at, cancel_reason, version) on public.fin_entries to authenticated;
grant insert (entry_id, account_id, amount_cents, paid_on, method, notes, request_id) on public.fin_settlements to authenticated;
grant update (voided_at, void_reason) on public.fin_settlements to authenticated;

revoke all on function private.finance_sees(), private.finance_manages(), private.fin_today() from public, anon;
grant execute on function private.finance_sees(), private.finance_manages(), private.fin_today() to authenticated;
revoke all on function private.fin_entries_guard(), private.fin_settlements_guard(), private.fin_touch(),
  private.fin_categories_guard(), private.fin_log() from public, anon, authenticated;
