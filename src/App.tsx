import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Film,
  GripVertical,
  ImageIcon,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
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

function coverPhotoForItem(item: Item): Photo | undefined {
  if (item.coverPhotoId) {
    const matched = item.photos.find((photo) => photo.id === item.coverPhotoId);
    if (matched) {
      return matched;
    }
  }

  return item.photos[0];
}

function isImage(media: Photo) {
  return media.mimeType.startsWith("image/");
}

function isVideo(media: Photo) {
  return media.mimeType.startsWith("video/");
}

function fileSizeLabel(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }
  return `${(kib / 1024).toFixed(1)} MB`;
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

  async function handleDeleteTier(tier: Tier) {
    if (!board) {
      return;
    }

    if (!window.confirm(`确定要删除档位“${tier.name}”吗？档位里的所有项目也会被删除。`)) {
      return;
    }

    try {
      setError(null);
      await deleteTier(tier.id);
      setBoard({
        ...board,
        tiers: board.tiers.filter((currentTier) => currentTier.id !== tier.id)
      });
      if (selectedItem?.tierId === tier.id) {
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

  async function handleSaveItemName(item: Item, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name || !board) {
      return;
    }

    try {
      setError(null);
      const updatedItem = await updateItem(item.id, { name: trimmed });
      setBoard(replaceItem(board, updatedItem));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存项目名称失败。");
    }
  }

  async function handleSaveItemDescription(item: Item, description: string) {
    const trimmed = description.trim();
    if (trimmed === item.description || !board) {
      return;
    }

    try {
      setError(null);
      const updatedItem = await updateItem(item.id, { description: trimmed });
      setBoard(replaceItem(board, updatedItem));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存项目描述失败。");
    }
  }

  async function handleSetItemCover(item: Item, photo: Photo) {
    if (!board) {
      return;
    }

    try {
      setError(null);
      const updatedItem = await updateItem(item.id, { coverPhotoId: photo.id });
      setBoard(replaceItem(board, updatedItem));
    } catch (coverError) {
      setError(coverError instanceof Error ? coverError.message : "设置封面失败。");
    }
  }

  async function handleDeleteItem(item: Item) {
    if (!board) {
      return;
    }

    if (!window.confirm(`确定要删除“${item.name}”吗？`)) {
      return;
    }

    try {
      setError(null);
      await deleteItem(item.id);
      setBoard({
        ...board,
        tiers: board.tiers.map((tier) => ({
          ...tier,
          items: tier.items.filter((currentItem) => currentItem.id !== item.id)
        }))
      });
      if (selectedItemId === item.id) {
        setSelectedItemId(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除项目失败。");
    }
  }

  async function handleMoveItem(targetTierId: number, targetItemId?: number) {
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

  async function handleMoveItemOrder(itemId: number, direction: "prev" | "next") {
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

  async function handleMoveItemToTier(itemId: number, targetTierId: number) {
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

  async function handleDeletePhoto(photo: Photo) {
    if (!selectedItem || !board) {
      return;
    }

    if (!window.confirm(`确定要删除“${photo.originalName}”吗？`)) {
      return;
    }

    try {
      setError(null);
      await deletePhoto(photo.id);
      const nextBoard = removePhotoFromBoard(board, photo.id);
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
          <p className="eyebrow">纯静态离线版 · GITHUB PAGES</p>
          <h1>排行表</h1>
          <div className="board-toolbar">
            <select
              className="board-select"
              value={activeBoardId ?? ""}
              onChange={(event) => void handleSelectBoard(Number(event.target.value))}
              aria-label="选择排行榜"
            >
              {boards.map((currentBoard) => (
                <option key={currentBoard.id} value={currentBoard.id}>
                  {currentBoard.name}
                </option>
              ))}
            </select>
            {board ? (
              <EditableBoardName
                name={board.name}
                onSave={async (name) => {
                  await handleSaveBoardName(name);
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={() => setShowBackupDrawer(true)}>
            <Database size={17} aria-hidden="true" />
            数据备份与迁移
          </button>
          <button className="icon-button" type="button" onClick={() => void loadBoard()} title="刷新">
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button danger"
            type="button"
            onClick={() => void handleDeleteBoard()}
            disabled={boards.length <= 1}
            title="删除当前排行榜"
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
          <button className="primary-button" type="button" onClick={() => void handleAddBoard()}>
            <Plus size={18} aria-hidden="true" />
            新排行榜
          </button>
          <button className="primary-button" type="button" onClick={() => void handleAddTier()}>
            <Plus size={18} aria-hidden="true" />
            新档位
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} title="关闭">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <section className="board" aria-label="排行表">
        {board?.tiers.map((tier, index) => (
          <TierRow
            key={tier.id}
            tier={tier}
            accent={tierPalette[index % tierPalette.length]}
            availableTiers={board.tiers.map((t) => ({ id: t.id, name: t.name }))}
            newItemName={newItemNames[tier.id] ?? ""}
            draggingItemId={draggingItemId}
            onNewItemNameChange={(value) => setNewItemNames((current) => ({ ...current, [tier.id]: value }))}
            onAddItem={() => void handleAddItem(tier.id)}
            onDeleteTier={() => void handleDeleteTier(tier)}
            onOpenItem={(item) => {
              setSelectedItemId(item.id);
              setSelectedPhotoIndex(0);
            }}
            onDeleteItem={(item) => void handleDeleteItem(item)}
            onSaveTierName={async (name) => {
              try {
                setError(null);
                await updateTier(tier.id, { name });
                await loadBoard();
              } catch (saveError) {
                setError(saveError instanceof Error ? saveError.message : "保存档位名称失败。");
              }
            }}
            onDragStart={(itemId) => setDraggingItemId(itemId)}
            onDropOnTier={() => void handleMoveItem(tier.id)}
            onDropOnItem={(itemId) => void handleMoveItem(tier.id, itemId)}
            onMoveToTier={(itemId, targetTierId) => void handleMoveItemToTier(itemId, targetTierId)}
            onMoveOrder={(itemId, direction) => void handleMoveItemOrder(itemId, direction)}
          />
        ))}
      </section>

      {selectedItem ? (
        <PhotoModal
          item={selectedItem}
          selectedPhotoIndex={selectedPhotoIndex}
          uploadStatus={uploadStatus}
          onClose={() => setSelectedItemId(null)}
          onSaveName={(name) => void handleSaveItemName(selectedItem, name)}
          onSaveDescription={(description) => void handleSaveItemDescription(selectedItem, description)}
          onUpload={(files) => void handleUpload(files)}
          onDeleteItem={() => void handleDeleteItem(selectedItem)}
          onDeletePhoto={(photo) => void handleDeletePhoto(photo)}
          onSetCoverPhoto={(photo) => void handleSetItemCover(selectedItem, photo)}
          onPreviousPhoto={() =>
            setSelectedPhotoIndex((currentIndex) =>
              selectedItem.photos.length
                ? (currentIndex - 1 + selectedItem.photos.length) % selectedItem.photos.length
                : 0
            )
          }
          onNextPhoto={() =>
            setSelectedPhotoIndex((currentIndex) =>
              selectedItem.photos.length ? (currentIndex + 1) % selectedItem.photos.length : 0
            )
          }
          onSelectPhoto={setSelectedPhotoIndex}
        />
      ) : null}

      {showBackupDrawer ? (
        <div className="drawer-backdrop" onClick={() => setShowBackupDrawer(false)}>
          <aside className="account-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>数据备份与迁移</h2>
                <p style={{ margin: "4px 0 0", color: "#69727d", fontSize: "13px" }}>
                  纯静态离线版数据存储于当前浏览器的 IndexedDB 中。
                </p>
              </div>
              <button type="button" className="close-button" onClick={() => setShowBackupDrawer(false)} title="关闭">
                <X size={20} />
              </button>
            </div>

            <div className="drawer-section">
              {backupMsg ? (
                <div className={`banner ${backupMsg.type === "success" ? "success-banner" : "error-banner"}`}>
                  <span>{backupMsg.text}</span>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: "16px", marginTop: "10px" }}>
                <div style={{ padding: "16px", border: "1px solid #dce1e8", borderRadius: "8px", background: "#fbfcfd" }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>📦 导出备份包 (ZIP)</h3>
                  <p style={{ margin: "0 0 12px", color: "#69727d", fontSize: "13px" }}>
                    将所有排行榜、档位、项目描述以及您上传的全部照片/视频打包为压缩包下载。
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

                <div style={{ padding: "16px", border: "1px solid #dce1e8", borderRadius: "8px", background: "#fbfcfd" }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>📥 导入恢复数据</h3>
                  <p style={{ margin: "0 0 12px", color: "#69727d", fontSize: "13px" }}>
                    选择之前导出的 ZIP 备份文件，系统将读取并在当前浏览器中恢复所有数据与照片。
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

interface TierRowProps {
  tier: Tier;
  accent: string;
  availableTiers: Array<{ id: number; name: string }>;
  newItemName: string;
  draggingItemId: number | null;
  onNewItemNameChange: (value: string) => void;
  onAddItem: () => void;
  onDeleteTier: () => void;
  onOpenItem: (item: Item) => void;
  onDeleteItem: (item: Item) => void;
  onSaveTierName: (name: string) => Promise<void>;
  onDragStart: (itemId: number) => void;
  onDropOnTier: () => void;
  onDropOnItem: (itemId: number) => void;
  onMoveToTier: (itemId: number, targetTierId: number) => void;
  onMoveOrder: (itemId: number, direction: "prev" | "next") => void;
}

function TierRow({
  tier,
  accent,
  availableTiers,
  newItemName,
  draggingItemId,
  onNewItemNameChange,
  onAddItem,
  onDeleteTier,
  onOpenItem,
  onDeleteItem,
  onSaveTierName,
  onDragStart,
  onDropOnTier,
  onDropOnItem,
  onMoveToTier,
  onMoveOrder
}: TierRowProps) {
  function handleRowDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    onDropOnTier();
  }

  function handleNewItemKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      onAddItem();
    }
  }

  return (
    <div className="tier-row" style={{ "--tier-accent": accent } as React.CSSProperties}>
      <div className="tier-cell">
        <EditableTierName name={tier.name} onSave={onSaveTierName} />
        <button className="icon-button subtle" type="button" onClick={onDeleteTier} title="删除档位">
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="items-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleRowDrop}>
        {tier.items.map((item, index) => (
          <ItemCard
            key={item.id}
            item={item}
            availableTiers={availableTiers}
            isFirst={index === 0}
            isLast={index === tier.items.length - 1}
            isDragging={draggingItemId === item.id}
            onOpen={() => onOpenItem(item)}
            onDelete={() => onDeleteItem(item)}
            onDragStart={() => onDragStart(item.id)}
            onDropBefore={() => onDropOnItem(item.id)}
            onMoveToTier={(targetTierId) => onMoveToTier(item.id, targetTierId)}
            onMoveOrder={(direction) => onMoveOrder(item.id, direction)}
          />
        ))}
        <div className="new-item-form">
          <input
            value={newItemName}
            onChange={(event) => onNewItemNameChange(event.target.value)}
            onKeyDown={handleNewItemKeyDown}
            placeholder="项目名称"
            aria-label={`${tier.name} 新项目名称`}
          />
          <button className="icon-button" type="button" onClick={onAddItem} title="新增项目">
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface EditableTierNameProps {
  name: string;
  onSave: (name: string) => Promise<void>;
}

function EditableTierName({ name, onSave }: EditableTierNameProps) {
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  async function commit() {
    const normalized = draft.trim();
    if (!normalized || normalized === name) {
      setDraft(name);
      return;
    }
    await onSave(normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(name);
      event.currentTarget.blur();
    }
  }

  return (
    <input
      className="tier-name-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={handleKeyDown}
      aria-label="档位名称"
    />
  );
}

interface EditableBoardNameProps {
  name: string;
  onSave: (name: string) => Promise<void>;
}

function EditableBoardName({ name, onSave }: EditableBoardNameProps) {
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  async function commit() {
    const normalized = draft.trim();
    if (!normalized || normalized === name) {
      setDraft(name);
      return;
    }
    await onSave(normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(name);
      event.currentTarget.blur();
    }
  }

  return (
    <input
      className="board-name-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={handleKeyDown}
      aria-label="排行榜名称"
    />
  );
}

interface ItemCardProps {
  item: Item;
  availableTiers: Array<{ id: number; name: string }>;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDropBefore: () => void;
  onMoveToTier: (targetTierId: number) => void;
  onMoveOrder: (direction: "prev" | "next") => void;
}

function ItemCard({
  item,
  availableTiers,
  isFirst,
  isLast,
  isDragging,
  onOpen,
  onDelete,
  onDragStart,
  onDropBefore,
  onMoveToTier,
  onMoveOrder
}: ItemCardProps) {
  const coverPhoto = coverPhotoForItem(item);

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    onDropBefore();
  }

  return (
    <article
      className={`item-card${isDragging ? " dragging" : ""}`}
      draggable
      onClick={onOpen}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onOpen();
        }
      }}
    >
      <div className="item-card-top">
        <GripVertical size={16} aria-hidden="true" />
        <button
          className="icon-button ghost danger"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          title="删除项目"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>

      {coverPhoto ? (
        <div className="item-card-cover">
          <img src={coverPhoto.url} alt={`${item.name} 封面`} loading="lazy" />
        </div>
      ) : null}

      <strong>{item.name}</strong>
      {item.description ? <p className="item-card-description">{item.description}</p> : null}

      <div className="item-card-footer">
        <span className="photo-count">
          <Film size={14} aria-hidden="true" />
          {item.photos.length}
        </span>
        <div className="item-sort-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-button mini"
            type="button"
            disabled={isFirst}
            onClick={() => onMoveOrder("prev")}
            title="前移"
          >
            <ChevronLeft size={13} aria-hidden="true" />
          </button>
          <select
            className="tier-badge-select"
            value={item.tierId}
            onChange={(e) => onMoveToTier(Number(e.target.value))}
            title="移动到其他档位"
          >
            {availableTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button mini"
            type="button"
            disabled={isLast}
            onClick={() => onMoveOrder("next")}
            title="后移"
          >
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

interface PhotoModalProps {
  item: Item;
  selectedPhotoIndex: number;
  uploadStatus: UploadStatus;
  onClose: () => void;
  onSaveName: (name: string) => void;
  onSaveDescription: (description: string) => void;
  onUpload: (files: FileList | null) => void;
  onDeleteItem: () => void;
  onDeletePhoto: (photo: Photo) => void;
  onSetCoverPhoto: (photo: Photo) => void;
  onPreviousPhoto: () => void;
  onNextPhoto: () => void;
  onSelectPhoto: (index: number) => void;
}

function MediaViewer({ media }: { media: Photo }) {
  if (isImage(media)) {
    return <img src={media.url} alt={media.originalName} />;
  }

  if (isVideo(media)) {
    return <video src={media.url} controls playsInline preload="metadata" />;
  }

  return (
    <div className="empty-viewer">
      <Film size={34} aria-hidden="true" />
      <span>暂不支持预览此文件</span>
    </div>
  );
}

function MediaThumbnail({ media }: { media: Photo }) {
  if (isImage(media)) {
    return <img src={media.url} alt={media.originalName} />;
  }

  if (isVideo(media)) {
    return (
      <div className="video-thumbnail">
        <video src={media.url} muted playsInline preload="metadata" />
        <Film size={20} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="video-thumbnail">
      <Film size={22} aria-hidden="true" />
    </div>
  );
}

function PhotoModal({
  item,
  selectedPhotoIndex,
  uploadStatus,
  onClose,
  onSaveName,
  onSaveDescription,
  onUpload,
  onDeleteItem,
  onDeletePhoto,
  onSetCoverPhoto,
  onPreviousPhoto,
  onNextPhoto,
  onSelectPhoto
}: PhotoModalProps) {
  const [draftName, setDraftName] = useState(item.name);
  const [draftDescription, setDraftDescription] = useState(item.description);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activePhoto = item.photos[selectedPhotoIndex];
  const busyPhotoUpload = uploadStatus.state === "uploading";
  const nameChanged = draftName.trim() !== item.name;
  const descriptionChanged = draftDescription.trim() !== item.description;

  useEffect(() => {
    setDraftName(item.name);
    setDraftDescription(item.description);
  }, [item.id, item.name, item.description]);

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      onSaveName(draftName);
    }

    if (event.key === "Escape") {
      setDraftName(item.name);
      event.currentTarget.blur();
    }
  }

  function handleDescriptionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      onSaveDescription(draftDescription);
    }

    if (event.key === "Escape") {
      setDraftDescription(item.description);
      event.currentTarget.blur();
    }
  }

  function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    event.preventDefault();
    onUpload(event.target.files);
    event.target.value = "";
  }

  function handleUploadClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!busyPhotoUpload) {
      fileInputRef.current?.click();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="photo-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="item-editor">
            <div className="field-save-row">
              <input
                className="item-name-input"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={handleNameKeyDown}
                aria-label="项目名称"
              />
              <button
                className="secondary-button field-save-button"
                type="button"
                onClick={() => onSaveName(draftName)}
                disabled={!nameChanged}
              >
                <Save size={17} aria-hidden="true" />
                保存名称
              </button>
            </div>
            <div className="field-save-row description-row">
              <textarea
                className="item-description-input"
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                onKeyDown={handleDescriptionKeyDown}
                maxLength={2000}
                placeholder="添加项目简介"
                aria-label="项目简介"
              />
              <button
                className="secondary-button field-save-button"
                type="button"
                onClick={() => onSaveDescription(draftDescription)}
                disabled={!descriptionChanged}
              >
                <Save size={17} aria-hidden="true" />
                保存简介
              </button>
            </div>
          </div>
          <div className="modal-actions">
            <button
              className="primary-button"
              type="button"
              onClick={handleUploadClick}
              disabled={busyPhotoUpload}
            >
              {busyPhotoUpload ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
              {busyPhotoUpload ? "保存中" : "本地上传"}
            </button>
            <input
              ref={fileInputRef}
              className="file-input-hidden"
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleUploadChange}
              disabled={busyPhotoUpload}
            />
            <button className="icon-button danger" type="button" onClick={onDeleteItem} title="删除项目">
              <Trash2 size={18} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={onClose} title="关闭">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <UploadStatusPanel uploadStatus={uploadStatus} />

        <div className="viewer">
          {activePhoto ? (
            <>
              <button className="nav-button left" type="button" onClick={onPreviousPhoto} title="上一张">
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
              <MediaViewer media={activePhoto} />
              <button className="nav-button right" type="button" onClick={onNextPhoto} title="下一张">
                <ChevronRight size={24} aria-hidden="true" />
              </button>
            </>
          ) : (
            <div className="empty-viewer">
              <ImageIcon size={34} aria-hidden="true" />
              <span>暂无媒体文件</span>
            </div>
          )}
        </div>

        {activePhoto ? (
          <div className="photo-meta">
            <span>{activePhoto.originalName}</span>
            <span>{fileSizeLabel(activePhoto.sizeBytes)}</span>
          </div>
        ) : null}

        {item.photos.length ? (
          <div className="thumbnail-strip" aria-label="媒体文件列表">
            {item.photos.map((photo, index) => (
              <button
                key={photo.id}
                className={`thumbnail${index === selectedPhotoIndex ? " active" : ""}${photo.id === item.coverPhotoId ? " cover" : ""}`}
                type="button"
                onClick={() => onSelectPhoto(index)}
                title={photo.originalName}
              >
                <MediaThumbnail media={photo} />
                {photo.id === item.coverPhotoId ? <strong className="cover-badge">封面</strong> : null}
                {isImage(photo) && photo.id !== item.coverPhotoId ? (
                  <span
                    className="cover-action"
                    role="button"
                    tabIndex={0}
                    title="设为封面"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetCoverPhoto(photo);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.stopPropagation();
                        onSetCoverPhoto(photo);
                      }
                    }}
                  >
                    封面
                  </span>
                ) : null}
                <span
                  className="delete-media-action"
                  role="button"
                  tabIndex={0}
                  title="删除媒体文件"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeletePhoto(photo);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.stopPropagation();
                      onDeletePhoto(photo);
                    }
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
