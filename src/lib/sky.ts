/**
 * Fotos reais do céu de Campo Grande, uma por período (manhã, tarde e noite pelo horário da cidade).
 * Fotos do Wikimedia Commons; a licença pede o crédito, que fica no canto da foto.
 */
export const SKY = {
  manha: { src: '/ceu/dia.webp', pos: '50% 30%', alt: 'Céu azul sobre os prédios de Campo Grande', credit: 'Rodrigo Santos · CC BY 3.0', href: 'https://commons.wikimedia.org/wiki/File:Skyline_de_CG_visto_da_Av._Salgado_Filho_-_panoramio.jpg' },
  tarde: { src: '/ceu/tarde.webp', pos: '50% 45%', alt: 'Pôr do sol refletido no lago, com prédios de Campo Grande', credit: 'Camilo Carromeu · domínio público', href: 'https://commons.wikimedia.org/wiki/File:Por_do_sol.jpg' },
  noite: { src: '/ceu/noite.webp', pos: '50% 35%', alt: 'Céu azul do anoitecer na Praça Nazareth, em Campo Grande', credit: 'bigfield767 · CC BY-SA 3.0', href: 'https://commons.wikimedia.org/wiki/File:Entardecer_-_Pra%C3%A7a_Nazareth_-_panoramio.jpg' },
} as const;

export function skyPeriod(hour: number): keyof typeof SKY {
  return hour >= 5 && hour < 12 ? 'manha' : hour >= 12 && hour < 18 ? 'tarde' : 'noite';
}


/** Hora cheia (0 a 23) no fuso da cidade. */
export function hourIn(timeZone: string): number {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
}
