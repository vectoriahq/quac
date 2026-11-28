"""
The upload of an export (`quac/upload.py`), through a store kept in memory:
what is uploaded and in which order, what is removed, the record, and the
messages. The QGIS Desktop check uploads to an S3 emulator through GDAL.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest

from .installed_plugin import installed_module

upload = installed_module('upload')

ROOT = 'Parks.stac.json'
CHILDREN = 'Parks.stac'
TARGET = upload.UploadTarget('parks-catalogue', 'catalogues/parks', '', 'abc1234')


class MemoryStore:
    """A bucket's folder in memory, which refuses each path in `refuse` with `error`."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.media_types: dict[str, str] = {}
        self.calls: list[tuple[str, str]] = []
        self.refuse: set[str] = set()
        self.error = upload.StoreError('AccessDenied', 'Access Denied')

    def put(self, local_path: str, path: str, media_type: str) -> None:
        self.calls.append(('put', path))
        if path in self.refuse:
            raise self.error
        with open(local_path, 'rb') as handle:
            self.files[path] = handle.read()
        self.media_types[path] = media_type

    def remove(self, path: str) -> None:
        self.calls.append(('remove', path))
        if path in self.refuse:
            raise self.error
        self.files.pop(path, None)


class Export(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.store = MemoryStore()
        self.write(ROOT, '{"type": "Catalog"}')
        self.write(f'{CHILDREN}/Parks/collection.json', '{"type": "Collection"}')
        self.write(f'{CHILDREN}/styles/Parks.qml', '<qgis/>')
        self.write(f'{CHILDREN}/data/parks.parquet', 'parquet')
        self.write(f'{CHILDREN}/data/parks.pmtiles', 'pmtiles')
        self.write(f'{CHILDREN}/data/.parks.fgb.0a1b.tmp.fgb', 'half a copy')
        self.write(f'{CHILDREN}/data/.quac-0a1b/work.txt', 'working')

    def write(self, path: str, text: str) -> None:
        target = os.path.join(self.folder, *path.split('/'))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8') as handle:
            handle.write(text)

    def remove(self, path: str) -> None:
        os.remove(os.path.join(self.folder, *path.split('/')))

    def run_upload(self, target=TARGET):
        self.store.calls.clear()
        return upload.upload_export(self.folder, ROOT, CHILDREN, target, self.store)

    def record(self) -> dict:
        with open(os.path.join(self.folder, '.Parks.stac.upload.json'), encoding='utf-8') as handle:
            return json.load(handle)


class TheFirstUpload(Export):
    def test_uploads_the_copies_then_the_documents_then_the_root(self) -> None:
        result = self.run_upload()
        self.assertEqual([path for _call, path in self.store.calls], [
            f'{CHILDREN}/data/parks.parquet',
            f'{CHILDREN}/data/parks.pmtiles',
            f'{CHILDREN}/Parks/collection.json',
            f'{CHILDREN}/styles/Parks.qml',
            ROOT,
        ])
        self.assertEqual(result.uploaded, [path for _call, path in self.store.calls])
        self.assertEqual(result.removed, [])

    def test_leaves_out_the_exports_temporary_files(self) -> None:
        self.run_upload()
        self.assertFalse(any('/.' in path for path in self.store.files))

    def test_gives_each_file_the_media_type_a_browser_reads_it_by(self) -> None:
        self.run_upload()
        self.assertEqual(self.store.media_types[ROOT], 'application/json')
        self.assertEqual(self.store.media_types[f'{CHILDREN}/data/parks.pmtiles'], 'application/vnd.pmtiles')
        self.assertEqual(self.store.media_types[f'{CHILDREN}/data/parks.parquet'], 'application/vnd.apache.parquet')
        self.assertEqual(self.store.media_types[f'{CHILDREN}/styles/Parks.qml'], 'application/x-qgis-qml+xml')

    def test_records_the_target_and_each_files_checksum(self) -> None:
        self.run_upload()
        record = self.record()
        self.assertEqual(record['target'], {'endpoint': '', 'bucket': 'parks-catalogue', 'folder': 'catalogues/parks'})
        self.assertEqual(set(record['files']), set(self.store.files))
        self.assertEqual(record['files'][ROOT], upload.checksum(os.path.join(self.folder, ROOT)))
        self.assertTrue(record['files'][ROOT].startswith('1220'))

    def test_a_folder_with_no_root_is_not_uploaded(self) -> None:
        self.remove(ROOT)
        with self.assertRaises(upload.UploadFailed) as failed:
            self.run_upload()
        self.assertIn('holds no Parks.stac.json', failed.exception.message)
        self.assertTrue(failed.exception.message.startswith('The STAC catalogue was exported, but not uploaded to s3://parks-catalogue/catalogues/parks,'))
        self.assertEqual(self.store.calls, [])


class ALaterUpload(Export):
    def setUp(self) -> None:
        super().setUp()
        self.run_upload()

    def test_uploads_nothing_where_nothing_changed(self) -> None:
        result = self.run_upload()
        self.assertEqual(self.store.calls, [])
        self.assertEqual(upload.result_message(TARGET, result), 'Nothing to upload: s3://parks-catalogue/catalogues/parks already holds this export.')

    def test_uploads_a_changed_layer_and_the_root_alone(self) -> None:
        self.write(f'{CHILDREN}/data/parks.parquet', 'parquet, edited')
        self.write(ROOT, '{"type": "Catalog", "updated": true}')
        result = self.run_upload()
        self.assertEqual(result.uploaded, [f'{CHILDREN}/data/parks.parquet', ROOT])
        self.assertEqual(self.store.files[f'{CHILDREN}/data/parks.parquet'], b'parquet, edited')

    def test_removes_a_removed_layers_files_after_the_uploads(self) -> None:
        self.remove(f'{CHILDREN}/data/parks.pmtiles')
        self.remove(f'{CHILDREN}/Parks/collection.json')
        self.write(ROOT, '{"type": "Catalog", "links": []}')
        result = self.run_upload()
        self.assertEqual(self.store.calls, [('put', ROOT), ('remove', f'{CHILDREN}/Parks/collection.json'), ('remove', f'{CHILDREN}/data/parks.pmtiles')])
        self.assertEqual(result.removed, [f'{CHILDREN}/Parks/collection.json', f'{CHILDREN}/data/parks.pmtiles'])
        self.assertNotIn(f'{CHILDREN}/data/parks.pmtiles', self.record()['files'])
        self.assertEqual(upload.result_message(TARGET, result), 'Uploaded 1 file to s3://parks-catalogue/catalogues/parks. Removed 2 files the catalogue no longer names.')

    def test_a_file_already_gone_from_the_bucket_counts_as_removed(self) -> None:
        self.remove(f'{CHILDREN}/styles/Parks.qml')
        self.store.refuse = {f'{CHILDREN}/styles/Parks.qml'}
        self.store.error = upload.StoreError('NoSuchKey')
        result = self.run_upload()
        self.assertEqual(result.removed, [f'{CHILDREN}/styles/Parks.qml'])
        self.assertNotIn(f'{CHILDREN}/styles/Parks.qml', self.record()['files'])

    def test_never_removes_a_file_it_did_not_upload(self) -> None:
        self.store.files['notes/readme.txt'] = b'put there another way'
        self.remove(f'{CHILDREN}/styles/Parks.qml')
        self.run_upload()
        self.assertIn('notes/readme.txt', self.store.files)
        self.assertEqual([call for call in self.store.calls if call[0] == 'remove'], [('remove', f'{CHILDREN}/styles/Parks.qml')])

    def test_uploads_everything_to_another_folder_and_removes_nothing(self) -> None:
        elsewhere = upload.UploadTarget('parks-catalogue', 'catalogues/parks-2', '', 'abc1234')
        self.remove(f'{CHILDREN}/styles/Parks.qml')
        result = self.run_upload(elsewhere)
        self.assertEqual(len(result.uploaded), 4)
        self.assertEqual(result.removed, [])
        self.assertEqual(self.record()['target']['folder'], 'catalogues/parks-2')

    def test_an_unreadable_record_uploads_everything(self) -> None:
        with open(os.path.join(self.folder, '.Parks.stac.upload.json'), 'w', encoding='utf-8') as handle:
            handle.write('not json')
        self.assertEqual(len(self.run_upload().uploaded), 5)


class ARefusedUpload(Export):
    def test_stops_at_the_first_refusal_before_the_root(self) -> None:
        self.store.refuse = {f'{CHILDREN}/Parks/collection.json'}
        with self.assertRaises(upload.UploadFailed) as failed:
            self.run_upload()
        self.assertNotIn(ROOT, self.store.files)
        self.assertEqual(self.store.calls[-1], ('put', f'{CHILDREN}/Parks/collection.json'))
        self.assertEqual(
            failed.exception.message,
            'The STAC catalogue was exported, but not uploaded in full to s3://parks-catalogue/catalogues/parks: the store refused Parks.stac/Parks/collection.json with "Access Denied". '
            '2 files were uploaded before it. Check that the chosen credentials may write to the bucket. The next export uploads what was missed.',
        )

    def test_the_next_run_uploads_what_was_missed_and_nothing_twice(self) -> None:
        self.store.refuse = {f'{CHILDREN}/Parks/collection.json'}
        with self.assertRaises(upload.UploadFailed):
            self.run_upload()
        self.store.refuse = set()
        result = self.run_upload()
        self.assertEqual(result.uploaded, [f'{CHILDREN}/Parks/collection.json', f'{CHILDREN}/styles/Parks.qml', ROOT])

    def test_a_missing_bucket_is_named(self) -> None:
        self.store.error = upload.StoreError('NoSuchBucket', 'The specified bucket does not exist')
        self.store.refuse = {f'{CHILDREN}/data/parks.parquet'}
        with self.assertRaises(upload.UploadFailed) as failed:
            self.run_upload()
        self.assertTrue(failed.exception.message.startswith('The STAC catalogue was exported, but not uploaded to s3://parks-catalogue/catalogues/parks, because the bucket parks-catalogue does not exist.'))

    def test_no_answer_names_the_endpoint(self) -> None:
        self.store.error = upload.StoreError()
        self.store.refuse = {f'{CHILDREN}/data/parks.parquet'}
        target = upload.UploadTarget('parks-catalogue', '', 'https://storage.example.test', 'abc1234')
        with self.assertRaises(upload.UploadFailed) as failed:
            self.run_upload(target)
        self.assertIn('because https://storage.example.test did not answer.', failed.exception.message)


class TheSettings(unittest.TestCase):
    def test_a_folder_loses_its_slashes(self) -> None:
        self.assertEqual(upload.upload_target('parks-catalogue', '/catalogues/parks/', '', 'abc1234').folder, 'catalogues/parks')

    def test_a_folder_may_not_step_up(self) -> None:
        with self.assertRaises(upload.UploadFailed):
            upload.upload_target('parks-catalogue', 'catalogues/../other', '', 'abc1234')

    def test_a_bucket_is_its_name_alone(self) -> None:
        for name in ('s3://parks-catalogue', 'parks-catalogue/catalogues', 'Parks', '', 'a'):
            with self.subTest(name=name), self.assertRaises(upload.UploadFailed):
                upload.upload_target(name, '', '', 'abc1234')

    def test_credentials_are_needed(self) -> None:
        with self.assertRaises(upload.UploadFailed) as failed:
            upload.upload_target('parks-catalogue', '', '', '')
        self.assertTrue(failed.exception.message.startswith('No credentials are chosen for the upload to s3://parks-catalogue.'))

    def test_amazon_s3_needs_no_endpoint_options(self) -> None:
        self.assertEqual(upload.endpoint_options(''), {})

    def test_an_endpoint_is_reached_by_path(self) -> None:
        self.assertEqual(upload.endpoint_options('https://storage.example.test'), {'AWS_S3_ENDPOINT': 'storage.example.test', 'AWS_VIRTUAL_HOSTING': 'FALSE'})
        self.assertEqual(upload.endpoint_options('storage.example.test:9000'), {'AWS_S3_ENDPOINT': 'storage.example.test:9000', 'AWS_VIRTUAL_HOSTING': 'FALSE'})
        self.assertEqual(upload.endpoint_options('http://127.0.0.1:9000'), {'AWS_S3_ENDPOINT': '127.0.0.1:9000', 'AWS_VIRTUAL_HOSTING': 'FALSE', 'AWS_HTTPS': 'NO'})

    def test_an_endpoint_with_a_path_is_refused(self) -> None:
        for endpoint in ('https://storage.example.test/parks-catalogue', 'ftp://storage.example.test', 'https://key:secret@storage.example.test'):
            with self.subTest(endpoint=endpoint), self.assertRaises(upload.UploadFailed):
                upload.endpoint_options(endpoint)

    def test_the_credentials_go_to_gdal_with_the_endpoint(self) -> None:
        target = upload.UploadTarget('parks-catalogue', '', 'http://127.0.0.1:9000', 'abc1234')
        options = upload.gdal_options(target, upload.Credentials('access', 'secret', ''))
        self.assertEqual(options['AWS_ACCESS_KEY_ID'], 'access')
        self.assertEqual(options['AWS_SECRET_ACCESS_KEY'], 'secret')
        self.assertEqual(options['AWS_REGION'], 'us-east-1')
        self.assertEqual(options['AWS_HTTPS'], 'NO')

    def test_a_problem_with_the_settings_says_the_export_was_written(self) -> None:
        class Project:
            def readBoolEntry(self, _scope, _key, _default):  # noqa: N802 - QGIS's name
                return True, True

            def readEntry(self, _scope, key, _default):  # noqa: N802 - QGIS's name
                return {upload.BUCKET_KEY: 's3://parks-catalogue', upload.AUTHCFG_KEY: 'abc1234'}.get(key, ''), True

        pending = upload.pending_upload(Project(), '/export', ROOT, CHILDREN)
        self.assertIsNone(pending.target)
        self.assertTrue(pending.problem.startswith('The STAC catalogue was exported, but not uploaded. s3://parks-catalogue is not a bucket name.'))

    def test_the_record_is_named_after_the_root(self) -> None:
        self.assertEqual(upload.record_name('Parks.stac.json'), '.Parks.stac.upload.json')


if __name__ == '__main__':
    unittest.main()
