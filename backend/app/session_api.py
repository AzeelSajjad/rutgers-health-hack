"""Lambda HTTP API adapter. Only API Gateway-validated JWT claims are trusted."""
import base64
import json
import os
from decimal import Decimal

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.sessions import SessionError, SessionStore, AccessDenied, require_text

_STORE = None


def store():
    global _STORE
    if _STORE is None:
        table = boto3.resource("dynamodb").Table(os.environ["SESSIONS_TABLE"])
        s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
        _STORE = SessionStore(table, s3, os.environ["TRANSCRIPTS_BUCKET"])
    return _STORE


def authenticated_subject(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise AccessDenied("Authenticated access required")
    # API Gateway validates issuer, audience, expiry, signature, and route scope.
    # Do not use user-supplied role/owner headers or body fields.
    return subject


def response(status, payload):
    return {"statusCode": status, "headers": {"content-type": "application/json",
            "cache-control": "no-store", "x-content-type-options": "nosniff"},
            "body": json.dumps(payload, default=lambda v: int(v) if isinstance(v, Decimal) else str(v))}


def body(event, allowed):
    raw = event.get("body") or "{}"
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode()
        if len(raw.encode()) > 16384:
            raise SessionError("Request body too large")
        value = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise SessionError("Invalid JSON body") from error
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise SessionError("Unexpected request fields")
    return value


def integer(value, default):
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError) as error:
        raise SessionError("Invalid pagination parameter") from error


def handler(event, context):
    try:
        subject = authenticated_subject(event)
        route = event.get("routeKey", "")
        query = event.get("queryStringParameters") or {}
        session_id = (event.get("pathParameters") or {}).get("session_id")
        db = store()
        if route == "POST /sessions":
            payload = body(event, ["patient_id"])
            patient_id = require_text(payload.get("patient_id"), "patient_id", 128)
            return response(201, db.create(subject, patient_id))
        if route == "GET /faculty/sessions":
            return response(200, db.list_for_faculty(subject, query.get("before"), integer(query.get("limit"), 25)))
        if route == "GET /sessions/{session_id}":
            return response(200, db.get(subject, session_id))
        if route == "GET /sessions/{session_id}/messages":
            return response(200, db.messages(subject, session_id,
                integer(query.get("after_sequence"), 0), integer(query.get("limit"), 50)))
        if route == "POST /sessions/{session_id}/finish":
            body(event, [])
            return response(200, db.finish(subject, session_id))
        if route == "GET /faculty/sessions/{session_id}/archive":
            return response(200, db.archive_url(subject, session_id))
        if route == "POST /faculty/sessions/{session_id}/reviews":
            payload = body(event, ["decision", "notes"])
            return response(201, db.review(subject, session_id, payload.get("decision"), payload.get("notes")))
        if route == "GET /faculty/sessions/{session_id}/reviews":
            return response(200, db.reviews(subject, session_id, query.get("after"), integer(query.get("limit"), 25)))
        return response(404, {"error": "Route not found"})
    except SessionError as error:
        return response(error.status, {"error": str(error)})
    except ClientError as error:
        # No text, tokens, signed URLs, or student/faculty notes in operational logs.
        print(json.dumps({"error_code": error.response["Error"]["Code"],
                          "request_id": getattr(context, "aws_request_id", None)}))
        return response(503, {"error": "Storage unavailable; retry the request"})
    except Exception:
        print(json.dumps({"error_code": "internal_error", "request_id": getattr(context, "aws_request_id", None)}))
        return response(500, {"error": "Internal error"})
