"""DynamoDB encounter logs, private S3 archives, and app-wide faculty review.

The encounter engine calls record_exchange only after generating/validating a
patient reply. There is deliberately no public route for supplying patient turns.
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from app.profiles import load_patient_profile


class SessionError(ValueError):
    status = 400


class AccessDenied(SessionError):
    status = 403


class NotFound(SessionError):
    status = 404


class Conflict(SessionError):
    status = 409


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=lambda v: int(v) if isinstance(v, Decimal) else str(v))


def require_text(value, name, limit=8000):
    if not isinstance(value, str) or not value.strip() or len(value.encode()) > limit:
        raise SessionError(f"{name} must be nonempty text within {limit} bytes")
    return value


def subject_key(subject):
    require_text(subject, "subject", 512)
    return "USER#" + hashlib.sha256(subject.encode()).hexdigest()


PUBLIC_FIELDS = ("session_id", "patient_id", "patient_version", "owner_sub", "status",
                 "revision", "turn_count", "created_at", "updated_at", "review_status")


class SessionStore:
    def __init__(self, table, s3, bucket, transaction_client=None):
        self.table, self.s3, self.bucket = table, s3, bucket
        self.ddb = transaction_client or boto3.client(
            "dynamodb", region_name=table.meta.client.meta.region_name)
        self.serializer = TypeSerializer()

    def _item(self, item):
        return {k: self.serializer.serialize(v) for k, v in item.items()}

    def _transaction(self, actions):
        try:
            self.ddb.transact_write_items(TransactItems=actions)
        except ClientError as error:
            if error.response["Error"]["Code"] == "TransactionCanceledException":
                reasons = error.response.get("CancellationReasons", [])
                if any(r.get("Code") == "ConditionalCheckFailed" for r in reasons):
                    raise Conflict("Session changed; reload before retrying") from error
            raise

    def role(self, subject):
        access = self.table.get_item(Key={"pk": subject_key(subject), "sk": "ACCESS"},
                                     ConsistentRead=True).get("Item", {})
        if access.get("active") is not True or access.get("role") not in ("student", "faculty"):
            raise AccessDenied("No active app membership")
        return access["role"]

    def _meta(self, session_id):
        try:
            if str(uuid.UUID(session_id)) != session_id:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise SessionError("Invalid session_id")
        item = self.table.get_item(Key={"pk": f"SESSION#{session_id}", "sk": "META"},
                                   ConsistentRead=True).get("Item")
        if item is None:
            raise NotFound("Session not found")
        return item

    def _authorize(self, subject, meta, faculty_only=False, owner_only=False):
        role = self.role(subject)
        if faculty_only and role != "faculty":
            raise AccessDenied("Faculty access required")
        if owner_only and (role != "student" or meta["owner_sub"] != subject):
            raise AccessDenied("Only the student owner can change this encounter")
        if role != "faculty" and meta["owner_sub"] != subject:
            raise AccessDenied("Session access denied")
        return role

    def _audit(self, subject, meta, action):
        self.table.put_item(Item={"pk": meta["pk"], "sk": f"AUDIT#{now()}#{uuid.uuid4()}",
                                  "actor_sub": subject, "action": action, "created_at": now()})

    def create(self, subject, patient_id):
        if self.role(subject) != "student":
            raise AccessDenied("Student membership required to start an encounter")
        require_text(patient_id, "patient_id", 128)
        try:
            profile = load_patient_profile(patient_id)
        except KeyError as error:
            raise NotFound("Patient not found") from error
        session_id, timestamp = str(uuid.uuid4()), now()
        meta = {"pk": f"SESSION#{session_id}", "sk": "META", "session_id": session_id,
                "patient_id": profile["id"], "patient_version": profile["version"],
                "profile_snapshot": encoded(profile), "owner_sub": subject,
                "status": "active", "revision": 0, "turn_count": 1,
                "disclosed_fact_ids": [f["id"] for f in profile["facts"] if f["visibility"] == "initial"],
                "created_at": timestamp, "updated_at": timestamp, "review_status": "pending",
                "list_pk": "APP_SESSIONS", "list_sk": f"{timestamp}#{session_id}"}
        opening = {"pk": meta["pk"], "sk": "TURN#00000001", "turn_id": "turn-1",
                   "sequence": 1, "role": "patient", "text": profile["opening_statement"],
                   "created_at": timestamp, "disclosed_fact_ids": []}
        self._transaction([{"Put": {"TableName": self.table.name, "Item": self._item(item),
            "ConditionExpression": "attribute_not_exists(pk)"}} for item in (meta, opening)])
        return {key: meta[key] for key in PUBLIC_FIELDS}

    def get(self, subject, session_id):
        meta = self._meta(session_id)
        if self._authorize(subject, meta) == "faculty":
            self._audit(subject, meta, "session_view")
        return {key: meta[key] for key in PUBLIC_FIELDS}

    def pinned_profile(self, subject, session_id):
        """Server-only: encounter engine uses the immutable case snapshot."""
        meta = self._meta(session_id)
        self._authorize(subject, meta)
        return json.loads(meta["profile_snapshot"])

    def record_exchange(self, subject, session_id, request_id, expected_revision,
                        student_text, patient_text, disclosed_fact_ids=()):
        """Trusted engine integration; never bind patient_text to a client route."""
        meta = self._meta(session_id)
        self._authorize(subject, meta, owner_only=True)
        require_text(request_id, "request_id", 128)
        require_text(student_text, "student_text")
        require_text(patient_text, "patient_text")
        if type(expected_revision) is not int or expected_revision < 0:
            raise SessionError("expected_revision must be a nonnegative integer")
        if not isinstance(disclosed_fact_ids, (list, tuple)) or not all(
                isinstance(i, str) for i in disclosed_fact_ids):
            raise SessionError("disclosed_fact_ids must be a list of ids")
        profile = json.loads(meta["profile_snapshot"])
        known = {f["id"] for f in profile["facts"]}
        if not set(disclosed_fact_ids) <= known:
            raise SessionError("Disclosure includes unknown facts")
        payload = {"student_text": student_text, "patient_text": patient_text,
                   "expected_revision": expected_revision, "disclosed_fact_ids": sorted(set(disclosed_fact_ids))}
        digest = hashlib.sha256(encoded(payload).encode()).hexdigest()
        request_key = {"pk": meta["pk"], "sk": "REQUEST#" + hashlib.sha256(request_id.encode()).hexdigest()}
        previous = self.table.get_item(Key=request_key, ConsistentRead=True).get("Item")
        if previous:
            if previous["digest"] != digest:
                raise Conflict("request_id already used for different content")
            return json.loads(previous["result"])
        if meta["status"] != "active" or meta["revision"] != expected_revision:
            raise Conflict("Encounter is closed or revision is stale")
        if meta["turn_count"] + 2 > 1001:
            raise Conflict("Encounter reached its 500-exchange limit")
        first = int(meta["turn_count"]) + 1
        timestamp = now()
        turns = [{"pk": meta["pk"], "sk": f"TURN#{first + offset:08d}",
                  "turn_id": f"turn-{first + offset}", "sequence": first + offset,
                  "role": role, "text": text, "created_at": timestamp,
                  "disclosed_fact_ids": list(payload["disclosed_fact_ids"]) if role == "patient" else []}
                 for offset, (role, text) in enumerate((("student", student_text), ("patient", patient_text)))]
        result = {"session_id": session_id, "revision": expected_revision + 1,
                  "turn_ids": [t["turn_id"] for t in turns]}
        values = {":revision": expected_revision, ":next": expected_revision + 1,
                  ":turns": first + 1, ":active": "active", ":owner": subject,
                  ":updated": timestamp, ":disclosed": sorted(set(meta["disclosed_fact_ids"]) | set(disclosed_fact_ids))}
        actions = [{"Update": {"TableName": self.table.name, "Key": self._item({"pk": meta["pk"], "sk": "META"}),
            "UpdateExpression": "SET revision=:next, turn_count=:turns, updated_at=:updated, disclosed_fact_ids=:disclosed",
            "ConditionExpression": "revision=:revision AND #status=:active AND owner_sub=:owner",
            "ExpressionAttributeNames": {"#status": "status"}, "ExpressionAttributeValues": self._item(values)}}]
        for item in turns + [dict(request_key, digest=digest, result=encoded(result))]:
            actions.append({"Put": {"TableName": self.table.name, "Item": self._item(item),
                                    "ConditionExpression": "attribute_not_exists(pk)"}})
        try:
            self._transaction(actions)
        except Conflict:
            previous = self.table.get_item(Key=request_key, ConsistentRead=True).get("Item")
            if previous and previous["digest"] == digest:
                return json.loads(previous["result"])
            raise
        return result

    def messages(self, subject, session_id, after_sequence=0, limit=50):
        meta = self._meta(session_id)
        if self._authorize(subject, meta) == "faculty":
            self._audit(subject, meta, "transcript_view")
        if type(after_sequence) is not int or after_sequence < 0 or type(limit) is not int or not 1 <= limit <= 100:
            raise SessionError("Invalid transcript pagination")
        result = self.table.query(KeyConditionExpression=Key("pk").eq(meta["pk"]) &
            Key("sk").between(f"TURN#{after_sequence + 1:08d}", "TURN#99999999"),
            ConsistentRead=True, Limit=limit)
        turns = [{k: t[k] for k in ("turn_id", "sequence", "role", "text", "created_at", "disclosed_fact_ids")}
                 for t in result["Items"]]
        return {"session_id": session_id, "messages": turns,
                "next_after_sequence": int(turns[-1]["sequence"]) if turns and result.get("LastEvaluatedKey") else None}

    def list_for_faculty(self, subject, before=None, limit=25):
        if self.role(subject) != "faculty":
            raise AccessDenied("Faculty access required")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise SessionError("Invalid limit")
        condition = Key("list_pk").eq("APP_SESSIONS")
        if before is not None:
            require_text(before, "before", 128)
            condition &= Key("list_sk").lt(before)
        result = self.table.query(IndexName="SessionList", KeyConditionExpression=condition,
                                  ScanIndexForward=False, Limit=limit)
        sessions = [{key: item[key] for key in PUBLIC_FIELDS} for item in result["Items"]]
        # A separate app-level audit records list access, without transcript content.
        self._audit(subject, {"pk": "APP_AUDIT"}, "session_list")
        return {"sessions": sessions, "next_before": result["Items"][-1]["list_sk"]
                if result.get("LastEvaluatedKey") and result["Items"] else None}

    def finish(self, subject, session_id):
        meta = self._meta(session_id)
        self._authorize(subject, meta, owner_only=True)
        if meta["status"] == "completed":
            return self.get(subject, session_id)
        if meta["status"] == "active":
            try:
                self.table.update_item(Key={"pk": meta["pk"], "sk": "META"},
                    UpdateExpression="SET #status=:archiving, updated_at=:time",
                    ConditionExpression="#status=:active AND revision=:revision",
                    ExpressionAttributeNames={"#status": "status"},
                    ExpressionAttributeValues={":archiving": "archiving", ":active": "active",
                                               ":revision": meta["revision"], ":time": now()})
            except ClientError as error:
                if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    raise Conflict("Encounter changed; retry finishing") from error
                raise
        elif meta["status"] != "archiving":
            raise Conflict("Unsupported encounter status")
        # Archiving blocks new turns. Failure leaves a retryable state, not a lost log.
        meta = self._meta(session_id)
        turns, after = [], 0
        while True:
            page = self.messages(subject, session_id, after, 100)
            turns.extend(page["messages"])
            if page["next_after_sequence"] is None:
                break
            after = page["next_after_sequence"]
        archive = {"schema_version": 1, "session": {k: meta[k] for k in PUBLIC_FIELDS},
                   "disclosed_fact_ids": meta["disclosed_fact_ids"],
                   "profile_snapshot": json.loads(meta["profile_snapshot"]), "messages": turns}
        if len(turns) != meta["turn_count"] or any(int(t["sequence"]) != i + 1 for i, t in enumerate(turns)):
            raise Conflict("Transcript is incomplete; retry archival")
        archive["session"]["status"] = "completed"
        body = encoded(archive).encode()
        key = f"sessions/{session_id}/transcript.json"
        obj = self.s3.put_object(Bucket=self.bucket, Key=key, Body=body,
                                ContentType="application/json", ServerSideEncryption="AES256")
        version = obj.get("VersionId")
        if not version or version == "null":
            raise SessionError("Archive bucket must have versioning enabled")
        try:
            self.table.update_item(Key={"pk": meta["pk"], "sk": "META"},
                UpdateExpression="SET #status=:done, archive_key=:key, archive_version=:version, archive_sha256=:hash, updated_at=:time",
                ConditionExpression="#status=:archiving AND revision=:revision",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":done": "completed", ":archiving": "archiving",
                    ":revision": meta["revision"], ":key": key, ":version": version,
                    ":hash": hashlib.sha256(body).hexdigest(), ":time": now()})
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException" and self._meta(session_id)["status"] == "completed":
                return self.get(subject, session_id)
            raise
        return self.get(subject, session_id)

    def archive_url(self, subject, session_id):
        meta = self._meta(session_id)
        self._authorize(subject, meta, faculty_only=True)
        if meta["status"] != "completed":
            raise Conflict("Archive is not ready")
        self._audit(subject, meta, "archive_download_authorized")
        url = self.s3.generate_presigned_url("get_object", Params={"Bucket": self.bucket,
            "Key": meta["archive_key"], "VersionId": meta["archive_version"],
            "ResponseContentDisposition": 'attachment; filename="encounter-transcript.json"'}, ExpiresIn=60)
        return {"session_id": session_id, "download_url": url, "expires_in_seconds": 60,
                "sha256": meta["archive_sha256"]}

    def review(self, subject, session_id, decision, notes):
        meta = self._meta(session_id)
        self._authorize(subject, meta, faculty_only=True)
        if decision not in ("reviewed", "follow_up_requested"):
            raise SessionError("Invalid faculty review decision")
        require_text(notes, "notes", 8000)
        if meta["status"] != "completed":
            raise Conflict("Finish the encounter before review")
        timestamp, review_id = now(), str(uuid.uuid4())
        record = {"pk": meta["pk"], "sk": f"REVIEW#{timestamp}#{review_id}",
                  "review_id": review_id, "reviewer_sub": subject, "decision": decision,
                  "notes": notes, "created_at": timestamp}
        self._transaction([
            {"Update": {"TableName": self.table.name, "Key": self._item({"pk": meta["pk"], "sk": "META"}),
                "UpdateExpression": "SET review_status=:decision",
                "ConditionExpression": "#status=:completed", "ExpressionAttributeNames": {"#status": "status"},
                "ExpressionAttributeValues": self._item({":decision": decision, ":completed": "completed"})}},
            {"Put": {"TableName": self.table.name, "Item": self._item(record), "ConditionExpression": "attribute_not_exists(pk)"}}
        ])
        return {k: v for k, v in record.items() if k not in ("pk", "sk")}

    def reviews(self, subject, session_id, after=None, limit=25):
        meta = self._meta(session_id)
        self._authorize(subject, meta, faculty_only=True)
        self._audit(subject, meta, "review_history_view")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise SessionError("Invalid review pagination")
        lower = "REVIEW#"
        if after is not None:
            require_text(after, "after", 128)
            if not after.startswith("REVIEW#"):
                raise SessionError("Invalid review cursor")
            lower = after + "\x00"
        result = self.table.query(KeyConditionExpression=Key("pk").eq(meta["pk"]) &
            Key("sk").between(lower, "REVIEW#\uffff"), ConsistentRead=True, Limit=limit)
        records = [{k: v for k, v in item.items() if k not in ("pk", "sk")} for item in result["Items"]]
        return {"session_id": session_id, "reviews": records,
                "next_after": result["Items"][-1]["sk"] if result.get("LastEvaluatedKey") and records else None}
