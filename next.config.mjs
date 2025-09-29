/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Avoid file tracing into heavy native packages that bundle test assets
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth'],
  },
  reactStrictMode: true,
};
export default nextConfig;
