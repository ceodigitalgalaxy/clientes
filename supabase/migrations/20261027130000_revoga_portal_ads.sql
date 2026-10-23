-- O site usa portal_ad_list() desde a publicação anterior; a função antiga
-- portal_ads() deixa de ser chamável (fica no banco, sem permissão).
revoke execute on function public.portal_ads() from public, anon, authenticated;
