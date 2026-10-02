// Inspired by the metadata-only ledger in quebragalho-bridge (MIT).
// No prompts, completions, paths, secrets or monetary estimates are persisted.
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { profileDir, privateDir } from './config.mjs';
const day = () => new Date().toISOString().slice(0,10);
export async function recordUsage(profile, { model, usage }, env = process.env) {
  if (env.RUBYCLI_USAGE === '0') return;
  const dir = path.join(profileDir(profile, env),'usage'); await privateDir(dir);
  const count = n => Number.isFinite(n) ? Math.max(0,Math.trunc(n)) : null;
  await appendFile(path.join(dir,day()+'.jsonl'), JSON.stringify({ at: new Date().toISOString(), model, input: count(usage?.prompt_tokens), output: count(usage?.completion_tokens), cached: count(usage?.prompt_tokens_details?.cached_tokens), requests: 1 }) + '\n', { mode: 0o600 });
}
export async function usageToday(profile, env = process.env) {
  const file = path.join(profileDir(profile,env),'usage',day()+'.jsonl');
  const text = await readFile(file,'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
  const summary = { date_utc: day(), requests: 0, input_tokens: 0, output_tokens: 0, unknown_usage_requests: 0, models: Object.create(null), billing: 'Consulte o painel RubyCLI para saldo e Ruby Units.' };
  for (const line of text.split('\n').filter(Boolean)) {
    let v; try { v = JSON.parse(line); } catch { continue; }
    summary.requests++; summary.input_tokens += v.input || 0; summary.output_tokens += v.output || 0;
    if (v.input === null || v.output === null) summary.unknown_usage_requests++;
    summary.models[v.model] = (summary.models[v.model] || 0)+1;
  }
  return summary;
}
