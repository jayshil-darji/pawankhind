# ---------- Private bucket for the built React app ----------

resource "aws_s3_bucket" "web" {
  bucket = "pawankhind-dev-web-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------- CloudFront in front of it ----------

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "pawankhind-dev-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = "PriceClass_200"
  default_root_object = "index.html"
  comment             = "pawankhind dev web"

  origin {
    origin_id                = "web-s3"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # The registration API on the dev instance. Plain HTTP on this leg (dev only).
  origin {
    origin_id   = "api-ec2"
    domain_name = aws_instance.app.public_dns

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "web-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS managed policy "CachingOptimized"
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web["site"].id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.gate.arn
    }
  }

  # Admin UI (S3). Same gate as the site, plus Cache-Control: no-store on every response.
  ordered_cache_behavior {
    path_pattern               = "/admin*"
    target_origin_id           = "web-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web["admin"].id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.gate.arn
    }
  }

  # Admin API (EC2). Must stay before /api/*: CloudFront uses the first matching behaviour.
  # "/api/admin*" (not "/api/admin/*") so a bare /api/admin cannot fall through ungated.
  # The gate removes its Authorization header before the plain-HTTP leg to the instance.
  ordered_cache_behavior {
    path_pattern           = "/api/admin*"
    target_origin_id       = "api-ec2"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    # AWS managed policy "CachingDisabled"
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # AWS managed policy "AllViewerExceptHostHeader": all headers but Host, all query strings and cookies
    origin_request_policy_id   = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web["admin"].id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.gate.arn
    }
  }

  # No gate function here: the API and the Razorpay webhook are public.
  # No custom_error_response on this distribution either: those apply to every
  # behaviour and would turn API 403/404 into 200 + index.html. The gate
  # function does the SPA fallback for the site instead.
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "api-ec2"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    # AWS managed policy "CachingDisabled"
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # AWS managed policy "AllViewerExceptHostHeader": all headers but Host, all query strings and cookies
    origin_request_policy_id   = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web["site"].id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Only this distribution may read the bucket.
data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.bucket
}

output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

variable "gate_user" {
  type    = string
  default = "organizer"
}

variable "gate_password" {
  type      = string
  sensitive = true
}

locals {
  gate_token = base64encode("${var.gate_user}:${var.gate_password}")
  gate_realm = "Pawankhind dev"
  # Source and tests: infra/edge (node --test). Only these two placeholders are filled in.
  gate_source = file("${path.module}/../../edge/gate.js")
  gate_code   = replace(replace(local.gate_source, "__GATE_TOKEN__", local.gate_token), "__GATE_REALM__", local.gate_realm)

  # Extra headers per response headers policy, on top of the shared security headers.
  response_header_extras = {
    site = {}
    admin = {
      "Cache-Control" = "no-store"
      "X-Robots-Tag"  = "noindex, nofollow"
    }
  }
}

resource "aws_cloudfront_function" "gate" {
  name    = "pawankhind-dev-gate"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = local.gate_code

  lifecycle {
    precondition {
      condition     = length(split("__GATE_TOKEN__", local.gate_source)) == 2 && length(split("__GATE_REALM__", local.gate_source)) == 2
      error_message = "infra/edge/gate.js must contain __GATE_TOKEN__ and __GATE_REALM__ exactly once each."
    }
  }
}

# No Content-Security-Policy yet: a wrong one would break the Razorpay checkout (see the A4 notes).
resource "aws_cloudfront_response_headers_policy" "web" {
  for_each = local.response_header_extras

  name    = "pawankhind-dev-${each.key}-headers"
  comment = "Security headers (${each.key})"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    # Features this site never uses. Payment is left alone for the Razorpay checkout iframe.
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()"
      override = true
    }
    dynamic "items" {
      for_each = each.value
      content {
        header   = items.key
        value    = items.value
        override = true
      }
    }
  }
}
