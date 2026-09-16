/**
 * The managed deployment target.
 *
 * ADR-003 says AWS is *a* destination and not a requirement, and this stack is written to keep that
 * true. Nothing in `src/` knows it exists: the same provider, the same six tools and the same
 * answers run here and in the container, and what changes is the shape of the request and where the
 * fault queue lives.
 *
 * Small on purpose — a function, a table and a URL. An institution reading this to decide whether
 * to adopt Lodge should be able to see the whole bill in one screen.
 */

import { join } from 'node:path';

import { CfnOutput, Duration, RemovalPolicy, Stack, Token } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

export interface LodgeStackProps extends StackProps {
  /**
   * Whether to switch on the development identity header.
   *
   * Off by default, and that is not timidity: `LODGE_DEV_IDENTITY` lets any caller name themselves,
   * and `identity.ts` says the only safe default for that is off and the only way on is somebody
   * typing it. A flag we would wave away here is a flag we would wave away somewhere that matters.
   *
   * Switching it on is defensible for exactly this deployment, because `src/lambda/handler.ts`
   * builds the **synthetic** provider and nothing else. There is no configuration path from this
   * stack to a real institution's data, so the worst it can expose is a fictional university.
   */
  readonly sandbox?: boolean;
  /**
   * How many questions the public demonstration answers per day.
   *
   * It calls a model on every one, so an open page with no ceiling is an open page that eventually
   * spends the whole budget. Generous enough that a room full of judges never notices.
   */
  readonly dailyLimit?: number;
  /** The Bedrock inference profile the demonstration uses. Must match what the code defaults to. */
  readonly modelId?: string;
}

export class LodgeStack extends Stack {
  constructor(scope: Construct, id: string, props: LodgeStackProps = {}) {
    super(scope, id, {
      description: props.sandbox
        ? 'Lodge — public demonstration over generated data. Anyone may claim any identity.'
        : 'Lodge — MCP server for campus questions.',
      ...props,
    });

    /**
     * The only state Lodge has.
     *
     * Partitioned by who filed the fault, because that is the only question ever asked of it:
     * `campus.issue_status` returns what *you* reported and nothing else. No index, no scan.
     *
     * On demand rather than provisioned: a campus assistant's load is a spike at nine in the
     * morning and nothing at three, which is the shape provisioned capacity is worst at.
     */
    const issues = new TableV2(this, 'Issues', {
      partitionKey: { name: 'openedBy', type: AttributeType.STRING },
      sortKey: { name: 'number', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      // The faults are demonstration data over a fictional campus. An institution deploying this
      // for real changes one line — and should, because then they are somebody's actual reports.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const server = new NodejsFunction(this, 'Server', {
      entry: join(import.meta.dirname, '../../src/lambda/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      // Cheaper per millisecond and no slower for this workload, which is JSON and arithmetic.
      architecture: Architecture.ARM_64,
      // Not for the memory — generating the campus fits in far less — but because Lambda scales CPU
      // with it, and the whole budget here is latency.
      memorySize: 512,
      timeout: Duration.seconds(10),
      // An explicit log group rather than `logRetention`, which is deprecated and, worse, deploys a
      // second Lambda whose only job is to set the retention on the first one's logs. Two functions
      // in a stack whose selling point is that you can read the whole bill is one too many.
      logGroup: new LogGroup(this, 'ServerLogs', {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        LODGE_ISSUES_TABLE: issues.tableName,
        ...(props.sandbox ? { LODGE_DEV_IDENTITY: '1' } : {}),
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node24',
        // Left readable: this is an open-source project whose point is that people read it, and a
        // judge unpacking the bundle should find the same code as the repository.
        minify: false,
        sourceMap: true,
      },
    });

    // The three operations the store actually performs, and not the ten `grantReadWriteData`
    // hands out. Nothing in Lodge scans this table or deletes from it — a fault report is not ours
    // to erase — and a permission granted because it was convenient is one nobody revisits.
    issues.grant(server, 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem');

    // No authorizer in front. Lodge does its own OAuth when configured (ADR-013), and putting IAM
    // auth here as well would mean a client needs AWS credentials to reach an MCP server — which
    // is precisely the lock-in ADR-003 exists to avoid.
    const url = server.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

    new CfnOutput(this, 'McpEndpoint', {
      value: `${url.url}mcp`,
      description: 'Point an MCP client here',
    });
    new CfnOutput(this, 'Health', {
      value: `${url.url}health`,
      description: 'What this deployment is serving, in a browser',
    });

    if (props.sandbox) this.#addDemonstration(url.url, props);
  }

  /**
   * The page a judge can use without installing an MCP client.
   *
   * A **second function**, reaching the first over HTTP. That costs a round trip and is the point:
   * the claim being demonstrated is that Lodge is a server anybody's agent can speak to, and a
   * demonstration that reached inside the process would be demonstrating something else. It is the
   * same arrangement `npm run demo` runs locally.
   *
   * Only in a sandbox. This is the one part of Lodge that spends money per question.
   */
  #addDemonstration(mcpUrl: string, props: LodgeStackProps): void {
    const modelId = props.modelId ?? 'eu.amazon.nova-2-lite-v1:0';

    // Nova 2 Lite has no in-region availability anywhere: it is invoked through a *geographic*
    // inference profile, and the profile has to live in the region it is called from. Deploying an
    // `eu.` profile into a US region produces a stack that synthesises, deploys, and then fails on
    // the first question with an error about a model that does not exist there.
    //
    // Checked rather than inferred. Guessing the prefix from the region would quietly pick a
    // geography for somebody, and which continent a European institution's questions are processed
    // on is not a detail to decide on their behalf.
    // Only checkable when the region is known at synthesis time. An environment-agnostic stack —
    // no `env`, region resolved at deploy — is a legitimate CDK pattern, and there the region is a
    // token rather than a string. Refusing to synthesise those would be this guard causing exactly
    // the class of problem it exists to prevent.
    const family = modelId.split('.')[0];
    if (!Token.isUnresolved(this.region) && this.region.split('-')[0] !== family) {
      throw new Error(
        `The model profile '${modelId}' is ${family}-only, but this stack deploys to ` +
          `${this.region}. Pass modelId for that geography — '${this.region.split('-')[0]}.` +
          `amazon.nova-2-lite-v1:0' — or deploy to a matching region.`,
      );
    }

    // A profile routes to the underlying foundation model in several regions, and invoking through
    // one needs permission on the profile *and* on what it routes to.
    const foundationModel = modelId.replace(/^[a-z]{2}\./, '');

    const quota = new TableV2(this, 'DemoQuota', {
      partitionKey: { name: 'day', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const demo = new NodejsFunction(this, 'Demo', {
      entry: join(import.meta.dirname, '../../src/lambda/demo.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      // More than the server needs: this one waits on a model, and Lambda scales CPU with memory,
      // so the cold start is what this buys rather than the heap.
      memorySize: 1024,
      // The agent may call tools over several rounds before it answers. Ten seconds is the server's
      // budget; this is the conversation's.
      timeout: Duration.seconds(30),
      logGroup: new LogGroup(this, 'DemoLogs', {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        LODGE_MCP_URL: mcpUrl,
        LODGE_DEMO_QUOTA_TABLE: quota.tableName,
        LODGE_DEMO_DAILY_LIMIT: String(props.dailyLimit ?? 500),
        LODGE_BEDROCK_MODEL: modelId,
      },
      bundling: { format: OutputFormat.ESM, target: 'node24', minify: false, sourceMap: true },
    });

    // One action. The counter is only ever incremented — never read on its own, never deleted.
    quota.grant(demo, 'dynamodb:UpdateItem');

    demo.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${modelId}`,
          `arn:aws:bedrock:*::foundation-model/${foundationModel}`,
        ],
      }),
    );

    const demoUrl = demo.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

    new CfnOutput(this, 'Demonstration', {
      value: demoUrl.url,
      description: 'The page, for somebody with a browser and no MCP client',
    });
  }
}
