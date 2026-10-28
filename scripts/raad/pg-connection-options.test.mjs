import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { securePgConnectionOptions } from '../../lib/pg-connection-options.mjs';

const remote = 'postgresql://synthetic@db.invalid.example/synthetic';

test('database TLS verifies certificates even without a custom CA', () => {
  const options = securePgConnectionOptions(remote);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(new pg.Client(options).connectionParameters.ssl.rejectUnauthorized, true);
});
test('custom CA survives pg connection-string parsing and escaped newlines', () => {
  const options = securePgConnectionOptions(remote + '?sslmode=require&uselibpqcompat=true&application_name=SYNTHETIC', { ca: 'SYNTHETIC\\nCA' });
  const client = new pg.Client(options);
  assert.deepEqual(client.connectionParameters.ssl, { rejectUnauthorized: true, ca: 'SYNTHETIC\nCA' });
  assert.equal(client.connectionParameters.application_name, 'SYNTHETIC');
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
});
test('connection-string SSL options cannot replace certificate-verification settings', () => {
  for (const parameter of ['ssl=false', 'sslcert=synthetic.pem', 'sslkey=synthetic.pem', 'sslrootcert=synthetic.pem', 'sslnegotiation=direct']) {
    assert.throws(() => securePgConnectionOptions(remote + '?' + parameter), error => error.message === 'PG_TLS_OPTIONS_MUST_BE_EXPLICIT');
  }
});
test('plaintext remote connections are refused through both disable switches', () => {
  for (const host of ['db.invalid.example', '192.0.2.1', 'localhost.invalid.example']) {
    const url = `postgresql://synthetic@${host}/synthetic`;
    assert.throws(() => securePgConnectionOptions(url + '?sslmode=disable'), /^Error: PG_TLS_REQUIRED$/);
    assert.throws(() => securePgConnectionOptions(url, { disableSsl: true }), /^Error: PG_TLS_REQUIRED$/);
  }
});
test('explicit plaintext is supported only on loopback and is false rather than inherited', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const url = `postgresql://synthetic@${host}/synthetic`;
    for (const options of [securePgConnectionOptions(url + '?sslmode=disable'), securePgConnectionOptions(url, { disableSsl: true })]) {
      assert.equal(options.ssl, false);
      assert.equal(new pg.Client(options).connectionParameters.ssl, false);
    }
  }
});
test('permissive legacy sslmode values never turn off certificate verification', () => {
  for (const mode of ['require', 'prefer', 'allow', 'no-verify', 'verify-ca', 'verify-full']) {
    const options = securePgConnectionOptions(remote + '?sslmode=' + mode);
    assert.equal(new pg.Client(options).connectionParameters.ssl.rejectUnauthorized, true);
  }
});
test('invalid connection configuration reports a fixed code without echoing it', () => {
  for (const url of [undefined, '', 'SYNTHETIC private detail', 'https://db.invalid.example', 'postgresql:///synthetic']) {
    assert.throws(() => securePgConnectionOptions(url), error => error.message === 'PG_CONNECTION_URL_INVALID');
  }
});
