/**
 * Minimal typings for Node's experimental `node:sqlite` (DatabaseSync).
 * Kept local so typecheck does not depend on a full `@types/node` swap
 * before Stage 4 of the Node migration.
 */
declare module "node:sqlite" {
  export interface StatementResultingChanges {
    readonly changes: number
    readonly lastInsertRowid: number | bigint
  }

  export class StatementSync {
    run(...params: Array<unknown>): StatementResultingChanges
    get(...params: Array<unknown>): unknown
    all(...params: Array<unknown>): Array<unknown>
  }

  export class DatabaseSync {
    constructor(
      path: string,
      options?: {
        readonly readOnly?: boolean
        readonly enableForeignKeys?: boolean
      }
    )
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
