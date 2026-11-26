import { permanentRedirect } from 'next/navigation';

/** Endereço antigo das publicações: leva ao novo, na comunidade. */
export default async function PublicacaoAntiga({ params }: { params: Promise<{ id: string }> }) {
  permanentRedirect(`/comunidade/${encodeURIComponent((await params).id)}`);
}
