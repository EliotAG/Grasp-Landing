import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma client. In dev, Next.js HMR can re-import this module
 * many times — caching on `globalThis` prevents the connection-pool
 * exhaustion that otherwise plagues hot-reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
