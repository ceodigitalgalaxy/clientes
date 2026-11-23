-- =============================================================================
-- Financeiro — mensalidades dos clientes
-- Cada cliente pode ter uma ou mais mensalidades (contratos): valor, dia do
-- vencimento, mês de início e, se houver, de fim; pode ser pausada.
-- Todo mês, o administrador lança as mensalidades com um clique
-- (fin_generate_monthly): vira uma receita normal em fin_entries, ligada à
-- mensalidade (contract_id). Lançar de novo não duplica (uma por mês).
-- Mudar o valor vale só para os meses ainda não lançados.
-- Mesmas permissões do financeiro: sócio só vê; o resto da equipe, nada.
-- =============================================================================

create table public.fin_contracts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete restrict,
  description  text not null default 'Mensalidade' check (char_length(btrim(description)) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  due_day      smallint not null check (due_day between 1 and 31),     -- 29–31 viram o último dia nos meses curtos
  start_month  date not null check (extract(day from start_month) = 1),
  end_month    date check (end_month is null or extract(day from end_month) = 1),
  category_id  uuid not null references public.fin_categories (id),
  account_id   uuid references public.fin_accounts (id),
  method       text check (method in ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'outro')),
  notes        text check (char_length(notes) <= 1000),
  paused       boolean not null default false,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (start_month between date '2000-01-01' and date '2100-12-01'),
  check (end_month is null or end_month >= start_month)
);
create index fin_contracts_client_idx on public.fin_contracts (client_id);

-- A receita lançada aponta para a mensalidade (uma por mês)
alter table public.fin_entries add column contract_id uuid references public.fin_contracts (id);
create unique index fin_entries_contract_month on public.fin_entries (contract_id, competence_date) where contract_id is not null;

create function private.fin_contracts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dir text;
begin
  if tg_op = 'UPDATE' then
    if new.client_id <> old.client_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'campo_imutavel';
    end if;
    new.updated_at := now();
  else
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
  end if;
  select direction into v_dir from public.fin_categories where id = new.category_id;
  if v_dir is distinct from 'receita' then raise exception 'categoria_de_outro_tipo'; end if;
  return new;
end $$;
create trigger fin_contracts_guard before insert or update on public.fin_contracts
  for each row execute function private.fin_contracts_guard();
create trigger fin_contracts_log after insert or update on public.fin_contracts
  for each row execute function private.fin_log();

-- Receita ligada a uma mensalidade: é receita e é do mesmo cliente; o vínculo não muda depois
create function private.fin_entries_contract() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  if tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id then raise exception 'campo_imutavel'; end if;
  if new.contract_id is not null then
    select client_id into v_client from public.fin_contracts where id = new.contract_id;
    if v_client is null then raise exception 'mensalidade_nao_encontrada'; end if;
    if new.direction <> 'receita' or new.client_id is distinct from v_client then raise exception 'mensalidade_de_outro_cliente'; end if;
  end if;
  return new;
end $$;
create trigger fin_entries_contract before insert or update on public.fin_entries
  for each row execute function private.fin_entries_contract();

-- Lança as mensalidades do mês que ainda não foram lançadas. Roda com as
-- permissões de quem chama (RLS): só o administrador consegue gravar.
create function public.fin_generate_monthly(p_month date)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_last int; v_count int;
begin
  if not private.finance_manages() then raise exception 'sem_permissao'; end if;
  if v_month < date '2000-01-01' or v_month > date '2100-12-01' then raise exception 'mes_invalido'; end if;
  v_last := extract(day from (v_month + interval '1 month')::date - 1)::int;
  insert into public.fin_entries (direction, description, amount_cents, category_id, account_id, client_id, revenue_kind,
                                  competence_date, due_date, confirmed, request_id, contract_id)
  select 'receita', c.description, c.amount_cents, c.category_id, c.account_id, c.client_id, 'recorrente',
         v_month, v_month + (least(c.due_day, v_last) - 1), true, gen_random_uuid(), c.id
    from public.fin_contracts c
   where not c.paused and c.start_month <= v_month and (c.end_month is null or c.end_month >= v_month)
     and not exists (select 1 from public.fin_entries e where e.contract_id = c.id and e.competence_date = v_month)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

alter table public.fin_contracts enable row level security;
create policy "Financeiro: quem tem acesso vê" on public.fin_contracts for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: administrador cria" on public.fin_contracts for insert to authenticated with check ((select private.finance_manages()));
create policy "Financeiro: administrador altera" on public.fin_contracts for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));

revoke all on table public.fin_contracts from anon, authenticated;
grant select on table public.fin_contracts to authenticated;
grant insert (client_id, description, amount_cents, due_day, start_month, end_month, category_id, account_id, method, notes, paused) on public.fin_contracts to authenticated;
grant update (description, amount_cents, due_day, start_month, end_month, category_id, account_id, method, notes, paused) on public.fin_contracts to authenticated;
grant insert (contract_id) on public.fin_entries to authenticated;

-- A visão dos lançamentos passa a mostrar a mensalidade (coluna nova no fim)
create or replace view public.fin_entries_view with (security_invoker = true) as
select e.id, e.direction, e.description, e.amount_cents, e.category_id, e.account_id, e.client_id, e.revenue_kind, e.counterparty,
       e.competence_date, e.due_date, e.confirmed, e.invoice_number, e.notes, e.cancelled_at, e.cancelled_by, e.cancel_reason,
       e.request_id, e.version, e.created_by, e.created_at, e.updated_at,
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
       end as status,
       e.contract_id
  from public.fin_entries e
  left join lateral (select sum(x.amount_cents) as settled, max(x.paid_on) as last_paid_on
                       from public.fin_settlements x where x.entry_id = e.id and x.voided_at is null) s on true;

revoke all on function public.fin_generate_monthly(date) from public, anon;
grant execute on function public.fin_generate_monthly(date) to authenticated;
revoke all on function private.fin_contracts_guard(), private.fin_entries_contract() from public, anon, authenticated;
