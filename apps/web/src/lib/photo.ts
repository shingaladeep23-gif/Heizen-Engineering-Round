// Shrinks a phone photo to at most 1024px on its longest side and re-encodes
// it as JPEG, so a 4MB camera photo becomes roughly 100-200KB before upload.
export async function shrinkPhoto(file: File, maxSide = 1024): Promise<string> {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}
