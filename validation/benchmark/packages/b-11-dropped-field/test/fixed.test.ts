/**
 * Fix: src/mappers/ProfileMapper.ts
 *
 * BEFORE:
 *   const { id, name, email } = profile;
 *   return { id, name, email, avatarUrl: undefined as unknown as string };
 *
 * AFTER:
 *   const { id, name, email, avatarUrl } = profile;
 *   return { id, name, email, avatarUrl };
 */

import { describe, it, expect } from 'vitest';
import { UserProfile, InternalUser } from '../src/models/UserProfile';

class FixedProfileMapper {
  toInternal(profile: UserProfile): InternalUser {
    const { id, name, email, avatarUrl } = profile;
    return { id, name, email, avatarUrl };
  }
}

const SAMPLE: UserProfile = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  avatarUrl: 'https://cdn.example.com/avatars/ada.jpg',
  plan: 'pro',
};

describe('B-11 ProfileMapper — fixed', () => {
  it('preserves avatarUrl through toInternal()', () => {
    const mapper = new FixedProfileMapper();
    const result = mapper.toInternal(SAMPLE);
    expect(result.avatarUrl).toBe('https://cdn.example.com/avatars/ada.jpg');
  });

  it('preserves all other fields unchanged', () => {
    const mapper = new FixedProfileMapper();
    const result = mapper.toInternal(SAMPLE);
    expect(result.id).toBe('u1');
    expect(result.name).toBe('Ada Lovelace');
    expect(result.email).toBe('ada@example.com');
  });

  it('toInternal produces no undefined fields', () => {
    const mapper = new FixedProfileMapper();
    const result = mapper.toInternal(SAMPLE);
    for (const [key, value] of Object.entries(result)) {
      expect(value, `Field ${key} should not be undefined`).toBeDefined();
    }
  });
});
