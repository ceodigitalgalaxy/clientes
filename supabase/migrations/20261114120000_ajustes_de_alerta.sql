-- =============================================================================
-- Ajustes da agência: limites das cores de alerta do calendário (dias).
--   alert_soon_days   amarelo: prazo em até N dias e não concluído (padrão 3)
--   alert_urgent_days vermelho: prazo em até N dias e não aprovado (padrão 1)
-- Uma linha só (id = true). A equipe lê; só o administrador muda.
-- Só cria coisas novas (não apaga nem troca regras existentes).
-- =============================================================================

create table public.agency_settings (
  id                boolean primary key default true check (id),
  alert_soon_days   smallint not null default 3 check (alert_soon_days between 1 and 30),
  alert_urgent_days smallint not null default 1 check (alert_urgent_days between 0 and 29),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,
  constraint agency_settings_alert_order check (alert_urgent_days < alert_soon_days)
);
comment on table public.agency_settings is 'Ajustes da agência (uma linha): limites das cores de alerta do calendário.';
insert into public.agency_settings default values;

alter table public.agency_settings enable row level security;
revoke all on public.agency_settings from anon, authenticated;
grant select on public.agency_settings to authenticated;
grant update (alert_soon_days, alert_urgent_days) on public.agency_settings to authenticated;
create policy "Equipe lê os ajustes" on public.agency_settings for select to authenticated using ((select private.is_agency_member()));
create policy "Administrador muda os ajustes" on public.agency_settings for update to authenticated
  using ((select private.is_agency_admin())) with check ((select private.is_agency_admin()));

-- Quem mudou e quando
create function public.agency_settings_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
revoke all on function public.agency_settings_stamp() from public, anon, authenticated;
create trigger agency_settings_stamp before update on public.agency_settings
  for each row execute function public.agency_settings_stamp();
