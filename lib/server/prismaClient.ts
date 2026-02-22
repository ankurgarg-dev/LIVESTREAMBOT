let prismaSingleton: any = null;

export function isPrismaEnabled(): boolean {
  const backend = String(process.env.DATA_STORE_BACKEND || 'prisma').trim().toLowerCase();
  return backend !== 'file';
}

export function getPrismaClient(): any | null {
  if (!isPrismaEnabled()) return null;
  if (prismaSingleton) return prismaSingleton;
  try {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'file:./.runtime/interviewbot.db';
    }
    // Avoid hard TypeScript module dependency if client is not generated yet.
    const { PrismaClient } = require('@prisma/client');
    prismaSingleton = new PrismaClient();
    return prismaSingleton;
  } catch (error) {
    console.warn('[storage] Prisma unavailable, falling back to file store:', error);
    return null;
  }
}
