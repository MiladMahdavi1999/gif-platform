export * from './uploads.js';
export async function checkObjectStore(endpoint: string): Promise<void> {
  const response = await fetch(new URL('/minio/health/ready', endpoint), {
    signal: AbortSignal.timeout(1500),
    redirect: 'error',
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Object store is unavailable');
}
export * from './processing.js';
