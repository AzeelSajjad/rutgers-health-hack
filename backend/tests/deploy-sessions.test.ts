import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudFormationClient, type StackStatus, waitUntilStackCreateComplete } from '@aws-sdk/client-cloudformation';
import { deploySessionStack } from '../scripts/session-stack-deployment.js';

function scenario(initialStatus?: StackStatus, failure?: Error) {
  let status = initialStatus;
  const types: string[] = [], waits: string[] = [];
  const success = { state: 'SUCCESS' as Awaited<ReturnType<typeof waitUntilStackCreateComplete>>['state'] };
  const client = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (command.constructor.name) {
      case 'DescribeStacksCommand':
        if (failure) throw failure;
        if (!status) throw Object.assign(new Error('Stack demo does not exist'), { name: 'ValidationError' });
        return { Stacks: [{ StackStatus: status, Outputs: [{ OutputKey: 'SessionTableName', OutputValue: 'demo-table' }] }] };
      case 'CreateChangeSetCommand':
        types.push(command.input.ChangeSetType as string);
        if (!status) status = 'REVIEW_IN_PROGRESS';
        return { Id: `change-${types.length}` };
      case 'DescribeChangeSetCommand': return { Changes: [] };
      case 'ExecuteChangeSetCommand': return {};
      default: throw new Error(`Unexpected ${command.constructor.name}`);
    }
  } } as unknown as CloudFormationClient;
  const waiters = {
    changeSet: async () => { waits.push('change-set'); return success; },
    create: async () => { waits.push('create'); status = 'CREATE_COMPLETE'; return success; },
    update: async () => { waits.push('update'); status = 'UPDATE_COMPLETE'; return success; },
  };
  return { client, waiters, types, waits };
}
const config = { stackName: 'demo', template: '{}', execute: false };
test('prepare then execute a new stack uses CREATE twice and the create completion waiter', async () => {
  const flow = scenario();
  assert.equal(await deploySessionStack(flow.client, config, undefined, flow.waiters), null);
  assert.deepEqual(flow.types, ['CREATE']);
  assert.deepEqual(flow.waits, ['change-set']);
  const outputs = await deploySessionStack(flow.client, { ...config, execute: true }, undefined, flow.waiters);
  assert.deepEqual(flow.types, ['CREATE', 'CREATE']);
  assert.deepEqual(flow.waits, ['change-set', 'change-set', 'create']);
  assert.equal(outputs?.SessionTableName, 'demo-table');
});
test('already-deployed stack uses UPDATE and the update completion waiter', async () => {
  const flow = scenario('CREATE_COMPLETE');
  await deploySessionStack(flow.client, { ...config, execute: true }, undefined, flow.waiters);
  assert.deepEqual(flow.types, ['UPDATE']);
  assert.deepEqual(flow.waits, ['change-set', 'update']);
});
test('describe-stack permission failures stop deployment instead of selecting CREATE', async () => {
  const denied = Object.assign(new Error('Denied'), { name: 'AccessDeniedException' });
  const flow = scenario(undefined, denied);
  await assert.rejects(deploySessionStack(flow.client, config, undefined, flow.waiters), denied);
  assert.deepEqual(flow.types, []);
});
