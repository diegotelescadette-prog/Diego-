-- Resolve Aqui · dados iniciais de lançamento (editáveis pelo painel administrativo).
-- Gerado por dev/gen_catalog.py. Bairros de Campo Grande: lista inicial, revisar com a operação.

insert into public.app_settings(key, value) values ('cpf_collection', '{"enabled": false, "purpose": null, "necessity_confirmed": false}') on conflict do nothing;
insert into public.cities (name, uf, slug, timezone, is_pilot) values ('Campo Grande', 'MS', 'campo-grande-ms', 'America/Campo_Grande', true);
insert into public.neighborhoods (city_id, name, slug) select c.id, v.name, v.slug from public.cities c, (values
  ('Aero Rancho', 'aero-rancho'),
  ('Alves Pereira', 'alves-pereira'),
  ('Amambaí', 'amambai'),
  ('América', 'america'),
  ('Autonomista', 'autonomista'),
  ('Bandeira', 'bandeira'),
  ('Batistão', 'batistao'),
  ('Bela Vista', 'bela-vista'),
  ('Cabreúva', 'cabreuva'),
  ('Caiçara', 'caicara'),
  ('Carandá', 'caranda'),
  ('Carandá Bosque', 'caranda-bosque'),
  ('Carlota', 'carlota'),
  ('Centenário', 'centenario'),
  ('Centro', 'centro'),
  ('Chácara Cachoeira', 'chacara-cachoeira'),
  ('Chácara dos Poderes', 'chacara-dos-poderes'),
  ('Coophavila II', 'coophavila-ii'),
  ('Coronel Antonino', 'coronel-antonino'),
  ('Cruzeiro', 'cruzeiro'),
  ('Dr. Albuquerque', 'dr-albuquerque'),
  ('Estrela Dalva', 'estrela-dalva'),
  ('Glória', 'gloria'),
  ('Guanandi', 'guanandi'),
  ('Itanhangá', 'itanhanga'),
  ('Jacy', 'jacy'),
  ('Jardim dos Estados', 'jardim-dos-estados'),
  ('Jardim Paulista', 'jardim-paulista'),
  ('Jockey Club', 'jockey-club'),
  ('José Abrão', 'jose-abrao'),
  ('Lageado', 'lageado'),
  ('Leblon', 'leblon'),
  ('Los Angeles', 'los-angeles'),
  ('Margarida', 'margarida'),
  ('Maria Aparecida Pedrossian', 'maria-aparecida-pedrossian'),
  ('Mata do Jacinto', 'mata-do-jacinto'),
  ('Mata do Segredo', 'mata-do-segredo'),
  ('Monte Castelo', 'monte-castelo'),
  ('Monte Carlo', 'monte-carlo'),
  ('Moreninha', 'moreninha'),
  ('Nasser', 'nasser'),
  ('Noroeste', 'noroeste'),
  ('Nova Campo Grande', 'nova-campo-grande'),
  ('Nova Lima', 'nova-lima'),
  ('Novos Estados', 'novos-estados'),
  ('Panamá', 'panama'),
  ('Parati', 'parati'),
  ('Pioneiros', 'pioneiros'),
  ('Piratininga', 'piratininga'),
  ('Planalto', 'planalto'),
  ('Popular', 'popular'),
  ('Rita Vieira', 'rita-vieira'),
  ('Santa Fé', 'santa-fe'),
  ('Santo Amaro', 'santo-amaro'),
  ('Santo Antônio', 'santo-antonio'),
  ('São Bento', 'sao-bento'),
  ('São Conrado', 'sao-conrado'),
  ('São Francisco', 'sao-francisco'),
  ('São Lourenço', 'sao-lourenco'),
  ('Seminário', 'seminario'),
  ('Sobrinho', 'sobrinho'),
  ('Taquarussu', 'taquarussu'),
  ('Taveirópolis', 'taveiropolis'),
  ('Tijuca', 'tijuca'),
  ('Tiradentes', 'tiradentes'),
  ('TV Morena', 'tv-morena'),
  ('Universitário', 'universitario'),
  ('Vilasboas', 'vilasboas')) as v(name, slug) where c.slug = 'campo-grande-ms';

insert into public.service_categories (name, slug, sort) values ('Construção e reformas', 'construcao-e-reformas', 1);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Pedreiro', 'pedreiro', 'presencial', false, 1),
  ('Servente', 'servente', 'presencial', false, 2),
  ('Empreiteiro', 'empreiteiro', 'presencial', false, 3),
  ('Mestre de obras', 'mestre-de-obras', 'presencial', false, 4),
  ('Gesseiro', 'gesseiro', 'presencial', false, 5),
  ('Instalador de drywall', 'instalador-de-drywall', 'presencial', false, 6),
  ('Azulejista', 'azulejista', 'presencial', false, 7),
  ('Assentador de piso e porcelanato', 'assentador-de-piso-e-porcelanato', 'presencial', false, 8),
  ('Impermeabilizador', 'impermeabilizador', 'presencial', false, 9),
  ('Telhadista', 'telhadista', 'presencial', false, 10),
  ('Instalador de calhas', 'instalador-de-calhas', 'presencial', false, 11),
  ('Instalador de forro', 'instalador-de-forro', 'presencial', false, 12)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'construcao-e-reformas';
insert into public.service_categories (name, slug, sort) values ('Marcenaria, carpintaria e mobiliário', 'marcenaria-carpintaria-e-mobiliario', 2);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Marceneiro', 'marceneiro', 'presencial', false, 1),
  ('Carpinteiro', 'carpinteiro', 'presencial', false, 2),
  ('Montador de móveis', 'montador-de-moveis', 'presencial', false, 3),
  ('Instalador de móveis planejados', 'instalador-de-moveis-planejados', 'presencial', false, 4),
  ('Restaurador de móveis', 'restaurador-de-moveis', 'presencial', false, 5),
  ('Estofador', 'estofador', 'presencial', false, 6),
  ('Tapeceiro', 'tapeceiro', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'marcenaria-carpintaria-e-mobiliario';
insert into public.service_categories (name, slug, sort) values ('Pintura e acabamentos', 'pintura-e-acabamentos', 3);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Pintor residencial', 'pintor-residencial', 'presencial', false, 1),
  ('Pintor comercial', 'pintor-comercial', 'presencial', false, 2),
  ('Aplicador de textura', 'aplicador-de-textura', 'presencial', false, 3),
  ('Instalador de papel de parede', 'instalador-de-papel-de-parede', 'presencial', false, 4),
  ('Instalador de cortinas e persianas', 'instalador-de-cortinas-e-persianas', 'presencial', false, 5),
  ('Marmorista', 'marmorista', 'presencial', false, 6)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'pintura-e-acabamentos';
insert into public.service_categories (name, slug, sort) values ('Hidráulica e manutenção', 'hidraulica-e-manutencao', 4);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Encanador', 'encanador', 'presencial', true, 1),
  ('Bombeiro hidráulico', 'bombeiro-hidraulico', 'presencial', false, 2),
  ('Caça-vazamentos', 'caca-vazamentos', 'presencial', false, 3),
  ('Desentupidor', 'desentupidor', 'presencial', false, 4),
  ('Limpador de caixa d’água', 'limpador-de-caixa-dagua', 'presencial', false, 5),
  ('Instalador de filtros', 'instalador-de-filtros', 'presencial', false, 6),
  ('Marido de aluguel', 'marido-de-aluguel', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'hidraulica-e-manutencao';
insert into public.service_categories (name, slug, sort) values ('Elétrica e climatização', 'eletrica-e-climatizacao', 5);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Eletricista', 'eletricista', 'presencial', true, 1),
  ('Técnico de ar-condicionado', 'tecnico-de-ar-condicionado', 'presencial', true, 2),
  ('Técnico de refrigeração', 'tecnico-de-refrigeracao', 'presencial', false, 3),
  ('Instalador de energia solar', 'instalador-de-energia-solar', 'presencial', false, 4),
  ('Instalador de ventilador', 'instalador-de-ventilador', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'eletrica-e-climatizacao';
insert into public.service_categories (name, slug, sort) values ('Portas, janelas e segurança', 'portas-janelas-e-seguranca', 6);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Serralheiro', 'serralheiro', 'presencial', false, 1),
  ('Soldador', 'soldador', 'presencial', false, 2),
  ('Vidraceiro', 'vidraceiro', 'presencial', false, 3),
  ('Chaveiro', 'chaveiro', 'presencial', true, 4),
  ('Instalador de esquadrias', 'instalador-de-esquadrias', 'presencial', false, 5),
  ('Técnico de portão eletrônico', 'tecnico-de-portao-eletronico', 'presencial', false, 6),
  ('Instalador de câmeras, alarmes e interfone', 'instalador-de-cameras-alarmes-e-interfone', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'portas-janelas-e-seguranca';
insert into public.service_categories (name, slug, sort) values ('Piscina, jardim e área externa', 'piscina-jardim-e-area-externa', 7);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Piscineiro', 'piscineiro', 'presencial', false, 1),
  ('Instalador de piscinas', 'instalador-de-piscinas', 'presencial', false, 2),
  ('Jardineiro', 'jardineiro', 'presencial', false, 3),
  ('Paisagista', 'paisagista', 'presencial', false, 4),
  ('Podador de árvores', 'podador-de-arvores', 'presencial', false, 5),
  ('Roçador', 'rocador', 'presencial', false, 6),
  ('Operador de lavagem de alta pressão', 'operador-de-lavagem-de-alta-pressao', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'piscina-jardim-e-area-externa';
insert into public.service_categories (name, slug, sort) values ('Limpeza e conservação', 'limpeza-e-conservacao', 8);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Diarista', 'diarista', 'presencial', false, 1),
  ('Faxineiro', 'faxineiro', 'presencial', false, 2),
  ('Limpador pós-obra', 'limpador-pos-obra', 'presencial', false, 3),
  ('Limpador de vidros', 'limpador-de-vidros', 'presencial', false, 4),
  ('Higienizador de sofás e colchões', 'higienizador-de-sofas-e-colchoes', 'presencial', false, 5),
  ('Dedetizador', 'dedetizador', 'presencial', false, 6),
  ('Passadeira', 'passadeira', 'presencial', false, 7),
  ('Organizador residencial', 'organizador-residencial', 'presencial', false, 8)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'limpeza-e-conservacao';
insert into public.service_categories (name, slug, sort) values ('Tecnologia e eletrônicos', 'tecnologia-e-eletronicos', 9);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Técnico de TI', 'tecnico-de-ti', 'ambos', false, 1),
  ('Técnico de computadores', 'tecnico-de-computadores', 'presencial', false, 2),
  ('Técnico de celulares', 'tecnico-de-celulares', 'presencial', false, 3),
  ('Técnico de impressoras', 'tecnico-de-impressoras', 'presencial', false, 4),
  ('Instalador de Wi-Fi e redes', 'instalador-de-wi-fi-e-redes', 'presencial', false, 5),
  ('Técnico de TV', 'tecnico-de-tv', 'presencial', false, 6),
  ('Suporte remoto', 'suporte-remoto', 'online', false, 7),
  ('Desenvolvedor', 'desenvolvedor', 'online', false, 8),
  ('Web designer', 'web-designer', 'online', false, 9)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'tecnologia-e-eletronicos';
insert into public.service_categories (name, slug, sort) values ('Eletrodomésticos', 'eletrodomesticos', 10);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Técnico de geladeira e freezer', 'tecnico-de-geladeira-e-freezer', 'presencial', false, 1),
  ('Técnico de máquina de lavar', 'tecnico-de-maquina-de-lavar', 'presencial', false, 2),
  ('Técnico de fogão e forno', 'tecnico-de-fogao-e-forno', 'presencial', false, 3),
  ('Técnico de micro-ondas', 'tecnico-de-micro-ondas', 'presencial', false, 4),
  ('Técnico de pequenos eletrodomésticos', 'tecnico-de-pequenos-eletrodomesticos', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'eletrodomesticos';
insert into public.service_categories (name, slug, sort) values ('Automotivo', 'automotivo', 11);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Mecânico', 'mecanico', 'presencial', false, 1),
  ('Eletricista automotivo', 'eletricista-automotivo', 'presencial', false, 2),
  ('Borracharia móvel', 'borracharia-movel', 'presencial', false, 3),
  ('Guincho', 'guincho', 'presencial', false, 4),
  ('Chaveiro automotivo', 'chaveiro-automotivo', 'presencial', false, 5),
  ('Funileiro', 'funileiro', 'presencial', false, 6),
  ('Pintor automotivo', 'pintor-automotivo', 'presencial', false, 7),
  ('Instalador de som automotivo', 'instalador-de-som-automotivo', 'presencial', false, 8),
  ('Detalhador automotivo', 'detalhador-automotivo', 'presencial', false, 9)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'automotivo';
insert into public.service_categories (name, slug, sort) values ('Transporte e entregas', 'transporte-e-entregas', 12);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Frete', 'frete', 'presencial', false, 1),
  ('Carreto', 'carreto', 'presencial', false, 2),
  ('Mudança residencial', 'mudanca-residencial', 'presencial', false, 3),
  ('Ajudante de mudança', 'ajudante-de-mudanca', 'presencial', false, 4),
  ('Motoboy', 'motoboy', 'presencial', false, 5),
  ('Entregador', 'entregador', 'presencial', false, 6)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'transporte-e-entregas';
insert into public.service_categories (name, slug, sort) values ('Beleza e cuidados pessoais', 'beleza-e-cuidados-pessoais', 13);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Cabeleireiro', 'cabeleireiro', 'presencial', false, 1),
  ('Barbeiro', 'barbeiro', 'presencial', false, 2),
  ('Manicure', 'manicure', 'presencial', false, 3),
  ('Pedicure', 'pedicure', 'presencial', false, 4),
  ('Maquiador', 'maquiador', 'presencial', false, 5),
  ('Designer de sobrancelhas', 'designer-de-sobrancelhas', 'presencial', false, 6),
  ('Depilador', 'depilador', 'presencial', false, 7)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'beleza-e-cuidados-pessoais';
insert into public.service_categories (name, slug, sort) values ('Pets', 'pets', 14);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Banho e tosa', 'banho-e-tosa', 'presencial', false, 1),
  ('Passeador de cães', 'passeador-de-caes', 'presencial', false, 2),
  ('Cuidador de animais', 'cuidador-de-animais', 'presencial', false, 3),
  ('Adestrador', 'adestrador', 'presencial', false, 4),
  ('Transporte pet', 'transporte-pet', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'pets';
insert into public.service_categories (name, slug, sort) values ('Eventos e alimentação', 'eventos-e-alimentacao', 15);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Fotógrafo', 'fotografo', 'presencial', false, 1),
  ('Videomaker', 'videomaker', 'presencial', false, 2),
  ('DJ', 'dj', 'presencial', false, 3),
  ('Decorador de festas', 'decorador-de-festas', 'presencial', false, 4),
  ('Garçom', 'garcom', 'presencial', false, 5),
  ('Churrasqueiro', 'churrasqueiro', 'presencial', false, 6),
  ('Cozinheiro', 'cozinheiro', 'presencial', false, 7),
  ('Confeiteiro', 'confeiteiro', 'presencial', false, 8),
  ('Buffet', 'buffet', 'presencial', false, 9),
  ('Locador de mesas e cadeiras', 'locador-de-mesas-e-cadeiras', 'presencial', false, 10),
  ('Técnico de som e iluminação', 'tecnico-de-som-e-iluminacao', 'presencial', false, 11)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'eventos-e-alimentacao';
insert into public.service_categories (name, slug, sort) values ('Aulas e serviços profissionais', 'aulas-e-servicos-profissionais', 16);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Professor particular', 'professor-particular', 'ambos', false, 1),
  ('Professor de idiomas', 'professor-de-idiomas', 'ambos', false, 2),
  ('Instrutor de música', 'instrutor-de-musica', 'ambos', false, 3),
  ('Tradutor', 'tradutor', 'online', false, 4),
  ('Revisor', 'revisor', 'online', false, 5),
  ('Designer gráfico', 'designer-grafico', 'online', false, 6),
  ('Social media', 'social-media', 'online', false, 7),
  ('Assistente virtual', 'assistente-virtual', 'online', false, 8),
  ('Contador', 'contador', 'ambos', false, 9)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'aulas-e-servicos-profissionais';
insert into public.service_categories (name, slug, sort) values ('Confecção e consertos', 'confeccao-e-consertos', 17);
insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values
  ('Costureira', 'costureira', 'presencial', false, 1),
  ('Alfaiate', 'alfaiate', 'presencial', false, 2),
  ('Ajuste de roupas', 'ajuste-de-roupas', 'presencial', false, 3),
  ('Sapateiro', 'sapateiro', 'presencial', false, 4),
  ('Bordadeira', 'bordadeira', 'presencial', false, 5)) as v(name, slug, mode, urgent_pilot, sort) where c.slug = 'confeccao-e-consertos';

insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['vazamento', 'cano', 'encanamento', 'torneira', 'registro', 'descarga', 'hidraulica', 'cano furado', 'agua vazando', 'conserto de cano']) t where s.slug = 'encanador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['vazamento', 'infiltracao', 'caca vazamento', 'vazamento oculto', 'conta de agua alta']) t where s.slug = 'caca-vazamentos' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['entupimento', 'pia entupida', 'vaso entupido', 'esgoto', 'ralo entupido', 'desentupir']) t where s.slug = 'desentupidor' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['tomada', 'disjuntor', 'curto', 'curto circuito', 'fiacao', 'chuveiro queimado', 'queda de energia', 'instalacao eletrica', 'quadro de luz', 'luz']) t where s.slug = 'eletricista' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['chave', 'fechadura', 'porta trancada', 'trancado', 'copia de chave', 'abrir porta', 'perdi a chave']) t where s.slug = 'chaveiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['chave de carro', 'chave codificada', 'carro trancado']) t where s.slug = 'chaveiro-automotivo' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['ar condicionado', 'ar-condicionado', 'split', 'instalar ar', 'limpeza de ar', 'ar pingando', 'climatizacao', 'manutencao de ar']) t where s.slug = 'tecnico-de-ar-condicionado' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['refrigeracao', 'camara fria']) t where s.slug = 'tecnico-de-refrigeracao' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['limpeza de piscina', 'limpar piscina', 'piscina verde', 'tratamento de piscina', 'piscina']) t where s.slug = 'piscineiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['t.i.', 'ti', 'informatica', 'suporte tecnico']) t where s.slug = 'tecnico-de-ti' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['formatar computador', 'formatacao', 'formatar', 'computador', 'pc', 'notebook', 'computador lento', 'conserto de notebook']) t where s.slug = 'tecnico-de-computadores' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['celular', 'tela quebrada', 'troca de tela', 'smartphone']) t where s.slug = 'tecnico-de-celulares' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['wifi', 'internet', 'roteador', 'rede']) t where s.slug = 'instalador-de-wi-fi-e-redes' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['suporte online', 'ajuda no computador']) t where s.slug = 'suporte-remoto' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['faxina', 'limpeza de casa', 'limpeza']) t where s.slug = 'diarista' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['faxina', 'limpeza']) t where s.slug = 'faxineiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['obra', 'reforma', 'construcao', 'muro']) t where s.slug = 'pedreiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pintura', 'pintar parede', 'pintar casa']) t where s.slug = 'pintor-residencial' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pequenos reparos', 'faz tudo', 'reparos']) t where s.slug = 'marido-de-aluguel' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['montar movel', 'montagem de moveis', 'montar guarda roupa']) t where s.slug = 'montador-de-moveis' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['jardim', 'cortar grama', 'grama']) t where s.slug = 'jardineiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['rocada', 'terreno sujo', 'limpar terreno']) t where s.slug = 'rocador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['dedetizacao', 'barata', 'cupim', 'pragas']) t where s.slug = 'dedetizador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['carro', 'oficina', 'motor']) t where s.slug = 'mecanico' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['reboque', 'carro quebrado']) t where s.slug = 'guincho' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pneu furado', 'pneu', 'borracheiro']) t where s.slug = 'borracharia-movel' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['transporte', 'carreto']) t where s.slug = 'frete' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['mudanca']) t where s.slug = 'mudanca-residencial' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['geladeira', 'freezer', 'geladeira nao gela']) t where s.slug = 'tecnico-de-geladeira-e-freezer' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['maquina de lavar', 'lavadora']) t where s.slug = 'tecnico-de-maquina-de-lavar' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['caixa dagua', 'caixa d agua', 'limpeza de caixa']) t where s.slug = 'limpador-de-caixa-dagua' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['pet shop', 'tosa', 'banho em cachorro']) t where s.slug = 'banho-e-tosa' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['aula particular', 'reforco escolar', 'aulas']) t where s.slug = 'professor-particular' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['contabilidade', 'imposto de renda', 'mei']) t where s.slug = 'contador' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['costura', 'barra de calca']) t where s.slug = 'costureira' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['portao', 'portao eletronico', 'motor de portao']) t where s.slug = 'tecnico-de-portao-eletronico' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['camera', 'cftv', 'alarme', 'interfone']) t where s.slug = 'instalador-de-cameras-alarmes-e-interfone' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['vidro', 'box de banheiro', 'vidro quebrado']) t where s.slug = 'vidraceiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['grade', 'portao de ferro', 'serralheria']) t where s.slug = 'serralheiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['gesso', 'sanca']) t where s.slug = 'gesseiro' on conflict do nothing;
insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array['placa solar', 'energia solar', 'painel solar']) t where s.slug = 'instalador-de-energia-solar' on conflict do nothing;
