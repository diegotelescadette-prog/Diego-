import { APP_NAME } from '../config/brand.ts';

/** "Encanador" → "encanador"; mantém siglas como "DJ" e "Técnico de TI" → "técnico de TI". */
export function serviceInSentence(name: string): string {
  if (name.length > 1 && name[1] === name[1].toLowerCase()) return name[0].toLowerCase() + name.slice(1);
  return name;
}

export function urgentMessage(service: string, neighborhood: string, city: string): string {
  return `Olá! Encontrei seu perfil no ${APP_NAME}. Preciso de ${serviceInSentence(service)} hoje no bairro ${neighborhood}, em ${city}. Qual horário você consegue atender?`;
}

export function generalMessage(service: string, place: string | null, online: boolean): string {
  const where = online ? 'com atendimento online' : `em ${place}`;
  return `Olá! Encontrei seu perfil no ${APP_NAME}. Preciso de ${serviceInSentence(service)} ${where}. Você tem disponibilidade?`;
}

/** Link gerado no servidor. O número nunca é enviado para a página antes do clique. */
export function waLink(whatsappDigits: string, message: string): string {
  return `https://wa.me/55${whatsappDigits}?text=${encodeURIComponent(message)}`;
}
