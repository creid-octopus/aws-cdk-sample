import * as cdk from "aws-cdk-lib";
import { aws_ec2 as ec2, aws_ecs as ecs, aws_iam as iam, aws_logs as logs, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

// ---------------------------------------------------------------------------
// Configuration interface — all values come from cdk.json context or env vars,
// making it easy to override from Octopus without touching code.
// ---------------------------------------------------------------------------
export interface EcsRigStackProps extends StackProps {
  clusterName: string;
  logRetentionDays: number;
  taskCpu: string;
  taskMemory: string;
  desiredCount: number;
  containerImage?: string;
  containerPort?: number;
}

// Internal-only — the bit that actually differs between nonprod and
// production, added by the two thin subclasses below rather than exposed to
// bin/ecs-rig-cdk.ts (its call sites don't change at all).
interface EcsRigStackInternalProps extends EcsRigStackProps {
  // One service per entry. A named entry ("development", "test") gets that
  // name suffixed onto every resource for it (nonprod's two services). A
  // single `undefined` entry means one unnamed service, no suffix anywhere
  // (production's one service) — this is what makes the same loop below
  // produce both shapes without an if/else fork.
  serviceNames: (string | undefined)[];
  outputPrefix: "Nonprod" | "Production";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Map a configurable day count to the nearest CDK RetentionDays enum value. */
function mapRetentionDays(days: number): logs.RetentionDays {
  switch (days) {
    case 1: return logs.RetentionDays.ONE_DAY;
    case 3: return logs.RetentionDays.THREE_DAYS;
    case 5: return logs.RetentionDays.FIVE_DAYS;
    case 7: return logs.RetentionDays.ONE_WEEK;
    case 14: return logs.RetentionDays.TWO_WEEKS;
    case 30: return logs.RetentionDays.ONE_MONTH;
    case 60: return logs.RetentionDays.TWO_MONTHS;
    case 90: return logs.RetentionDays.THREE_MONTHS;
    case 120: return logs.RetentionDays.FOUR_MONTHS;
    case 150: return logs.RetentionDays.FIVE_MONTHS;
    case 180: return logs.RetentionDays.SIX_MONTHS;
    case 365: return logs.RetentionDays.ONE_YEAR;
    case 400: return logs.RetentionDays.THIRTEEN_MONTHS;
    case 545: return logs.RetentionDays.EIGHTEEN_MONTHS;
    case 731: return logs.RetentionDays.TWO_YEARS;
    case 1096: return logs.RetentionDays.THREE_YEARS;
    case 1827: return logs.RetentionDays.FIVE_YEARS;
    case 2192: return logs.RetentionDays.SIX_YEARS;
    default: return logs.RetentionDays.THREE_DAYS;
  }
}

/** Look up the account's default VPC and return both VPC and its public subnets. */
function getNetworkResources(scope: Construct): { vpc: ec2.IVpc; subnets: ec2.ISubnet[] } {
  const vpc = ec2.Vpc.fromLookup(scope, "DefaultVpc", { isDefault: true });
  return { vpc, subnets: vpc.publicSubnets };
}

/** Create the ECS task execution role (trust ECS tasks, attach managed policy). */
function createExecutionRole(
  scope: Construct,
  id: string,
  clusterName: string,
): iam.Role {
  const role = new iam.Role(scope, id, {
    roleName: `${clusterName}-execution-role`,
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
  });
  role.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName(
      "service-role/AmazonECSTaskExecutionRolePolicy",
    ),
  );
  return role;
}

/** Create a CloudWatch log group for a task. */
function createLogGroup(
  scope: Construct,
  id: string,
  clusterName: string,
  environment: string | undefined,
  retentionDays: number,
): logs.ILogGroup {
  const logGroupName = environment
    ? `/ecs/${clusterName}-${environment}`
    : `/ecs/${clusterName}`;
  return new logs.LogGroup(scope, id, {
    logGroupName,
    retention: mapRetentionDays(retentionDays),
  });
}

/** "development" -> "Development" — for construct IDs, which can't contain hyphens. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// One cluster, one execution role, one security group, and one Fargate
// service per entry in serviceNames — this is what both NonprodStack (two
// services: development, test) and ProductionStack (one unnamed service)
// actually are underneath. They were two ~100-line classes that only ever
// differed in the services loop and the output names; this is that shared
// body, kept package-private (not exported) since bin/ecs-rig-cdk.ts only
// ever needs the two named subclasses below, not this one directly.
//
// Naming is unchanged from before this merge — every resource name, log
// group path, and construct ID here matches what NonprodStack/ProductionStack
// each produced on their own. That matters: the base stack's Terraform IAM
// policies (main.tf, cdk-bootstrap.tf) reference these names directly
// (ecs:cluster ARNs, iam:PassRole patterns, log group ARNs), so preserving
// them exactly means this refactor doesn't create a second naming contract
// to keep in sync.
// ---------------------------------------------------------------------------
class EcsRigStack extends Stack {
  constructor(scope: Construct, id: string, props: EcsRigStackInternalProps) {
    super(scope, id, { ...props, stackName: `${id}-${props.clusterName}` });

    const {
      clusterName,
      logRetentionDays,
      taskCpu,
      taskMemory,
      desiredCount,
      containerImage,
      containerPort = 80,
      serviceNames,
      outputPrefix,
    } = props;

    const { vpc, subnets } = getNetworkResources(this);

    // -- Security group (egress-only) ---------------------------------------
    const taskSg = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc,
      securityGroupName: `${clusterName}-tasks`,
      description: `ECS rig: ${outputPrefix.toLowerCase()} ECS tasks. Egress-only, no inbound needed without a load balancer.`,
    });
    taskSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.allTraffic(),
      "Allow all outbound",
    );

    // -- Execution role ------------------------------------------------------
    const executionRole = createExecutionRole(this, "ExecutionRole", clusterName);

    // -- Cluster -------------------------------------------------------------
    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName,
      vpc,
    });

    // -- Services (one per entry in serviceNames) ----------------------------
    const resolvedServiceNames: string[] = [];

    for (const env of serviceNames) {
      const suffix = env ? `-${env}` : "";
      const idSuffix = env ? capitalize(env) : "";

      // Log group: /ecs/{cluster}-{env}, or /ecs/{cluster} when unnamed
      const logGroup = createLogGroup(
        this,
        `LogGroup${idSuffix}`,
        clusterName,
        env,
        logRetentionDays,
      );

      // Task definition: {cluster}-{env}, or {cluster} when unnamed
      const taskDef = new ecs.FargateTaskDefinition(this, `TaskDef${idSuffix}`, {
        family: `${clusterName}${suffix}`,
        cpu: parseInt(taskCpu, 10),
        memoryLimitMiB: parseInt(taskMemory, 10),
        executionRole,
      });

      taskDef.addContainer("app", {
        image: containerImage
          ? ecs.ContainerImage.fromRegistry(containerImage)
          : ecs.ContainerImage.fromRegistry(
              "public.ecr.aws/nginx/nginx:1.27-alpine",
            ),
        portMappings: [{ containerPort, protocol: ecs.Protocol.TCP }],
        logging: new ecs.AwsLogDriver({
          logGroup,
          streamPrefix: "ecs",
        }),
      });

      // Service: {cluster}-service-{env}, or {cluster}-service when unnamed
      const serviceName = `${clusterName}-service${suffix}`;
      new ecs.FargateService(this, `Service${idSuffix}`, {
        cluster,
        taskDefinition: taskDef,
        serviceName,
        desiredCount,
        securityGroups: [taskSg],
        vpcSubnets: { subnets },
        assignPublicIp: true,
      });

      resolvedServiceNames.push(serviceName);
    }

    // -- Outputs -------------------------------------------------------------
    new cdk.CfnOutput(this, `${outputPrefix}ClusterArn`, {
      value: cluster.clusterArn,
      description: `ARN of the ${outputPrefix.toLowerCase()} ECS cluster, for cross-checking against the ecs:cluster condition in the base stack's IAM policy.`,
    });

    // Nonprod (multiple services) gets a joined "Services" output, same as
    // before the merge; production (exactly one) keeps its singular
    // "ServiceName" output rather than a one-element list — output key names
    // are unchanged either way, so nothing downstream that reads these has
    // to change.
    if (resolvedServiceNames.length > 1) {
      new cdk.CfnOutput(this, `${outputPrefix}Services`, {
        value: resolvedServiceNames.join(", "),
        description: `${outputPrefix} service names to watch in Octopus / AWS console.`,
      });
    } else {
      new cdk.CfnOutput(this, `${outputPrefix}ServiceName`, {
        value: resolvedServiceNames[0],
        description: `${outputPrefix} service name to watch in Octopus / AWS console.`,
      });
    }

    new cdk.CfnOutput(this, "SubnetIds", {
      value: subnets.map((s) => s.subnetId).join(", "),
      description: "Subnet IDs for manual run-task --network-configuration.",
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: taskSg.securityGroupId,
      description: `Security group ID for ${outputPrefix.toLowerCase()} tasks.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Nonprod stack — 1 cluster, 2 services (development + test)
// ---------------------------------------------------------------------------
export class NonprodStack extends EcsRigStack {
  constructor(scope: Construct, id: string, props: EcsRigStackProps) {
    super(scope, id, {
      ...props,
      serviceNames: ["development", "test"],
      outputPrefix: "Nonprod",
    });
  }
}

// ---------------------------------------------------------------------------
// Production stack — 1 cluster, 1 service
// ---------------------------------------------------------------------------
export class ProductionStack extends EcsRigStack {
  constructor(scope: Construct, id: string, props: EcsRigStackProps) {
    super(scope, id, {
      ...props,
      serviceNames: [undefined],
      outputPrefix: "Production",
    });
  }
}
