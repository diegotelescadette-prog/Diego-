-- Atualização do banco que JÁ está em produção: Próximo v3, item 4 (página de entrada).
-- Aplicar DEPOIS de 2026-11-26-cadastro-obrigatorio.sql. Cole no SQL Editor e clique em Run (uma vez só).
-- Não apaga dados. Acrescenta duas funções para a página de entrada: vitrine de vagas (só cargo, bairro e tipo) e números de confiança.
begin;
-- Próximo · v3 item 4: página de entrada (migração aditiva, não apaga dados).
--   1. Vitrine de vagas para quem ainda não tem conta: quantas vagas abertas combinam com a busca e até 5 delas,
--      só com cargo, bairro e tipo (nada de empresa, salário, descrição ou contato). A tabela de vagas continua fechada.
--   2. Números de confiança (profissionais verificados, vagas abertas, serviços concluídos), só contagens.

create or replace function public.entry_job_showcase(p_q text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with q as (select nullif(trim(public.normalize_text(left(coalesce(p_q, ''), 60))), '') as term),
  open_jobs as (
    select j.title, n.name as neighborhood, j.employment_type, j.created_at
      from public.jobs j
      left join public.neighborhoods n on n.id = j.neighborhood_id
      cross join q
     where j.status = 'aberta' and j.expires_at > now() and not j.held
       and (q.term is null or public.normalize_text(j.title) like '%' || q.term || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from open_jobs),
    'vagas', coalesce((select jsonb_agg(jsonb_build_object('cargo', o.title, 'bairro', o.neighborhood, 'tipo', o.employment_type) order by o.created_at desc)
                         from (select * from open_jobs order by created_at desc limit 5) o), '[]'::jsonb))
$$;
revoke execute on function public.entry_job_showcase(text) from public;
grant execute on function public.entry_job_showcase(text) to anon, authenticated, service_role;

create or replace function public.entry_trust_numbers()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'verificados', (select count(*) from public.provider_verification v join public.provider_profiles p on p.id = v.provider_id
                     where v.status = 'aprovado' and p.status = 'published'),
    'vagas', (select count(*) from public.jobs j where j.status = 'aberta' and j.expires_at > now() and not j.held),
    'concluidos', (select count(*) from public.bookings b where b.status = 'concluido'))
$$;
revoke execute on function public.entry_trust_numbers() from public;
grant execute on function public.entry_trust_numbers() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
