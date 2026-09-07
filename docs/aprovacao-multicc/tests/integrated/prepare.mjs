import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
export const secret = 'local-multicc-test-secret-at-least-32-characters';
export function jwt(role) {
  const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const body = `${enc({alg:'HS256',typ:'JWT'})}.${enc({role,iss:'supabase-local',iat:1788739200,exp:2104272000})}`;
  return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
writeFileSync(new URL('./.env',import.meta.url), `# Synthetic LOCAL credentials; never use with a remote endpoint.\nANON_KEY=${jwt('anon')}\nSERVICE_KEY=${jwt('service_role')}\n`);
