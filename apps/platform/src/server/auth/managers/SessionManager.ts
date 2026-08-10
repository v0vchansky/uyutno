import type { SessionRow, SessionsRepository } from '../repositories/sessionsRepository';
import { SESSION_TTL_MS } from '../lib/cookies';
import { generateSessionId } from '../lib/sessionId';

export class SessionManager {
  constructor(private readonly sessionsRepository: SessionsRepository) {}

  async issueSession(userId: string): Promise<SessionRow> {
    const now = new Date();
    return this.sessionsRepository.create({
      id: generateSessionId(),
      userId,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
  }

  async readSession(sessionId: string): Promise<SessionRow | null> {
    const session = await this.sessionsRepository.findById(sessionId);
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionsRepository.deleteById(sessionId);
      return null;
    }
    return session;
  }

  async touchSession(sessionId: string): Promise<Date> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.sessionsRepository.touch(sessionId, { lastActivityAt: now, expiresAt });
    return expiresAt;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessionsRepository.deleteById(sessionId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessionsRepository.deleteByUserId(userId);
  }
}
