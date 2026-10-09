import hashlib
import pathlib
import tempfile
import unittest

from scripts.sync_system_releases import SyncError, remote_matches, validate, verified_hash


def entry():
    data=b'ABC test de integridade'
    return data, {
        'id':'unit-1','offerId':'obra-na-mao','fileName':'unit.exe',
        'key':'releases/unit.exe','source':'google-drive','driveId':'1234567890ABCDEFG',
        'size':len(data),'sha256':hashlib.sha256(data).hexdigest()
    }


class FakeClient:
    def __init__(self, obj):
        self.obj=obj
    def head_object(self, **_):
        return self.obj


class ReleaseSyncTests(unittest.TestCase):
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
