import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Service } from '../server/service.mjs';

test('active parent owner can coordinate foreign children without acquiring their implementation scope', t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const service = new Service(store);
  const project = service.createProject({ name: 'Parent coordination', repo: 'fixture/parent' });
  const stages = Object.fromEntries(store.list('stage', project.id).map(s => [s.role, s.id]));
  const parent = service.createTicket({ projectId: project.id, title: 'Rollout', ownerId: 'codex', stageId: stages.active });
  const child = service.createTicket({ projectId: project.id, title: 'Phase one', ownerId: 'claude', parentId: parent.id, stageId: stages.planning });
  const childRun = service.claim(child.id, { agentId: 'claude', sessionId: 'child-session' });
  const context = service.getTicket(parent.id).coordination;
  assert.equal(context.role, 'coordinator');
  assert.equal(context.children[0].ownerId, 'claude');
  assert.equal(context.children[0].execution.reserved, true);
  assert.match(context.implementationHold, /Parent containers/);
  assert.equal(store.active(parent.id), null);
  assert.equal(store.active(child.id).id, childRun.id);
  assert.equal(context.children[0].execution.sessionId, undefined);
  assert.equal(context.children[0].description, undefined);
  assert.throws(() => service.claim(parent.id, { agentId: 'codex', sessionId: 'parent-session' }), /Parent containers/);
  assert.throws(() => service.claim(child.id, { agentId: 'codex', sessionId: 'child-takeover' }), /Another execution/);
});
