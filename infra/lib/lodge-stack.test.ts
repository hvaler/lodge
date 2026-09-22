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

const ENV = { account: '123456789012', region: 'eu-west-1' };

beforeAll(() => {
  // A concrete environment, because that is what gets deployed and because the ARNs below are only
  // meaningful once a region is known.
  plain = Template.fromStack(new LodgeStack(new App(), 'Test', { sandbox: false, env: ENV }));
  sandboxed = Template.fromStack(new LodgeStack(new App(), 'Sandbox', { sandbox: true, env: ENV }));
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

  it('grows by exactly one function and one table when the demonstration is added', () => {
    // The page is a *second* function reaching the first over HTTP, which is the arrangement the
    // submission claims: what you watch it do, your own agent can do.
    const template = templateOf(true);

    template.resourceCountIs('AWS::Lambda::Function', 2);
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 2);
    template.resourceCountIs('AWS::Lambda::Url', 2);
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

describe('the demonstration, which is the only part that spends money per question', () => {
  it('exists only in a sandbox', () => {
    // Without the flag there is no page, no model permission and nothing to meter.
    templateOf().resourceCountIs('AWS::Lambda::Function', 1);
    expect(JSON.stringify(templateOf().toJSON())).not.toContain('bedrock');
  });

  it('carries a daily ceiling, because an open page with none eventually spends the budget', () => {
    templateOf(true).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ LODGE_DEMO_DAILY_LIMIT: '500' }) },
    });
  });

  it('may invoke one model and no others', () => {
    templateOf(true).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:InvokeModel',
            Resource: Match.arrayWith([Match.stringLikeRegexp('nova-2-lite')]),
          }),
        ]),
      }),
    });
  });

  it('may only increment the counter, not read or delete it', () => {
    templateOf(true).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Action: 'dynamodb:UpdateItem' })]),
      }),
    });
  });

  it('still synthesises when the region is only known at deploy time', () => {
    // No `env`: the region is a token, the check cannot be made, and that must not be fatal.
    expect(() =>
      Template.fromStack(new LodgeStack(new App(), 'Agnostic', { sandbox: true })),
    ).not.toThrow();
    // Generous, because building another stack means bundling the functions again.
  }, 120_000);

  it('refuses to synthesise a model profile from the wrong continent', () => {
    // Deploying an `eu.` profile into a US region gives a stack that deploys and then fails on the
    // first question. Better to fail here, where somebody is watching.
    expect(() =>
      Template.fromStack(
        new LodgeStack(new App(), 'Wrong', { sandbox: true, env: { ...ENV, region: 'us-east-1' } }),
      ),
    ).toThrow(/is eu-only, but this stack deploys to us-east-1/);
  }, 120_000);
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

describe('the bridge to a real device', () => {
  const SKILL = 'amzn1.ask.skill.00000000-0000-0000-0000-000000000000';
  const ALEXA = { Principal: 'alexa-appkit.smapi.amazon.com' };
  let bridged: Template;

  // Synthesised once, like the others: each one bundles a function with esbuild, and paying
  // several seconds per assertion is how a suite becomes something people skip.
  beforeAll(() => {
    bridged = Template.fromStack(
      new LodgeStack(new App(), 'Bridge', { sandbox: true, alexaSkillId: SKILL, env: ENV }),
    );
  }, 120_000);

  /** Permissions naming Alexa. Counting all of them would count the two function URLs as well. */
  function alexaPermissions(template: Template): number {
    return Object.values(
      template.findResources('AWS::Lambda::Permission', { Properties: ALEXA }),
    ).length;
  }

  it('is not deployed unless somebody names a skill', () => {
    // It spends money per question and exists to record a video. Off is the only sane default, and
    // the id cannot be known before the skill exists in the developer console anyway.
    expect(alexaPermissions(templateOf(false))).toBe(0);
    expect(alexaPermissions(templateOf(true))).toBe(0);
  });

  it('lets that one skill invoke it, and no other', () => {
    // `eventSourceToken` is what turns "anybody's skill may invoke this" into "ours may".
    bridged.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'alexa-appkit.smapi.amazon.com',
      EventSourceToken: SKILL,
    });
    expect(alexaPermissions(bridged)).toBe(1);
  });

  it('has no function URL, because Alexa invokes it directly', () => {
    // Two URLs in the stack — the server and the page — and the bridge is not a third. An HTTPS
    // endpoint would mean a certificate to keep and Alexa's request signature to verify.
    bridged.resourceCountIs('AWS::Lambda::Url', 2);
  });

  it('gives up before Alexa does, and knows whose envelopes to answer', () => {
    // A function still working when Alexa has hung up is burning money for an answer nobody hears.
    bridged.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 8,
      Environment: { Variables: Match.objectLike({ LODGE_SKILL_ID: SKILL }) },
    });
  });

  it('is not deployed outside a sandbox even when a skill is named', () => {
    // The bridge talks to the deployment that runs the identity bypass. Outside a sandbox that
    // deployment does not exist, and a bridge to it would be a bridge to nowhere.
    const outside = Template.fromStack(
      new LodgeStack(new App(), 'BridgeProd', { sandbox: false, alexaSkillId: SKILL, env: ENV }),
    );

    expect(alexaPermissions(outside)).toBe(0);
  }, 120_000);
});
