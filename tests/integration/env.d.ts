import type { D1Migration } from "@cloudflare/vitest-plugin";
import type * as MainModule from "../../src/worker/index";

export {};

declare global {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }

  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: typeof MainModule;
    }
  }
}
