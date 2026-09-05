import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  ART_AVATARS,
  ELEMENT_NAMES,
  SPIRIT_ROOT_QUALITY_NAMES,
  type AvatarArtId,
  type CharacterView,
  type Gender,
} from '@xianxia/shared';
import { api } from '../../api/endpoints';
import { errorMessage } from '../../api/http';
import { ArtImage } from '../../art/ArtImage';
import { Button, CloudRule, Field } from '../../design';
import { useCharacterStore } from '../../store/character';
import { useSessionStore } from '../../store/session';
import './auth.css';

const MALE_AVATARS = ART_AVATARS.filter((id) => id.startsWith('avatar/m'));
const FEMALE_AVATARS = ART_AVATARS.filter((id) => id.startsWith('avatar/f'));

const QUALITY_NOTE: Record<string, string> = {
  mortal: '资质寻常，然勤能补拙，大道从不薄待苦修之人。',
  rare: '异灵根，天生比旁人快上三成，路要走得稳。',
  heaven: '天灵根，百中无一。世人只见其快，不见其重。',
};

export function CreateCharacterPage() {
  const status = useSessionStore((state) => state.status);
  const characterId = useSessionStore((state) => state.user?.characterId ?? null);
  const markCharacterCreated = useSessionStore((state) => state.markCharacterCreated);
  const setView = useCharacterStore((state) => state.setView);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('male');
  const [avatar, setAvatar] = useState<AvatarArtId>('avatar/m01');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CharacterView | null>(null);

  const avatars = useMemo(
    () => (gender === 'male' ? MALE_AVATARS : FEMALE_AVATARS),
    [gender],
  );

  if (status === 'anon') return <Navigate to="/login" replace />;
  if (characterId && !created) return <Navigate to="/" replace />;

  const pickGender = (next: Gender) => {
    setGender(next);
    setAvatar(next === 'male' ? 'avatar/m01' : 'avatar/f01');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const view = await api.createCharacter({ name: name.trim(), avatarArt: avatar, gender });
      setView(view);
      markCharacterCreated(view.character.id);
      setCreated(view);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const root = created.character.spiritRoot;
    return (
      <div className="reveal">
        <p className="eyebrow">测得灵根</p>
        <div className="reveal__ring">
          <svg className="reveal__circle" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="48" transform="rotate(-90 50 50)" />
          </svg>
          <span className="reveal__element">{ELEMENT_NAMES[root.element]}</span>
        </div>
        <p className={`reveal__quality reveal__quality--${root.quality}`}>
          {SPIRIT_ROOT_QUALITY_NAMES[root.quality]}
        </p>
        <p className="reveal__note">{QUALITY_NOTE[root.quality]}</p>
        <div className="reveal__go">
          <Button variant="primary" onClick={() => navigate('/', { replace: true })}>
            入山门
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="create" onSubmit={submit}>
      <header className="page-head">
        <h1 className="page-head__title">结庐问道</h1>
        <p className="page-head__note">道号一旦立下，便随你一世。</p>
      </header>
      <CloudRule />

      <div className="create__body">
        <Field
          label="道号"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="二至十二字，汉字或字母"
          maxLength={12}
          required
        />

        <div>
          <span className="field__label">性别</span>
          <div className="gender">
            <Button
              variant={gender === 'male' ? 'primary' : 'ghost'}
              onClick={() => pickGender('male')}
            >
              男修
            </Button>
            <Button
              variant={gender === 'female' ? 'primary' : 'ghost'}
              onClick={() => pickGender('female')}
            >
              女修
            </Button>
          </div>
        </div>

        <div>
          <span className="field__label">形貌</span>
          <div className="avatars">
            {avatars.map((id) => (
              <button
                key={id}
                type="button"
                className={`avatar-pick ${avatar === id ? 'avatar-pick--on' : ''}`}
                aria-pressed={avatar === id}
                aria-label={`选用形貌 ${id.slice(-3)}`}
                onClick={() => setAvatar(id)}
              >
                <ArtImage id={id} label="" motif="portrait" />
              </button>
            ))}
          </div>
        </div>

        {error && <p className="login__error">{error}</p>}

        <Button variant="seal" block type="submit" disabled={busy || name.trim().length < 2}>
          {busy ? '测算中……' : '测灵根'}
        </Button>
        <p className="field__hint">灵根由天定，五行随机，品质凡七异二天一。</p>
      </div>
    </form>
  );
}
