import { api } from '@app/common';

import type { LoginRequest, RegisterRequest } from '../../../shared/auth';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

interface GetMeResponse {
  user: User | null;
}

interface LoginResponse {
  user: User;
}

interface RegisterResponse {
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

  async register(payload: RegisterRequest): Promise<User> {
    const { data } = await api.post<RegisterResponse>('/auth/register', payload);
    this.currentUser = data.user;
    return data.user;
  }

  logout(): void {
    window.location.href = '/auth/logout';
  }
}
