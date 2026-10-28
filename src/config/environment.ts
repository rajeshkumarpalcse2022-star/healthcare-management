import "server-only";

/**
 * Centralised environment access.
 *
 * Values are read lazily so that importing this module never throws at build
 * time. Access `environment.mongodb.uri` only inside server-side code that
 * actually needs a database connection.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Add it to .env.local (see .env.example) and restart the server.`,
    );
  }
  return value;
}

export const environment = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV !== "production",
  mongodb: {
    /** Throws when MONGODB_URI is not configured. Server-side use only. */
    get uri(): string {
      return required("MONGODB_URI", process.env.MONGODB_URI);
    },
    /** Safe to call anywhere, never throws. */
    get isConfigured(): boolean {
      return Boolean(process.env.MONGODB_URI);
    },
  },
  auth: {
    /** Throws when AUTH_SECRET is not configured. Server-side use only. */
    get secret(): string {
      return required("AUTH_SECRET", process.env.AUTH_SECRET);
    },
    /**
     * Safe to call anywhere, never throws. Authentication code checks this
     * before touching the secret so a missing variable fails closed with a
     * clear log instead of an opaque crash.
     */
    get isConfigured(): boolean {
      return Boolean(process.env.AUTH_SECRET);
    },
  },
} as const;
