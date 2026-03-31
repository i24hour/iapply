import fs from 'fs';
import path from 'path';

export function getUploadsRoot() {
  if (process.env.VERCEL) {
    return path.join('/tmp', 'uploads');
  }
  return path.join(process.cwd(), 'uploads');
}

export function ensureUploadsSubdir(subdir: string) {
  const root = getUploadsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const target = path.join(root, subdir);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

export function getUploadsPublicUrl(subdir: string, fileName: string) {
  return `/uploads/${subdir}/${fileName}`;
}
