import Link from 'next/link';
export default function NotFound() {
  return (
    <main>
      <h1>GIF unavailable</h1>
      <p>This GIF is unavailable or does not exist.</p>
      <Link href="/">Browse GIFs</Link>
    </main>
  );
}
