import { describe, expect, it } from "vitest";
import { ruleFor } from "../src/extractors/rules.js";

describe("ruleFor", () => {
  it("finds nothing without rules or without a key", () => {
    expect(ruleFor(undefined, "x")).toBeUndefined();
    expect(ruleFor({ x: "cache" }, undefined)).toBeUndefined();
    expect(ruleFor({ x: "cache" }, "y")).toBeUndefined();
  });

  it("matches exactly and ignores case", () => {
    expect(ruleFor({ "AWS::S3::Bucket": "queue" }, "aws::s3::bucket")).toBe("queue");
  });

  it("matches only the whole key, not a part of it", () => {
    expect(ruleFor({ redis: "cache" }, "redis-exporter")).toBeUndefined();
  });

  it("treats * as a wildcard and everything else literally", () => {
    expect(ruleFor({ "AWS::EC2::*": "ignore" }, "AWS::EC2::VPC")).toBe("ignore");
    expect(ruleFor({ "Custom::*": "service" }, "Custom::Thing")).toBe("service");
    expect(ruleFor({ "a.b": "cache" }, "aXb")).toBeUndefined();
    expect(ruleFor({ "a(b)+": "cache" }, "a(b)+")).toBe("cache");
  });

  it("prefers the rule with the most literal characters", () => {
    const rules = { "*": "service", "AWS::S3::*": "queue", "AWS::S3::Bucket": "cache" };
    expect(ruleFor(rules, "AWS::S3::Bucket")).toBe("cache");
    expect(ruleFor(rules, "AWS::S3::AccessPoint")).toBe("queue");
    expect(ruleFor(rules, "AWS::SQS::Queue")).toBe("service");
  });
});
