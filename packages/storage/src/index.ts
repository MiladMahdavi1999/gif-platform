// B00 checks service health only; S3 object operations and buckets start in B03.
export async function checkObjectStore(endpoint: string): Promise<void> {
  const response = await fetch(new URL('/minio/health/ready', endpoint), {
    signal: AbortSignal.timeout(1500),
    redirect: 'error',
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Object store is unavailable');
}
