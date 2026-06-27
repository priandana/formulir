const fs = require('fs');
const path = require('path');

// Simple mock of DOM elements
class MockNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.classList = {
      list: new Set(),
      add(c) { this.list.add(c); },
      remove(c) { this.list.delete(c); },
      contains(c) { return this.list.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.list.has(c)) this.list.delete(c);
          else this.list.add(c);
        } else if (force) {
          this.list.add(c);
        } else {
          this.list.delete(c);
        }
      }
    };
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(newNode, referenceNode) {
    newNode.parentNode = this;
    const idx = this.childNodes.indexOf(referenceNode);
    if (idx === -1) {
      this.childNodes.push(newNode);
    } else {
      this.childNodes.splice(idx, 0, newNode);
    }
    return newNode;
  }

  setAttribute(name, val) {}
  getAttribute(name) { return ''; }
  addEventListener(event, callback) {}
  dispatchEvent(event) {}
}

class MockSelect extends MockNode {
  constructor() {
    super('select');
    this.options = [];
    this.selectedIndex = 0;
    this.value = '';
  }
}

// Mock document
const documentMock = {
  querySelectorAll(selector) {
    if (selector === 'select.form-control') {
      return [new MockSelect()];
    }
    return [];
  },
  createElement(tag) {
    if (tag === 'select') return new MockSelect();
    return new MockNode(tag);
  },
  addEventListener(event, callback) {}
};

global.document = documentMock;
global.window = {
  AudioContext: class {},
  webkitAudioContext: class {},
  addEventListener(event, callback) {},
  location: { href: '' }
};
global.HTMLSelectElement = MockSelect;

// Let's load the file admin.js, extract initCustomSelects, and run it
const adminJsPath = path.join(__dirname, '..', 'public', 'js', 'admin.js');
let adminJsContent = fs.readFileSync(adminJsPath, 'utf8');

// Find initCustomSelects function
const match = adminJsContent.match(/function initCustomSelects\(\)[\s\S]*?function closeAllCustomDropdowns/);
if (match) {
  console.log('Found initCustomSelects');
  const codeToRun = match[0] + '\ncloseAllCustomDropdowns() }';
  try {
    // We need to define select.options and other prototype details
    global.HTMLSelectElement.prototype = MockSelect.prototype;
    
    // Evaluate the code
    eval(codeToRun);
    console.log('Definition successful');
    
    // Run it
    initCustomSelects();
    console.log('Execution successful!');
  } catch (err) {
    console.error('Error executing initCustomSelects:', err);
  }
} else {
  console.log('Could not find initCustomSelects');
}
