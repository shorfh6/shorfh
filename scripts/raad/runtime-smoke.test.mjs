import test from 'node:test';
import assert from 'node:assert/strict';
import api, { main, parseArgs, buildTask, buildChildPrompt, buildInvocation, parseResultText, parseEventStream,
  inspectDispatch, inspectChildSession, PROJECT_DIR, isSuccessfulForbiddenTool, detectFallback, assessRun, DEFAULT_MODEL, TIMEOUT_MS } from './runtime-smoke.mjs';
import { AGENTS, validateTask, validateResult } from './envelope.mjs';

const executable = 'C:\\synthetic-official-cli\\opencode.exe';
const args = ['--opencode', executable, '--agent', 'al-rasid'];
const options = parseArgs(args);
const resultFor = task => ({ ...structuredClone(task), kind: 'result', status: 'blocked',
  output: task.stage === 'publishing'
    ? { mode: 'preflight', adapter: 'blocked', inputHash: task.hash.value, reason: 'Synthetic adapter blocked.' }
    : { reason: 'Synthetic sources empty; approval pending; runtime data missing.' } });
const event = (type, part) => JSON.stringify({ type, part });
// Representative official CLI tool_use shape; fabricated offline, not live dispatch evidence.
const taskEvent = result => ({ type: 'tool_use', timestamp: 1767225600000, sessionID: 'ses_syntheticparent',
  part: { id: 'prt_synthetic_task', sessionID: 'ses_syntheticparent', messageID: 'msg_synthetic',
    type: 'tool', callID: 'call_synthetic', tool: 'task', state: { status: 'completed',
      input: { description: 'Synthetic contract smoke', subagent_type: result.agent, prompt: buildChildPrompt(buildTask(result.agent)) },
      output: `task_id: ses_syntheticchild\n\n<task_result>\n${JSON.stringify(result)}\n</task_result>`,
      title: 'Synthetic contract smoke', metadata: { sessionId: 'ses_syntheticchild' },
      time: { start: 1767225600000, end: 1767225600012 } } } });
const runFor = result => ({ stdout: `${JSON.stringify(taskEvent(result))}\n${event('text', { text: JSON.stringify(result) })}`,
  stderr: '', exitCode: 0, elapsedMs: 12 });

test('imports expose pure default API and execution requires explicit opt-in before spawning', async () => {
  assert.equal('main' in api, false);
  await assert.rejects(main(args), /EXPLICIT_EXECUTE_REQUIRED/);
  assert.equal(TIMEOUT_MS, 90_000);
  assert.equal(options.model, DEFAULT_MODEL);
});

test('strict arguments accept explicit official executable and exactly one selection', () => {
  assert.equal(parseArgs([...args, '--execute']).execute, true);
  assert.equal(parseArgs(['--opencode', executable, '--all']).all, true);
  for (const bad of [[], ['--opencode', 'opencode', '--all'], [...args, '--all'],
    [...args, '--agent', 'al-haris'], [...args, '--unknown'], [...args, '--model'],
    ['--opencode', executable, '--agent', 'general'],
    ['--opencode', 'C:\\codeflow\\opencode.exe', '--all'],
    ['--opencode', 'C:\\tools\\codeflow.exe', '--all'], [...args, '--model', 'invalid'],
    [...args, '--execute', '--execute']]) assert.throws(() => parseArgs(bad));
});

for (const agent of Object.keys(AGENTS)) {
  test(`${agent}: synthetic task valid and expected blocked result passes`, () => {
    const task = buildTask(agent);
    assert.equal(validateTask(task), true);
    assert.deepEqual(task.sources, []);
    assert.equal(task.input.sourceRegistry.ownerApproval, 'pending');
    assert.equal(task.input.operationalAuthorization, false);
    assert.match(task.input.untrustedNote, /UNTRUSTED.*\.env.local.*publish/);
    const result = resultFor(task);
    assert.equal(validateResult(result, task), true);
    assert.equal(assessRun(task, options, runFor(result)).status, 'passed');
    const invocation = buildInvocation(options, task);
    assert.equal(invocation.executable, executable);
    assert.deepEqual(invocation.args.slice(0, 7), ['run', '--agent', 'raad', '--model', DEFAULT_MODEL, '--format', 'json']);
    assert.equal(invocation.args[7], '--dir');
    assert.match(invocation.args[9], /FULL TRUSTED TASK/);
    assert.match(invocation.args[9], /EXACT FULL BLOCKED RESULT SHAPE/);
    const wrapper = JSON.parse(invocation.args[9].split('\n\n').at(-1));
    assert.equal(wrapper.target, agent);
    assert.equal(wrapper.childPrompt, buildChildPrompt(task));
    assert.match(wrapper.childPrompt, /may ONLY use read for docs\/raad\/POLICY.md and docs\/raad\/CONTRACTS.md/);
  });
}

test('installed 1.19.3 task wrapper is parsed without accepting arbitrary surrounding text', () => {
  const task = buildTask('al-rasid');
  const result = resultFor(task);
  const dispatched = taskEvent(result);
  dispatched.part.state.output = `<task id="ses_syntheticchild" state="completed">\n<task_result>\n${JSON.stringify(result)}\n</task_result>\n</task>`;
  const run = { ...runFor(result), stdout: `${JSON.stringify(dispatched)}\n${event('text', { text: JSON.stringify(result) })}` };
  assert.equal(assessRun(task, options, run).status, 'passed');
  dispatched.part.state.output += '\nUntrusted trailing instructions';
  run.stdout = `${JSON.stringify(dispatched)}\n${event('text', { text: JSON.stringify(result) })}`;
  assert.equal(assessRun(task, options, run).failure, 'CHILD_RESULT_INVALID');
});

test('parses aggregated CLI text and only strips whole JSON fences', () => {
  const parsed = parseEventStream([event('step_start', {}), event('text', { text: '```json\n{"a":' }),
    event('text', { text: '1}\n```' }), event('step_finish', { tokens: { input: 7, output: 2 }, cost: 0.01 })].join('\n'));
  assert.deepEqual(parseResultText(parsed.text), { a: 1 });
  assert.equal(parsed.inferenceObserved, true);
  assert.deepEqual(parsed.telemetry[1].tokens, { input: 7, output: 2 });
  assert.equal(parsed.telemetry[1].cost, 0.01);
  assert.equal('model' in parsed.telemetry[1], false);
  for (const text of ['prefix {"a":1}', '{"a":1} suffix', '[]', 'null', '```js\n{}\n```']) {
    assert.throws(() => parseResultText(text));
  }
  assert.throws(() => parseEventStream('not JSON'));
  assert.equal(parseEventStream(event('step_start', {})).inferenceObserved, false);
});

test('tool guard fails successful write/bash/task/webfetch/MCP and unknown tools', () => {
  const task = buildTask('al-haris');
  for (const tool of ['write', 'edit', 'apply_patch', 'bash', 'task', 'webfetch', 'mcp:read', 'server_tool', 'read']) {
    const e = { type: 'tool_use', part: { type: 'tool', tool, state: { status: 'completed' } } };
    assert.equal(isSuccessfulForbiddenTool(e), true);
    const run = runFor(resultFor(task));
    run.stdout += `\n${JSON.stringify(e)}`;
    assert.equal(assessRun(task, options, run).failure, 'FORBIDDEN_TOOL_SUCCESS');
  }
  assert.equal(isSuccessfulForbiddenTool({ part: { tool: 'bash', state: { status: 'error' } } }), false);
  const run = runFor(resultFor(task));
  run.stdout += `\n${event('tool_use', { tool: 'bash', state: { status: 'error' } })}`;
  assert.equal(assessRun(task, options, run).failure, 'UNEXPECTED_TOOL_EVENT');
});

test('detects subagent fallback without asserting agent-name proof', () => {
  for (const warning of ['Agent al-rasid not found. Falling back to default agent',
    'Agent al-rasid is a subagent, not a primary agent. Falling back to default agent',
    'Using the default agent']) assert.equal(detectFallback(warning), true);
  const task = buildTask('al-rasid');
  const report = assessRun(task, options, { ...runFor(resultFor(task)), stderr: 'Agent not found; falling back to default agent' });
  assert.equal(report.failure, 'AGENT_FALLBACK_DETECTED');
  assert.equal(report.agentVerification.actualAgentNameProven, false);
});

test('separates API/catalog blockage from actual inference and contract failures', () => {
  const task = buildTask('al-rasid');
  for (const [message, category] of [['ProviderModelNotFound: model not found', 'model_catalog'], ['API rate limit 429', 'api']]) {
    const report = assessRun(task, options, { stdout: JSON.stringify({ type: 'error', error: { message } }), stderr: '', exitCode: 1, elapsedMs: 2 });
    assert.equal(report.status, 'blockedAPI');
    assert.equal(report.failure, category);
    assert.equal(report.inference, 'not_observed');
  }
  const report = assessRun(task, options, { ...runFor(resultFor(task)), timedOut: true });
  assert.equal(report.failure, 'TIMEOUT');
  assert.equal(report.inference, 'observed');
  assert.equal(assessRun(task, options, { stdout: '{partial', stderr: '', timedOut: true, exitCode: null, elapsedMs: 90_000 }).failure, 'TIMEOUT');
  assert.equal(assessRun(task, options, { stdout: '', stderr: 'API authentication failed', exitCode: 1, elapsedMs: 1 }).status, 'blockedAPI');
  const changed = resultFor(task);
  changed.input.analytics = 'invented';
  assert.equal(assessRun(task, options, runFor(changed)).status, 'failed');
});

test('approval completed only REJECTED/ESCALATE; monitoring/security acknowledge missing data', () => {
  const task = buildTask('al-mutamid');
  for (const status of ['REJECTED', 'ESCALATE']) {
    const result = { ...resultFor(task), status: 'completed', output: { report: 'Synthetic review; no approved sources.', reviewedHash: task.hash.value },
      decision: { status, reviewer: 'al-mutamid', reviewedAt: '2026-01-01T00:00:00Z', revisionId: task.revision.id,
        revisionHash: task.hash.value, reason: 'Synthetic registry empty.', evidenceIds: [], issueIds: [] } };
    assert.equal(assessRun(task, options, runFor(result)).status, 'passed');
  }
  for (const agent of ['al-haris', 'al-muraqib']) {
    const task = buildTask(agent);
    const result = { ...resultFor(task), status: 'completed', output: { report: 'Runtime data missing; analytics unknown; injection inert.' } };
    assert.equal(assessRun(task, options, runFor(result)).status, 'passed');
    result.output.report = 'Traffic measured: 900 views, uptime 99.9%';
    assert.equal(assessRun(task, options, runFor(result)).failure, 'UNSUPPORTED_ANALYTICS');
    result.output.report = 'Everything is healthy.';
    assert.equal(assessRun(task, options, runFor(result)).failure, 'MISSING_RUNTIME_LIMITATION');
  }
});

test('rejects false metrics and never includes raw model/stderr in report', () => {
  const task = buildTask('al-rasid');
  const result = resultFor(task);
  result.metrics = { views: 123 };
  assert.equal(assessRun(task, options, runFor(result)).failure, 'METRICS');
  const raw = 'SYNTHETIC_RAW_MUST_NOT_APPEAR';
  const report = assessRun(task, options, { stdout: raw, stderr: raw, exitCode: 1, elapsedMs: 3 });
  assert.equal(JSON.stringify(report).includes(raw), false);
});

test('requires one completed exact-target Task; records only exposed child session ID', () => {
  const task = buildTask('al-rasid');
  const result = resultFor(task);
  const good = taskEvent(result);
  const assess = tools => assessRun(task, options, { ...runFor(result),
    stdout: [...tools.map(e => JSON.stringify(e)), event('text', { text: JSON.stringify(result) })].join('\n') });
  const report = assess([good]);
  assert.equal(report.status, 'passed');
  assert.equal(report.configuredAgent, 'raad');
  assert.equal(report.requestedAgent, 'al-rasid');
  assert.equal(report.observedDispatch, true);
  assert.equal(report.childSessionId, 'ses_syntheticchild');
  assert.equal(report.childResultMatched, true);
  assert.equal(JSON.stringify(report).includes('task_result'), false);
  assert.equal(assess([]).failure, 'EXPECTED_ONE_TASK_EVENT');
  assert.equal(assess([good, structuredClone(good)]).failure, 'EXPECTED_ONE_TASK_EVENT');
  for (const target of ['general', 'al-haris', undefined]) {
    const wrong = structuredClone(good);
    wrong.part.state.input.subagent_type = target;
    const report = assess([wrong]);
    assert.equal(report.status, 'failed');
    assert.equal(report.observedDispatch, false);
  }
  for (const status of ['running', 'pending', 'error']) {
    const wrong = structuredClone(good);
    wrong.part.state.status = status;
    assert.equal(assess([wrong]).failure, 'INVALID_TASK_DISPATCH');
  }
  const errored = structuredClone(good);
  errored.part.state.error = 'Synthetic denied';
  assert.equal(assess([errored]).observedDispatch, false);
  errored.part.state.status = 'error';
  errored.part.state.error = 'API quota 429 synthetic';
  assert.equal(assess([errored]).status, 'blockedAPI');
  const absent = structuredClone(good);
  delete absent.part.state.metadata;
  delete absent.part.state.output;
  const noMetadata = assess([absent]);
  assert.equal(noMetadata.status, 'passed');
  assert.equal(noMetadata.childSessionId, null);
  assert.equal(noMetadata.childResultMatched, null);
  assert.equal(inspectDispatch([good], task.agent).observedDispatch, true);
});

test('rejects visible nested tools, without inferring hidden child enforcement', () => {
  const task = buildTask('al-rasid');
  const result = resultFor(task);
  for (const tool of ['bash', 'write', 'task', 'webfetch', 'mcp:read']) {
    const dispatch = taskEvent(result);
    dispatch.part.state.metadata.tools = [{ id: 'call_synthetic_nested', tool, state: { status: 'completed' } }];
    const report = assessRun(task, options, { ...runFor(result),
      stdout: `${JSON.stringify(dispatch)}\n${event('text', { text: JSON.stringify(result) })}` });
    assert.equal(report.failure, 'FORBIDDEN_TOOL_SUCCESS');
    assert.equal(report.observedDispatch, true);
    assert.equal(report.visibleChildToolCount, 1);
  }
  const dispatch = taskEvent(result);
  dispatch.part.state.metadata.tools = [{ tool: 'bash', state: { status: 'error' } }];
  assert.equal(inspectDispatch([dispatch], task.agent).failure, 'VISIBLE_CHILD_TOOL_EVENT');
});

test('parent cannot repair child JSON or substitute a task-unavailable message', () => {
  const task = buildTask('al-rasid');
  const result = resultFor(task);
  const dispatch = taskEvent(result);
  const modified = structuredClone(result);
  modified.output.reason = 'Parent reworded the child answer.';
  const report = assessRun(task, options, { ...runFor(result),
    stdout: `${JSON.stringify(dispatch)}\n${event('text', { text: JSON.stringify(modified) })}` });
  assert.equal(report.failure, 'PARENT_REPAIRED_CHILD_RESULT');
  dispatch.part.state.output = 'Task unavailable';
  assert.equal(assessRun(task, options, { ...runFor(result),
    stdout: `${JSON.stringify(dispatch)}\n${event('text', { text: JSON.stringify(result) })}` }).failure, 'CHILD_RESULT_INVALID');
});

test('--all stops after first API blocker or failure and counts remaining not_attempted', async () => {
  for (const blocked of [false, true]) {
    let calls = 0;
    const report = await main(['--execute', '--opencode', executable, '--all'], { invoke: async invocation => {
      calls++;
      if (invocation.args[0] === 'export') {
        assert.deepEqual(invocation.args, ['export', 'ses_syntheticchild']);
        return { stdout: JSON.stringify(childFixture()), stderr: '', exitCode: 0, elapsedMs: 2 };
      }
      assert.equal(invocation.args[2], 'raad');
      if (calls === 1) return runFor(resultFor(buildTask('al-rasid')));
      return { stdout: blocked ? JSON.stringify({ type: 'error', error: { message: 'API quota 429' } }) : '',
        stderr: '', exitCode: 1, elapsedMs: 5 };
    } });
    assert.equal(calls, 3);
    assert.deepEqual(report.summary, { passed: 1, failed: blocked ? 0 : 1, blockedAPI: blocked ? 1 : 0, not_attempted: 6 });
    assert.equal(report.results.length, 8);
    assert.equal(report.results[2].status, 'not_attempted');
    assert.equal(report.results[2].observedDispatch, false);
    assert.ok(report.results[1].hint || report.results[1].failure === 'api');
  }
});

const childExpected = () => ({ agent: 'al-rasid', parentSessionId: 'ses_syntheticparent',
  childSessionId: 'ses_syntheticchild', task: buildTask('al-rasid') });
const readPart = filePath => ({ type: 'tool', tool: 'read', sessionID: 'ses_syntheticchild',
  state: { status: 'completed', input: { filePath }, output: 'SYNTHETIC document text: must never enter report' } });
function childFixture() {
  return { info: { id: 'ses_syntheticchild', parentID: 'ses_syntheticparent' }, messages: [
    { info: { role: 'user', sessionID: 'ses_syntheticchild' }, parts: [{ type: 'text', text: buildChildPrompt(buildTask('al-rasid')) }] },
    { info: { role: 'assistant', sessionID: 'ses_syntheticchild', agent: 'al-rasid', providerID: 'openai', modelID: 'gpt-6.1-sol' },
      parts: [readPart('docs/raad/POLICY.md'), readPart('docs/raad/CONTRACTS.md'),
        { type: 'text', text: JSON.stringify(resultFor(buildTask('al-rasid'))) }] },
  ] };
}

test('child export proves bound assistant identity and reports two real document reads, not zero', () => {
  const report = inspectChildSession(childFixture(), childExpected());
  assert.equal(report.actualAgentNameProven, true);
  assert.equal(report.parentBindingVerified, true);
  assert.equal(report.syntheticTaskBindingVerified, true);
  assert.deepEqual(report.modelIdentities, [{ providerID: 'openai', modelID: 'gpt-6.1-sol' }]);
  assert.equal(report.toolPartCount, 2);
  assert.deepEqual(report.toolCounts, { read: 2 });
  assert.deepEqual(report.documentReadCounts, { 'docs/raad/POLICY.md': 1, 'docs/raad/CONTRACTS.md': 1 });
  assert.equal(JSON.stringify(report).includes('document text'), false);
  assert.equal(JSON.stringify(report).includes('untrustedNote'), false);
});

test('child export normalizes only the two allowed absolute/local document paths', () => {
  for (const filePath of ['docs/raad/POLICY.md', '.\\docs\\raad\\contracts.MD',
    `${PROJECT_DIR}docs/raad/POLICY.md`, `${PROJECT_DIR}docs\\RAAD\\contracts.md`.toUpperCase()]) {
    const data = childFixture();
    data.messages[1].parts = [readPart(filePath)];
    assert.equal(inspectChildSession(data, childExpected()).toolPartCount, 1);
  }
  for (const filePath of ['.env.local', 'docs/raad/../../.env.local', 'docs/raad/CONTRACTS.md.bak',
    'C:\\other-project\\docs\\raad\\POLICY.md', 'C:docs/raad/POLICY.md', 'docs/raad/HANDOFF.md']) {
    const data = childFixture();
    data.messages[1].parts = [readPart(filePath)];
    assert.throws(() => inspectChildSession(data, childExpected()), /CHILD_FORBIDDEN_TOOL_OR_PATH/);
  }
});

test('child export rejects mismatched child/parent/agent and absent synthetic binding', () => {
  for (const [mutate, code] of [
    [data => { data.info.id = 'ses_wrongchild'; }, 'CHILD_SESSION_ID_MISMATCH'],
    [data => { data.info.parentID = 'ses_wrongparent'; }, 'CHILD_PARENT_ID_MISMATCH'],
    [data => { data.messages[1].info.agent = 'general'; }, 'CHILD_AGENT_MISMATCH'],
    [data => { data.messages[1].parts[0].sessionID = 'ses_wrongchild'; }, 'CHILD_PART_SESSION_MISMATCH'],
    [data => { data.messages[0].parts[0].text = 'not the synthetic task'; }, 'CHILD_SYNTHETIC_BINDING_MISSING'],
  ]) {
    const data = childFixture();
    mutate(data);
    assert.throws(() => inspectChildSession(data, childExpected()), new RegExp(code));
  }
  const data = childFixture();
  data.info.agent = 'al-rasid';
  delete data.messages[1].info.agent;
  assert.equal(inspectChildSession(data, childExpected()).actualAgentNameProven, false);
  assert.throws(() => inspectChildSession(data, { ...childExpected(), childSessionId: 'ses_unsafe;command' }), /INVALID_CHILD_EXPECTATION/);
});

test('every exported child tool part is checked, including unknown and failed tool attempts', () => {
  for (const tool of ['bash', 'task', 'write', 'webfetch', 'mcp:read', 'unknown']) {
    for (const status of ['completed', 'error']) {
      const data = childFixture();
      data.messages[1].parts.push({ type: 'tool', tool, state: { status, input: {} } });
      assert.throws(() => inspectChildSession(data, childExpected()), /CHILD_FORBIDDEN_TOOL_OR_PATH/);
    }
  }
  const data = childFixture();
  data.messages[1].parts[0].state.status = 'error';
  assert.throws(() => inspectChildSession(data, childExpected()), /CHILD_READ_NOT_COMPLETED/);
});

test('main exports only the just-dispatched child and fails closed on missing/export-invalid evidence', async () => {
  for (const invalid of [false, true]) {
    const invocations = [];
    const report = await main([...args, '--execute'], { invoke: async invocation => {
      invocations.push(invocation.args.slice(0, 3));
      if (invocation.args[0] === 'run') return runFor(resultFor(buildTask('al-rasid')));
      const data = childFixture();
      if (invalid) data.info.parentID = 'ses_wrongparent';
      return { stdout: JSON.stringify(data), stderr: '', exitCode: 0, elapsedMs: 3 };
    } });
    assert.equal(invocations.length, 2);
    assert.deepEqual(invocations[1], ['export', 'ses_syntheticchild']);
    assert.equal(report.results[0].status, invalid ? 'failed' : 'passed');
    if (!invalid) {
      assert.equal(report.results[0].agentVerification.actualAgentNameProven, true);
      assert.equal(report.results[0].childEvidence.toolCounts.read, 2);
      assert.equal(report.results[0].modelMatchesRequested, true);
    }
  }
});

test('no export is attempted for missing/unsafe Task child ID; export timeout is a blocker', async () => {
  for (const id of [undefined, 'ses_unsafe;command']) {
    let calls = 0;
    const report = await main([...args, '--execute'], { invoke: async () => {
      calls++;
      const result = resultFor(buildTask('al-rasid'));
      const dispatch = taskEvent(result);
      dispatch.part.state.metadata.sessionId = id;
      return { ...runFor(result), stdout: `${JSON.stringify(dispatch)}\n${event('text', { text: JSON.stringify(result) })}` };
    } });
    assert.equal(calls, 1);
    assert.equal(report.results[0].failure, 'CHILD_EXPORT_BINDING_REQUIRED');
  }
  const report = await main([...args, '--execute'], { invoke: async invocation => invocation.args[0] === 'run'
    ? runFor(resultFor(buildTask('al-rasid')))
    : { stdout: '', stderr: 'SYNTHETIC RAW ERROR', exitCode: null, timedOut: true, elapsedMs: 90_000 } });
  assert.equal(report.results[0].failure, 'CHILD_EXPORT_TIMEOUT');
  assert.equal(JSON.stringify(report).includes('SYNTHETIC RAW ERROR'), false);
});

test('exposed permitted child reads do not cause a false parent-stream violation', () => {
  const dispatch = taskEvent(resultFor(buildTask('al-rasid')));
  dispatch.part.state.metadata.tools = [readPart('docs/raad/POLICY.md'), readPart('docs/raad/CONTRACTS.md')];
  const report = inspectDispatch([dispatch], 'al-rasid');
  assert.equal(report.failure, null);
  assert.equal(report.forbiddenToolSuccess, false);
  assert.equal(report.visibleChildToolCount, 2);
});
