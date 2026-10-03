import { openDatabase, withTransaction } from "./db";
import type { Board, BoardSummary, Item, Photo, ReorderUpdate, Tier } from "../types";

export interface UploadProgress {
  loaded: number;
  total?: number;
  percent?: number;
}

const objectUrlCache = new Map<number, string>();

export function getPhotoDisplayUrl(photo: { id: number; blob?: Blob; staticUrl?: string }): string {
  if (photo.blob) {
    if (!objectUrlCache.has(photo.id)) {
      objectUrlCache.set(photo.id, URL.createObjectURL(photo.blob));
    }
    return objectUrlCache.get(photo.id)!;
  }

  if (photo.staticUrl) {
    const cleanPath = photo.staticUrl.replace(/^\.?\//, "");
    return `./${cleanPath}`;
  }

  return "";
}

function revokePhotoUrl(photoId: number) {
  const url = objectUrlCache.get(photoId);
  if (url && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(photoId);
  }
}

export async function fetchBoards(): Promise<BoardSummary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("boards", "readonly");
    const store = tx.objectStore("boards");
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as BoardSummary[]).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      resolve(list.map((b) => ({ id: b.id, name: b.name, sortOrder: b.sortOrder })));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function fetchBoardById(boardId: number): Promise<Board> {
  const db = await openDatabase();

  const board = await new Promise<BoardSummary | undefined>((resolve, reject) => {
    const tx = db.transaction("boards", "readonly");
    const req = tx.objectStore("boards").get(boardId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!board) {
    throw new Error("没有找到这个排行榜。");
  }

  const tiers = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction("tiers", "readonly");
    const store = tx.objectStore("tiers");
    const index = store.index("boardId");
    const req = index.getAll(boardId);
    req.onsuccess = () => resolve((req.result as any[]).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
    req.onerror = () => reject(req.error);
  });

  const tierIds = tiers.map((t) => t.id);

  // Get items for all tiers of this board
  const allItems = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction("items", "readonly");
    const store = tx.objectStore("items");
    const req = store.getAll();
    req.onsuccess = () => {
      const filtered = (req.result as any[]).filter((item) => tierIds.includes(item.tierId));
      resolve(filtered.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
    };
    req.onerror = () => reject(req.error);
  });

  // Get all photos for these items
  const itemIds = allItems.map((item) => item.id);
  const allPhotos = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction("photos", "readonly");
    const store = tx.objectStore("photos");
    const req = store.getAll();
    req.onsuccess = () => {
      const filtered = (req.result as any[]).filter((p) => itemIds.includes(p.itemId));
      resolve(filtered.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
    };
    req.onerror = () => reject(req.error);
  });

  const photosByItem = new Map<number, Photo[]>();
  for (const rawPhoto of allPhotos) {
    const photo: Photo = {
      id: rawPhoto.id,
      itemId: rawPhoto.itemId,
      filename: rawPhoto.filename || `${rawPhoto.id}.bin`,
      originalName: rawPhoto.originalName,
      mimeType: rawPhoto.mimeType,
      sizeBytes: rawPhoto.sizeBytes,
      sortOrder: rawPhoto.sortOrder,
      blob: rawPhoto.blob,
      staticUrl: rawPhoto.staticUrl,
      url: getPhotoDisplayUrl(rawPhoto)
    };

    if (!photosByItem.has(rawPhoto.itemId)) {
      photosByItem.set(rawPhoto.itemId, []);
    }
    photosByItem.get(rawPhoto.itemId)!.push(photo);
  }

  const itemsByTier = new Map<number, Item[]>();
  for (const rawItem of allItems) {
    const itemPhotos = photosByItem.get(rawItem.id) ?? [];
    const item: Item = {
      id: rawItem.id,
      tierId: rawItem.tierId,
      name: rawItem.name,
      description: rawItem.description || "",
      coverPhotoId: rawItem.coverPhotoId ?? null,
      sortOrder: rawItem.sortOrder,
      photos: itemPhotos
    };

    if (!itemsByTier.has(rawItem.tierId)) {
      itemsByTier.set(rawItem.tierId, []);
    }
    itemsByTier.get(rawItem.tierId)!.push(item);
  }

  const fullTiers: Tier[] = tiers.map((t) => ({
    id: t.id,
    boardId: t.boardId,
    name: t.name,
    sortOrder: t.sortOrder,
    items: itemsByTier.get(t.id) ?? []
  }));

  return {
    id: board.id,
    name: board.name,
    sortOrder: board.sortOrder,
    tiers: fullTiers
  };
}

export async function fetchBoard(): Promise<Board> {
  const boards = await fetchBoards();
  if (!boards.length) {
    throw new Error("还没有排行榜。");
  }
  return fetchBoardById(boards[0].id);
}

export async function createBoard(name: string): Promise<Board> {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("排行榜名称不能为空。");
  }

  const boards = await fetchBoards();
  const nextOrder = boards.length ? Math.max(...boards.map((b) => b.sortOrder)) + 1 : 0;

  const newBoardId = await withTransaction(["boards", "tiers"], "readwrite", async (tx) => {
    const boardStore = tx.objectStore("boards");
    const boardId = await new Promise<number>((resolve, reject) => {
      const req = boardStore.add({ name: cleanName, sortOrder: nextOrder });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });

    const tierStore = tx.objectStore("tiers");
    const defaultTiers = ["S", "A", "B", "C", "D"];
    for (let i = 0; i < defaultTiers.length; i++) {
      tierStore.add({
        boardId,
        name: defaultTiers[i],
        sortOrder: i
      });
    }

    return boardId;
  });

  return fetchBoardById(newBoardId);
}

export async function updateBoard(id: number, patch: Partial<Pick<Board, "name" | "sortOrder">>): Promise<Board> {
  await withTransaction("boards", "readwrite", async (tx) => {
    const store = tx.objectStore("boards");
    const current = await new Promise<any>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!current) throw new Error("没有找到这个排行榜。");
    if (patch.name !== undefined) current.name = patch.name.trim();
    if (patch.sortOrder !== undefined) current.sortOrder = patch.sortOrder;

    store.put(current);
  });

  return fetchBoardById(id);
}

export async function deleteBoard(id: number): Promise<void> {
  const boards = await fetchBoards();
  if (boards.length <= 1) {
    throw new Error("必须至少保留一个排行榜。");
  }

  const db = await openDatabase();
  const tiers = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("tiers", "readonly");
    const req = tx.objectStore("tiers").index("boardId").getAll(id);
    req.onsuccess = () => resolve(req.result as any[]);
  });

  const tierIds = tiers.map((t) => t.id);

  const items = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").getAll();
    req.onsuccess = () => resolve((req.result as any[]).filter((item) => tierIds.includes(item.tierId)));
  });

  const itemIds = items.map((i) => i.id);

  await withTransaction(["boards", "tiers", "items", "photos"], "readwrite", (tx) => {
    tx.objectStore("boards").delete(id);

    const tierStore = tx.objectStore("tiers");
    for (const tId of tierIds) tierStore.delete(tId);

    const itemStore = tx.objectStore("items");
    for (const iId of itemIds) itemStore.delete(iId);

    const photoStore = tx.objectStore("photos");
    const photoReq = photoStore.getAll();
    photoReq.onsuccess = () => {
      for (const p of photoReq.result as any[]) {
        if (itemIds.includes(p.itemId)) {
          revokePhotoUrl(p.id);
          photoStore.delete(p.id);
        }
      }
    };
  });
}

export async function createTier(boardId: number, name: string): Promise<Tier> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("档位名称不能为空。");

  const board = await fetchBoardById(boardId);
  const nextOrder = board.tiers.length ? Math.max(...board.tiers.map((t) => t.sortOrder)) + 1 : 0;

  const tierId = await withTransaction("tiers", "readwrite", (tx) => {
    const store = tx.objectStore("tiers");
    return new Promise<number>((resolve, reject) => {
      const req = store.add({ boardId, name: cleanName, sortOrder: nextOrder });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  });

  return { id: tierId, boardId, name: cleanName, sortOrder: nextOrder, items: [] };
}

export async function updateTier(id: number, patch: Partial<Pick<Tier, "name" | "sortOrder">>): Promise<Tier> {
  return withTransaction("tiers", "readwrite", async (tx) => {
    const store = tx.objectStore("tiers");
    const current = await new Promise<any>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!current) throw new Error("没有找到这个档位。");
    if (patch.name !== undefined) current.name = patch.name.trim();
    if (patch.sortOrder !== undefined) current.sortOrder = patch.sortOrder;

    store.put(current);
    return { ...current, items: [] };
  });
}

export async function deleteTier(id: number): Promise<void> {
  const db = await openDatabase();
  const current = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction("tiers", "readonly");
    const req = tx.objectStore("tiers").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!current) throw new Error("没有找到这个档位。");

  const board = await fetchBoardById(current.boardId);
  if (board.tiers.length <= 1) {
    throw new Error("排行榜必须至少保留一个档位。");
  }

  const items = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").index("tierId").getAll(id);
    req.onsuccess = () => resolve(req.result as any[]);
  });

  const itemIds = items.map((i) => i.id);

  await withTransaction(["tiers", "items", "photos"], "readwrite", (tx) => {
    tx.objectStore("tiers").delete(id);
    const itemStore = tx.objectStore("items");
    for (const iId of itemIds) itemStore.delete(iId);

    const photoStore = tx.objectStore("photos");
    const photoReq = photoStore.getAll();
    photoReq.onsuccess = () => {
      for (const p of photoReq.result as any[]) {
        if (itemIds.includes(p.itemId)) {
          revokePhotoUrl(p.id);
          photoStore.delete(p.id);
        }
      }
    };
  });
}

export async function createItem(tierId: number, name: string): Promise<Item> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("项目名称不能为空。");

  const db = await openDatabase();
  const items = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").index("tierId").getAll(tierId);
    req.onsuccess = () => resolve(req.result as any[]);
  });

  const nextOrder = items.length ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0;

  const newItemId = await withTransaction("items", "readwrite", (tx) => {
    const store = tx.objectStore("items");
    return new Promise<number>((resolve, reject) => {
      const req = store.add({
        tierId,
        name: cleanName,
        description: "",
        coverPhotoId: null,
        sortOrder: nextOrder
      });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  });

  return {
    id: newItemId,
    tierId,
    name: cleanName,
    description: "",
    coverPhotoId: null,
    sortOrder: nextOrder,
    photos: []
  };
}

export async function updateItem(
  id: number,
  patch: Partial<Pick<Item, "name" | "description" | "coverPhotoId" | "tierId" | "sortOrder">>
): Promise<Item> {
  await withTransaction("items", "readwrite", async (tx) => {
    const store = tx.objectStore("items");
    const current = await new Promise<any>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!current) throw new Error("没有找到这个项目。");

    if (patch.name !== undefined) current.name = patch.name.trim();
    if (patch.description !== undefined) current.description = patch.description.trim();
    if (patch.coverPhotoId !== undefined) current.coverPhotoId = patch.coverPhotoId;
    if (patch.tierId !== undefined) current.tierId = patch.tierId;
    if (patch.sortOrder !== undefined) current.sortOrder = patch.sortOrder;

    store.put(current);
  });

  return fetchItemById(id);
}

export async function deleteItem(id: number): Promise<void> {
  await withTransaction(["items", "photos"], "readwrite", (tx) => {
    tx.objectStore("items").delete(id);
    const photoStore = tx.objectStore("photos");
    const req = photoStore.index("itemId").getAll(id);
    req.onsuccess = () => {
      for (const p of req.result as any[]) {
        revokePhotoUrl(p.id);
        photoStore.delete(p.id);
      }
    };
  });
}

export async function reorderItems(boardId: number, updates: ReorderUpdate[]): Promise<Board> {
  await withTransaction("items", "readwrite", async (tx) => {
    const store = tx.objectStore("items");
    for (const update of updates) {
      const item = await new Promise<any>((resolve) => {
        const req = store.get(update.id);
        req.onsuccess = () => resolve(req.result);
      });

      if (item) {
        item.tierId = update.tierId;
        item.sortOrder = update.sortOrder;
        store.put(item);
      }
    }
  });

  return fetchBoardById(boardId);
}

export async function fetchItemById(itemId: number): Promise<Item> {
  const db = await openDatabase();
  const rawItem = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").get(itemId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!rawItem) throw new Error("没有找到这个项目。");

  const rawPhotos = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("photos", "readonly");
    const req = tx.objectStore("photos").index("itemId").getAll(itemId);
    req.onsuccess = () => resolve((req.result as any[]).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
  });

  const photos: Photo[] = rawPhotos.map((p) => ({
    id: p.id,
    itemId: p.itemId,
    filename: p.filename || `${p.id}.bin`,
    originalName: p.originalName,
    mimeType: p.mimeType,
    sizeBytes: p.sizeBytes,
    sortOrder: p.sortOrder,
    blob: p.blob,
    staticUrl: p.staticUrl,
    url: getPhotoDisplayUrl(p)
  }));

  return {
    id: rawItem.id,
    tierId: rawItem.tierId,
    name: rawItem.name,
    description: rawItem.description || "",
    coverPhotoId: rawItem.coverPhotoId ?? null,
    sortOrder: rawItem.sortOrder,
    photos
  };
}

export async function uploadPhotos(
  itemId: number,
  files: File[],
  _uploadSessionId?: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<Item> {
  if (!files.length) {
    throw new Error("请选择至少一个图片或视频文件。");
  }

  const db = await openDatabase();
  const existingPhotos = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("photos", "readonly");
    const req = tx.objectStore("photos").index("itemId").getAll(itemId);
    req.onsuccess = () => resolve(req.result as any[]);
  });

  let nextSortOrder = existingPhotos.length ? Math.max(...existingPhotos.map((p) => p.sortOrder)) + 1 : 0;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let loadedBytes = 0;

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });

    await withTransaction("photos", "readwrite", (tx) => {
      const store = tx.objectStore("photos");
      store.add({
        itemId,
        filename: `${Date.now()}-${file.name}`,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        sortOrder: nextSortOrder,
        blob
      });
    });

    nextSortOrder += 1;
    loadedBytes += file.size;
    onProgress?.({
      loaded: loadedBytes,
      total: totalBytes,
      percent: Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
    });
  }

  return fetchItemById(itemId);
}

export async function deletePhoto(photoId: number): Promise<void> {
  const db = await openDatabase();
  const photo = await new Promise<any>((resolve) => {
    const tx = db.transaction("photos", "readonly");
    const req = tx.objectStore("photos").get(photoId);
    req.onsuccess = () => resolve(req.result);
  });

  if (!photo) return;

  // Clear coverPhotoId if this was the cover
  const item = await new Promise<any>((resolve) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").get(photo.itemId);
    req.onsuccess = () => resolve(req.result);
  });

  await withTransaction(["photos", "items"], "readwrite", (tx) => {
    revokePhotoUrl(photoId);
    tx.objectStore("photos").delete(photoId);

    if (item && item.coverPhotoId === photoId) {
      item.coverPhotoId = null;
      tx.objectStore("items").put(item);
    }
  });
}
