import { describe, expect, it } from "vitest";
import { classifyImage } from "../src/extractors/classify.js";

describe("classifyImage", () => {
  it.each([
    ["postgres:16", "database"],
    ["docker.io/library/mysql:8", "database"],
    ["redis:7-alpine", "cache"],
    ["bitnami/kafka:3.7", "queue"],
    ["ghcr.io/acme/backend:1.2", "service"],
  ])("classifies %s as %s", (image, kind) => {
    expect(classifyImage(image)).toBe(kind);
  });

  it("classifies a missing image as a service", () => {
    expect(classifyImage(undefined)).toBe("service");
  });
});
