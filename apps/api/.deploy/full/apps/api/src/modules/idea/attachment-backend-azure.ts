import { BlobServiceClient, type ContainerClient, RestError } from "@azure/storage-blob";
import type { AttachmentBackend } from "./attachments.js";

/**
 * Azure Blob Storage — the backend that survives a restart and works across more than
 * one API instance, unlike `LocalDiskBackend` (see `attachments.ts`).
 *
 * Isolated in its own file so `@azure/storage-blob` is only ever imported when this
 * backend is actually selected (`ATTACHMENT_STORAGE_PROVIDER=azure-blob`) — a local-disk
 * deployment never has to know the package exists.
 */
export class AzureBlobBackend implements AttachmentBackend {
  private readonly container: ContainerClient;
  private ensured: Promise<void> | null = null;

  constructor(connectionString: string, containerName: string) {
    this.container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
  }

  /**
   * Created lazily, on the first real use, and only once per process — not at
   * construction, so building the backend never itself makes a network call, and not on
   * every write, so a container that already exists (the common case after the first
   * deploy) costs nothing extra per upload.
   */
  private ensureContainer(): Promise<void> {
    this.ensured ??= this.container.createIfNotExists().then(() => undefined);
    return this.ensured;
  }

  async write(key: string, data: Buffer): Promise<void> {
    await this.ensureContainer();
    await this.container.getBlockBlobClient(key).uploadData(data);
  }

  async read(key: string): Promise<NodeJS.ReadableStream | null> {
    try {
      const download = await this.container.getBlockBlobClient(key).download();
      return download.readableStreamBody ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.container.getBlockBlobClient(key).exists();
  }

  async remove(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof RestError && error.statusCode === 404;
}
