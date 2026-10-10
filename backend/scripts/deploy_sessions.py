"""Upload Lambda code and prepare an AWS CloudFormation change set.

Defaults to a reviewable change set. --execute also applies it to the account.
An existing private artifact bucket, AWS profile, and real sign-in configuration
are required. No AWS resources are created by merely importing this module.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import boto3
from botocore.exceptions import ClientError

from package_sessions import BACKEND, package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    required = ["profile", "region", "expected_account", "stack_name", "artifact_bucket", "jwt_issuer", "jwt_audience", "api_scope", "frontend_origin"]
    for key in required:
        if not isinstance(config.get(key), str) or not config[key] or config[key].startswith("REPLACE_"):
            raise ValueError(f"Supply a real {key} in the local configuration")
    if len(config["stack_name"]) > 40:
        raise ValueError("Use a stack name of at most 40 characters")
    session = boto3.Session(profile_name=config["profile"], region_name=config["region"])
    account = session.client("sts").get_caller_identity()["Account"]
    if account != config["expected_account"]:
        raise RuntimeError("AWS account mismatch; no resources were changed")
    s3 = session.client("s3")
    # Require private artifact storage as well as a private transcript bucket.
    block = s3.get_public_access_block(Bucket=config["artifact_bucket"])["PublicAccessBlockConfiguration"]
    if not all(block.get(key) is True for key in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")):
        raise RuntimeError("Artifact bucket must have all public-access blocks enabled")
    bucket_region = s3.get_bucket_location(Bucket=config["artifact_bucket"])["LocationConstraint"] or "us-east-1"
    if bucket_region == "EU":
        bucket_region = "eu-west-1"
    if bucket_region != config["region"]:
        raise RuntimeError("Artifact bucket must be in the deployment region")
    artifact = package()
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    key = f"casecoach-artifacts/{digest}.zip"
    s3.put_object(Bucket=config["artifact_bucket"], Key=key, Body=artifact.read_bytes(), ServerSideEncryption="AES256")
    cf = session.client("cloudformation")
    template = (BACKEND / "infrastructure/sessions-stack.json").read_text()
    cf.validate_template(TemplateBody=template)
    mode = "UPDATE"
    try:
        cf.describe_stacks(StackName=config["stack_name"])
    except ClientError as error:
        if error.response["Error"]["Code"] == "ValidationError" and "does not exist" in error.response["Error"]["Message"]:
            mode = "CREATE"
        else:
            raise
    mapping = {"JwtIssuer": config["jwt_issuer"], "JwtAudience": config["jwt_audience"],
        "ApiScope": config["api_scope"], "FrontendOrigin": config["frontend_origin"],
        "ArtifactBucket": config["artifact_bucket"], "ArtifactKey": key}
    changes = cf.create_change_set(StackName=config["stack_name"], ChangeSetName=f"sessions-{int(time.time())}",
        ChangeSetType=mode, TemplateBody=template, Capabilities=["CAPABILITY_IAM"],
        Parameters=[{"ParameterKey": k, "ParameterValue": v} for k, v in mapping.items()])
    cf.get_waiter("change_set_create_complete").wait(ChangeSetName=changes["Id"])
    details = cf.describe_change_set(ChangeSetName=changes["Id"])
    print("Change set:", changes["Id"])
    for change in details.get("Changes", []):
        item = change["ResourceChange"]
        print(item["Action"], item["LogicalResourceId"], item["ResourceType"])
    if args.execute:
        cf.execute_change_set(ChangeSetName=changes["Id"])
        waiter = "stack_create_complete" if mode == "CREATE" else "stack_update_complete"
        cf.get_waiter(waiter).wait(StackName=config["stack_name"])
        for output in cf.describe_stacks(StackName=config["stack_name"])["Stacks"][0].get("Outputs", []):
            print(output["OutputKey"], output["OutputValue"])


if __name__ == "__main__":
    main()
