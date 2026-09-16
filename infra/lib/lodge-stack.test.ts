/**
 * What the stack actually synthesises.
 *
 * Infrastructure is the part nobody reads until it is already deployed, and the failure mode is a
 * permission or an environment variable that was right in the pull request and wrong in the
 * account. These assertions are on the CloudFormation, not on the constructs, so they say what AWS
 * will be told rather than what CDK was asked.
 */

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { LodgeStack } from './lodge-stack.ts';

// Synthesised once, not per assertion: the first one bundles the function with esbuild, and paying
// several seconds for that eight times over would make the suite something people skip.
let plain: Template;
let sandboxed: Template;

beforeAll(() => {
  plain = Template.fromStack(new LodgeStack(new App(), 'Test', { sandbox: false }));
  sandboxed = Template.fromStack(new LodgeStack(new App(), 'Sandbox', { sandbox: true }));
}, 120_000);

function templateOf(sandbox = false): Template {
  return sandbox ? sandboxed : plain;
}

describe('the shape of the bill', () => {
  it('is one function and one table, which is the whole claim', () => {
    const template = templateOf();

    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
  });

  it('bills the table on demand, because campus load is a spike at nine and nothing at three', () => {
    templateOf().hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('partitions the faults by who filed them, which is the only question asked of them', () => {
    templateOf().hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'openedBy', KeyType: 'HASH' },
        { AttributeName: 'number', KeyType: 'RANGE' },
      ],
    });
  });
});

describe('the function', () => {
  it('runs the runtime the project declares it needs', () => {
    templateOf().hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
    });
  });

  it('is reachable without AWS credentials, or it would not be an MCP server anyone can use', () => {
    // ADR-003: AWS is a destination, not a requirement. IAM auth on the URL would mean a client
    // needs an AWS account to ask what room is free.
    templateOf().hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('can query and write faults, and nothing else', () => {
    // Least privilege, asserted rather than assumed: `grantReadWriteData` would also hand over
    // Scan and DeleteItem, and a fault report is not ours to erase.
    templateOf().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });
});

describe('the development identity header', () => {
  it('is off unless somebody asked for it', () => {
    // The rule `identity.ts` sets: a header that lets any caller name themselves is an
    // authentication bypass, so the only safe default is off.
    templateOf().hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.not(Match.objectLike({ LODGE_DEV_IDENTITY: '1' })) },
    });
  });

  it('is on when the deployment is declared a sandbox, and the stack says so out loud', () => {
    const template = templateOf(true);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ LODGE_DEV_IDENTITY: '1' }) },
    });
    // Whoever opens the console should learn what this is from the stack, not from the source.
    expect(template.toJSON().Description).toMatch(/Anyone may claim any identity/);
  });
});
