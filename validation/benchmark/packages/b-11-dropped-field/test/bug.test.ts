import { describe, it, expect } from 'vitest';
import { ProfileService } from '../src/services/ProfileService';
import { ExternalMapper } from '../src/mappers/ExternalMapper';

describe('B-11 ProfileMapper — avatarUrl dropped in toInternal()', () => {
  it('fetchById should return a user with avatarUrl populated', async () => {
    const service = new ProfileService();
    const user = await service.fetchById('user-1');
    expect(user.avatarUrl).toBe('https://cdn.example.com/avatars/ada.jpg');
  });

  it('ExternalMapper correctly maps avatar_url (proving field exists after step 1)', () => {
    const mapper = new ExternalMapper();
    const profile = mapper.toProfile({
      user_id: 'u1',
      display_name: 'Ada',
      email_address: 'ada@example.com',
      avatar_url: 'https://cdn.example.com/avatars/ada.jpg',
      created_at: '2024-01-15T09:00:00Z',
      plan: 'pro',
    });
    expect(profile.avatarUrl).toBe('https://cdn.example.com/avatars/ada.jpg');
  });

  it('avatarUrl is defined and a valid string — not undefined', async () => {
    const service = new ProfileService();
    const user = await service.fetchById('user-2');
    expect(user.avatarUrl).toBeDefined();
    expect(typeof user.avatarUrl).toBe('string');
    expect(user.avatarUrl.length).toBeGreaterThan(0);
  });
});
