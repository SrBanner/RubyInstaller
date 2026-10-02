import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { assert } from './errors.mjs';
export function brand() {
  const red = process.stdout.isTTY && !process.env.NO_COLOR ? '\x1b[38;2;224;17;95m' : '', reset = red ? '\x1b[0m' : '';
  console.log(`\n${red}◆ RubyCLI${reset}\nModelos de IA. No seu terminal.\n`);
}
export async function ask(label, { secret = false, fallback = '' } = {}) {
  assert(process.stdin.isTTY,'TERMINAL_REQUIRED','Use um terminal interativo ou informe as opções documentadas em --help.');
  const muted = new Writable({ write(_chunk,_encoding,cb) { cb(); } });
  const rl = createInterface({ input: process.stdin, output: secret ? muted : process.stdout, terminal: true });
  if (secret) process.stdout.write(label);
  try { return (await rl.question(secret ? '' : label)).trim() || fallback; }
  finally { rl.close(); if (secret) process.stdout.write('\n'); }
}
export async function choose(label, options) {
  options.forEach((x,i) => console.log(`  ${i+1}. ${x}`));
  const input = await ask(label); const index = /^\d+$/.test(input) ? Number(input)-1 : options.indexOf(input);
  assert(index >= 0 && index < options.length,'INVALID_CHOICE','Seleção inválida.'); return options[index];
}
export async function readStdin(limit = 200000) {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; assert(text.length <= limit,'INPUT_TOO_LARGE','Entrada acima do limite.'); }
  return text;
}
