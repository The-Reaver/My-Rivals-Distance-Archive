/** Mirrors change_followed_character()'s own 30-day cooldown rule (0010)
 * for server-rendered eligibility checks -- the database is still the
 * real enforcement point (this is a UI convenience, not a security
 * boundary, same posture as every other RLS-backed page in this app). */

const COOLDOWN_DAYS = 30;

export function computeFollowEligibility({
  followedCharacterId,
  createdAt,
  lastChangedAt,
}: {
  followedCharacterId: string | null;
  createdAt: string;
  lastChangedAt: string | null;
}): { eligible: boolean; nextEligibleAt: Date | null } {
  // No existing follow -- a first-ever pick is always free, nothing to
  // "reconsider" yet.
  if (!followedCharacterId) {
    return { eligible: true, nextEligibleAt: null };
  }

  const anchor = new Date(lastChangedAt ?? createdAt);
  const nextEligibleAt = new Date(anchor.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  return { eligible: nextEligibleAt.getTime() <= Date.now(), nextEligibleAt };
}
