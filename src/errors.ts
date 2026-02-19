/** Base error for all filesystem operations. */
export class FSError extends Error {
  readonly path: string

  constructor(message: string, path: string) {
    super(message)
    this.name = 'FSError'
    this.path = path
  }
}

/** Path does not exist. */
export class NotFoundError extends FSError {
  constructor(path: string) {
    super(`Not found: ${path}`, path)
    this.name = 'NotFoundError'
  }
}

/** Path already exists (e.g. mkdir without recursive). */
export class ExistsError extends FSError {
  constructor(path: string) {
    super(`Already exists: ${path}`, path)
    this.name = 'ExistsError'
  }
}

/** Operation violates folder permissions. */
export class PermissionError extends FSError {
  constructor(path: string, operation: string) {
    super(`Permission denied: ${operation} on ${path}`, path)
    this.name = 'PermissionError'
  }
}

/** User metadata exceeds 64KB limit. */
export class MetadataSizeError extends FSError {
  constructor(path: string) {
    super(`Metadata exceeds 64KB limit: ${path}`, path)
    this.name = 'MetadataSizeError'
  }
}
