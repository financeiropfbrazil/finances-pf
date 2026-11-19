-- NFE-1 — rollback: tira as 3 RPCs de escrita. Só com ordem do Pedro.
-- ⚠️ Depois da NFE-2 (tabelas fechadas), sem estas RPCs a tela perde upload de XML e vínculo de pedido:
-- desfazer a NFE-2 antes, ou aceitar a perda.
drop function public.compras_nfe_desvincular(uuid);
drop function public.compras_nfe_vincular_pedidos(uuid, jsonb);
drop function public.compras_nfe_importar_xml(jsonb, text);
