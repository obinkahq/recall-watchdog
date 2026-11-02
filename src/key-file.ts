// Reserve the delegate key output file before any chain call. The file is
// created new (never overwritten, never through a symbolic link) with mode
// 600, outside the repository, and its mode is read back before setup goes
// on. If setup stops before the key is written, the empty file is removed.
import { closeSync, constants, fstatSync, fsyncSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { FixedError } from './errors.js';

export interface ReservedKeyFile {
  write(text: string): void;
  discardIfEmpty(): void;
  close(): void;
}

const NAME = 'MEMWAL_DELEGATE_KEY_OUT';

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
}

function resolveTarget(rawPath: string | undefined, repoRoot: string): string {
  const value = rawPath?.trim();
  if (value === undefined || value === '') {
    throw new FixedError(`Set ${NAME} to a new file path outside the repository (it will hold the delegate secret, mode 600).`);
  }
  if (!path.isAbsolute(value)) throw new FixedError(`${NAME} must be an absolute path.`);
  const target = path.resolve(value);
  const base = path.basename(target);
  if (base === '' || base === '.' || base === '..') throw new FixedError(`${NAME} must name a file, not a folder.`);
  let parent: string;
  try {
    parent = realpathSync(path.dirname(target));
  } catch {
    throw new FixedError(`${NAME}: the parent folder does not exist.`);
  }
  if (isInside(parent, realpathSync(repoRoot))) throw new FixedError(`${NAME} must be outside the repository.`);
  return path.join(parent, base);
}

export function reserveKeyFile(rawPath: string | undefined, repoRoot: string): ReservedKeyFile {
  const target = resolveTarget(rawPath, repoRoot);
  let fd: number;
  try {
    fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'EEXIST') throw new FixedError(`${NAME} already exists. Choose a new file name (an existing file is never overwritten).`);
    throw new FixedError(`${NAME}: cannot create the file (check the folder and its permissions).`);
  }
  const stat = fstatSync(fd);
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== uid) {
    closeSync(fd);
    unlinkSync(target);
    throw new FixedError(`${NAME}: the new file is not a private file (mode 600, owned by this user).`);
  }
  let open = true;
  let written = false;
  return {
    write(text: string) {
      writeSync(fd, text);
      fsyncSync(fd);
      written = true;
    },
    discardIfEmpty() {
      if (written) return;
      if (open) {
        closeSync(fd);
        open = false;
      }
      unlinkSync(target);
    },
    close() {
      if (open) {
        closeSync(fd);
        open = false;
      }
    },
  };
}
