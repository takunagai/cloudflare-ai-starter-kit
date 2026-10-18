"""本人の別ターミナル専用。今回の課金照合と上流削除だけを行う。"""

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
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_private(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError("private_metadata_failed")
    return path.read_text()


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
    parser.add_argument("mode", choices=["billing", "finish"])
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[3] / ".wrangler/e-live"
    try:
        target = read_private(directory / "終了対象.txt")
        matches = re.findall(r"^request ID: ([0-9a-fA-F-]{36})$", target, re.M)
        if len(matches) != 1 or "モデル: openai/gpt-image-2.5/sunburst/text-to-image\n" not in target:
            raise ValueError("target_mismatch")
        request_id = str(uuid.UUID(matches[0]))
        # 最初の結果HTTPを観測した19:18の後、保守的に20:20 JSTまで削除を待つ。
        if args.mode == "finish" and time.time() < 1791199200:
            print(json.dumps({"delete_not_due": True, "not_before_jst": "2026-10-05 20:20", "operation_performed": False}))
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
        query = urllib.parse.urlencode({"request_id": request_id, "start": "2026-10-05T09:45:00Z", "limit": 20})
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
        print(json.dumps({"delete_http_status": status, "delete_attempt": state["delete_attempts"], "cdn_result_count": len(files) if isinstance(files, list) else None, "upstream_delete_report": "reported_deleted" if reported else "failed" if failed else "unknown", "natural_expiry_verified": False}))
        return 0 if reported else 1
    except Exception:
        print(json.dumps({"operation_performed_or_completed": "unconfirmed", "reason": "input_state_or_network_failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
