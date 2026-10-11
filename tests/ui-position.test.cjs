"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
require("../src/model.js");
require("../src/adapters/chatgpt-dom.js");
require("../src/ui-position.js");
const { besideComposer, create } = globalThis.Chatcouter.uiPosition;
const rect = { left: 200, top: 700, right: 1000, bottom: 800, width: 800, height: 100 };
const size = { width: 250, height: 80 };

test("places the whole UI outside the composer with bottom edges aligned", () => {
  assert.deepEqual(besideComposer(rect, size, { width: 1400, height: 900 }), { left: 1008, top: 720 });
});

test("keeps partial width but hides when entirely outside, offscreen, absent or unmeasurable", () => {
  const viewport = { width: 1400, height: 900 };
  assert.equal(besideComposer(rect, size, { ...viewport, width: 1100 })?.left, 1008);
  assert.equal(besideComposer(rect, size, { ...viewport, width: 1008 }), null);
  assert.equal(besideComposer(null, size, viewport), null);
  assert.equal(besideComposer({ ...rect, bottom: 901 }, size, viewport), null);
  assert.equal(besideComposer({ ...rect, left: -1 }, size, viewport), null);
  assert.equal(besideComposer({ ...rect, top: -1 }, size, viewport), null);
  assert.equal(besideComposer({ ...rect, bottom: 81 }, size, viewport), null);
  assert.equal(besideComposer({ ...rect, width: 0 }, size, viewport), null);
  assert.equal(besideComposer(rect, { ...size, height: 0 }, viewport), null);
});

test("uses the input form rather than the editable area and fails closed without it", () => {
  const form = { getBoundingClientRect: () => rect };
  const adapter = globalThis.Chatcouter.chatGptDomAdapter;
  assert.equal(adapter.getComposerRegion({ querySelectorAll: () => [{ closest: (s) => s === "form" ? form : null }] }), form);
  assert.equal(adapter.getComposerRegion({ querySelectorAll: () => [{ closest: () => null }] }), null);
  assert.equal(adapter.getComposerRegion({ querySelectorAll: () => [] }), null);
});

test("selects the visible composer across A to B to A without returning home", () => {
  let active = "A";
  const forms = Object.fromEntries(["A", "B"].map((name) => [name, {
    getBoundingClientRect: () => active === name ? rect : { width: 0, height: 0 },
  }]));
  const root = { querySelectorAll: () => ["A", "B"].map((name) => ({
    closest: (selector) => selector === "form" ? forms[name] : null,
  })) };
  const adapter = globalThis.Chatcouter.chatGptDomAdapter;
  assert.equal(adapter.getComposerRegion(root), forms.A);
  active = "B";
  assert.equal(adapter.getComposerRegion(root), forms.B);
  active = "A";
  assert.equal(adapter.getComposerRegion(root), forms.A);
});

test("skips cached inputs hidden by visibility or hidden/inert ancestors", () => {
  const form = { getBoundingClientRect: () => rect };
  const input = (visible, hidden = false) => ({
    closest: (selector) => selector === "form" ? form : hidden ? {} : null,
    checkVisibility: () => visible,
  });
  const adapter = globalThis.Chatcouter.chatGptDomAdapter;
  assert.equal(adapter.getComposerRegion({ querySelectorAll: () => [input(false), input(true, true)] }), null);
  assert.equal(adapter.getComposerRegion({ querySelectorAll: () => [input(false), input(true)] }), form);
});

test("recovers after resize, observes replacement and disposes listeners", () => {
  let callback;
  let requests = 0;
  let disconnected = false;
  const observed = new Set();
  const listeners = new Map();
  const host = { style: {}, getBoundingClientRect: () => size };
  let composer = { getBoundingClientRect: () => rect };
  const root = { clientWidth: 1008, clientHeight: 900 };
  const window = {
    getComputedStyle() { return { fontFamily: "Arial, sans-serif" }; },
    ResizeObserver: class {
      observe(x) { observed.add(x); }
      unobserve(x) { observed.delete(x); }
      disconnect() { disconnected = true; }
    },
    requestAnimationFrame(fn) { callback = fn; requests++; return requests; },
    cancelAnimationFrame() { callback = null; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const positioner = create({ host, getComposer: () => composer, document: { documentElement: root }, window });
  positioner.schedule();
  assert.equal(requests, 1);
  callback();
  assert.equal(host.style.visibility, "hidden");
  assert.equal(host.inert, true);
  root.clientWidth = 1400;
  listeners.get("resize")();
  callback();
  assert.equal(host.style.visibility, "visible");
  assert.equal(host.style.left, "1008px");
  assert.equal(host.style.clipPath, "inset(0px 0px 0px 0px)");
  assert.equal(host.style.fontFamily, "Arial, sans-serif");
  assert.equal(host.inert, false);
  const previous = composer;
  composer = { getBoundingClientRect: () => ({ ...rect, right: 1050 }) };
  positioner.schedule();
  callback();
  assert.equal(observed.has(previous), false);
  assert.equal(observed.has(composer), true);
  composer = null;
  positioner.schedule();
  callback();
  assert.equal(host.style.visibility, "hidden");
  positioner.destroy();
  assert.equal(disconnected, true);
  assert.equal(listeners.size, 0);
});

test("clips against explicit overflow ancestors, recovers as their edge moves, and ignores visible-overflow widths", () => {
  let callback;
  const root = { clientWidth: 1600, clientHeight: 900 };
  let edge = 1140;
  let overflowX = "hidden";
  const pane = {
    parentElement: root,
    getBoundingClientRect: () => ({ left: 100, top: 0, right: edge, bottom: 900, width: edge - 100, height: 900 }),
  };
  const composer = { parentElement: pane, getBoundingClientRect: () => rect };
  const host = { style: {}, getBoundingClientRect: () => size };
  const window = {
    getComputedStyle: element => ({ fontFamily: "Arial", overflowX: element === pane ? overflowX : "hidden", overflowY: "visible" }),
    requestAnimationFrame: fn => { callback = fn; return 1; },
    cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
  };
  const positioner = create({ host, getComposer: () => composer, document: { documentElement: root }, window });
  callback();
  assert.equal(host.style.left, "1008px");
  assert.equal(host.style.clipPath, "inset(0px 118px 0px 0px)");
  assert.equal(host.inert, false);
  edge = 1008;
  positioner.schedule(); callback();
  assert.equal(host.style.visibility, "hidden");
  assert.equal(host.inert, true);
  edge = 1500;
  positioner.schedule(); callback();
  assert.equal(host.style.visibility, "visible");
  assert.equal(host.style.clipPath, "inset(0px 0px 0px 0px)");
  edge = 1008; overflowX = "visible";
  positioner.schedule(); callback();
  assert.equal(host.style.visibility, "visible");
  assert.equal(host.style.clipPath, "inset(0px 0px 0px 0px)");
  root.clientWidth = 1100;
  positioner.schedule(); callback();
  assert.equal(host.style.clipPath, "inset(0px 158px 0px 0px)");
  positioner.destroy();
});

test("intersects nested axis clipping at the padding box and observes all existing ancestors", () => {
  let callback;
  const observed = new Set();
  const root = { clientWidth: 1600, clientHeight: 900 };
  const outer = {
    parentElement: root,
    getBoundingClientRect: () => ({ left: 0, top: 730, width: 1300, height: 100 }),
    clientTop: 2, clientHeight: 96,
  };
  const inner = {
    parentElement: outer,
    getBoundingClientRect: () => ({ left: 100, top: 0, width: 1060, height: 900 }),
    clientLeft: 2, clientWidth: 1056,
  };
  const composer = { parentElement: inner, getBoundingClientRect: () => rect };
  const host = { style: {}, getBoundingClientRect: () => size };
  const window = {
    getComputedStyle: element => ({ fontFamily: "Arial", overflowX: element === inner ? "clip" : "visible",
      overflowY: element === outer ? "auto" : "visible" }),
    ResizeObserver: class { observe(x) { observed.add(x); } disconnect() {} },
    requestAnimationFrame: fn => { callback = fn; return 1; },
    cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
  };
  const positioner = create({ host, getComposer: () => composer, document: { documentElement: root }, window });
  callback();
  assert.equal(host.style.clipPath, "inset(12px 100px 0px 0px)");
  for (const element of [inner, outer, composer, host, root]) assert.equal(observed.has(element), true);
  positioner.destroy();
});

test("uses viewport bounds for root/body overflow rather than a zero-height body box", () => {
  let callback;
  const root = { clientWidth: 1400, clientHeight: 900 };
  const body = { parentElement: root, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1400, height: 0 }) };
  const composer = { parentElement: body, getBoundingClientRect: () => rect };
  const host = { style: {}, getBoundingClientRect: () => size };
  const window = {
    getComputedStyle: () => ({ fontFamily: "Arial", overflowX: "hidden", overflowY: "hidden" }),
    requestAnimationFrame: fn => { callback = fn; return 1; },
    cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
  };
  const positioner = create({ host, getComposer: () => composer, document: { documentElement: root, body }, window });
  callback();
  assert.equal(host.style.visibility, "visible");
  assert.equal(host.style.clipPath, "inset(0px 0px 0px 0px)");
  positioner.destroy();
});
