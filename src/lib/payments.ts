// Pagamento dos pedidos. Fase 1: só "na entrega" (Pix ou dinheiro direto ao profissional), registrado no app
// por quem recebeu (profissional ou equipe) com a ação `pago` de `booking_action`.
//
// Para plugar o "Pix garantido" (valor retido até o cliente confirmar o serviço):
// 1. criar um gateway que implemente `PaymentGateway` (ex.: provedor de Pix com conta de garantia);
// 2. no agendamento, chamar `hold()` e gravar `payments.gateway`, `gateway_ref` e status `retido`;
// 3. quando o cliente confirmar o serviço concluído, chamar `release()` (status `pago`);
//    no cancelamento, `refund()` (o banco já marca `estornado` quando o status era `retido`).
// A tabela `payments` e o método `pix_garantido` já existem no banco para isso.

export type PaymentStatus = 'pendente' | 'retido' | 'pago' | 'estornado';

export interface PaymentGateway {
  id: 'na_entrega' | 'pix_garantido';
  /** Reserva o valor no agendamento. Na entrega, não faz nada. */
  hold(bookingId: string, amountCents: number): Promise<{ ref: string | null; status: PaymentStatus }>;
  /** Libera o valor ao profissional depois da confirmação do cliente. */
  release(ref: string | null): Promise<PaymentStatus>;
  /** Devolve o valor ao cliente (cancelamento ou problema). */
  refund(ref: string | null): Promise<PaymentStatus>;
}

export const onDelivery: PaymentGateway = {
  id: 'na_entrega',
  async hold() { return { ref: null, status: 'pendente' }; },
  async release() { return 'pago'; },
  async refund() { return 'estornado'; },
};

export function gatewayFor(method: string): PaymentGateway {
  // Só a entrega está ativa na fase 1.
  void method;
  return onDelivery;
}
