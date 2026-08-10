import type { Kysely } from 'kysely';
import { uuidv7 } from 'uuidv7';

import type { Database } from '@server/postgres';

import type { OAuthProviderId } from '../oauth/OAuthProvider';

export interface OAuthAccountRow {
  id: string;
  userId: string;
  provider: OAuthProviderId;
  providerUserId: string;
  createdAt: Date;
}

const mapRow = (row: {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  created_at: Date;
}): OAuthAccountRow => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider as OAuthProviderId,
  providerUserId: row.provider_user_id,
  createdAt: row.created_at,
});

export class OAuthAccountsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findByProviderUser(params: {
    provider: OAuthProviderId;
    providerUserId: string;
  }): Promise<OAuthAccountRow | null> {
    const row = await this.db
      .selectFrom('oauth_accounts')
      .selectAll()
      .where('provider', '=', params.provider)
      .where('provider_user_id', '=', params.providerUserId)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async create(params: {
    userId: string;
    provider: OAuthProviderId;
    providerUserId: string;
  }): Promise<OAuthAccountRow> {
    const row = await this.db
      .insertInto('oauth_accounts')
      .values({
        id: uuidv7(),
        user_id: params.userId,
        provider: params.provider,
        provider_user_id: params.providerUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapRow(row);
  }
}
