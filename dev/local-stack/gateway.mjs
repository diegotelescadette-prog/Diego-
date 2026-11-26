// Gateway de testes locais que imita a API do Supabase em http://localhost:54321
//   /auth/v1/*    → GoTrue (supabase/auth) em :9999
//   /rest/v1/*    → PostgREST em :3001
//   /storage/v1/* → stub simples em disco (aplica a mesma regra de pasta do dono; bucket privado de currículos só via service_role/dono)
// Também sobe um "caixa de e-mails" SMTP em :2500, consultável em GET /_mail.
// Use somente em desenvolvimento/testes. Em produção, use um projeto Supabase.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const STORAGE_DIR = process.env.STORAGE_DIR || '/opt/minisb/storage';
const PORT = Number(process.env.GATEWAY_PORT || 54321);
const mails = [];

function verifyJwt(token) {
  try {
    const [h, p, s] = token.split('.');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
    if (sig !== s) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function proxy(req, res, port, stripPrefix) {
  const target = req.url.slice(stripPrefix.length) || '/';
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  const up = http.request({ host: '127.0.0.1', port, path: target, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}

function readBody(req) {
  return new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });
}

const PUBLIC_BUCKETS = new Set(['profile-photos']);
// Links assinados (bucket privado post-media): token HMAC com caminho e validade.
const signToken = (url, exp) => `${exp}.${crypto.createHmac('sha256', JWT_SECRET).update(`${url}|${exp}`).digest('base64url')}`;
const tokenOk = (url, token) => {
  const [exp, sig] = String(token || '').split('.');
  return Number(exp) * 1000 > Date.now() && sig && signToken(url, exp) === `${exp}.${sig}`;
};
function serveFile(req, res, file) {
  const size = fs.statSync(file).size;
  const type = mimeOf(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'private, max-age=60' });
  return fs.createReadStream(file).pipe(res);
}
const mimeOf = (f) => ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' })[path.extname(f).toLowerCase()] ?? 'image/webp';

async function storage(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/storage\/v1/, '');
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m = p.match(/^\/object\/public\/([^/]+)\/(.+)$/);
  if (m && req.method === 'GET') {
    if (!PUBLIC_BUCKETS.has(m[1])) return json(400, { statusCode: '404', error: 'Bucket not found' }); // só os buckets públicos
    const file = path.join(STORAGE_DIR, m[1], decodeURIComponent(m[2]));
    if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return json(404, { error: 'not_found' });
    res.writeHead(200, { 'content-type': mimeOf(file), 'cache-control': 'public, max-age=60' });
    return fs.createReadStream(file).pipe(res);
  }
  m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/);
  if (m && req.method === 'GET') {
    const name = decodeURIComponent(m[2]);
    if (!tokenOk(`${m[1]}/${name}`, url.searchParams.get('token'))) return json(400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' });
    const file = path.join(STORAGE_DIR, m[1], name);
    if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return json(404, { error: 'not_found' });
    return serveFile(req, res, file);
  }
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  const claims = verifyJwt(auth);
  if (!claims) return json(401, { error: 'unauthorized' });
  // Gerar links assinados: service_role (qualquer arquivo) ou o dono da pasta.
  m = p.match(/^\/object\/sign\/([^/]+)(?:\/(.+))?$/);
  if (m && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn || 60);
    const sign = (name) => {
      if (claims.role !== 'service_role' && name.split('/')[0] !== claims.sub) return { path: name, signedURL: null, error: 'not_found' };
      if (!fs.existsSync(path.join(STORAGE_DIR, m[1], name))) return { path: name, signedURL: null, error: 'Object not found' };
      return { path: name, error: null, signedURL: `/object/sign/${m[1]}/${encodeURI(name)}?token=${signToken(`${m[1]}/${name}`, exp)}` };
    };
    if (m[2]) {
      const r = sign(decodeURIComponent(m[2]));
      return r.error ? json(400, { statusCode: '404', error: r.error }) : json(200, { signedURL: r.signedURL });
    }
    return json(200, (body.paths || []).map(sign));
  }
  m = p.match(/^\/object\/([^/]+)\/(.+)$/);
  if (m && (req.method === 'POST' || req.method === 'PUT')) {
    const name = decodeURIComponent(m[2]);
    if (claims.role !== 'service_role' && name.split('/')[0] !== claims.sub) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    const ct = req.headers['content-type'] || '';
    if (m[1] === 'profile-photos' && !ct.startsWith('image/webp')) return json(415, { error: 'invalid_mime_type' });
    if (m[1] === 'curriculos' && !ct.startsWith('application/pdf')) return json(415, { error: 'invalid_mime_type' });
    if (m[1] === 'post-media' && !/^(image\/webp|video\/(mp4|quicktime|webm))/.test(ct)) return json(415, { error: 'invalid_mime_type' });
    const body = await readBody(req);
    if (body.length > ({ curriculos: 4, 'post-media': 50 }[m[1]] ?? 2) * 1024 * 1024) return json(413, { error: 'Payload too large' });
    const file = path.join(STORAGE_DIR, m[1], name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return json(200, { Key: `${m[1]}/${name}`, Id: crypto.randomUUID() });
  }
  // Download autenticado (bucket privado): só service_role ou o dono da pasta.
  if (m && req.method === 'GET') {
    const name = decodeURIComponent(m[2]);
    if (claims.role !== 'service_role' && name.split('/')[0] !== claims.sub) return json(400, { error: 'not_found' });
    const file = path.join(STORAGE_DIR, m[1], name);
    if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return json(400, { statusCode: '404', error: 'not_found' });
    res.writeHead(200, { 'content-type': m[1] === 'curriculos' ? 'application/pdf' : 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  m = p.match(/^\/object\/([^/]+)$/);
  if (m && req.method === 'DELETE') {
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
    const removed = [];
    for (const name of prefixes) {
      if (claims.role !== 'service_role' && name.split('/')[0] !== claims.sub) continue;
      const file = path.join(STORAGE_DIR, m[1], name);
      if (fs.existsSync(file)) { fs.rmSync(file); removed.push({ name }); }
    }
    return json(200, removed);
  }
  return json(404, { error: 'not_implemented_in_stub' });
}

http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url.startsWith('/auth/v1')) return proxy(req, res, 9999, '/auth/v1');
  if (req.url.startsWith('/rest/v1')) return proxy(req, res, 3001, '/rest/v1');
  if (req.url.startsWith('/storage/v1')) return storage(req, res);
  if (req.url.startsWith('/_mail')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(mails)); }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`gateway em :${PORT}`));

// SMTP mínimo (aceita tudo, guarda em memória)
net.createServer((sock) => {
  let data = false, buf = '', msg = { from: '', to: [], raw: '' };
  sock.write('220 local ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
      if (data) {
        if (line === '.') {
          data = false;
          const raw = msg.raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
          mails.push({ to: msg.to, raw, at: new Date().toISOString() });
          msg = { from: '', to: [], raw: '' };
          sock.write('250 OK\r\n');
        } else msg.raw += line + '\n';
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO')) sock.write('250-local\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
      else if (cmd.startsWith('HELO')) sock.write('250 OK\r\n');
      else if (cmd.startsWith('AUTH')) sock.write('235 OK\r\n');
      else if (cmd.startsWith('MAIL FROM')) { msg.from = line; sock.write('250 OK\r\n'); }
      else if (cmd.startsWith('RCPT TO')) { msg.to.push(line.replace(/.*<|>.*/g, '')); sock.write('250 OK\r\n'); }
      else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
}).listen(2500);
