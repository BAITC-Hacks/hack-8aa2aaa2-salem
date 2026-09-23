declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    EKT_API_USER?: string;
    EKT_API_PASSWORD?: string;
    EKT_LOCAL_API_BASE?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  }
}
