import { pathToFileURL } from 'node:url';
import { Workflow, LocalSimulation, assertOffline } from './workflow.mjs';
import { fixture, NOW } from './fixtures.mjs';

export function run(documents = [fixture()], now = NOW, mode = 'offline-dry-run') {
  const runtime = assertOffline(mode);
  const simulation = new LocalSimulation();
  const articles = []; const audit = [];
  for (const [index, doc] of documents.entries()) {
    const workflow = new Workflow(doc, `fixture-${index}`);
    let reason;
    try {
      workflow.verify(now); workflow.edit(now); workflow.prepareMedia(now);
      workflow.approve('al-mutamid', now);
      const lease = workflow.dryRun(simulation, now);
      if (lease.status === 'leased') {
        simulation.settle(lease, now, 'success');
        workflow.dryRun(simulation, now);
      }
    } catch (error) {
      // Fixed codes only: never echo supplied source text or exception details.
      reason = /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_CONTRACT';
    }
    articles.push({ ...workflow.view, ...(reason ? { reason } : {}) });
    audit.push(...workflow.events);
  }
  return { fixtureNotice: 'SYNTHETIC NOT REAL NEWS', contractVersion: 1, runtime,
    ...simulation.summary, articles, audit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length) throw new Error('CLI_ARGUMENTS_DENIED');
    console.log(JSON.stringify(run(), null, 2));
  } catch {
    console.log(JSON.stringify({ error: 'OFFLINE_READINESS_DENIED', realAdapter: false }));
    process.exitCode = 1;
  }
}
