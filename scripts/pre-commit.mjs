// Git pre-commit hook, installed by simple-git-hooks on `npm install`.
//
// GitHub runs the Action straight from the repository, so `packages/action/dist` is committed
// and must match the sources. This hook rebuilds it and adds it to the commit whenever a staged
// file could change the bundle, so nobody has to remember to do it.
//
// It builds the working tree, not the staged snapshot. If you stage only part of your changes,
// the bundle can include the rest. CI catches any drift this leaves behind.
import { execSync } from "node:child_process";

const BUNDLE = "packages/action/dist";

// Sources of the three packages the bundle is made of, plus anything that changes how it is built.
const AFFECTS_BUNDLE =
  /^(packages\/(core|cli|action)\/(src\/|package\.json$|tsup\.config\.ts$|tsconfig\.json$)|package(-lock)?\.json$|tsconfig\.base\.json$)/;

const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

if (staged.some((path) => AFFECTS_BUNDLE.test(path))) {
  console.log(`trazo: rebuilding ${BUNDLE}...`);
  execSync("npm run build", { stdio: "inherit" });
  execSync(`git add ${BUNDLE}`, { stdio: "inherit" });
}
