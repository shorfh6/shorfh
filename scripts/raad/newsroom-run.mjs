import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createNewsroomCoordinator } from './newsroom-coordinator.mjs';

// The module is executable trusted coordinator configuration, never agent output.
// It injects capabilities; this runner does not discover credentials or read .env.
export async function main(args) {
  if (args.length !== 3 || args[0] !== '--adapter-module' || !['--execute-one-stage', '--execute-story'].includes(args[2]) || !path.isAbsolute(args[1])) throw Error('NEWSROOM_EXPLICIT_ARGUMENTS_REQUIRED');
  const stat = fs.lstatSync(args[1]);
  if (!stat.isFile() || stat.isSymbolicLink() || path.extname(args[1]) !== '.mjs') throw Error('NEWSROOM_ADAPTER_MODULE_REQUIRED');
  const module = await import(pathToFileURL(args[1]).href);
  if (typeof module.createConfiguration !== 'function') throw Error('NEWSROOM_CONFIGURATION_REQUIRED');
  const config = await module.createConfiguration();
  try {
    const coordinator = createNewsroomCoordinator({ ...config, execute: true });
    return await (args[2] === '--execute-story' ? coordinator.runStory() : coordinator.tick());
  }
  finally { if (typeof module.close === 'function') await module.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ error: /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'NEWSROOM_RUN_FAILED', automaticRetry: false }));
    process.exitCode = 1;
  });
}
