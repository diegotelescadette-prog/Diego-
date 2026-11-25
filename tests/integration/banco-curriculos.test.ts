import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anon, signIn } from './helpers.ts';

const reseed = () => execSync('npm run -s seed:demo', { stdio: 'ignore' });
before(reseed);
after(reseed);

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const uid = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
const bank = async (c: SupabaseClient) => (await c.from('talent_profiles').select('full_name')).data ?? [];

test('banco: só quem tem vaga aberta consulta; visitante, usuário comum e administração não', async () => {
  const empresa = await signIn('empresa');
  assert.ok((await bank(empresa)).some((t) => t.full_name === 'Joana Exemplo (demo)'));
  assert.equal((await empresa.rpc('can_browse_talent')).data, true);
  for (const who of ['cliente', 'prestador-carlos', 'admin']) {
    const c = await signIn(who);
    assert.equal((await bank(c)).length, 0, `${who} não deveria ver o banco`);
  }
  assert.equal((await bank(anon())).length, 0);

  // encerrar todas as vagas tira o acesso
  const { data: jobs } = await admin.from('jobs').select('id').eq('poster_id', await uid(empresa));
  for (const j of jobs!) await empresa.rpc('set_my_job_status', { p_job: j.id, p_status: 'encerrada' });
  assert.equal((await bank(empresa)).length, 0);
  for (const j of jobs!) await empresa.rpc('set_my_job_status', { p_job: j.id, p_status: 'aberta' });
});

test('banco: dono cria, oculta e apaga; não usa arquivo de outra pessoa; prazo renova ao salvar', async () => {
  const cliente = await signIn('cliente');
  const me = await uid(cliente);
  const path = `${me}/banco-${crypto.randomUUID()}.pdf`;
  assert.equal((await cliente.storage.from('curriculos').upload(path, PDF, { contentType: 'application/pdf' })).error, null);
  const row = { user_id: me, full_name: 'Cliente Teste', desired_role: 'Motorista', email: 'c@teste.dev', resume_path: path,
    resume_filename: 'cv.pdf', resume_size: PDF.length, consent_at: new Date().toISOString() };
  const empresa = await signIn('empresa');
  const stolen = await cliente.from('talent_profiles').insert({ ...row, resume_path: `${await uid(empresa)}/x.pdf` });
  assert.ok(stolen.error, 'arquivo precisa estar na pasta do dono');
  const fake = await cliente.from('talent_profiles').insert({ ...row, user_id: await uid(empresa) });
  assert.ok(fake.error, 'não cria em nome de outro');
  const exp = await cliente.from('talent_profiles').insert({ ...row, expires_at: '2099-01-01' });
  assert.ok(exp.error, 'prazo não é definido pelo usuário');
  assert.equal((await cliente.from('talent_profiles').insert(row)).error, null);
  assert.ok((await bank(empresa)).some((t) => t.full_name === 'Cliente Teste'));

  await admin.from('talent_profiles').update({ visible: false }).eq('user_id', me); // força o gatilho com prazo novo
  assert.ok(!(await bank(empresa)).some((t) => t.full_name === 'Cliente Teste'), 'oculto some do banco');
  const { data: own } = await cliente.from('talent_profiles').select('visible, expires_at').single();
  assert.equal(own!.visible, false);
  assert.ok(new Date(own!.expires_at).getTime() > Date.now() + 179 * 86_400_000);

  const del = await empresa.from('talent_profiles').delete().eq('user_id', me).select('user_id');
  assert.equal(del.data?.length ?? 0, 0, 'outro não apaga');
  const mine = await cliente.from('talent_profiles').delete().eq('user_id', me).select('user_id');
  assert.equal(mine.data?.length, 1);
});

test('banco: vencido some da consulta e é apagado após 30 dias (só pelo servidor)', async () => {
  const empresa = await signIn('empresa');
  const { data: j } = await admin.from('talent_profiles').select('user_id').eq('full_name', 'Joana Exemplo (demo)').single();
  await admin.rpc('purge_old_talent'); // nada vencido ainda
  // vence à força direto no banco (o gatilho renovaria o prazo num UPDATE comum)
  execSync(`psql -q -h localhost -p 54322 -U postgres -c "alter table public.talent_profiles disable trigger talent_profiles_check; update public.talent_profiles set expires_at = now() - interval '31 days' where user_id = '${j!.user_id}'; alter table public.talent_profiles enable trigger talent_profiles_check;"`);
  assert.ok(!(await bank(empresa)).some((t) => t.full_name === 'Joana Exemplo (demo)'));
  const cliente = await signIn('cliente');
  assert.ok((await cliente.rpc('purge_old_talent')).error, 'usuário não chama a limpeza');
  const { data } = await admin.rpc('purge_old_talent');
  assert.ok((data as { resume_path: string }[]).length >= 1);
  const { data: left } = await admin.from('talent_profiles').select('user_id').eq('user_id', j!.user_id);
  assert.equal(left!.length, 0);
});
