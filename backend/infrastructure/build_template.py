"""Generate the checked-in CloudFormation template (no AWS calls)."""
import json
from pathlib import Path


def ref(name):
    return {"Ref": name}


def arn(name):
    return {"Fn::GetAtt": [name, "Arn"]}


def sub(value):
    return {"Fn::Sub": value}


def resource(kind, properties, **extra):
    return {"Type": kind, "Properties": properties, **extra}


routes = ["POST /sessions", "GET /sessions/{session_id}", "GET /sessions/{session_id}/messages",
          "POST /sessions/{session_id}/finish", "GET /faculty/sessions",
          "GET /faculty/sessions/{session_id}/archive", "POST /faculty/sessions/{session_id}/reviews",
          "GET /faculty/sessions/{session_id}/reviews"]
public_fields = ["session_id", "patient_id", "patient_version", "owner_sub", "status", "revision",
                 "turn_count", "created_at", "updated_at", "review_status"]
template = {
    "AWSTemplateFormatVersion": "2010-09-09",
    "Description": "CaseCoach private encounter logs and faculty review; existing OIDC sign-in required",
    "Parameters": {
        "JwtIssuer": {"Type": "String", "AllowedPattern": "https://.+", "Description": "Existing RSA OIDC issuer, matching access token iss exactly"},
        "JwtAudience": {"Type": "String", "MinLength": 1, "Description": "Existing access-token API audience/client id"},
        "ApiScope": {"Type": "String", "MinLength": 1, "Description": "Required access-token scope, supplied by sign-in owner"},
        "FrontendOrigin": {"Type": "String", "AllowedPattern": "https://[^/]+", "Description": "One exact HTTPS frontend origin; no wildcard"},
        "ArtifactBucket": {"Type": "String", "MinLength": 3, "Description": "Existing private deployment bucket in this region"},
        "ArtifactKey": {"Type": "String", "MinLength": 1, "Description": "Uploaded Lambda ZIP key"}
    },
    "Resources": {
        "SessionsTable": resource("AWS::DynamoDB::Table", {
            "BillingMode": "PAY_PER_REQUEST", "DeletionProtectionEnabled": True,
            "AttributeDefinitions": [{"AttributeName": key, "AttributeType": "S"} for key in ("pk", "sk", "list_pk", "list_sk")],
            "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            "GlobalSecondaryIndexes": [{"IndexName": "SessionList", "KeySchema": [
                {"AttributeName": "list_pk", "KeyType": "HASH"}, {"AttributeName": "list_sk", "KeyType": "RANGE"}],
                "Projection": {"ProjectionType": "INCLUDE", "NonKeyAttributes": public_fields}}],
            "SSESpecification": {"SSEEnabled": True},
            "PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": True}
        }, DeletionPolicy="Retain", UpdateReplacePolicy="Retain"),
        "TranscriptBucket": resource("AWS::S3::Bucket", {
            "PublicAccessBlockConfiguration": {key: True for key in (
                "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")},
            "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
            "VersioningConfiguration": {"Status": "Enabled"},
            "BucketEncryption": {"ServerSideEncryptionConfiguration": [
                {"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}
        }, DeletionPolicy="Retain", UpdateReplacePolicy="Retain"),
        "TranscriptBucketPolicy": resource("AWS::S3::BucketPolicy", {
            "Bucket": ref("TranscriptBucket"), "PolicyDocument": {"Version": "2012-10-17", "Statement": [
                {"Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
                 "Resource": [arn("TranscriptBucket"), sub("${TranscriptBucket.Arn}/*")],
                 "Condition": {"Bool": {"aws:SecureTransport": "false"}}},
                {"Sid": "RequireEncryptedUploads", "Effect": "Deny", "Principal": "*", "Action": "s3:PutObject",
                 "Resource": sub("${TranscriptBucket.Arn}/*"),
                 "Condition": {"StringNotEquals": {"s3:x-amz-server-side-encryption": "AES256"}}},
                {"Sid": "LimitSignedDownloadAge", "Effect": "Deny", "Principal": "*", "Action": ["s3:GetObject", "s3:GetObjectVersion"],
                 "Resource": sub("${TranscriptBucket.Arn}/*"),
                 "Condition": {"NumericGreaterThan": {"s3:signatureAge": "60000"}}}
            ]}}),
        "FunctionLogs": resource("AWS::Logs::LogGroup", {
            "LogGroupName": sub("/aws/lambda/${AWS::StackName}-sessions"), "RetentionInDays": 30
        }),
        "ApiLogs": resource("AWS::Logs::LogGroup", {"RetentionInDays": 30}),
        "SessionRole": resource("AWS::IAM::Role", {
            "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [
                {"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
            "Policies": [{"PolicyName": "SessionStorage", "PolicyDocument": {"Version": "2012-10-17", "Statement": [
                {"Effect": "Allow", "Action": ["dynamodb:GetItem"], "Resource": arn("SessionsTable")},
                {"Effect": "Allow", "Action": ["dynamodb:Query"],
                 "Resource": [arn("SessionsTable"), sub("${SessionsTable.Arn}/index/SessionList")]},
                {"Effect": "Allow", "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem"], "Resource": arn("SessionsTable"),
                 "Condition": {"ForAllValues:StringLike": {"dynamodb:LeadingKeys": ["SESSION#*", "APP_AUDIT"]}}},
                {"Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"],
                 "Resource": sub("${TranscriptBucket.Arn}/sessions/*")},
                {"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
                 "Resource": arn("FunctionLogs")}
            ]}}]
        }),
        "SessionsFunction": resource("AWS::Lambda::Function", {
            "FunctionName": sub("${AWS::StackName}-sessions"), "Runtime": "python3.12",
            "Handler": "app.session_api.handler", "Role": arn("SessionRole"), "MemorySize": 512,
            "Timeout": 28, "Code": {"S3Bucket": ref("ArtifactBucket"), "S3Key": ref("ArtifactKey")},
            "Environment": {"Variables": {"SESSIONS_TABLE": ref("SessionsTable"), "TRANSCRIPTS_BUCKET": ref("TranscriptBucket")}}
        }),
        "SessionApi": resource("AWS::ApiGatewayV2::Api", {
            "Name": sub("${AWS::StackName}-api"), "ProtocolType": "HTTP",
            "CorsConfiguration": {"AllowOrigins": [ref("FrontendOrigin")],
                "AllowMethods": ["GET", "POST"], "AllowHeaders": ["authorization", "content-type"], "MaxAge": 300}
        }),
        "JwtAuthorizer": resource("AWS::ApiGatewayV2::Authorizer", {
            "ApiId": ref("SessionApi"), "AuthorizerType": "JWT", "IdentitySource": ["$request.header.Authorization"],
            "Name": "ExistingSignIn", "JwtConfiguration": {"Issuer": ref("JwtIssuer"), "Audience": [ref("JwtAudience")]}
        }),
        "LambdaIntegration": resource("AWS::ApiGatewayV2::Integration", {
            "ApiId": ref("SessionApi"), "IntegrationType": "AWS_PROXY", "IntegrationUri": arn("SessionsFunction"),
            "PayloadFormatVersion": "2.0", "TimeoutInMillis": 29000
        }),
        "ApiStage": resource("AWS::ApiGatewayV2::Stage", {
            "ApiId": ref("SessionApi"), "StageName": "$default", "AutoDeploy": True,
            "DefaultRouteSettings": {"ThrottlingBurstLimit": 20, "ThrottlingRateLimit": 10},
            "AccessLogSettings": {"DestinationArn": arn("ApiLogs"), "Format": '{"requestId":"$context.requestId","routeKey":"$context.routeKey","status":"$context.status"}'}
        }),
        "GatewayInvokePermission": resource("AWS::Lambda::Permission", {
            "Action": "lambda:InvokeFunction", "FunctionName": ref("SessionsFunction"),
            "Principal": "apigateway.amazonaws.com", "SourceAccount": ref("AWS::AccountId"),
            "SourceArn": sub("arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${SessionApi}/*/*")
        })
    },
    "Outputs": {
        "ApiUrl": {"Value": {"Fn::GetAtt": ["SessionApi", "ApiEndpoint"]}},
        "SessionsTableName": {"Value": ref("SessionsTable")},
        "TranscriptBucketName": {"Value": ref("TranscriptBucket")}
    }
}
for number, route in enumerate(routes):
    template["Resources"][f"Route{number}"] = resource("AWS::ApiGatewayV2::Route", {
        "ApiId": ref("SessionApi"), "RouteKey": route, "AuthorizationType": "JWT",
        "AuthorizerId": ref("JwtAuthorizer"), "AuthorizationScopes": [ref("ApiScope")],
        "Target": {"Fn::Join": ["/", ["integrations", ref("LambdaIntegration")]]}
    })
Path(__file__).with_name("sessions-stack.json").write_text(json.dumps(template, indent=2) + "\n")
