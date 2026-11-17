-- =============================================================================
-- Menor privilégio para os papéis do site (auditoria de nov/2026)
-- O padrão do Supabase dá a anon e authenticated TODOS os privilégios nas tabelas
-- do schema public, inclusive TRUNCATE, TRIGGER e REFERENCES, que o painel e o
-- portal nunca usam. TRUNCATE em especial apaga a tabela inteira sem passar pela
-- RLS. A API (PostgREST) não oferece TRUNCATE, então não era explorável por ela,
-- mas fica fechado por segurança em camadas — inclusive para tabelas futuras.
-- Nada que o site faz muda: SELECT/INSERT/UPDATE/DELETE continuam regidos pela RLS.
-- =============================================================================

-- 1. Tabelas, visões e partições atuais
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') loop
    execute format('revoke truncate, trigger, references on table public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

-- 2. Tabelas criadas daqui em diante (pelas migrações)
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 3. Identidade das artes: só a equipe logada usa (as regras já eram só de authenticated)
revoke all on table public.brand_kits from anon;

-- 4. Funções de gatilho: rodam sozinhas nos gatilhos; ninguém precisa chamá-las direto
revoke execute on function public.ad_assets_guard(), public.ads_guard(), public.ads_no_delete_after_submit(),
  public.bump_content_version(), public.touch_content_assets(), public.touch_updated_at() from public, anon, authenticated;
