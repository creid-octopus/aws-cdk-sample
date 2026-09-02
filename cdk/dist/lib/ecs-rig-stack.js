"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductionStack = exports.NonprodStack = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** Map a configurable day count to the nearest CDK RetentionDays enum value. */
function mapRetentionDays(days) {
    switch (days) {
        case 1: return aws_cdk_lib_1.aws_logs.RetentionDays.ONE_DAY;
        case 3: return aws_cdk_lib_1.aws_logs.RetentionDays.THREE_DAYS;
        case 5: return aws_cdk_lib_1.aws_logs.RetentionDays.FIVE_DAYS;
        case 7: return aws_cdk_lib_1.aws_logs.RetentionDays.ONE_WEEK;
        case 14: return aws_cdk_lib_1.aws_logs.RetentionDays.TWO_WEEKS;
        case 30: return aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH;
        case 60: return aws_cdk_lib_1.aws_logs.RetentionDays.TWO_MONTHS;
        case 90: return aws_cdk_lib_1.aws_logs.RetentionDays.THREE_MONTHS;
        case 120: return aws_cdk_lib_1.aws_logs.RetentionDays.FOUR_MONTHS;
        case 150: return aws_cdk_lib_1.aws_logs.RetentionDays.FIVE_MONTHS;
        case 180: return aws_cdk_lib_1.aws_logs.RetentionDays.SIX_MONTHS;
        case 365: return aws_cdk_lib_1.aws_logs.RetentionDays.ONE_YEAR;
        case 400: return aws_cdk_lib_1.aws_logs.RetentionDays.THIRTEEN_MONTHS;
        case 545: return aws_cdk_lib_1.aws_logs.RetentionDays.EIGHTEEN_MONTHS;
        case 731: return aws_cdk_lib_1.aws_logs.RetentionDays.TWO_YEARS;
        case 1096: return aws_cdk_lib_1.aws_logs.RetentionDays.THREE_YEARS;
        case 1827: return aws_cdk_lib_1.aws_logs.RetentionDays.FIVE_YEARS;
        case 2192: return aws_cdk_lib_1.aws_logs.RetentionDays.SIX_YEARS;
        default: return aws_cdk_lib_1.aws_logs.RetentionDays.THREE_DAYS;
    }
}
/** Look up the account's default VPC and return both VPC and its public subnets. */
function getNetworkResources(scope) {
    const vpc = aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(scope, "DefaultVpc", { isDefault: true });
    return { vpc, subnets: vpc.publicSubnets };
}
/** Create the ECS task execution role (trust ECS tasks, attach managed policy). */
function createExecutionRole(scope, id, clusterName) {
    const role = new aws_cdk_lib_1.aws_iam.Role(scope, id, {
        roleName: `${clusterName}-execution-role`,
        assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    role.addManagedPolicy(aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"));
    return role;
}
/** Create a CloudWatch log group for a task. */
function createLogGroup(scope, id, clusterName, environment, retentionDays) {
    const logGroupName = environment
        ? `/ecs/${clusterName}-${environment}`
        : `/ecs/${clusterName}`;
    return new aws_cdk_lib_1.aws_logs.LogGroup(scope, id, {
        logGroupName,
        retention: mapRetentionDays(retentionDays),
    });
}
// ---------------------------------------------------------------------------
// Nonprod stack — 1 cluster, 2 services (development + test)
// ---------------------------------------------------------------------------
class NonprodStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, { ...props, stackName: `NonprodStack-${props.clusterName}` });
        const { clusterName, logRetentionDays, taskCpu, taskMemory, desiredCount, containerImage, containerPort = 80, } = props;
        const { vpc, subnets } = getNetworkResources(this);
        // -- Security group (egress-only) ---------------------------------------
        const taskSg = new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, "TaskSecurityGroup", {
            vpc,
            securityGroupName: `${clusterName}-tasks`,
            description: "ECS rig: nonprod ECS tasks. Egress-only, no inbound needed without a load balancer.",
        });
        taskSg.addEgressRule(aws_cdk_lib_1.aws_ec2.Peer.anyIpv4(), aws_cdk_lib_1.aws_ec2.Port.allTraffic(), "Allow all outbound");
        // -- Execution role ------------------------------------------------------
        const executionRole = createExecutionRole(this, "ExecutionRole", clusterName);
        // -- Cluster -------------------------------------------------------------
        const cluster = new aws_cdk_lib_1.aws_ecs.Cluster(this, "Cluster", {
            clusterName,
            vpc,
        });
        // -- Services (one per nonprod environment) ------------------------------
        const environments = ["development", "test"];
        for (const env of environments) {
            // Log group: /ecs/{cluster}-{env}
            const logGroup = createLogGroup(this, `LogGroup${env.charAt(0).toUpperCase()}${env.slice(1)}`, clusterName, env, logRetentionDays);
            // Task definition: {cluster}-{env}
            const taskDef = new aws_cdk_lib_1.aws_ecs.FargateTaskDefinition(this, `TaskDef${env.charAt(0).toUpperCase()}${env.slice(1)}`, {
                family: `${clusterName}-${env}`,
                cpu: parseInt(taskCpu, 10),
                memoryLimitMiB: parseInt(taskMemory, 10),
                executionRole,
            });
            taskDef.addContainer("app", {
                image: containerImage
                    ? aws_cdk_lib_1.aws_ecs.ContainerImage.fromRegistry(containerImage)
                    : aws_cdk_lib_1.aws_ecs.ContainerImage.fromRegistry("public.ecr.aws/nginx/nginx:1.27-alpine"),
                portMappings: [{ containerPort, protocol: aws_cdk_lib_1.aws_ecs.Protocol.TCP }],
                logging: new aws_cdk_lib_1.aws_ecs.AwsLogDriver({
                    logGroup,
                    streamPrefix: "ecs",
                }),
            });
            // Service: {cluster}-service-{env}
            new aws_cdk_lib_1.aws_ecs.FargateService(this, `Service${env.charAt(0).toUpperCase()}${env.slice(1)}`, {
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
            description: "ARN of the nonprod ECS cluster, for cross-checking against the ecs:cluster condition in the base stack's IAM policy.",
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
exports.NonprodStack = NonprodStack;
// ---------------------------------------------------------------------------
// Production stack — 1 cluster, 1 service
// ---------------------------------------------------------------------------
class ProductionStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, { ...props, stackName: `ProductionStack-${props.clusterName}` });
        const { clusterName, logRetentionDays, taskCpu, taskMemory, desiredCount, containerImage, containerPort = 80, } = props;
        const { vpc, subnets } = getNetworkResources(this);
        // -- Security group (egress-only) ---------------------------------------
        const taskSg = new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, "TaskSecurityGroup", {
            vpc,
            securityGroupName: `${clusterName}-tasks`,
            description: "ECS rig: production ECS tasks. Egress-only, no inbound needed without a load balancer.",
        });
        taskSg.addEgressRule(aws_cdk_lib_1.aws_ec2.Peer.anyIpv4(), aws_cdk_lib_1.aws_ec2.Port.allTraffic(), "Allow all outbound");
        // -- Execution role ------------------------------------------------------
        const executionRole = createExecutionRole(this, "ExecutionRole", clusterName);
        // -- Cluster -------------------------------------------------------------
        const cluster = new aws_cdk_lib_1.aws_ecs.Cluster(this, "Cluster", {
            clusterName,
            vpc,
        });
        // -- Log group: /ecs/{cluster} -------------------------------------------
        const logGroup = createLogGroup(this, "LogGroup", clusterName, undefined, logRetentionDays);
        // -- Task definition: {cluster} ------------------------------------------
        const taskDef = new aws_cdk_lib_1.aws_ecs.FargateTaskDefinition(this, "TaskDef", {
            family: clusterName,
            cpu: parseInt(taskCpu, 10),
            memoryLimitMiB: parseInt(taskMemory, 10),
            executionRole,
        });
        taskDef.addContainer("app", {
            image: containerImage
                ? aws_cdk_lib_1.aws_ecs.ContainerImage.fromRegistry(containerImage)
                : aws_cdk_lib_1.aws_ecs.ContainerImage.fromRegistry("public.ecr.aws/nginx/nginx:1.27-alpine"),
            portMappings: [{ containerPort, protocol: aws_cdk_lib_1.aws_ecs.Protocol.TCP }],
            logging: new aws_cdk_lib_1.aws_ecs.AwsLogDriver({
                logGroup,
                streamPrefix: "ecs",
            }),
        });
        // -- Service: {cluster}-service ------------------------------------------
        new aws_cdk_lib_1.aws_ecs.FargateService(this, "Service", {
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
            description: "ARN of the production ECS cluster, for cross-checking against the ecs:cluster condition in the base stack's IAM policy.",
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
exports.ProductionStack = ProductionStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLXJpZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9lY3MtcmlnLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyw2Q0FBa0g7QUFpQmxILDhFQUE4RTtBQUM5RSxpQkFBaUI7QUFDakIsOEVBQThFO0FBRTlFLGdGQUFnRjtBQUNoRixTQUFTLGdCQUFnQixDQUFDLElBQVk7SUFDcEMsUUFBUSxJQUFJLEVBQUUsQ0FBQztRQUNiLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxzQkFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUM7UUFDMUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLHNCQUFJLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQztRQUM3QyxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sc0JBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDO1FBQzVDLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxzQkFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUM7UUFDM0MsS0FBSyxFQUFFLENBQUMsQ0FBQyxPQUFPLHNCQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQztRQUM3QyxLQUFLLEVBQUUsQ0FBQyxDQUFDLE9BQU8sc0JBQUksQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDO1FBQzdDLEtBQUssRUFBRSxDQUFDLENBQUMsT0FBTyxzQkFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7UUFDOUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxPQUFPLHNCQUFJLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQztRQUNoRCxLQUFLLEdBQUcsQ0FBQyxDQUFDLE9BQU8sc0JBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDO1FBQ2hELEtBQUssR0FBRyxDQUFDLENBQUMsT0FBTyxzQkFBSSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUM7UUFDaEQsS0FBSyxHQUFHLENBQUMsQ0FBQyxP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QUFFO1lBQy9DLEtBQUssRUFBRSxHQUFHLFdBQVcsVUFBVTtZQUMvQixXQUFXLEVBQUUsNERBQTREO1NBQzFFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ25DLEtBQUssRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztZQUNoRCxXQUFXLEVBQUUseURBQXlEO1NBQ3ZFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxlQUFlO1lBQzdCLFdBQVcsRUFBRSx5Q0FBeUM7U0FDdkQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBckdELDBDQXFHQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IGF3c19lYzIgYXMgZWMyLCBhd3NfZWNzIGFzIGVjcywgYXdzX2lhbSBhcyBpYW0sIGF3c19sb2dzIGFzIGxvZ3MsIFN0YWNrLCBTdGFja1Byb3BzIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbmZpZ3VyYXRpb24gaW50ZXJmYWNlIOKAlCBhbGwgdmFsdWVzIGNvbWUgZnJvbSBjZGsuanNvbiBjb250ZXh0IG9yIGVudiB2YXJzLFxuLy8gbWFraW5nIGl0IGVhc3kgdG8gb3ZlcnJpZGUgZnJvbSBPY3RvcHVzIHdpdGhvdXQgdG91Y2hpbmcgY29kZS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZXhwb3J0IGludGVyZmFjZSBFY3NSaWdTdGFja1Byb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIGNsdXN0ZXJOYW1lOiBzdHJpbmc7XG4gIGxvZ1JldGVudGlvbkRheXM6IG51bWJlcjtcbiAgdGFza0NwdTogc3RyaW5nO1xuICB0YXNrTWVtb3J5OiBzdHJpbmc7XG4gIGRlc2lyZWRDb3VudDogbnVtYmVyO1xuICBjb250YWluZXJJbWFnZT86IHN0cmluZztcbiAgY29udGFpbmVyUG9ydD86IG51bWJlcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTaGFyZWQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBNYXAgYSBjb25maWd1cmFibGUgZGF5IGNvdW50IHRvIHRoZSBuZWFyZXN0IENESyBSZXRlbnRpb25EYXlzIGVudW0gdmFsdWUuICovXG5mdW5jdGlvbiBtYXBSZXRlbnRpb25EYXlzKGRheXM6IG51bWJlcik6IGxvZ3MuUmV0ZW50aW9uRGF5cyB7XG4gIHN3aXRjaCAoZGF5cykge1xuICAgIGNhc2UgMTogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfREFZO1xuICAgIGNhc2UgMzogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5USFJFRV9EQVlTO1xuICAgIGNhc2UgNTogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5GSVZFX0RBWVM7XG4gICAgY2FzZSA3OiByZXR1cm4gbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLO1xuICAgIGNhc2UgMTQ6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuVFdPX1dFRUtTO1xuICAgIGNhc2UgMzA6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRIO1xuICAgIGNhc2UgNjA6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuVFdPX01PTlRIUztcbiAgICBjYXNlIDkwOiByZXR1cm4gbG9ncy5SZXRlbnRpb25EYXlzLlRIUkVFX01PTlRIUztcbiAgICBjYXNlIDEyMDogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5GT1VSX01PTlRIUztcbiAgICBjYXNlIDE1MDogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5GSVZFX01PTlRIUztcbiAgICBjYXNlIDE4MDogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5TSVhfTU9OVEhTO1xuICAgIGNhc2UgMzY1OiByZXR1cm4gbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9ZRUFSO1xuICAgIGNhc2UgNDAwOiByZXR1cm4gbG9ncy5SZXRlbnRpb25EYXlzLlRISVJURUVOX01PTlRIUztcbiAgICBjYXNlIDU0NTogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5FSUdIVEVFTl9NT05USFM7XG4gICAgY2FzZSA3MzE6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuVFdPX1lFQVJTO1xuICAgIGNhc2UgMTA5NjogcmV0dXJuIGxvZ3MuUmV0ZW50aW9uRGF5cy5USFJFRV9ZRUFSUztcbiAgICBjYXNlIDE4Mjc6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuRklWRV9ZRUFSUztcbiAgICBjYXNlIDIxOTI6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuU0lYX1lFQVJTO1xuICAgIGRlZmF1bHQ6IHJldHVybiBsb2dzLlJldGVudGlvbkRheXMuVEhSRUVfREFZUztcbiAgfVxufVxuXG4vKiogTG9vayB1cCB0aGUgYWNjb3VudCdzIGRlZmF1bHQgVlBDIGFuZCByZXR1cm4gYm90aCBWUEMgYW5kIGl0cyBwdWJsaWMgc3VibmV0cy4gKi9cbmZ1bmN0aW9uIGdldE5ldHdvcmtSZXNvdXJjZXMoc2NvcGU6IENvbnN0cnVjdCk6IHsgdnBjOiBlYzIuSVZwYzsgc3VibmV0czogZWMyLklTdWJuZXRbXSB9IHtcbiAgY29uc3QgdnBjID0gZWMyLlZwYy5mcm9tTG9va3VwKHNjb3BlLCBcIkRlZmF1bHRWcGNcIiwgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gIHJldHVybiB7IHZwYywgc3VibmV0czogdnBjLnB1YmxpY1N1Ym5ldHMgfTtcbn1cblxuLyoqIENyZWF0ZSB0aGUgRUNTIHRhc2sgZXhlY3V0aW9uIHJvbGUgKHRydXN0IEVDUyB0YXNrcywgYXR0YWNoIG1hbmFnZWQgcG9saWN5KS4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUV4ZWN1dGlvblJvbGUoXG4gIHNjb3BlOiBDb25zdHJ1Y3QsXG4gIGlkOiBzdHJpbmcsXG4gIGNsdXN0ZXJOYW1lOiBzdHJpbmcsXG4pOiBpYW0uUm9sZSB7XG4gIGNvbnN0IHJvbGUgPSBuZXcgaWFtLlJvbGUoc2NvcGUsIGlkLCB7XG4gICAgcm9sZU5hbWU6IGAke2NsdXN0ZXJOYW1lfS1leGVjdXRpb24tcm9sZWAsXG4gICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJlY3MtdGFza3MuYW1hem9uYXdzLmNvbVwiKSxcbiAgfSk7XG4gIHJvbGUuYWRkTWFuYWdlZFBvbGljeShcbiAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICBcInNlcnZpY2Utcm9sZS9BbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeVwiLFxuICAgICksXG4gICk7XG4gIHJldHVybiByb2xlO1xufVxuXG4vKiogQ3JlYXRlIGEgQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgZm9yIGEgdGFzay4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUxvZ0dyb3VwKFxuICBzY29wZTogQ29uc3RydWN0LFxuICBpZDogc3RyaW5nLFxuICBjbHVzdGVyTmFtZTogc3RyaW5nLFxuICBlbnZpcm9ubWVudDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICByZXRlbnRpb25EYXlzOiBudW1iZXIsXG4pOiBsb2dzLklMb2dHcm91cCB7XG4gIGNvbnN0IGxvZ0dyb3VwTmFtZSA9IGVudmlyb25tZW50XG4gICAgPyBgL2Vjcy8ke2NsdXN0ZXJOYW1lfS0ke2Vudmlyb25tZW50fWBcbiAgICA6IGAvZWNzLyR7Y2x1c3Rlck5hbWV9YDtcbiAgcmV0dXJuIG5ldyBsb2dzLkxvZ0dyb3VwKHNjb3BlLCBpZCwge1xuICAgIGxvZ0dyb3VwTmFtZSxcbiAgICByZXRlbnRpb246IG1hcFJldGVudGlvbkRheXMocmV0ZW50aW9uRGF5cyksXG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE5vbnByb2Qgc3RhY2sg4oCUIDEgY2x1c3RlciwgMiBzZXJ2aWNlcyAoZGV2ZWxvcG1lbnQgKyB0ZXN0KVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5leHBvcnQgY2xhc3MgTm9ucHJvZFN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRWNzUmlnU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgeyAuLi5wcm9wcywgc3RhY2tOYW1lOiBgTm9ucHJvZFN0YWNrLSR7cHJvcHMuY2x1c3Rlck5hbWV9YCB9KTtcblxuICAgIGNvbnN0IHtcbiAgICAgIGNsdXN0ZXJOYW1lLFxuICAgICAgbG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgIHRhc2tDcHUsXG4gICAgICB0YXNrTWVtb3J5LFxuICAgICAgZGVzaXJlZENvdW50LFxuICAgICAgY29udGFpbmVySW1hZ2UsXG4gICAgICBjb250YWluZXJQb3J0ID0gODAsXG4gICAgfSA9IHByb3BzO1xuXG4gICAgY29uc3QgeyB2cGMsIHN1Ym5ldHMgfSA9IGdldE5ldHdvcmtSZXNvdXJjZXModGhpcyk7XG5cbiAgICAvLyAtLSBTZWN1cml0eSBncm91cCAoZWdyZXNzLW9ubHkpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHRhc2tTZyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCBcIlRhc2tTZWN1cml0eUdyb3VwXCIsIHtcbiAgICAgIHZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgJHtjbHVzdGVyTmFtZX0tdGFza3NgLFxuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgIFwiRUNTIHJpZzogbm9ucHJvZCBFQ1MgdGFza3MuIEVncmVzcy1vbmx5LCBubyBpbmJvdW5kIG5lZWRlZCB3aXRob3V0IGEgbG9hZCBiYWxhbmNlci5cIixcbiAgICB9KTtcbiAgICB0YXNrU2cuYWRkRWdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmFueUlwdjQoKSxcbiAgICAgIGVjMi5Qb3J0LmFsbFRyYWZmaWMoKSxcbiAgICAgIFwiQWxsb3cgYWxsIG91dGJvdW5kXCIsXG4gICAgKTtcblxuICAgIC8vIC0tIEV4ZWN1dGlvbiByb2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGV4ZWN1dGlvblJvbGUgPSBjcmVhdGVFeGVjdXRpb25Sb2xlKHRoaXMsIFwiRXhlY3V0aW9uUm9sZVwiLCBjbHVzdGVyTmFtZSk7XG5cbiAgICAvLyAtLSBDbHVzdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBjbHVzdGVyID0gbmV3IGVjcy5DbHVzdGVyKHRoaXMsIFwiQ2x1c3RlclwiLCB7XG4gICAgICBjbHVzdGVyTmFtZSxcbiAgICAgIHZwYyxcbiAgICB9KTtcblxuICAgIC8vIC0tIFNlcnZpY2VzIChvbmUgcGVyIG5vbnByb2QgZW52aXJvbm1lbnQpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGVudmlyb25tZW50cyA9IFtcImRldmVsb3BtZW50XCIsIFwidGVzdFwiXSBhcyBjb25zdDtcblxuICAgIGZvciAoY29uc3QgZW52IG9mIGVudmlyb25tZW50cykge1xuICAgICAgLy8gTG9nIGdyb3VwOiAvZWNzL3tjbHVzdGVyfS17ZW52fVxuICAgICAgY29uc3QgbG9nR3JvdXAgPSBjcmVhdGVMb2dHcm91cChcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYExvZ0dyb3VwJHtlbnYuY2hhckF0KDApLnRvVXBwZXJDYXNlKCl9JHtlbnYuc2xpY2UoMSl9YCxcbiAgICAgICAgY2x1c3Rlck5hbWUsXG4gICAgICAgIGVudixcbiAgICAgICAgbG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICk7XG5cbiAgICAgIC8vIFRhc2sgZGVmaW5pdGlvbjoge2NsdXN0ZXJ9LXtlbnZ9XG4gICAgICBjb25zdCB0YXNrRGVmID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgYFRhc2tEZWYke2Vudi5jaGFyQXQoMCkudG9VcHBlckNhc2UoKX0ke2Vudi5zbGljZSgxKX1gLCB7XG4gICAgICAgIGZhbWlseTogYCR7Y2x1c3Rlck5hbWV9LSR7ZW52fWAsXG4gICAgICAgIGNwdTogcGFyc2VJbnQodGFza0NwdSwgMTApLFxuICAgICAgICBtZW1vcnlMaW1pdE1pQjogcGFyc2VJbnQodGFza01lbW9yeSwgMTApLFxuICAgICAgICBleGVjdXRpb25Sb2xlLFxuICAgICAgfSk7XG5cbiAgICAgIHRhc2tEZWYuYWRkQ29udGFpbmVyKFwiYXBwXCIsIHtcbiAgICAgICAgaW1hZ2U6IGNvbnRhaW5lckltYWdlXG4gICAgICAgICAgPyBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KGNvbnRhaW5lckltYWdlKVxuICAgICAgICAgIDogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeShcbiAgICAgICAgICAgICAgXCJwdWJsaWMuZWNyLmF3cy9uZ2lueC9uZ2lueDoxLjI3LWFscGluZVwiLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgcG9ydE1hcHBpbmdzOiBbeyBjb250YWluZXJQb3J0LCBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUCB9XSxcbiAgICAgICAgbG9nZ2luZzogbmV3IGVjcy5Bd3NMb2dEcml2ZXIoe1xuICAgICAgICAgIGxvZ0dyb3VwLFxuICAgICAgICAgIHN0cmVhbVByZWZpeDogXCJlY3NcIixcbiAgICAgICAgfSksXG4gICAgICB9KTtcblxuICAgICAgLy8gU2VydmljZToge2NsdXN0ZXJ9LXNlcnZpY2Ute2Vudn1cbiAgICAgIG5ldyBlY3MuRmFyZ2F0ZVNlcnZpY2UodGhpcywgYFNlcnZpY2Uke2Vudi5jaGFyQXQoMCkudG9VcHBlckNhc2UoKX0ke2Vudi5zbGljZSgxKX1gLCB7XG4gICAgICAgIGNsdXN0ZXIsXG4gICAgICAgIHRhc2tEZWZpbml0aW9uOiB0YXNrRGVmLFxuICAgICAgICBzZXJ2aWNlTmFtZTogYCR7Y2x1c3Rlck5hbWV9LXNlcnZpY2UtJHtlbnZ9YCxcbiAgICAgICAgZGVzaXJlZENvdW50LFxuICAgICAgICBzZWN1cml0eUdyb3VwczogW3Rhc2tTZ10sXG4gICAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0cyB9LFxuICAgICAgICBhc3NpZ25QdWJsaWNJcDogdHJ1ZSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tIE91dHB1dHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm9ucHJvZENsdXN0ZXJBcm5cIiwge1xuICAgICAgdmFsdWU6IGNsdXN0ZXIuY2x1c3RlckFybixcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICBcIkFSTiBvZiB0aGUgbm9ucHJvZCBFQ1MgY2x1c3RlciwgZm9yIGNyb3NzLWNoZWNraW5nIGFnYWluc3QgdGhlIGVjczpjbHVzdGVyIGNvbmRpdGlvbiBpbiB0aGUgYmFzZSBzdGFjaydzIElBTSBwb2xpY3kuXCIsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIk5vbnByb2RTZXJ2aWNlc1wiLCB7XG4gICAgICB2YWx1ZTogZW52aXJvbm1lbnRzXG4gICAgICAgIC5tYXAoKGUpID0+IGAke2NsdXN0ZXJOYW1lfS1zZXJ2aWNlLSR7ZX1gKVxuICAgICAgICAuam9pbihcIiwgXCIpLFxuICAgICAgZGVzY3JpcHRpb246IFwiTm9ucHJvZCBzZXJ2aWNlIG5hbWVzIHRvIHdhdGNoIGluIE9jdG9wdXMgLyBBV1MgY29uc29sZS5cIixcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU3VibmV0SWRzXCIsIHtcbiAgICAgIHZhbHVlOiBzdWJuZXRzLm1hcCgocykgPT4gcy5zdWJuZXRJZCkuam9pbihcIiwgXCIpLFxuICAgICAgZGVzY3JpcHRpb246IFwiU3VibmV0IElEcyBmb3IgbWFudWFsIHJ1bi10YXNrIC0tbmV0d29yay1jb25maWd1cmF0aW9uLlwiLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTZWN1cml0eUdyb3VwSWRcIiwge1xuICAgICAgdmFsdWU6IHRhc2tTZy5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogXCJTZWN1cml0eSBncm91cCBJRCBmb3Igbm9ucHJvZCB0YXNrcy5cIixcbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFByb2R1Y3Rpb24gc3RhY2sg4oCUIDEgY2x1c3RlciwgMSBzZXJ2aWNlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmV4cG9ydCBjbGFzcyBQcm9kdWN0aW9uU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBFY3NSaWdTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCB7IC4uLnByb3BzLCBzdGFja05hbWU6IGBQcm9kdWN0aW9uU3RhY2stJHtwcm9wcy5jbHVzdGVyTmFtZX1gIH0pO1xuXG4gICAgY29uc3Qge1xuICAgICAgY2x1c3Rlck5hbWUsXG4gICAgICBsb2dSZXRlbnRpb25EYXlzLFxuICAgICAgdGFza0NwdSxcbiAgICAgIHRhc2tNZW1vcnksXG4gICAgICBkZXNpcmVkQ291bnQsXG4gICAgICBjb250YWluZXJJbWFnZSxcbiAgICAgIGNvbnRhaW5lclBvcnQgPSA4MCxcbiAgICB9ID0gcHJvcHM7XG5cbiAgICBjb25zdCB7IHZwYywgc3VibmV0cyB9ID0gZ2V0TmV0d29ya1Jlc291cmNlcyh0aGlzKTtcblxuICAgIC8vIC0tIFNlY3VyaXR5IGdyb3VwIChlZ3Jlc3Mtb25seSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgdGFza1NnID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsIFwiVGFza1NlY3VyaXR5R3JvdXBcIiwge1xuICAgICAgdnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGAke2NsdXN0ZXJOYW1lfS10YXNrc2AsXG4gICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgXCJFQ1MgcmlnOiBwcm9kdWN0aW9uIEVDUyB0YXNrcy4gRWdyZXNzLW9ubHksIG5vIGluYm91bmQgbmVlZGVkIHdpdGhvdXQgYSBsb2FkIGJhbGFuY2VyLlwiLFxuICAgIH0pO1xuICAgIHRhc2tTZy5hZGRFZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuYW55SXB2NCgpLFxuICAgICAgZWMyLlBvcnQuYWxsVHJhZmZpYygpLFxuICAgICAgXCJBbGxvdyBhbGwgb3V0Ym91bmRcIixcbiAgICApO1xuXG4gICAgLy8gLS0gRXhlY3V0aW9uIHJvbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgZXhlY3V0aW9uUm9sZSA9IGNyZWF0ZUV4ZWN1dGlvblJvbGUodGhpcywgXCJFeGVjdXRpb25Sb2xlXCIsIGNsdXN0ZXJOYW1lKTtcblxuICAgIC8vIC0tIENsdXN0ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgXCJDbHVzdGVyXCIsIHtcbiAgICAgIGNsdXN0ZXJOYW1lLFxuICAgICAgdnBjLFxuICAgIH0pO1xuXG4gICAgLy8gLS0gTG9nIGdyb3VwOiAvZWNzL3tjbHVzdGVyfSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgbG9nR3JvdXAgPSBjcmVhdGVMb2dHcm91cChcbiAgICAgIHRoaXMsXG4gICAgICBcIkxvZ0dyb3VwXCIsXG4gICAgICBjbHVzdGVyTmFtZSxcbiAgICAgIHVuZGVmaW5lZCxcbiAgICAgIGxvZ1JldGVudGlvbkRheXMsXG4gICAgKTtcblxuICAgIC8vIC0tIFRhc2sgZGVmaW5pdGlvbjoge2NsdXN0ZXJ9IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHRhc2tEZWYgPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCBcIlRhc2tEZWZcIiwge1xuICAgICAgZmFtaWx5OiBjbHVzdGVyTmFtZSxcbiAgICAgIGNwdTogcGFyc2VJbnQodGFza0NwdSwgMTApLFxuICAgICAgbWVtb3J5TGltaXRNaUI6IHBhcnNlSW50KHRhc2tNZW1vcnksIDEwKSxcbiAgICAgIGV4ZWN1dGlvblJvbGUsXG4gICAgfSk7XG5cbiAgICB0YXNrRGVmLmFkZENvbnRhaW5lcihcImFwcFwiLCB7XG4gICAgICBpbWFnZTogY29udGFpbmVySW1hZ2VcbiAgICAgICAgPyBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KGNvbnRhaW5lckltYWdlKVxuICAgICAgICA6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoXG4gICAgICAgICAgICBcInB1YmxpYy5lY3IuYXdzL25naW54L25naW54OjEuMjctYWxwaW5lXCIsXG4gICAgICAgICAgKSxcbiAgICAgIHBvcnRNYXBwaW5nczogW3sgY29udGFpbmVyUG9ydCwgcHJvdG9jb2w6IGVjcy5Qcm90b2NvbC5UQ1AgfV0sXG4gICAgICBsb2dnaW5nOiBuZXcgZWNzLkF3c0xvZ0RyaXZlcih7XG4gICAgICAgIGxvZ0dyb3VwLFxuICAgICAgICBzdHJlYW1QcmVmaXg6IFwiZWNzXCIsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIC0tIFNlcnZpY2U6IHtjbHVzdGVyfS1zZXJ2aWNlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIG5ldyBlY3MuRmFyZ2F0ZVNlcnZpY2UodGhpcywgXCJTZXJ2aWNlXCIsIHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICB0YXNrRGVmaW5pdGlvbjogdGFza0RlZixcbiAgICAgIHNlcnZpY2VOYW1lOiBgJHtjbHVzdGVyTmFtZX0tc2VydmljZWAsXG4gICAgICBkZXNpcmVkQ291bnQsXG4gICAgICBzZWN1cml0eUdyb3VwczogW3Rhc2tTZ10sXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldHMgfSxcbiAgICAgIGFzc2lnblB1YmxpY0lwOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gLS0gT3V0cHV0cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJQcm9kdWN0aW9uQ2x1c3RlckFyblwiLCB7XG4gICAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyQXJuLFxuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgIFwiQVJOIG9mIHRoZSBwcm9kdWN0aW9uIEVDUyBjbHVzdGVyLCBmb3IgY3Jvc3MtY2hlY2tpbmcgYWdhaW5zdCB0aGUgZWNzOmNsdXN0ZXIgY29uZGl0aW9uIGluIHRoZSBiYXNlIHN0YWNrJ3MgSUFNIHBvbGljeS5cIixcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiUHJvZHVjdGlvblNlcnZpY2VOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBgJHtjbHVzdGVyTmFtZX0tc2VydmljZWAsXG4gICAgICBkZXNjcmlwdGlvbjogXCJQcm9kdWN0aW9uIHNlcnZpY2UgbmFtZSB0byB3YXRjaCBpbiBPY3RvcHVzIC8gQVdTIGNvbnNvbGUuXCIsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlN1Ym5ldElkc1wiLCB7XG4gICAgICB2YWx1ZTogc3VibmV0cy5tYXAoKHMpID0+IHMuc3VibmV0SWQpLmpvaW4oXCIsIFwiKSxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlN1Ym5ldCBJRHMgZm9yIG1hbnVhbCBydW4tdGFzayAtLW5ldHdvcmstY29uZmlndXJhdGlvbi5cIixcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU2VjdXJpdHlHcm91cElkXCIsIHtcbiAgICAgIHZhbHVlOiB0YXNrU2cuc2VjdXJpdHlHcm91cElkLFxuICAgICAgZGVzY3JpcHRpb246IFwiU2VjdXJpdHkgZ3JvdXAgSUQgZm9yIHByb2R1Y3Rpb24gdGFza3MuXCIsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==