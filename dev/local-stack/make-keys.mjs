// Gera chaves anon/service_role (JWT HS256) para a stack local de testes.
import crypto from 'node:crypto';
const secret = process.argv[2] || 'super-secret-jwt-token-with-at-least-32-characters-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (role) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ iss: 'supabase-local', role, iat: 1700000000, exp: 2000000000 });
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`; };
console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${sign('anon')}\nSUPABASE_SERVICE_ROLE_KEY=${sign('service_role')}`);
