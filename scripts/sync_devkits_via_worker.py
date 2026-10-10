#!/usr/bin/env python3
"""Copia ZIPs existentes do GitHub Actions DevKitTools ao R2 privado.

Não constrói ZIPs, não publica catálogo, não cria pagamentos. Usa OIDC
efêmero, artefato GitHub fixo e SHA-256 de todos os 71 arquivos.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

from sync_system_releases import SyncError, request
from sync_releases_via_worker import OidcClient, ROOT

ARTIFACT_ID = 11002868547
SOURCE = "nutricionistaalmeidavh-spec/DevKitTools"
SOURCE_COMMIT = "545fe21b125fc6c39b379437691d1ebf3c2abcfa"
SOURCE_URL = f"https://api.github.com/repos/{SOURCE}/actions/artifacts/{ARTIFACT_ID}/zip"
API_PATH = "/v1/admin/devkit-releases"
HEALTH_MARKER = "github-oidc-devkits-v1"
MAX_ARTIFACT = 15 * 1024 * 1024
MAX_FILE = 2 * 1024 * 1024
NAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9.-]{0,145}\.zip")


def download_archive():
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "ArtiSys-DevKit-R2/1.0"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    with request(SOURCE_URL, headers=headers) as response:
        buf = response.read(MAX_ARTIFACT + 1)
    if len(buf) > MAX_ARTIFACT:
        raise SyncError("Artefato excede limite permitido")
    try:
        return zipfile.ZipFile(io.BytesIO(buf))
    except zipfile.BadZipFile as exc:
        raise SyncError("Artefato do GitHub não é ZIP válido") from exc


def verified_entries(archive, expected_names):
    infos = archive.infolist()
    names = [item.filename for item in infos]
    if len(names) != 72 or len(set(names)) != 72 or set(names) != expected_names | {"SHA256SUMS.txt"}:
        raise SyncError("O artefato não contém exatamente os 71 ZIPs esperados e SHA256SUMS")
    for item in infos:
        if item.is_dir() or "/" in item.filename or chr(92) in item.filename or item.file_size > MAX_FILE:
            raise SyncError("Arquivo inseguro no artefato: " + item.filename)
    try:
        raw = archive.read("SHA256SUMS.txt").decode("ascii").splitlines()
    except (KeyError, UnicodeDecodeError) as exc:
        raise SyncError("SHA256SUMS.txt inválido") from exc
    checksums = {}
    for line in raw:
        if "  " not in line:
            raise SyncError("Linha SHA256SUMS inválida")
        digest, name = line.split("  ", 1)
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or name in checksums:
            raise SyncError("Checksum inválido/duplicado")
        checksums[name] = digest
    if set(checksums) != expected_names:
        raise SyncError("Checksums não correspondem exatamente a 71 arquivos")
    validated = {}
    for name in sorted(expected_names):
        if not NAME_PATTERN.fullmatch(name):
            raise SyncError("Nome de arquivo fora da whitelist")
        content = archive.read(name)
        if not content.startswith(b"PK\x03\x04"):
            raise SyncError("Kit não tem formato ZIP: " + name)
        digest = hashlib.sha256(content).hexdigest()
        if digest != checksums[name]:
            raise SyncError("SHA-256 do GitHub Actions divergente: " + name)
        validated[name] = (content, digest)
    return validated


def wait_worker():
    deadline = time.monotonic() + 300
    while True:
        try:
            req = urllib.request.Request(ROOT + "/healthz",
                headers={"User-Agent": "ArtiSys-DevKit-R2/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as response:
                import json
                state = json.load(response)
            if state.get("devkitSyncAuth") == HEALTH_MARKER:
                return
            print("Aguardando publicação da versão do Worker com endpoint Dev Kits...", flush=True)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 404):
                raise SyncError("Worker recusou status do runner") from None
        except urllib.error.URLError:
            pass
        if time.monotonic() >= deadline:
            raise SyncError("Worker novo não ficou disponível em cinco minutos")
        time.sleep(15)


def inventory(client):
    seen = {}
    total = None
    for offset in (0, 20, 40, 60):
        page = client.call(f"{API_PATH}?offset={offset}")
        if not page.get("storageConfigured") or page.get("total") != 71:
            raise SyncError("Inventário R2 diferente de 71 ZIPs")
        if page.get("sourceArtifactId") != ARTIFACT_ID:
            raise SyncError("Worker aponta para artefato GitHub diferente")
        for item in page.get("items", []):
            filename = item.get("fileName")
            if filename in seen:
                raise SyncError("ZIP duplicado no inventário do Worker")
            seen[filename] = item
    if len(seen) != 71:
        raise SyncError("Inventário completo tem quantidade incorreta")
    return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args()
    if args.validate_only:
        assert SOURCE == "nutricionistaalmeidavh-spec/DevKitTools"
        assert ARTIFACT_ID == 11002868547
        print("Origem pinada: DevKitTools, artifact 11002868547, 63 kits + 8 pacotes.")
        return
    wait_worker()
    client = OidcClient(audience="artisys-devkit-sync-r2", status_path=API_PATH)
    before = inventory(client)
    print("Inventário do Worker: 71 ZIPs permitidos. Obtendo artifact GitHub imutável...", flush=True)
    with download_archive() as archive:
        checked = verified_entries(archive, set(before))
    print("SHA-256 aprovado: 71 de 71 ZIPs existentes.", flush=True)
    copied = 0
    for name in sorted(checked):
        content, digest = checked[name]
        present = before[name]
        if present.get("stored"):
            if not present.get("verified") or present.get("sha256") != digest or present.get("bytes") != len(content):
                raise SyncError("Objeto pré-existente divergente, upload bloqueado: " + name)
            print("R2 já verificado: " + name, flush=True)
            continue
        if present.get("error"):
            raise SyncError("R2 indisponível para: " + name)
        response = client.call(f"{API_PATH}/{name}/upload", "PUT", content,
            json_body=False,extra_headers={"x-artisys-sha256": digest})
        if response.get("stored") is not True or response.get("verified") is not True:
            raise SyncError("Worker não verificou upload: " + name)
        copied += 1
        print(f"R2 privado: {copied} novo(s) — {name}", flush=True)
    after = inventory(client)
    for name, (content, digest) in checked.items():
        state = after[name]
        if not state.get("verified") or state.get("sha256") != digest or state.get("bytes") != len(content):
            raise SyncError("R2 não confirmou SHA-256 e bytes finais: " + name)
        if state.get("commercialApproved") or state.get("deliverable"):
            raise SyncError("Arquivo foi publicado indevidamente: " + name)
    print("R2 CONFIRMADO: 71 ZIPs (63 kits + 8 pacotes), todos íntegros e privados.")
    print("As ofertas, o D1 comercial e PAYMENTS_ENABLED não foram modificados.")


if __name__ == "__main__":
    try:
        main()
    except (SyncError, OSError, urllib.error.URLError, AssertionError) as exc:
        print("ERRO DE SINCRONIZAÇÃO DEV KITS: " + str(exc), file=sys.stderr)
        sys.exit(1)
