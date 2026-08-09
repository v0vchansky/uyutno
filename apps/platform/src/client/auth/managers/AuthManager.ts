export interface User {
  id: string;
  email: string;
}

export class AuthManager {
  async getCurrentUser(): Promise<User | null> {
    return null;
  }
}
