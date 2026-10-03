const DB_NAME = "ranklist_pages_db";
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Boards store
      if (!db.objectStoreNames.contains("boards")) {
        const boardStore = db.createObjectStore("boards", { keyPath: "id", autoIncrement: true });
        boardStore.createIndex("sortOrder", "sortOrder", { unique: false });
      }

      // Tiers store
      if (!db.objectStoreNames.contains("tiers")) {
        const tierStore = db.createObjectStore("tiers", { keyPath: "id", autoIncrement: true });
        tierStore.createIndex("boardId", "boardId", { unique: false });
        tierStore.createIndex("sortOrder", "sortOrder", { unique: false });
      }

      // Items store
      if (!db.objectStoreNames.contains("items")) {
        const itemStore = db.createObjectStore("items", { keyPath: "id", autoIncrement: true });
        itemStore.createIndex("tierId", "tierId", { unique: false });
        itemStore.createIndex("sortOrder", "sortOrder", { unique: false });
      }

      // Photos store (stores metadata + binary Blob)
      if (!db.objectStoreNames.contains("photos")) {
        const photoStore = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
        photoStore.createIndex("itemId", "itemId", { unique: false });
        photoStore.createIndex("sortOrder", "sortOrder", { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function withTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  callback: (transaction: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(storeNames, mode);

  return new Promise((resolve, reject) => {
    let result: T;

    tx.oncomplete = () => {
      resolve(result);
    };

    tx.onerror = () => {
      reject(tx.error);
    };

    tx.onabort = () => {
      reject(tx.error || new Error("Transaction aborted"));
    };

    Promise.resolve(callback(tx))
      .then((res) => {
        result = res;
      })
      .catch((err) => {
        tx.abort();
        reject(err);
      });
  });
}
