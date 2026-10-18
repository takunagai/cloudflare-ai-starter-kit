"""本人の別ターミナル専用。新隔離の1要求だけを課金照合・上流削除する。"""

import argparse
import getpass
import json
import math
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import warnings
from datetime import datetime, timezone
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_private(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError("private_metadata_failed")
    return path.read_text()


def validate_target(target, now):
    expected_fields = {
        "request_id", "model", "billing_since_utc", "delete_not_before_epoch",
        "delete_mode", "failure_evidence_recorded", "natural_expiry_verified",
        "expiry_observation_unknown",
    }
    if (
        not isinstance(target, dict)
        or set(target) != expected_fields
        or target["model"] != "openai/gpt-image-2.5/sunburst/text-to-image"
        or not isinstance(target["request_id"], str)
        or not isinstance(target["billing_since_utc"], str)
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", target["billing_since_utc"])
        or target["delete_mode"] not in ("early_failure", "after_natural_expiry", "after_observation_unknown")
        or not isinstance(target["delete_not_before_epoch"], int)
        or isinstance(target["delete_not_before_epoch"], bool)
        or type(target["failure_evidence_recorded"]) is not bool
        or type(target["natural_expiry_verified"]) is not bool
        or type(target["expiry_observation_unknown"]) is not bool
        or (
            target["delete_mode"] == "early_failure"
            and not target["failure_evidence_recorded"]
        )
        or (
            target["delete_mode"] == "after_natural_expiry"
            and not target["natural_expiry_verified"]
        )
        or (
            target["delete_mode"] == "after_observation_unknown"
            and (
                not target["expiry_observation_unknown"]
                or target["natural_expiry_verified"]
                or target["failure_evidence_recorded"]
            )
        )
    ):
        raise ValueError("target_mismatch")
    request_id = str(uuid.UUID(target["request_id"]))
    since = datetime.strptime(target["billing_since_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if (
        since.timestamp() > now
        or since.timestamp() < now - 7 * 86400
        or target["delete_not_before_epoch"] < since.timestamp()
    ):
        raise ValueError("billing_window_invalid")
    return request_id


def finish_override_matches(target, allow_unverified_expiry):
    return (target["delete_mode"] == "after_observation_unknown") == allow_unverified_expiry


def prepare_target(directory, target, verify_only=False):
    validate_target(target, time.time())
    if verify_only:
        print(json.dumps({"target_valid": True, "operation_performed": False}))
        return 0
    metadata = directory.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        raise ValueError("private_directory_invalid")
    path = directory / "終了対象.json"
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(descriptor, "w") as stream:
        json.dump(target, stream)
        stream.write("\n")
    print(json.dumps({"target_prepared": True, "operation_performed": False}))
    return 0


def request_json(opener, key, url, method="GET", extra=None):
    headers = {"Authorization": "Key " + key, **(extra or {})}
    request = urllib.request.Request(url, headers=headers, method=method)
    try:
        with opener.open(request, timeout=20) as response:
            data = response.read(262145)
            if len(data) > 262144:
                return response.status, None
            return response.status, json.loads(data)
    except urllib.error.HTTPError as error:
        # 本文・URL・ヘッダー・例外文字列を表示しない。
        kind = "non_json_http_error"
        if error.headers.get("Content-Type", "").split(";")[0] == "application/json":
            kind = "json_http_error"
            try:
                data = error.read(262145)
                value = json.loads(data) if len(data) <= 262144 else {}
                candidate = value.get("error", {}).get("type")
                if candidate in ["authorization_error", "validation_error", "not_found", "rate_limited", "server_error"]:
                    kind = candidate
            except Exception:
                pass
        return error.code, {"operator_error_kind": kind}
    except Exception:
        return None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["prepare", "billing", "finish"])
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--allow-unverified-expiry", action="store_true")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[3] / ".wrangler/e-20261006"
    try:
        if args.mode == "prepare":
            if args.allow_unverified_expiry:
                raise ValueError("unexpected_option")
            source = sys.stdin.read(4097)
            if len(source) > 4096:
                raise ValueError("input_too_large")
            return prepare_target(directory, json.loads(source), args.verify_only)
        if args.verify_only:
            raise ValueError("unexpected_option")
        target = json.loads(read_private(directory / "終了対象.json"))
        request_id = validate_target(target, time.time())
        if args.allow_unverified_expiry and args.mode != "finish":
            raise ValueError("unexpected_option")
        if (
            args.mode == "finish"
            and not finish_override_matches(target, args.allow_unverified_expiry)
        ):
            print(json.dumps({"delete_performed": False, "reason": "unverified_expiry_requires_explicit_override"}))
            return 1
        if args.mode == "finish" and time.time() < target["delete_not_before_epoch"]:
            print(json.dumps({"delete_not_due": True, "operation_performed": False}))
            return 1
        if not sys.stdin.isatty() or not sys.stderr.isatty():
            print(json.dumps({"operation_performed": False, "reason": "separate_interactive_terminal_required"}))
            return 1
        state_path = directory / "fal終了試行.json"
        state = {"request_id": request_id, "delete_attempts": 0, "idempotency_key": str(uuid.uuid4())}
        if state_path.exists():
            state = json.loads(read_private(state_path))
        if state.get("request_id") != request_id or (args.mode == "finish" and state.get("delete_attempts", 3) >= 3):
            raise ValueError("target_or_attempt_limit")
        uuid.UUID(state["idempotency_key"])
        warnings.simplefilter("error", getpass.GetPassWarning)
        key = getpass.getpass("確認済みのfal管理者用API Key（表示・保存しません）: ")
        if not key or "\r" in key or "\n" in key:
            raise ValueError("invalid_input")
        opener = urllib.request.build_opener(NoRedirect())
        query = urllib.parse.urlencode({"request_id": request_id, "start": target["billing_since_utc"], "limit": 20})
        status, result = request_json(opener, key, "https://api.fal.ai/v1/models/billing-events?" + query)
        events = result.get("billing_events", []) if isinstance(result, dict) else []
        own = [x for x in events if x.get("request_id") == request_id]
        costs = [x.get("cost_total") for x in own]
        complete = status == 200 and bool(own) and result.get("has_more") is False and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0 for x in costs)
        print(json.dumps({"billing_http_status": status, "billing_error_kind": result.get("operator_error_kind") if isinstance(result, dict) else None, "matching_events": len(own), "fal_request_within_one_dollar": sum(costs) <= 1 if complete else None, "billing_verdict": "available_now" if complete else "unknown"}))
        if args.mode == "billing":
            return 0
        if status in [401, 403]:
            print(json.dumps({"delete_performed": False, "reason": "management_auth_rejected"}))
            return 1
        state["delete_attempts"] += 1
        temporary = directory / "fal終了試行.tmp"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(state, stream)
        os.replace(temporary, state_path)
        status, result = request_json(opener, key, "https://api.fal.ai/v1/models/requests/" + request_id + "/payloads", "DELETE", {"Idempotency-Key": state["idempotency_key"]})
        key = ""
        files = result.get("cdn_delete_results") if isinstance(result, dict) else None
        reported = status == 200 and isinstance(files, list) and bool(files) and all(isinstance(x, dict) and "exception" in x and x["exception"] is None for x in files)
        failed = isinstance(files, list) and any(isinstance(x, dict) and x.get("exception") is not None for x in files)
        print(json.dumps({"delete_http_status": status, "delete_attempt": state["delete_attempts"], "cdn_result_count": len(files) if isinstance(files, list) else None, "upstream_delete_report": "reported_deleted" if reported else "failed" if failed else "unknown", "natural_expiry_verified": target["natural_expiry_verified"]}))
        return 0 if reported else 1
    except Exception:
        if args.mode == "prepare":
            print(json.dumps({"target_prepared": False, "operation_performed": False, "reason": "input_or_file_failed"}))
        else:
            print(json.dumps({"operation_performed_or_completed": "unconfirmed", "reason": "input_state_or_network_failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
