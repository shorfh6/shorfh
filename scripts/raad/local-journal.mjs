import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTask, validateResult, assertNoSecrets, auditSummary, contentHash } from './envelope.mjs';

// Coordinator-owned LOCAL development evidence. No worker, authorization, or execution.
// Hashes detect accidental changes, not an OS administrator rewriting the entire store.
export const LIMITS = Object.freeze({ packageBytes: 1024 * 1024, auditBytes: 16 * 1024 * 1024 });
const VERSION = 'raad.local-journal/1';
const check = ok => { if (!ok) throw new Error('JOURNAL_REJECTED'); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = fn => { try { return fn(); } catch { throw new Error('JOURNAL_REJECTED'); } };
function stat(file) {
  try { const s = fs.lstatSync(file); check(!s.isSymbolicLink()); return s; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function directories(dir, create = false) {
  const root = path.parse(dir).root;
  let current = root;
  check(stat(root)?.isDirectory());
  for (const part of dir.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!stat(current) && create) { try { fs.mkdirSync(current); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    check(stat(current)?.isDirectory());
  }
}
function read(file, limit) {
  check(stat(file)?.isFile());
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try { check(fs.fstatSync(fd).size <= limit); const bytes = fs.readFileSync(fd); check(bytes.length <= limit); return bytes; }
  finally { fs.closeSync(fd); }
}
function exclusive(file, bytes) {
  check(!stat(file));
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDirectory(dir) {
  // Windows does not generally allow opening directories for fsync.
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch (e) { if (!['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(e.code)) throw e; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function snapshot(value, validate) {
  assertNoSecrets(value); validate(value);
  const bytes = Buffer.from(JSON.stringify(value));
  check(bytes.length <= LIMITS.packageBytes);
  return { value: JSON.parse(bytes), bytes, digest: sha(bytes) };
}

/** Explicit absolute directory only. Synchronous operations; importing performs no I/O.
 * Store access belongs to RAAD; filesystem permissions, not envelopes, enforce callers.
 * Stale locks require manual investigation. Never auto-recover a damaged journal.
 */
export function openJournal(directory) {
  return safe(() => {
    check(typeof directory === 'string' && path.isAbsolute(directory));
    const base = path.resolve(directory), snapshots = path.join(base, 'snapshots');
    const log = path.join(base, 'audit.jsonl'), lock = path.join(base, 'journal.lock');
    directories(base, true);
    function locked(fn) {
      return safe(() => {
        directories(base); check(!stat(lock));
        const fd = fs.openSync(lock, 'wx', 0o600);
        try { fs.fsyncSync(fd); return fn(); }
        finally { fs.closeSync(fd); fs.unlinkSync(lock); }
      });
    }
    function inspect() {
      directories(snapshots);
      const bytes = read(log, LIMITS.auditBytes), text = bytes.toString('utf8');
      check(Buffer.from(text).equals(bytes) && (!text || text.endsWith('\n')));
      const events = [], tasks = new Map(), results = new Map();
      function load(digest) {
        check(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest));
        const body = read(path.join(snapshots, `${digest}.json`), LIMITS.packageBytes);
        check(sha(body) === digest);
        const value = JSON.parse(body); assertNoSecrets(value); return value;
      }
      for (const line of text ? text.slice(0, -1).split('\n') : []) {
        const e = JSON.parse(line);
        check(e.version === VERSION && e.seq === events.length + 1 &&
          e.previous === (events.at(-1)?.hash ?? null));
        let summary = null;
        if (e.type === 'task') {
          check(e.resultDigest === null && !tasks.has(e.taskDigest));
          const task = load(e.taskDigest); validateTask(task); tasks.set(e.taskDigest, task);
        } else {
          check(e.type === 'result' && tasks.has(e.taskDigest) && !results.has(e.taskDigest));
          summary = auditSummary(load(e.resultDigest), tasks.get(e.taskDigest));
          results.set(e.taskDigest, e.resultDigest);
        }
        const record = { version: VERSION, seq: e.seq, previous: e.previous, type: e.type,
          taskDigest: e.taskDigest, resultDigest: e.resultDigest, summary };
        check(contentHash(e) === contentHash({ ...record, hash: contentHash(record) }));
        events.push(e);
      }
      return { events, tasks, results, size: bytes.length };
    }
    locked(() => {
      if (!stat(log)) {
        check(!stat(snapshots)); fs.mkdirSync(snapshots); exclusive(log, ''); syncDirectory(base);
      }
      inspect();
    });
    function record(value, expectedTask) {
      return safe(() => {
        const task = expectedTask === undefined ? snapshot(value, validateTask) : snapshot(expectedTask, validateTask);
        const result = expectedTask === undefined ? null : snapshot(value, v => validateResult(v, task.value));
        return locked(() => {
          const state = inspect();
          if (result) check(state.tasks.has(task.digest));
          const existing = result ? state.results.get(task.digest) : state.tasks.has(task.digest) && task.digest;
          const stored = result ?? task;
          if (existing) { check(existing === stored.digest); return stored.digest; }
          const body = { version: VERSION, seq: state.events.length + 1, previous: state.events.at(-1)?.hash ?? null,
            type: result ? 'result' : 'task', taskDigest: task.digest, resultDigest: result?.digest ?? null,
            summary: result ? auditSummary(result.value, task.value) : null };
          const line = JSON.stringify({ ...body, hash: contentHash(body) }) + '\n';
          check(state.size + Buffer.byteLength(line) <= LIMITS.auditBytes);
          const file = path.join(snapshots, `${stored.digest}.json`);
          if (stat(file)) check(read(file, LIMITS.packageBytes).equals(stored.bytes));
          else { exclusive(file, stored.bytes); syncDirectory(snapshots); }
          check(stat(log)?.isFile());
          const fd = fs.openSync(log, fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0));
          try { fs.writeFileSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          return stored.digest;
        });
      });
    }
    return Object.freeze({ recordTask: task => record(task),
      recordResult: (result, expectedTask) => { check(expectedTask !== undefined); return record(result, expectedTask); },
      readAudit: () => locked(() => inspect().events), verify: () => locked(() => { inspect(); return true; }) });
  });
}
