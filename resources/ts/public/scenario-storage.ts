import { validateSavedScenario, type SavedScenario } from './scenarios';

const DATABASE = 'bracket-lab';
const STORE = 'scenarios';

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('storage_blocked'));
    });
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = database.transaction(STORE, mode);
            const request = operation(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally { database.close(); }
}

export async function listScenarios(): Promise<SavedScenario[]> {
    const values = await transaction<SavedScenario[]>('readonly', (store) => store.getAll());
    return values.map(validateSavedScenario).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function storeScenario(doc: SavedScenario): Promise<void> {
    await transaction('readwrite', (store) => store.put(validateSavedScenario(doc)));
}

export async function removeScenario(id: string): Promise<void> {
    await transaction('readwrite', (store) => store.delete(id));
}
