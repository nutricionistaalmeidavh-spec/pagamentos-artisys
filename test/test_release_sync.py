import hashlib
import pathlib
import tempfile
import unittest
import urllib.request

from scripts.sync_system_releases import SyncError, SafeRedirect, remote_matches, validate, verified_hash


def entry():
    data=b'ABC test de integridade'
    return data, {
        'id':'unit-1','offerId':'obra-na-mao','fileName':'unit.exe',
        'key':'releases/unit.exe','source':'github-release','sourceRepo':'nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL',
        'sourceUrl':'https://github.com/nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL/releases/download/v0.1.0/unit.exe',
        'size':len(data),'sha256':hashlib.sha256(data).hexdigest()
    }


class FakeClient:
    def __init__(self, obj):
        self.obj=obj
    def head_object(self, **_):
        return self.obj


class ReleaseSyncTests(unittest.TestCase):
    def test_github_artifact_redirect_removes_bearer_cross_domain(self):
        url='https://api.github.com/repos/owner/repo/actions/artifacts/123/zip'
        req=urllib.request.Request(url,headers={'Authorization':'Bearer secret-value','User-Agent':'ArtiSys-Release-Sync'})
        req.add_unredirected_header('AUTHORIZATION','Bearer extra-secret')
        handler=SafeRedirect()
        forwarded=handler.redirect_request(
            req,None,302,'Found',{},'https://results-receiver.githubusercontent.com/archive/123'
        )
        self.assertIsNotNone(forwarded)
        for mapping in (forwarded.headers,forwarded.unredirected_hdrs):
            self.assertNotIn('authorization',{key.lower() for key in mapping})
        self.assertEqual(forwarded.get_header('User-agent'),'ArtiSys-Release-Sync')

    def test_redirect_never_downgrades_https_even_with_public_artifacts(self):
        handler=SafeRedirect()
        req=urllib.request.Request('https://github.com/owner/repo/releases/download/v1/test.exe')
        with self.assertRaisesRegex(SyncError,'não HTTPS'):
            handler.redirect_request(req,None,302,'Found',{},'http://example.com/file.exe')

    def test_sha256_accepts_only_matching_bytes(self):
        data,item=entry()
        with tempfile.TemporaryDirectory() as temp:
            target=pathlib.Path(temp)/'unit.exe'
            target.write_bytes(data)
            verified_hash(target,item)
            target.write_bytes(data[:-1]+b'!')
            with self.assertRaisesRegex(SyncError,'SHA-256 diferente'):
                verified_hash(target,item)

    def test_remote_object_requires_hash_metadata_and_size(self):
        data,item=entry()
        self.assertTrue(remote_matches(FakeClient({'ContentLength':len(data),'Metadata':{'sha256':item['sha256']}}),'private',item))
        for existing in [
            {'ContentLength':len(data),'Metadata':{}},
            {'ContentLength':len(data),'Metadata':{'sha256':'0'*64}},
            {'ContentLength':len(data)-1,'Metadata':{'sha256':item['sha256']}},
        ]:
            with self.assertRaisesRegex(SyncError,'preexistente diferente'):
                remote_matches(FakeClient(existing),'private',item)

    def test_manifest_rejects_wrong_count_and_unsafe_keys(self):
        _,sample=entry()
        with self.assertRaises(SyncError):
            validate({'schema':1,'entries':[sample]})
        bad=dict(sample,key='releases/../../secrets.txt')
        with self.assertRaises(SyncError):
            validate({'schema':1,'entries':[bad]*8})

    def test_hash_changes_are_detected_even_with_same_size(self):
        data,item=entry()
        with tempfile.TemporaryDirectory() as temp:
            path=pathlib.Path(temp)/'unit.exe'
            path.write_bytes(b'X'+data[1:])
            with self.assertRaisesRegex(SyncError,'SHA-256 diferente'):
                verified_hash(path,item)


if __name__=='__main__':
    unittest.main()
