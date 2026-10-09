#!/usr/bin/env python3
"""Synchronize published GitHub installers to Cloudflare R2 via short-lived Actions OIDC.

No persistent Cloudflare secrets, GitHub PAT, or Google Drive credentials.
The existing Cloudflare Worker validates the signed GitHub OIDC JWT, then uploads
parts to the existing private R2 binding. Never publishes product offers.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

if __package__:
    from .sync_system_releases import MANIFEST, SyncError, obtain, validate
else:
    from sync_system_releases import MANIFEST, SyncError, obtain, validate

AUDIENCE = "artisys-release-sync-r2"
ROOT = "https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev"
CHUNK_SIZE = 8 * 1024 * 1024
STATUS_PATH = "/v1/admin/system-releases"
RETRYABLE = {429, 502, 503, 504}


class OidcClient:
    def __init__(self, root=ROOT):
        self.root = root.rstrip("/")
        self.token = None
        self.issued = 0.0

    def github_token(self, *, force=False):
        if not force and self.token and time.monotonic() - self.issued < 90:
            return self.token
        env_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
        request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
        if not env_url or not request_token:
            raise SyncError("OIDC do GitHub Actions indisponível. Requer permissions: id-token: write")
        url = env_url + ("&" if "?" in env_url else "?") + urllib.parse.urlencode({"audience": AUDIENCE})
        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {request_token}", "Accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                result = json.load(r)
            if not isinstance(result.get("value"), str) or result["value"].count(".") != 2:
                raise SyncError("GitHub não retornou um JWT OIDC válido")
        except urllib.error.URLError as exc:
            raise SyncError("Falha ao obter OIDC do GitHub") from exc
        self.token = result["value"]
        self.issued = time.monotonic()
        return self.token

    def call(self, path, method="GET", payload=None, *, json_body=True, attempts=4):
        if not path.startswith(STATUS_PATH):
            raise SyncError("Rota de upload não permitida")
        url = self.root + path
        last_error = None
        for attempt in range(attempts):
            token = self.github_token(force=attempt > 0 and isinstance(last_error, urllib.error.HTTPError) and last_error.code == 401)
            headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
            if payload is not None:
                headers["Content-Type"] = "application/json" if json_body else "application/octet-stream"
                body = json.dumps(payload).encode() if json_body else payload
            else:
                body = None
            req = urllib.request.Request(url, method=method, headers=headers, data=body)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read(256 * 1024)
                    if len(data) >= 256 * 1024:
                        raise SyncError("Resposta excessiva do Worker")
                    return json.loads(data)
            except urllib.error.HTTPError as err:
                last_error = err
                if err.code == 401 and attempt == 0:
                    self.token = None
                if (err.code in RETRYABLE or err.code == 401) and attempt + 1 < attempts:
                    time.sleep(min(2 ** attempt * 3, 15))
                    continue
                raise SyncError(f"Worker recusou {method} {path.split('?')[0]} (HTTP {err.code})") from None
            except urllib.error.URLError as err:
                last_error = err
                if attempt + 1 < attempts:
                    time.sleep(min(2 ** attempt * 3, 15))
                    continue
                raise SyncError("Worker indisponível durante transferência") from None
        raise SyncError("Falha de comunicação com Worker após tentativas")

    def status(self, timeout_seconds=300):
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                return self.call(STATUS_PATH, attempts=2)
            except SyncError as exc:
                # The Worker's auto-deploy may finish after the GitHub push fires
                # this workflow. Wait for the signed-OIDC release endpoint.
                if time.monotonic() + 15 >= deadline:
                    raise SyncError("Novo Worker com autenticação OIDC não ficou disponível") from exc
                print("Aguardando deploy do Worker e rota OIDC...", flush=True)
                time.sleep(15)


def checked_status(payload, entries):
    if payload.get("total") != len(entries) or payload.get("storageConfigured") is not True:
        raise SyncError("Inventário ou bucket R2 diferente do esperado")
    returned = payload.get("items", [])
    if len(returned) != len(entries):
        raise SyncError("Quantidade de variantes R2 inconsistente")
    by_id = {item["id"]: item for item in returned}
    if set(by_id) != {entry["id"] for entry in entries}:
        raise SyncError("IDs de variantes R2 inconsistentes")
    pending = []
    for entry in entries:
        actual = by_id[entry["id"]]
        if actual.get("expectedSize") != entry["size"] or actual.get("sha256") != entry["sha256"]:
            raise SyncError("Manifesto não bate com o Worker: " + entry["id"])
        if actual.get("stored") or actual.get("verified"):
            if not (actual.get("stored") and actual.get("verified")):
                raise SyncError("R2 contém objeto não verificado. Não sobrescrever: " + entry["id"])
            print("Já verificado no R2: " + entry["id"], flush=True)
        else:
            if actual.get("error"):
                raise SyncError("Não foi possível inspecionar o R2: " + entry["id"])
            pending.append(entry)
    return pending


def upload(client, entry, path):
    prefix = STATUS_PATH + "/" + entry["id"]
    upload_id = None
    parts = []
    try:
        start = client.call(prefix + "/start", "POST", {"expectedSize": entry["size"], "sha256": entry["sha256"]})
        upload_id = start.get("uploadId")
        count = math.ceil(entry["size"] / CHUNK_SIZE)
        if not isinstance(upload_id, str) or start.get("partSize") != CHUNK_SIZE or start.get("partCount") != count:
            raise SyncError("Worker retornou sessão multipart inconsistente")
        with path.open("rb") as file:
            for number in range(1, count + 1):
                block = file.read(CHUNK_SIZE)
                if len(block) != min(CHUNK_SIZE, entry["size"] - (number - 1) * CHUNK_SIZE):
                    raise SyncError("Leitura parcial do instalador")
                upload_query = urllib.parse.urlencode({"uploadId": upload_id})
                result = client.call(prefix + f"/part/{number}?" + upload_query, "PUT", block, json_body=False)
                if result.get("partNumber") != number or not isinstance(result.get("etag"), str):
                    raise SyncError("Parte R2 sem ETag válido")
                parts.append({"partNumber": number, "etag": result["etag"]})
                print(f"R2 {entry['id']}: {number}/{count} partes", flush=True)
        result = client.call(prefix + "/complete", "POST", {"uploadId": upload_id, "parts": parts})
        if result.get("stored") is not True or result.get("bytes") != entry["size"]:
            raise SyncError("R2 não confirmou upload integral")
        upload_id = None
    finally:
        if upload_id:
            try:
                client.call(prefix + "/abort", "POST", {"uploadId": upload_id}, attempts=2)
            except Exception:
                print("Aviso: upload multipart pendente, verifique armazenamento", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    entries = validate(json.loads(MANIFEST.read_text(encoding="utf-8")))
    if args.validate_only:
        print(f"Manifesto GitHub válido: {len(entries)} arquivos de quatro sistemas.")
        return
    client = OidcClient()
    pending = checked_status(client.status(), entries)
    if not pending:
        print("Os oito arquivos já estão conferidos no R2 privado.")
        return
    with tempfile.TemporaryDirectory(prefix="artisys-github-to-r2-") as workspace:
        for entry in pending:
            with tempfile.TemporaryDirectory(dir=workspace, prefix="file-") as folder:
                # Ephemeral built-in GitHub token, not a PAT or repository secret.
                binary = obtain(entry, pathlib.Path(folder), os.environ.get('GITHUB_TOKEN') or None)
                upload(client, entry, binary)
    remaining = checked_status(client.status(timeout_seconds=30), entries)
    if remaining:
        raise SyncError("Ainda faltam " + str(len(remaining)) + " arquivos no R2")
    print("R2 CONFIRMADO: 8 variantes / 4 ofertas, sem publicar vendas.")


if __name__ == "__main__":
    try:
        main()
    except SyncError as err:
        print("ERRO DE SINCRONIZAÇÃO R2: " + str(err), file=sys.stderr)
        sys.exit(1)
