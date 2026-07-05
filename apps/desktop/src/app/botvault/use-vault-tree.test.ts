import { describe, expect, it } from 'vitest'

import type { TreeNode } from '../right-sidebar/files/use-project-tree'

import { mergeEntries, patchNode } from './use-vault-tree'

const node = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id,
  isDirectory: false,
  name: id.split('/').pop() ?? id,
  ...over
})

describe('patchNode', () => {
  it('patches a top-level node', () => {
    const out = patchNode([node('/v/a'), node('/v/b')], '/v/b', n => ({ ...n, loading: true }))

    expect(out[1].loading).toBe(true)
    expect(out[0].loading).toBeUndefined()
  })

  it('patches a nested node through loaded children', () => {
    const tree = [node('/v/dir', { isDirectory: true, children: [node('/v/dir/x')] })]
    const out = patchNode(tree, '/v/dir/x', n => ({ ...n, error: 'EACCES' }))

    expect(out[0].children?.[0].error).toBe('EACCES')
  })
})

describe('mergeEntries', () => {
  it('keeps loaded subtrees for surviving entries, adds new, drops deleted', () => {
    const existing = [
      node('/v/keep', { isDirectory: true, children: [node('/v/keep/child')] }),
      node('/v/gone')
    ]

    const out = mergeEntries(existing, [
      { path: '/v/keep', name: 'keep', isDirectory: true },
      { path: '/v/new', name: 'new', isDirectory: false }
    ])

    expect(out.map(n => n.id)).toEqual(['/v/keep', '/v/new'])
    expect(out[0].children?.[0].id).toBe('/v/keep/child')
  })

  it('ignores placeholder rows when matching', () => {
    const existing = [node('/v/dir::__loading__', { placeholder: 'loading' })]
    const out = mergeEntries(existing, [{ path: '/v/dir', name: 'dir', isDirectory: true }])

    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('/v/dir')
    expect(out[0].placeholder).toBeUndefined()
  })

  it('orders by the fresh read, not the stale tree', () => {
    const existing = [node('/v/b'), node('/v/a')]

    const out = mergeEntries(existing, [
      { path: '/v/a', name: 'a', isDirectory: false },
      { path: '/v/b', name: 'b', isDirectory: false }
    ])

    expect(out.map(n => n.id)).toEqual(['/v/a', '/v/b'])
  })
})
