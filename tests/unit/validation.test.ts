import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCpf, normalizePhone, normalizeWhatsapp, safeNext, slugify, nextFromEmailLink } from '../../src/lib/validation.ts';

test('CPF: dígitos verificadores (só formato)', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('529.982.247-24'), false);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('123'), false);
});

test('Telefone com DDD', () => {
  assert.equal(normalizePhone('(67) 99999-1234'), '67999991234');
  assert.equal(normalizePhone('+55 67 3321-1234'), '6733211234');
  assert.equal(normalizePhone('067 99999 1234'), '67999991234');
  assert.equal(normalizePhone('(00) 99999-1234'), null, 'DDD inexistente');
  assert.equal(normalizePhone('(67) 89999-1234'), null, 'celular sem 9');
  assert.equal(normalizePhone('99999-1234'), null, 'sem DDD');
  assert.equal(normalizeWhatsapp('(67) 3321-1234'), null, 'WhatsApp precisa ser celular');
});

test('Redirecionamento seguro após login', () => {
  assert.equal(safeNext('/p/joao?servico=encanador'), '/p/joao?servico=encanador');
  assert.equal(safeNext('https://evil.com'), '/');
  assert.equal(safeNext('//evil.com'), '/');
  assert.equal(safeNext('/\\evil.com'), '/');
});

test('slug', () => assert.equal(slugify('João Encanador & Cia'), 'joao-encanador-cia'));

test('next do link de e-mail: aceita só o próprio site e desembrulha /auth/confirm', () => {
  const o = ['https://www.resolveaqui.com.br'];
  assert.equal(nextFromEmailLink('/painel', o), '/painel');
  assert.equal(nextFromEmailLink('https://www.resolveaqui.com.br/auth/confirm?next=/painel', o), '/painel');
  assert.equal(nextFromEmailLink('https://www.resolveaqui.com.br/auth/confirm?next=%2Fredefinir-senha', o), '/redefinir-senha');
  assert.equal(nextFromEmailLink('https://www.resolveaqui.com.br/auth/confirm', o), '/');
  assert.equal(nextFromEmailLink('https://www.resolveaqui.com.br/favoritos?x=1', o), '/favoritos?x=1');
  assert.equal(nextFromEmailLink('https://golpe.com/auth/confirm?next=/painel', o), '/');
  assert.equal(nextFromEmailLink('https://www.resolveaqui.com.br/auth/confirm?next=//golpe.com', o), '/');
  assert.equal(nextFromEmailLink('nada', o), '/');
  assert.equal(nextFromEmailLink(null, o), '/');
});
