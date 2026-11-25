import { NextResponse } from 'next/server';
import { onlyDigits } from '@/lib/validation';

/** Sugestão de endereço pelo CEP (ViaCEP). Se falhar, a pessoa digita manualmente. */
export async function GET(_: Request, { params }: { params: Promise<{ cep: string }> }) {
  const cep = onlyDigits((await params).cep);
  if (cep.length !== 8) return NextResponse.json({ error: 'CEP inválido' }, { status: 400 });
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } });
    const j = await res.json();
    if (!res.ok || j.erro) return NextResponse.json({ error: 'CEP não encontrado' }, { status: 404 });
    return NextResponse.json({ street: j.logradouro ?? '', neighborhood: j.bairro ?? '', city: j.localidade ?? '', uf: j.uf ?? '' });
  } catch {
    return NextResponse.json({ error: 'Serviço de CEP indisponível. Preencha manualmente.' }, { status: 503 });
  }
}
