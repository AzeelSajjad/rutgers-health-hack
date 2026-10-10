import json
from pathlib import Path
import unittest
import zipfile

BACKEND = Path(__file__).resolve().parent.parent


class InfrastructureTests(unittest.TestCase):
    def setUp(self):
        self.template = json.loads((BACKEND / "infrastructure/sessions-stack.json").read_text())
        self.resources = self.template["Resources"]

    def test_private_encrypted_versioned_bucket_and_protected_table(self):
        bucket = self.resources["TranscriptBucket"]["Properties"]
        self.assertTrue(all(bucket["PublicAccessBlockConfiguration"].values()))
        self.assertEqual(bucket["OwnershipControls"]["Rules"][0]["ObjectOwnership"], "BucketOwnerEnforced")
        self.assertEqual(bucket["VersioningConfiguration"]["Status"], "Enabled")
        self.assertEqual(bucket["BucketEncryption"]["ServerSideEncryptionConfiguration"][0]
                         ["ServerSideEncryptionByDefault"]["SSEAlgorithm"], "AES256")
        table = self.resources["SessionsTable"]["Properties"]
        self.assertTrue(table["DeletionProtectionEnabled"])
        self.assertTrue(table["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"])
        self.assertTrue(table["SSESpecification"]["SSEEnabled"])
        for name in ("TranscriptBucket", "SessionsTable"):
            self.assertEqual(self.resources[name]["DeletionPolicy"], "Retain")
        statements = self.resources["TranscriptBucketPolicy"]["Properties"]["PolicyDocument"]["Statement"]
        self.assertEqual({s["Sid"] for s in statements},
                         {"DenyInsecureTransport", "RequireEncryptedUploads", "LimitSignedDownloadAge"})
        self.assertTrue(all(s["Effect"] == "Deny" for s in statements))

    def test_every_api_route_requires_jwt_and_scope(self):
        routes = [r for r in self.resources.values() if r["Type"] == "AWS::ApiGatewayV2::Route"]
        self.assertEqual(len(routes), 8)
        for route in routes:
            props = route["Properties"]
            self.assertEqual(props["AuthorizationType"], "JWT")
            self.assertEqual(props["AuthorizationScopes"], [{"Ref": "ApiScope"}])
        auth = self.resources["JwtAuthorizer"]["Properties"]["JwtConfiguration"]
        self.assertEqual(auth, {"Issuer": {"Ref": "JwtIssuer"}, "Audience": [{"Ref": "JwtAudience"}]})
        self.assertNotIn("*", str(self.resources["SessionApi"]["Properties"]["CorsConfiguration"]))

    def test_lambda_cannot_provision_memberships_scan_or_delete_logs(self):
        statements = self.resources["SessionRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        for statement in statements:
            self.assertNotEqual(statement["Resource"], "*")
            self.assertNotIn("dynamodb:Scan", statement["Action"])
            self.assertNotIn("dynamodb:DeleteItem", statement["Action"])
            self.assertNotIn("s3:DeleteObject", statement["Action"])
            if "dynamodb:PutItem" in statement["Action"]:
                self.assertEqual(statement["Condition"]["ForAllValues:StringLike"]["dynamodb:LeadingKeys"],
                                 ["SESSION#*", "APP_AUDIT"])

    def test_deployment_package_contains_no_local_config_or_environment(self):
        from scripts.package_sessions import package
        with zipfile.ZipFile(package()) as archive:
            names = archive.namelist()
            self.assertIn("app/session_api.py", names)
            self.assertIn("app/sessions.py", names)
            self.assertTrue(all(name.startswith(("app/", "data/profiles/")) for name in names))
            self.assertFalse(any(".env" in name or ".venv" in name or "deployment.local" in name for name in names))


if __name__ == "__main__":
    unittest.main()
