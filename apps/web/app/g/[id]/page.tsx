import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicMedia } from '../../public-media';
import { getPublicGif } from './data';
import { ShareLink } from './share-link';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const gif = await getPublicGif(id);
    if (!gif)
      return {
        title: 'GIF unavailable',
        robots: { index: false, follow: false },
      };
    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080';
    const canonical = `${base}/g/${gif.id}`;
    return {
      title: `${gif.title} | GIF Platform`,
      description:
        gif.description || `${gif.title} — GIF by ${gif.attribution}`,
      robots: { index: true, follow: true },
      alternates: { canonical },
      openGraph: {
        title: gif.title,
        description: gif.description || gif.title,
        url: canonical,
        type: 'website',
        images: [{ url: `${base}${gif.posterUrl}`, alt: gif.title }],
      },
      twitter: {
        card: 'summary_large_image',
        title: gif.title,
        images: [`${base}${gif.posterUrl}`],
      },
    };
  } catch {
    return {
      title: 'GIF service unavailable',
      robots: { index: false, follow: false },
    };
  }
}
export default async function GifDetail({ params }: Props) {
  const gif = await getPublicGif((await params).id);
  if (!gif) notFound();
  return (
    <main className="public-page">
      <Link href="/">← Browse GIFs</Link>
      <h1>{gif.title}</h1>
      <PublicMedia
        key={gif.id}
        gif={gif}
        playback
        description={gif.description}
      />
      {gif.description && <p>{gif.description}</p>}
      <p>By {gif.attribution}</p>
      <ul className="tags" aria-label="Tags">
        {gif.tags.map((tag) => (
          <li key={tag}>
            <Link href={`/?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>
          </li>
        ))}
      </ul>
      <ShareLink />
    </main>
  );
}
