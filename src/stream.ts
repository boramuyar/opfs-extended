import type { Root } from "./root.ts";
import { readMeta, withMetaLock, writeMeta, validateMetaSize, updateUsage } from "./meta.ts";

/**
 * A writable stream that tracks bytes written and updates `.meta` on close.
 * Wraps a native `FileSystemWritableFileStream` from the OPFS API.
 */
export class TrackedWritableStream {
  private readonly inner: FileSystemWritableFileStream;
  private readonly root: Root;
  private readonly dirHandle: FileSystemDirectoryHandle;
  private readonly dirAbsPath: string;
  private readonly fileName: string;
  private readonly absPath: string;
  private readonly userMeta: Record<string, unknown>;
  private readonly _isNew: boolean;
  private bytesWritten = 0;

  constructor(
    inner: FileSystemWritableFileStream,
    root: Root,
    dirHandle: FileSystemDirectoryHandle,
    dirAbsPath: string,
    fileName: string,
    absPath: string,
    isNew: boolean,
    userMeta: Record<string, unknown>,
  ) {
    this.inner = inner;
    this.root = root;
    this.dirHandle = dirHandle;
    this.dirAbsPath = dirAbsPath;
    this.fileName = fileName;
    this.absPath = absPath;
    this._isNew = isNew;
    this.userMeta = userMeta;
  }

  /**
   * Write data to the stream.
   * Accepts string, ArrayBuffer, TypedArray, DataView, or Blob.
   */
  async write(
    data: FileSystemWriteChunkType,
  ): Promise<void> {
    await this.inner.write(data);
    this.bytesWritten += dataSize(data);
  }

  /**
   * Seek to a position in the file.
   */
  async seek(position: number): Promise<void> {
    await this.inner.seek(position);
  }

  /**
   * Truncate the file to the given size.
   */
  async truncate(size: number): Promise<void> {
    await this.inner.truncate(size);
  }

  /**
   * Close the stream and update directory metadata.
   * Must be called to finalize the write.
   */
  async close(): Promise<void> {
    await this.inner.close();
    await this.updateMeta();
  }

  /**
   * Abort the stream, discarding any written data.
   */
  async abort(reason?: string): Promise<void> {
    await this.inner.abort(reason);
  }

  private async updateMeta(): Promise<void> {
    if (Object.keys(this.userMeta).length > 0) {
      validateMetaSize(this.absPath, this.userMeta);
    }

    const now = Date.now();
    const isNew = this._isNew;
    const name = this.fileName;
    const dirAbs = this.dirAbsPath;
    const dirHandle = this.dirHandle;

    let entry!: {
      name: string;
      type: "file" | "directory";
      size: number;
      ctime: number;
      mtime: number;
      meta: Record<string, unknown>;
    };
    let sizeDelta = 0;

    await withMetaLock(dirAbs, async () => {
      const meta = await readMeta(dirHandle);
      const existing = meta.children[name];
      const oldSize = existing?.size ?? 0;
      sizeDelta = this.bytesWritten - oldSize;
      meta.children[name] = {
        type: "file",
        size: this.bytesWritten,
        ctime: existing?.ctime ?? now,
        mtime: now,
        meta: Object.keys(this.userMeta).length > 0 ? this.userMeta : (existing?.meta ?? {}),
      };
      await writeMeta(dirHandle, meta);
      const child = meta.children[name];
      entry = {
        name,
        type: child.type,
        size: child.size ?? 0,
        ctime: child.ctime,
        mtime: child.mtime,
        meta: child.meta,
      };
    });

    await updateUsage(this.root.dirHandle, {
      fileCount: isNew ? 1 : 0,
      totalSize: sizeDelta,
    });

    this.root.notifySubscribers(dirAbs, [
      {
        type: isNew ? "create" : "update",
        entry,
        name,
        path: this.absPath,
      },
    ]);
  }
}

/** Calculate byte size of writable data. */
function dataSize(data: FileSystemWriteChunkType): number {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Blob) return data.size;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  // WriteParams object — estimate from data field
  if (typeof data === "object" && data !== null && "data" in data) {
    return dataSize(data.data as FileSystemWriteChunkType);
  }
  return 0;
}
