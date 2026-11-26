import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, monthLabel, parseResume, periodLabel, resumeProgress } from '../../src/lib/resume.ts';

const j = (v: unknown) => JSON.stringify(v);

test('currículo: valida, limpa e descarta linhas vazias', () => {
  const r = parseResume({
    full_name: '  Joana   Exemplo ', headline: 'Auxiliar administrativo', email: 'joana@exemplo.com', phone: '(67) 99999-1234', neighborhood_id: '3',
    experiences: j([{ role: 'Recepcionista', company: 'Clínica X', start: '2022-03', end: '2023-05' }, { role: '', company: '' }]),
    education: j([{ course: 'Ensino médio', school: 'EE Y', status: 'completo' }]),
    skills: j(['Excel', 'Excel', ' Atendimento ', '']),
    references_list: j([{ name: 'Maria', relation: 'Ex-chefe', phone: '67 98888-7777' }]),
  });
  assert.deepEqual(r.errors, {});
  assert.equal(r.data!.full_name, 'Joana Exemplo');
  assert.equal(r.data!.phone, '67999991234');
  assert.equal(r.data!.experiences.length, 1);
  assert.deepEqual(r.data!.skills, ['Excel', 'Atendimento']);
  assert.equal(r.data!.references_list[0].phone, '67988887777');
});

test('currículo: erros claros', () => {
  const r = parseResume({ full_name: 'Jo', headline: '', email: 'x@', phone: '123', experiences: j([{ role: 'Caixa' }]), references_list: j([{ name: 'Ana', phone: '1' }]), skills: 'não é json' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'experiences', 'full_name', 'headline', 'phone', 'references_list']);
  assert.equal(r.data, undefined);
});

test('currículo: barra de progresso diz o que falta', () => {
  const r = emptyResume('Joana Exemplo', 'joana@exemplo.com');
  assert.equal(resumeProgress(r).percent, 0);
  r.headline = 'Auxiliar administrativo'; r.neighborhood_id = 1;
  r.summary = 'Organizada e pontual, gosto de atender pessoas.';
  r.experiences = [{ role: 'Recepcionista', company: 'Clínica', start: '', end: '', current: true, description: '' }];
  r.education = [{ course: 'Ensino médio', school: '', end: '', status: 'completo' }];
  r.skills = ['Excel', 'Atendimento', 'Caixa'];
  const p = resumeProgress(r);
  assert.equal(p.percent, 80);
  assert.equal(p.label, '80% completo · falta adicionar uma referência');
  r.references_list = [{ name: 'Maria', relation: '', phone: '67988887777' }];
  r.photo_path = 'u/foto.jpg';
  assert.equal(resumeProgress(r).label, '100% completo');
});

test('currículo: período por extenso', () => {
  assert.equal(monthLabel('2023-02'), 'fev. de 2023');
  assert.equal(monthLabel('2021'), '2021');
  assert.equal(periodLabel({ start: '2022-03', end: '', current: true }), 'mar. de 2022 a atual');
  assert.equal(periodLabel({ start: '', end: '2020', current: false }), '2020');
});
