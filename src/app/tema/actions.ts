'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

/** Aparência: automático (segue o aparelho), claro ou escuro. Guardado num cookie de um ano. */
export async function setTheme(form: FormData) {
  const v = String(form.get('tema') ?? '');
  const jar = await cookies();
  if (v === 'claro' || v === 'escuro') jar.set('tema', v, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  else jar.delete('tema');
  revalidatePath('/', 'layout');
}
