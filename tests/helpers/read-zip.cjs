"use strict";
const assert = require("node:assert/strict");
const { crc32 } = require("node:zlib");

module.exports = function readZip(bytes) {
  const buffer = Buffer.from(bytes);
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  const count = buffer.readUInt16LE(end + 10);
  assert.equal(buffer.readUInt16LE(end + 8), count);
  let central = buffer.readUInt32LE(end + 16);
  const centralStart = central;
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(central), 0x02014b50);
    assert.equal(buffer.readUInt16LE(central + 8), 0x0800);
    assert.equal(buffer.readUInt16LE(central + 10), 0);
    const size = buffer.readUInt32LE(central + 24);
    const nameLength = buffer.readUInt16LE(central + 28);
    const name = buffer.subarray(central + 46, central + 46 + nameLength).toString("utf8");
    const local = buffer.readUInt32LE(central + 42);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    assert.equal(buffer.readUInt16LE(local + 6), 0x0800);
    assert.equal(buffer.readUInt16LE(local + 8), 0);
    assert.equal(buffer.readUInt32LE(local + 18), size);
    assert.equal(buffer.readUInt32LE(local + 22), size);
    assert.equal(buffer.readUInt16LE(local + 26), nameLength);
    assert.equal(buffer.subarray(local + 30, local + 30 + nameLength).toString("utf8"), name);
    const data = buffer.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    assert.equal(crc32(data), buffer.readUInt32LE(local + 14));
    assert.equal(crc32(data), buffer.readUInt32LE(central + 16));
    entries.push({ filename: name, contents: data.toString("utf8") });
    central += 46 + nameLength;
  }
  assert.equal(central, end);
  assert.equal(central - centralStart, buffer.readUInt32LE(end + 12));
  return entries;
};
