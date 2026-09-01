terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Deliberately separate state from ../ (the durable OIDC/IAM stack). This
  # directory's whole purpose is to be stood up and torn down repeatedly —
  # keeping it in its own state means `terraform destroy` here can't ever
  # reach the IAM/OIDC layer you want to keep, no -target flags required.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.default_tags
  }
}
