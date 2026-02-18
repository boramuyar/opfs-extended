import { describe, it, expect } from 'vitest'
import {
  FSError,
  NotFoundError,
  ExistsError,
  PermissionError,
  NotDirectoryError,
  NotFileError,
  MetadataSizeError,
} from './errors.ts'

describe('error hierarchy', () => {
  it('all errors extend FSError', () => {
    expect(new NotFoundError('/x')).toBeInstanceOf(FSError)
    expect(new ExistsError('/x')).toBeInstanceOf(FSError)
    expect(new PermissionError('/x', 'read')).toBeInstanceOf(FSError)
    expect(new NotDirectoryError('/x')).toBeInstanceOf(FSError)
    expect(new NotFileError('/x')).toBeInstanceOf(FSError)
    expect(new MetadataSizeError('/x')).toBeInstanceOf(FSError)
  })

  it('all errors extend Error', () => {
    expect(new NotFoundError('/x')).toBeInstanceOf(Error)
  })

  it('stores path', () => {
    const err = new NotFoundError('/foo/bar')
    expect(err.path).toBe('/foo/bar')
  })

  it('has descriptive messages', () => {
    expect(new NotFoundError('/x').message).toContain('/x')
    expect(new PermissionError('/x', 'write').message).toContain('write')
  })

  it('has correct name properties', () => {
    expect(new NotFoundError('/x').name).toBe('NotFoundError')
    expect(new ExistsError('/x').name).toBe('ExistsError')
    expect(new MetadataSizeError('/x').name).toBe('MetadataSizeError')
  })
})
