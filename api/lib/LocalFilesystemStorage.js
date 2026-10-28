// @ts-nocheck
import crypto from 'crypto';
import path from 'path';
import { constants, lstatSync, realpathSync, promises as fs } from 'fs';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const NOFOLLOW = constants.O_NOFOLLOW || 0;

/**
* @param {string} code
* @param {string} message
* @param {unknown} [cause]
*/
function localStorageError(code, message, cause) {
  const error = new Error(`[LocalFilesystemStorage] ${message}`);
  error.code = code;

  if (cause) {
    error.cause = cause;
  }

  return error;
}

/**
 * @param {string} rootDir
 */
function assertRootOutsideGitWorktrees(rootDir) {
  let current = path.resolve(rootDir);

  while (true) {
    const gitMarker = path.join(current, '.git');
    let markerExists = false;

    try {
      lstatSync(gitMarker);
      markerExists = true;
    } catch (error) {
      if (
        error?.code !== 'ENOENT'
        && error?.code !== 'ENOTDIR'
      ) {
        throw localStorageError(
          'LOCAL_STORAGE_GIT_CHECK_FAILED',
          'Unable to verify that the local storage root is outside Git worktrees.',
          error,
        );
      }
    }

    if (markerExists) {
      throw localStorageError(
        'LOCAL_STORAGE_GIT_WORKTREE_FORBIDDEN',
        'Local storage root must remain outside Git worktrees.',
      );
    }

    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }
}

/**
 * @param {string} rootDir
 */
function assertResolvedExistingAncestorOutsideGitWorktrees(rootDir) {
  let current = path.resolve(rootDir);

  while (true) {
    try {
      lstatSync(current);

      const realExistingAncestor = realpathSync(current);

      assertRootOutsideGitWorktrees(
        realExistingAncestor,
      );

      return;
    } catch (error) {
      if (
        error
        && typeof error === 'object'
        && typeof error.code === 'string'
        && error.code.startsWith('LOCAL_STORAGE_')
      ) {
        throw error;
      }

      if (
        error?.code === 'ENOENT'
        || error?.code === 'ENOTDIR'
      ) {
        const parent = path.dirname(current);

        if (parent === current) {
          throw localStorageError(
            'LOCAL_STORAGE_GIT_CHECK_FAILED',
            'Unable to resolve an existing ancestor for the local storage root.',
            error,
          );
        }

        current = parent;
        continue;
      }

      throw localStorageError(
        'LOCAL_STORAGE_GIT_CHECK_FAILED',
        'Unable to verify the resolved local storage ancestry.',
        error,
      );
    }
  }
}

export class LocalFilesystemStorage {
  /**
   * @param {string} rootDir
   */
  constructor(rootDir) {
    if (
      typeof rootDir !== 'string'
      || !rootDir.trim()
      || rootDir.includes('\0')
    ) {
      throw localStorageError(
        'LOCAL_STORAGE_INVALID_ROOT',
        'Local storage root must be a non-empty absolute path.',
      );
    }

    const normalizedRoot = rootDir.trim();

    if (!path.isAbsolute(normalizedRoot)) {
      throw localStorageError(
        'LOCAL_STORAGE_INVALID_ROOT',
        'Local storage root must be an absolute path.',
      );
    }

    this.rootDir = path.resolve(normalizedRoot);

    assertRootOutsideGitWorktrees(this.rootDir);
    assertResolvedExistingAncestorOutsideGitWorktrees(
      this.rootDir,
    );
  }

  async _ensureRoot() {
    // This guard MUST run before mkdir. It prevents a missing
    // storage directory reached through a symlinked parent from
    // being created inside a Git repository/worktree before the
    // resolved-path rejection occurs.
    assertResolvedExistingAncestorOutsideGitWorktrees(
      this.rootDir,
    );

    try {
      await fs.mkdir(this.rootDir, {
        recursive: true,
        mode: DIRECTORY_MODE,
      });

      const rootStat = await fs.lstat(this.rootDir);

      if (
        rootStat.isSymbolicLink()
        || !rootStat.isDirectory()
      ) {
        throw localStorageError(
          'LOCAL_STORAGE_UNSAFE_ROOT',
          'Local storage root must be a real directory, not a symbolic link.',
        );
      }

      await fs.chmod(this.rootDir, DIRECTORY_MODE);

      const realRoot = await fs.realpath(this.rootDir);

      // Re-check the resolved path to fail closed against
      // symlink/TOCTOU changes after construction.
      assertRootOutsideGitWorktrees(realRoot);

      return realRoot;
    } catch (error) {
      if (
        error
        && typeof error === 'object'
        && typeof error.code === 'string'
        && error.code.startsWith('LOCAL_STORAGE_')
      ) {
        throw error;
      }

      throw localStorageError(
        'LOCAL_STORAGE_ROOT_UNAVAILABLE',
        'Local storage root is unavailable.',
        error,
      );
    }
  }

  /**
   * @param {string | string[]} key
   */
  _validateKey(key) {
    if (
      typeof key !== 'string'
      || !key
      || key.includes('\0')
    ) {
      throw localStorageError(
        'LOCAL_STORAGE_UNSAFE_KEY',
        'Unsafe storage key.',
      );
    }

    if (
      path.isAbsolute(key)
      || key === '.'
      || key === '..'
      || key.includes('/')
      || key.includes('\\')
    ) {
      throw localStorageError(
        'LOCAL_STORAGE_UNSAFE_KEY',
        'Unsafe storage key.',
      );
    }

    if (path.basename(key) !== key) {
      throw localStorageError(
        'LOCAL_STORAGE_UNSAFE_KEY',
        'Unsafe storage key.',
      );
    }

    return key;
  }

  /**
   * @param {string | string[]} key
   */
  async _targetForKey(key) {
    const safeKey = this._validateKey(key);
    const realRoot = await this._ensureRoot();
    const target = path.join(realRoot, safeKey);

    if (path.dirname(target) !== realRoot) {
      throw localStorageError(
        'LOCAL_STORAGE_PATH_ESCAPE',
        'Storage key escapes the configured root.',
      );
    }

    return {
      realRoot,
      target,
    };
  }

  /**
   * @param {import("fs").PathLike} target
   */
  async _assertNotSymlink(target) {
    try {
      const targetStat = await fs.lstat(target);

      if (targetStat.isSymbolicLink()) {
        throw localStorageError(
          'LOCAL_STORAGE_SYMLINK_REJECTED',
          'Symbolic-link storage objects are forbidden.',
        );
      }

      return targetStat;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  /**
   * @param {import("buffer").WithImplicitCoercion<ArrayLike<number>>} buffer
   */
  async upload(buffer) {
    if (
      !Buffer.isBuffer(buffer)
      && !(buffer instanceof Uint8Array)
    ) {
      throw localStorageError(
        'LOCAL_STORAGE_INVALID_PAYLOAD',
        'Storage payload must be binary data.',
      );
    }

    const bytes = Buffer.from(buffer);
    const realRoot = await this._ensureRoot();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const target = path.join(realRoot, key);

      let handle;

      try {
        handle = await fs.open(
          target,
          constants.O_WRONLY
            | constants.O_CREAT
            | constants.O_EXCL
            | NOFOLLOW,
          FILE_MODE,
        );

        await handle.writeFile(bytes);
        await handle.chmod(FILE_MODE);

        return key;
      } catch (error) {
        if (error?.code === 'EEXIST') {
          continue;
        }

        if (error?.code === 'ELOOP') {
          throw localStorageError(
            'LOCAL_STORAGE_SYMLINK_REJECTED',
            'Symbolic-link storage objects are forbidden.',
            error,
          );
        }

        throw localStorageError(
          'LOCAL_STORAGE_WRITE_FAILED',
          'Failed to write local storage object.',
          error,
        );
      } finally {
        if (handle) {
          await handle.close();
        }
      }
    }

    throw localStorageError(
      'LOCAL_STORAGE_KEY_COLLISION',
      'Unable to allocate a unique local storage key.',
    );
  }

  /**
   * @param {string} key
   */
  async download(key) {
    const { target } = await this._targetForKey(key);

    const targetStat = await this._assertNotSymlink(target);

    if (!targetStat) {
      throw localStorageError(
        'LOCAL_STORAGE_NOT_FOUND',
        'Storage object not found.',
      );
    }

    if (!targetStat.isFile()) {
      throw localStorageError(
        'LOCAL_STORAGE_UNSAFE_OBJECT',
        'Storage object is not a regular file.',
      );
    }

    let handle;

    try {
      handle = await fs.open(
        target,
        constants.O_RDONLY | NOFOLLOW,
      );

      const openedStat = await handle.stat();

      if (!openedStat.isFile()) {
        throw localStorageError(
          'LOCAL_STORAGE_UNSAFE_OBJECT',
          'Storage object is not a regular file.',
        );
      }

      return await handle.readFile();
    } catch (error) {
      if (
        error
        && typeof error === 'object'
        && typeof error.code === 'string'
        && error.code.startsWith('LOCAL_STORAGE_')
      ) {
        throw error;
      }

      if (error?.code === 'ENOENT') {
        throw localStorageError(
          'LOCAL_STORAGE_NOT_FOUND',
          'Storage object not found.',
          error,
        );
      }

      if (error?.code === 'ELOOP') {
        throw localStorageError(
          'LOCAL_STORAGE_SYMLINK_REJECTED',
          'Symbolic-link storage objects are forbidden.',
          error,
        );
      }

      throw localStorageError(
        'LOCAL_STORAGE_READ_FAILED',
        'Failed to read local storage object.',
        error,
      );
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  /**
   * @param {string} key
   */
  async delete(key) {
    const { target } = await this._targetForKey(key);

    const targetStat = await this._assertNotSymlink(target);

    if (!targetStat) {
      return;
    }

    if (!targetStat.isFile()) {
      throw localStorageError(
        'LOCAL_STORAGE_UNSAFE_OBJECT',
        'Storage object is not a regular file.',
      );
    }

    try {
      await fs.unlink(target);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }

      throw localStorageError(
        'LOCAL_STORAGE_DELETE_FAILED',
        'Failed to delete local storage object.',
        error,
      );
    }
  }

  async healthCheck() {
    const realRoot = await this._ensureRoot();

    try {
      await fs.access(
        realRoot,
        constants.R_OK | constants.W_OK,
      );

      return true;
    } catch (error) {
      throw localStorageError(
        'LOCAL_STORAGE_HEALTH_FAILED',
        'Local storage root is not readable and writable.',
        error,
      );
    }
  }
}
