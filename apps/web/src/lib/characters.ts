import deanAvatar from '../assets/avatars/dean.png';
import fortTiconderogaAvatar from '../assets/avatars/fort-ticonderoga.png';
import jayAvatar from '../assets/avatars/jay.png';
import lilliAvatar from '../assets/avatars/lilli.png';
import mikeAvatar from '../assets/avatars/mike.png';
import quillAvatar from '../assets/avatars/quill.png';
import robAvatar from '../assets/avatars/rob.png';

export type CharacterProfile = {
  key: string;
  name: string;
  avatar: string;
};

export const CHARACTER_PROFILES: CharacterProfile[] = [
  { key: 'jay', name: 'Jay', avatar: jayAvatar },
  { key: 'mike', name: 'Mike', avatar: mikeAvatar },
  { key: 'lilli', name: 'Lilli', avatar: lilliAvatar },
  { key: 'dean', name: 'Dean', avatar: deanAvatar },
  { key: 'rob', name: 'Rob', avatar: robAvatar },
  { key: 'fort-ticonderoga', name: 'Fort Ticonderoga', avatar: fortTiconderogaAvatar },
  { key: 'quill', name: 'Quill', avatar: quillAvatar },
];

export const DEFAULT_CHARACTER_KEY = CHARACTER_PROFILES[0]?.key ?? 'lilli';

export function getCharacterProfileByKey(key: string | null | undefined): CharacterProfile | null {
  if (!key) {
    return null;
  }

  return CHARACTER_PROFILES.find((profile) => profile.key === key) ?? null;
}
