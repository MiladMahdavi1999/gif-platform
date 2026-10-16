import { AssetReceipts } from '../receipts';
export default async function AssetPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  return (
    <>
      <h1>Private upload receipt</h1>
      <AssetReceipts assetId={assetId} />
    </>
  );
}
