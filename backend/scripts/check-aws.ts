/** Read-only identity check: prints account/role, never credentials. */
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
const profile = process.env.AWS_PROFILE;
const region = process.env.AWS_REGION ?? 'us-west-2';
try {
  const result = await new STSClient({ region, ...(profile ? { credentials: fromIni({ profile }) } : {}) }).send(new GetCallerIdentityCommand({}));
  console.log(JSON.stringify({ account: result.Account, role: result.Arn, region }, null, 2));
} catch {
  console.error('AWS credentials are unavailable or expired. Export workshop credentials in this terminal, or refresh the selected AWS_PROFILE.');
  process.exitCode = 1;
}
