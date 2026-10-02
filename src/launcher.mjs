import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createBridge } from './bridge.mjs';
import { home, profileName, privateDir } from './config.mjs';
import { runInteractive } from './process.mjs';
import { assert } from './errors.mjs';

export const CLIENTS = ['claude','codex','opencode','aider'];
export function isolatedEnvironment(source, root) {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (/^(ANTHROPIC_|OPENAI_|CLAUDE_|CODEX_|OPENCODE_|AIDER_|PI_CODING_|RUBY_API_KEY$|RUBYCLI_API_KEY$|RUBYCLI_LOCAL_TOKEN$)/.test(name)) delete env[name];
  }
  Object.assign(env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root,'config'), XDG_DATA_HOME: path.join(root,'data'), XDG_CACHE_HOME: path.join(root,'cache'), XDG_STATE_HOME: path.join(root,'state'), APPDATA: path.join(root,'AppData','Roaming'), LOCALAPPDATA: path.join(root,'AppData','Local') });
  // The local bridge must not pass through a corporate/public HTTP proxy.
  const bypass = [...new Set((source.NO_PROXY || source.no_proxy || '').split(',').filter(Boolean).concat(['127.0.0.1','localhost','::1']))].join(',');
  env.NO_PROXY = bypass; env.no_proxy = bypass;
  if (process.platform === 'win32') { env.HOMEDRIVE = path.parse(root).root.slice(0,2); env.HOMEPATH = root.slice(2); }
  return env;
}
export function checkForwarded(client, args) {
  const reserved = {
    codex: ['--config','-c','--profile','-p','--model','-m','--oss','--local-provider'],
    claude: ['--settings','--setting-sources','--model'],
    opencode: ['--model','-m'],
    aider: ['--model','--config','--env-file','--openai-api-base','--openai-api-key']
  }[client];
  for (const arg of args) assert(!reserved.some(flag => arg === flag || arg.startsWith(flag+'=') || (flag.length === 2 && arg.startsWith(flag) && arg.length > 2)), 'ROUTING_OVERRIDE', 'Use as opções RubyCLI para escolher modelo/perfil. Flags que substituem o roteamento são reservadas.');
}
export async function prepareClient({ client, profile = 'default', model, bridge, sourceEnv = process.env, temporary = false }) {
  assert(CLIENTS.includes(client), 'INVALID_CLIENT', `Cliente inválido. Opções: ${CLIENTS.join(', ')}.`);
  profileName(profile);
  const parent = path.join(home(sourceEnv), 'clients', profile); await privateDir(parent);
  const root = temporary ? await mkdtemp(path.join(parent,client+'-')) : path.join(parent,client);
  await privateDir(root);
  const env = isolatedEnvironment(sourceEnv,root);
  for (const dir of [env.XDG_CONFIG_HOME,env.XDG_DATA_HOME,env.XDG_CACHE_HOME,env.XDG_STATE_HOME,env.APPDATA,env.LOCALAPPDATA]) await privateDir(dir);
  env.RUBYCLI_SESSION_TOKEN = bridge.token;
  let args;
  const base = `${bridge.url}/v1`;
  if (client === 'codex') {
    env.CODEX_HOME = path.join(root,'codex'); await privateDir(env.CODEX_HOME);
    args = ['-c','model_provider="rubycli"','-c','model_providers.rubycli.name="RubyCLI"','-c',`model_providers.rubycli.base_url=${JSON.stringify(base)}`,'-c','model_providers.rubycli.env_key="RUBYCLI_SESSION_TOKEN"','-c','model_providers.rubycli.wire_api="responses"','-c','model_providers.rubycli.requires_openai_auth=false','-c','model_providers.rubycli.supports_websockets=false','-c','web_search="disabled"','--model',model];
  } else if (client === 'claude') {
    Object.assign(env,{ CLAUDE_CONFIG_DIR: path.join(root,'claude'), ANTHROPIC_BASE_URL: bridge.url, ANTHROPIC_AUTH_TOKEN: bridge.token, ANTHROPIC_MODEL: model, CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' });
    for (const name of ['ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_SMALL_FAST_MODEL']) env[name] = model;
    await privateDir(env.CLAUDE_CONFIG_DIR); args = ['--model',model];
  } else if (client === 'opencode') {
    env.OPENCODE_CONFIG_DIR = path.join(root,'opencode'); await privateDir(env.OPENCODE_CONFIG_DIR);
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ enabled_providers: ['rubycli'], model: `rubycli/${model}`, provider: { rubycli: { name: 'RubyCLI', npm: '@ai-sdk/openai-compatible', options: { baseURL: base, apiKey: '{env:RUBYCLI_SESSION_TOKEN}' }, models: { [model]: { name: model } } } } });
    args = ['--model',`rubycli/${model}`];
  } else {
    Object.assign(env,{ OPENAI_API_BASE: base, OPENAI_API_KEY: bridge.token });
    await writeFile(path.join(root,'aider.yml'),'{}\n',{ mode: 0o600 }); await writeFile(path.join(root,'empty.env'),'\n',{ mode: 0o600 });
    args = ['--model',`openai/${model}`,'--config',path.join(root,'aider.yml'),'--env-file',path.join(root,'empty.env'),'--input-history-file',path.join(root,'input.history'),'--chat-history-file',path.join(root,'chat.history'),'--llm-history-file',path.join(root,'llm.history')];
  }
  return { root, env, args, async cleanup() { if (temporary) await rm(root,{ recursive: true, force: true }); } };
}
export async function launch({ api, client, model, profile, args = [], bin, temporary = false, env = process.env }) {
  checkForwarded(client,args);
  const bridge = await createBridge({ api, model }); let prepared;
  try {
    prepared = await prepareClient({ client, model, profile, bridge, sourceEnv: env, temporary });
    process.stderr.write(`RubyCLI · ${client} · ${model}\nPerfil separado: ${prepared.root}\n`);
    return await runInteractive(bin || client,[...prepared.args,...args],{ env: prepared.env });
  } finally { await bridge.close(); await prepared?.cleanup(); }
}
