import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, profileId, signIn } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

async function uid(c: SupabaseClient) { return (await c.auth.getUser()).data.user!.id; }
async function demoJob(title: string) {
  const { data } = await admin.from('jobs').select('id, poster_id').eq('title', title).single();
  return data!;
}
async function newJob(c: SupabaseClient, title = 'Vaga do contratante') {
  const { data: city } = await admin.from('cities').select('id').eq('is_pilot', true).single();
  const { data, error } = await c.from('jobs').insert({
    poster_id: await uid(c), city_id: city!.id, title, company_name: 'Mercado Teste', area: 'atendimento-vendas',
    description: 'Descrição longa o bastante para a vaga de teste.', employment_type: 'clt', work_mode: 'presencial',
    salary_min: 1800, salary_max: 2200, schedule_text: 'Seg a sáb, 8h às 16h',
  }).select('id, held').single();
  assert.equal(error, null, error?.message);
  return data!;
}

test('contratante novo: primeira vaga fica guardada até a equipe conferir', async () => {
  const c = await signIn('contratante');
  const job = await newJob(c);
  assert.equal(job.held, true);
  const { data: pub } = await anon().from('jobs').select('id').eq('id', job.id);
  assert.equal(pub!.length, 0, 'vaga guardada não aparece ao público');
  const { data: own } = await c.from('jobs').select('id, held').eq('id', job.id).single();
  assert.equal(own!.held, true, 'quem publicou vê a própria vaga');
  // ninguém se candidata a uma vaga guardada
  const candidata = await signIn('candidata');
  const early = await candidata.rpc('apply_with_resume', { p_job: job.id });
  assert.ok(early.error, 'candidatura em vaga guardada deve falhar');
  // não dá para soltar a vaga mudando o campo direto
  await c.from('jobs').update({ held: false }).eq('id', job.id);
  assert.equal((await admin.from('jobs').select('held').eq('id', job.id).single()).data!.held, true);
  // envia os dados; não consegue se autoverificar
  const sent = await c.rpc('submit_employer_verification', {
    p_kind: 'cnpj', p_cnpj: '11444777000161', p_cpf_ciphertext: null, p_cpf_last2: null,
    p_legal_name: 'Mercado Teste LTDA', p_address: 'Rua Teste, 100', p_neighborhood: null,
  });
  assert.equal(sent.error, null, sent.error?.message);
  const self = await c.rpc('admin_review_employer', { p_user: await uid(c), p_status: 'verificado' });
  assert.ok(self.error);
  const direct = await c.from('employer_verifications').update({ status: 'verificado' }).eq('user_id', await uid(c)).select('user_id');
  assert.equal(direct.data?.length ?? 0, 0);
  // equipe confere: a vaga vai ao ar com o selo
  const adm = await signIn('admin');
  const ok = await adm.rpc('admin_review_employer', { p_user: await uid(c), p_status: 'verificado' });
  assert.equal(ok.error, null, ok.error?.message);
  const { data: live } = await anon().from('jobs').select('id, poster_verified').eq('id', job.id).single();
  assert.equal(live!.poster_verified, true);
  // as próximas entram direto
  const second = await newJob(c, 'Segunda vaga');
  assert.equal(second.held, false);
});

test('empresa verificada: vaga entra no ar com o selo', async () => {
  const { data } = await anon().from('jobs').select('title, poster_verified').eq('title', 'Vendedor(a) de loja (demo)').single();
  assert.equal(data!.poster_verified, true);
});

test('currículo no app: só o dono lê; candidatura em um toque sem telefone', async () => {
  const candidata = await signIn('candidata');
  const empresa = await signIn('empresa');
  const { data: other } = await empresa.from('resumes').select('user_id');
  assert.equal(other!.length, 0, 'empresa não lê currículos direto');
  const job = await demoJob('Vendedor(a) de loja (demo)');
  const r = await candidata.rpc('apply_with_resume', { p_job: job.id, p_message: 'Tenho experiência com caixa.', p_share_phone: false });
  assert.equal(r.error, null, r.error?.message);
  const again = await candidata.rpc('apply_with_resume', { p_job: job.id });
  assert.match(again.error!.message, /already_applied/);
  const { data: app } = await empresa.from('job_applications').select('id, phone, status, resume_snapshot').eq('id', r.data).single();
  assert.equal(app!.phone, null, 'telefone só se a pessoa aceitar');
  assert.equal(app!.status, 'recebida');
  assert.equal(app!.resume_snapshot.headline, 'Auxiliar administrativo');
  assert.equal(app!.resume_snapshot.phone, undefined);
  // abrir o currículo marca "Visualizado"
  await empresa.rpc('mark_application_seen', { p_application: r.data });
  const { data: seen } = await candidata.from('job_applications').select('status').eq('id', r.data).single();
  assert.equal(seen!.status, 'vista');
  // sem currículo no app não dá
  const cliente = await signIn('cliente');
  const none = await cliente.rpc('apply_with_resume', { p_job: job.id });
  assert.match(none.error!.message, /resume_missing/);
  // com telefone, quando aceita
  const job2 = await demoJob('Auxiliar de cozinha (demo)');
  const r2 = await candidata.rpc('apply_with_resume', { p_job: job2.id, p_share_phone: true });
  assert.equal(r2.error, null, r2.error?.message);
  const { data: app2 } = await admin.from('job_applications').select('phone, share_phone').eq('id', r2.data).single();
  assert.equal(app2!.phone, '67988887777');
  assert.equal(app2!.share_phone, true);
});

test('entrevista: convite, resposta e quem pode ver', async () => {
  const candidata = await signIn('candidata');
  const empresa = await signIn('empresa');
  const job = await demoJob('Eletricista para obra (demo)');
  const { data: appId } = await candidata.rpc('apply_with_resume', { p_job: job.id });
  const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
  // a candidata não convida a si mesma; o horário precisa ser futuro
  assert.ok((await candidata.rpc('invite_interview', { p_application: appId, p_starts_at: when, p_mode: 'video', p_place: null, p_video_url: 'https://meet.example.com/x' })).error);
  assert.ok((await empresa.rpc('invite_interview', { p_application: appId, p_starts_at: new Date(Date.now() - 60_000).toISOString(), p_mode: 'video', p_place: null, p_video_url: 'https://meet.example.com/x' })).error);
  const inv = await empresa.rpc('invite_interview', { p_application: appId, p_starts_at: when, p_mode: 'presencial', p_place: 'Rua da Empresa, 10', p_video_url: null, p_note: 'Traga documento.' });
  assert.equal(inv.error, null, inv.error?.message);
  const { data: st } = await candidata.from('job_applications').select('status').eq('id', appId).single();
  assert.equal(st!.status, 'entrevista');
  const { data: mine } = await candidata.from('interviews').select('id, status, place').eq('id', inv.data).single();
  assert.equal(mine!.status, 'proposta');
  const stranger = await signIn('cliente');
  const { data: hidden } = await stranger.from('interviews').select('id').eq('id', inv.data);
  assert.equal(hidden!.length, 0);
  assert.ok((await stranger.rpc('respond_interview', { p_interview: inv.data, p_accept: true })).error);
  assert.ok((await empresa.rpc('respond_interview', { p_interview: inv.data, p_accept: true })).error, 'só o candidato responde');
  const ok = await candidata.rpc('respond_interview', { p_interview: inv.data, p_accept: true });
  assert.equal(ok.error, null, ok.error?.message);
  assert.equal((await empresa.from('interviews').select('status').eq('id', inv.data).single()).data!.status, 'confirmada');
  const cancel = await empresa.rpc('cancel_interview', { p_interview: inv.data, p_reason: 'Vaga preenchida' });
  assert.equal(cancel.error, null);
  assert.equal((await candidata.from('interviews').select('status').eq('id', inv.data).single()).data!.status, 'cancelada');
});

test('pacotes do prestador: desmarcar tira dos pedidos; outro não vê', async () => {
  const carlos = await signIn('prestador-carlos');
  const id = await profileId('carlos');
  const { data: svcs } = await admin.from('provider_services').select('service_id').eq('provider_id', id);
  const { data: pk } = await admin.from('service_packages').select('id').in('service_id', svcs!.map((s) => s.service_id)).limit(1).single();
  const { data: foreign } = await admin.from('service_packages').select('id').not('service_id', 'in', `(${svcs!.map((s) => s.service_id).join(',')})`).limit(1).single();
  const r = await carlos.rpc('set_my_packages', { p_off: [pk!.id, foreign!.id] });
  assert.equal(r.error, null, r.error?.message);
  const { data: off } = await carlos.from('provider_packages_off').select('package_id');
  assert.deepEqual(off!.map((o) => o.package_id), [pk!.id], 'só guarda pacotes dos serviços que ele oferece');
  const cliente = await signIn('cliente');
  assert.equal((await cliente.from('provider_packages_off').select('package_id')).data!.length, 0);
  assert.ok((await cliente.rpc('set_my_packages', { p_off: [] })).error, 'quem não é profissional não usa');
  await carlos.rpc('set_my_packages', { p_off: [] });
});
