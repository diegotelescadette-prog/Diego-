import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobState, looksLikePdf, parseJob, postedAgo, safeResumeName } from '../../src/lib/jobs.ts';

const ok = {
  title: '  Auxiliar   de cozinha ', company_name: 'Restaurante X', description: 'Preparo de alimentos e organização da cozinha.',
  employment_type: 'clt', work_mode: 'presencial', neighborhood_id: '', salary_text: '', openings: '',
};

test('vaga: valida e normaliza o formulário', () => {
  const r = parseJob(ok);
  assert.deepEqual(r.errors, {});
  assert.equal(r.data!.title, 'Auxiliar de cozinha');
  assert.equal(r.data!.openings, 1);
  assert.equal(r.data!.neighborhood_id, null);
  assert.equal(r.data!.salary_text, null);
  const bad = parseJob({ ...ok, title: 'a', description: 'curta', employment_type: 'escravo', work_mode: 'x', openings: '0', neighborhood_id: '1;drop' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['description', 'employment_type', 'neighborhood_id', 'openings', 'title', 'work_mode']);
  assert.equal(bad.data, undefined);
});

test('currículo: confere assinatura do PDF e limpa o nome do arquivo', () => {
  assert.equal(looksLikePdf(new TextEncoder().encode('%PDF-1.7 ...')), true);
  assert.equal(looksLikePdf(new TextEncoder().encode('<html>%PDF-')), false);
  assert.equal(looksLikePdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), false);
  assert.equal(safeResumeName('C:\\Users\\ana\\Currículo "Ana".PDF'), 'Currículo Ana.pdf');
  assert.equal(safeResumeName('../../etc/passwd'), 'passwd.pdf');
  assert.equal(safeResumeName(''), 'curriculo.pdf');
});

test('vaga: situação e tempo de publicação', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  assert.equal(jobState({ status: 'aberta', expires_at: '2026-11-24T00:00:00Z' }, now), 'vencida');
  assert.equal(jobState({ status: 'aberta', expires_at: '2026-12-24T00:00:00Z' }, now), 'aberta');
  assert.equal(jobState({ status: 'removida', expires_at: '2026-12-24T00:00:00Z' }, now), 'removida');
  assert.equal(postedAgo('2026-11-25T08:00:00Z', now), 'hoje');
  assert.equal(postedAgo('2026-11-24T08:00:00Z', now), 'ontem');
  assert.equal(postedAgo('2026-11-20T08:00:00Z', now), 'há 5 dias');
  assert.equal(postedAgo('2026-09-20T08:00:00Z', now), 'há 2 meses');
});
