import hashlib
import pathlib
import tempfile
import unittest

from scripts.sync_releases_via_worker import CHUNK_SIZE, SyncError, checked_status, upload


def entry(size=10):
    return {"id": "pdv-nexus-win10", "offerId": "pdv-nexus", "size": size,
            "sha256": hashlib.sha256(b"x" * size).hexdigest()}


def payload(e, *, present=False, verified=False, bad_hash=False):
    return {"total": 1, "storageConfigured": True,
            "items": [{"id": e["id"], "expectedSize": e["size"],
                       "sha256": "0" * 64 if bad_hash else e["sha256"],
                       "stored": present, "verified": verified, "error": None}]}


class Client:
    def __init__(self, e):
        self.e = e
        self.calls = []
    def call(self, path, method="GET", body=None, *, json_body=True, attempts=4):
        self.calls.append((method, path, body if json_body else len(body)))
        if path.endswith("/start"):
            return {"uploadId": "session-test-12345678",
                    "partSize": CHUNK_SIZE, "partCount": 2}
        if "/part/" in path:
            part = int(path.split("/part/")[1].split("?")[0])
            return {"partNumber": part, "etag": f"etag-{part}"}
        if path.endswith("/complete"):
            return {"stored": True, "bytes": self.e["size"]}
        if path.endswith("/abort"):
            return {"aborted": True}
        raise AssertionError("unexpected path")


class WorkerSyncTest(unittest.TestCase):
    def test_empty_r2_only_returns_pending(self):
        e = entry()
        self.assertEqual(checked_status(payload(e), [e]), [e])

    def test_verified_objects_are_idempotently_skipped(self):
        e = entry()
        self.assertEqual(checked_status(payload(e, present=True, verified=True), [e]), [])

    def test_unknown_metadata_prevents_silent_overwrite(self):
        e = entry()
        for p in [payload(e, present=True), payload(e, bad_hash=True),
                  {"total": 1, "storageConfigured": False, "items": []}]:
            with self.assertRaises(SyncError):
                checked_status(p, [e])

    def test_two_parts_and_completion_not_activated_checkout(self):
        size = CHUNK_SIZE + 11
        e = entry(size=size)
        client = Client(e)
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "installer.exe"
            with path.open("wb") as f:
                f.write(b"x" * size)
            upload(client, e, path)
        calls = client.calls
        self.assertEqual([x[0] for x in calls], ["POST", "PUT", "PUT", "POST"])
        self.assertEqual(calls[0][2]["sha256"], e["sha256"])
        self.assertEqual(calls[1][2], CHUNK_SIZE)
        self.assertEqual(calls[2][2], 11)
        self.assertEqual(len(calls[3][2]["parts"]), 2)


if __name__ == "__main__":
    unittest.main()
