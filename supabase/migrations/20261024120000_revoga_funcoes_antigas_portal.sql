-- O portal publicado usa portal_client(), portal_calendar() e portal_decide().
-- As funções antigas deixam de ser chamáveis pelo navegador.
revoke execute on function public.portal_profile() from public, anon, authenticated;
revoke execute on function public.portal_contents(date, date) from public, anon, authenticated;
