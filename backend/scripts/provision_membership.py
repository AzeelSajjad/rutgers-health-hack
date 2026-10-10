"""Admin-only membership provisioning. There is no public enrollment route.

Use an authorized AWS SSO/profile session; never paste AWS keys into this script.
Subjects must be verified against the configured sign-in provider by the admin.
"""
import argparse
import sys
from pathlib import Path
import boto3

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.sessions import subject_key, now


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--expected-account", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--subject", required=True, help="Verified JWT sub, not an email or display name")
    parser.add_argument("--role", required=True, choices=["student", "faculty"])
    parser.add_argument("--revoke", action="store_true")
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    if session.client("sts").get_caller_identity()["Account"] != args.expected_account:
        raise RuntimeError("AWS account mismatch; no membership was changed")
    session.resource("dynamodb").Table(args.table).put_item(Item={
        "pk": subject_key(args.subject), "sk": "ACCESS", "role": args.role,
        "active": not args.revoke, "updated_at": now()
    })
    print("Membership revoked" if args.revoke else "Membership provisioned")


if __name__ == "__main__":
    main()
