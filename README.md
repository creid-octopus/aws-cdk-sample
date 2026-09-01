# ECS demo rig

A minimal ECS Fargate cluster/service per tier (nonprod, production), that
exists purely to give the IAM role split in `../` (the base stack) something
real to deploy to. Meant to be stood up before a demo and torn down
afterward — nightly, typically — not left running.

Kept in its own state, separate from the base stack, on purpose: a
`terraform destroy` in this directory can only ever touch what's defined
here. No `-target` flags to remember, no risk of accidentally tearing down
the OIDC provider or IAM roles you want to keep.

CDK remains the medium/long-term plan for a more realistic, permanent
workload (see `../planning.md`) — this rig is the interim, cheap-to-cycle
stand-in until that's built.

## Naming contract with the base stack

`nonprod_ecs_cluster_name` and `production_ecs_cluster_name` here **must
match** the same-named variables in `../terraform.tfvars` exactly. The base
stack's IAM policies reference these names directly to build `ecs:cluster`
condition values and the `iam:PassRole` resource pattern
(`role/${cluster_name}-*`). Nothing enforces this automatically since the
two stacks intentionally don't share state — if they drift apart, deploys
will fail with an access denied error that looks like a bigger problem than
a naming mismatch between two `.tfvars` files.

## Usage

```
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — cluster names must match ../terraform.tfvars

terraform init
terraform plan
terraform apply
```

## Tearing down

```
terraform destroy
```

Safe to run without `-target` — everything in this directory's state is
disposable by design. Nothing in `../` (the base stack) is reachable from
here.
