import type { NextConfig } from "next";

// The Open Payments SDK reads its OpenAPI spec files from its own folder at run time.
// Keep it out of the bundle (so its __dirname is real) and ship the spec files with the server routes.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@interledger/open-payments"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@interledger/open-payments/dist/openapi/specs/*.yaml"],
  },
};

export default nextConfig;
