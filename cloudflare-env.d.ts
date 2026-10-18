declare namespace Cloudflare {
  interface Env {
    ENABLE_DEV_TOOLS?: string;
    DB?: D1Database;
    ROOMS?: DurableObjectNamespace;
    BUCKET?: R2Bucket;
  }
}
