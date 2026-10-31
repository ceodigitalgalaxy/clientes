-- ============================================================================
-- Gerador de artes: modelos liberados por cliente
-- ----------------------------------------------------------------------------
-- Cada nicho usa modelos diferentes (varejo: oferta; luta: evento/aula e plano;
-- podcast: evento/episódio e frase; estética automotiva: antes e depois).
-- brand_kits.models guarda os modelos que aparecem para o cliente, e
-- portal_brand_kit() passa a devolvê-los.
-- ============================================================================

alter table public.brand_kits
  add column models text[] not null default array['oferta','plano','aviso']::text[],
  add constraint brand_kits_models check (
    cardinality(models) between 1 and 6
    and models <@ array['oferta','plano','evento','antesdepois','frase','aviso']::text[]
  );

comment on column public.brand_kits.models is 'Modelos de arte liberados: oferta, plano, evento, antesdepois, frase, aviso.';

create or replace function public.portal_brand_kit() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'client', c.name,
    'colors', k.colors,
    'logos', k.logos,
    'units', k.units,
    'campaigns', to_jsonb(k.campaigns),
    'models', to_jsonb(k.models),
    'legal', k.legal
  )
  from public.client_members m
  join public.clients c on c.id = m.client_id and c.active
  join public.brand_kits k on k.client_id = c.id and k.enabled
  where m.user_id = (select auth.uid())
  limit 1;
$$;

revoke execute on function public.portal_brand_kit() from public, anon;
grant execute on function public.portal_brand_kit() to authenticated;
