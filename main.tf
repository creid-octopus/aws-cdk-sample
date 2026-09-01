# -----------------------------------------------------------------------------
# ECS test rig
#
# Purpose: give the nonprod/production role split in ../main.tf something
# real to deploy to, so the account-separation demo can show an actual
# success and an actual AWS-side failure — not just a theoretical IAM policy.
#
# Deliberately minimal and disposable:
#   - Default VPC + its public subnets (no custom networking to stand up)
#   - Fargate tasks get a public IP directly — no NAT gateway, since there's
#     no real security requirement to hide a demo task, and a NAT gateway
#     alone would roughly double this rig's hourly cost for no benefit.
#   - No load balancer — task-log evidence is enough for now (an ALB is a
#     cheap follow-up if a browser-visible URL becomes worth it later).
#   - Short log retention and small Fargate sizing, since this is meant to
#     come up for a demo and go back down the same day, repeatedly.
#
# Naming follows the contract documented in variables.tf: clusters are named
# exactly var.nonprod_ecs_cluster_name / var.production_ecs_cluster_name
# (which must match the base stack's values), and each execution role is
# prefixed with its cluster's name, matching the base stack's iam:PassRole
# resource pattern "role/${cluster_name}-*".
# -----------------------------------------------------------------------------

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# -----------------------------------------------------------------------------
# Security groups
#
# Separate per tier, matching the "two of everything" pattern used
# throughout the base stack. Egress-only — nothing needs to reach these
# tasks from outside since there's no load balancer in front of them yet.
# -----------------------------------------------------------------------------

resource "aws_security_group" "nonprod_tasks" {
  name        = "${var.nonprod_ecs_cluster_name}-tasks"
  description = "Demo rig: nonprod ECS tasks. Egress-only, no inbound needed without a load balancer."
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "production_tasks" {
  name        = "${var.production_ecs_cluster_name}-tasks"
  description = "Demo rig: production ECS tasks. Egress-only, no inbound needed without a load balancer."
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# -----------------------------------------------------------------------------
# CloudWatch log groups
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "nonprod" {
  for_each          = local.nonprod_environments
  name              = "/ecs/${var.nonprod_ecs_cluster_name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "production" {
  name              = "/ecs/${var.production_ecs_cluster_name}"
  retention_in_days = var.log_retention_days
}

# -----------------------------------------------------------------------------
# Task execution roles
#
# This is a different role from octopus-nonprod-role / octopus-production-
# role in the base stack — those are what OCTOPUS assumes to call the ECS
# API; these are what ECS itself assumes to pull the container image and
# write logs on the task's behalf. Named with the cluster name as a prefix
# specifically to satisfy the base stack's iam:PassRole condition.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "nonprod_execution" {
  name               = "${var.nonprod_ecs_cluster_name}-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "production_execution" {
  name               = "${var.production_ecs_cluster_name}-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "nonprod_execution" {
  role       = aws_iam_role.nonprod_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "production_execution" {
  role       = aws_iam_role.production_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# -----------------------------------------------------------------------------
# ECS clusters
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster" "nonprod" {
  name = var.nonprod_ecs_cluster_name
}

resource "aws_ecs_cluster" "production" {
  name = var.production_ecs_cluster_name
}

# -----------------------------------------------------------------------------
# Task definitions
#
# Static placeholder container — the point of this rig is proving the IAM
# role split, not demonstrating a real application. Swap container_image if
# you want something more visually convincing than nginx's default page.
#
# Nonprod runs TWO independent services (Development, Test) inside the SAME
# cluster — one cluster, multiple services is normal ECS usage, not a
# workaround. This is deliberately NOT the same as splitting into separate
# clusters: the base stack's IAM policy scopes by cluster ARN via
# ecs:cluster, and both services live in that one cluster, so no IAM change
# was needed to add this split. Meta-Nonproduction isn't included here —
# add a third for_each key (and a matching Octopus variable row) if that
# needs its own service too.
# -----------------------------------------------------------------------------

locals {
  nonprod_environments = toset(["development", "test"])
}

resource "aws_ecs_task_definition" "nonprod" {
  for_each                 = local.nonprod_environments
  family                   = "${var.nonprod_ecs_cluster_name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.nonprod_execution.arn

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = var.container_image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.nonprod[each.key].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "production" {
  family                   = var.production_ecs_cluster_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.production_execution.arn

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = var.container_image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.production.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# -----------------------------------------------------------------------------
# ECS services
#
# assign_public_ip = true is what lets these tasks reach the internet (to
# pull the container image) without a NAT gateway, since they're in the
# default VPC's public subnets.
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "nonprod" {
  for_each        = local.nonprod_environments
  name            = "${var.nonprod_ecs_cluster_name}-service-${each.key}"
  cluster         = aws_ecs_cluster.nonprod.id
  task_definition = aws_ecs_task_definition.nonprod[each.key].arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.nonprod_tasks.id]
    assign_public_ip = true
  }
}

resource "aws_ecs_service" "production" {
  name            = "${var.production_ecs_cluster_name}-service"
  cluster         = aws_ecs_cluster.production.id
  task_definition = aws_ecs_task_definition.production.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.production_tasks.id]
    assign_public_ip = true
  }
}
