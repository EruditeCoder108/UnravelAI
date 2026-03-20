
Root Cause
The bug is in ProfileMapper.toInternal():
tstoInternal(profile: UserProfile): InternalUser {
  const { id, name, email } = profile;  // avatarUrl is destructured out and discarded
  return { id, name, email, avatarUrl: undefined as unknown as string };
}
avatarUrl is present on the UserProfile passed in but is simply never included in the destructuring. The undefined as unknown as string is a type-cast hack to satisfy TypeScript's InternalUser interface while knowingly setting the field to undefined at runtime. The display layer, ProfileService, ExternalMapper, and the interfaces are all fine.
The fix is one line:
tstoInternal(profile: UserProfile): InternalUser {
  const { id, name, email, avatarUrl } = profile;
  return { id, name, email, avatarUrl };
}