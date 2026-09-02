#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DefaultStackSynthesizer } from "aws-cdk-lib";
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

// -----------------------------------------------------------------------------
// CDK bootstrap qualifier
//
// nonprod and production share one AWS account/region in this demo, so a
// single default-qualifier bootstrap would give both tiers the same
// CloudFormation execution role — quietly erasing the separation the base
// stack's Terraform (octopus-nonprod-role / octopus-production-role) exists
// to enforce. Bootstrapping under two separate qualifiers keeps each tier on
// its own execution role — see the base stack's cdk-bootstrap.tf for the
// bootstrap side of this, and variables.tf there for where "cdknp" /
// "cdkprod" come from (must match exactly, same failure mode as the cluster-
// name naming contract elsewhere in this project).
//
// Passing the qualifier at bootstrap time isn't enough on its own — per AWS's
// own bootstrapping docs, "When you change the qualifier, your CDK app must
// pass the changed value to the stack synthesizer." That's what the
// `synthesizer:` prop below does; without it, both stacks would silently
// keep using CDK's built-in default qualifier ("hnb659fds") regardless of
// what was passed to `cdk bootstrap`, and deploy would fail looking for
// toolkit roles that don't exist under that qualifier.
//
// No context plumbing for this one at all — unlike clusterName, the
// qualifier isn't a deploy-time choice, it's a fixed fact about which stack
// this is. NonprodStack always means the "cdknp" toolkit, ProductionStack
// always means "cdkprod", regardless of which environment happens to be
// running the deploy. Hardcoded here, matching cdk_nonprod_bootstrap_qualifier
// / cdk_production_bootstrap_qualifier in the base stack's variables.tf —
// change one, change the other.
// -----------------------------------------------------------------------------

// Nonprod: 1 cluster with 2 services (development + test)
new NonprodStack(app, "NonprodStack", {
  ...commonProps,
  synthesizer: new DefaultStackSynthesizer({
    qualifier: "cdknp",
  }),
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
  synthesizer: new DefaultStackSynthesizer({
    qualifier: "cdkprod",
  }),
  clusterName: app.node.tryGetContext("productionClusterName") ?? "production-demo",
  logRetentionDays: app.node.tryGetContext("logRetentionDays") ?? 3,
  taskCpu: app.node.tryGetContext("taskCpu") ?? "256",
  taskMemory: app.node.tryGetContext("taskMemory") ?? "512",
  desiredCount: app.node.tryGetContext("desiredCount") ?? 1,
  containerImage: app.node.tryGetContext("containerImage"),
  containerPort: app.node.tryGetContext("containerPort") ?? 80,
});
