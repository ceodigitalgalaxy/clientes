-- =============================================================================
-- Central de aprovação: excluir lote (mesmo já enviado)
-- -----------------------------------------------------------------------------
-- Antes só dava para apagar lote nunca enviado (os outros, arquivar). Agora a
-- equipe pode excluir qualquer lote pela função approval_batch_delete:
--   - o link para de funcionar na hora (o token sai do Vault);
--   - o histórico do lote (itens, decisões, eventos, links) é apagado;
--   - os conteúdos continuam no calendário; os que ainda aguardavam resposta
--     SÓ por este lote voltam para rascunho (aprovados e ajustes ficam como estão);
--   - as versões congeladas (content_versions) continuam: são do conteúdo.
-- =============================================================================

create function public.approval_batch_delete(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.approval_links;
begin
  if not private.is_agency_member() then raise exception 'sem_permissao'; end if;
  perform 1 from public.approval_batches where id = p_batch for update;
  if not found then raise exception 'lote_nao_encontrado'; end if;

  -- Pendentes só neste lote voltam para rascunho (não ficam "aguardando" sem link)
  update public.contents c
     set approval_status = 'rascunho'
   where c.approval_status in ('aguardando_aprovacao', 'reenviado')
     and c.id in (select i.content_id from public.approval_items i
                   where i.batch_id = p_batch and i.removed_at is null and i.content_id is not null
                     and i.status in ('aguardando_aprovacao', 'reenviado'))
     and not exists (select 1 from public.approval_items o
                       join public.approval_batches ob on ob.id = o.batch_id
                      where o.content_id = c.id and o.batch_id <> p_batch and o.removed_at is null
                        and ob.archived_at is null and o.status in ('aguardando_aprovacao', 'reenviado'));

  -- Tokens guardados no Vault
  for v_link in select * from public.approval_links where batch_id = p_batch loop
    if v_link.secret_id is not null then delete from vault.secrets where id = v_link.secret_id; end if;
  end loop;

  delete from public.approval_decisions where batch_id = p_batch;
  delete from public.approval_batches where id = p_batch;   -- itens, links e eventos vão junto (cascade)
end $$;

revoke all on function public.approval_batch_delete(uuid) from public, anon;
grant execute on function public.approval_batch_delete(uuid) to authenticated;
