import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as path from 'path';
import * as Minio from 'minio';
import type { BucketItem } from 'minio';
import type { Readable } from 'stream';

export interface UploadableFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface UploadedObject {
  bucketName: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string | null;
}

@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  private readonly minioClient: Minio.Client;

  constructor(private readonly configService: ConfigService) {
    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_HOST', '127.0.0.1'),
      port: Number(this.configService.get<string>('MINIO_PORT', '9000')),
      useSSL: this.configService.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY', ''),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY', ''),
    });
  }

  async createBucketIfNotExists(bucketName: string): Promise<void> {
    const safeBucketName = this.normalizeBucketName(bucketName);

    try {
      const bucketExists = await this.minioClient.bucketExists(safeBucketName);
      if (bucketExists) return;

      this.logger.log(`Creating MinIO bucket: ${safeBucketName}`);
      await this.minioClient.makeBucket(safeBucketName);
    } catch (error) {
      if (this.isBucketAlreadyExistsError(error)) return;
      this.logger.error(
        `Failed to create MinIO bucket ${safeBucketName}`,
        error,
      );
      throw new InternalServerErrorException('Failed to prepare file storage');
    }
  }

  async uploadFile({
    bucketName,
    file,
    objectPrefix,
    fileName,
  }: {
    bucketName: string;
    file: UploadableFile;
    objectPrefix?: string;
    fileName?: string;
  }): Promise<UploadedObject> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }

    const safeBucketName = this.normalizeBucketName(bucketName);
    const objectName =
      fileName ?? this.buildObjectName(file.originalname, objectPrefix);

    await this.createBucketIfNotExists(safeBucketName);

    try {
      await this.minioClient.putObject(
        safeBucketName,
        objectName,
        file.buffer,
        file.size,
        { 'Content-Type': file.mimetype },
      );

      return {
        bucketName: safeBucketName,
        fileName: objectName,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: await this.getFileUrl(safeBucketName, objectName),
      };
    } catch (error) {
      this.logger.error(`Failed to upload ${objectName}`, error);
      throw new HttpException('Error uploading file', HttpStatus.BAD_REQUEST);
    }
  }

  async getFileUrl(
    bucketName: string,
    fileName: string,
    expirySeconds = 24 * 60 * 60,
  ): Promise<string | null> {
    try {
      return await this.minioClient.presignedUrl(
        'GET',
        this.normalizeBucketName(bucketName),
        fileName,
        expirySeconds,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to sign MinIO URL for ${bucketName}/${fileName}`,
      );
      return null;
    }
  }

  async getFileContent(bucketName: string, fileName: string): Promise<Buffer> {
    try {
      const stream = await this.minioClient.getObject(
        this.normalizeBucketName(bucketName),
        fileName,
      );
      return this.streamToBuffer(stream);
    } catch (error) {
      this.logger.error(`Failed to read ${bucketName}/${fileName}`, error);
      throw new InternalServerErrorException('Failed to retrieve file content');
    }
  }

  async deleteFile(bucketName: string, fileName: string): Promise<void> {
    try {
      await this.minioClient.removeObject(
        this.normalizeBucketName(bucketName),
        fileName,
      );
    } catch (error) {
      this.logger.warn(`Failed to delete ${bucketName}/${fileName}`);
    }
  }

  async deleteBucket(bucketName: string): Promise<void> {
    const safeBucketName = this.normalizeBucketName(bucketName);
    const bucketExists = await this.minioClient.bucketExists(safeBucketName);
    if (!bucketExists) return;

    const objectNames = await this.listBucketObjectNames(safeBucketName);
    if (objectNames.length) {
      await this.minioClient.removeObjects(safeBucketName, objectNames);
    }
    await this.minioClient.removeBucket(safeBucketName);
  }

  async checkFileExistsInBucket(
    bucketName: string,
    fileName: string,
  ): Promise<boolean> {
    try {
      await this.minioClient.statObject(
        this.normalizeBucketName(bucketName),
        fileName,
      );
      return true;
    } catch {
      return false;
    }
  }

  private buildObjectName(originalName: string, objectPrefix?: string): string {
    const extension = path.extname(originalName);
    const baseName = path
      .basename(originalName, extension)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    const uniqueSuffix = crypto.randomUUID();
    const cleanPrefix = objectPrefix
      ?.split('/')
      .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, '-'))
      .filter(Boolean)
      .join('/');

    return [cleanPrefix, `${baseName || 'file'}-${uniqueSuffix}${extension}`]
      .filter(Boolean)
      .join('/');
  }

  private normalizeBucketName(bucketName: string): string {
    const safeBucketName = bucketName.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(safeBucketName)) {
      throw new BadRequestException('Invalid bucket name');
    }
    return safeBucketName;
  }

  private async listBucketObjectNames(bucketName: string): Promise<string[]> {
    const objectStream = this.minioClient.listObjectsV2(bucketName, '', true);

    return new Promise((resolve, reject) => {
      const objectNames: string[] = [];

      objectStream.on('data', (item: BucketItem) => {
        if (item.name) objectNames.push(item.name);
      });
      objectStream.on('error', reject);
      objectStream.on('end', () => resolve(objectNames));
    });
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private isBucketAlreadyExistsError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(
        String((error as { code?: unknown }).code),
      )
    );
  }
}
