# Gera supabase/migrations/20261125000400_catalog_seed.sql (dados de lançamento editáveis)
import unicodedata, re
def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',s).strip('-')
def q(s): return "'" + s.replace("'", "''") + "'"

cats = [
("Construção e reformas", "Pedreiro, servente, empreiteiro, mestre de obras, gesseiro, instalador de drywall, azulejista, assentador de piso e porcelanato, impermeabilizador, telhadista, instalador de calhas, instalador de forro"),
("Marcenaria, carpintaria e mobiliário", "Marceneiro, carpinteiro, montador de móveis, instalador de móveis planejados, restaurador de móveis, estofador, tapeceiro"),
("Pintura e acabamentos", "Pintor residencial, pintor comercial, aplicador de textura, instalador de papel de parede, instalador de cortinas e persianas, marmorista"),
("Hidráulica e manutenção", "Encanador, bombeiro hidráulico, caça-vazamentos, desentupidor, limpador de caixa d’água, instalador de filtros, marido de aluguel"),
("Elétrica e climatização", "Eletricista, técnico de ar-condicionado, técnico de refrigeração, instalador de energia solar, instalador de ventilador"),
("Portas, janelas e segurança", "Serralheiro, soldador, vidraceiro, chaveiro, instalador de esquadrias, técnico de portão eletrônico, instalador de câmeras, alarmes e interfone"),
("Piscina, jardim e área externa", "Piscineiro, instalador de piscinas, jardineiro, paisagista, podador de árvores, roçador, operador de lavagem de alta pressão"),
("Limpeza e conservação", "Diarista, faxineiro, limpador pós-obra, limpador de vidros, higienizador de sofás e colchões, dedetizador, passadeira, organizador residencial"),
("Tecnologia e eletrônicos", "Técnico de TI, técnico de computadores, técnico de celulares, técnico de impressoras, instalador de Wi-Fi e redes, técnico de TV, suporte remoto, desenvolvedor, web designer"),
("Eletrodomésticos", "Técnico de geladeira e freezer, técnico de máquina de lavar, técnico de fogão e forno, técnico de micro-ondas, técnico de pequenos eletrodomésticos"),
("Automotivo", "Mecânico, eletricista automotivo, borracharia móvel, guincho, chaveiro automotivo, funileiro, pintor automotivo, instalador de som automotivo, detalhador automotivo"),
("Transporte e entregas", "Frete, carreto, mudança residencial, ajudante de mudança, motoboy, entregador"),
("Beleza e cuidados pessoais", "Cabeleireiro, barbeiro, manicure, pedicure, maquiador, designer de sobrancelhas, depilador"),
("Pets", "Banho e tosa, passeador de cães, cuidador de animais, adestrador, transporte pet"),
("Eventos e alimentação", "Fotógrafo, videomaker, DJ, decorador de festas, garçom, churrasqueiro, cozinheiro, confeiteiro, buffet, locador de mesas e cadeiras, técnico de som e iluminação"),
("Aulas e serviços profissionais", "Professor particular, professor de idiomas, instrutor de música, tradutor, revisor, designer gráfico, social media, assistente virtual, contador"),
("Confecção e consertos", "Costureira, alfaiate, ajuste de roupas, sapateiro, bordadeira"),
]
# "instalador de câmeras, alarmes e interfone" é um único serviço
def split(items):
    parts=[p.strip() for p in items.split(',')]
    out=[]; i=0
    while i<len(parts):
        if parts[i]=='instalador de câmeras': out.append('instalador de câmeras, alarmes e interfone'); i+=2; continue
        out.append(parts[i]); i+=1
    return [p[0].upper()+p[1:] for p in out]

online = {"Suporte remoto","Desenvolvedor","Web designer","Designer gráfico","Social media","Assistente virtual","Tradutor","Revisor"}
ambos = {"Técnico de TI","Professor particular","Professor de idiomas","Instrutor de música","Contador"}
urgent = {"Encanador","Eletricista","Chaveiro","Técnico de ar-condicionado"}

syn = {
 "Encanador": ["vazamento","cano","encanamento","torneira","registro","descarga","hidraulica","cano furado","agua vazando","conserto de cano"],
 "Caça-vazamentos": ["vazamento","infiltracao","caca vazamento","vazamento oculto","conta de agua alta"],
 "Desentupidor": ["entupimento","pia entupida","vaso entupido","esgoto","ralo entupido","desentupir"],
 "Eletricista": ["tomada","disjuntor","curto","curto circuito","fiacao","chuveiro queimado","queda de energia","instalacao eletrica","quadro de luz","luz"],
 "Chaveiro": ["chave","fechadura","porta trancada","trancado","copia de chave","abrir porta","perdi a chave"],
 "Chaveiro automotivo": ["chave de carro","chave codificada","carro trancado"],
 "Técnico de ar-condicionado": ["ar condicionado","ar-condicionado","split","instalar ar","limpeza de ar","ar pingando","climatizacao","manutencao de ar"],
 "Técnico de refrigeração": ["refrigeracao","camara fria"],
 "Piscineiro": ["limpeza de piscina","limpar piscina","piscina verde","tratamento de piscina","piscina"],
 "Técnico de TI": ["t.i.","ti","informatica","suporte tecnico"],
 "Técnico de computadores": ["formatar computador","formatacao","formatar","computador","pc","notebook","computador lento","conserto de notebook"],
 "Técnico de celulares": ["celular","tela quebrada","troca de tela","smartphone"],
 "Instalador de Wi-Fi e redes": ["wifi","internet","roteador","rede"],
 "Suporte remoto": ["suporte online","ajuda no computador"],
 "Diarista": ["faxina","limpeza de casa","limpeza"],
 "Faxineiro": ["faxina","limpeza"],
 "Pedreiro": ["obra","reforma","construcao","muro"],
 "Pintor residencial": ["pintura","pintar parede","pintar casa"],
 "Marido de aluguel": ["pequenos reparos","faz tudo","reparos"],
 "Montador de móveis": ["montar movel","montagem de moveis","montar guarda roupa"],
 "Jardineiro": ["jardim","cortar grama","grama"],
 "Roçador": ["rocada","terreno sujo","limpar terreno"],
 "Dedetizador": ["dedetizacao","barata","cupim","pragas"],
 "Mecânico": ["carro","oficina","motor"],
 "Guincho": ["reboque","carro quebrado"],
 "Borracharia móvel": ["pneu furado","pneu","borracheiro"],
 "Frete": ["transporte","carreto"],
 "Mudança residencial": ["mudanca"],
 "Técnico de geladeira e freezer": ["geladeira","freezer","geladeira nao gela"],
 "Técnico de máquina de lavar": ["maquina de lavar","lavadora"],
 "Limpador de caixa d’água": ["caixa dagua","caixa d agua","limpeza de caixa"],
 "Banho e tosa": ["pet shop","tosa","banho em cachorro"],
 "Professor particular": ["aula particular","reforco escolar","aulas"],
 "Contador": ["contabilidade","imposto de renda","mei"],
 "Costureira": ["costura","barra de calca"],
 "Técnico de portão eletrônico": ["portao","portao eletronico","motor de portao"],
 "Instalador de câmeras, alarmes e interfone": ["camera","cftv","alarme","interfone"],
 "Vidraceiro": ["vidro","box de banheiro","vidro quebrado"],
 "Serralheiro": ["grade","portao de ferro","serralheria"],
 "Gesseiro": ["gesso","sanca"],
 "Instalador de energia solar": ["placa solar","energia solar","painel solar"],
}

neighborhoods = """Aero Rancho; Alves Pereira; Amambaí; América; Autonomista; Bandeira; Batistão; Bela Vista; Cabreúva; Caiçara; Carandá; Carandá Bosque; Carlota; Centenário; Centro; Chácara Cachoeira; Chácara dos Poderes; Coophavila II; Coronel Antonino; Cruzeiro; Dr. Albuquerque; Estrela Dalva; Glória; Guanandi; Itanhangá; Jacy; Jardim dos Estados; Jardim Paulista; Jockey Club; José Abrão; Lageado; Leblon; Los Angeles; Margarida; Maria Aparecida Pedrossian; Mata do Jacinto; Mata do Segredo; Monte Castelo; Monte Carlo; Moreninha; Nasser; Noroeste; Nova Campo Grande; Nova Lima; Novos Estados; Panamá; Parati; Pioneiros; Piratininga; Planalto; Popular; Rita Vieira; Santa Fé; Santo Amaro; Santo Antônio; São Bento; São Conrado; São Francisco; São Lourenço; Seminário; Sobrinho; Taquarussu; Taveirópolis; Tijuca; Tiradentes; TV Morena; Universitário; Vilasboas"""
nbs=[n.strip() for n in neighborhoods.split(';')]

L=["-- Resolve Aqui · dados iniciais de lançamento (editáveis pelo painel administrativo).",
   "-- Gerado por dev/gen_catalog.py. Bairros de Campo Grande: lista inicial, revisar com a operação.",""]
L.append("insert into public.app_settings(key, value) values ('cpf_collection', '{\"enabled\": false, \"purpose\": null, \"necessity_confirmed\": false}') on conflict do nothing;")
L.append("insert into public.cities (name, uf, slug, timezone, is_pilot) values ('Campo Grande', 'MS', 'campo-grande-ms', 'America/Campo_Grande', true);")
L.append("insert into public.neighborhoods (city_id, name, slug) select c.id, v.name, v.slug from public.cities c, (values")
L.append(",\n".join(f"  ({q(n)}, {q(slug(n))})" for n in nbs) + ") as v(name, slug) where c.slug = 'campo-grande-ms';")
L.append("")
seen=set(); all_services=[]
for i,(c,items) in enumerate(cats):
    L.append(f"insert into public.service_categories (name, slug, sort) values ({q(c)}, {q(slug(c))}, {i+1});")
    vals=[]
    for j,s in enumerate(split(items)):
        sl=slug(s); assert sl not in seen, sl; seen.add(sl); all_services.append(s)
        mode='online' if s in online else 'ambos' if s in ambos else 'presencial'
        vals.append(f"  ({q(s)}, {q(sl)}, '{mode}', {'true' if s in urgent else 'false'}, {j+1})")
    L.append("insert into public.services (category_id, name, slug, mode, urgent_pilot, sort) select c.id, v.* from public.service_categories c, (values\n" + ",\n".join(vals) + f") as v(name, slug, mode, urgent_pilot, sort) where c.slug = {q(slug(c))};")
L.append("")
for s, terms in syn.items():
    assert s in all_services, s
    L.append(f"insert into public.service_synonyms (service_id, term) select s.id, t from public.services s, unnest(array[{', '.join(q(t) for t in terms)}]) t where s.slug = {q(slug(s))} on conflict do nothing;")
open('supabase/migrations/20261125000400_catalog_seed.sql','w').write("\n".join(L)+"\n")
print(len(all_services), "services", len(nbs), "neighborhoods")
