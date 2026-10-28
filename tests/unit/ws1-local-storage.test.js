import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { LocalFilesystemStorage } from '../../api/lib/LocalFilesystemStorage.js';

const s3State = vi.hoisted(() => ({
  clients: [],
  send: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor(options) {
      s3State.clients.push(options);
    }

    send(command) {
      return s3State.send(command);
    }
  }

  class PutObjectCommand {
    constructor(input) {
      this.input = input;
      this.kind = 'put';
    }
  }

  class GetObjectCommand {
    constructor(input) {
      this.input = input;
      this.kind = 'get';
    }
  }

  class DeleteObjectCommand {
    constructor(input) {
      this.input = input;
      this.kind = 'delete';
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  };
});

const tempDirs = [];

async function createTempRoot() {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ada-ws1-storage-'),
  );

  tempDirs.push(dir);

  return dir;
}

function setBaseEnv() {
  process.env.NODE_ENV = 'test';
  process.env.VERCEL_ENV = 'development';

  process.env.DATABASE_URL =
    'postgresql://test:test@127.0.0.1:5432/test';

  process.env.JWT_SECRET = 'ws1-test-jwt-secret';
  process.env.ADA_ENCRYPTION_KEY =
    'ws1-test-encryption-key';

  process.env.STORAGE_ENDPOINT =
    'http://127.0.0.1:9000';

  process.env.STORAGE_BUCKET = 'test-bucket';
  process.env.STORAGE_REGION = 'auto';
  process.env.STORAGE_ACCESS_KEY_ID =
    'test-access-key';
  process.env.STORAGE_SECRET_ACCESS_KEY =
    'test-secret-key';

  delete process.env.ADA_LOCAL_STORAGE_DIR;
}

async function loadStorage() {
  vi.resetModules();

  const mod = await import(
    '../../api/lib/storage.js'
  );

  return mod.storage;
}

beforeEach(() => {
  s3State.clients.length = 0;
  s3State.send.mockReset();
  setBaseEnv();
});

afterEach(async () => {
  delete process.env.ADA_LOCAL_STORAGE_DIR;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    await fs.rm(dir, {
      recursive: true,
      force: true,
    });
  }
});

describe('WS1 local filesystem storage', () => {
  it('selects local storage when ADA_LOCAL_STORAGE_DIR is configured and never creates an S3 client', async () => {
    const temp = await createTempRoot();
    const localRoot = path.join(temp, 'documents');

    process.env.ADA_LOCAL_STORAGE_DIR =
      localRoot;

    const storage = await loadStorage();

    const payload = Buffer.from([
      0x00,
      0x01,
      0x02,
      0xfe,
      0xff,
      0x41,
      0x44,
      0x41,
    ]);

    const key = await storage.upload(
      payload,
      'application/octet-stream',
    );

    expect(s3State.clients).toHaveLength(0);
    expect(s3State.send).not.toHaveBeenCalled();

    const downloaded = await storage.download(key);

    expect(Buffer.compare(downloaded, payload)).toBe(0);

    if (process.platform !== 'win32') {
      const rootStat = await fs.stat(localRoot);
      const fileStat = await fs.stat(
        path.join(localRoot, key),
      );

      expect(rootStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);
    }

    await storage.delete(key);
    await storage.delete(key);

    await expect(
      fs.readFile(path.join(localRoot, key)),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves S3 selection when ADA_LOCAL_STORAGE_DIR is absent', async () => {
    delete process.env.ADA_LOCAL_STORAGE_DIR;

    s3State.send.mockResolvedValue({});

    const storage = await loadStorage();

    const key = await storage.upload(
      Buffer.from('s3-path'),
      'text/plain',
    );

    expect(key).toMatch(
      /^[0-9]+-[0-9a-f]{16}$/,
    );

    expect(s3State.clients).toHaveLength(1);
    expect(s3State.send).toHaveBeenCalledTimes(1);

    expect(
      s3State.send.mock.calls[0][0].kind,
    ).toBe('put');
  });

  it('rejects traversal, absolute, nested and NUL-containing keys', async () => {
    const temp = await createTempRoot();
    const root = path.join(temp, 'documents');

    const driver = new LocalFilesystemStorage(
      root,
    );

    await driver.healthCheck();

    const unsafeKeys = [
      '../escape',
      'folder/file',
      'folder\\file',
      '/absolute/path',
      '.',
      '..',
      `nul${String.fromCharCode(0)}byte`,
    ];

    for (const key of unsafeKeys) {
      await expect(
        driver.download(key),
      ).rejects.toThrow(
        /Unsafe storage key/,
      );
    }
  });

  it('rejects symbolic-link storage objects', async () => {
    const temp = await createTempRoot();
    const root = path.join(temp, 'documents');
    const outside = path.join(
      temp,
      'outside-secret.bin',
    );

    const driver = new LocalFilesystemStorage(
      root,
    );

    await driver.healthCheck();

    await fs.writeFile(
      outside,
      Buffer.from('outside'),
    );

    await fs.symlink(
      outside,
      path.join(root, 'escape-link'),
    );

    await expect(
      driver.download('escape-link'),
    ).rejects.toThrow(
      /Symbolic-link/,
    );
  });

  it('fails closed locally and never falls back to S3', async () => {
    const temp = await createTempRoot();

    const invalidRoot = path.join(
      temp,
      'not-a-directory',
    );

    await fs.writeFile(
      invalidRoot,
      Buffer.from('blocking-file'),
    );

    process.env.ADA_LOCAL_STORAGE_DIR =
      invalidRoot;

    const storage = await loadStorage();

    await expect(
      storage.upload(
        Buffer.from('must-not-fallback'),
        'text/plain',
      ),
    ).rejects.toThrow(
      /Local storage root is unavailable/,
    );

    expect(s3State.clients).toHaveLength(0);
    expect(s3State.send).not.toHaveBeenCalled();
  });

  it('rejects local roots inside Git repositories and worktrees', async () => {
    const temp = await createTempRoot();

    const repositoryRoot = path.join(
      temp,
      'repository',
    );

    await fs.mkdir(
      path.join(repositoryRoot, '.git'),
      {
        recursive: true,
      },
    );

    expect(
      () => new LocalFilesystemStorage(
        repositoryRoot,
      ),
    ).toThrow(
      /outside Git worktrees/,
    );

    expect(
      () => new LocalFilesystemStorage(
        path.join(
          repositoryRoot,
          'documents',
        ),
      ),
    ).toThrow(
      /outside Git worktrees/,
    );

    const linkedWorktreeRoot = path.join(
      temp,
      'linked-worktree',
    );

    await fs.mkdir(
      linkedWorktreeRoot,
      {
        recursive: true,
      },
    );

    await fs.writeFile(
      path.join(
        linkedWorktreeRoot,
        '.git',
      ),
      'gitdir: ../repository/.git/worktrees/fake\n',
      {
        mode: 0o600,
      },
    );

    expect(
      () => new LocalFilesystemStorage(
        linkedWorktreeRoot,
      ),
    ).toThrow(
      /outside Git worktrees/,
    );

    expect(
      () => new LocalFilesystemStorage(
        path.join(
          linkedWorktreeRoot,
          'documents',
        ),
      ),
    ).toThrow(
      /outside Git worktrees/,
    );
  });

  it('rejects a symlink-parent escape before creating any directory inside a Git repository', async () => {
    const temp = await createTempRoot();

    const repositoryRoot = path.join(
      temp,
      'repository',
    );

    const nested = path.join(
      repositoryRoot,
      'nested',
    );

    const alias = path.join(
      temp,
      'alias',
    );

    const forbiddenTarget = path.join(
      nested,
      'runtime-documents',
    );

    await fs.mkdir(
      path.join(repositoryRoot, '.git'),
      {
        recursive: true,
        mode: 0o700,
      },
    );

    await fs.mkdir(
      nested,
      {
        recursive: true,
        mode: 0o700,
      },
    );

    await fs.symlink(
      nested,
      alias,
      'dir',
    );

    expect(
      () => new LocalFilesystemStorage(
        path.join(
          alias,
          'runtime-documents',
        ),
      ),
    ).toThrow(
      /outside Git worktrees/,
    );

    await expect(
      fs.access(forbiddenTarget),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('requires an absolute local storage root', () => {
    expect(
      () => new LocalFilesystemStorage(
        'relative/storage',
      ),
    ).toThrow(
      /absolute path/,
    );
  });
});
