import "@testing-library/jest-dom/vitest";

// Radix Select relies on pointer capture and scrollIntoView, which jsdom does not implement.
Object.assign(Element.prototype, {
  hasPointerCapture: () => false,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
});
