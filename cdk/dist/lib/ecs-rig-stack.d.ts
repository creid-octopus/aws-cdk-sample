import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
export interface EcsRigStackProps extends StackProps {
    clusterName: string;
    logRetentionDays: number;
    taskCpu: string;
    taskMemory: string;
    desiredCount: number;
    containerImage?: string;
    containerPort?: number;
}
export declare class NonprodStack extends Stack {
    constructor(scope: Construct, id: string, props: EcsRigStackProps);
}
export declare class ProductionStack extends Stack {
    constructor(scope: Construct, id: string, props: EcsRigStackProps);
}
