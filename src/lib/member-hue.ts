// Stable avatar colour for API members (no hue column): the same 13-slot hash UserAvatar uses, as a class
// suffix (.av.c0..c12), so a member keeps one colour everywhere and the palette is not 5 shades of blue.
import { avatarSlot, initialsOf as initialsFromName } from '@/lib/ui/avatar';

export type Hue = string;
export const hueFor = (id: string): Hue => `c${avatarSlot(id)}`;

/** First + last name initials ("Maya Chen" -> "MC"; one word -> its first two letters). */
export const initialsOf = initialsFromName;
