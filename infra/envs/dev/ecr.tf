resource "aws_ecr_repository" "registration" {
  name                 = "pawankhind/registration"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true # dev only: lets `terraform destroy` remove it even with images

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "registration" {
  repository = aws_ecr_repository.registration.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecr_pull" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

output "registration_repo_url" {
  value = aws_ecr_repository.registration.repository_url
}