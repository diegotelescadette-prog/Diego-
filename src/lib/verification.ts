// Verificação do perfil e selos públicos. Módulo puro (servidor e navegador).

export type VerificationStatus = 'rascunho' | 'em_analise' | 'pendencia' | 'aprovado';
export type RefResult = 'a_conferir' | 'confirmada' | 'nao_confirmada';

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  rascunho: 'Rascunho', em_analise: 'Em análise', pendencia: 'Pendência', aprovado: 'Aprovado',
};
export const VERIFICATION_STYLE: Record<VerificationStatus, string> = {
  rascunho: 'bg-stone-200 text-stone-900', em_analise: 'bg-sky-100 text-sky-900',
  pendencia: 'bg-amber-100 text-amber-900', aprovado: 'bg-green-100 text-green-900',
};
export const REF_LABEL: Record<RefResult, string> = {
  a_conferir: 'A conferir', confirmada: 'Confirmada', nao_confirmada: 'Não confirmada',
};

/** Próximo passo mostrado ao prestador em cada situação. */
export function verificationNext(status: VerificationStatus, reason?: string | null): string {
  switch (status) {
    case 'rascunho': return 'Preencha seus dados e as referências e envie para análise.';
    case 'em_analise': return 'A equipe está conferindo seus dados e entrando em contato com as referências. Você pode corrigir algo e reenviar.';
    case 'pendencia': return reason ? `Corrija o que a equipe pediu e reenvie: ${reason}` : 'Corrija o que a equipe pediu e reenvie para análise.';
    case 'aprovado': return 'Cadastro conferido. Os selos aparecem no seu perfil e nas suas publicações.';
  }
}

export interface Badges { identity: boolean; refs: number; experience: number | null }

/** Textos dos selos: só checagens que aconteceram. */
export function badgeTexts(b: Badges | null | undefined): { key: string; text: string; hint: string }[] {
  if (!b) return [];
  const out: { key: string; text: string; hint: string }[] = [];
  if (b.identity) out.push({ key: 'id', text: 'Identidade conferida', hint: 'A equipe conferiu o nome e o documento de identidade deste profissional.' });
  if (b.refs > 0) out.push({ key: 'refs', text: b.refs === 1 ? '1 referência conferida' : `${b.refs} referências conferidas`, hint: 'A equipe falou com clientes indicados pelo profissional e eles confirmaram o serviço.' });
  if (b.experience !== null && b.experience > 0) out.push({ key: 'exp', text: `Experiência informada: ${b.experience === 1 ? '1 ano' : `${b.experience} anos`}`, hint: 'Tempo de experiência declarado pelo próprio profissional.' });
  return out;
}

export const BADGES_DISCLAIMER = 'Os selos mostram apenas as checagens feitas pela equipe. Não são garantia de qualidade ou segurança do serviço. Combine detalhes e valores diretamente com o profissional.';

/** Promessas proibidas em publicações (crédito e cobrança antecipada). */
export function forbiddenPromise(text: string): string | null {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/(aprovacao|credito|financiamento|emprestimo)\s+(100%\s+)?garantid/.test(t)) return 'Não prometa aprovação garantida de crédito.';
  if (/(pagamento|taxa|deposito|pix)\s+(\w+\s+)?antecipad/.test(t) || /antecipe\s+(o\s+)?(pagamento|taxa|deposito)/.test(t)) return 'Não peça pagamento antecipado para liberar crédito ou serviço.';
  return null;
}
