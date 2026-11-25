import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, signIn } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function uid(c: SupabaseClient) { return (await c.auth.getUser()).data.user!.id; }
async function demoJob(title: string) {
  const { data } = await admin.from('jobs').select('id, poster_id').eq('title', title).single();
  return data!;
}
async function newJob(c: SupabaseClient, extra: Record<string, unknown> = {}) {
  const { data: city } = await admin.from('cities').select('id').eq('is_pilot', true).single();
  const { data, error } = await c.from('jobs').insert({
    poster_id: await uid(c), city_id: city!.id, title: 'Teste de vaga', company_name: 'Empresa Teste',
    description: 'Descrição longa o bastante para a vaga de teste.', employment_type: 'clt', work_mode: 'presencial', ...extra,
  }).select('id').single();
  assert.equal(error, null, error?.message);
  return data!.id as string;
}
async function apply(c: SupabaseClient, jobId: string, pathOwner?: string) {
  const me = await uid(c);
  const path = `${pathOwner ?? me}/${crypto.randomUUID()}.pdf`;
  if (!pathOwner) {
    const up = await c.storage.from('curriculos').upload(path, PDF, { contentType: 'application/pdf' });
    assert.equal(up.error, null, up.error?.message);
  }
  return c.from('job_applications').insert({
    job_id: jobId, applicant_id: me, full_name: 'Cliente Teste', email: 'cliente@teste.dev', phone: '67999991234',
    resume_path: path, resume_filename: 'cv.pdf', resume_size: PDF.length, consent_at: new Date().toISOString(),
  }).select('id').single();
}

test('vagas: visitante vê só as abertas; quem publicou vê as próprias encerradas', async () => {
  const { data } = await anon().from('jobs').select('title');
  assert.equal(data!.length, 3);
  const empresa = await signIn('empresa');
  const job = await demoJob('Eletricista para obra (demo)');
  const r = await empresa.rpc('set_my_job_status', { p_job: job.id, p_status: 'encerrada' });
  assert.equal(r.error, null);
  const { data: after } = await anon().from('jobs').select('title');
  assert.ok(!after!.some((j) => j.title === 'Eletricista para obra (demo)'));
  const { data: own } = await empresa.from('jobs').select('title, status').eq('id', job.id).single();
  assert.equal(own!.status, 'encerrada');
  // reabrir renova o prazo
  await empresa.rpc('set_my_job_status', { p_job: job.id, p_status: 'aberta' });
  const { data: again } = await anon().from('jobs').select('expires_at').eq('id', job.id).single();
  assert.ok(new Date(again!.expires_at).getTime() > Date.now() + 29 * 86_400_000);
});

test('vagas: ninguém publica em nome de outro nem altera status/prazo direto', async () => {
  const cliente = await signIn('cliente');
  const empresaJob = await demoJob('Vendedor(a) de loja (demo)');
  const { data: city } = await admin.from('cities').select('id').eq('is_pilot', true).single();
  const fake = await cliente.from('jobs').insert({
    poster_id: empresaJob.poster_id, city_id: city!.id, title: 'Golpe', company_name: 'X Y',
    description: 'Descrição longa o bastante para a vaga.', employment_type: 'clt', work_mode: 'presencial',
  });
  assert.ok(fake.error, 'não pode publicar como outra pessoa');
  const upd = await cliente.from('jobs').update({ title: 'Alterado' }).eq('id', empresaJob.id).select('id');
  assert.equal(upd.data?.length ?? 0, 0, 'não altera vaga de outro');
  const empresa = await signIn('empresa');
  const st = await empresa.from('jobs').update({ status: 'removida' }).eq('id', empresaJob.id);
  assert.ok(st.error, 'status só muda pelas funções');
  const exp = await empresa.from('jobs').update({ expires_at: '2099-01-01' }).eq('id', empresaJob.id);
  assert.ok(exp.error, 'prazo só muda pelas funções');
  const bad = await cliente.rpc('set_my_job_status', { p_job: empresaJob.id, p_status: 'encerrada' });
  assert.ok(bad.error);
});

test('currículo: só o candidato e quem publicou leem; nem outro usuário nem a administração', async () => {
  const cliente = await signIn('cliente');
  const job = await demoJob('Auxiliar de cozinha (demo)');
  const ins = await apply(cliente, job.id);
  assert.equal(ins.error, null, ins.error?.message);
  const appId = ins.data!.id;

  const empresa = await signIn('empresa');
  const seen = await empresa.from('job_applications').select('full_name, resume_path').eq('id', appId);
  assert.equal(seen.data?.length, 1);
  for (const who of ['prestador-carlos', 'admin']) {
    const c = await signIn(who);
    const { data } = await c.from('job_applications').select('id').eq('id', appId);
    assert.equal(data?.length ?? 0, 0, `${who} não pode ver a candidatura`);
  }
  const { data: anonRows } = await anon().from('job_applications').select('id');
  assert.equal(anonRows?.length ?? 0, 0);

  // status: só quem publicou
  const self = await cliente.rpc('set_application_status', { p_application: appId, p_status: 'em_contato' });
  assert.ok(self.error, 'candidato não muda a situação');
  const direct = await cliente.from('job_applications').update({ status: 'em_contato' }).eq('id', appId);
  assert.ok(direct.error);
  const ok = await empresa.rpc('set_application_status', { p_application: appId, p_status: 'em_contato' });
  assert.equal(ok.error, null);

  // duplicada
  const dup = await apply(cliente, job.id);
  assert.equal(dup.error?.code, '23505');

  // a vaga encerrada continua visível para o candidato (e some do público)
  await empresa.rpc('set_my_job_status', { p_job: job.id, p_status: 'encerrada' });
  const { data: mine } = await cliente.from('job_applications').select('jobs(title, status)').eq('id', appId).single();
  assert.equal((mine!.jobs as unknown as { status: string }).status, 'encerrada');
  await empresa.rpc('set_my_job_status', { p_job: job.id, p_status: 'aberta' });

  // candidato desiste: pode apagar a própria candidatura
  const del = await cliente.from('job_applications').delete().eq('id', appId).select('id');
  assert.equal(del.data?.length, 1);
});

test('candidatura: barra vaga própria, arquivo de outra pessoa e vaga encerrada', async () => {
  const empresa = await signIn('empresa');
  const cliente = await signIn('cliente');
  const job = await demoJob('Vendedor(a) de loja (demo)');
  const own = await apply(empresa, job.id);
  assert.match(own.error?.message ?? '', /própria vaga/);
  const other = await apply(cliente, job.id, await uid(empresa));
  assert.ok(other.error, 'caminho do arquivo precisa ser da pasta do candidato');
  const up = await cliente.storage.from('curriculos').upload(`${await uid(empresa)}/x.pdf`, PDF, { contentType: 'application/pdf' });
  assert.ok(up.error, 'não grava na pasta de outra pessoa');
  await empresa.rpc('set_my_job_status', { p_job: job.id, p_status: 'encerrada' });
  const closed = await apply(cliente, job.id);
  assert.match(closed.error?.message ?? '', /não está mais recebendo/);
  await empresa.rpc('set_my_job_status', { p_job: job.id, p_status: 'aberta' });
});

test('moderação: remove vaga com motivo; quem publicou não reabre; usuário comum não modera', async () => {
  const cliente = await signIn('cliente');
  const jobId = await newJob(cliente);
  const empresa = await signIn('empresa');
  const denied = await empresa.rpc('admin_set_job_status', { p_job: jobId, p_status: 'removida', p_note: 'x' });
  assert.ok(denied.error);
  const rep = await empresa.from('job_reports').insert({ reporter_id: await uid(empresa), job_id: jobId, reason: 'cobra_taxa' });
  assert.equal(rep.error, null);
  const a = await signIn('admin');
  const noNote = await a.rpc('admin_set_job_status', { p_job: jobId, p_status: 'removida', p_note: '' });
  assert.ok(noNote.error);
  const r = await a.rpc('admin_set_job_status', { p_job: jobId, p_status: 'removida', p_note: 'Cobrava taxa' });
  assert.equal(r.error, null);
  const { data: pub } = await anon().from('jobs').select('id').eq('id', jobId);
  assert.equal(pub!.length, 0);
  const reopen = await cliente.rpc('set_my_job_status', { p_job: jobId, p_status: 'aberta' });
  assert.match(reopen.error?.message ?? '', /moderação/);
  const { data: log } = await a.rpc('admin_moderation_log', { p_target: jobId });
  assert.equal((log as { action: string }[])[0].action, 'remover_vaga');
});

test('retenção: candidaturas de vaga encerrada há mais de 90 dias são apagadas (só pelo servidor)', async () => {
  const cliente = await signIn('cliente');
  const empresa = await signIn('empresa');
  const jobId = await newJob(empresa, { title: 'Vaga antiga' });
  const ins = await apply(cliente, jobId);
  assert.equal(ins.error, null);
  const blocked = await cliente.rpc('purge_old_applications');
  assert.ok(blocked.error, 'usuário não chama a limpeza');
  await admin.from('jobs').update({ status: 'encerrada', closed_at: new Date(Date.now() - 91 * 86_400_000).toISOString() }).eq('id', jobId);
  const { data, error } = await admin.rpc('purge_old_applications');
  assert.equal(error, null);
  assert.ok((data as { resume_path: string }[]).length >= 1);
  const { data: left } = await admin.from('job_applications').select('id').eq('job_id', jobId);
  assert.equal(left!.length, 0);
});
