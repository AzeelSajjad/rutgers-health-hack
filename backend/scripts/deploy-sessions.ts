/** Prepare the small storage stack. --execute applies the displayed change set. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import { CloudFormationClient, ValidateTemplateCommand } from '@aws-sdk/client-cloudformation';
import { deploySessionStack } from './session-stack-deployment.js';
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
const outputs = await deploySessionStack(cf, { stackName: config.stack_name, template, execute: values.execute! }, (id, details) => {
  console.log('Change set:', id);
  for (const item of details.Changes ?? []) console.log(item.ResourceChange?.Action, item.ResourceChange?.LogicalResourceId, item.ResourceChange?.ResourceType);
});
if (outputs) {
  console.log(JSON.stringify(outputs, null, 2));
  mkdirSync('work', { recursive: true });
  writeFileSync('work/storage.env', `AWS_REGION=${config.region}\nSESSION_TABLE_NAME=${outputs.SessionTableName}\nTRANSCRIPT_BUCKET_NAME=${outputs.TranscriptBucketName}\n`);
} else console.log('Prepared only. Inspect this change set in CloudFormation before executing it.');
