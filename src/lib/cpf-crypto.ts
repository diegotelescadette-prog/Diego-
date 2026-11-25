import 'server-only';
import crypto from 'node:crypto';

function key(): Buffer {
  const k = Buffer.from(process.env.CPF_ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('CPF_ENCRYPTION_KEY ausente ou inválida (32 bytes em base64)');
  return k;
}

/** Cifra o CPF (AES-256-GCM). O texto claro nunca é gravado nem registrado em log. */
export function encryptCpf(cpfDigits: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(cpfDigits, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptCpf(payload: string): string {
  const [, iv, tag, enc] = payload.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
