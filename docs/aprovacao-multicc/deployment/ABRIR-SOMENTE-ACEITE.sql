-- Executar somente após conferir publicação real do gateway, Edge e frontend.
-- Não altera lideranças nem libera cron. Participantes existentes do roteiro.
begin;
set local lock_timeout='5s';
lock table public.compras_requisicoes in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.compras_requisicoes where envio_token is not null and numero_alvo is null)
 or exists(select 1 from public.compras_requisicoes where status in ('pendente_aprovacao','aprovada','pendente_envio','erro_envio'))
 then raise exception 'PARAR: há transição ou envio sem confirmação'; end if;
 if not exists(select 1 from public.compras_requisicoes_janela where id and modo='fechada')
 then raise exception 'Janela não está fechada; revisar estado'; end if;
 if (select count(*) from public.profiles where is_active and user_id in (
 '0b52e262-2fd2-4e84-b414-456b8eb6df65','4f31e294-46d8-404d-90ee-79ff2b409907',
 'e96876e1-57d3-4ca2-ac14-c20931e95489','b2c4e39f-8c54-45aa-a195-610b22963e3e'))<>4
 then raise exception 'Participante ausente/inativo; revisar cadastro sem inferir substituto'; end if;
end $$;
update public.compras_requisicoes_janela set modo='aceite',atualizada_em=now(),usuarios=array[
 '0b52e262-2fd2-4e84-b414-456b8eb6df65','4f31e294-46d8-404d-90ee-79ff2b409907',
 'e96876e1-57d3-4ca2-ac14-c20931e95489','b2c4e39f-8c54-45aa-a195-610b22963e3e']::uuid[] where id;
commit;
