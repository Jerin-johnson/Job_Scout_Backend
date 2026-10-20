export interface IPresignedUploadOptions {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}

export interface IPresignedUploadResult {
  uploadUrl: string;
  requiredHeaders: {
    "Content-Type": string;
  };
}

export interface IObjectMetadata {
  contentLength?: number;
  contentType?: string;
  etag?: string;
}

export interface IUploadFileOptions {
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface IGetFileOptions {
  key: string;
  etag?: string;
}

export interface IStorageService {
  createPresignedUpload(options: IPresignedUploadOptions): Promise<IPresignedUploadResult>;
  getObjectMetadata(options: { key: string }): Promise<IObjectMetadata>;
  uploadFile(options: IUploadFileOptions): Promise<string>;
  getFile(options: IGetFileOptions): Promise<Buffer>;
  deleteFile(options: { key: string }): Promise<void>;
}
