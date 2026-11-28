"""
Uploading an exported catalogue to an S3 bucket, or to an S3-compatible store
reached at another endpoint, after each export (`desktop.py`, `algorithm.py`).

What is uploaded is the export in the folder: the root document and every file
under `<project>.stac/`, other than a file or folder whose name starts with a
dot, which is how the export names its temporary files. Each file goes to the
same path under the bucket's folder.

- **Changed files only.** A record beside the export,
  `.<project>.stac.upload.json`, holds the bucket it was uploaded to and each
  file's checksum as uploaded. A file whose checksum matches is not uploaded
  again; where the record names another bucket, folder or endpoint, every file
  is.
- **In order.** The copies under `<project>.stac/data/` first, then the other
  documents and styles, then the root, so a reader never finds a document
  naming a file that is not there yet. Then each file the record names and the
  export no longer holds is removed. A file the record does not name is never
  removed, so files put in the bucket another way are left alone.
- **The first failure stops the upload**, so the root is not uploaded before
  what it names. The record is written with what was done, so the next run
  uploads what was missed.
- **Credentials** come from an "AWS S3" configuration in QGIS's
  Authentication Manager (`read_credentials`) and are given to GDAL's
  `/vsis3/` file system as options for the bucket's folder alone, which are
  cleared when the upload ends (`GdalStore`). They are never written to a
  file.

This module imports QGIS and GDAL only inside the functions that use them, so
the planning is tested without QGIS (`tests/test_upload.py`).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Optional, Protocol
from urllib.parse import urlsplit

from .publish import COPIES_FOLDER, SETTINGS_SCOPE

# Where the project keeps the upload's settings (`QgsProject.writeEntry`).
UPLOAD_KEY = 'upload/enabled'
BUCKET_KEY = 'upload/bucket'
BUCKET_FOLDER_KEY = 'upload/folder'
ENDPOINT_KEY = 'upload/endpoint'
AUTHCFG_KEY = 'upload/authcfg'

# QGIS's authentication method for S3 keys, and the keys its configuration holds them under.
AWS_S3_METHOD = 'AWSS3'
AWS_S3_PROVIDER = 'awss3'
DEFAULT_REGION = 'us-east-1'

RECORD_VERSION = 1

# S3's error codes for credentials it does not accept, or that may not write to the bucket.
_REFUSED_CODES = {'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidToken', 'ExpiredToken', 'AllAccessDisabled', 'AuthorizationHeaderMalformed'}

_BUCKET_NAME = re.compile(r'[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]')

NEXT_RUN_NOTE = 'The next export uploads what was missed.'
NOT_UPLOADED = 'The STAC catalogue was exported, but not uploaded'


@dataclass(frozen=True)
class UploadTarget:
    """A bucket, the folder in it the export goes to (empty for its top level), and the endpoint of an S3-compatible store (empty for Amazon S3)."""

    bucket: str
    folder: str = ''
    endpoint: str = ''
    authcfg: str = ''

    def address(self, path: str = '') -> str:
        """The `s3://` address of `path` in the bucket's folder, as messages give it."""
        parts = [part for part in (self.folder, path) if part]
        return '/'.join([f's3://{self.bucket}', *parts])

    def where(self) -> str:
        """The bucket's folder, and the endpoint where one is given."""
        return f'{self.address()} at {self.endpoint}' if self.endpoint else self.address()

    def key(self) -> dict[str, str]:
        """What the record compares: the same bucket, folder and endpoint."""
        return {'endpoint': self.endpoint, 'bucket': self.bucket, 'folder': self.folder}


@dataclass(frozen=True)
class Credentials:
    access_key: str
    secret_key: str
    region: str = DEFAULT_REGION


class UploadFailed(Exception):
    """An upload that could not start or did not finish, with the message to show."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class StoreError(Exception):
    """A file the store refused: S3's error code and message where it gave them, or neither where it could not be reached."""

    def __init__(self, code: str = '', detail: str = '') -> None:
        super().__init__(code or detail or 'no answer')
        self.code = code
        self.detail = detail


class Store(Protocol):
    def put(self, local_path: str, path: str, media_type: str) -> None: ...

    def remove(self, path: str) -> None: ...


@dataclass
class UploadResult:
    uploaded: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    cancelled: bool = False


@dataclass
class UploadPlan:
    uploads: list[str]
    removals: list[str]


def clean_folder(folder: str) -> str:
    """A folder in a bucket as given, without leading or trailing slashes. Raises `UploadFailed` for one that steps up a level."""
    parts = [part for part in folder.strip().replace('\\', '/').split('/') if part]
    if any(part in ('.', '..') for part in parts):
        raise UploadFailed(f'The folder in the bucket, {folder}, cannot hold "." or "..". Give a folder such as catalogues/parks.')
    return '/'.join(parts)


def upload_target(bucket: str, folder: str = '', endpoint: str = '', authcfg: str = '') -> UploadTarget:
    """The target from its settings, checked: a bucket's name, a folder in it, an endpoint, and the id of an "AWS S3" configuration."""
    bucket = bucket.strip()
    if not _BUCKET_NAME.fullmatch(bucket) or '..' in bucket:
        raise UploadFailed(f'{bucket or "No bucket"} is not a bucket name. Give the name of the bucket alone, such as parks-catalogue, without s3:// or a folder.')
    target = UploadTarget(bucket, clean_folder(folder), endpoint.strip().rstrip('/'), authcfg.strip())
    endpoint_options(target.endpoint)
    if not target.authcfg:
        raise UploadFailed(f'No credentials are chosen for the upload to {target.where()}. Choose an "AWS S3" configuration from QGIS\'s Authentication Manager on the QUAC page of Project Properties.')
    return target


def endpoint_options(endpoint: str) -> dict[str, str]:
    """
    GDAL's options for an S3-compatible store's endpoint: none for Amazon S3,
    where `endpoint` is empty; otherwise its host and port, `AWS_HTTPS=NO` for
    an `http://` address, and path-style addressing, which S3-compatible
    stores take. Raises `UploadFailed` for an endpoint with a path.
    """
    if not endpoint:
        return {}
    split = urlsplit(endpoint if '://' in endpoint else f'https://{endpoint}')
    if split.scheme not in ('http', 'https') or not split.hostname or split.path not in ('', '/') or split.query or split.username:
        raise UploadFailed(f'{endpoint} is not an endpoint. Give the store\'s address alone, such as https://storage.example.test, without a bucket or a path.')
    options = {'AWS_S3_ENDPOINT': split.netloc, 'AWS_VIRTUAL_HOSTING': 'FALSE'}
    if split.scheme == 'http':
        options['AWS_HTTPS'] = 'NO'
    return options


def gdal_options(target: UploadTarget, credentials: Credentials) -> dict[str, str]:
    """Every GDAL option the upload sets for the bucket's folder."""
    return {
        'AWS_ACCESS_KEY_ID': credentials.access_key,
        'AWS_SECRET_ACCESS_KEY': credentials.secret_key,
        'AWS_REGION': credentials.region or DEFAULT_REGION,
        **endpoint_options(target.endpoint),
    }


def record_name(root_file_name: str) -> str:
    """The record's name beside the root document: `.Parks.stac.upload.json` for `Parks.stac.json`."""
    stem = root_file_name[:-len('.json')] if root_file_name.lower().endswith('.json') else root_file_name
    return f'.{stem}.upload.json'


def checksum(path: str) -> str:
    """A file's SHA-256 as a multihash in hex, as the catalogue's `file:checksum` gives it."""
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return f'1220{digest.hexdigest()}'


def export_files(folder: str, root_file_name: str, children_folder: str) -> list[str]:
    """The export's files by their paths relative to `folder`, joined by `/`: the root document, where there is one, and every file under the children's folder, leaving out a name that starts with a dot."""
    found = [root_file_name] if os.path.isfile(os.path.join(folder, root_file_name)) else []
    children = os.path.join(folder, children_folder)
    for directory, folders, files in os.walk(children):
        folders[:] = sorted(name for name in folders if not name.startswith('.'))
        relative = os.path.relpath(directory, folder).replace(os.sep, '/')
        found.extend(f'{relative}/{name}' for name in sorted(files) if not name.startswith('.'))
    return found


def upload_order(paths: list[str], root_file_name: str, children_folder: str) -> list[str]:
    """The copies under `<project>.stac/data/` first, then the other files under `<project>.stac/`, then the root."""
    copies = f'{children_folder}/{COPIES_FOLDER}/'

    def rank(path: str) -> tuple[int, str]:
        if path == root_file_name:
            return 2, path
        return (0 if path.startswith(copies) else 1), path

    return sorted(paths, key=rank)


def plan_upload(target: UploadTarget, files: dict[str, str], record: Optional[dict[str, Any]], root_file_name: str, children_folder: str) -> UploadPlan:
    """The files to upload, in order, being those whose checksum the record does not hold for this target, and the files the record names that the export no longer holds."""
    previous = recorded_files(target, record)
    uploads = [path for path in upload_order(list(files), root_file_name, children_folder) if previous.get(path) != files[path]]
    removals = sorted(path for path in previous if path not in files)
    return UploadPlan(uploads, removals)


def recorded_files(target: UploadTarget, record: Optional[dict[str, Any]]) -> dict[str, str]:
    """Each file's checksum as last uploaded to `target`, or none where the record is of another target or unreadable."""
    if not isinstance(record, dict) or record.get('version') != RECORD_VERSION or record.get('target') != target.key():
        return {}
    files = record.get('files')
    if not isinstance(files, dict):
        return {}
    return {path: value for path, value in files.items() if isinstance(path, str) and isinstance(value, str)}


def read_record(folder: str, root_file_name: str) -> Optional[dict[str, Any]]:
    try:
        with open(os.path.join(folder, record_name(root_file_name)), 'rb') as handle:
            record = json.loads(handle.read().decode('utf-8'))
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) else None


def write_record(folder: str, root_file_name: str, target: UploadTarget, files: dict[str, str]) -> None:
    """Writes the record to a temporary file beside it and renames it into place."""
    data = json.dumps({'version': RECORD_VERSION, 'target': target.key(), 'files': dict(sorted(files.items()))}, indent=2).encode('utf-8')
    handle, temporary = tempfile.mkstemp(prefix=f'{record_name(root_file_name)}.', suffix='.tmp', dir=folder)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(data)
        os.replace(temporary, os.path.join(folder, record_name(root_file_name)))
    except BaseException:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


def media_type(path: str) -> str:
    """The media type a file is uploaded with, which a web browser reads it by."""
    from .quac_server.util.catalogue_file_formats import declared_media_type_for_file

    lower = path.lower()
    if lower.endswith('.json'):
        return 'application/json'
    if lower.endswith('.geojson'):
        return 'application/geo+json'
    if lower.endswith('.pmtiles'):
        return 'application/vnd.pmtiles'
    return declared_media_type_for_file(path, None)


def upload_export(
    folder: str,
    root_file_name: str,
    children_folder: str,
    target: UploadTarget,
    store: Store,
    cancelled: Callable[[], bool] = lambda: False,
    progress: Callable[[float], None] = lambda _percent: None,
) -> UploadResult:
    """
    Uploads the export in `folder` to `target` through `store`, as the
    module's description says, and writes the record. Raises `UploadFailed`
    for the first file the store refuses, once the record holds what was done.
    """
    files = {path: checksum(os.path.join(folder, *path.split('/'))) for path in export_files(folder, root_file_name, children_folder)}
    if root_file_name not in files:
        raise UploadFailed(f'{NOT_UPLOADED} to {target.where()}, because the folder holds no {root_file_name}. Export the catalogue again.')
    record = read_record(folder, root_file_name)
    plan = plan_upload(target, files, record, root_file_name, children_folder)
    done = recorded_files(target, record)
    result = UploadResult()
    steps = len(plan.uploads) + len(plan.removals)
    try:
        for index, path in enumerate(plan.uploads):
            if cancelled():
                result.cancelled = True
                return result
            try:
                store.put(os.path.join(folder, *path.split('/')), path, media_type(path))
            except StoreError as error:
                raise UploadFailed(failure_message(target, error, path, len(result.uploaded))) from None
            done[path] = files[path]
            result.uploaded.append(path)
            progress(100 * (index + 1) / steps)
        for index, path in enumerate(plan.removals):
            if cancelled():
                result.cancelled = True
                return result
            try:
                store.remove(path)
            except StoreError as error:
                # A file already gone from the bucket, such as one removed by hand, counts as removed.
                if error.code != 'NoSuchKey':
                    raise UploadFailed(failure_message(target, error, path, len(result.uploaded), removing=True)) from None
            done.pop(path, None)
            result.removed.append(path)
            progress(100 * (len(plan.uploads) + index + 1) / steps)
    finally:
        write_record(folder, root_file_name, target, done)
    return result


def failure_message(target: UploadTarget, error: StoreError, path: str, uploaded: int, removing: bool = False) -> str:
    """What happened, in words naming the bucket, and what to do."""
    opening = f'{NOT_UPLOADED} in full to {target.where()}' if uploaded or removing else f'{NOT_UPLOADED} to {target.where()}'
    file_ = f'{path}, which the catalogue no longer names,' if removing else path
    so_far = f' {uploaded} {"file was" if uploaded == 1 else "files were"} uploaded before it.' if uploaded else ''
    if error.code == 'NoSuchBucket':
        return f'{opening}, because the bucket {target.bucket} does not exist. Check the bucket\'s name on the QUAC page of Project Properties, or create the bucket. {NEXT_RUN_NOTE}'
    if error.code in _REFUSED_CODES:
        return f'{opening}: the store refused {file_} with "{error.detail or error.code}".{so_far} Check that the chosen credentials may write to the bucket. {NEXT_RUN_NOTE}'
    if not error.code:
        return f'{opening}, because {target.endpoint or "Amazon S3"} did not answer.{so_far} Check the endpoint and the network connection. {NEXT_RUN_NOTE}'
    return f'{opening}: the store refused {file_} with {error.code}{f" ({error.detail})" if error.detail else ""}.{so_far} {NEXT_RUN_NOTE}'


def result_message(target: UploadTarget, result: UploadResult) -> str:
    if result.cancelled:
        return f'The upload to {target.where()} was cancelled after {len(result.uploaded)} {"file" if len(result.uploaded) == 1 else "files"}. {NEXT_RUN_NOTE}'
    if not result.uploaded and not result.removed:
        return f'Nothing to upload: {target.where()} already holds this export.'
    sentences = [f'Uploaded {len(result.uploaded)} {"file" if len(result.uploaded) == 1 else "files"} to {target.where()}.']
    if result.removed:
        sentences.append(f'Removed {len(result.removed)} {"file" if len(result.removed) == 1 else "files"} the catalogue no longer names.')
    return ' '.join(sentences)


@dataclass
class PendingUpload:
    """The upload that follows an export into `folder`: its target, or why the settings cannot be used."""

    folder: str
    root_file_name: str
    children_folder: str
    target: Optional[UploadTarget] = None
    problem: Optional[str] = None


def pending_upload(project: Any, folder: str, root_file_name: str, children_folder: str, target: Optional[UploadTarget] = None) -> Optional[PendingUpload]:
    """The upload after an export of `project` into `folder`: to `target` where one is given, otherwise as the project's QUAC page says, or None where it turns none on."""
    try:
        target = target or read_upload_target(project)
    except UploadFailed as failed:
        return PendingUpload(folder, root_file_name, children_folder, problem=f'{NOT_UPLOADED}. {failed.message}')
    return PendingUpload(folder, root_file_name, children_folder, target) if target is not None else None


def run_upload(pending: PendingUpload, credentials: Credentials, cancelled: Callable[[], bool] = lambda: False, progress: Callable[[float], None] = lambda _percent: None) -> UploadResult:
    """Uploads the export through GDAL. Raises `UploadFailed` as `upload_export` does."""
    assert pending.target is not None
    with GdalStore(pending.target, credentials) as store:
        return upload_export(pending.folder, pending.root_file_name, pending.children_folder, pending.target, store, cancelled, progress)


def read_upload_target(project: Any) -> Optional[UploadTarget]:
    """The project's upload, where its QUAC page turns it on, or None. Raises `UploadFailed` for settings that cannot be used."""
    enabled, _found = project.readBoolEntry(SETTINGS_SCOPE, UPLOAD_KEY, False)
    if not enabled:
        return None
    values = [project.readEntry(SETTINGS_SCOPE, key, '')[0] or '' for key in (BUCKET_KEY, BUCKET_FOLDER_KEY, ENDPOINT_KEY, AUTHCFG_KEY)]
    return upload_target(*values)


def read_credentials(target: UploadTarget) -> Credentials:
    """
    The keys in the target's "AWS S3" configuration, read from QGIS's
    Authentication Manager. Raises `UploadFailed` where it cannot be read,
    such as in a run with no master password given.
    """
    from qgis.core import QgsApplication, QgsAuthMethodConfig

    manager = QgsApplication.authManager()
    config = QgsAuthMethodConfig()
    loaded = manager.loadAuthenticationConfig(target.authcfg, config, True)
    loaded = loaded[0] if isinstance(loaded, tuple) else loaded
    if not loaded or not config.isValid(True):
        raise UploadFailed(
            f'{NOT_UPLOADED} to {target.where()}, because QGIS could not read the credentials {target.authcfg}. '
            'Check that the configuration is in Settings ▸ Options ▸ Authentication. '
            'For a run with no one at the computer, give QGIS its master password through QGIS_AUTH_PASSWORD_FILE.'
        )
    if config.method() != AWS_S3_METHOD:
        raise UploadFailed(f'{NOT_UPLOADED} to {target.where()}, because the credentials {target.authcfg} are not an "AWS S3" configuration. Choose one on the QUAC page of Project Properties.')
    access_key, secret_key = config.config('username'), config.config('password')
    if not access_key or not secret_key:
        raise UploadFailed(f'{NOT_UPLOADED} to {target.where()}, because the credentials {target.authcfg} hold no access key or no secret key. Fill them in in Settings ▸ Options ▸ Authentication.')
    return Credentials(access_key, secret_key, config.config('region') or DEFAULT_REGION)


class GdalStore:
    """
    The bucket's folder through GDAL's `/vsis3/` file system. While open, the
    credentials are GDAL options for the bucket alone (GDAL 3.6 and later's
    path-specific options), as GDAL sends some requests to the bucket rather
    than to a file in it; closing clears them and GDAL's cache of the bucket.
    """

    def __init__(self, target: UploadTarget, credentials: Credentials) -> None:
        self.bucket = f'/vsis3/{target.bucket}'
        self.prefix = self.bucket + (f'/{target.folder}' if target.folder else '')
        self.options = gdal_options(target, credentials)

    def __enter__(self) -> 'GdalStore':
        from osgeo import gdal

        if not hasattr(gdal, 'SetPathSpecificOption'):
            raise UploadFailed(f'{NOT_UPLOADED} to {self.prefix[len("/vsis3/"):]}, because this version of QGIS has GDAL {gdal.__version__}, and an upload needs GDAL 3.6 or later.')
        for name, value in self.options.items():
            gdal.SetPathSpecificOption(self.bucket, name, value)
        return self

    def __exit__(self, *_exc: Any) -> None:
        from osgeo import gdal

        gdal.ClearPathSpecificOptions(self.bucket)
        gdal.VSICurlPartialClearCache(self.bucket)

    def put(self, local_path: str, path: str, media_type: str) -> None:
        from osgeo import gdal

        with _s3_errors() as seen:
            _succeed(seen, lambda: gdal.CopyFile(local_path, f'{self.prefix}/{path}', options=[f'Content-Type={media_type}']))

    def remove(self, path: str) -> None:
        from osgeo import gdal

        with _s3_errors() as seen:
            _succeed(seen, lambda: gdal.Unlink(f'{self.prefix}/{path}'))


def _succeed(seen: '_SeenErrors', call: Callable[[], int]) -> None:
    """Runs a GDAL call and raises `StoreError` where it fails: by a return code other than 0, or by an exception, where GDAL's Python bindings are set to raise them, as QGIS 3.44 and 4 set them."""
    try:
        failed = call() != 0
    except RuntimeError:
        failed = True
    if failed:
        raise seen.error()


_STATUS_CODES = {'403': 'AccessDenied', '404': 'NoSuchKey'}


class _SeenErrors:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def error(self) -> StoreError:
        """
        S3's error code and message, which GDAL gives only as a debug message
        holding S3's answer. Where an answer has no body, as to the request
        GDAL makes for a file's size, its status stands in: 403 as
        `AccessDenied`, 404 as `NoSuchKey`. Neither where there was no answer.
        """
        for message in self.messages:
            code = re.search(r'<Code>([^<]*)</Code>', message)
            if code:
                detail = re.search(r'<Message>([^<]*)</Message>', message)
                return StoreError(code.group(1), detail.group(1).strip().rstrip('.') if detail else '')
        for message in self.messages:
            status = re.search(r'response_code=(\d+)', message)
            if status and status.group(1) != '0':
                return StoreError(_STATUS_CODES.get(status.group(1), f'HTTP {status.group(1)}'))
        return StoreError()


@contextmanager
def _s3_errors() -> Iterator[_SeenErrors]:
    """Collects GDAL's messages on this thread, its debug messages among them, without showing them, while the block runs."""
    from osgeo import gdal

    seen = _SeenErrors()
    gdal.PushErrorHandler(lambda _class, _number, message: seen.messages.append(str(message)))
    gdal.SetThreadLocalConfigOption('CPL_DEBUG', 'ON')
    try:
        yield seen
    finally:
        gdal.SetThreadLocalConfigOption('CPL_DEBUG', None)
        gdal.PopErrorHandler()
