import { describe, it, expect } from 'vitest'
import { normalizePath, resolvePath, parentPath, basename, joinPath, isMetaFile } from './path.ts'

describe('normalizePath', () => {
  it('returns / for empty string', () => {
    expect(normalizePath('')).toBe('/')
  })

  it('ensures leading slash', () => {
    expect(normalizePath('foo/bar')).toBe('/foo/bar')
  })

  it('strips trailing slash', () => {
    expect(normalizePath('/foo/bar/')).toBe('/foo/bar')
  })

  it('resolves . segments', () => {
    expect(normalizePath('/foo/./bar')).toBe('/foo/bar')
  })

  it('resolves .. segments', () => {
    expect(normalizePath('/foo/bar/../baz')).toBe('/foo/baz')
  })

  it('clamps .. at root', () => {
    expect(normalizePath('/foo/../../bar')).toBe('/bar')
  })

  it('resolves multiple consecutive slashes', () => {
    expect(normalizePath('//foo///bar')).toBe('/foo/bar')
  })
})

describe('resolvePath', () => {
  it('resolves absolute path relative to mount', () => {
    expect(resolvePath('/mnt', '/file.txt')).toBe('/mnt/file.txt')
  })

  it('resolves relative path', () => {
    expect(resolvePath('/mnt', 'sub/file.txt')).toBe('/mnt/sub/file.txt')
  })

  it('clamps .. at mount root', () => {
    expect(resolvePath('/mnt', '../../escape.txt')).toBe('/mnt/escape.txt')
  })

  it('resolves .. within mount scope', () => {
    expect(resolvePath('/mnt', '/sub/../file.txt')).toBe('/mnt/file.txt')
  })

  it('handles root mount', () => {
    expect(resolvePath('/', '/file.txt')).toBe('/file.txt')
  })
})

describe('parentPath', () => {
  it('returns / for root-level paths', () => {
    expect(parentPath('/foo')).toBe('/')
  })

  it('returns parent directory', () => {
    expect(parentPath('/foo/bar/baz')).toBe('/foo/bar')
  })

  it('returns / for /', () => {
    expect(parentPath('/')).toBe('/')
  })
})

describe('basename', () => {
  it('returns filename', () => {
    expect(basename('/foo/bar.txt')).toBe('bar.txt')
  })

  it('returns directory name', () => {
    expect(basename('/foo/bar')).toBe('bar')
  })

  it('returns empty for root', () => {
    expect(basename('/')).toBe('')
  })
})

describe('joinPath', () => {
  it('joins segments', () => {
    expect(joinPath('/foo', 'bar', 'baz')).toBe('/foo/bar/baz')
  })

  it('normalizes result', () => {
    expect(joinPath('/foo/', '../bar')).toBe('/bar')
  })
})

describe('isMetaFile', () => {
  it('returns true for .meta', () => {
    expect(isMetaFile('.meta')).toBe(true)
  })

  it('returns false for other names', () => {
    expect(isMetaFile('file.txt')).toBe(false)
    expect(isMetaFile('.metadata')).toBe(false)
  })
})
