variable "default_tags" {
  description = "Tags applied to every taggable resource in this stack. Kept identical to ../variables.tf's default_tags by convention, not by reference (separate state, separate stack) — update both if you change this."
  type        = map(string)
  default = {
    managedby = "terraform"
    demo-user = "creid"
  }
}

variable "aws_region" {
  description = "AWS region to create resources in. Should match the base stack's aws_region — the IAM policies there build cluster ARNs using that region, and these clusters need to actually exist there for the ARNs to resolve to something real."
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Naming CONTRACT with ../variables.tf
#
# These two values must be IDENTICAL to nonprod_ecs_cluster_name /
# production_ecs_cluster_name in the base stack's terraform.tfvars. The base
# stack's IAM policies reference these names to build the ecs:cluster
# condition values and the iam:PassRole resource pattern
# (role/${cluster_name}-*) — nothing here enforces that automatically, since
# the two stacks intentionally don't share state. If these drift apart,
# deploys will fail with an access denied error that looks like a bigger
# problem than "the names don't match between the two tfvars files."
# -----------------------------------------------------------------------------

variable "nonprod_ecs_cluster_name" {
  description = "Must match nonprod_ecs_cluster_name in the base stack's terraform.tfvars."
  type        = string
  default     = "nonprod-demo"
}

variable "production_ecs_cluster_name" {
  description = "Must match production_ecs_cluster_name in the base stack's terraform.tfvars."
  type        = string
  default     = "production-demo"
}

# -----------------------------------------------------------------------------
# ECS rig sizing — kept minimal since this comes up and down repeatedly
# -----------------------------------------------------------------------------

variable "container_image" {
  description = "Container image for the demo task. Defaults to a public ECR image (not Docker Hub) specifically to avoid anonymous pull rate limits on a task that gets recreated nightly."
  type        = string
  default     = "public.ecr.aws/nginx/nginx:1.27-alpine"
}

variable "container_port" {
  description = "Port the demo container listens on."
  type        = number
  default     = 80
}

variable "task_cpu" {
  description = "Fargate task-level CPU units (256 = .25 vCPU — smallest Fargate size, keeps per-run cost negligible)."
  type        = string
  default     = "256"
}

variable "task_memory" {
  description = "Fargate task-level memory in MiB, paired with task_cpu (512 is the minimum Fargate allows alongside 256 CPU units)."
  type        = string
  default     = "512"
}

variable "desired_count" {
  description = "Desired running task count per service. 1 is enough to prove the IAM role split works; no need for redundancy in a demo rig."
  type        = number
  default     = 1
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the task's container logs. Short on purpose since this rig is destroyed nightly anyway."
  type        = number
  default     = 3
}
