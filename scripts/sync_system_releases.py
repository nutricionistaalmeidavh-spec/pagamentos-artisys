#!/usr/bin/env python3
"""Sincroniza os oito binários canônicos Drive/GitHub Actions -> R2 privado.

Não publica ofertas nem distribui downloads. Executa somente após configurar
credenciais no GitHub Actions. Requer Python 3.12 + boto3 (somente modo upload).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

MANIFEST = pathlib.Path(".release-sync/manifest.json")
GITHUB_REPO = "nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL"
MAX_DOWNLOAD = 200 * 1024 * 1024
CHUNK = 1024 * 1024


class SyncError(Exception):
    pass


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlparse(req.full_url).hostname != urllib.parse.urlparse(newurl).hostname:
            redirected.remove_header("Authorization")
            redirected.remove_unredirected_header("Authorization")
        return redirected


OPENER = urllib.request.build_opener(SafeRedirect())


def request(url: str, headers=None, data=None, timeout=150):
    if not url.startswith("https://"):
        raise SyncError("URL de transferência deve ser HTTPS")
    return OPENER.open(urllib.request.Request(url, headers=headers or {}, data=data), timeout=timeout)


def verified_hash(path: pathlib.Path, entry: dict) -> None:
    size = path.stat().st_size
    if size != entry["size"]:
        raise SyncError(f"{entry['id']}: tamanho diferente: {size} vs {entry['size']}")
    digest = hashlib.sha256()
    with path.open("rb") as src:
        for piece in iter(lambda: src.read(CHUNK), b""):
            digest.update(piece)
    if digest.hexdigest().lower() != entry["sha256"]:
        raise SyncError(f"{entry['id']}: SHA-256 diferente: transferência bloqueada")


def validate(manifest: dict) -> list[dict]:
    entries = manifest.get("entries", [])
    if manifest.get("schema") != 1 or len(entries) != 8:
        raise SyncError("Manifesto deve conter exatamente oito instaladores")
    if len({e["offerId"] for e in entries}) != 4:
        raise SyncError("Manifesto deve conter exatamente quatro sistemas")
    ids = set()
    keys = set()
    for e in entries:
        if e["id"] in ids or e["key"] in keys:
            raise SyncError("ID/chave duplicada")
        ids.add(e["id"])
        keys.add(e["key"])
        if not re.fullmatch(r"releases/[A-Za-z0-9_.-]+", e["key"]):
            raise SyncError("Chave R2 insegura")
        if not e["key"].endswith(e["fileName"]):
            raise SyncError("Nome de arquivo e chave divergentes")
        if not re.fullmatch(r"[0-9a-f]{64}", e["sha256"]):
            raise SyncError("SHA-256 inválido")
        if not isinstance(e["size"], int) or e["size"] <= 0 or e["size"] > MAX_DOWNLOAD:
            raise SyncError("Tamanho inválido")
        if e["source"] == "google-drive":
            if not re.fullmatch(r"[A-Za-z0-9_-]{15,}", e.get("driveId") or ""):
                raise SyncError("ID Drive inválido")
        elif e["source"] == "github-actions":
            pattern = rf"https://github\.com/{GITHUB_REPO}/actions/runs/[0-9]+/artifacts/[0-9]+"
            if not re.fullmatch(pattern, e.get("sourceUrl") or ""):
                raise SyncError("Fonte GitHub incorreta")
        else:
            raise SyncError("Fonte de instalador não autorizada")
    return entries


def download_stream(url: str, headers: dict, dest: pathlib.Path) -> None:
    with request(url, headers=headers) as incoming, dest.open("wb") as out:
        total = 0
        while True:
            part = incoming.read(CHUNK)
            if not part:
                break
            total += len(part)
            if total > MAX_DOWNLOAD:
                raise SyncError("Download acima do limite de segurança")
            out.write(part)


def google_access_token(config: dict) -> str:
    required = ("client_id", "client_secret", "refresh_token")
    if not all(config.get(k) for k in required):
        raise SyncError("ARTISYS_GDRIVE_OAUTH_JSON incompleto")
    body = urllib.parse.urlencode({
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "refresh_token": config["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    with request("https://oauth2.googleapis.com/token", {"Content-Type": "application/x-www-form-urlencoded"}, body) as incoming:
        result = json.load(incoming)
    if not result.get("access_token"):
        raise SyncError("OAuth do Google Drive sem access_token")
    return result["access_token"]


def obtain(entry: dict, folder: pathlib.Path, drive_token: str | None, github_token: str | None) -> pathlib.Path:
    dest = folder / entry["fileName"]
    if entry["source"] == "google-drive":
        if not drive_token:
            raise SyncError("Credencial Google Drive ausente")
        file_id = urllib.parse.quote(entry["driveId"], safe="")
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true"
        download_stream(url, {"Authorization": f"Bearer {drive_token}"}, dest)
    else:
        if not github_token:
            raise SyncError("ARTISYS_SOURCE_GITHUB_TOKEN ausente para artifact do outro repositório")
        artifact_id = entry["sourceUrl"].rsplit("/", 1)[-1]
        url = f"https://api.github.com/repos/{GITHUB_REPO}/actions/artifacts/{artifact_id}/zip"
        zip_path = folder / "github-artifact.zip"
        download_stream(url, {
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "ArtiSys-Release-Sync",
        }, zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            names = [x for x in archive.infolist() if pathlib.PurePosixPath(x.filename).name == entry["fileName"] and not x.is_dir()]
            if len(names) != 1 or names[0].file_size != entry["size"]:
                raise SyncError("Instalador esperado não localizado no artefato validado")
            with archive.open(names[0]) as source, dest.open("wb") as out:
                for chunk in iter(lambda: source.read(CHUNK), b""):
                    out.write(chunk)
        zip_path.unlink()
    verified_hash(dest, entry)
    print(f"SHA-256 válido: {entry['id']} ({entry['size']} bytes)", flush=True)
    return dest


def r2_client(config: dict):
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
        from botocore.config import Config
    except ImportError as exc:
        raise SyncError("Instale boto3 no ambiente de upload") from exc
    fields = ("account_id", "bucket", "access_key_id", "secret_access_key")
    if not all(config.get(k) for k in fields):
        raise SyncError("ARTISYS_R2_CONFIG_JSON incompleto")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", config["account_id"]):
        raise SyncError("R2 account_id inválido")
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{config['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=config["access_key_id"],
        aws_secret_access_key=config["secret_access_key"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 4, "mode": "standard"}),
    )
    transfer = TransferConfig(multipart_threshold=8 * 1024 * 1024, multipart_chunksize=16 * 1024 * 1024, max_concurrency=3)
    return client, config["bucket"], transfer


def remote_matches(client, bucket: str, entry: dict) -> bool:
    try:
        obj = client.head_object(Bucket=bucket, Key=entry["key"])
    except Exception as exc:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise SyncError(f"R2 HEAD falhou para {entry['id']} ({code or 'unknown'})") from None
    if int(obj["ContentLength"]) != entry["size"] or obj.get("Metadata", {}).get("sha256") != entry["sha256"]:
        raise SyncError(f"Objeto R2 preexistente diferente: {entry['id']}. Não sobrescrevi.")
    print(f"Já íntegro no R2: {entry['id']}", flush=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args()
    entries = validate(json.loads(MANIFEST.read_text(encoding="utf-8")))
    print(f"Manifesto validado: {len(entries)} instaladores, 4 sistemas.", flush=True)
    if args.validate_only:
        return
    try:
        r2_config = json.loads(os.environ["ARTISYS_R2_CONFIG_JSON"])
        drive_config = json.loads(os.environ["ARTISYS_GDRIVE_OAUTH_JSON"])
    except (KeyError, ValueError) as exc:
        raise SyncError("Configure ARTISYS_R2_CONFIG_JSON e ARTISYS_GDRIVE_OAUTH_JSON nos secrets GitHub") from exc
    github_token = os.environ.get("ARTISYS_SOURCE_GITHUB_TOKEN", "")
    client, bucket, transfer = r2_client(r2_config)
    pending = [e for e in entries if not remote_matches(client, bucket, e)]
    if not pending:
        print("Todos os oito instaladores já estão íntegros no R2.")
        return
    google_token = google_access_token(drive_config) if any(x["source"] == "google-drive" for x in pending) else None
    with tempfile.TemporaryDirectory(prefix="artisys-release-") as tmp:
        for item in pending:
            with tempfile.TemporaryDirectory(prefix="asset-", dir=tmp) as subdir:
                file = obtain(item, pathlib.Path(subdir), google_token, github_token)
                client.upload_file(
                    str(file), bucket, item["key"],
                    ExtraArgs={"ContentType": "application/octet-stream",
                               "Metadata": {"sha256": item["sha256"], "offerid": item["offerId"],
                                            "variantid": item["id"]}},
                    Config=transfer,
                )
                if not remote_matches(client, bucket, item):
                    raise SyncError("Upload não foi confirmado: "+item["id"])
                print(f"Confirmado no R2 privado: {item['id']}", flush=True)
    print("Sincronização R2 concluída. Ofertas e pagamentos NÃO foram ativados.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print("ERRO RELEASE SYNC: "+str(exc), file=sys.stderr)
        sys.exit(1)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print("Falha de transferência/autenticação. Verifique as credenciais e tente novamente.", file=sys.stderr)
        sys.exit(1)
