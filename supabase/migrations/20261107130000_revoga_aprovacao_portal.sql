-- Aprovação passa a ser combinada no grupo do cliente: o portal usa só
-- portal_agenda() (sem a referência). As funções antigas deixam de ser
-- chamáveis pelo cliente (ficam no banco; para religar, um GRANT basta).
--   portal_calendar   ainda entregava o link da referência
--   portal_decide     aprovar/pedir ajuste de conteúdo pelo portal
--   portal_ad_list    aba de anúncios do portal
--   portal_ad_decide  aprovar/pedir alterações de anúncio pelo portal
revoke execute on function public.portal_calendar(date, date) from public, anon, authenticated;
revoke execute on function public.portal_decide(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.portal_ad_list() from public, anon, authenticated;
revoke execute on function public.portal_ad_decide(uuid, integer, text, text) from public, anon, authenticated;
