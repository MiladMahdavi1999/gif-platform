/** Original two-frame 1x1 red/blue animation, authored from GIF89a bytes.
 * No external media. Each LZW block encodes one independently chosen pixel. */
export function animatedGif(): Buffer {
  const header = Buffer.from('GIF89a', 'ascii');
  const screen = Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255]);
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
  const frame = (pixel: number) =>
    Buffer.from([
      0x21,
      0xf9,
      4,
      0,
      10,
      0,
      0,
      0, // 100ms, no transparency
      0x2c,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0, // image descriptor
      2,
      2,
      pixel === 0 ? 0x44 : 0x4c,
      1,
      0, // LZW clear, pixel, end
    ]);
  return Buffer.concat([
    header,
    screen,
    loop,
    frame(0),
    frame(1),
    Buffer.from([0x3b]),
  ]);
}
