import type {
  IFS,
  FileEntry,
  FileStat,
  WriteOptions,
  WriteStreamOptions,
  MkdirOptions,
  Permissions,
  WatchEvent,
  DirMeta,
  Unsubscribe,
} from "./types.ts";
import { TrackedWritableStream } from "./stream.ts";
import { NotFoundError, ExistsError, PermissionError } from "./errors.ts";
import { resolvePath, parentPath, basename, isMetaFile } from "./path.ts";
import {
  readMeta,
  writeMeta,
  withMetaLock,
  validateMetaSize,
  updateUsage,
  encoder,
} from "./meta.ts";
import type { Root } from "./root.ts";

/**
 * Navigate from root handle to a directory handle at the given absolute path.
 * Segments are resolved from root; creates intermediate dirs if `create` is true.
 */
async function getDirHandle(
  rootHandle: FileSystemDirectoryHandle,
  absPath: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const segments = absPath.split("/").filter(Boolean);
  let current = rootHandle;
  for (const seg of segments) {
    current = await current.getDirectoryHandle(seg, { create });
  }
  return current;
}

/**
 * Navigate to a directory handle and check a permission in one traversal.
 * Throws PermissionError if the permission is denied.
 */
async function getDirHandleChecked(
  rootHandle: FileSystemDirectoryHandle,
  absPath: string,
  permission: "read" | "write",
): Promise<FileSystemDirectoryHandle> {
  const dirHandle = await getDirHandle(rootHandle, absPath);
  const meta = await readMeta(dirHandle);
  if (!meta.permissions[permission]) {
    throw new PermissionError(absPath, permission);
  }
  return dirHandle;
}

/**
 * Navigate to a file handle at the given absolute path.
 */
async function getFileHandle(
  rootHandle: FileSystemDirectoryHandle,
  absPath: string,
): Promise<FileSystemFileHandle> {
  const dirPath = parentPath(absPath);
  const name = basename(absPath);
  const dirHandle = await getDirHandle(rootHandle, dirPath);
  return dirHandle.getFileHandle(name);
}

/** Convert string/ArrayBuffer data to ArrayBuffer. */
function toBuffer(data: string | ArrayBuffer): ArrayBuffer {
  if (typeof data === "string")
    return encoder.encode(data).buffer as ArrayBuffer;
  return data;
}

/** Build a FileEntry from child meta + name. */
function toFileEntry(
  name: string,
  child: DirMeta["children"][string],
): FileEntry {
  return {
    name,
    type: child.type,
    size: child.size ?? 0,
    ctime: child.ctime,
    mtime: child.mtime,
    meta: child.meta,
  };
}

/**
 * Mount implements the full FS interface scoped to a subpath within a Root.
 */
export class Mount implements IFS {
  private readonly root: Root;
  private readonly mountBase: string;

  constructor(root: Root, mountBase: string) {
    this.root = root;
    this.mountBase = mountBase;
  }

  /** Resolve a user path to an absolute OPFS-relative path. */
  private resolve(userPath: string): string {
    return resolvePath(this.mountBase, userPath);
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    await getDirHandleChecked(this.root.dirHandle, dirAbs, "read");

    try {
      const fileHandle = await getFileHandle(this.root.dirHandle, abs);
      const file = await fileHandle.getFile();
      return file.arrayBuffer();
    } catch {
      throw new NotFoundError(path);
    }
  }

  async readTextFile(path: string): Promise<string> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    await getDirHandleChecked(this.root.dirHandle, dirAbs, "read");

    try {
      const fileHandle = await getFileHandle(this.root.dirHandle, abs);
      const file = await fileHandle.getFile();
      return file.text();
    } catch {
      throw new NotFoundError(path);
    }
  }

  async writeFile(
    path: string,
    data: string | ArrayBuffer,
    options?: WriteOptions,
  ): Promise<void> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");

    const buffer = toBuffer(data);
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();

    const userMeta = options?.meta ?? {};
    if (Object.keys(userMeta).length > 0) {
      validateMetaSize(path, userMeta);
    }

    const now = Date.now();
    let entry!: FileEntry;
    let sizeDelta = 0;
    let isNewFile = false;
    const eventType = await withMetaLock(dirAbs, async () => {
      const meta = await readMeta(dirHandle);
      const existing = meta.children[name];
      isNewFile = !existing;
      const oldSize = existing?.size ?? 0;
      sizeDelta = buffer.byteLength - oldSize;
      meta.children[name] = {
        type: "file",
        size: buffer.byteLength,
        ctime: existing?.ctime ?? now,
        mtime: now,
        meta: userMeta,
      };
      await writeMeta(dirHandle, meta);
      entry = toFileEntry(name, meta.children[name]);
      return isNewFile ? ("create" as const) : ("update" as const);
    });

    await updateUsage(this.root.dirHandle, {
      fileCount: isNewFile ? 1 : 0,
      totalSize: sizeDelta,
    });

    this.root.notifySubscribers(dirAbs, [
      { type: eventType, entry, name, path: abs },
    ]);
  }

  async appendFile(path: string, data: string | ArrayBuffer): Promise<void> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");

    const existing = await this.readFile(path);
    const appendBuf = toBuffer(data);
    const combined = new Uint8Array(existing.byteLength + appendBuf.byteLength);
    combined.set(new Uint8Array(existing), 0);
    combined.set(new Uint8Array(appendBuf), existing.byteLength);

    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(combined);
    await writable.close();

    const now = Date.now();
    let entry!: FileEntry;
    let sizeDelta = 0;
    await withMetaLock(dirAbs, async () => {
      const meta = await readMeta(dirHandle);
      const oldSize = meta.children[name].size ?? 0;
      sizeDelta = combined.byteLength - oldSize;
      meta.children[name].size = combined.byteLength;
      meta.children[name].mtime = now;
      await writeMeta(dirHandle, meta);
      entry = toFileEntry(name, meta.children[name]);
    });

    await updateUsage(this.root.dirHandle, { totalSize: sizeDelta });

    this.root.notifySubscribers(dirAbs, [
      { type: "update", entry, name, path: abs },
    ]);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const data = await this.readFile(src);
    const srcAbs = this.resolve(src);
    const srcDirAbs = parentPath(srcAbs);
    const srcName = basename(srcAbs);

    const srcDirHandle = await getDirHandle(this.root.dirHandle, srcDirAbs);
    const srcMeta = await readMeta(srcDirHandle);
    const srcChildMeta = srcMeta.children[srcName]?.meta ?? {};

    await this.writeFile(dest, data, { meta: srcChildMeta });
  }

  async moveFile(src: string, dest: string): Promise<void> {
    await this.copyFile(src, dest);
    await this.remove(src);
  }

  async remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    if (!name) return; // can't remove root

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");

    // Determine entry type and compute usage delta before removal
    let entryType: "file" | "directory" = "file";
    let usageDelta = { totalSize: 0, fileCount: 0, directoryCount: 0 };
    try {
      const subDirHandle = await dirHandle.getDirectoryHandle(name);
      entryType = "directory";
      if (options?.recursive) {
        usageDelta = await walkSubtreeUsage(subDirHandle);
        usageDelta.directoryCount += 1; // count the dir itself
      }
    } catch {
      // It's a file — get size from meta
    }

    if (entryType === "file") {
      const meta = await readMeta(dirHandle);
      const child = meta.children[name];
      usageDelta = { totalSize: child?.size ?? 0, fileCount: 1, directoryCount: 0 };
    }

    try {
      await dirHandle.removeEntry(name, { recursive: options?.recursive });
    } catch {
      if (options?.force) return;
      throw new NotFoundError(path);
    }

    let removedEntry: FileEntry | undefined;
    await withMetaLock(dirAbs, async () => {
      const meta = await readMeta(dirHandle);
      const child = meta.children[name];
      if (child) {
        removedEntry = toFileEntry(name, child);
        delete meta.children[name];
        await writeMeta(dirHandle, meta);
      }
    });

    await updateUsage(this.root.dirHandle, {
      totalSize: -usageDelta.totalSize,
      fileCount: -usageDelta.fileCount,
      directoryCount: -usageDelta.directoryCount,
    });

    // If not tracked in .meta, synthesize an entry for the watch event
    if (!removedEntry) {
      const now = Date.now();
      removedEntry = {
        name,
        type: entryType,
        size: 0,
        ctime: now,
        mtime: now,
        meta: {},
      };
    }

    this.root.notifySubscribers(dirAbs, [
      {
        type: "delete",
        entry: removedEntry,
        name,
        path: abs,
      },
    ]);
  }

  async exists(path: string): Promise<boolean> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    if (!name) {
      // Check if root dir exists
      try {
        await getDirHandle(this.root.dirHandle, abs);
        return true;
      } catch {
        return false;
      }
    }

    try {
      const dirHandle = await getDirHandle(this.root.dirHandle, dirAbs);
      // Try file first, then directory
      try {
        await dirHandle.getFileHandle(name);
        return true;
      } catch {
        await dirHandle.getDirectoryHandle(name);
        return true;
      }
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    if (!name) return; // root already exists

    if (options?.recursive) {
      // Create all intermediate directories
      const segments = abs.split("/").filter(Boolean);
      let current = this.root.dirHandle;
      let currentPath = "";

      for (const seg of segments) {
        const parentPath = currentPath || "/";
        currentPath += `/${seg}`;
        const parentHandle = current;
        current = await current.getDirectoryHandle(seg, { create: true });

        // Ensure meta for this new dir
        let created = false;
        const now = Date.now();
        await withMetaLock(parentPath, async () => {
          const meta = await readMeta(parentHandle);
          if (!meta.children[seg]) {
            created = true;
            meta.children[seg] = {
              type: "directory",
              ctime: now,
              mtime: now,
              meta: {},
            };
            await writeMeta(parentHandle, meta);
          }
        });

        if (created) {
          await updateUsage(this.root.dirHandle, { directoryCount: 1 });
          this.root.notifySubscribers(parentPath, [
            {
              type: "create",
              entry: {
                name: seg,
                type: "directory",
                size: 0,
                ctime: now,
                mtime: now,
                meta: {},
              },
              name: seg,
              path: currentPath,
            },
          ]);
        }
      }
    } else {
      await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");
      const dirHandle = await getDirHandle(this.root.dirHandle, dirAbs);

      // Check if already exists
      try {
        await dirHandle.getDirectoryHandle(name);
        throw new ExistsError(path);
      } catch (err) {
        if (err instanceof ExistsError) throw err;
      }

      await dirHandle.getDirectoryHandle(name, { create: true });

      const now = Date.now();
      await withMetaLock(dirAbs, async () => {
        const meta = await readMeta(dirHandle);
        meta.children[name] = {
          type: "directory",
          ctime: now,
          mtime: now,
          meta: {},
        };
        await writeMeta(dirHandle, meta);
      });

      await updateUsage(this.root.dirHandle, { directoryCount: 1 });

      this.root.notifySubscribers(dirAbs, [
        {
          type: "create",
          entry: {
            name,
            type: "directory",
            size: 0,
            ctime: now,
            mtime: now,
            meta: {},
          },
          name,
          path: abs,
        },
      ]);
    }

    // Set custom permissions if provided
    if (options?.permissions) {
      const newDirHandle = await getDirHandle(this.root.dirHandle, abs);
      await withMetaLock(abs, async () => {
        const meta = await readMeta(newDirHandle);
        meta.permissions = {
          read: options.permissions?.read ?? meta.permissions.read,
          write: options.permissions?.write ?? meta.permissions.write,
        };
        await writeMeta(newDirHandle, meta);
      });
    }
  }

  async ls(path: string): Promise<FileEntry[]> {
    const abs = this.resolve(path);
    const dirHandle = await getDirHandleChecked(this.root.dirHandle, abs, "read");
    const meta = await readMeta(dirHandle);
    const entries: FileEntry[] = [];
    const seen = new Set<string>();

    // Entries tracked in .meta
    for (const [name, child] of Object.entries(meta.children)) {
      seen.add(name);
      entries.push(toFileEntry(name, child));
    }

    // OPFS entries not tracked in .meta (created externally)
    for await (const [name, handle] of dirHandle.entries()) {
      if (isMetaFile(name) || seen.has(name)) continue;
      const now = Date.now();
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        entries.push({
          name,
          type: "file",
          size: file.size,
          ctime: now,
          mtime: now,
          meta: {},
        });
      } else {
        entries.push({
          name,
          type: "directory",
          size: 0,
          ctime: now,
          mtime: now,
          meta: {},
        });
      }
    }

    return entries;
  }

  async readDir(path: string): Promise<string[]> {
    const abs = this.resolve(path);
    const dirHandle = await getDirHandleChecked(this.root.dirHandle, abs, "read");
    const names: string[] = [];

    for await (const [name] of dirHandle.entries()) {
      if (!isMetaFile(name)) names.push(name);
    }

    return names;
  }

  async stat(path: string): Promise<FileStat> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    if (!name) {
      // Stat root
      return {
        path: "/",
        name: "",
        type: "directory",
        size: 0,
        ctime: 0,
        mtime: 0,
        meta: {},
      };
    }

    const dirHandle = await getDirHandle(this.root.dirHandle, dirAbs);
    const meta = await readMeta(dirHandle);
    const child = meta.children[name];

    if (child) {
      return { path: abs, ...toFileEntry(name, child) };
    }

    // Fall back to OPFS directly for untracked entries
    try {
      const fileHandle = await dirHandle.getFileHandle(name);
      const file = await fileHandle.getFile();
      const now = Date.now();
      return {
        path: abs,
        name,
        type: "file",
        size: file.size,
        ctime: now,
        mtime: now,
        meta: {},
      };
    } catch {
      try {
        await dirHandle.getDirectoryHandle(name);
        const now = Date.now();
        return {
          path: abs,
          name,
          type: "directory",
          size: 0,
          ctime: now,
          mtime: now,
          meta: {},
        };
      } catch {
        throw new NotFoundError(path);
      }
    }
  }

  async setMeta(path: string, meta: Record<string, unknown>): Promise<void> {
    validateMetaSize(path, meta);
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");

    let entry!: FileEntry;
    await withMetaLock(dirAbs, async () => {
      const dirMeta = await readMeta(dirHandle);
      let child = dirMeta.children[name];
      if (!child) {
        // Entry exists in OPFS but not in .meta - bootstrap it
        try {
          const fileHandle = await dirHandle.getFileHandle(name);
          const file = await fileHandle.getFile();
          const now = Date.now();
          child = {
            type: "file",
            size: file.size,
            ctime: now,
            mtime: now,
            meta: {},
          };
          dirMeta.children[name] = child;
        } catch {
          try {
            await dirHandle.getDirectoryHandle(name);
            const now = Date.now();
            child = { type: "directory", ctime: now, mtime: now, meta: {} };
            dirMeta.children[name] = child;
          } catch {
            throw new NotFoundError(path);
          }
        }
      }
      child.meta = { ...child.meta, ...meta };
      child.mtime = Date.now();
      await writeMeta(dirHandle, dirMeta);
      entry = toFileEntry(name, child);
    });

    this.root.notifySubscribers(dirAbs, [
      { type: "update", entry, name, path: abs },
    ]);
  }

  async getMeta(path: string): Promise<Record<string, unknown>> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "read");
    const meta = await readMeta(dirHandle);
    const child = meta.children[name];
    if (!child) throw new NotFoundError(path);

    return child.meta;
  }

  async setPermissions(
    dirPath: string,
    permissions: Partial<Permissions>,
  ): Promise<void> {
    const abs = this.resolve(dirPath);
    const dirHandle = await getDirHandle(this.root.dirHandle, abs);

    await withMetaLock(abs, async () => {
      const meta = await readMeta(dirHandle);
      meta.permissions = {
        read: permissions.read ?? meta.permissions.read,
        write: permissions.write ?? meta.permissions.write,
      };
      await writeMeta(dirHandle, meta);
    });
  }

  async query(
    dirPath: string,
    filter: (entry: FileEntry) => boolean,
  ): Promise<FileEntry[]> {
    const abs = this.resolve(dirPath);
    const dirHandle = await getDirHandleChecked(this.root.dirHandle, abs, "read");
    const meta = await readMeta(dirHandle);
    const results: FileEntry[] = [];

    for (const [name, child] of Object.entries(meta.children)) {
      const entry = toFileEntry(name, child);
      if (filter(entry)) results.push(entry);
    }

    return results;
  }

  async utimes(path: string, mtime: Date): Promise<void> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");

    await withMetaLock(dirAbs, async () => {
      const meta = await readMeta(dirHandle);
      const child = meta.children[name];
      if (!child) throw new NotFoundError(path);
      child.mtime = mtime.getTime();
      await writeMeta(dirHandle, meta);
    });
  }

  async createReadStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    await getDirHandleChecked(this.root.dirHandle, dirAbs, "read");

    try {
      const fileHandle = await getFileHandle(this.root.dirHandle, abs);
      const file = await fileHandle.getFile();
      return file.stream();
    } catch {
      throw new NotFoundError(path);
    }
  }

  async createWriteStream(
    path: string,
    options?: WriteStreamOptions,
  ): Promise<TrackedWritableStream> {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    const dirHandle = await getDirHandleChecked(this.root.dirHandle, dirAbs, "write");

    // Check if file already exists to determine create vs update
    let isNew = true;
    try {
      await dirHandle.getFileHandle(name);
      isNew = false;
    } catch {
      // file doesn't exist yet
    }

    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();

    return new TrackedWritableStream(
      writable,
      this.root,
      dirHandle,
      dirAbs,
      name,
      abs,
      isNew,
      options?.meta ?? {},
    );
  }

  watch(
    dirPath: string,
    callback: (events: WatchEvent[]) => void,
  ): Unsubscribe {
    const abs = this.resolve(dirPath);
    return this.root.addSubscriber(abs, callback);
  }

  watchFile(path: string, callback: (event: WatchEvent) => void): Unsubscribe {
    const abs = this.resolve(path);
    const dirAbs = parentPath(abs);
    const name = basename(abs);

    return this.root.addSubscriber(dirAbs, (events) => {
      for (const event of events) {
        if (event.name === name) {
          callback(event);
        }
      }
    });
  }
}

/** Recursively compute files/dirs/size within a directory (not counting the dir itself). */
async function walkSubtreeUsage(
  dirHandle: FileSystemDirectoryHandle,
): Promise<{ totalSize: number; fileCount: number; directoryCount: number }> {
  let totalSize = 0;
  let fileCount = 0;
  let directoryCount = 0;

  for await (const [name, handle] of dirHandle.entries()) {
    if (isMetaFile(name)) continue;
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      totalSize += file.size;
      fileCount++;
    } else {
      directoryCount++;
      const sub = await walkSubtreeUsage(handle as FileSystemDirectoryHandle);
      totalSize += sub.totalSize;
      fileCount += sub.fileCount;
      directoryCount += sub.directoryCount;
    }
  }

  return { totalSize, fileCount, directoryCount };
}
