import { UserProfile, InternalUser } from '../models/UserProfile';

export class ProfileMapper {
  toInternal(profile: UserProfile): InternalUser {
    const { id, name, email } = profile;
    return { id, name, email, avatarUrl: undefined as unknown as string };
  }

  toPublic(internal: InternalUser): Omit<InternalUser, 'id'> {
    const { name, email, avatarUrl } = internal;
    return { name, email, avatarUrl };
  }
}
