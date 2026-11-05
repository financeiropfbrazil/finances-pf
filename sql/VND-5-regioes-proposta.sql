-- =====================================================================
-- VND-5 — PROPOSTA de regiões para os países que apareceram na carga
-- (v_nf_saida_paises_sem_regiao em 05/11/2026). NÃO APLICADO.
-- Só INSERT na tabela nova nf_saida_pais_regiao (mantida pelo Pedro).
-- Códigos são os do Alvo (não ISO: CHI = China, CHL = Chile, EC, PL, VE).
-- Rollback: delete from public.nf_saida_pais_regiao where sigla_pais in (...);
-- =====================================================================
insert into public.nf_saida_pais_regiao (sigla_pais, nome_pais, regiao) values
  ('CHL', 'CHILE',     'Latam'),
  ('URU', 'URUGUAI',   'Latam'),
  ('EC',  'EQUADOR',   'Latam'),
  ('ARG', 'ARGENTINA', 'Latam'),
  ('VE',  'VENEZUELA', 'Latam'),
  ('FRA', 'FRANÇA',    'Europa'),
  ('POR', 'PORTUGAL',  'Europa'),
  ('ITA', 'ITALIA',    'Europa'),
  ('PL',  'POLONIA',   'Europa'),
  ('DIN', 'DINAMARCA', 'Europa'),
  ('CHI', 'CHINA',     'Ásia')
on conflict (sigla_pais) do nothing;
