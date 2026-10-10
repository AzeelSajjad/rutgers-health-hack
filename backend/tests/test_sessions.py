import json
import unittest
from unittest.mock import patch

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from moto import mock_aws

from app import session_api
from app.sessions import (AccessDenied, Conflict, SessionError, SessionStore, subject_key)

PATIENT = "4d619156-3250-4212-8399-129f3280fab1"


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.mock = mock_aws()
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.ddb = boto3.client("dynamodb", region_name="us-east-1")
        self.ddb.create_table(TableName="sessions", BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": k, "AttributeType": "S"} for k in ("pk", "sk", "list_pk", "list_sk")],
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            GlobalSecondaryIndexes=[{"IndexName": "SessionList", "KeySchema": [
                {"AttributeName": "list_pk", "KeyType": "HASH"}, {"AttributeName": "list_sk", "KeyType": "RANGE"}],
                "Projection": {"ProjectionType": "ALL"}}])
        self.table = boto3.resource("dynamodb", region_name="us-east-1").Table("sessions")
        self.s3 = boto3.client("s3", region_name="us-east-1", config=Config(signature_version="s3v4"))
        self.s3.create_bucket(Bucket="private-transcripts")
        self.s3.put_bucket_versioning(Bucket="private-transcripts", VersioningConfiguration={"Status": "Enabled"})
        self.store = SessionStore(self.table, self.s3, "private-transcripts", self.ddb)
        for subject, role in (("student-a", "student"), ("student-b", "student"), ("faculty-a", "faculty")):
            self.table.put_item(Item={"pk": subject_key(subject), "sk": "ACCESS", "role": role, "active": True})
        self.session = self.store.create("student-a", PATIENT)["session_id"]

    def exchange(self, revision=0, request="request-1", facts=None):
        return self.store.record_exchange("student-a", self.session, request, revision,
            "Can you tell me about your bowel health?", "I struggle with constipation.",
            facts if facts is not None else ["constipation"])

    def test_student_owner_access_and_faculty_global_access(self):
        self.exchange()
        self.assertEqual(len(self.store.messages("faculty-a", self.session)["messages"]), 3)
        for subject in ("student-b", "unregistered"):
            with self.subTest(subject=subject), self.assertRaises(AccessDenied):
                self.store.messages(subject, self.session)
        for call in (lambda: self.store.list_for_faculty("student-a"),
                     lambda: self.store.archive_url("student-a", self.session),
                     lambda: self.store.record_exchange("faculty-a", self.session, "r", 0, "x", "y")):
            with self.assertRaises(AccessDenied):
                call()
        other = self.store.create("student-b", PATIENT)["session_id"]
        self.assertEqual(self.store.get("faculty-a", other)["owner_sub"], "student-b")
        self.assertEqual(len(self.store.list_for_faculty("faculty-a")["sessions"]), 2)

    def test_duplicate_retry_does_not_append_turns_and_changed_retry_fails(self):
        first = self.exchange()
        self.assertEqual(first, self.exchange())
        self.assertEqual(self.store.get("student-a", self.session)["turn_count"], 3)
        with self.assertRaises(Conflict):
            self.store.record_exchange("student-a", self.session, "request-1", 0, "changed", "answer")
        with self.assertRaises(Conflict):
            self.exchange(revision=0, request="new-request")
        self.assertEqual(len(self.store.messages("student-a", self.session)["messages"]), 3)

    def test_transaction_conflict_does_not_partially_write_a_stale_exchange(self):
        stale = self.store._meta(self.session)
        self.exchange()
        with patch.object(self.store, "_meta", return_value=stale), self.assertRaises(Conflict):
            self.exchange(request="racing-request")
        self.assertEqual(self.store.get("student-a", self.session)["revision"], 1)
        self.assertEqual(len(self.store.messages("student-a", self.session)["messages"]), 3)

    def test_missing_turn_prevents_a_completed_archive(self):
        self.exchange()
        self.table.delete_item(Key={"pk": f"SESSION#{self.session}", "sk": "TURN#00000002"})
        with self.assertRaises(Conflict):
            self.store.finish("student-a", self.session)
        self.assertEqual(self.store.get("student-a", self.session)["status"], "archiving")
        self.assertNotIn("archive_key", self.store._meta(self.session))

    def test_unknown_facts_and_invalid_revisions_are_rejected_before_writing(self):
        for facts in (["invented"], "constipation"):
            with self.assertRaises(SessionError):
                self.exchange(facts=facts)
        with self.assertRaises(SessionError):
            self.store.record_exchange("student-a", self.session, "r", True, "x", "y")
        self.assertEqual(self.store.get("student-a", self.session)["turn_count"], 1)

    def test_profile_is_pinned_and_public_metadata_has_no_hidden_profile(self):
        with patch("app.sessions.load_patient_profile", side_effect=AssertionError("Catalog changed")):
            self.assertEqual(self.store.pinned_profile("student-a", self.session)["id"], PATIENT)
            self.exchange()
        self.assertNotIn("profile_snapshot", self.store.get("student-a", self.session))
        other = self.store.create("student-a", PATIENT)["session_id"]
        self.assertNotEqual(other, self.session)
        self.assertEqual(self.store.get("student-a", other)["turn_count"], 1)

    def test_completed_archive_is_encrypted_version_pinned_and_contains_disclosures(self):
        self.exchange()
        completed = self.store.finish("student-a", self.session)
        self.assertEqual(completed["status"], "completed")
        meta = self.store._meta(self.session)
        obj = self.s3.get_object(Bucket="private-transcripts", Key=meta["archive_key"], VersionId=meta["archive_version"])
        archive = json.loads(obj["Body"].read())
        self.assertEqual(obj["ServerSideEncryption"], "AES256")
        self.assertEqual([turn["role"] for turn in archive["messages"]], ["patient", "student", "patient"])
        self.assertIn("constipation", archive["disclosed_fact_ids"])
        self.assertEqual(archive["profile_snapshot"]["id"], PATIENT)
        link = self.store.archive_url("faculty-a", self.session)
        self.assertIn("X-Amz-Expires=60", link["download_url"])
        self.assertIn("versionId=", link["download_url"])
        self.assertEqual(len(link["sha256"]), 64)
        self.assertEqual(self.store.finish("student-a", self.session)["status"], "completed")
        self.assertEqual(self.exchange()["revision"], 1)
        with self.assertRaises(Conflict):
            self.exchange(revision=1, request="after-finish")

    def test_failed_archive_upload_is_retryable_without_losing_turns(self):
        self.exchange()
        failure = ClientError({"Error": {"Code": "ServiceUnavailable", "Message": "unavailable"}}, "PutObject")
        with patch.object(self.s3, "put_object", side_effect=failure), self.assertRaises(ClientError):
            self.store.finish("student-a", self.session)
        self.assertEqual(self.store.get("student-a", self.session)["status"], "archiving")
        self.assertEqual(len(self.store.messages("student-a", self.session)["messages"]), 3)
        with self.assertRaises(Conflict):
            self.exchange(revision=1, request="blocked")
        self.assertEqual(self.store.finish("student-a", self.session)["status"], "completed")

    def test_review_is_faculty_only_and_does_not_modify_original_transcript(self):
        self.exchange()
        self.store.finish("student-a", self.session)
        meta = self.store._meta(self.session)
        before = self.s3.get_object(Bucket="private-transcripts", Key=meta["archive_key"], VersionId=meta["archive_version"])["Body"].read()
        with self.assertRaises(AccessDenied):
            self.store.review("student-a", self.session, "reviewed", "notes")
        review = self.store.review("faculty-a", self.session, "follow_up_requested", "Practice explaining fiber again.")
        self.assertEqual(review["reviewer_sub"], "faculty-a")
        self.assertEqual(self.store.get("faculty-a", self.session)["review_status"], "follow_up_requested")
        self.assertEqual(len(self.store.reviews("faculty-a", self.session)["reviews"]), 1)
        after = self.s3.get_object(Bucket="private-transcripts", Key=meta["archive_key"], VersionId=meta["archive_version"])["Body"].read()
        self.assertEqual(before, after)

    def test_revocation_removes_access_without_trusting_token_roles(self):
        self.table.update_item(Key={"pk": subject_key("faculty-a"), "sk": "ACCESS"},
                              UpdateExpression="SET active=:value", ExpressionAttributeValues={":value": False})
        with self.assertRaises(AccessDenied):
            self.store.get("faculty-a", self.session)
        with self.assertRaises(AccessDenied):
            self.store.list_for_faculty("faculty-a")

    def test_pagination_archive_and_faculty_access_audit(self):
        for revision in range(51):
            self.exchange(revision=revision, request=f"r-{revision}")
        first = self.store.messages("student-a", self.session, limit=100)
        self.assertEqual(len(first["messages"]), 100)
        self.assertEqual(first["next_after_sequence"], 100)
        self.assertEqual(len(self.store.messages("student-a", self.session, 100)["messages"]), 3)
        self.store.finish("student-a", self.session)
        meta = self.store._meta(self.session)
        archive = json.loads(self.s3.get_object(Bucket="private-transcripts", Key=meta["archive_key"])["Body"].read())
        self.assertEqual(len(archive["messages"]), 103)
        self.store.get("faculty-a", self.session)
        listing = self.store.list_for_faculty("faculty-a")
        self.assertEqual(len(listing["sessions"]), 1)
        self.assertNotIn("profile_snapshot", listing["sessions"][0])
        audit = [i for i in self.table.scan()["Items"] if i["sk"].startswith("AUDIT#")]
        self.assertTrue(any(i["action"] == "session_view" for i in audit))
        self.assertTrue(any(i["action"] == "session_list" for i in audit))
        self.assertTrue(all("text" not in i for i in audit))

    def test_api_authentication_role_spoofing_and_no_patient_turn_write_route(self):
        with patch("app.session_api.store", return_value=self.store):
            anonymous = session_api.handler({"routeKey": "GET /faculty/sessions"}, None)
            self.assertEqual(anonymous["statusCode"], 403)
            event = {"routeKey": "GET /faculty/sessions", "headers": {"role": "faculty"},
                     "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "student-a", "role": "faculty"}}}}}
            self.assertEqual(session_api.handler(event, None)["statusCode"], 403)
            event["routeKey"] = "POST /sessions"
            event["body"] = json.dumps({"patient_id": PATIENT, "owner_sub": "student-b"})
            self.assertEqual(session_api.handler(event, None)["statusCode"], 400)
            event["routeKey"] = "POST /sessions/{session_id}/messages"
            self.assertEqual(session_api.handler(event, None)["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
