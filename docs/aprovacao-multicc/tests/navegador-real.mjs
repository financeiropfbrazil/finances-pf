// Janela isolada para o usuário autenticar o formulário real.
// Não lê cookies, armazenamento da sessão, senhas ou tokens.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'multicc-formulario-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  'https://finance-pf.lovable.app',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let announced = false;
chrome.stderr.on('data', chunk => {
  const match = String(chunk).match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/);
  if (match && !announced) {
    announced = true;
    console.log(`Navegador isolado pronto. Controle local: ${match[1]}`);
    console.log('Entre no Financial Hub nessa janela. Não envie credenciais ao chat.');
  }
});
chrome.on('error', error => { console.error('Não foi possível abrir Chrome:', error.code); process.exitCode = 1; });
chrome.on('exit', code => { console.log(`Janela encerrada (${code}).`); });
