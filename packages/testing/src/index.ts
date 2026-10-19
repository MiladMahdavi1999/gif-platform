/** Original red/blue animation, authored from GIF89a bytes.
 * No external media. Defaults to two 1x1 frames; larger frames use authored checkerboard pixels. */
export function animatedGif(
  options: {
    frameCount?: number;
    delayCentiseconds?: number;
    width?: number;
    height?: number;
  } = {},
): Buffer {
  const {
    frameCount = 2,
    delayCentiseconds = 10,
    width = 1,
    height = 1,
  } = options;
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > 1001 ||
    !Number.isInteger(delayCentiseconds) ||
    delayCentiseconds < 1 ||
    delayCentiseconds > 65535 ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 512 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 512 ||
    width * height * frameCount > 8_000_000
  )
    throw new Error('Invalid original fixture options');
  const header = Buffer.from('GIF89a', 'ascii');
  const screen = Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255]);
  screen.writeUInt16LE(width, 0);
  screen.writeUInt16LE(height, 2);
  const loop = Buffer.from([
    0x21,
    0xff,
    11,
    ...Buffer.from('NETSCAPE2.0'),
    3,
    1,
    0,
    0,
    0,
  ]);
  // Clear before each pixel so all codes remain three bits wide. This
  // deliberately avoids compression: realistic dimensions exceed AVIO's buffer.
  const imageData = (pixel: number) => {
    if (width * height === 1)
      return Buffer.from([2, pixel === 0 ? 0x44 : 0x4c, 1, 0]);
    const count = width * height;
    const packed = Buffer.alloc(Math.ceil(((count * 2 + 1) * 3) / 8));
    let bit = 0;
    const code = (value: number) => {
      for (let j = 0; j < 3; j++, bit++)
        packed[bit >> 3]! |= ((value >> j) & 1) << (bit % 8);
    };
    for (let i = 0; i < count; i++) {
      code(4);
      code((i + pixel) % 2);
    }
    code(5);
    const blocks: Buffer[] = [];
    for (let i = 0; i < packed.length; i += 255) {
      const block = packed.subarray(i, i + 255);
      blocks.push(Buffer.from([block.length]), block);
    }
    return Buffer.concat([...blocks, Buffer.from([0])]);
  };
  const frame = (pixel: number) =>
    Buffer.concat([
      Buffer.from([
        0x21,
        0xf9,
        4,
        0,
        delayCentiseconds & 255,
        delayCentiseconds >> 8,
        0,
        0, // 100ms, no transparency
        0x2c,
        0,
        0,
        0,
        0,
        width & 255,
        width >> 8,
        height & 255,
        height >> 8,
        0, // image descriptor
        2,
      ]),
      imageData(pixel),
    ]);
  return Buffer.concat([
    header,
    screen,
    loop,
    ...Array.from({ length: frameCount }, (_, i) => frame(i % 2)),
    Buffer.from([0x3b]),
  ]);
}
