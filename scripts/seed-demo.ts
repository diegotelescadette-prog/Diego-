// Carrega perfis FICTÍCIOS de demonstração (separados dos dados de lançamento).
// Uso: npm run seed:demo  (lê .env.local; exige SUPABASE_SERVICE_ROLE_KEY)
// Recria do zero todos os usuários do domínio de demonstração.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

try { process.loadEnvFile('.env.local'); } catch { /* usa variáveis do ambiente */ }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error('Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(url, key, { auth: { persistSession: false } });
const demo = JSON.parse(fs.readFileSync('supabase/demo/providers.json', 'utf8'));
const email = (local: string) => `${local}@${demo.emailDomain}`;

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${JSON.stringify(error)}`);
  return data;
}

async function avatar(name: string, color: string) {
  const initials = name.replace(/\(demo\)/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${color}"/>
    <text x="200" y="245" font-size="150" font-family="Arial, sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

/** Foto de trabalho fictícia (gradiente com legenda), para o feed da tela inicial. */
async function workPhoto(label: string, a: string, b: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/>
    <text x="40" y="560" font-size="40" font-family="Arial, sans-serif" font-weight="bold" fill="#fff">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 75 }).toBuffer();
}

async function main() {
  // remove demo anterior
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list.users.filter((u) => u.email?.endsWith(`@${demo.emailDomain}`))) await sb.auth.admin.deleteUser(u.id);

  const create = async (local: string) =>
    (await must(sb.auth.admin.createUser({ email: email(local), password: demo.password, email_confirm: true }), `criar ${local}`)).user!;

  const adminUser = await create(demo.admin.email);
  await must(sb.from('user_roles').insert({ user_id: adminUser.id, role: 'admin' }), 'papel admin');
  for (const c of demo.clients) await create(c.email);

  const city = await must(sb.from('cities').select('id, timezone').eq('slug', 'campo-grande-ms').single(), 'cidade');
  const nbs = await must(sb.from('neighborhoods').select('id, slug').eq('city_id', city.id), 'bairros');
  const svcs = await must(sb.from('services').select('id, slug'), 'serviços');
  const nb = (s: string) => { const r = nbs.find((n) => n.slug === s); if (!r) throw new Error(`bairro ${s}`); return r.id; };
  const sv = (s: string) => { const r = svcs.find((n) => n.slug === s); if (!r) throw new Error(`serviço ${s}`); return r.id; };
  const { data: expires } = await sb.rpc('availability_expiry', { p_timezone: city.timezone });

  let i = 0;
  for (const p of demo.providers) {
    i++;
    const u = await create(`prestador-${p.key}`);
    const photoPath = `${u.id}/profile-demo.webp`;
    await sb.storage.from('profile-photos').upload(photoPath, await avatar(p.name, p.color), { contentType: 'image/webp', upsert: true });
    await must(sb.from('provider_profiles').insert({
      id: u.id, slug: `${p.key}-demo`, display_name: p.name, bio: p.bio, photo_path: photoPath,
      main_service_id: sv(p.main), city_id: city.id, serves_whole_city: !!p.wholeCity, serves_online: !!p.online,
      status: 'draft', draft_step: 3,
    }), `perfil ${p.key}`);
    await must(sb.from('provider_services').insert(p.services.map((s: string) => ({ provider_id: u.id, service_id: sv(s) }))), 'serviços');
    if (p.areas) await must(sb.from('provider_areas').insert(p.areas.map((a: string) => ({ provider_id: u.id, neighborhood_id: nb(a) }))), 'áreas');
    const n = String(i).padStart(4, '0');
    await must(sb.from('provider_private').insert({
      provider_id: u.id, phone: `6790000${n}`, whatsapp: `6790000${n}`,
      ref_cep: '79002000', ref_street: 'Rua Fictícia', ref_number: String(100 + i), ref_neighborhood: p.ref, ref_city: 'Campo Grande', ref_uf: 'MS',
    }), 'privado');
    for (const [k, label] of (p.work ?? []).entries()) {
      const path = `${u.id}/work-demo-${k}.webp`;
      await sb.storage.from('profile-photos').upload(path, await workPhoto(label, p.color, '#0f172a'), { contentType: 'image/webp', upsert: true });
      await must(sb.from('provider_work_photos').insert({ provider_id: u.id, path, sort: k }), 'foto de trabalho');
    }
    await must(sb.from('provider_profiles').update({ status: p.status ?? 'published', published_at: new Date().toISOString() }).eq('id', u.id), 'status');
    if (p.today && (p.status ?? 'published') === 'published') {
      const inPerson = p.services.map(sv);
      await must(sb.from('availability_today').insert({
        provider_id: u.id, city_id: city.id, whole_city: !!p.today.wholeCity, service_ids: inPerson,
        neighborhood_ids: (p.today.neighborhoods ?? []).map(nb), expires_at: expires,
      }), 'disponibilidade');
    }
    console.log(`✓ ${p.name}`);
  }

  // Publicações de demonstração (mais antiga primeiro), com comentários e "Útil".
  const userBy = new Map((await sb.auth.admin.listUsers({ perPage: 1000 })).data.users.map((u) => [u.email!.split('@')[0], u.id]));
  for (const [local, name] of Object.entries(demo.memberNames ?? {})) {
    await must(sb.from('member_names').upsert({ user_id: userBy.get(local)!, name }), 'nome');
  }
  for (const po of demo.posts ?? []) {
    const authorId = userBy.get(`prestador-${po.author}`)!;
    const color = demo.providers.find((x: { key: string }) => x.key === po.author).color;
    const post = await must(sb.from('posts').insert({ author_id: authorId, body: po.body }).select('id').single(), 'publicação');
    for (const [k, label] of (po.photos ?? []).entries()) {
      const path = `${authorId}/post-demo-${post.id.slice(0, 8)}-${k}.webp`;
      await sb.storage.from('post-media').upload(path, await workPhoto(label, color, '#1c1917'), { contentType: 'image/webp', upsert: true });
      await must(sb.from('post_media').insert({ post_id: post.id, kind: 'foto', path, sort: k }), 'mídia');
    }
    for (const c of po.comments ?? []) await must(sb.from('post_comments').insert({ post_id: post.id, author_id: userBy.get(c.by)!, body: c.body }), 'comentário');
    for (const u of po.useful ?? []) await must(sb.from('post_reactions').insert({ post_id: post.id, user_id: userBy.get(u)! }), 'útil');
    console.log(`✓ publicação de ${po.author}`);
  }

  // Vagas de demonstração (publicadas por uma conta "empresa" fictícia).
  const empresa = await create('empresa');
  for (const j of demo.jobs ?? []) {
    await must(sb.from('jobs').insert({
      poster_id: empresa.id, city_id: city.id, title: j.title, company_name: j.company, description: j.description,
      requirements: j.requirements ?? null, employment_type: j.type, work_mode: j.mode,
      neighborhood_id: j.neighborhood ? nb(j.neighborhood) : null, salary_text: j.salary ?? null, openings: j.openings ?? 1,
    }), `vaga ${j.title}`);
    console.log(`✓ vaga ${j.title}`);
  }

  // Currículo de demonstração no banco de currículos.
  const candidata = await create('candidata');
  const cvPath = `${candidata.id}/banco-demo.pdf`;
  await must(sb.storage.from('curriculos').upload(cvPath, Buffer.from('%PDF-1.4\n% curriculo de demonstracao\n%%EOF\n'), { contentType: 'application/pdf', upsert: true }), 'pdf demo');
  await must(sb.from('talent_profiles').insert({
    user_id: candidata.id, full_name: 'Joana Exemplo (demo)', desired_role: 'Auxiliar administrativo', email: email('candidata'), phone: '67988887777',
    summary: 'Currículo de demonstração. 2 anos como recepcionista, pacote Office, disponível em horário comercial.',
    neighborhood_id: nb('centro'), resume_path: cvPath, resume_filename: 'curriculo-joana.pdf', resume_size: 40, consent_at: new Date().toISOString(),
  }), 'banco de currículos');
  console.log('✓ currículo Joana Exemplo (demo)');
  console.log(`\nAdmin: ${email(demo.admin.email)} / ${demo.password}`);
  console.log(`Cliente: ${email(demo.clients[0].email)} / ${demo.password}`);
  console.log(`Prestadores: prestador-<chave>@${demo.emailDomain} / ${demo.password}`);
  console.log(`Empresa (vagas): ${email('empresa')} / ${demo.password}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
