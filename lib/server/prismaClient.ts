let prismaSingleton: any = null;

export function getPrismaClient(): any {
  if (prismaSingleton) return prismaSingleton;
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'file:./.runtime/interviewbot.db';
  }
  // Avoid hard TypeScript module dependency if client is not generated yet.
  const { PrismaClient } = require('@prisma/client');
  prismaSingleton = new PrismaClient();
  return prismaSingleton;
}
