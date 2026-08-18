/** @type {import('next').NextConfig} */
const nextConfig = {
  // Avoid file tracing into heavy native packages that bundle test assets.
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  outputFileTracingExcludes: {
    '*': ['**/test/**', '**/*.pdf'],
  },
  reactStrictMode: true,
};
export default nextConfig;
