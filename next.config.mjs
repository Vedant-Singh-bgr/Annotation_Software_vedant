/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) so the production
  // Docker image can run `node server.js` without node_modules or the Next CLI.
  output: "standalone",
  // R2 videos are streamed via presigned URLs generated server-side,
  // so no remote image/host config is required here.
};

export default nextConfig;
