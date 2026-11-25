import { APP_NAME } from '../config/brand.ts';

/** "Encanador" → "encanador"; mantém siglas como "DJ" e "Técnico de TI" → "técnico de TI". */
export function serviceInSentence(name: string): string {
  if (name.length > 1 && name[1] === name[1].toLowerCase()) return name[0].toLowerCase() + name.slice(1);
  return name;
}

/** Sem bairro escolhido ("Todos os bairros"), a mensagem diz só a cidade. */
export function urgentMessage(service: string, neighborhood: string | null, city: string): string {
  const where = neighborhood ? `no bairro ${neighborhood}, em ${city}` : `em ${city}`;
  return `Olá! Encontrei seu perfil no ${APP_NAME}. Preciso de ${serviceInSentence(service)} hoje ${where}. Qual horário você consegue atender?`;
}

/** Texto da área para os cards: "Atende toda Campo Grande" ou "Atende: Centro, Amambaí". */
export function areaText(label: string | null | undefined): string | null {
  if (!label) return null;
  if (label.startsWith('Toda ')) return `Atende toda ${label.slice(5)}`;
  if (label === 'Atendimento online') return label;
  return `Atende: ${label}`;
}

export function generalMessage(service: string, place: string | null, online: boolean): string {
  const where = online ? 'com atendimento online' : `em ${place}`;
  return `Olá! Encontrei seu perfil no ${APP_NAME}. Preciso de ${serviceInSentence(service)} ${where}. Você tem disponibilidade?`;
}

/** Link gerado no servidor. O número nunca é enviado para a página antes do clique. */
export function waLink(whatsappDigits: string, message: string): string {
  return `https://wa.me/55${whatsappDigits}?text=${encodeURIComponent(message)}`;
}
