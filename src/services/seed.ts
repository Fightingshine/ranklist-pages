import { openDatabase, withTransaction } from "./db";

interface SeedBoard {
  id: number;
  name: string;
  sortOrder: number;
}

interface SeedTier {
  id: number;
  boardId: number;
  name: string;
  sortOrder: number;
}

interface SeedPhoto {
  id: number;
  itemId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  staticUrl?: string;
}

interface SeedItem {
  id: number;
  tierId: number;
  name: string;
  description: string;
  coverPhotoId: number | null;
  sortOrder: number;
  photos: SeedPhoto[];
}

interface SeedPayload {
  boards: SeedBoard[];
  tiers: SeedTier[];
  items: SeedItem[];
}

export async function checkAndSeedDatabase(): Promise<boolean> {
  const db = await openDatabase();

  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction("boards", "readonly");
    const store = tx.objectStore("boards");
    const countReq = store.count();
    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => reject(countReq.error);
  });

  if (count > 0) {
    return false; // Already seeded
  }

  try {
    const response = await fetch("./initial-data.json");
    if (!response.ok) {
      console.warn("Could not fetch initial-data.json:", response.statusText);
      return false;
    }

    const seed: SeedPayload = await response.json();

    await withTransaction(["boards", "tiers", "items", "photos"], "readwrite", (tx) => {
      const boardStore = tx.objectStore("boards");
      const tierStore = tx.objectStore("tiers");
      const itemStore = tx.objectStore("items");
      const photoStore = tx.objectStore("photos");

      for (const board of seed.boards) {
        boardStore.put(board);
      }

      for (const tier of seed.tiers) {
        tierStore.put(tier);
      }

      for (const item of seed.items) {
        const itemRecord = {
          id: item.id,
          tierId: item.tierId,
          name: item.name,
          description: item.description,
          coverPhotoId: item.coverPhotoId,
          sortOrder: item.sortOrder
        };
        itemStore.put(itemRecord);

        if (item.photos && Array.isArray(item.photos)) {
          for (const photo of item.photos) {
            photoStore.put({
              id: photo.id,
              itemId: photo.itemId,
              filename: photo.filename,
              originalName: photo.originalName,
              mimeType: photo.mimeType,
              sizeBytes: photo.sizeBytes,
              sortOrder: photo.sortOrder,
              staticUrl: photo.staticUrl
            });
          }
        }
      }
    });

    console.log("Database seeded successfully from initial-data.json");
    return true;
  } catch (err) {
    console.error("Failed to seed initial data:", err);
    return false;
  }
}
