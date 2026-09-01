output "nonprod_ecs_service_names" {
  description = "Service names to watch in the Octopus deployment / AWS console when testing the nonprod role, keyed by nonprod sub-environment (development, test). One cluster, two services — see the comment above aws_ecs_task_definition.nonprod in main.tf."
  value       = { for env, svc in aws_ecs_service.nonprod : env => svc.name }
}

output "production_ecs_service_name" {
  description = "Service name to watch in the Octopus deployment / AWS console when testing the production role."
  value       = aws_ecs_service.production.name
}

output "nonprod_cluster_arn" {
  description = "ARN of the nonprod ECS cluster, for cross-checking against the ecs:cluster condition value in the base stack's IAM policy."
  value       = aws_ecs_cluster.nonprod.arn
}

output "production_cluster_arn" {
  description = "ARN of the production ECS cluster, for cross-checking against the ecs:cluster condition value in the base stack's IAM policy."
  value       = aws_ecs_cluster.production.arn
}

# awsvpc network mode (required for Fargate) means `aws ecs run-task` always
# needs an explicit --network-configuration — AWS won't infer it from the
# cluster or an existing service. These outputs save hunting for the values
# by hand each time.

output "subnet_ids" {
  description = "Default VPC public subnet IDs — same subnets both tiers' services use. Feed into --network-configuration for a manual run-task."
  value       = data.aws_subnets.default.ids
}

output "nonprod_security_group_id" {
  description = "Security group ID for nonprod tasks. Feed into --network-configuration for a manual run-task against the nonprod cluster."
  value       = aws_security_group.nonprod_tasks.id
}

output "production_security_group_id" {
  description = "Security group ID for production tasks. Feed into --network-configuration for a manual run-task against the production cluster."
  value       = aws_security_group.production_tasks.id
}
