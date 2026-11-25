import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generalMessage, urgentMessage, waLink } from '../../src/lib/whatsapp.ts';

test('mensagem do fluxo urgente', () => {
  assert.equal(urgentMessage('Encanador', 'Centro', 'Campo Grande'),
    'Olá! Encontrei seu perfil no Resolve Aqui. Preciso de encanador hoje no bairro Centro, em Campo Grande. Qual horário você consegue atender?');
});
test('mensagem da busca geral (local e online)', () => {
  assert.equal(generalMessage('Piscineiro', 'Carandá Bosque, Campo Grande', false),
    'Olá! Encontrei seu perfil no Resolve Aqui. Preciso de piscineiro em Carandá Bosque, Campo Grande. Você tem disponibilidade?');
  assert.equal(generalMessage('Técnico de TI', null, true),
    'Olá! Encontrei seu perfil no Resolve Aqui. Preciso de técnico de TI com atendimento online. Você tem disponibilidade?');
  assert.equal(generalMessage('DJ', 'Campo Grande', false).includes('Preciso de DJ em'), true);
});
test('link wa.me com DDI 55 e texto codificado', () => {
  assert.equal(waLink('67999991234', 'Olá!'), 'https://wa.me/5567999991234?text=Ol%C3%A1!');
});
