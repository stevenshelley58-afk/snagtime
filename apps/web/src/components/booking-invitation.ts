const MAX_INVITATION_LENGTH = 512;

export function bookingInvitationFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("invitation")?.trim() || "";
  return value.length > 0 && value.length <= MAX_INVITATION_LENGTH ? value : "";
}
