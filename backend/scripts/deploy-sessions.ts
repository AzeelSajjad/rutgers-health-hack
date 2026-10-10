/** Prepare the small storage stack. --execute applies the displayed change set. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { CloudFormationClient, ValidateTemplateCommand, DescribeStacksCommand, CreateChangeSetCommand, DescribeChangeSetCommand, ExecuteChangeSetCommand, waitUntilChangeSetCreateComplete, waitUntilStackCreateComplete, waitUntilStackUpdateComplete } from '@aws-sdk/client-cloudformation';
const { values } = parseArgs({ options: { config: { type: 'string', default: 'infrastructure/deployment.local.json' }, execute: { type: 'boolean', default: false } } });
const config: { profile: string; region: string; expected_account: string; stack_name: string } = JSON.parse(readFileSync(values.config!, 'utf8'));
for (const key of ['profile', 'region', 'expected_account', 'stack_name'] as const) if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Missing ${key}`);
if (!/^\d{12}$/.test(config.expected_account) || !/^[A-Za-z][A-Za-z0-9-]{0,39}$/.test(config.stack_name)) throw new Error('Invalid account or stack name');
const options = { region: config.region, credentials: fromIni({ profile: config.profile }) };
const account = await new STSClient(options).send(new GetCallerIdentityCommand({}));
if (account.Account !== config.expected_account) throw new Error('AWS account mismatch; nothing was deployed');
const cf = new CloudFormationClient(options);
const template = readFileSync(new URL('../infrastructure/sessions-stack.json', import.meta.url), 'utf8');
await cf.send(new ValidateTemplateCommand({ TemplateBody: template }));
let exists = true;
try { await cf.send(new DescribeStacksCommand({ StackName: config.stack_name })); }
catch (error) {
  if (error instanceof Error && error.name === 'ValidationError' && error.message.includes('does not exist')) exists = false;
  else throw error;
}
const change = await cf.send(new CreateChangeSetCommand({ StackName: config.stack_name, ChangeSetName: `demo-storage-${Date.now()}`, ChangeSetType: exists ? 'UPDATE' : 'CREATE', TemplateBody: template, Capabilities: ['CAPABILITY_IAM'] }));
await waitUntilChangeSetCreateComplete({ client: cf, maxWaitTime: 120 }, { ChangeSetName: change.Id });
const details = await cf.send(new DescribeChangeSetCommand({ ChangeSetName: change.Id }));
console.log('Change set:', change.Id);
for (const item of details.Changes ?? []) console.log(item.ResourceChange?.Action, item.ResourceChange?.LogicalResourceId, item.ResourceChange?.ResourceType);
if (values.execute) {
  await cf.send(new ExecuteChangeSetCommand({ ChangeSetName: change.Id }));
  const wait = exists ? waitUntilStackUpdateComplete : waitUntilStackCreateComplete;
  await wait({ client: cf, maxWaitTime: 300 }, { StackName: config.stack_name });
  const result = await cf.send(new DescribeStacksCommand({ StackName: config.stack_name }));
  const outputs = Object.fromEntries((result.Stacks?.[0]?.Outputs ?? []).map(output => [output.OutputKey!, output.OutputValue!]));
  console.log(JSON.stringify(outputs, null, 2));
  mkdirSync('work', { recursive: true });
  writeFileSync('work/storage.env', `AWS_REGION=${config.region}\nSESSION_TABLE_NAME=${outputs.SessionTableName}\nTRANSCRIPT_BUCKET_NAME=${outputs.TranscriptBucketName}\n`);
} else console.log('Prepared only. Inspect this change set in CloudFormation before executing it.');
