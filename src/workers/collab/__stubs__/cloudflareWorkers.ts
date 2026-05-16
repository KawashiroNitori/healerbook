/**
 * Node テスト環境用 cloudflare:workers スタブ。
 * vitest.config.ts の alias で使用。DO クラスをテストしない node 環境で
 * import { DurableObject } from 'cloudflare:workers' が解決できるようにする。
 */
export class DurableObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  constructor(_ctx: any, _env: any) {}
}

export class WorkerEntrypoint {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  constructor(_ctx: any, _env: any) {}
}

export class RpcTarget {}
