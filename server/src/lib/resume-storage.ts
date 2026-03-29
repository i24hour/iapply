import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

type UploadInput = {
  userId: string;
  fileName: string;
  buffer: Buffer;
  contentType: string;
};

type DownloadResult = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
};

const LOCAL_RESUME_DIR = path.join(process.cwd(), 'uploads', 'resumes');

let s3Client: S3Client | null = null;

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function slugify(value: string) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'resume';
}

function getBucket() {
  return normalizeText(process.env.AWS_S3_BUCKET);
}

function isAwsConfigured() {
  return Boolean(
    normalizeText(process.env.AWS_REGION) &&
      normalizeText(process.env.AWS_ACCESS_KEY_ID) &&
      normalizeText(process.env.AWS_SECRET_ACCESS_KEY) &&
      getBucket()
  );
}

function getS3Client() {
  if (!isAwsConfigured()) {
    throw new Error('AWS S3 is not configured. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET.');
  }

  if (!s3Client) {
    s3Client = new S3Client({ region: process.env.AWS_REGION });
  }
  return s3Client;
}

function parseS3Uri(uri: string) {
  const trimmed = normalizeText(uri);
  if (!trimmed.startsWith('s3://')) return null;
  const withoutPrefix = trimmed.slice(5);
  const firstSlash = withoutPrefix.indexOf('/');
  if (firstSlash <= 0) return null;
  const bucket = withoutPrefix.slice(0, firstSlash);
  const key = withoutPrefix.slice(firstSlash + 1);
  if (!bucket || !key) return null;
  return { bucket, key };
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
}

function ensureLocalDir() {
  if (!fs.existsSync(LOCAL_RESUME_DIR)) {
    fs.mkdirSync(LOCAL_RESUME_DIR, { recursive: true });
  }
}

function inferContentTypeFromFileName(fileName: string) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}

export function isS3ResumeUrl(fileUrl: string) {
  return Boolean(parseS3Uri(fileUrl));
}

export function getLocalResumeAbsolutePath(fileUrl: string) {
  const cleaned = normalizeText(fileUrl).replace(/^\/+/, '');
  return path.join(process.cwd(), cleaned);
}

export async function saveResumeBinary(input: UploadInput) {
  const cleanFileName = slugify(input.fileName.replace(/\.[a-z0-9]+$/i, '')) + path.extname(input.fileName || '.docx');

  if (isAwsConfigured()) {
    const client = getS3Client();
    const bucket = getBucket();
    const prefix = normalizeText(process.env.AWS_S3_PREFIX || 'iapply/resumes');
    const key = `${prefix}/${input.userId}/${Date.now()}-${cleanFileName}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.contentType,
        CacheControl: 'private, max-age=0, no-cache',
      })
    );

    return {
      fileUrl: `s3://${bucket}/${key}`,
      storage: 's3' as const,
      objectKey: key,
      fileName: cleanFileName,
    };
  }

  ensureLocalDir();
  const localFileName = `${input.userId}-${Date.now()}-${cleanFileName}`;
  const localPath = path.join(LOCAL_RESUME_DIR, localFileName);
  fs.writeFileSync(localPath, input.buffer);

  return {
    fileUrl: `/uploads/resumes/${localFileName}`,
    storage: 'local' as const,
    objectKey: localPath,
    fileName: cleanFileName,
  };
}

export async function loadResumeBinary(fileUrl: string, fallbackFileName = 'resume.docx'): Promise<DownloadResult> {
  const s3Ref = parseS3Uri(fileUrl);
  if (s3Ref) {
    const client = getS3Client();
    const object = await client.send(
      new GetObjectCommand({
        Bucket: s3Ref.bucket,
        Key: s3Ref.key,
      })
    );

    const body = object.Body;
    if (!body) throw new Error('S3 object body is empty');

    const buffer = await streamToBuffer(body);
    const keyName = s3Ref.key.split('/').pop() || fallbackFileName;
    return {
      buffer,
      contentType: normalizeText(object.ContentType) || inferContentTypeFromFileName(keyName),
      fileName: keyName,
    };
  }

  if (normalizeText(fileUrl).startsWith('/uploads/')) {
    const absolutePath = getLocalResumeAbsolutePath(fileUrl);
    if (!fs.existsSync(absolutePath)) {
      throw new Error('Local resume file not found');
    }
    const fileName = path.basename(absolutePath) || fallbackFileName;
    return {
      buffer: fs.readFileSync(absolutePath),
      contentType: inferContentTypeFromFileName(fileName),
      fileName,
    };
  }

  if (/^https?:\/\//i.test(normalizeText(fileUrl))) {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download resume from URL (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || inferContentTypeFromFileName(fallbackFileName),
      fileName: fallbackFileName,
    };
  }

  throw new Error('Unsupported resume file_url format');
}
