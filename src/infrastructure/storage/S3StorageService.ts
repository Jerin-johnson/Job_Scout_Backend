import { injectable } from "tsyringe";
import {
  IStorageService,
  IPresignedUploadOptions,
  IPresignedUploadResult,
  IObjectMetadata,
  IUploadFileOptions,
  IGetFileOptions,
} from "../../domain/storage/IStorageService.js";
import { storageService } from "../../services/storageService.js";

@injectable()
export class S3StorageService implements IStorageService {
  async createPresignedUpload(options: IPresignedUploadOptions): Promise<IPresignedUploadResult> {
    return storageService.createPresignedUpload(options);
  }

  async getObjectMetadata(options: { key: string }): Promise<IObjectMetadata> {
    return storageService.getObjectMetadata(options);
  }

  async uploadFile(options: IUploadFileOptions): Promise<string> {
    return storageService.uploadFile(options);
  }

  async getFile(options: IGetFileOptions): Promise<Buffer> {
    return storageService.getFile({ key: options.key, etag: options.etag });
  }

  async deleteFile(options: { key: string }): Promise<void> {
    await storageService.deleteFile(options);
  }
}
