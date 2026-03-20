import { ExternalApiUser, InternalUser } from '../models/UserProfile';
import { ExternalMapper } from '../mappers/ExternalMapper';
import { ProfileMapper } from '../mappers/ProfileMapper';

export const fetchLog: string[] = [];

async function fetchFromApi(userId: string): Promise<ExternalApiUser> {
  fetchLog.push(userId);
  await new Promise<void>((r) => setTimeout(r, 5));
  return {
    user_id: userId,
    display_name: 'Ada Lovelace',
    email_address: 'ada@example.com',
    avatar_url: 'https://cdn.example.com/avatars/ada.jpg',
    created_at: '2024-01-15T09:00:00Z',
    plan: 'pro',
  };
}

export class ProfileService {
  private externalMapper = new ExternalMapper();
  private profileMapper = new ProfileMapper();

  async fetchById(userId: string): Promise<InternalUser> {
    const raw = await fetchFromApi(userId);
    const profile = this.externalMapper.toProfile(raw);
    return this.profileMapper.toInternal(profile);
  }
}
