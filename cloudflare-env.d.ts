declare namespace Cloudflare {
  interface Env {
    ENABLE_DEV_TOOLS?: string;
    DB?: D1Database;
    ROOM_ADMISSION?: RateLimit;
    ROOM_SOCKET_ADMISSION?: RateLimit;
    ROOMS?: DurableObjectNamespace;
    BUCKET?: R2Bucket;
  }
}
