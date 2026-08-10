import { api } from '@app/common';

import type { LoginRequest } from '../../../shared/auth';

export interface User {
  id: string;
  email: string;
}

interface GetMeResponse {
  user: User | null;
}

interface LoginResponse {
  user: User;
}

export class AuthManager {
  private currentUser: User | null;

  constructor(initialUser: User | null = null) {
    this.currentUser = initialUser;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  async refresh(): Promise<User | null> {
    const { data } = await api.get<GetMeResponse>('/auth/me');
    this.currentUser = data.user;
    return this.currentUser;
  }

  async login(payload: LoginRequest): Promise<User> {
    const { data } = await api.post<LoginResponse>('/auth/login', payload);
    this.currentUser = data.user;
    return data.user;
  }

  async register(): Promise<never> {
    throw new Error('AuthManager.register: not implemented (task 0013)');
  }

  async logout(): Promise<never> {
    throw new Error('AuthManager.logout: not implemented (task 0012)');
  }
}
