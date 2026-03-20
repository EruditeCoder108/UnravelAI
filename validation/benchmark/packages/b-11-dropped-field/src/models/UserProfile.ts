export interface ExternalApiUser {
  user_id: string;
  display_name: string;
  email_address: string;
  avatar_url: string;
  created_at: string;
  plan: 'free' | 'pro' | 'enterprise';
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  plan: 'free' | 'pro' | 'enterprise';
}

export interface InternalUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
}
