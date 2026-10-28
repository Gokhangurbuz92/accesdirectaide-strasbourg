import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock @/ dependency used by FalcSummary
vi.mock('@/lib/htmlText', () => ({
  htmlToPlainText: (html) => html ? html.replace(/<[^>]*>/g, '') : '',
}));

import FalcSummary from "../../src/components/FalcSummary.jsx";

describe("FalcSummary", () => {
  it("renders nothing when empty", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: "" }));
    expect(html).toBe("");
  });

  it("renders title and text when provided", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: "Bonjour" }));
    expect(html).toContain("Résumé facile à lire");
    expect(html).toContain("Bonjour");
  });

  it("renders nothing when text is null", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: null }));
    expect(html).toBe("");
  });

  it("renders nothing when text is undefined", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: undefined }));
    expect(html).toBe("");
  });

  it("renders nothing when text is only whitespace", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: "   " }));
    expect(html).toBe("");
  });

  it("renders with custom title", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: "Test", title: "Custom Title" }));
    expect(html).toContain("Custom Title");
    expect(html).toContain("Test");
  });

  it("renders with custom className", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: "Test", className: "my-custom-class" }));
    expect(html).toContain("my-custom-class");
  });

  it("renders FALC badge", () => {
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: "Test" }));
    expect(html).toContain("FALC");
  });

  it("preserves multiline text", () => {
    const multilineText = "Line 1\nLine 2\nLine 3";
    const html = renderToStaticMarkup(React.createElement(FalcSummary, { text: multilineText }));
    expect(html).toContain("Line 1");
    expect(html).toContain("Line 2");
    expect(html).toContain("Line 3");
  });
});
