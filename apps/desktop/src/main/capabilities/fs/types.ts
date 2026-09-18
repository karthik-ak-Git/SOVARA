// @sovara/capability-fs — workspace file operations, like harness packages/fs/tool-fs

export interface FsReadArgs { path: string }
export interface FsListArgs { path?: string }
export interface FsWriteArgs { path: string; content: string }
