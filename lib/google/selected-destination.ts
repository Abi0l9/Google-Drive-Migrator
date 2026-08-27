export interface AuthorizedDestinationItem {
  id: string;
  parentId: string;
  name: string;
  mimeType: string;
  size?: number | null;
}

interface DriveMetadataResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
}

export async function getAuthorizedDestinationItem(
  accessToken: string,
  fileId: string,
): Promise<AuthorizedDestinationItem> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,parents");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Unable to verify already-copied Drive item (${response.status})`);
  }

  const item = await response.json() as DriveMetadataResponse;
  const id = item.id?.trim();
  const name = item.name?.trim();
  const mimeType = item.mimeType?.trim();
  const parentId = item.parents?.[0]?.trim();
  if (!id || !name || !mimeType || !parentId) {
    throw new Error("An already-copied Drive item is missing required metadata");
  }

  return {
    id,
    parentId,
    name,
    mimeType,
    size: item.size == null ? null : Math.max(0, Number(item.size) || 0),
  };
}
