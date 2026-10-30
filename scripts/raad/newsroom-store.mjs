import fs from 'node:fs';
import path from 'node:path';
import { contentHash, assertNoSecrets } from './envelope.mjs';

const check = (ok, code) => { if (!ok) throw Error(code); };
const MAX_BYTES = 16 * 1024 * 1024;

// One local coordinator, one private directory. Never steal an abandoned lock.
export function openNewsroomStore(directory) {
  check(path.isAbsolute(directory), 'NEWSROOM_ABSOLUTE_DIRECTORY_REQUIRED');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    check(!fs.lstatSync(current).isSymbolicLink(), 'NEWSROOM_UNSAFE_DIRECTORY');
  }
  check(fs.statSync(directory).isDirectory(), 'NEWSROOM_UNSAFE_DIRECTORY');
  const lock = path.join(directory, 'newsroom.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  let closed = false, sequence = 0, previous = null;
  const syncDirectory = () => {
    let handle;
    try { handle = fs.openSync(directory, 'r'); fs.fsyncSync(handle); }
    catch (error) { if (!['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error; }
    finally { if (handle !== undefined) fs.closeSync(handle); }
  };
  const close = () => { if (!closed) { closed = true; fs.closeSync(fd); fs.unlinkSync(lock); syncDirectory(); } };
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.fsyncSync(fd); syncDirectory();
    const files = fs.readdirSync(directory).filter(f => /^checkpoint-/.test(f)).sort();
    let state = { version: 1, stories: {} };
    for (const file of files) {
      check(file === `checkpoint-${String(sequence + 1).padStart(6, '0')}.json`, 'NEWSROOM_CHECKPOINT_SEQUENCE');
      const target = path.join(directory, file), stat = fs.lstatSync(target);
      check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BYTES, 'NEWSROOM_CHECKPOINT_REJECTED');
      const record = JSON.parse(fs.readFileSync(target, 'utf8'));
      check(record.sequence === sequence + 1 && record.previous === previous &&
        record.digest === contentHash({ sequence: record.sequence, previous: record.previous, state: record.state }), 'NEWSROOM_CHECKPOINT_CORRUPT');
      check(record.state.version === 1 && record.state.stories && !Array.isArray(record.state.stories), 'NEWSROOM_STATE_REJECTED');
      assertNoSecrets(record.state);
      sequence = record.sequence; previous = record.digest; state = record.state;
    }
    return {
      state,
      save(next) {
        check(!closed && sequence < 10000, 'NEWSROOM_STORE_CAPACITY');
        assertNoSecrets(next);
        const record = { sequence: sequence + 1, previous, state: next };
        record.digest = contentHash(record);
        const body = JSON.stringify(record) + '\n';
        check(Buffer.byteLength(body) <= MAX_BYTES, 'NEWSROOM_STORE_CAPACITY');
        const out = fs.openSync(path.join(directory, `checkpoint-${String(sequence + 1).padStart(6, '0')}.json`), 'wx', 0o600);
        try { fs.writeFileSync(out, body); fs.fsyncSync(out); } finally { fs.closeSync(out); }
        syncDirectory(); sequence++; previous = record.digest;
      },
      close,
    };
  } catch (error) { close(); throw error; }
}
