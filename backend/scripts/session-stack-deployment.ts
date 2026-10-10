import { type DescribeChangeSetCommandOutput, CloudFormationClient, DescribeStacksCommand, CreateChangeSetCommand, DescribeChangeSetCommand, ExecuteChangeSetCommand, waitUntilChangeSetCreateComplete, waitUntilStackCreateComplete, waitUntilStackUpdateComplete } from '@aws-sdk/client-cloudformation';

const defaultWaiters = { changeSet: waitUntilChangeSetCreateComplete, create: waitUntilStackCreateComplete, update: waitUntilStackUpdateComplete };
/** Shared prepare/execute flow; injectable waiters allow regression checks without deploying AWS resources. */
export async function deploySessionStack(
  client: CloudFormationClient,
  config: { stackName: string; template: string; execute: boolean },
  onPrepared: (id: string, changes: DescribeChangeSetCommandOutput) => void = () => {},
  waiters = defaultWaiters,
): Promise<Record<string, string> | null> {
  let changeSetType: 'CREATE' | 'UPDATE' = 'CREATE';
  try {
    const result = await client.send(new DescribeStacksCommand({ StackName: config.stackName }));
    const status = result.Stacks?.[0]?.StackStatus;
    if (!status) throw new Error('CloudFormation did not return a stack status');
    // Preparing a CREATE change set leaves an undeployed placeholder stack.
    changeSetType = status === 'REVIEW_IN_PROGRESS' ? 'CREATE' : 'UPDATE';
  } catch (error) {
    if (!(error instanceof Error && error.name === 'ValidationError' && error.message.includes('does not exist'))) throw error;
  }
  const change = await client.send(new CreateChangeSetCommand({ StackName: config.stackName, ChangeSetName: `demo-storage-${Date.now()}`, ChangeSetType: changeSetType, TemplateBody: config.template, Capabilities: ['CAPABILITY_IAM'] }));
  if (!change.Id) throw new Error('CloudFormation did not return a change set id');
  await waiters.changeSet({ client, maxWaitTime: 120 }, { ChangeSetName: change.Id });
  const details = await client.send(new DescribeChangeSetCommand({ ChangeSetName: change.Id }));
  onPrepared(change.Id, details);
  if (!config.execute) return null;
  await client.send(new ExecuteChangeSetCommand({ ChangeSetName: change.Id }));
  const wait = changeSetType === 'CREATE' ? waiters.create : waiters.update;
  await wait({ client, maxWaitTime: 300 }, { StackName: config.stackName });
  const result = await client.send(new DescribeStacksCommand({ StackName: config.stackName }));
  return Object.fromEntries((result.Stacks?.[0]?.Outputs ?? []).map(output => [output.OutputKey!, output.OutputValue!]));
}
