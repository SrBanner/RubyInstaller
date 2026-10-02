import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function scan(dir) {
  for (const entry of await readdir(dir,{ withFileTypes: true })) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (file.endsWith('.mjs')) {
      const result = spawnSync(process.execPath,['--check',file],{ stdio: 'inherit' });
      if (result.status !== 0) process.exit(1);
    }
  }
}
for (const dir of ['bin','src','scripts','test']) await scan(dir);
console.log('Sintaxe JavaScript verificada.');
