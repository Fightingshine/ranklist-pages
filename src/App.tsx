import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Database,
  Download,
  Film,
  GripVertical,
  ImageIcon,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  createBoard,
  createItem,
  createTier,
  deleteBoard,
  deleteItem,
  deletePhoto,
  deleteTier,
  fetchBoard,
  fetchBoardById,
  fetchBoards,
  reorderItems,
  updateBoard,
  updateItem,
  updateTier,
  uploadPhotos,
  type UploadProgress
} from "./services/storage";
import { checkAndSeedDatabase } from "./services/seed";
import { exportBackupZip, importBackupZip } from "./services/backup";
import type { Board, BoardSummary, Item, Photo, ReorderUpdate, Tier } from "./types";

const tierPalette = ["#e95d5d", "#e7a635", "#2f9b78", "#4a7bd0", "#8c63c7", "#69727d"];

function flattenItems(board: Board): ReorderUpdate[] {
  return board.tiers.flatMap((tier) =>
    tier.items.map((item, index) => ({
      id: item.id,
      tierId: tier.id,
      sortOrder: index
    }))
  );
}

function replaceItem(board: Board, updatedItem: Item): Board {
  return {
    ...board,
    tiers: board.tiers.map((tier) => ({
      ...tier,
      items: tier.items.map((item) => (item.id === updatedItem.id ? updatedItem : item))
    }))
  };
}

function removePhotoFromBoard(board: Board, photoId: number): Board {
  return {
    ...board,
    tiers: board.tiers.map((tier) => ({
      ...tier,
      items: tier.items.map((item) => ({
        ...item,
        coverPhotoId: item.coverPhotoId === photoId ? null : item.coverPhotoId,
        photos: item.photos.filter((photo) => photo.id !== photoId)
      }))
    }))
  };
}

function moveItemBefore(board: Board, movingItemId: number, targetTierId: number, targetItemId?: number): Board {
  let movingItem: Item | undefined;

  const tiersWithoutMoving = board.tiers.map((tier) => {
    const remainingItems = tier.items.filter((item) => {
      if (item.id === movingItemId) {
        movingItem = item;
        return false;
      }
      return true;
    });

    return { ...tier, items: remainingItems };
  });

  if (!movingItem) {
    return board;
  }

  const updatedMovingItem: Item = { ...movingItem, tierId: targetTierId };

  return {
    ...board,
    tiers: tiersWithoutMoving.map((tier) => {
      if (tier.id !== targetTierId) {
        return tier;
      }

      if (targetItemId === undefined) {
        return { ...tier, items: [...tier.items, updatedMovingItem] };
      }

      const targetIndex = tier.items.findIndex((item) => item.id === targetItemId);
      if (targetIndex === -1) {
        return { ...tier, items: [...tier.items, updatedMovingItem] };
      }

      const nextItems = [...tier.items];
      nextItems.splice(targetIndex, 0, updatedMovingItem);
      return { ...tier, items: nextItems };
    })
  };
}

function shiftItemOrder(board: Board, itemId: number, direction: "prev" | "next"): Board {
  let currentTierId: number | null = null;
  let currentIndex = -1;

  for (const tier of board.tiers) {
    const index = tier.items.findIndex((item) => item.id === itemId);
    if (index !== -1) {
      currentTierId = tier.id;
      currentIndex = index;
      break;
    }
  }

  if (currentTierId === null || currentIndex === -1) {
    return board;
  }

  const currentTier = board.tiers.find((tier) => tier.id === currentTierId);
  if (!currentTier) {
    return board;
  }

  const targetIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= currentTier.items.length) {
    return board;
  }

  const newItems = [...currentTier.items];
  const [removed] = newItems.splice(currentIndex, 1);
  newItems.splice(targetIndex, 0, removed);

  return {
    ...board,
    tiers: board.tiers.map((tier) => (tier.id === currentTierId ? { ...tier, items: newItems } : tier))
  };
}

function moveItemToTierEnd(board: Board, itemId: number, targetTierId: number): Board {
  let movingItem: Item | undefined;

  const tiersWithoutMoving = board.tiers.map((tier) => {
    const remainingItems = tier.items.filter((item) => {
      if (item.id === itemId) {
        movingItem = item;
        return false;
      }
      return true;
    });
    return { ...tier, items: remainingItems };
  });

  if (!movingItem) {
    return board;
  }

  const updatedItem: Item = { ...movingItem, tierId: targetTierId };

  return {
    ...board,
    tiers: tiersWithoutMoving.map((tier) =>
      tier.id === targetTierId ? { ...tier, items: [...tier.items, updatedItem] } : tier
    )
  };
}

function itemCoverPhoto(item: Item): Photo | undefined {
  if (item.coverPhotoId) {
    const matched = item.photos.find((photo) => photo.id === item.coverPhotoId);
    if (matched) {
      return matched;
    }
  }

  return item.photos[0];
}

function isImageMedia(media: Photo) {
  return media.mimeType.startsWith("image/");
}

function isVideoMedia(media: Photo) {
  return media.mimeType.startsWith("video/");
}

type UploadStatus =
  | { state: "idle" }
  | { state: "uploading"; selectedCount: number; loaded: number; total?: number; percent?: number }
  | { state: "success"; selectedCount: number; message: string }
  | { state: "error"; selectedCount?: number; message: string };

function uploadPercentFromStatus(uploadStatus: UploadStatus) {
  if (uploadStatus.state === "success") {
    return 100;
  }
  if (uploadStatus.state !== "uploading") {
    return 0;
  }
  return uploadStatus.percent ?? 0;
}

function uploadMessageFromStatus(uploadStatus: UploadStatus) {
  if (uploadStatus.state === "uploading") {
    return `正在保存 ${uploadStatus.selectedCount} 个媒体文件至本地...`;
  }
  if (uploadStatus.state === "success" || uploadStatus.state === "error") {
    return uploadStatus.message;
  }
  return "";
}

function UploadStatusPanel({ uploadStatus, compact = false }: { uploadStatus: UploadStatus; compact?: boolean }) {
  if (uploadStatus.state === "idle") {
    return null;
  }

  const uploadPercent = uploadPercentFromStatus(uploadStatus);

  return (
    <div
      className={`upload-status ${uploadStatus.state}${compact ? " compact" : ""}`}
      role={uploadStatus.state === "error" ? "alert" : "status"}
    >
      <div className="upload-status-top">
        <span>{uploadMessageFromStatus(uploadStatus)}</span>
        {uploadStatus.state === "uploading" ? <strong>{uploadPercent}%</strong> : null}
      </div>
      <div className="upload-progress" aria-label="上传进度">
        <span style={{ width: `${uploadPercent}%` }} />
      </div>
    </div>
  );
}

export default function App() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newItemNames, setNewItemNames] = useState<Record<number, string>>({});
  const [draggingItemId, setDraggingItemId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ state: "idle" });
  const [showBackupDrawer, setShowBackupDrawer] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);


  const selectedItem = useMemo(() => {
    if (!board || selectedItemId === null) {
      return null;
    }
    return board.tiers.flatMap((tier) => tier.items).find((item) => item.id === selectedItemId) ?? null;
  }, [board, selectedItemId]);

  async function loadBoard(preferredBoardId = activeBoardId) {
    try {
      setError(null);
      const nextBoards = await fetchBoards();
      const savedBoardId = Number(window.localStorage.getItem("ranklist.activeBoardId"));
      const targetBoardId =
        nextBoards.find((nextBoard) => nextBoard.id === preferredBoardId)?.id ??
        nextBoards.find((nextBoard) => nextBoard.id === savedBoardId)?.id ??
        nextBoards[0]?.id;

      const nextBoard = targetBoardId ? await fetchBoardById(targetBoardId) : await fetchBoard();

      setBoards(
        nextBoards.length
          ? nextBoards
          : [
              {
                id: nextBoard.id,
                name: nextBoard.name,
                sortOrder: nextBoard.sortOrder
              }
            ]
      );
      setActiveBoardId(nextBoard.id);
      setBoard(nextBoard);
      window.localStorage.setItem("ranklist.activeBoardId", String(nextBoard.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "排行表加载失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        setError(null);
        await checkAndSeedDatabase();
        await loadBoard();
      } catch (bootstrapError) {
        setError(bootstrapError instanceof Error ? bootstrapError.message : "应用初始化失败。");
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedItem) {
      return;
    }
    setSelectedPhotoIndex((currentIndex) => Math.min(currentIndex, Math.max(0, selectedItem.photos.length - 1)));
  }, [selectedItem]);

  useEffect(() => {
    setUploadStatus({ state: "idle" });
  }, [selectedItemId]);

  async function handleSelectBoard(boardId: number) {
    setSelectedItemId(null);
    setActiveBoardId(boardId);
    window.localStorage.setItem("ranklist.activeBoardId", String(boardId));
    await loadBoard(boardId);
  }

  async function handleAddBoard() {
    try {
      setError(null);
      setSelectedItemId(null);
      const nextBoard = await createBoard("新排行榜");
      const nextBoards = await fetchBoards();

      setBoards(nextBoards);
      setActiveBoardId(nextBoard.id);
      setBoard(nextBoard);
      window.localStorage.setItem("ranklist.activeBoardId", String(nextBoard.id));
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "新增排行榜失败。");
    }
  }

  async function handleSaveBoardName(name: string) {
    if (!board) {
      return;
    }

    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      return;
    }

    try {
      setError(null);
      const updatedBoard = await updateBoard(board.id, { name: trimmed });
      setBoard(updatedBoard);
      setBoards((currentBoards) =>
        currentBoards.map((currentBoard) =>
          currentBoard.id === updatedBoard.id ? { ...currentBoard, name: updatedBoard.name } : currentBoard
        )
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "修改排行榜名称失败。");
    }
  }

  async function handleDeleteBoard() {
    if (!board) {
      return;
    }

    if (!window.confirm(`确定要删除“${board.name}”吗？此操作会同时删除该排行榜下的所有档位和项目。`)) {
      return;
    }

    try {
      setError(null);
      setSelectedItemId(null);
      await deleteBoard(board.id);

      const nextBoards = await fetchBoards();
      const nextActiveBoardId = nextBoards[0]?.id;

      setBoards(nextBoards);
      setActiveBoardId(nextActiveBoardId ?? null);

      if (nextActiveBoardId) {
        window.localStorage.setItem("ranklist.activeBoardId", String(nextActiveBoardId));
        await loadBoard(nextActiveBoardId);
      } else {
        setBoard(null);
        window.localStorage.removeItem("ranklist.activeBoardId");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除排行榜失败。");
    }
  }

  async function handleAddTier() {
    if (!board) {
      return;
    }

    try {
      setError(null);
      const newTier = await createTier(board.id, `档位 ${board.tiers.length + 1}`);
      setBoard({ ...board, tiers: [...board.tiers, newTier] });
    } catch (tierError) {
      setError(tierError instanceof Error ? tierError.message : "新增档位失败。");
    }
  }

  async function handleSaveTier(tierId: number, name: string) {
    if (!board) {
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    try {
      setError(null);
      const updatedTier = await updateTier(tierId, { name: trimmed });
      setBoard({
        ...board,
        tiers: board.tiers.map((tier) => (tier.id === tierId ? { ...tier, name: updatedTier.name } : tier))
      });
    } catch (tierError) {
      setError(tierError instanceof Error ? tierError.message : "修改档位失败。");
    }
  }

  async function handleDeleteTier(tierId: number) {
    if (!board) {
      return;
    }

    if (!window.confirm("确定要删除这个档位吗？档位里的所有项目也会被删除。")) {
      return;
    }

    try {
      setError(null);
      await deleteTier(tierId);
      setBoard({
        ...board,
        tiers: board.tiers.filter((tier) => tier.id !== tierId)
      });
      if (selectedItem?.tierId === tierId) {
        setSelectedItemId(null);
      }
    } catch (tierError) {
      setError(tierError instanceof Error ? tierError.message : "删除档位失败。");
    }
  }

  async function handleAddItem(tierId: number) {
    const name = newItemNames[tierId]?.trim();
    if (!name || !board) {
      return;
    }

    try {
      setError(null);
      const createdItem = await createItem(tierId, name);
      setBoard({
        ...board,
        tiers: board.tiers.map((tier) =>
          tier.id === tierId ? { ...tier, items: [...tier.items, createdItem] } : tier
        )
      });
      setNewItemNames((current) => ({ ...current, [tierId]: "" }));
    } catch (itemError) {
      setError(itemError instanceof Error ? itemError.message : "新增项目失败。");
    }
  }

  async function handleSaveItemDetails(name: string, description: string, coverPhotoId: number | null) {
    if (!selectedItem || !board) {
      return;
    }

    try {
      setError(null);
      const updatedItem = await updateItem(selectedItem.id, {
        name,
        description,
        coverPhotoId
      });
      setBoard(replaceItem(board, updatedItem));
    } catch (itemError) {
      setError(itemError instanceof Error ? itemError.message : "保存项目详情失败。");
    }
  }

  async function handleDeleteItem(itemId: number) {
    if (!board) {
      return;
    }

    if (!window.confirm("确定要删除这个项目吗？")) {
      return;
    }

    try {
      setError(null);
      await deleteItem(itemId);
      setBoard({
        ...board,
        tiers: board.tiers.map((tier) => ({
          ...tier,
          items: tier.items.filter((item) => item.id !== itemId)
        }))
      });
      if (selectedItemId === itemId) {
        setSelectedItemId(null);
      }
    } catch (itemError) {
      setError(itemError instanceof Error ? itemError.message : "删除项目失败。");
    }
  }

  async function handleTouchShift(itemId: number, direction: "prev" | "next") {
    if (!board) {
      return;
    }

    const optimisticBoard = shiftItemOrder(board, itemId, direction);
    setBoard(optimisticBoard);

    try {
      setError(null);
      await reorderItems(board.id, flattenItems(optimisticBoard));
    } catch (reorderError) {
      setBoard(board);
      setError(reorderError instanceof Error ? reorderError.message : "重新排序失败。");
    }
  }

  async function handleTouchChangeTier(itemId: number, targetTierId: number) {
    if (!board) {
      return;
    }

    const optimisticBoard = moveItemToTierEnd(board, itemId, targetTierId);
    setBoard(optimisticBoard);

    try {
      setError(null);
      await reorderItems(board.id, flattenItems(optimisticBoard));
    } catch (reorderError) {
      setBoard(board);
      setError(reorderError instanceof Error ? reorderError.message : "修改档位失败。");
    }
  }

  async function handleDrop(targetTierId: number, targetItemId?: number) {
    if (!board || draggingItemId === null) {
      return;
    }

    const movingItemId = draggingItemId;
    setDraggingItemId(null);

    const optimisticBoard = moveItemBefore(board, movingItemId, targetTierId, targetItemId);
    setBoard(optimisticBoard);

    try {
      setError(null);
      await reorderItems(board.id, flattenItems(optimisticBoard));
    } catch (reorderError) {
      setBoard(board);
      setError(reorderError instanceof Error ? reorderError.message : "重新排序失败。");
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!selectedItem || !board || !files || !files.length) {
      return;
    }

    const selectedFiles = Array.from(files);
    const selectedCount = selectedFiles.length;
    const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);

    try {
      setError(null);
      setUploadStatus({ state: "uploading", selectedCount, loaded: 0, total: totalBytes, percent: 0 });

      const updatedItem = await uploadPhotos(selectedItem.id, selectedFiles, undefined, (progress: UploadProgress) => {
        setUploadStatus((currentStatus) =>
          currentStatus.state === "uploading"
            ? {
                ...currentStatus,
                loaded: progress.loaded,
                total: progress.total ?? totalBytes,
                percent: progress.percent ?? Math.min(100, Math.round((progress.loaded / totalBytes) * 100))
              }
            : currentStatus
        );
      });

      setBoard(replaceItem(board, updatedItem));
      setSelectedPhotoIndex(Math.max(0, updatedItem.photos.length - 1));
      setUploadStatus({
        state: "success",
        selectedCount,
        message: `成功保存 ${selectedCount} 个媒体文件至本地`
      });
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "上传媒体文件失败。";
      setUploadStatus({ state: "error", selectedCount, message });
    }
  }

  async function handleDeletePhoto(photoId: number) {
    if (!selectedItem || !board) {
      return;
    }

    if (!window.confirm("确定要删除这个媒体文件吗？")) {
      return;
    }

    try {
      setError(null);
      await deletePhoto(photoId);
      const nextBoard = removePhotoFromBoard(board, photoId);
      setBoard(nextBoard);

      const nextItem = nextBoard.tiers.flatMap((tier) => tier.items).find((item) => item.id === selectedItem.id);
      if (nextItem) {
        setSelectedPhotoIndex((currentIndex) => Math.min(currentIndex, Math.max(0, nextItem.photos.length - 1)));
      }
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "删除媒体文件失败。");
    }
  }

  async function handleExportBackup() {
    try {
      setBackupLoading(true);
      setBackupMsg(null);
      await exportBackupZip();
      setBackupMsg({ type: "success", text: "备份已成功导出为 ZIP 文件！" });
    } catch (err) {
      setBackupMsg({ type: "error", text: err instanceof Error ? err.message : "导出备份失败。" });
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleImportBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("导入备份将覆盖当前浏览器内的排行榜数据，确定继续吗？")) {
      event.target.value = "";
      return;
    }

    try {
      setBackupLoading(true);
      setBackupMsg(null);
      await importBackupZip(file);
      await loadBoard();
      setBackupMsg({ type: "success", text: "数据恢复成功！" });
    } catch (err) {
      setBackupMsg({ type: "error", text: err instanceof Error ? err.message : "导入备份失败。" });
    } finally {
      setBackupLoading(false);
      event.target.value = "";
    }
  }

  if (loading) {
    return (
      <div className="app-shell loading-shell">
        <LoaderCircle className="spin" size={32} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="floating-upload-status">
        <UploadStatusPanel uploadStatus={uploadStatus} compact />
      </div>

      <header className="app-header">
        <div className="title-stack">
          <span className="eyebrow">纯静态离线版 · GitHub Pages</span>
          <h1>{board?.name ?? "排行表"}</h1>
          <div className="board-toolbar">
            <label className="sr-only" htmlFor="board-select">
              选择排行榜
            </label>
            <select
              id="board-select"
              className="board-select"
              value={activeBoardId ?? ""}
              onChange={(event) => void handleSelectBoard(Number(event.target.value))}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="secondary-button" type="button" onClick={() => void handleAddBoard()}>
              <Plus size={16} /> 新建排行榜
            </button>
            <button className="secondary-button" type="button" onClick={() => setShowBackupDrawer(true)}>
              <Database size={16} /> 数据备份与迁移
            </button>
          </div>
        </div>

        <div className="header-actions">
          {board ? (
            <input
              className="board-name-input"
              defaultValue={board.name}
              key={board.id}
              maxLength={80}
              onBlur={(event) => void handleSaveBoardName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSaveBoardName(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }}
              title="修改当前排行榜名称"
            />
          ) : null}
          <button className="secondary-button" type="button" onClick={() => void handleAddTier()}>
            <Plus size={16} /> 新增档位
          </button>
          {boards.length > 1 ? (
            <button className="danger-button" type="button" onClick={() => void handleDeleteBoard()} title="删除当前排行榜">
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <aside className="banner error-banner">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="关闭提示">
            <X size={16} />
          </button>
        </aside>
      ) : null}

      <main className="board-layout">
        {board?.tiers.map((tier, index) => (
          <section
            key={tier.id}
            className="tier-row"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void handleDrop(tier.id)}
          >
            <div className="tier-header" style={{ backgroundColor: tierPalette[index % tierPalette.length] }}>
              <input
                className="tier-name-input"
                defaultValue={tier.name}
                key={`${tier.id}-${tier.name}`}
                maxLength={40}
                onBlur={(event) => void handleSaveTier(tier.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSaveTier(tier.id, event.currentTarget.value);
                    event.currentTarget.blur();
                  }
                }}
              />
              <button
                className="tier-delete-button"
                type="button"
                onClick={() => void handleDeleteTier(tier.id)}
                title="删除档位"
                aria-label={`删除档位 ${tier.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="tier-content">
              <div className="tier-items">
                {tier.items.map((item, itemIdx) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    currentTierId={tier.id}
                    availableTiers={board.tiers}
                    isFirst={itemIdx === 0}
                    isLast={itemIdx === tier.items.length - 1}
                    isDragging={draggingItemId === item.id}
                    onDragStart={() => setDraggingItemId(item.id)}
                    onDragEnd={() => setDraggingItemId(null)}
                    onDropBefore={() => void handleDrop(tier.id, item.id)}
                    onClick={() => setSelectedItemId(item.id)}
                    onTouchShift={(direction) => void handleTouchShift(item.id, direction)}
                    onTouchChangeTier={(targetTierId) => void handleTouchChangeTier(item.id, targetTierId)}
                  />
                ))}
              </div>

              <form
                className="add-item-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddItem(tier.id);
                }}
              >
                <input
                  placeholder="添加项目..."
                  value={newItemNames[tier.id] ?? ""}
                  onChange={(event) =>
                    setNewItemNames((current) => ({
                      ...current,
                      [tier.id]: event.target.value
                    }))
                  }
                />
                <button type="submit" disabled={!newItemNames[tier.id]?.trim()}>
                  <Plus size={16} /> 添加
                </button>
              </form>
            </div>
          </section>
        ))}
      </main>

      {selectedItem ? (
        <ItemDetailModal
          item={selectedItem}
          palette={tierPalette}
          photoIndex={selectedPhotoIndex}
          uploadStatus={uploadStatus}
          onClose={() => setSelectedItemId(null)}
          onDelete={() => void handleDeleteItem(selectedItem.id)}
          onDeletePhoto={(photoId) => void handleDeletePhoto(photoId)}
          onSave={(name, description, coverPhotoId) => void handleSaveItemDetails(name, description, coverPhotoId)}
          onSelectPhotoIndex={setSelectedPhotoIndex}
          onUpload={(files) => void handleUpload(files)}
        />
      ) : null}

      {showBackupDrawer ? (
        <div className="drawer-backdrop" onClick={() => setShowBackupDrawer(false)}>
          <aside className="account-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>数据备份与迁移</h2>
                <p>静态离线版数据保存在当前浏览器的 IndexedDB 中。您可以导出 ZIP 备份或在其他设备上恢复。</p>
              </div>
              <button type="button" className="close-button" onClick={() => setShowBackupDrawer(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="drawer-content">
              {backupMsg ? (
                <div className={`banner ${backupMsg.type === "success" ? "success-banner" : "error-banner"}`}>
                  <span>{backupMsg.text}</span>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: "16px", marginTop: "12px" }}>
                <div style={{ padding: "16px", border: "1px solid #e1e4e8", borderRadius: "8px", background: "#fff" }}>
                  <h3 style={{ margin: "0 0 8px" }}>📦 导出备份包 (ZIP)</h3>
                  <p style={{ margin: "0 0 12px", color: "#586069", fontSize: "14px" }}>
                    将所有排行榜、档位、项目文字以及您在本地上传的所有图片/视频打包为压缩包下载。
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleExportBackup()}
                    disabled={backupLoading}
                  >
                    {backupLoading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                    导出全部数据 (ZIP)
                  </button>
                </div>

                <div style={{ padding: "16px", border: "1px solid #e1e4e8", borderRadius: "8px", background: "#fff" }}>
                  <h3 style={{ margin: "0 0 8px" }}>📥 导入恢复数据</h3>
                  <p style={{ margin: "0 0 12px", color: "#586069", fontSize: "14px" }}>
                    选择之前导出的 ZIP 备份文件，系统将自动读取并恢复全部排行榜与照片。
                  </p>
                  <label className="secondary-button" style={{ display: "inline-flex", cursor: "pointer" }}>
                    <Upload size={16} /> 选择备份 ZIP 文件
                    <input
                      type="file"
                      accept=".zip"
                      style={{ display: "none" }}
                      disabled={backupLoading}
                      onChange={(e) => void handleImportBackup(e)}
                    />
                  </label>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

interface ItemCardProps {
  item: Item;
  currentTierId: number;
  availableTiers: Tier[];
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
  onClick: () => void;
  onTouchShift: (direction: "prev" | "next") => void;
  onTouchChangeTier: (targetTierId: number) => void;
}

function ItemCard({
  item,
  currentTierId,
  availableTiers,
  isFirst,
  isLast,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onClick,
  onTouchShift,
  onTouchChangeTier
}: ItemCardProps) {
  const cover = itemCoverPhoto(item);

  return (
    <article
      className={`item-card${isDragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDropBefore();
      }}
      onClick={onClick}
    >
      <div className="item-thumbnail">
        {cover ? (
          <img src={cover.url} alt={item.name} loading="lazy" />
        ) : (
          <div className="item-empty-cover" aria-hidden="true">
            <ImageIcon size={22} />
          </div>
        )}
      </div>

      <div className="item-meta">
        <span className="item-name">{item.name}</span>
        {item.description ? <span className="item-desc-snippet">{item.description}</span> : null}
      </div>

      <div
        className="item-touch-controls"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="touch-btn"
          disabled={isFirst}
          onClick={() => onTouchShift("prev")}
          title="向左前移一位"
          aria-label="前移"
        >
          ‹
        </button>
        <select
          className="touch-tier-select"
          value={currentTierId}
          onChange={(e) => onTouchChangeTier(Number(e.target.value))}
          title="选择档位"
          aria-label="修改档位"
        >
          {availableTiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="touch-btn"
          disabled={isLast}
          onClick={() => onTouchShift("next")}
          title="向右后移一位"
          aria-label="后移"
        >
          ›
        </button>
      </div>

      <span className="item-drag-handle" title="按住拖拽排序">
        <GripVertical size={14} />
      </span>
    </article>
  );
}

interface ItemDetailModalProps {
  item: Item;
  palette: string[];
  photoIndex: number;
  uploadStatus: UploadStatus;
  onClose: () => void;
  onDelete: () => void;
  onDeletePhoto: (photoId: number) => void;
  onSave: (name: string, description: string, coverPhotoId: number | null) => void;
  onSelectPhotoIndex: (index: number) => void;
  onUpload: (files: FileList | null) => void;
}

function ItemDetailModal({
  item,
  photoIndex,
  uploadStatus,
  onClose,
  onDelete,
  onDeletePhoto,
  onSave,
  onSelectPhotoIndex,
  onUpload
}: ItemDetailModalProps) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [coverPhotoId, setCoverPhotoId] = useState<number | null>(item.coverPhotoId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activePhoto = item.photos[photoIndex];
  const busy = uploadStatus.state === "uploading";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="item-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-top">
          <h2>项目详情</h2>
          <button type="button" className="close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-form">
          <label>
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>

          <label>
            描述
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="添加详细描述..."
            />
          </label>

          <div className="modal-photos-section">
            <div className="photos-header">
              <h3>媒体文件 ({item.photos.length})</h3>
              <label className="secondary-button upload-btn">
                <Upload size={16} /> 本地上传
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  style={{ display: "none" }}
                  disabled={busy}
                  onChange={(event) => {
                    onUpload(event.target.files);
                    if (event.target) event.target.value = "";
                  }}
                />
              </label>
            </div>

            <UploadStatusPanel uploadStatus={uploadStatus} />

            {item.photos.length ? (
              <div className="modal-photo-viewer">
                <div className="viewer-main">
                  {activePhoto ? (
                    isImageMedia(activePhoto) ? (
                      <img src={activePhoto.url} alt={activePhoto.originalName} />
                    ) : isVideoMedia(activePhoto) ? (
                      <video src={activePhoto.url} controls />
                    ) : (
                      <div className="unsupported-media">不支持预览</div>
                    )
                  ) : null}

                  {activePhoto ? (
                    <div className="viewer-actions">
                      <button
                        type="button"
                        className={coverPhotoId === activePhoto.id ? "primary-button" : "secondary-button"}
                        onClick={() => setCoverPhotoId(activePhoto.id)}
                      >
                        {coverPhotoId === activePhoto.id ? "已是封面" : "设为封面"}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => onDeletePhoto(activePhoto.id)}
                        title="删除此媒体"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="viewer-strip">
                  {item.photos.map((photo, index) => (
                    <button
                      key={photo.id}
                      type="button"
                      className={`strip-thumb${index === photoIndex ? " active" : ""}`}
                      onClick={() => onSelectPhotoIndex(index)}
                    >
                      {isImageMedia(photo) ? (
                        <img src={photo.url} alt="" />
                      ) : (
                        <div className="video-thumb-icon">
                          <Film size={20} />
                        </div>
                      )}
                      {coverPhotoId === photo.id ? <span className="cover-badge">封面</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-photos">暂无媒体文件，点击上方“本地上传”添加</div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="danger-button" onClick={onDelete}>
            <Trash2 size={16} /> 删除项目
          </button>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onSave(name, description, coverPhotoId);
                onClose();
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
