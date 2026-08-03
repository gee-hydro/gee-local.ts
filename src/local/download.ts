export interface DownloadUrlImage {
  getDownloadURL(
    params: Record<string, unknown>,
    callback: (url?: string, error?: unknown) => void,
  ): void;
}

/** 将 Earth Engine getDownloadURL 回调封装为 Promise。 */
export function getDownloadUrl(
  image: DownloadUrlImage,
  params: Record<string, unknown>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    image.getDownloadURL(params, (url, error) => {
      if (error) reject(new Error(String(error)));
      else if (url) resolve(url);
      else reject(new Error('Earth Engine 未返回下载地址'));
    });
  });
}
