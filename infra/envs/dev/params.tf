data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy" "read_dev_parameters" {
  name = "read-dev-parameters"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "ReadDevParameters"
      Effect = "Allow"
      Action = [
        "ssm:GetParametersByPath",
        "ssm:GetParameters",
        "ssm:GetParameter",
      ]
      Resource = [
        "arn:aws:ssm:ap-southeast-2:${data.aws_caller_identity.current.account_id}:parameter/pawankhind/dev",
        "arn:aws:ssm:ap-southeast-2:${data.aws_caller_identity.current.account_id}:parameter/pawankhind/dev/*",
      ]
    }]
  })
}