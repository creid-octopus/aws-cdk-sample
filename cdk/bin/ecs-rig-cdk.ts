#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NonprodStack, ProductionStack } from "../lib/ecs-rig-stack";

const app = new cdk.App();

const commonProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || app.node.tryGetContext("account"),
    region: process.env.CDK_DEFAULT_REGION || app.node.tryGetContext("region"),
  },
  defaultTags: {
    tags: {
      managedby: "cdk",
      demo: "ecs-rig",
    },
  },
};

// Nonprod: 1 cluster with 2 services (development + test)
new NonprodStack(app, "NonprodStack", {
  ...commonProps,
  clusterName: app.node.tryGetContext("nonprodClusterName") ?? "nonprod-demo",
  logRetentionDays: app.node.tryGetContext("logRetentionDays") ?? 3,
  taskCpu: app.node.tryGetContext("taskCpu") ?? "256",
  taskMemory: app.node.tryGetContext("taskMemory") ?? "512",
  desiredCount: app.node.tryGetContext("desiredCount") ?? 1,
  containerImage: app.node.tryGetContext("containerImage"),
  containerPort: app.node.tryGetContext("containerPort") ?? 80,
});

// Production: 1 cluster with 1 service
new ProductionStack(app, "ProductionStack", {
  ...commonProps,
  clusterName: app.node.tryGetContext("productionClusterName") ?? "production-demo",
  logRetentionDays: app.node.tryGetContext("logRetentionDays") ?? 3,
  taskCpu: app.node.tryGetContext("taskCpu") ?? "256",
  taskMemory: app.node.tryGetContext("taskMemory") ?? "512",
  desiredCount: app.node.tryGetContext("desiredCount") ?? 1,
  containerImage: app.node.tryGetContext("containerImage"),
  containerPort: app.node.tryGetContext("containerPort") ?? 80,
});
