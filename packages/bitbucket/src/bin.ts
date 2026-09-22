#!/usr/bin/env node
import { runBitbucketComment } from "./comment.js";

runBitbucketComment().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
