import JSZip from "jszip";
import { openDatabase, withTransaction } from "./db";
import type { BackupData } from "../types";

export async function exportBackupZip(): Promise<void> {
  const db = await openDatabase();

  const boards = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("boards", "readonly");
    const req = tx.objectStore("boards").getAll();
    req.onsuccess = () => resolve(req.result);
  });

  const tiers = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("tiers", "readonly");
    const req = tx.objectStore("tiers").getAll();
    req.onsuccess = () => resolve(req.result);
  });

  const items = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result);
  });

  const photos = await new Promise<any[]>((resolve) => {
    const tx = db.transaction("photos", "readonly");
    const req = tx.objectStore("photos").getAll();
    req.onsuccess = () => resolve(req.result);
  });

  const zip = new JSZip();
  const photosFolder = zip.folder("photos");

  const exportPhotosMeta = [];

  for (const photo of photos) {
    const hasBlob = Boolean(photo.blob);
    exportPhotosMeta.push({
      id: photo.id,
      itemId: photo.itemId,
      filename: photo.filename,
      originalName: photo.originalName,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      sortOrder: photo.sortOrder,
      staticUrl: photo.staticUrl,
      hasBlob
    });

    if (hasBlob && photosFolder && photo.blob) {
      photosFolder.file(`${photo.id}_${photo.filename}`, photo.blob);
    }
  }

  const backupData: BackupData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    boards,
    tiers,
    items,
    photos: exportPhotosMeta
  };

  zip.file("data.json", JSON.stringify(backupData, null, 2));

  const content = await zip.generateAsync({ type: "blob" });
  const downloadUrl = URL.createObjectURL(content);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = downloadUrl;
  a.download = `ranklist-backup-${dateStr}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

export async function importBackupZip(file: File): Promise<void> {
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file("data.json");

  if (!dataFile) {
    throw new Error("无效的备份文件：压缩包内未找到 data.json。");
  }

  const jsonText = await dataFile.async("string");
  let backupData: BackupData;

  try {
    backupData = JSON.parse(jsonText);
  } catch {
    throw new Error("备份数据解析失败，data.json 格式损坏。");
  }

  if (!Array.isArray(backupData.boards) || !Array.isArray(backupData.tiers) || !Array.isArray(backupData.items)) {
    throw new Error("备份数据结构不完整。");
  }

  // Clear existing database and rewrite
  await withTransaction(["boards", "tiers", "items", "photos"], "readwrite", async (tx) => {
    tx.objectStore("boards").clear();
    tx.objectStore("tiers").clear();
    tx.objectStore("items").clear();
    tx.objectStore("photos").clear();

    const boardStore = tx.objectStore("boards");
    for (const b of backupData.boards) {
      boardStore.put(b);
    }

    const tierStore = tx.objectStore("tiers");
    for (const t of backupData.tiers) {
      tierStore.put(t);
    }

    const itemStore = tx.objectStore("items");
    for (const item of backupData.items) {
      itemStore.put(item);
    }

    const photoStore = tx.objectStore("photos");
    for (const p of backupData.photos) {
      let blob: Blob | undefined;
      if (p.hasBlob) {
        const photoFile = zip.file(`photos/${p.id}_${p.filename}`);
        if (photoFile) {
          const arrayBuffer = await photoFile.async("arraybuffer");
          blob = new Blob([arrayBuffer], { type: p.mimeType });
        }
      }

      photoStore.put({
        id: p.id,
        itemId: p.itemId,
        filename: p.filename,
        originalName: p.originalName,
        mimeType: p.mimeType,
        sizeBytes: p.sizeBytes,
        sortOrder: p.sortOrder,
        staticUrl: p.staticUrl,
        blob
      });
    }
  });
}
