-- =============================================================================
-- Financeiro — metas e objetivos
-- Metas definidas pelo administrador (o sistema não inventa nenhum valor);
-- o realizado é CALCULADO aqui no banco a partir dos lançamentos, com a RLS de
-- quem consulta. Quem tem acesso "ver" (o sócio) vê; só o administrador muda.
--   * Tipos: faturamento, resultado (receitas − despesas), despesas totais,
--     limite de gasto por categoria e clientes ativos.
--   * Período: mês ou ano. Base: competência (mês a que pertence) ou caixa
--     (o que entrou/saiu de verdade).
--   * Meta não se apaga: desativa (fica na auditoria).
--   * Limite anual do MEI: configurável (em branco = não mostra). Categorias
--     podem não contar como faturamento (ex.: reembolso recebido).
-- =============================================================================

-- 1. Configuração e categorias ---------------------------------------------------
alter table public.fin_settings
  add column mei_annual_limit_cents bigint check (mei_annual_limit_cents between 1 and 100000000000);
grant update (mei_annual_limit_cents) on public.fin_settings to authenticated;

alter table public.fin_categories add column counts_as_revenue boolean not null default true;
comment on column public.fin_categories.counts_as_revenue is 'Receita que entra no faturamento (metas e limite do MEI). Reembolso, por exemplo, não entra.';
update public.fin_categories set counts_as_revenue = false where direction = 'receita' and name = 'Reembolso recebido';
grant update (counts_as_revenue) on public.fin_categories to authenticated;
grant insert (counts_as_revenue) on public.fin_categories to authenticated;

-- 2. Metas -------------------------------------------------------------------------
create table public.fin_goals (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('faturamento', 'resultado', 'despesas', 'limite_categoria', 'clientes_ativos')),
  period       text not null check (period in ('mes', 'ano')),
  period_start date not null check (period_start between date '2000-01-01' and date '2100-12-01'),
  target       bigint not null check (target between 0 and 100000000000),   -- centavos (ou quantidade, em clientes ativos)
  basis        text not null default 'competencia' check (basis in ('competencia', 'caixa')),
  category_id  uuid references public.fin_categories (id),
  notes        text check (char_length(notes) <= 500),
  active       boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (extract(day from period_start) = 1 and (period = 'mes' or extract(month from period_start) = 1)),
  check ((kind = 'limite_categoria') = (category_id is not null))
);
-- Uma meta ativa de cada tipo por período e base (e por categoria, no limite de gasto)
create unique index fin_goals_unique on public.fin_goals
  (kind, period, period_start, basis, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid)) where active;
create index fin_goals_period_idx on public.fin_goals (period_start);

create function private.fin_goals_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dir text;
begin
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind or new.period <> old.period or new.period_start <> old.period_start
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'campo_imutavel';
    end if;
    new.updated_at := now();
  else
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
  end if;
  if new.category_id is not null then
    select direction into v_dir from public.fin_categories where id = new.category_id;
    if v_dir is distinct from 'despesa' then raise exception 'categoria_de_outro_tipo'; end if;
  end if;
  if new.kind = 'clientes_ativos' then new.basis := 'competencia'; end if;
  return new;
end $$;
create trigger fin_goals_guard before insert or update on public.fin_goals
  for each row execute function private.fin_goals_guard();
create trigger fin_goals_log after insert or update on public.fin_goals
  for each row execute function private.fin_log();

-- 3. Realizado (SECURITY INVOKER: respeita a RLS de quem consulta) ----------------------
-- actual   = o que já vale: competência → lançamentos confirmados; caixa → o que entrou/saiu
-- forecast = actual + o que ainda está para acontecer no período (previstos / em aberto)
create function private.fin_goal_values(p_kind text, p_basis text, p_cat uuid, p_from date, p_to date,
                                        out actual bigint, out forecast bigint)
language sql stable set search_path = '' as $$
  with e as (
    select v.id, v.amount_cents, v.open_cents, v.confirmed, v.competence_date, v.due_date,
           case when p_kind = 'resultado' and v.direction = 'despesa' then -1 else 1 end as sg
      from public.fin_entries_view v
      left join public.fin_categories c on c.id = v.category_id
     where v.status <> 'cancelado'
       and (p_kind = 'resultado' or v.direction = case when p_kind = 'faturamento' then 'receita' else 'despesa' end)
       and (p_kind <> 'faturamento' or coalesce(c.counts_as_revenue, true))
       and (p_cat is null or v.category_id = p_cat)
  ), cash as (
    select coalesce(sum(e.sg * x.amount_cents), 0) as total
      from public.fin_settlements x join e on e.id = x.entry_id
     where x.voided_at is null and x.paid_on between p_from and p_to
  )
  select case
           when p_kind = 'clientes_ativos' then (select count(*) from public.clients where active)
           when p_basis = 'caixa' then (select total from cash)
           else (select coalesce(sum(sg * amount_cents), 0) from e where confirmed and competence_date between p_from and p_to)
         end::bigint,
         case
           when p_kind = 'clientes_ativos' then (select count(*) from public.clients where active)
           when p_basis = 'caixa' then (select total from cash) + (select coalesce(sum(sg * open_cents), 0) from e where due_date between p_from and p_to)
           else (select coalesce(sum(sg * amount_cents), 0) from e where competence_date between p_from and p_to)
         end::bigint;
$$;

create view public.fin_goal_progress with (security_invoker = true) as
select g.id, g.kind, g.period, g.period_start, p.period_end, g.target, g.basis, g.category_id, g.notes, g.active,
       g.created_at, g.updated_at, v.actual, v.forecast
  from public.fin_goals g
  cross join lateral (select case when g.period = 'mes' then (g.period_start + interval '1 month')::date - 1
                                  else (g.period_start + interval '1 year')::date - 1 end as period_end) p
  cross join lateral private.fin_goal_values(g.kind, g.basis, g.category_id, g.period_start, p.period_end) v;

-- Faturamento por ano (para o limite do MEI): lançado (competência) e recebido (caixa)
create view public.fin_year_revenue with (security_invoker = true) as
with rev as (
  select e.id, e.amount_cents, e.competence_date, e.confirmed
    from public.fin_entries e
    left join public.fin_categories c on c.id = e.category_id
   where e.direction = 'receita' and e.cancelled_at is null and coalesce(c.counts_as_revenue, true)
), years as (
  select extract(year from competence_date)::int as year from rev
  union select extract(year from x.paid_on)::int from public.fin_settlements x join rev on rev.id = x.entry_id
  union select extract(year from private.fin_today())::int
)
select y.year,
       coalesce((select sum(amount_cents) from rev where confirmed and extract(year from competence_date) = y.year), 0)::bigint as billed_cents,
       coalesce((select sum(x.amount_cents) from public.fin_settlements x join rev on rev.id = x.entry_id
                  where x.voided_at is null and extract(year from x.paid_on) = y.year), 0)::bigint as received_cents
  from years y
 where (select private.finance_sees());   -- sem acesso: nem a linha do ano aparece

-- 4. Permissões ---------------------------------------------------------------------
alter table public.fin_goals enable row level security;
create policy "Financeiro: quem tem acesso vê" on public.fin_goals for select to authenticated using ((select private.finance_sees()));
create policy "Financeiro: administrador cria" on public.fin_goals for insert to authenticated with check ((select private.finance_manages()));
create policy "Financeiro: administrador altera" on public.fin_goals for update to authenticated
  using ((select private.finance_manages())) with check ((select private.finance_manages()));

revoke all on table public.fin_goals, public.fin_goal_progress, public.fin_year_revenue from anon, authenticated;
grant select on table public.fin_goals, public.fin_goal_progress, public.fin_year_revenue to authenticated;
grant insert (kind, period, period_start, target, basis, category_id, notes) on public.fin_goals to authenticated;
grant update (target, basis, category_id, notes, active) on public.fin_goals to authenticated;

revoke all on function private.fin_goal_values(text, text, uuid, date, date) from public, anon;
grant execute on function private.fin_goal_values(text, text, uuid, date, date) to authenticated;
revoke all on function private.fin_goals_guard() from public, anon, authenticated;
