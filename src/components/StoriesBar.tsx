import Link from 'next/link';
import { Avatar } from './Avatar';
import type { StoryGroup } from '@/lib/stories';

/** Faixa de Momentos no topo da comunidade: "Seu momento" e quem tem momentos no ar (anel coral = ainda não viu). */
export function StoriesBar({ groups, loggedIn }: { groups: StoryGroup[]; loggedIn: boolean }) {
  const mine = groups.find((g) => g.mine);
  const others = groups.filter((g) => !g.mine);
  const create = loggedIn ? '/momentos/novo' : `/entrar?motivo=momento&next=${encodeURIComponent('/momentos/novo')}`;
  return (
    <nav aria-label="Momentos de hoje" className="stories" data-testid="stories-bar">
      <Link href={mine ? `/momentos/${mine.authorId}` : create} className="story" data-testid="story-mine">
        <span className={`story-ring${mine ? ' seen' : ' add'}`}>
          {mine ? <Avatar src={mine.avatar} name={mine.name} size={60} round /> : <span className="story-plus" aria-hidden="true">+</span>}
        </span>
        <span className="story-name">{mine ? 'Você' : 'Criar'}</span>
      </Link>
      {mine && (
        <Link href={create} className="story" aria-label="Publicar outro momento">
          <span className="story-ring add"><span className="story-plus" aria-hidden="true">+</span></span>
          <span className="story-name">Mais um</span>
        </Link>
      )}
      {others.map((g) => (
        <Link key={g.authorId} href={`/momentos/${g.authorId}`} className="story" data-testid="story-author"
          aria-label={`Momentos de ${g.name}${g.allSeen ? '' : ', novos'}`}>
          <span className={`story-ring${g.allSeen ? ' seen' : ''}`}><Avatar src={g.avatar} name={g.name} size={60} round /></span>
          <span className="story-name">{g.name.split(' ')[0]}</span>
        </Link>
      ))}
    </nav>
  );
}
