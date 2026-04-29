declare module "cloudflare:test" {
  export function runInDurableObject<O, R>(
    stub: DurableObjectStub,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}

declare module "cloudflare:workers" {
  export const env: import("../src/api/config/env").Env;
}
