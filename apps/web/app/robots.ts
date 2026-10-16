import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/g/'],
      disallow: ['/login', '/studio/', '/review', '/api/', '/media/'],
    },
  };
}
