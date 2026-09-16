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

import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
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
  }
}
