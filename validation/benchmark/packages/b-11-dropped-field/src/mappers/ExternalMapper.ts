import { ExternalApiUser, UserProfile } from '../models/UserProfile';

export class ExternalMapper {
  toProfile(raw: ExternalApiUser): UserProfile {
    return {
      id: raw.user_id,
      name: raw.display_name,
      email: raw.email_address,
      avatarUrl: raw.avatar_url,
      plan: raw.plan,
    };
  }
}
