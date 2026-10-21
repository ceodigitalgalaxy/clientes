-- A verificação "é da equipe da agência?" só é usada pelas políticas de RLS.
-- Fica num esquema privado, fora da API (/rest/v1/rpc), como recomenda o Supabase.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_agency_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members where user_id = (select auth.uid()));
$$;
revoke all on function private.is_agency_member() from public, anon;
grant execute on function private.is_agency_member() to authenticated;

alter policy "Equipe da agência gerencia clientes" on public.clients
  using ((select private.is_agency_member())) with check ((select private.is_agency_member()));
alter policy "Equipe da agência gerencia conteúdos" on public.contents
  using ((select private.is_agency_member())) with check ((select private.is_agency_member()));

-- A versão antiga em public não é mais usada por nenhuma política. Fica sem
-- permissão de execução para ninguém (não aparece na API). Pode ser apagada
-- com "drop function public.is_agency_member();" numa manutenção futura.
revoke all on function public.is_agency_member() from public, anon, authenticated;
