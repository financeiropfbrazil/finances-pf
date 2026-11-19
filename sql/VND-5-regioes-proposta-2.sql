-- =====================================================================
-- VND-5 — PROPOSTA 2 de regiões: países que apareceram só depois do
-- detalhe completo (v_nf_saida_paises_sem_regiao em 05/11/2026, fila 0).
-- NÃO APLICADO. Aplicar só com OK do Pedro (tabela mantida por ele).
-- Códigos são os do Alvo (não ISO: IE, PA, UK).
-- Pontos de decisão: MEX (Latam ou América do Norte?) e TUR (Europa ou Ásia?).
-- Rollback: delete from public.nf_saida_pais_regiao
--            where sigla_pais in ('CAN','MEX','COL','PA','PER','IE','UK','TUR');
-- =====================================================================
insert into public.nf_saida_pais_regiao (sigla_pais, nome_pais, regiao) values
  ('CAN', 'CANADA',      'América do Norte'),
  ('MEX', 'MEXICO',      'Latam'),
  ('COL', 'COLOMBIA',    'Latam'),
  ('PA',  'PANAMA',      'Latam'),
  ('PER', 'PERU',        'Latam'),
  ('IE',  'IRLANDA',     'Europa'),
  ('UK',  'REINO UNIDO', 'Europa'),
  ('TUR', 'TURQUIA',     'Europa')
on conflict (sigla_pais) do nothing;
