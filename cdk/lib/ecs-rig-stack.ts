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

// ---------------------------------------------------------------------------
// Nonprod stack — 1 cluster, 2 services (development + test)
// ---------------------------------------------------------------------------
export class NonprodStack extends Stack {
  constructor(scope: Construct, id: string, props: EcsRigStackProps) {
    super(scope, id, { ...props, stackName: `NonprodStack-${props.clusterName}` });

    const {
      clusterName,
      logRetentionDays,
      taskCpu,
      taskMemory,
      desiredCount,
      containerImage,
      containerPort = 80,
    } = props;

    const { vpc, subnets } = getNetworkResources(this);

    // -- Security group (egress-only) ---------------------------------------
    const taskSg = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc,
      securityGroupName: `${clusterName}-tasks`,
      description:
        "ECS rig: nonprod ECS tasks. Egress-only, no inbound needed without a load balancer.",
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

    // -- Services (one per nonprod environment) ------------------------------
    const environments = ["development", "test"] as const;

    for (const env of environments) {
      // Log group: /ecs/{cluster}-{env}
      const logGroup = createLogGroup(
        this,
        `LogGroup${env.charAt(0).toUpperCase()}${env.slice(1)}`,
        clusterName,
        env,
        logRetentionDays,
      );

      // Task definition: {cluster}-{env}
      const taskDef = new ecs.FargateTaskDefinition(this, `TaskDef${env.charAt(0).toUpperCase()}${env.slice(1)}`, {
        family: `${clusterName}-${env}`,
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

      // Service: {cluster}-service-{env}
      new ecs.FargateService(this, `Service${env.charAt(0).toUpperCase()}${env.slice(1)}`, {
        cluster,
        taskDefinition: taskDef,
        serviceName: `${clusterName}-service-${env}`,
        desiredCount,
        securityGroups: [taskSg],
        vpcSubnets: { subnets },
        assignPublicIp: true,
      });
    }

    // -- Outputs -------------------------------------------------------------
    new cdk.CfnOutput(this, "NonprodClusterArn", {
      value: cluster.clusterArn,
      description:
        "ARN of the nonprod ECS cluster, for cross-checking against the ecs:cluster condition in the base stack's IAM policy.",
    });

    new cdk.CfnOutput(this, "NonprodServices", {
      value: environments
        .map((e) => `${clusterName}-service-${e}`)
        .join(", "),
      description: "Nonprod service names to watch in Octopus / AWS console.",
    });

    new cdk.CfnOutput(this, "SubnetIds", {
      value: subnets.map((s) => s.subnetId).join(", "),
      description: "Subnet IDs for manual run-task --network-configuration.",
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Security group ID for nonprod tasks.",
    });
  }
}

// ---------------------------------------------------------------------------
// Production stack — 1 cluster, 1 service
// ---------------------------------------------------------------------------
export class ProductionStack extends Stack {
  constructor(scope: Construct, id: string, props: EcsRigStackProps) {
    super(scope, id, { ...props, stackName: `ProductionStack-${props.clusterName}` });

    const {
      clusterName,
      logRetentionDays,
      taskCpu,
      taskMemory,
      desiredCount,
      containerImage,
      containerPort = 80,
    } = props;

    const { vpc, subnets } = getNetworkResources(this);

    // -- Security group (egress-only) ---------------------------------------
    const taskSg = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc,
      securityGroupName: `${clusterName}-tasks`,
      description:
        "ECS rig: production ECS tasks. Egress-only, no inbound needed without a load balancer.",
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

    // -- Log group: /ecs/{cluster} -------------------------------------------
    const logGroup = createLogGroup(
      this,
      "LogGroup",
      clusterName,
      undefined,
      logRetentionDays,
    );

    // -- Task definition: {cluster} ------------------------------------------
    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      family: clusterName,
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

    // -- Service: {cluster}-service ------------------------------------------
    new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: taskDef,
      serviceName: `${clusterName}-service`,
      desiredCount,
      securityGroups: [taskSg],
      vpcSubnets: { subnets },
      assignPublicIp: true,
    });

    // -- Outputs -------------------------------------------------------------
    new cdk.CfnOutput(this, "ProductionClusterArn", {
      value: cluster.clusterArn,
      description:
        "ARN of the production ECS cluster, for cross-checking against the ecs:cluster condition in the base stack's IAM policy.",
    });

    new cdk.CfnOutput(this, "ProductionServiceName", {
      value: `${clusterName}-service`,
      description: "Production service name to watch in Octopus / AWS console.",
    });

    new cdk.CfnOutput(this, "SubnetIds", {
      value: subnets.map((s) => s.subnetId).join(", "),
      description: "Subnet IDs for manual run-task --network-configuration.",
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Security group ID for production tasks.",
    });
  }
}
