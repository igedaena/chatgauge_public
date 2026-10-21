"use strict";

// A tree-backed DOM for the meter: setters clear children and selectors search
// descendants, so structural assertions exercise the nodes the UI constructs.
module.exports = function meterDom(nodes) {
  return class Element {
    constructor(tagName = "div", namespaceURI = "http://www.w3.org/1999/xhtml") {
      this.tagName = tagName;
      this.namespaceURI = namespaceURI;
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.attributes = {};
      this.children = [];
      this.text = "";
    }
    set innerHTML(value) { throw new Error("Meter must construct DOM without innerHTML"); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.text = String(value); this.children = []; }
    set className(value) { this.setAttribute("class", value); }
    get className() { return this.attributes.class || ""; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") for (const part of value.split(/\s+/)) nodes[`.${part}`] = this;
      if (name === "id") { this.id = value; nodes[`#${value}`] = this; }
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
      const matches = node => selector.startsWith(".") ? node.className.split(/\s+/).includes(selector.slice(1))
        : selector.startsWith("#") ? node.id === selector.slice(1) : node.tagName === selector;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.text = ""; this.children = children; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    attachShadow() { return this.shadowRoot = new this.constructor("shadow-root"); }
    closest() { return null; }
    remove() {}
    click() { if (!this.disabled && !this.hidden) this.listeners.click?.(); }
  };
};
