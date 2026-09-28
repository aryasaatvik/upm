import { tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

import rootPackage from "../package.json" with { type: "json" };

const REPOSITORY = "aryasaatvik/upm";
const PACKAGE_ID = "npm:@aryasaatvik/upm";

const upmTag = (): TegamiPlugin => ({
  name: "upm-tag",
  enforce: "post",
  initPublishPlan({ plan }) {
    const pkg = this.graph.get(PACKAGE_ID);
    const packagePlan = plan.packages.get(PACKAGE_ID);
    if (!pkg?.version || !packagePlan) return;

    packagePlan.git ??= {};
    packagePlan.git.tag = `v${pkg.version}`;
  },
});

if (rootPackage.name !== "@aryasaatvik/upm") throw new Error("unexpected release package");

const paper = tegami({
  ignore: ["upm-web"],
  npm: {
    client: "npm",
    updateLockFile: false,
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
  },
  packages: {
    "@aryasaatvik/upm": {},
  },
  plugins: [
    github({
      repo: REPOSITORY,
      pushTags: true,
      versionPr: {
        branch: "tegami/version-packages",
        base: "main",
        forceCreate: true,
        create() {
          const version = this.graph.get(PACKAGE_ID)?.version;
          return {
            title: version
              ? `chore(release): prepare upm ${version}`
              : "chore(release): prepare upm",
          };
        },
      },
      release: {
        create({ tag }) {
          return { title: tag };
        },
      },
    }),
    upmTag(),
  ],
});

await runCli(paper);
