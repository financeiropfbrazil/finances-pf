// Janela isolada para o usuário autenticar o formulário real.
// Não lê cookies, armazenamento da sessão, senhas ou tokens.
import { spawn } from 'node:child_process';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

// Reabre apenas um diretório isolado deste launcher. O próprio Chrome recupera
// sua sessão; este script nunca lê os arquivos de autenticação do navegador.
const existing = process.argv[2] ? resolve(process.argv[2]) : null;
if (existing && ((await realpath(dirname(existing))).toLowerCase() !== (await realpath(tmpdir())).toLowerCase() || !basename(existing).startsWith('multicc-formulario-'))) {
  throw Error('Use somente o diretório temporário isolado criado para este aceite.');
}
const profile = existing || await mkdtemp(join(tmpdir(), 'multicc-formulario-'));
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
