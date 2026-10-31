-- ============================================================================
-- Gerador de artes do cliente
-- ----------------------------------------------------------------------------
-- 1. brand_kits: identidade visual de cada cliente para o gerador de artes
--    (cores, logos no bucket client-logos, unidades com WhatsApp, campanhas
--    liberadas e frase legal). Só a equipe lê e altera (RLS).
-- 2. portal_brand_kit(): o cliente lê a identidade DELE, descoberta pela
--    sessão (não recebe id de cliente). Sem identidade ativa, devolve null.
-- Os logos ficam em client-logos/<client_id>/marca-<arquivo>; as políticas de
-- armazenamento desse bucket (equipe envia/apaga, leitura pública) já existem.
-- ============================================================================

create table public.brand_kits (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default true,
  colors jsonb not null default '{}'::jsonb,
  logos jsonb not null default '{}'::jsonb,
  units jsonb not null default '[]'::jsonb,
  campaigns text[] not null default array['padrao']::text[],
  legal text,
  updated_at timestamptz not null default now(),
  constraint brand_kits_colors_object check (jsonb_typeof(colors) = 'object'),
  constraint brand_kits_logos_object check (jsonb_typeof(logos) = 'object'),
  constraint brand_kits_units_array check (jsonb_typeof(units) = 'array' and jsonb_array_length(units) <= 12),
  constraint brand_kits_campaigns check (campaigns <@ array['padrao','verao','natal','halloween','blackfriday','pascoa','maes','pais','pets']::text[]),
  constraint brand_kits_legal check (legal is null or char_length(legal) <= 200)
);

comment on table public.brand_kits is 'Identidade visual de cada cliente para o gerador de artes (só a equipe edita).';
comment on column public.brand_kits.colors is 'Cores em hexadecimal: primaria, secundaria, preco, alerta, titulo.';
comment on column public.brand_kits.logos is 'Caminhos no bucket client-logos: emblema, principal, alternativo.';
comment on column public.brand_kits.units is 'Unidades: [{id, nome, marca, endereco, whatsapp, logo}] (logo = principal | alternativo).';

alter table public.brand_kits enable row level security;

create policy "Equipe gerencia a identidade das artes" on public.brand_kits
  for all to authenticated
  using ((select private.is_agency_member()))
  with check ((select private.is_agency_member()));

create trigger brand_kits_touch before update on public.brand_kits
  for each row execute function public.touch_updated_at();

-- 2. Leitura do cliente ------------------------------------------------------
create function public.portal_brand_kit() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'client', c.name,
    'colors', k.colors,
    'logos', k.logos,
    'units', k.units,
    'campaigns', to_jsonb(k.campaigns),
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
